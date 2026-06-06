// Authoritative game simulation for ICE-Stellwerk-Chaos.
// Runs server-side on a fixed tick. Clients send commands, receive snapshots.

import {
  PLATFORM_COUNT,
  SECTORS,
  TRAIN_KINDS,
  sideOf,
  type DisturbanceKind,
  type GameSnapshot,
  type Phase,
  type SectorId,
  type Side,
  type TrainKind,
  type TrainState
} from '../../shared/game'

// ---- tuning (real seconds) ----
const ENTER_TIME = 3.6
const EXIT_TIME = 3.4
const DWELL_TIME = 8
const PUNCTUAL_THRESHOLD = 25
const STUCK_CLEAR_TIME = 10
const MAX_BACKLOG = 8
const PREVIEW_LEN = 4

interface PhaseCfg { until: number, spawn: number, disturbEvery: number }
const PHASES: { name: Phase, cfg: PhaseCfg }[] = [
  { name: 'RUHE', cfg: { until: 55, spawn: 11, disturbEvery: Infinity } },
  { name: 'BERUFSVERKEHR', cfg: { until: 160, spawn: 7, disturbEvery: 32 } },
  { name: 'STOERUNGSBETRIEB', cfg: { until: Infinity, spawn: 5, disturbEvery: 17 } }
]

interface Train {
  id: string
  number: string
  kind: TrainKind
  entryLine: SectorId
  exitLine: SectorId
  platform: number | null
  state: TrainState | 'PENDING'
  delaySec: number
  progress: number
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
  stuckLeft: number
}

interface Spec {
  number: string
  kind: TrainKind
  entryLine: SectorId
  exitLine: SectorId
}

interface Disturbance {
  id: string
  kind: DisturbanceKind
  side?: Side
  platform?: number
  phase: 'WARN' | 'ACTIVE'
  secLeft: number
  triggered: boolean
}

interface Player {
  id: string
  name: string
  sectors: SectorId[]
  connected: boolean
}

let seq = 0
const uid = (p: string) => `${p}${(++seq).toString(36)}`

function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }
function jitter(base: number, frac = 0.25) { return base * (1 + (Math.random() * 2 - 1) * frac) }

export class GameEngine {
  phase: Phase = 'LOBBY'
  elapsed = 0
  roomCode = Math.random().toString(36).slice(2, 6).toUpperCase()
  soloMode = false

  approach: Record<SectorId, Train | null> = { NW: null, SW: null, NE: null, SE: null }
  platforms: (Train | null)[] = Array(PLATFORM_COUNT).fill(null)
  platformDisabled: boolean[] = Array(PLATFORM_COUNT).fill(false)
  heads: Record<Side, { lockedBy: string | null, disabled: boolean }> = {
    W: { lockedBy: null, disabled: false },
    E: { lockedBy: null, disabled: false }
  }

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

  // ---------- lifecycle ----------
  start() {
    if (this.phase !== 'LOBBY' && this.phase !== 'GAMEOVER') return
    this.reset(false)
    this.phase = 'RUHE'
    this.nextSpawnIn = 3
    this.refillPreview()
  }

  restart() {
    this.reset(true)
  }

  private reset(toLobby: boolean) {
    this.elapsed = 0
    this.approach = { NW: null, SW: null, NE: null, SE: null }
    this.platforms = Array(PLATFORM_COUNT).fill(null)
    this.platformDisabled = Array(PLATFORM_COUNT).fill(false)
    this.heads = { W: { lockedBy: null, disabled: false }, E: { lockedBy: null, disabled: false } }
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
    this.phase = toLobby ? 'LOBBY' : this.phase
  }

  // ---------- players ----------
  addPlayer(id: string, name: string): Player {
    let p = this.players.get(id)
    if (!p) {
      p = { id, name: name || `FdL ${this.players.size + 1}`, sectors: [], connected: true }
      this.players.set(id, p)
    } else {
      p.connected = true
      if (name) p.name = name
    }
    return p
  }

  setPlayerConnected(id: string, connected: boolean) {
    const p = this.players.get(id)
    if (p) p.connected = connected
  }

  claimSector(playerId: string, sector: SectorId) {
    for (const p of this.players.values()) p.sectors = p.sectors.filter(s => s !== sector)
    const p = this.players.get(playerId)
    if (p && !p.sectors.includes(sector)) p.sectors.push(sector)
  }

  releaseSector(playerId: string, sector: SectorId) {
    const p = this.players.get(playerId)
    if (p) p.sectors = p.sectors.filter(s => s !== sector)
  }

  setSolo(v: boolean) { this.soloMode = v }

  // ---------- commands ----------
  setEntry(trainId: string, platform: number): boolean {
    if (this.globalStopLeft > 0) return false
    const t = this.trains.find(x => x.id === trainId)
    if (!t || t.state !== 'APPROACH') return false
    const idx = platform - 1
    if (idx < 0 || idx >= PLATFORM_COUNT) return false
    if (this.platforms[idx] || this.platformDisabled[idx]) return false
    const side = sideOf(t.entryLine)
    if (this.heads[side].lockedBy || this.heads[side].disabled) return false
    // commit route
    this.approach[t.entryLine] = null
    this.heads[side].lockedBy = t.id
    this.platforms[idx] = t
    t.platform = platform
    t.state = 'ENTERING'
    t.progress = 0
    return true
  }

  setExit(trainId: string): boolean {
    if (this.globalStopLeft > 0) return false
    const t = this.trains.find(x => x.id === trainId)
    if (!t || t.state !== 'READY_DEPART') return false
    const side = sideOf(t.exitLine)
    if (this.heads[side].lockedBy || this.heads[side].disabled) return false
    if (this.approach[t.exitLine]) return false // outbound line occupied
    this.heads[side].lockedBy = t.id
    t.state = 'EXITING'
    t.progress = 0
    return true
  }

  // ---------- tick ----------
  tick(dt: number) {
    if (this.phase === 'LOBBY' || this.phase === 'GAMEOVER') return
    this.elapsed += dt

    // phase progression
    const cur = PHASES.find(p => this.elapsed < p.cfg.until)!
    this.phase = cur.name

    // global stop countdown
    if (this.globalStopLeft > 0) this.globalStopLeft -= dt

    this.tickSpawns(dt, cur.cfg)
    this.tickDisturbances(dt, cur.cfg)
    this.tickTrains(dt)
    this.drainPending()

    if (this.pending.length > MAX_BACKLOG) {
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

  private refillPreview() {
    while (this.preview.length < PREVIEW_LEN) this.preview.push(this.genSpec())
  }

  private genSpec(): Spec {
    const r = Math.random()
    const kind: TrainKind = r < 0.18 ? 'SPRINTER' : r < 0.62 ? 'ICE' : r < 0.85 ? 'IC' : 'FREIGHT'
    const entryLine = rnd(SECTORS)
    const entrySide = sideOf(entryLine)
    // 70% through (opposite side), else reverse on same side
    let exitLine: SectorId
    if (Math.random() < 0.7) {
      const opp = SECTORS.filter(s => sideOf(s) !== entrySide)
      exitLine = rnd(opp)
    } else {
      const same = SECTORS.filter(s => sideOf(s) === entrySide && s !== entryLine)
      exitLine = same[0] ?? entryLine
    }
    return { number: this.genNumber(kind), kind, entryLine, exitLine }
  }

  private genNumber(kind: TrainKind): string {
    if (kind === 'SPRINTER') return `ICE ${1000 + Math.floor(Math.random() * 99)}`
    if (kind === 'ICE') return `ICE ${100 + Math.floor(Math.random() * 899)}`
    if (kind === 'IC') return `IC ${2000 + Math.floor(Math.random() * 900)}`
    return `GZ ${40000 + Math.floor(Math.random() * 9000)}`
  }

  private spawnFromSpec(spec: Spec) {
    const t: Train = {
      id: uid('t'),
      number: spec.number,
      kind: spec.kind,
      entryLine: spec.entryLine,
      exitLine: spec.exitLine,
      platform: null,
      state: 'PENDING',
      delaySec: 0,
      progress: 0,
      dwellLeft: 0,
      connectionId: null,
      connectionMet: false,
      stuckLeft: 0
    }
    // maybe pair a connection with an existing dwelling/approaching train
    if (this.phase !== 'RUHE' && Math.random() < 0.22) {
      const partner = this.trains.find(o =>
        !o.connectionId && (o.state === 'APPROACH' || o.state === 'DWELL' || o.state === 'ENTERING'))
      if (partner) {
        partner.connectionId = t.id
        t.connectionId = partner.id
      }
    }
    this.pending.push(t)
    this.drainPending()
  }

  private drainPending() {
    for (let i = 0; i < this.pending.length;) {
      const t = this.pending[i]!
      if (!this.approach[t.entryLine]) {
        this.approach[t.entryLine] = t
        t.state = 'APPROACH'
        this.pending.splice(i, 1)
        this.trains.push(t)
      } else {
        i++
      }
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
        case 'ENTERING': {
          if (frozen) break
          t.progress += dt / ENTER_TIME
          if (t.progress >= 1) {
            t.progress = 1
            t.state = 'DWELL'
            t.dwellLeft = DWELL_TIME
            this.heads[sideOf(t.entryLine)].lockedBy = null
          }
          break
        }
        case 'DWELL':
          t.dwellLeft -= dt
          if (t.dwellLeft <= 0) { t.dwellLeft = 0; t.state = 'READY_DEPART' }
          break
        case 'EXITING': {
          if (frozen) break
          t.progress += dt / EXIT_TIME
          if (t.progress >= 1) {
            this.finishDeparture(t)
          }
          break
        }
        case 'STUCK':
          t.delaySec += dt
          t.stuckLeft -= dt
          if (t.stuckLeft <= 0) this.resolveStuck(t)
          break
      }
      // connection meeting check
      if (t.connectionId) {
        const o = this.trains.find(x => x.id === t.connectionId)
        if (o && t.state === 'DWELL' && o.state === 'DWELL') {
          t.connectionMet = true
          o.connectionMet = true
        }
      }
    }
    // cleanup departed
    this.trains = this.trains.filter(t => t.state !== 'DEPARTED')
  }

  private finishDeparture(t: Train) {
    const side = sideOf(t.exitLine)
    if (this.heads[side].lockedBy === t.id) this.heads[side].lockedBy = null
    if (t.platform) this.platforms[t.platform - 1] = null
    t.state = 'DEPARTED'
    this.scoreDeparture(t)
  }

  private resolveStuck(t: Train) {
    // train recovers and completes whatever it was doing
    if (t.platform && this.platforms[t.platform - 1] === t && t.progress < 1) {
      // was ENTERING -> arrives at platform
      this.heads[sideOf(t.entryLine)].lockedBy = null
      t.state = 'DWELL'
      t.dwellLeft = DWELL_TIME
      t.progress = 1
    } else {
      // was EXITING -> finally leaves
      this.finishDeparture(t)
    }
  }

  private scoreDeparture(t: Train) {
    const w = TRAIN_KINDS[t.kind].weight
    const onTime = t.delaySec <= PUNCTUAL_THRESHOLD
    this.departed++
    if (onTime) this.punctual++
    const base = w * 100
    const penalty = t.delaySec * 2 * w
    let pts = Math.round(base - penalty)
    if (t.connectionId) {
      if (t.connectionMet) { pts += 150; this.connectionsMade++ } else { pts -= 120 }
    }
    this.score += pts
    if (onTime) this.pushToast('good', `${t.number} pünktlich raus (+${pts})`)
    else this.pushToast('info', `${t.number} verspätet raus (${pts >= 0 ? '+' : ''}${pts})`)
  }

  // ---------- disturbances ----------
  private tickDisturbances(dt: number, cfg: PhaseCfg) {
    if (cfg.disturbEvery !== Infinity) {
      this.nextDisturbIn -= dt
      if (this.nextDisturbIn <= 0) {
        this.spawnDisturbance()
        this.nextDisturbIn = jitter(cfg.disturbEvery)
      }
    }
    for (let i = 0; i < this.disturbances.length;) {
      const d = this.disturbances[i]!
      d.secLeft -= dt
      if (d.phase === 'WARN' && d.secLeft <= 0) {
        d.phase = 'ACTIVE'
        d.secLeft = jitter(11, 0.3)
        this.activateDisturbance(d)
      } else if (d.phase === 'ACTIVE' && d.secLeft <= 0) {
        this.clearDisturbance(d)
        this.disturbances.splice(i, 1)
        continue
      }
      i++
    }
  }

  private spawnDisturbance() {
    const kinds: DisturbanceKind[] = ['HEAD_FAULT', 'PLATFORM_BLOCK', 'PERSON_ON_TRACK']
    const kind = kinds[Math.floor(Math.random() * (this.phase === 'STOERUNGSBETRIEB' ? 3 : 2))]!
    const d: Disturbance = { id: uid('d'), kind, phase: 'WARN', secLeft: 5, triggered: false }
    if (kind === 'HEAD_FAULT') d.side = Math.random() < 0.5 ? 'W' : 'E'
    if (kind === 'PLATFORM_BLOCK') {
      const free = this.platformDisabled.map((x, i) => x ? -1 : i).filter(i => i >= 0)
      if (!free.length) return
      d.platform = (rnd(free)) + 1
    }
    this.disturbances.push(d)
    const where = kind === 'HEAD_FAULT' ? `Bf-Kopf ${d.side === 'W' ? 'West' : 'Ost'}`
      : kind === 'PLATFORM_BLOCK' ? `Gleis ${d.platform}` : 'Strecke'
    const label = kind === 'HEAD_FAULT' ? 'Weichenstörung' : kind === 'PLATFORM_BLOCK' ? 'Gleissperrung' : 'Person im Gleis'
    this.pushToast('bad', `⚠ ${label} angekündigt: ${where}`)
  }

  private activateDisturbance(d: Disturbance) {
    if (d.kind === 'HEAD_FAULT' && d.side) {
      this.heads[d.side].disabled = true
      // forced brake for any train traversing this head
      for (const t of this.trains) {
        const traversing =
          (t.state === 'ENTERING' && sideOf(t.entryLine) === d.side) ||
          (t.state === 'EXITING' && sideOf(t.exitLine) === d.side)
        if (traversing) {
          t.state = 'STUCK'
          t.stuckLeft = STUCK_CLEAR_TIME
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
    if (d.kind === 'HEAD_FAULT' && d.side) this.heads[d.side].disabled = false
    else if (d.kind === 'PLATFORM_BLOCK' && d.platform) this.platformDisabled[d.platform - 1] = false
  }

  // ---------- output ----------
  pushToast(kind: 'good' | 'bad' | 'info', text: string) { this.toasts.push({ kind, text }) }
  drainToasts() { const t = this.toasts; this.toasts = []; return t }

  snapshot(): GameSnapshot {
    const approach: Record<SectorId, string | null> = { NW: null, SW: null, NE: null, SE: null }
    for (const s of SECTORS) approach[s] = this.approach[s]?.id ?? null
    const interval = PHASES.find(p => this.elapsed < p.cfg.until)!.cfg.spawn
    return {
      phase: this.phase,
      elapsed: Math.floor(this.elapsed),
      approach,
      platforms: this.platforms.map(t => t?.id ?? null),
      platformDisabled: [...this.platformDisabled],
      heads: {
        W: { side: 'W', lockedBy: this.heads.W.lockedBy, disabled: this.heads.W.disabled },
        E: { side: 'E', lockedBy: this.heads.E.lockedBy, disabled: this.heads.E.disabled }
      },
      trains: this.trains.map(t => ({
        id: t.id,
        number: t.number,
        kind: t.kind,
        entryLine: t.entryLine,
        exitLine: t.exitLine,
        platform: t.platform,
        state: t.state as TrainState,
        delaySec: Math.floor(t.delaySec),
        progress: t.progress,
        dwellLeft: Math.max(0, Math.ceil(t.dwellLeft)),
        connectionId: t.connectionId,
        connectionMet: t.connectionMet
      })),
      disturbances: this.disturbances.map(d => ({
        id: d.id, kind: d.kind, side: d.side, platform: d.platform,
        phase: d.phase, secLeft: Math.max(0, Math.ceil(d.secLeft))
      })),
      incoming: this.preview.map((s, i) => ({
        number: s.number, kind: s.kind, entryLine: s.entryLine, exitLine: s.exitLine,
        inSec: Math.max(0, Math.ceil(this.nextSpawnIn + i * interval))
      })),
      backlog: this.pending.length,
      score: this.score,
      punctual: this.punctual,
      departed: this.departed,
      forcedBrakes: this.forcedBrakes,
      connectionsMade: this.connectionsMade,
      punctualityPct: this.departed > 0 ? Math.round((this.punctual / this.departed) * 100) : 100,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, sectors: p.sectors, connected: p.connected
      })),
      roomCode: this.roomCode,
      soloMode: this.soloMode
    }
  }
}
