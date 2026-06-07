// Corridor network: a chain of stations connected by links (bundles of
// hand-over tracks). Deterministic from player count, built on the through-
// station layout builder. Phase 1 supports n=2 (extends to longer chains).

import { buildThrough, type Layout, type PlatformClass } from './layout'

export interface SideRole { kind: 'PORTAL' | 'LINK', linkId?: string, neighbor?: string }
export interface StationDef {
  id: string
  name: string
  index: number
  layout: Layout
  west: SideRole
  east: SideRole
}
export interface LinkDef { id: string, a: string, b: string, tracks: number } // a.east{k} <-> b.west{k}
export interface NetworkDef { count: number, stations: StationDef[], links: LinkDef[] }

const CLASSES5: PlatformClass[] = ['LANG', 'LANG', 'LANG', 'KURZ', 'GUETER']
const LINK_TRACKS = 4
const PORTAL_TRACKS = 2
const PLATFORMS = 5

export function generateNetwork(count: number): NetworkDef {
  const n = Math.max(1, Math.min(6, count || 1))
  const stations: StationDef[] = []
  const links: LinkDef[] = []
  for (let i = 0; i < n; i++) {
    const isFirst = i === 0, isLast = i === n - 1
    const wCount = isFirst ? PORTAL_TRACKS : LINK_TRACKS
    const eCount = isLast ? PORTAL_TRACKS : LINK_TRACKS
    const letter = String.fromCharCode(65 + i)
    const layout = buildThrough(`Stellwerk ${letter}`, wCount, eCount, PLATFORMS, 0.62, CLASSES5)
    stations.push({
      id: `S${i + 1}`, name: `Stellwerk ${letter}`, index: i, layout,
      west: isFirst ? { kind: 'PORTAL' } : { kind: 'LINK', linkId: `l${i}`, neighbor: `S${i}` },
      east: isLast ? { kind: 'PORTAL' } : { kind: 'LINK', linkId: `l${i + 1}`, neighbor: `S${i + 2}` }
    })
    if (!isLast) links.push({ id: `l${i + 1}`, a: `S${i + 1}`, b: `S${i + 2}`, tracks: LINK_TRACKS })
  }
  return { count: n, stations, links }
}

// Layouts aren't serialized — rebuild network the same way on client & server.
export function stationLayouts(net: NetworkDef): Record<string, Layout> {
  const m: Record<string, Layout> = {}
  for (const s of net.stations) m[s.id] = s.layout
  return m
}
