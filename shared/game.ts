// Shared types & constants for ICE-Stellwerk-Chaos.
// Pure data — safe to import on both server and client.

import type { Preset, Side } from './layout'
export type { Preset, Side } from './layout'

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
  | 'APPROACH' // waiting at entry signal on its arrival track
  | 'ENTERING' // traversing entry throat
  | 'DWELL' // at platform
  | 'READY_DEPART' // dwell done, waiting for exit route
  | 'EXITING' // traversing exit throat
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
  side?: Side
  platform?: number
  phase: 'WARN' | 'ACTIVE'
  secLeft: number
}

export interface TrainView {
  id: string
  number: string
  kind: TrainKind
  entryLine: string
  exitLine: string
  platform: number | null
  state: TrainState
  delaySec: number
  progress: number // 0..1 within current throat traversal
  dwellLeft: number
  connectionId: string | null
  connectionMet: boolean
  routeId: string | null
}

export interface PlayerView {
  id: string
  name: string
  sectors: string[] // line ids
  connected: boolean
}

export interface GameSnapshot {
  preset: Preset
  phase: Phase
  elapsed: number
  platforms: (string | null)[] // train id occupying platform index
  platformDisabled: boolean[]
  sideDisabled: { W: boolean, E: boolean }
  trains: TrainView[]
  disturbances: DisturbanceView[]
  globalStop: boolean
  incoming: { number: string, kind: TrainKind, entryLine: string, exitLine: string, inSec: number }[]
  backlog: number
  maxBacklog: number
  score: number
  punctual: number
  departed: number
  forcedBrakes: number
  connectionsMade: number
  punctualityPct: number
  players: PlayerView[]
  roomCode: string
  soloMode: boolean
}

// ---- Client -> Server messages ----
export type ClientMessage =
  | { t: 'helloScreen' }
  | { t: 'helloPlayer', name?: string, playerId?: string }
  | { t: 'claimSector', sector: string }
  | { t: 'releaseSector', sector: string }
  | { t: 'setEntry', trainId: string, platform: number }
  | { t: 'setExit', trainId: string }
  | { t: 'ackDisturbance', id: string }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'setSolo', solo: boolean }
  | { t: 'setPreset', preset: Preset }

// ---- Server -> Client messages ----
export type ServerMessage =
  | { t: 'snapshot', state: GameSnapshot }
  | { t: 'welcome', playerId: string }
  | { t: 'toast', kind: 'good' | 'bad' | 'info', text: string }
