// Corridor network: a chain of stations connected by links (hand-over tracks).
// Each station has a selectable TYPE (Durchgang/Knoten/Abzweig/Großbf, all
// pass-through) or KOPF (Kopfbahnhof = terminus, only at the chain ends, trains
// reverse). Deterministic from (count, types) so server & client build the same.

import { buildCorridorStation, buildCorridorTerminus, type CorridorKind, type Layout } from './layout'

export type StationKind = CorridorKind | 'KOPF'
export interface SideRole { kind: 'PORTAL' | 'LINK' | 'END', linkId?: string, neighbor?: string }
export interface StationDef {
  id: string
  name: string
  index: number
  kind: StationKind
  layout: Layout
  west: SideRole
  east: SideRole
}
export interface LinkDef { id: string, a: string, b: string, tracks: number }
export interface NetworkDef { count: number, stations: StationDef[], links: LinkDef[] }

const LINK_TRACKS = 4
const PORTAL_TRACKS = 2

export function defaultTypes(count: number): StationKind[] {
  return Array.from({ length: count }, () => 'KNOTEN')
}

function normalizeKind(kind: StationKind, isEnd: boolean, single: boolean): StationKind {
  if (kind === 'KOPF' && (!isEnd || single)) return 'KNOTEN' // terminus only at chain ends
  return kind
}

export function generateNetwork(count: number, types?: StationKind[]): NetworkDef {
  const n = Math.max(1, Math.min(6, count || 1))
  const stations: StationDef[] = []
  const links: LinkDef[] = []
  for (let i = 0; i < n; i++) {
    const isFirst = i === 0, isLast = i === n - 1, single = n === 1
    const letter = String.fromCharCode(65 + i)
    const name = `Stellwerk ${letter}`
    let kind = normalizeKind((types?.[i] ?? 'KNOTEN'), isFirst || isLast, single)
    let west: SideRole, east: SideRole, layout: Layout

    if (single) {
      layout = buildCorridorStation(name, kind as CorridorKind, PORTAL_TRACKS, PORTAL_TRACKS)
      west = { kind: 'PORTAL' }; east = { kind: 'PORTAL' }
    } else if (isFirst) {
      east = { kind: 'LINK', linkId: 'l1', neighbor: 'S2' }
      if (kind === 'KOPF') { layout = buildCorridorTerminus(name, 'E', LINK_TRACKS); west = { kind: 'END' } }
      else { layout = buildCorridorStation(name, kind as CorridorKind, PORTAL_TRACKS, LINK_TRACKS); west = { kind: 'PORTAL' } }
    } else if (isLast) {
      west = { kind: 'LINK', linkId: `l${i}`, neighbor: `S${i}` }
      if (kind === 'KOPF') { layout = buildCorridorTerminus(name, 'W', LINK_TRACKS); east = { kind: 'END' } }
      else { layout = buildCorridorStation(name, kind as CorridorKind, LINK_TRACKS, PORTAL_TRACKS); east = { kind: 'PORTAL' } }
    } else {
      kind = (kind === 'KOPF' ? 'KNOTEN' : kind)
      layout = buildCorridorStation(name, kind as CorridorKind, LINK_TRACKS, LINK_TRACKS)
      west = { kind: 'LINK', linkId: `l${i}`, neighbor: `S${i}` }
      east = { kind: 'LINK', linkId: `l${i + 1}`, neighbor: `S${i + 2}` }
    }
    stations.push({ id: `S${i + 1}`, name, index: i, kind, layout, west, east })
    if (!isLast) links.push({ id: `l${i + 1}`, a: `S${i + 1}`, b: `S${i + 2}`, tracks: LINK_TRACKS })
  }
  return { count: n, stations, links }
}
