// Authoritative game simulation for ICE-Stellwerk-Chaos.
// Route conflicts are decided by throat-diagonal crossing (layout.ts), so
// non-crossing Fahrstraßen run in parallel. Lines are double-tracked
// (arrival/departure) which makes the node deadlock-resistant.

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
  routesConflict,
  type Layout,
  type LineDef,
  type Preset,
  type RouteDef,
  type Side
} from '../../shared/layout'

// ---- tuning (real seconds) ----
const ENTER_TIME = 4.0
const EXIT_TIME = 3.6
const DWELL_TIME = 9
const PUNCTUAL_THRESHOLD = 30
const STUCK_CLEAR_TIME = 11
const PREVIEW_LEN = 4

interface PhaseCfg { until: number, spawn: number, disturbEvery: number }
const PHASES: { name: Phase, cfg: PhaseCfg }[] = [
  { name: 'RUHE', cfg: { until: 55, spawn: 12, disturbEvery: Infinity } },
  { name: 'BERUFSVERKEHR', cfg: { until: 165, spawn: 8, disturbEvery: 34 } },
  { name: 'STOERUNGSBETRIEB', cfg: { until: Infinity, spawn: 5.5, disturbEvery: 18 } }
]

interface Train {
  id: string
  number: string
  kind: TrainKind
  entryLine: string
  exitLine: string
  platform: number | null
  state: TrainState | 'PENDING'
  delaySec: number
  progress: number
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
  stuckLeft: number
  routeId: string | null
}

interface Spec { number: string, kind: TrainKind, entryLine: string, exitLine: string }
interface Disturbance {
  id: string
  kind: DisturbanceKind
  side?: Side
  platform?: number
  phase: 'WARN' | 'ACTIVE'
  secLeft: number
}
interface Player { id: string, name: string, sectors: string[], connected: boolean }

let seq = 0
const uid = (p: string) => `${p}${(++seq).toString(36)}`
function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }
function jitter(base: number, frac = 0.25) { return base * (1 + (Math.random() * 2 - 1) * frac) }

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
    this.nextSpawnIn = 3
    this.refillPreview()
  }

  restart() { this.reset(true) }

  private reset(toLobby: boolean) {
    this.elapsed = 0
    this.applyLayout()
    this.sideDisabled = { W: false, E: false }
    this.trains = []
    this.pending = []
    this.preview = []
    this.disturbances = []
    this.nextSpawnIn = 0
    this.nextDisturbIn = 0
    this.globalStopLeft = 0
    this.score = 0
    this.punctual = 0
    this.departed = 0
    this.forcedBrakes = 0
    this.connectionsMade = 0
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
    const p = this.players.get(playerId)
    if (p && !p.sectors.includes(sector)) p.sectors.push(sector)
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
    return this.trains.some(t => (t.state === 'EXITING' || t.state === 'STUCK') &&
      t.exitLine === lineId && this.routeOf(t)?.kind === 'exit')
  }
  private lineHasApproach(lineId: string): boolean {
    return this.trains.some(t => t.state === 'APPROACH' && t.entryLine === lineId)
  }

  // ---------- commands ----------
  setEntry(trainId: string, platform: number): boolean {
    if (!this.playing() || this.globalStopLeft > 0) return false
    const t = this.trains.find(x => x.id === trainId)
    if (!t || t.state !== 'APPROACH') return false
    const idx = platform - 1
    if (idx < 0 || idx >= this.platforms.length) return false
    if (this.platforms[idx] || this.platformDisabled[idx]) return false
    const route = this.layout.entry(t.entryLine, platform)
    if (!route || this.sideDisabled[route.side]) return false
    if (this.throatBusy(route)) return false
    this.platforms[idx] = t.id
    t.platform = platform
    t.routeId = route.id
    t.state = 'ENTERING'
    t.progress = 0
    return true
  }

  setExit(trainId: string): boolean {
    if (!this.playing() || this.globalStopLeft > 0) return false
    const t = this.trains.find(x => x.id === trainId)
    if (!t || t.state !== 'READY_DEPART' || t.platform == null) return false
    const route = this.layout.exit(t.exitLine, t.platform)
    if (!route || this.sideDisabled[route.side]) return false
    if (this.depTrackBusy(t.exitLine)) return false
    if (this.throatBusy(route)) return false
    t.routeId = route.id
    t.state = 'EXITING'
    t.progress = 0
    return true
  }

  // ---------- tick ----------
  tick(dt: number) {
    if (!this.playing()) return
    this.elapsed += dt
    const cur = PHASES.find(p => this.elapsed < p.cfg.until)!
    this.phase = cur.name
    if (this.globalStopLeft > 0) this.globalStopLeft -= dt

    this.tickSpawns(dt, cur.cfg)
    this.tickDisturbances(dt, cur.cfg)
    this.tickTrains(dt)
    this.drainPending()

    if (this.pending.length > this.maxBacklog) {
      this.phase = 'GAMEOVER'
      this.pushToast('bad', 'Knoten überlastet — Betrieb eingestellt!')
    }
  }

  private tickSpawns(dt: number, cfg: PhaseCfg) {
    this.nextSpawnIn -= dt
    if (this.nextSpawnIn <= 0) {
      this.refillPreview()
      const spec = this.preview.shift()!
      this.spawnFromSpec(spec)
      this.refillPreview()
      this.nextSpawnIn = jitter(cfg.spawn)
    }
  }

  private refillPreview() { while (this.preview.length < PREVIEW_LEN) this.preview.push(this.genSpec()) }

  private genSpec(): Spec {
    const r = Math.random()
    const kind: TrainKind = r < 0.18 ? 'SPRINTER' : r < 0.62 ? 'ICE' : r < 0.85 ? 'IC' : 'FREIGHT'
    const entry = rnd(this.layout.lines)
    let exit: LineDef
    const opp = this.layout.lines.filter(l => l.side !== entry.side)
    const same = this.layout.lines.filter(l => l.side === entry.side && l.id !== entry.id)
    if (opp.length && (Math.random() < 0.72 || !same.length)) exit = rnd(opp)
    else exit = same.length ? rnd(same) : entry
    return { number: this.genNumber(kind), kind, entryLine: entry.id, exitLine: exit.id }
  }
  private genNumber(kind: TrainKind): string {
    if (kind === 'SPRINTER') return `ICE ${1000 + Math.floor(Math.random() * 99)}`
    if (kind === 'ICE') return `ICE ${100 + Math.floor(Math.random() * 899)}`
    if (kind === 'IC') return `IC ${2000 + Math.floor(Math.random() * 900)}`
    return `GZ ${40000 + Math.floor(Math.random() * 9000)}`
  }

  private spawnFromSpec(spec: Spec) {
    const t: Train = {
      id: uid('t'), number: spec.number, kind: spec.kind,
      entryLine: spec.entryLine, exitLine: spec.exitLine,
      platform: null, state: 'PENDING', delaySec: 0, progress: 0, dwellLeft: 0,
      connectionId: null, connectionMet: false, stuckLeft: 0, routeId: null
    }
    if (this.phase !== 'RUHE' && Math.random() < 0.22) {
      const partner = this.trains.find(o => !o.connectionId && (o.state === 'APPROACH' || o.state === 'DWELL' || o.state === 'ENTERING'))
      if (partner) { partner.connectionId = t.id; t.connectionId = partner.id }
    }
    this.pending.push(t)
    this.drainPending()
  }

  private drainPending() {
    for (let i = 0; i < this.pending.length;) {
      const t = this.pending[i]!
      if (!this.lineHasApproach(t.entryLine)) {
        t.state = 'APPROACH'
        this.pending.splice(i, 1)
        this.trains.push(t)
      } else i++
    }
  }

  private tickTrains(dt: number) {
    const frozen = this.globalStopLeft > 0
    for (const t of this.trains) {
      switch (t.state) {
        case 'APPROACH':
        case 'READY_DEPART':
          t.delaySec += dt
          break
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
          t.delaySec += dt
          t.stuckLeft -= dt
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
    t.routeId = null
    t.state = 'DEPARTED'
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
    this.departed++
    if (onTime) this.punctual++
    let pts = Math.round(w * 100 - t.delaySec * 2 * w)
    if (t.connectionId) { if (t.connectionMet) { pts += 150; this.connectionsMade++ } else pts -= 120 }
    this.score += pts
    if (onTime) this.pushToast('good', `${t.number} pünktlich raus (+${pts})`)
    else this.pushToast('info', `${t.number} verspätet raus (${pts >= 0 ? '+' : ''}${pts})`)
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
      if (d.phase === 'WARN' && d.secLeft <= 0) { d.phase = 'ACTIVE'; d.secLeft = jitter(11, 0.3); this.activateDisturbance(d) }
      else if (d.phase === 'ACTIVE' && d.secLeft <= 0) { this.clearDisturbance(d); this.disturbances.splice(i, 1); continue }
      i++
    }
  }

  private spawnDisturbance() {
    const kinds: DisturbanceKind[] = ['HEAD_FAULT', 'PLATFORM_BLOCK', 'PERSON_ON_TRACK']
    const kind = kinds[Math.floor(Math.random() * (this.phase === 'STOERUNGSBETRIEB' ? 3 : 2))]!
    const d: Disturbance = { id: uid('d'), kind, phase: 'WARN', secLeft: 5 }
    if (kind === 'HEAD_FAULT') d.side = Math.random() < 0.5 ? 'W' : 'E'
    if (kind === 'PLATFORM_BLOCK') {
      const free = this.platformDisabled.map((x, i) => x ? -1 : i).filter(i => i >= 0)
      if (!free.length) return
      d.platform = rnd(free) + 1
    }
    this.disturbances.push(d)
    const where = kind === 'HEAD_FAULT' ? `Bf-Kopf ${d.side === 'W' ? 'West' : 'Ost'}`
      : kind === 'PLATFORM_BLOCK' ? `Gleis ${d.platform}` : 'Strecke'
    const label = kind === 'HEAD_FAULT' ? 'Weichenstörung' : kind === 'PLATFORM_BLOCK' ? 'Gleissperrung' : 'Person im Gleis'
    this.pushToast('bad', `⚠ ${label} angekündigt: ${where}`)
  }

  private activateDisturbance(d: Disturbance) {
    if (d.kind === 'HEAD_FAULT' && d.side) {
      this.sideDisabled[d.side] = true
      for (const t of this.trains) {
        const r = this.routeOf(t)
        const traversing = (t.state === 'ENTERING' || t.state === 'EXITING') && r?.side === d.side
        if (traversing) {
          t.state = 'STUCK'; t.stuckLeft = STUCK_CLEAR_TIME
          this.forcedBrakes++
          this.score -= Math.round(200 * TRAIN_KINDS[t.kind].weight)
          this.pushToast('bad', `🛑 Zwangsbremsung: ${t.number}!`)
        }
      }
    } else if (d.kind === 'PLATFORM_BLOCK' && d.platform) {
      this.platformDisabled[d.platform - 1] = true
    } else if (d.kind === 'PERSON_ON_TRACK') {
      this.globalStopLeft = d.secLeft
      this.pushToast('bad', '🛑 Person im Gleis — Vollhalt!')
    }
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
        platform: t.platform, state: t.state as TrainState, delaySec: Math.floor(t.delaySec),
        progress: t.progress, dwellLeft: Math.max(0, Math.ceil(t.dwellLeft)),
        connectionId: t.connectionId, connectionMet: t.connectionMet, routeId: t.routeId
      })),
      disturbances: this.disturbances.map(d => ({ id: d.id, kind: d.kind, side: d.side, platform: d.platform, phase: d.phase, secLeft: Math.max(0, Math.ceil(d.secLeft)) })),
      globalStop: this.globalStopLeft > 0,
      incoming: this.preview.map((s, i) => ({ number: s.number, kind: s.kind, entryLine: s.entryLine, exitLine: s.exitLine, inSec: Math.max(0, Math.ceil(this.nextSpawnIn + i * interval)) })),
      backlog: this.pending.length,
      maxBacklog: this.maxBacklog,
      score: this.score,
      punctual: this.punctual,
      departed: this.departed,
      forcedBrakes: this.forcedBrakes,
      connectionsMade: this.connectionsMade,
      punctualityPct: this.departed > 0 ? Math.round((this.punctual / this.departed) * 100) : 100,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, sectors: p.sectors, connected: p.connected })),
      roomCode: this.roomCode,
      soloMode: this.soloMode
    }
  }
}
