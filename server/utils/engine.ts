// Authoritative game simulation for ICE-Stellwerk-Chaos.
//
// Disponier-Modell:
//  - Jeder Zug hat ein Soll-Gleis (planm. Bahnsteig) + Restriktionen.
//  - Fahrstraßen werden VORGEMERKT (reserviert) und feuern automatisch, sobald
//    der Weg frei ist — in der Reihenfolge, in der sie angemeldet wurden
//    (= spielergesteuerte Priorität).
//  - Konflikte über Kopf-Diagonalen-Kreuzung (layout.ts); zweigleisige Strecken.

import {
  TRAIN_KINDS,
  type DisturbanceKind,
  type GameSnapshot,
  type Phase,
  type TrainKind,
  type TrainState
} from '../../shared/game'
import {
  PRESETS,
  generateLayout,
  kindAllowed,
  routesConflict,
  type Layout,
  type LineDef,
  type Preset,
  type RouteDef,
  type Side
} from '../../shared/layout'

// ---- tuning (real seconds) — "mehr Kopf, weniger Reflex" ----
const ENTER_TIME = 4.5
const EXIT_TIME = 4.0
const DWELL_TIME = 10
const PUNCTUAL_THRESHOLD = 35
const STUCK_CLEAR_TIME = 12
const PREVIEW_LEN = 7
const DEVIATION_PENALTY = 60

interface PhaseCfg { until: number, spawn: number, disturbEvery: number }
const PHASES: { name: Phase, cfg: PhaseCfg }[] = [
  { name: 'RUHE', cfg: { until: 60, spawn: 14, disturbEvery: Infinity } },
  { name: 'BERUFSVERKEHR', cfg: { until: 185, spawn: 10, disturbEvery: 40 } },
  { name: 'STOERUNGSBETRIEB', cfg: { until: Infinity, spawn: 7, disturbEvery: 22 } }
]

interface Resv { kind: 'entry' | 'exit', platform?: number, order: number }
interface Train {
  id: string
  number: string
  kind: TrainKind
  entryLine: string
  exitLine: string
  platform: number | null
  sollPlatform: number
  deviated: boolean
  state: TrainState | 'PENDING'
  delaySec: number
  progress: number
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
  stuckLeft: number
  routeId: string | null
  resv: Resv | null
}

interface Spec { number: string, kind: TrainKind, entryLine: string, exitLine: string, sollPlatform: number }
interface Disturbance { id: string, kind: DisturbanceKind, side?: Side, platform?: number, phase: 'WARN' | 'ACTIVE', secLeft: number }
interface Player { id: string, name: string, sectors: string[], connected: boolean }

let seq = 0
const uid = (p: string) => `${p}${(++seq).toString(36)}`
function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }
function jitter(base: number, frac = 0.2) { return base * (1 + (Math.random() * 2 - 1) * frac) }

export class GameEngine {
  preset: Preset = 'MITTEL'
  layout: Layout = generateLayout('MITTEL')
  phase: Phase = 'LOBBY'
  elapsed = 0
  roomCode = Math.random().toString(36).slice(2, 6).toUpperCase()
  soloMode = false

  platforms: (string | null)[] = []
  platformDisabled: boolean[] = []
  sideDisabled: Record<Side, boolean> = { W: false, E: false }

  trains: Train[] = []
  pending: Train[] = []
  preview: Spec[] = []
  disturbances: Disturbance[] = []

  nextSpawnIn = 0
  nextDisturbIn = 0
  globalStopLeft = 0
  resvSeq = 0

  score = 0
  punctual = 0
  departed = 0
  forcedBrakes = 0
  connectionsMade = 0

  players = new Map<string, Player>()
  private toasts: { kind: 'good' | 'bad' | 'info', text: string }[] = []

  constructor() { this.applyLayout() }
  private applyLayout() {
    this.platforms = Array(this.layout.platforms.length).fill(null)
    this.platformDisabled = Array(this.layout.platforms.length).fill(false)
  }
  get maxBacklog() { return Math.max(6, this.layout.lines.length * 2) }

  // ---------- lifecycle ----------
  setPreset(p: Preset) {
    if (this.phase !== 'LOBBY' && this.phase !== 'GAMEOVER') return
    if (!PRESETS[p]) return
    this.preset = p
    this.layout = generateLayout(p)
    this.applyLayout()
    const valid = new Set(this.layout.lines.map(l => l.id))
    for (const pl of this.players.values()) pl.sectors = pl.sectors.filter(s => valid.has(s))
    this.phase = 'LOBBY'
  }
  start() {
    if (this.phase !== 'LOBBY' && this.phase !== 'GAMEOVER') return
    this.reset(false)
    this.phase = 'RUHE'
    this.nextSpawnIn = 4
    this.refillPreview()
  }
  restart() { this.reset(true) }
  private reset(toLobby: boolean) {
    this.elapsed = 0
    this.applyLayout()
    this.sideDisabled = { W: false, E: false }
    this.trains = []; this.pending = []; this.preview = []; this.disturbances = []
    this.nextSpawnIn = 0; this.nextDisturbIn = 0; this.globalStopLeft = 0; this.resvSeq = 0
    this.score = 0; this.punctual = 0; this.departed = 0; this.forcedBrakes = 0; this.connectionsMade = 0
    if (toLobby) this.phase = 'LOBBY'
  }

  // ---------- players ----------
  addPlayer(id: string, name: string): Player {
    let p = this.players.get(id)
    if (!p) { p = { id, name: name || `FdL ${this.players.size + 1}`, sectors: [], connected: true }; this.players.set(id, p) }
    else { p.connected = true; if (name) p.name = name }
    return p
  }
  setPlayerConnected(id: string, c: boolean) { const p = this.players.get(id); if (p) p.connected = c }
  claimSector(playerId: string, sector: string) {
    if (!this.layout.lines.some(l => l.id === sector)) return
    for (const p of this.players.values()) p.sectors = p.sectors.filter(s => s !== sector)
    const p = this.players.get(playerId); if (p && !p.sectors.includes(sector)) p.sectors.push(sector)
  }
  releaseSector(playerId: string, sector: string) { const p = this.players.get(playerId); if (p) p.sectors = p.sectors.filter(s => s !== sector) }
  setSolo(v: boolean) { this.soloMode = v }

  // ---------- conflict helpers ----------
  private playing() { return this.phase === 'RUHE' || this.phase === 'BERUFSVERKEHR' || this.phase === 'STOERUNGSBETRIEB' }
  private routeOf(t: Train): RouteDef | undefined { return t.routeId ? this.layout.byId(t.routeId) : undefined }
  private throatBusy(candidate: RouteDef): boolean {
    for (const t of this.trains) {
      if (t.state !== 'ENTERING' && t.state !== 'EXITING' && t.state !== 'STUCK') continue
      const r = this.routeOf(t)
      if (r && routesConflict(candidate, r)) return true
    }
    return false
  }
  private depTrackBusy(lineId: string): boolean {
    return this.trains.some(t => (t.state === 'EXITING' || t.state === 'STUCK') && t.exitLine === lineId && this.routeOf(t)?.kind === 'exit')
  }
  private lineHasApproach(lineId: string): boolean { return this.trains.some(t => t.state === 'APPROACH' && t.entryLine === lineId) }
  private platformCls(platform: number) { return this.layout.platforms[platform - 1]?.cls ?? 'LANG' }

  // ---------- commands (reservations) ----------
  setEntry(trainId: string, platform: number): boolean {
    const t = this.trains.find(x => x.id === trainId)
    if (!t || t.state !== 'APPROACH') return false
    if (platform < 1 || platform > this.platforms.length) return false
    if (!kindAllowed(t.kind, this.platformCls(platform))) return false
    t.resv = { kind: 'entry', platform, order: ++this.resvSeq }
    return true
  }
  setExit(trainId: string): boolean {
    const t = this.trains.find(x => x.id === trainId)
    if (!t || (t.state !== 'DWELL' && t.state !== 'READY_DEPART')) return false
    t.resv = { kind: 'exit', order: ++this.resvSeq }
    return true
  }
  cancelResv(trainId: string): boolean {
    const t = this.trains.find(x => x.id === trainId)
    if (!t) return false
    t.resv = null
    return true
  }

  private commitReservations() {
    if (this.globalStopLeft > 0) return
    const cands = this.trains.filter(t => t.resv &&
      ((t.resv.kind === 'entry' && t.state === 'APPROACH') || (t.resv.kind === 'exit' && t.state === 'READY_DEPART')))
    cands.sort((a, b) => a.resv!.order - b.resv!.order)
    for (const t of cands) {
      if (t.resv!.kind === 'entry') this.tryCommitEntry(t)
      else this.tryCommitExit(t)
    }
  }
  private tryCommitEntry(t: Train) {
    const platform = t.resv!.platform!
    const idx = platform - 1
    if (this.platforms[idx] || this.platformDisabled[idx]) return
    const route = this.layout.entry(t.entryLine, platform)
    if (!route || this.sideDisabled[route.side] || this.throatBusy(route)) return
    this.platforms[idx] = t.id
    t.platform = platform
    t.deviated = platform !== t.sollPlatform
    t.routeId = route.id
    t.state = 'ENTERING'
    t.progress = 0
    t.resv = null
  }
  private tryCommitExit(t: Train) {
    if (t.platform == null) return
    const route = this.layout.exit(t.exitLine, t.platform)
    if (!route || this.sideDisabled[route.side] || this.depTrackBusy(t.exitLine) || this.throatBusy(route)) return
    t.routeId = route.id
    t.state = 'EXITING'
    t.progress = 0
    t.resv = null
  }

  // ---------- tick ----------
  tick(dt: number) {
    if (!this.playing()) return
    this.elapsed += dt
    this.phase = PHASES.find(p => this.elapsed < p.cfg.until)!.name
    if (this.globalStopLeft > 0) this.globalStopLeft -= dt
    const cfg = PHASES.find(p => this.elapsed < p.cfg.until)!.cfg

    this.tickSpawns(dt, cfg)
    this.tickDisturbances(dt, cfg)
    this.commitReservations()
    this.tickTrains(dt)
    this.drainPending()

    if (this.pending.length > this.maxBacklog) { this.phase = 'GAMEOVER'; this.pushToast('bad', 'Knoten überlastet — Betrieb eingestellt!') }
  }

  private tickSpawns(dt: number, cfg: PhaseCfg) {
    this.nextSpawnIn -= dt
    if (this.nextSpawnIn <= 0) {
      this.refillPreview()
      this.spawnFromSpec(this.preview.shift()!)
      this.refillPreview()
      this.nextSpawnIn = jitter(cfg.spawn)
    }
  }
  private refillPreview() { while (this.preview.length < PREVIEW_LEN) this.preview.push(this.genSpec()) }

  private genSpec(): Spec {
    const r = Math.random()
    const kind: TrainKind = r < 0.16 ? 'SPRINTER' : r < 0.58 ? 'ICE' : r < 0.82 ? 'IC' : 'FREIGHT'
    const entry = rnd(this.layout.lines)
    let exit: LineDef
    const opp = this.layout.lines.filter(l => l.side !== entry.side)
    const same = this.layout.lines.filter(l => l.side === entry.side && l.id !== entry.id)
    if (opp.length && (Math.random() < 0.72 || !same.length)) exit = rnd(opp)
    else exit = same.length ? rnd(same) : entry
    const allowed = this.layout.platforms.filter(p => kindAllowed(kind, p.cls))
    const sollPlatform = (allowed.length ? rnd(allowed) : this.layout.platforms[0]!).index
    return { number: this.genNumber(kind), kind, entryLine: entry.id, exitLine: exit.id, sollPlatform }
  }
  private genNumber(kind: TrainKind): string {
    if (kind === 'SPRINTER') return `ICE ${1000 + Math.floor(Math.random() * 99)}`
    if (kind === 'ICE') return `ICE ${100 + Math.floor(Math.random() * 899)}`
    if (kind === 'IC') return `IC ${2000 + Math.floor(Math.random() * 900)}`
    return `GZ ${40000 + Math.floor(Math.random() * 9000)}`
  }
  private spawnFromSpec(spec: Spec) {
    const t: Train = {
      id: uid('t'), number: spec.number, kind: spec.kind, entryLine: spec.entryLine, exitLine: spec.exitLine,
      platform: null, sollPlatform: spec.sollPlatform, deviated: false, state: 'PENDING',
      delaySec: 0, progress: 0, dwellLeft: 0, connectionId: null, connectionMet: false, stuckLeft: 0, routeId: null, resv: null
    }
    if (this.phase !== 'RUHE' && Math.random() < 0.2) {
      const partner = this.trains.find(o => !o.connectionId && (o.state === 'APPROACH' || o.state === 'DWELL' || o.state === 'ENTERING'))
      if (partner) { partner.connectionId = t.id; t.connectionId = partner.id }
    }
    this.pending.push(t)
    this.drainPending()
  }
  private drainPending() {
    for (let i = 0; i < this.pending.length;) {
      const t = this.pending[i]!
      if (!this.lineHasApproach(t.entryLine)) { t.state = 'APPROACH'; this.pending.splice(i, 1); this.trains.push(t) }
      else i++
    }
  }

  private tickTrains(dt: number) {
    const frozen = this.globalStopLeft > 0
    for (const t of this.trains) {
      switch (t.state) {
        case 'APPROACH':
        case 'READY_DEPART':
          t.delaySec += dt; break
        case 'ENTERING':
          if (frozen) break
          t.progress += dt / ENTER_TIME
          if (t.progress >= 1) { t.progress = 1; t.state = 'DWELL'; t.dwellLeft = DWELL_TIME; t.routeId = null }
          break
        case 'DWELL':
          t.dwellLeft -= dt
          if (t.dwellLeft <= 0) { t.dwellLeft = 0; t.state = 'READY_DEPART' }
          break
        case 'EXITING':
          if (frozen) break
          t.progress += dt / EXIT_TIME
          if (t.progress >= 1) this.finishDeparture(t)
          break
        case 'STUCK':
          t.delaySec += dt; t.stuckLeft -= dt
          if (t.stuckLeft <= 0) this.resolveStuck(t)
          break
      }
      if (t.connectionId) {
        const o = this.trains.find(x => x.id === t.connectionId)
        if (o && t.state === 'DWELL' && o.state === 'DWELL') { t.connectionMet = true; o.connectionMet = true }
      }
    }
    this.trains = this.trains.filter(t => t.state !== 'DEPARTED')
  }
  private finishDeparture(t: Train) {
    if (t.platform) this.platforms[t.platform - 1] = null
    t.routeId = null; t.state = 'DEPARTED'
    this.scoreDeparture(t)
  }
  private resolveStuck(t: Train) {
    const r = this.routeOf(t)
    if (r?.kind === 'entry') { t.state = 'DWELL'; t.dwellLeft = DWELL_TIME; t.progress = 1; t.routeId = null }
    else this.finishDeparture(t)
  }
  private scoreDeparture(t: Train) {
    const w = TRAIN_KINDS[t.kind].weight
    const onTime = t.delaySec <= PUNCTUAL_THRESHOLD
    this.departed++; if (onTime) this.punctual++
    let pts = Math.round(w * 100 - t.delaySec * 2 * w)
    if (t.deviated) pts -= DEVIATION_PENALTY
    if (t.connectionId) { if (t.connectionMet) { pts += 150; this.connectionsMade++ } else pts -= 120 }
    this.score += pts
    const tag = t.deviated ? ' (Soll-Gleis verfehlt)' : ''
    if (onTime && !t.deviated) this.pushToast('good', `${t.number} planmäßig raus (+${pts})`)
    else this.pushToast('info', `${t.number} raus${tag} (${pts >= 0 ? '+' : ''}${pts})`)
  }

  // ---------- disturbances ----------
  private tickDisturbances(dt: number, cfg: PhaseCfg) {
    if (cfg.disturbEvery !== Infinity) {
      this.nextDisturbIn -= dt
      if (this.nextDisturbIn <= 0) { this.spawnDisturbance(); this.nextDisturbIn = jitter(cfg.disturbEvery) }
    }
    for (let i = 0; i < this.disturbances.length;) {
      const d = this.disturbances[i]!
      d.secLeft -= dt
      if (d.phase === 'WARN' && d.secLeft <= 0) { d.phase = 'ACTIVE'; d.secLeft = jitter(12, 0.3); this.activateDisturbance(d) }
      else if (d.phase === 'ACTIVE' && d.secLeft <= 0) { this.clearDisturbance(d); this.disturbances.splice(i, 1); continue }
      i++
    }
  }
  private spawnDisturbance() {
    const kinds: DisturbanceKind[] = ['HEAD_FAULT', 'PLATFORM_BLOCK', 'PERSON_ON_TRACK']
    const kind = kinds[Math.floor(Math.random() * (this.phase === 'STOERUNGSBETRIEB' ? 3 : 2))]!
    const d: Disturbance = { id: uid('d'), kind, phase: 'WARN', secLeft: 6 }
    if (kind === 'HEAD_FAULT') d.side = Math.random() < 0.5 ? 'W' : 'E'
    if (kind === 'PLATFORM_BLOCK') {
      const free = this.platformDisabled.map((x, i) => x ? -1 : i).filter(i => i >= 0)
      if (!free.length) return
      d.platform = rnd(free) + 1
    }
    this.disturbances.push(d)
    const where = kind === 'HEAD_FAULT' ? `Bf-Kopf ${d.side === 'W' ? 'West' : 'Ost'}` : kind === 'PLATFORM_BLOCK' ? `Gleis ${d.platform}` : 'Strecke'
    const label = kind === 'HEAD_FAULT' ? 'Weichenstörung' : kind === 'PLATFORM_BLOCK' ? 'Gleissperrung' : 'Person im Gleis'
    this.pushToast('bad', `⚠ ${label} angekündigt: ${where}`)
  }
  private activateDisturbance(d: Disturbance) {
    if (d.kind === 'HEAD_FAULT' && d.side) {
      this.sideDisabled[d.side] = true
      for (const t of this.trains) {
        const r = this.routeOf(t)
        if ((t.state === 'ENTERING' || t.state === 'EXITING') && r?.side === d.side) {
          t.state = 'STUCK'; t.stuckLeft = STUCK_CLEAR_TIME
          this.forcedBrakes++; this.score -= Math.round(200 * TRAIN_KINDS[t.kind].weight)
          this.pushToast('bad', `🛑 Zwangsbremsung: ${t.number}!`)
        }
      }
    } else if (d.kind === 'PLATFORM_BLOCK' && d.platform) this.platformDisabled[d.platform - 1] = true
    else if (d.kind === 'PERSON_ON_TRACK') { this.globalStopLeft = d.secLeft; this.pushToast('bad', '🛑 Person im Gleis — Vollhalt!') }
  }
  private clearDisturbance(d: Disturbance) {
    if (d.kind === 'HEAD_FAULT' && d.side) this.sideDisabled[d.side] = false
    else if (d.kind === 'PLATFORM_BLOCK' && d.platform) this.platformDisabled[d.platform - 1] = false
  }

  // ---------- output ----------
  pushToast(kind: 'good' | 'bad' | 'info', text: string) { this.toasts.push({ kind, text }) }
  drainToasts() { const t = this.toasts; this.toasts = []; return t }

  snapshot(): GameSnapshot {
    const interval = PHASES.find(p => this.elapsed < p.cfg.until)!.cfg.spawn
    return {
      preset: this.preset,
      phase: this.phase,
      elapsed: Math.floor(this.elapsed),
      platforms: [...this.platforms],
      platformDisabled: [...this.platformDisabled],
      sideDisabled: { W: this.sideDisabled.W, E: this.sideDisabled.E },
      trains: this.trains.map(t => ({
        id: t.id, number: t.number, kind: t.kind, entryLine: t.entryLine, exitLine: t.exitLine,
        platform: t.platform, sollPlatform: t.sollPlatform, deviated: t.deviated, state: t.state as TrainState,
        delaySec: Math.floor(t.delaySec), progress: t.progress, dwellLeft: Math.max(0, Math.ceil(t.dwellLeft)),
        connectionId: t.connectionId, connectionMet: t.connectionMet, routeId: t.routeId,
        resvKind: t.resv?.kind ?? null, resvPlatform: t.resv?.kind === 'entry' ? (t.resv.platform ?? null) : null
      })),
      disturbances: this.disturbances.map(d => ({ id: d.id, kind: d.kind, side: d.side, platform: d.platform, phase: d.phase, secLeft: Math.max(0, Math.ceil(d.secLeft)) })),
      globalStop: this.globalStopLeft > 0,
      incoming: this.preview.map((s, i) => ({ number: s.number, kind: s.kind, entryLine: s.entryLine, exitLine: s.exitLine, sollPlatform: s.sollPlatform, inSec: Math.max(0, Math.ceil(this.nextSpawnIn + i * interval)) })),
      backlog: this.pending.length,
      maxBacklog: this.maxBacklog,
      score: this.score, punctual: this.punctual, departed: this.departed, forcedBrakes: this.forcedBrakes, connectionsMade: this.connectionsMade,
      punctualityPct: this.departed > 0 ? Math.round((this.punctual / this.departed) * 100) : 100,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, sectors: p.sectors, connected: p.connected })),
      roomCode: this.roomCode,
      soloMode: this.soloMode
    }
  }
}
