// Shared types & messages for the ICE-Stellwerk corridor (multi-station network).

export type TrainKind = 'SPRINTER' | 'ICE' | 'IC' | 'FREIGHT'
export interface TrainKindMeta { label: string, weight: number, color: string }
export const TRAIN_KINDS: Record<TrainKind, TrainKindMeta> = {
  SPRINTER: { label: 'ICE-Sprinter', weight: 3, color: '#ff3b3b' },
  ICE: { label: 'ICE', weight: 2, color: '#ffd23b' },
  IC: { label: 'IC', weight: 1, color: '#3bd1ff' },
  FREIGHT: { label: 'Güterzug', weight: 0.5, color: '#9aa3ad' }
}

export type TrainState =
  | 'APPROACH' | 'ENTERING' | 'DWELL' | 'READY_DEPART' | 'EXITING' | 'DEPARTED' | 'STUCK'
  | 'PARKING' | 'PARKED' | 'RETRIEVING'

export type Phase = 'LOBBY' | 'RUHE' | 'BERUFSVERKEHR' | 'STOERUNGSBETRIEB' | 'GAMEOVER'
export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: 'Lobby', RUHE: 'Ruhiger Betrieb', BERUFSVERKEHR: 'Berufsverkehr',
  STOERUNGSBETRIEB: 'Störungsbetrieb', GAMEOVER: 'Betrieb eingestellt'
}

export interface TrainView {
  id: string
  number: string
  kind: TrainKind
  dir: 'E' | 'W' // travel direction through the corridor
  station: string | null // current station id; null = left the network
  arrLine: string // line id it arrived on in the current station
  exitLine: string | null // chosen exit line in the current station
  platform: number | null
  sollPlatform: number // soll for current station
  sollExitLine: string // soll exit line for current station
  deviated: boolean
  state: TrainState
  delaySec: number
  progress: number
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
  routeId: string | null
  sidingIndex: number | null // when PARKING/PARKED/RETRIEVING
  staged: boolean // bereitgestellt-/abstell-task train
  resvKind: 'entry' | 'exit' | null
  resvPlatform: number | null
  resvExitLine: string | null
}

export interface StationView {
  id: string
  platforms: (string | null)[]
  platformDisabled: boolean[]
  sidings: (string | null)[]
  sideDisabled: { W: boolean, E: boolean }
}
export interface LinkView { id: string, a: string, b: string, occupant: (string | null)[] }
export interface PlayerView { id: string, name: string, station: string | null, connected: boolean }

export interface GameSnapshot {
  netCount: number
  netTypes: string[]
  phase: Phase
  elapsed: number
  stations: StationView[]
  links: LinkView[]
  trains: TrainView[]
  incoming: { number: string, kind: TrainKind, dir: 'E' | 'W', firstStation: string, inSec: number }[]
  backlog: number
  maxBacklog: number
  score: number
  punctual: number
  departed: number
  deviations: number
  handoffs: number
  forcedBrakes: number
  punctualityPct: number
  players: PlayerView[]
  roomCode: string
  soloMode: boolean
}

// ---- Client -> Server ----
export type ClientMessage =
  | { t: 'helloScreen' }
  | { t: 'helloPlayer', name?: string, playerId?: string }
  | { t: 'claimStation', station: string }
  | { t: 'releaseStation', station: string }
  | { t: 'setEntry', trainId: string, platform: number }
  | { t: 'setExit', trainId: string, exitLine: string }
  | { t: 'park', trainId: string, siding: number }
  | { t: 'retrieve', trainId: string, platform: number }
  | { t: 'cancelResv', trainId: string }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'setSolo', solo: boolean }
  | { t: 'setNetwork', count: number }
  | { t: 'setStationType', index: number, kind: string }

// ---- Server -> Client ----
export type ServerMessage =
  | { t: 'snapshot', state: GameSnapshot }
  | { t: 'welcome', playerId: string }
  | { t: 'toast', kind: 'good' | 'bad' | 'info', text: string }
