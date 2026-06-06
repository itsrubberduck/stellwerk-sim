// Shared types & constants for ICE-Stellwerk-Chaos.
// Pure data — safe to import on both server and client.

export type SectorId = 'NW' | 'SW' | 'NE' | 'SE'
export const SECTORS: SectorId[] = ['NW', 'SW', 'NE', 'SE']

export type Side = 'W' | 'E'
export const sideOf = (s: SectorId): Side => (s === 'NW' || s === 'SW') ? 'W' : 'E'

export const SECTOR_LABEL: Record<SectorId, string> = {
  NW: 'Nordwest',
  SW: 'Südwest',
  NE: 'Nordost',
  SE: 'Südost'
}

export type TrainKind = 'SPRINTER' | 'ICE' | 'IC' | 'FREIGHT'

export interface TrainKindMeta {
  label: string
  weight: number
  color: string
}

export const TRAIN_KINDS: Record<TrainKind, TrainKindMeta> = {
  SPRINTER: { label: 'ICE-Sprinter', weight: 3, color: '#ff3b3b' },
  ICE: { label: 'ICE', weight: 2, color: '#ffd23b' },
  IC: { label: 'IC', weight: 1, color: '#3bd1ff' },
  FREIGHT: { label: 'Güterzug', weight: 0.5, color: '#9aa3ad' }
}

export type TrainState =
  | 'APPROACH' // waiting at entry signal
  | 'ENTERING' // traversing entry head
  | 'DWELL' // at platform
  | 'READY_DEPART' // dwell done, waiting for exit route
  | 'EXITING' // traversing exit head
  | 'DEPARTED'
  | 'STUCK' // forced brake

export type Phase = 'LOBBY' | 'RUHE' | 'BERUFSVERKEHR' | 'STOERUNGSBETRIEB' | 'GAMEOVER'

export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: 'Lobby',
  RUHE: 'Ruhiger Betrieb',
  BERUFSVERKEHR: 'Berufsverkehr',
  STOERUNGSBETRIEB: 'Störungsbetrieb',
  GAMEOVER: 'Betrieb eingestellt'
}

export type DisturbanceKind = 'HEAD_FAULT' | 'PLATFORM_BLOCK' | 'PERSON_ON_TRACK'

export interface DisturbanceView {
  id: string
  kind: DisturbanceKind
  side?: Side // for HEAD_FAULT
  platform?: number // for PLATFORM_BLOCK
  phase: 'WARN' | 'ACTIVE'
  secLeft: number
}

export interface TrainView {
  id: string
  number: string
  kind: TrainKind
  entryLine: SectorId
  exitLine: SectorId
  platform: number | null
  state: TrainState
  delaySec: number
  progress: number // 0..1 within current head traversal
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
}

export interface HeadView {
  side: Side
  lockedBy: string | null // train id
  disabled: boolean
}

export interface PlayerView {
  id: string
  name: string
  sectors: SectorId[]
  connected: boolean
}

export interface GameSnapshot {
  phase: Phase
  elapsed: number
  // blocks
  approach: Record<SectorId, string | null> // train id waiting at entry signal
  platforms: (string | null)[] // index 0..3 => Gleis 1..4, train id occupying
  platformDisabled: boolean[]
  heads: { W: HeadView, E: HeadView }
  trains: TrainView[]
  disturbances: DisturbanceView[]
  incoming: { number: string, kind: TrainKind, entryLine: SectorId, exitLine: SectorId, inSec: number }[]
  backlog: number
  // score
  score: number
  punctual: number
  departed: number
  forcedBrakes: number
  connectionsMade: number
  punctualityPct: number
  // meta
  players: PlayerView[]
  roomCode: string
  soloMode: boolean
}

export const PLATFORM_COUNT = 4

// ---- Client -> Server messages ----
export type ClientMessage =
  | { t: 'helloScreen' }
  | { t: 'helloPlayer', name?: string, playerId?: string }
  | { t: 'claimSector', sector: SectorId }
  | { t: 'releaseSector', sector: SectorId }
  | { t: 'setEntry', trainId: string, platform: number }
  | { t: 'setExit', trainId: string }
  | { t: 'ackDisturbance', id: string }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'setSolo', solo: boolean }

// ---- Server -> Client messages ----
export type ServerMessage =
  | { t: 'snapshot', state: GameSnapshot }
  | { t: 'welcome', playerId: string }
  | { t: 'toast', kind: 'good' | 'bad' | 'info', text: string }
