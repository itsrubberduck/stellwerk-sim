// Authoritative simulation for the ICE-Stellwerk corridor (multi-station).
// Each Station reuses the single-station mechanics (reservation/auto-fire,
// weichengenaue conflicts, restrictions). Trains travel a planned Soll-Route
// through the chain; departing onto a LINK hands the train to the neighbour
// (the hand-over track is a shared block — the neighbour must clear it).

import { AVATARS, TRAIN_KINDS, avatarProfile, type AvatarId, type GameSnapshot, type Phase, type TimetableEntry, type TrainKind, type TrainState } from '../../shared/game'
import { kindAllowed, routesConflict, type Layout, type RouteDef, type Side } from '../../shared/layout'
import { defaultTypes, generateNetwork, type LinkDef, type NetworkDef, type SideRole, type StationDef, type StationKind } from '../../shared/network'

const ENTER_TIME = 4.0
const EXIT_TIME = 3.6
const PARK_TIME = 4.0
const RETRIEVE_TIME = 4.0
const DWELL_TIME = 9
const PUNCTUAL_THRESHOLD = 50
const PREVIEW_LEN = 6
const DEVIATION_PENALTY = 50
const HANDOFF_BONUS = 25
const TIMETABLE_HORIZON = 12

interface PhaseCfg { until: number, spawn: number }
const PHASES: { name: Phase, cfg: PhaseCfg }[] = [
  { name: 'RUHE', cfg: { until: 60, spawn: 13 } },
  { name: 'BERUFSVERKEHR', cfg: { until: 185, spawn: 9 } },
  { name: 'STOERUNGSBETRIEB', cfg: { until: Infinity, spawn: 6.5 } }
]

interface Resv { kind: 'entry' | 'exit', platform?: number, exitLine?: string, order: number }
interface SollLeg { platform: number, exitLine: string }
interface ScheduleLeg { arrival: number, departure: number }
interface Train {
  id: string
  number: string
  kind: TrainKind
  dir: 'E' | 'W'
  station: string | null
  originTerminus: boolean
  arrLine: string
  arrLink: { linkId: string, track: number } | null
  exitLine: string | null
  platform: number | null
  soll: Record<string, SollLeg>
  deviated: boolean
  state: TrainState | 'PENDING'
  delaySec: number
  progress: number
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
  stuckLeft: number
  routeId: string | null
  sidingIndex: number | null
  staged: boolean
  schedule: Record<string, ScheduleLeg>
  resv: Resv | null
}
interface Spec {
  id: string
  number: string
  kind: TrainKind
  dir: 'E' | 'W'
  staged: boolean
  soll: Record<string, SollLeg>
  firstLine: string
  originTerminus: boolean
}
interface Player { id: string, name: string, avatarId: AvatarId, station: string | null, connected: boolean }

class Station {
  platforms: (string | null)[]
  platformDisabled: boolean[]
  sidings: (string | null)[]
  sideDisabled: Record<Side, boolean> = { W: false, E: false }
  constructor(public def: StationDef) {
    this.platforms = Array(def.layout.platforms.length).fill(null)
    this.platformDisabled = Array(def.layout.platforms.length).fill(false)
    this.sidings = Array(def.layout.sidings.length).fill(null)
  }
  get layout(): Layout { return this.def.layout }
}
interface LinkState { def: LinkDef, occupant: (string | null)[] }

let seq = 0
const uid = (p: string) => `${p}${(++seq).toString(36)}`
function rnd<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]! }
function jitter(b: number, f = 0.2) { return b * (1 + (Math.random() * 2 - 1) * f) }
const lineNum = (id: string) => parseInt(id.slice(1), 10)
const sideOf = (id: string): Side => id[0] === 'W' ? 'W' : 'E'
const flipLine = (id: string) => (sideOf(id) === 'W' ? 'E' : 'W') + lineNum(id)

export class GameEngine {
  netCount = 2
  netTypes: StationKind[] = []
  net!: NetworkDef
  stations = new Map<string, Station>()
  links = new Map<string, LinkState>()
  phase: Phase = 'LOBBY'
  elapsed = 0
  roomCode = Math.random().toString(36).slice(2, 6).toUpperCase()
  soloMode = false

  trains: Train[] = []
  pending: Train[] = []
  preview: Spec[] = []
  nextSpawnIn = 0
  resvSeq = 0

  score = 0
  punctual = 0
  departed = 0
  deviations = 0
  handoffs = 0
  forcedBrakes = 0

  players = new Map<string, Player>()
  private toasts: { kind: 'good' | 'bad' | 'info', text: string }[] = []

  constructor() { this.buildNet(2, defaultTypes(2)) }

  private buildNet(count: number, types: StationKind[]) {
    this.netCount = count
    this.net = generateNetwork(count, types)
    this.netTypes = this.net.stations.map(s => s.kind) // normalized (KOPF only at ends)
    this.stations = new Map(this.net.stations.map(s => [s.id, new Station(s)]))
    this.links = new Map(this.net.links.map(l => [l.id, { def: l, occupant: Array(l.tracks).fill(null) }]))
  }
  get maxBacklog() { return Math.max(14, this.netCount * 8) } // scales with network; sidings buffer further

  // ---------- lifecycle ----------
  setNetwork(count: number) {
    if (this.phase !== 'LOBBY' && this.phase !== 'GAMEOVER') return
    const c = Math.max(1, Math.min(6, Math.floor(count)))
    this.buildNet(c, defaultTypes(c))
    const valid = new Set(this.net.stations.map(s => s.id))
    for (const p of this.players.values()) if (p.station && !valid.has(p.station)) p.station = null
    this.phase = 'LOBBY'
  }
  setStationType(index: number, kind: string) {
    if (this.phase !== 'LOBBY' && this.phase !== 'GAMEOVER') return
    if (index < 0 || index >= this.netCount) return
    const types = [...this.netTypes]; types[index] = kind as StationKind
    this.buildNet(this.netCount, types)
  }
  start() { if (this.phase !== 'LOBBY' && this.phase !== 'GAMEOVER') return; this.reset(false); this.phase = 'RUHE'; this.nextSpawnIn = 4; this.refillPreview() }
  restart() { this.reset(true) }
  abort() { this.reset(true) } // stop the running game anytime -> back to lobby (keeps net/types/players)
  private reset(toLobby: boolean) {
    this.elapsed = 0
    for (const s of this.stations.values()) { s.platforms.fill(null); s.platformDisabled.fill(false); s.sidings.fill(null); s.sideDisabled = { W: false, E: false } }
    for (const l of this.links.values()) l.occupant.fill(null)
    this.trains = []; this.pending = []; this.preview = []; this.nextSpawnIn = 0; this.resvSeq = 0
    this.score = 0; this.punctual = 0; this.departed = 0; this.deviations = 0; this.handoffs = 0; this.forcedBrakes = 0
    if (toLobby) this.phase = 'LOBBY'
  }

  // ---------- players ----------
  addPlayer(id: string, requestedAvatar?: string): Player {
    let p = this.players.get(id)
    const requested = AVATARS.find(a => a.id === requestedAvatar)
    const avatarTaken = (avatarId: AvatarId) => [...this.players.values()].some(o => o.id !== id && o.connected && o.avatarId === avatarId)
    if (!p) {
      const avatar = requested && !avatarTaken(requested.id) ? requested : (AVATARS.find(a => !avatarTaken(a.id)) ?? AVATARS[0]!)
      p = { id, name: avatar.name, avatarId: avatar.id, station: null, connected: true }
      this.players.set(id, p)
    } else {
      p.connected = true
      if (requested && !avatarTaken(requested.id)) { p.avatarId = requested.id; p.name = requested.name }
      else p.name = avatarProfile(p.avatarId).name
    }
    return p
  }
  setPlayerConnected(id: string, c: boolean) { const p = this.players.get(id); if (p) p.connected = c }
  claimStation(pid: string, sid: string) {
    if (!this.stations.has(sid)) return
    const p = this.players.get(pid); if (!p) return
    const owner = [...this.players.values()].find(o => o.id !== pid && o.station === sid)
    if (owner?.connected) return
    if (owner) owner.station = null
    p.station = sid
  }
  releaseStation(pid: string, sid: string) { const p = this.players.get(pid); if (p && p.station === sid) p.station = null }
  setSolo(v: boolean) { this.soloMode = v }

  // ---------- helpers ----------
  private playing() { return this.phase === 'RUHE' || this.phase === 'BERUFSVERKEHR' || this.phase === 'STOERUNGSBETRIEB' }
  private st(id: string | null): Station | undefined { return id ? this.stations.get(id) : undefined }
  private routeOf(t: Train): RouteDef | undefined { const s = this.st(t.station); return t.routeId && s ? s.layout.byId(t.routeId) : undefined }
  private throatBusy(station: Station, cand: RouteDef): boolean {
    for (const t of this.trains) {
      if (t.station !== station.def.id) continue
      if (t.state !== 'ENTERING' && t.state !== 'EXITING' && t.state !== 'STUCK') continue
      const r = this.routeOf(t); if (r && routesConflict(cand, r)) return true
    }
    return false
  }
  private depLineBusy(station: Station, lineId: string): boolean {
    return this.trains.some(t => t.station === station.def.id && t.state === 'EXITING' && t.exitLine === lineId)
  }
  private lineHasApproach(stationId: string, lineId: string): boolean {
    return this.trains.some(t => t.station === stationId && t.state === 'APPROACH' && t.arrLine === lineId)
  }
  private forwardSide(dir: 'E' | 'W'): Side { return dir === 'E' ? 'E' : 'W' }
  private entrySide(dir: 'E' | 'W'): Side { return dir === 'E' ? 'W' : 'E' }
  private sideRole(station: Station, side: Side) { return side === 'W' ? station.def.west : station.def.east }
  // order of stations along travel direction
  private order(dir: 'E' | 'W'): StationDef[] { return dir === 'E' ? this.net.stations : [...this.net.stations].reverse() }
  private def(id: string): StationDef { return this.net.stations.find(s => s.id === id)! }
  private roleOf(def: StationDef, side: Side): SideRole { return side === 'W' ? def.west : def.east }
  private isFinalTerminus(t: Train): boolean {
    if (!t.station) return false
    const ord = this.order(t.dir); if (ord[ord.length - 1]!.id !== t.station) return false
    return this.roleOf(this.def(t.station), this.forwardSide(t.dir)).kind === 'END'
  }

  // ---------- spawning + soll route ----------
  private refillPreview() { while (this.preview.length < PREVIEW_LEN) this.preview.push(this.genSpec()) }
  private genSpec(): Spec {
    for (;;) {
      const r = Math.random()
      const kind: TrainKind =
        r < 0.14 ? 'SPRINTER'
          : r < 0.52 ? 'ICE'
            : r < 0.72 ? 'IC'
              : r < 0.90 ? 'FREIGHT'
                : r < 0.92 ? 'TGV'
                  : r < 0.94 ? 'CD'
                    : r < 0.97 ? 'SBAHN'
                      : r < 0.985 ? 'V60'
                        : 'V100'
      const dir: 'E' | 'W' = Math.random() < 0.5 ? 'E' : 'W'
      const staged = this.phase !== 'RUHE' && (kind === 'V60' || kind === 'V100' ? Math.random() < 0.55 : Math.random() < 0.16)
      const built = this.buildSoll(kind, dir, staged)
      if (built) return { id: uid('f'), number: this.genNumber(kind), kind, dir, staged, soll: built.soll, firstLine: built.firstLine, originTerminus: built.originTerminus }
    }
  }
  private genNumber(kind: TrainKind): string {
    if (kind === 'SPRINTER') return `ICE ${1000 + Math.floor(Math.random() * 99)}`
    if (kind === 'ICE') return `ICE ${100 + Math.floor(Math.random() * 899)}`
    if (kind === 'IC') return `IC ${2000 + Math.floor(Math.random() * 900)}`
    if (kind === 'TGV') return `TGV ${9500 + Math.floor(Math.random() * 300)}`
    if (kind === 'CD') return `ČD ${170 + Math.floor(Math.random() * 80)}`
    if (kind === 'SBAHN') return `S${1 + Math.floor(Math.random() * 9)} ${Math.floor(Math.random() * 90) + 10}`
    if (kind === 'V60') return `V60 ${300 + Math.floor(Math.random() * 80)}`
    if (kind === 'V100') return `V100 ${100 + Math.floor(Math.random() * 120)}`
    return `GZ ${40000 + Math.floor(Math.random() * 9000)}`
  }

  private buildSoll(kind: TrainKind, dir: 'E' | 'W', staged: boolean): { soll: Record<string, SollLeg>, firstLine: string, originTerminus: boolean } | null {
    const order = this.order(dir)
    const eSide = this.entrySide(dir), fSide = this.forwardSide(dir)
    const first = order[0]!
    const originTerminus = this.roleOf(first, eSide).kind === 'END'
    const originNoEntry = originTerminus || staged
    const entryLines = first.layout.lines.filter(l => l.side === eSide)
    for (let attempt = 0; attempt < 40; attempt++) {
      const soll: Record<string, SollLeg> = {}
      let arrLine = originNoEntry ? '' : rnd(entryLines).id
      let ok = true
      for (let i = 0; i < order.length; i++) {
        const sdef = order[i]!
        const last = i === order.length - 1
        const finalTerminus = last && this.roleOf(sdef, fSide).kind === 'END'
        const needEntry = !(i === 0 && originNoEntry)
        const cand = sdef.layout.platforms.filter(p =>
          kindAllowed(kind, p.cls) &&
          (!needEntry || sdef.layout.entry(arrLine, p.index)) &&
          (finalTerminus || sdef.layout.lines.some(l => l.side === fSide && sdef.layout.exit(l.id, p.index))))
        if (!cand.length) { ok = false; break }
        const pf = rnd(cand)
        let exitLine = ''
        if (!finalTerminus) {
          const exits = sdef.layout.lines.filter(l => l.side === fSide && sdef.layout.exit(l.id, pf.index))
          if (!exits.length) { ok = false; break }
          exitLine = rnd(exits).id
        }
        soll[sdef.id] = { platform: pf.index, exitLine }
        if (!last && exitLine) arrLine = flipLine(exitLine)
      }
      if (ok) {
        let firstLine = ''
        if (!originNoEntry) {
          const pf = soll[first.id]!.platform
          const c = first.layout.lines.filter(l => l.side === eSide && first.layout.entry(l.id, pf))
          firstLine = (c[0] ?? first.layout.lines.find(l => l.side === eSide)!).id
        }
        return { soll, firstLine, originTerminus }
      }
    }
    return null
  }

  private buildSchedule(spec: Pick<Spec, 'dir' | 'staged' | 'originTerminus'>, start: number): Record<string, ScheduleLeg> {
    const schedule: Record<string, ScheduleLeg> = {}
    let arrival = start
    for (const [i, station] of this.order(spec.dir).entries()) {
      const originNoEntry = i === 0 && (spec.originTerminus || spec.staged)
      const departure = arrival + (originNoEntry ? (spec.staged ? RETRIEVE_TIME : 0) : ENTER_TIME + DWELL_TIME)
      schedule[station.id] = { arrival, departure }
      arrival = departure + EXIT_TIME
    }
    return schedule
  }

  private spawnFromSpec(spec: Spec) {
    const order = this.order(spec.dir)
    const firstStation = order[0]!.id
    const t: Train = {
      id: uid('t'), number: spec.number, kind: spec.kind, dir: spec.dir,
      station: firstStation, originTerminus: spec.staged ? false : spec.originTerminus, arrLine: spec.firstLine, arrLink: null, exitLine: null, platform: null,
      soll: spec.soll, deviated: false, state: 'PENDING', delaySec: 0, progress: 0, dwellLeft: 0,
      connectionId: null, connectionMet: false, stuckLeft: 0, routeId: null, sidingIndex: null, staged: spec.staged,
      schedule: this.buildSchedule(spec, this.elapsed), resv: null
    }
    if (this.phase !== 'RUHE' && Math.random() < 0.18) {
      const partner = this.trains.find(o => !o.connectionId && (o.state === 'APPROACH' || o.state === 'DWELL'))
      if (partner) { partner.connectionId = t.id; t.connectionId = partner.id }
    }
    this.pending.push(t)
    this.drainPending()
  }
  private drainPending() {
    for (let i = 0; i < this.pending.length;) {
      const t = this.pending[i]!
      let placed = false
      if (t.staged) {
        // bereitgestellt: starts parked in a siding, must be retrieved by the player
        const s = this.st(t.station); const free = s ? s.sidings.findIndex(x => !x) : -1
        if (s && free >= 0) { s.sidings[free] = t.id; t.sidingIndex = free + 1; t.state = 'PARKED'; placed = true }
      } else if (t.originTerminus) {
        // originates at a terminus bay: needs the soll bay free
        const s = this.st(t.station); const leg = t.station ? t.soll[t.station] : undefined
        if (s && leg && !s.platforms[leg.platform - 1] && !s.platformDisabled[leg.platform - 1]) {
          s.platforms[leg.platform - 1] = t.id; t.platform = leg.platform; t.state = 'READY_DEPART'; placed = true
        }
      } else if (t.station && !this.lineHasApproach(t.station, t.arrLine)) {
        t.state = 'APPROACH'; placed = true
      }
      if (placed) { this.pending.splice(i, 1); this.trains.push(t) } else i++
    }
  }

  // ---------- commands ----------
  setEntry(trainId: string, platform: number): boolean {
    const t = this.trains.find(x => x.id === trainId); const s = this.st(t?.station ?? null)
    if (!t || !s || t.state !== 'APPROACH') return false
    if (platform < 1 || platform > s.platforms.length) return false
    if (!kindAllowed(t.kind, s.layout.platforms[platform - 1]!.cls)) return false
    if (!s.layout.entry(t.arrLine, platform)) return false
    const fSide = this.forwardSide(t.dir)
    if (!this.isFinalTerminus(t) && !s.layout.lines.some(l => l.side === fSide && s.layout.exit(l.id, platform))) return false // dead platform
    t.resv = { kind: 'entry', platform, order: ++this.resvSeq }
    return true
  }
  setExit(trainId: string, exitLine: string): boolean {
    const t = this.trains.find(x => x.id === trainId); const s = this.st(t?.station ?? null)
    if (!t || !s || (t.state !== 'DWELL' && t.state !== 'READY_DEPART') || t.platform == null) return false
    if (sideOf(exitLine) !== this.forwardSide(t.dir)) return false
    if (!s.layout.exit(exitLine, t.platform)) return false
    t.resv = { kind: 'exit', exitLine, order: ++this.resvSeq }
    return true
  }
  cancelResv(trainId: string): boolean { const t = this.trains.find(x => x.id === trainId); if (!t) return false; t.resv = null; return true }

  // ---- sidings: park (Abstellen) / retrieve (Bereitstellen) ----
  park(trainId: string, siding: number): boolean {
    const t = this.trains.find(x => x.id === trainId); const s = this.st(t?.station ?? null)
    if (!t || !s || t.platform == null) return false
    if (t.state !== 'DWELL' && t.state !== 'READY_DEPART') return false
    const idx = siding - 1
    if (idx < 0 || idx >= s.sidings.length || s.sidings[idx]) return false
    s.platforms[t.platform - 1] = null // free the platform
    s.sidings[idx] = t.id
    t.sidingIndex = siding; t.state = 'PARKING'; t.progress = 0; t.resv = null; t.routeId = null
    return true
  }
  retrieve(trainId: string, platform: number): boolean {
    const t = this.trains.find(x => x.id === trainId); const s = this.st(t?.station ?? null)
    if (!t || !s || t.state !== 'PARKED' || t.sidingIndex == null) return false
    const idx = platform - 1
    if (idx < 0 || idx >= s.platforms.length || s.platforms[idx] || s.platformDisabled[idx]) return false
    if (!kindAllowed(t.kind, s.layout.platforms[idx]!.cls)) return false
    s.sidings[t.sidingIndex - 1] = null // free siding
    s.platforms[idx] = t.id
    t.platform = platform; t.state = 'RETRIEVING'; t.progress = 0
    return true
  }

  private commitReservations() {
    const cands = this.trains.filter(t => t.resv &&
      ((t.resv.kind === 'entry' && t.state === 'APPROACH') || (t.resv.kind === 'exit' && t.state === 'READY_DEPART')))
    cands.sort((a, b) => a.resv!.order - b.resv!.order)
    for (const t of cands) t.resv!.kind === 'entry' ? this.tryEntry(t) : this.tryExit(t)
  }
  private tryEntry(t: Train) {
    const s = this.st(t.station)!; const platform = t.resv!.platform!; const idx = platform - 1
    if (s.platforms[idx] || s.platformDisabled[idx]) return
    const route = s.layout.entry(t.arrLine, platform); if (!route || this.throatBusy(s, route)) return
    s.platforms[idx] = t.id; t.platform = platform
    if (platform !== t.soll[s.def.id]!.platform) { t.deviated = true }
    if (t.arrLink) { const lk = this.links.get(t.arrLink.linkId); if (lk) lk.occupant[t.arrLink.track - 1] = null; t.arrLink = null }
    t.routeId = route.id; t.state = 'ENTERING'; t.progress = 0; t.resv = null
    if (!t.exitLine) t.exitLine = t.soll[s.def.id]!.exitLine
  }
  private tryExit(t: Train) {
    if (t.platform == null) return
    const s = this.st(t.station)!; const exitLine = t.resv!.exitLine!
    const route = s.layout.exit(exitLine, t.platform); if (!route) return
    if (this.depLineBusy(s, exitLine) || this.throatBusy(s, route)) return
    const side = sideOf(exitLine); const role = this.sideRole(s, side)
    if (role.kind === 'LINK') { const lk = this.links.get(role.linkId!)!; if (lk.occupant[lineNum(exitLine) - 1]) return }
    t.exitLine = exitLine
    if (exitLine !== t.soll[s.def.id]!.exitLine) t.deviated = true
    t.routeId = route.id; t.state = 'EXITING'; t.progress = 0; t.resv = null
  }

  // ---------- tick ----------
  tick(dt: number) {
    if (!this.playing()) return
    this.elapsed += dt
    this.phase = PHASES.find(p => this.elapsed < p.cfg.until)!.name
    const cfg = PHASES.find(p => this.elapsed < p.cfg.until)!.cfg
    this.nextSpawnIn -= dt
    if (this.nextSpawnIn <= 0) { this.refillPreview(); this.spawnFromSpec(this.preview.shift()!); this.refillPreview(); this.nextSpawnIn = jitter(cfg.spawn) }
    this.commitReservations()
    this.tickTrains(dt)
    this.drainPending()
    if (this.pending.length > this.maxBacklog) { this.phase = 'GAMEOVER'; this.pushToast('bad', 'Netz überlastet — Betrieb eingestellt!') }
  }
  private tickTrains(dt: number) {
    for (const t of this.trains) {
      switch (t.state) {
        case 'APPROACH': case 'READY_DEPART': t.delaySec += dt; break
        case 'ENTERING':
          t.progress += dt / ENTER_TIME
          if (t.progress >= 1) { t.progress = 1; t.state = 'DWELL'; t.dwellLeft = DWELL_TIME; t.routeId = null }
          break
        case 'DWELL': t.dwellLeft -= dt; if (t.dwellLeft <= 0) { t.dwellLeft = 0; if (this.isFinalTerminus(t)) this.terminate(t); else t.state = 'READY_DEPART' } break
        case 'EXITING': t.progress += dt / EXIT_TIME; if (t.progress >= 1) this.finishLeg(t); break
        case 'PARKING': t.progress += dt / PARK_TIME; if (t.progress >= 1) { t.progress = 1; t.state = 'PARKED'; t.platform = null } break
        case 'RETRIEVING': t.progress += dt / RETRIEVE_TIME; if (t.progress >= 1) { t.progress = 1; t.state = 'READY_DEPART'; t.sidingIndex = null } break
        case 'PARKED': break // parked trains buy time (no delay accrual)
        case 'STUCK': t.delaySec += dt; t.stuckLeft -= dt; if (t.stuckLeft <= 0) t.state = 'DWELL'; break
      }
      if (t.connectionId) { const o = this.trains.find(x => x.id === t.connectionId); if (o && t.state === 'DWELL' && o.state === 'DWELL') { t.connectionMet = true; o.connectionMet = true } }
    }
    this.trains = this.trains.filter(t => t.state !== 'DEPARTED')
  }
  private finishLeg(t: Train) {
    const s = this.st(t.station)!; const exitLine = t.exitLine!
    if (t.platform) s.platforms[t.platform - 1] = null
    const side = sideOf(exitLine); const role = this.sideRole(s, side)
    if (role.kind === 'PORTAL') { t.routeId = null; t.platform = null; t.state = 'DEPARTED'; this.scoreFinal(t); return }
    // hand over to neighbour
    const lk = this.links.get(role.linkId!)!; const track = lineNum(exitLine)
    lk.occupant[track - 1] = t.id; this.handoffs++; this.score += HANDOFF_BONUS
    t.station = role.neighbor!; t.arrLine = flipLine(exitLine); t.arrLink = { linkId: role.linkId!, track }
    t.state = 'APPROACH'; t.platform = null; t.routeId = null; t.exitLine = null; t.progress = 0
  }
  private terminate(t: Train) {
    const s = this.st(t.station)!
    if (t.platform) s.platforms[t.platform - 1] = null
    t.routeId = null; t.platform = null; t.state = 'DEPARTED'
    this.scoreFinal(t)
  }
  private scoreFinal(t: Train) {
    const w = TRAIN_KINDS[t.kind].weight
    const onTime = t.delaySec <= PUNCTUAL_THRESHOLD
    this.departed++; if (onTime) this.punctual++
    let pts = Math.round(w * 100 - t.delaySec * 1.5 * w)
    if (t.deviated) { pts -= DEVIATION_PENALTY; this.deviations++ }
    if (t.connectionId) { if (t.connectionMet) pts += 150; else pts -= 120 }
    this.score += pts
    this.pushToast(onTime && !t.deviated ? 'good' : 'info', `${t.number} aus dem Netz (${pts >= 0 ? '+' : ''}${pts})`)
  }

  // ---------- output ----------
  pushToast(kind: 'good' | 'bad' | 'info', text: string) { this.toasts.push({ kind, text }) }
  drainToasts() { const t = this.toasts; this.toasts = []; return t }

  private destination(dir: 'E' | 'W'): string {
    const last = this.order(dir).at(-1)!
    const role = this.roleOf(last, this.forwardSide(dir))
    return role.kind === 'END' ? last.name : `Netz ${dir === 'E' ? 'Ost' : 'West'}`
  }
  private currentDepartureEstimate(t: Train): number | null {
    switch (t.state) {
      case 'APPROACH': return this.elapsed + ENTER_TIME + DWELL_TIME
      case 'ENTERING': return this.elapsed + (1 - t.progress) * ENTER_TIME + DWELL_TIME
      case 'DWELL': return this.elapsed + t.dwellLeft
      case 'READY_DEPART': case 'EXITING': return this.elapsed
      case 'STUCK': return this.elapsed + Math.max(0, t.stuckLeft) + Math.max(0, t.dwellLeft)
      case 'RETRIEVING': return this.elapsed + (1 - t.progress) * RETRIEVE_TIME
      case 'PARKING': case 'PARKED': return null
      default: return null
    }
  }
  private trainEstimateAt(t: Train, stationId: string, event: 'ARRIVAL' | 'DEPARTURE'): number | null {
    if (!t.station) return null
    const order = this.order(t.dir)
    const current = order.findIndex(s => s.id === t.station)
    const target = order.findIndex(s => s.id === stationId)
    if (current < 0 || target < current) return null
    const planned = t.schedule[stationId]!
    if (target === current) {
      if (event === 'ARRIVAL') return Math.max(planned.arrival, this.elapsed)
      const departure = this.currentDepartureEstimate(t)
      return departure == null ? null : Math.max(planned.departure, departure)
    }
    const currentDeparture = this.currentDepartureEstimate(t)
    if (currentDeparture == null) return null
    let arrival = currentDeparture + (t.state === 'EXITING' ? (1 - t.progress) * EXIT_TIME : EXIT_TIME)
    for (let i = current + 1; i <= target; i++) {
      if (i === target) return Math.max(event === 'ARRIVAL' ? planned.arrival : planned.departure, event === 'ARRIVAL' ? arrival : arrival + ENTER_TIME + DWELL_TIME)
      arrival += ENTER_TIME + DWELL_TIME + EXIT_TIME
    }
    return null
  }
  private timetable(interval: number): TimetableEntry[] {
    const rows: TimetableEntry[] = []
    for (const t of this.trains) {
      if (!t.station) continue
      const order = this.order(t.dir)
      const current = order.findIndex(s => s.id === t.station)
      for (let i = current; i < order.length; i++) {
        const station = order[i]!
        const leg = t.soll[station.id]!
        const schedule = t.schedule[station.id]!
        const event = leg.exitLine ? 'DEPARTURE' : 'ARRIVAL'
        const isCurrent = station.id === t.station
        const reservedPlatform = isCurrent && t.resv?.kind === 'entry' ? (t.resv.platform ?? null) : null
        const actualPlatform = isCurrent ? (t.platform ?? reservedPlatform) : null
        rows.push({
          id: `${t.id}:${station.id}`, trainId: t.id, number: t.number, kind: t.kind, dir: t.dir, station: station.id,
          destination: this.destination(t.dir), event, plannedTime: event === 'ARRIVAL' ? schedule.arrival : schedule.departure,
          estimatedTime: this.trainEstimateAt(t, station.id, event), plannedPlatform: leg.platform, platform: actualPlatform,
          platformStatus: t.platform != null && isCurrent ? 'ACTUAL' : reservedPlatform != null ? 'RESERVED' : 'PLANNED',
          state: t.state as TrainState, staged: t.staged
        })
      }
    }
    for (const [previewIndex, spec] of this.preview.entries()) {
      const start = this.elapsed + Math.max(0, this.nextSpawnIn + previewIndex * interval)
      const schedule = this.buildSchedule(spec, start)
      for (const station of this.order(spec.dir)) {
        const leg = spec.soll[station.id]!
        const event = leg.exitLine ? 'DEPARTURE' : 'ARRIVAL'
        rows.push({
          id: `${spec.id}:${station.id}`, trainId: null, number: spec.number, kind: spec.kind, dir: spec.dir, station: station.id,
          destination: this.destination(spec.dir), event, plannedTime: event === 'ARRIVAL' ? schedule[station.id]!.arrival : schedule[station.id]!.departure,
          estimatedTime: event === 'ARRIVAL' ? schedule[station.id]!.arrival : schedule[station.id]!.departure,
          plannedPlatform: leg.platform, platform: null, platformStatus: 'PLANNED', state: 'SCHEDULED', staged: spec.staged
        })
      }
    }
    return rows.filter(row => row.plannedTime <= this.elapsed + 180 || row.estimatedTime == null)
      .sort((a, b) => (a.estimatedTime ?? a.plannedTime) - (b.estimatedTime ?? b.plannedTime))
      .slice(0, this.netCount * TIMETABLE_HORIZON)
  }

  snapshot(): GameSnapshot {
    const interval = PHASES.find(p => this.elapsed < p.cfg.until)!.cfg.spawn
    return {
      netCount: this.netCount,
      netTypes: [...this.netTypes],
      phase: this.phase,
      elapsed: Math.floor(this.elapsed),
      stations: this.net.stations.map(sd => { const s = this.stations.get(sd.id)!; return { id: sd.id, platforms: [...s.platforms], platformDisabled: [...s.platformDisabled], sidings: [...s.sidings], sideDisabled: { W: s.sideDisabled.W, E: s.sideDisabled.E } } }),
      links: this.net.links.map(l => ({ id: l.id, a: l.a, b: l.b, occupant: [...this.links.get(l.id)!.occupant] })),
      trains: this.trains.map(t => {
        const soll = t.station ? t.soll[t.station] : undefined
        return {
          id: t.id, number: t.number, kind: t.kind, dir: t.dir, station: t.station, arrLine: t.arrLine,
          exitLine: t.exitLine, platform: t.platform, sollPlatform: soll?.platform ?? 0, sollExitLine: soll?.exitLine ?? '',
          deviated: t.deviated, state: t.state as TrainState, delaySec: Math.floor(t.delaySec), progress: t.progress,
          dwellLeft: Math.max(0, Math.ceil(t.dwellLeft)), connectionId: t.connectionId, connectionMet: t.connectionMet,
          routeId: t.routeId, sidingIndex: t.sidingIndex, staged: t.staged, resvKind: t.resv?.kind ?? null, resvPlatform: t.resv?.kind === 'entry' ? (t.resv.platform ?? null) : null,
          resvExitLine: t.resv?.kind === 'exit' ? (t.resv.exitLine ?? null) : null
        }
      }),
      incoming: this.preview.map((s, i) => ({ number: s.number, kind: s.kind, dir: s.dir, firstStation: this.order(s.dir)[0]!.id, inSec: Math.max(0, Math.ceil(this.nextSpawnIn + i * interval)) })),
      timetable: this.timetable(interval),
      backlog: this.pending.length, maxBacklog: this.maxBacklog,
      score: this.score, punctual: this.punctual, departed: this.departed, deviations: this.deviations, handoffs: this.handoffs, forcedBrakes: this.forcedBrakes,
      punctualityPct: this.departed > 0 ? Math.round((this.punctual / this.departed) * 100) : 100,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, avatarId: p.avatarId, station: p.station, connected: p.connected })),
      roomCode: this.roomCode, soloMode: this.soloMode
    }
  }
}
