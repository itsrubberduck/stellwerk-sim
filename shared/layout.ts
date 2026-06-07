// Parametric track-layout generator. Deterministic from a preset, so server
// (conflict logic) and client (rendering) build the identical layout without
// serializing geometry. Conflicts are decided by whether route "throat"
// diagonals geometrically cross — i.e. crossing Fahrstraßen lock each other,
// parallel ones run simultaneously (echtes weichengenaues Routing).

export type Preset = 'KLEIN' | 'MITTEL' | 'GROSS'
export type Side = 'W' | 'E'

export interface Pt { x: number, y: number }

export interface LineDef {
  id: string // 'W1', 'E2'
  side: Side
  label: string // 'West 1'
  index: number
  y: number
  edgeX: number
  stubX: number // inner end of the line stub, where the throat begins
  arrY: number // arrival track y
  depY: number // departure track y
}

export interface PlatformDef {
  index: number // 1-based
  y: number
  leftX: number
  rightX: number
  centerX: number
}

export interface RouteDef {
  id: string
  kind: 'entry' | 'exit'
  lineId: string
  side: Side
  platform: number
  poly: Pt[] // full polyline for render + animation
  diag: [Pt, Pt] // throat diagonal used for crossing-conflict
}

export interface Layout {
  preset: Preset
  name: string
  vw: number
  vh: number
  lines: LineDef[]
  platforms: PlatformDef[]
  routes: RouteDef[]
  entry: (lineId: string, platform: number) => RouteDef | undefined
  exit: (lineId: string, platform: number) => RouteDef | undefined
  byId: (id: string) => RouteDef | undefined
}

export const PRESETS: Record<Preset, { w: number, e: number, p: number, name: string }> = {
  KLEIN: { w: 1, e: 1, p: 3, name: 'Haltepunkt (klein)' },
  MITTEL: { w: 2, e: 2, p: 5, name: 'Knoten (mittel)' },
  GROSS: { w: 3, e: 3, p: 7, name: 'Hauptbahnhof (groß)' }
}

const VW = 1600
const VH = 820
const XPL = 560 // platform left x
const XPR = 1040 // platform right x
const W_EDGE = 60, W_STUB = 360
const E_EDGE = 1540, E_STUB = 1240
const PLAT_TOP = 130, PLAT_BOT = 690
const LINE_TOP = 175, LINE_BOT = 645
const TRACK_GAP = 9 // half-distance between arrival/departure track

function spread(n: number, lo: number, hi: number, i: number): number {
  if (n <= 1) return (lo + hi) / 2
  return lo + (i * (hi - lo)) / (n - 1)
}

export function generateLayout(preset: Preset): Layout {
  const cfg = PRESETS[preset]

  const lines: LineDef[] = []
  for (let i = 0; i < cfg.w; i++) {
    const y = spread(cfg.w, LINE_TOP, LINE_BOT, i)
    lines.push({ id: `W${i + 1}`, side: 'W', label: `West ${i + 1}`, index: i, y, edgeX: W_EDGE, stubX: W_STUB, arrY: y - TRACK_GAP, depY: y + TRACK_GAP })
  }
  for (let i = 0; i < cfg.e; i++) {
    const y = spread(cfg.e, LINE_TOP, LINE_BOT, i)
    lines.push({ id: `E${i + 1}`, side: 'E', label: `Ost ${i + 1}`, index: i, y, edgeX: E_EDGE, stubX: E_STUB, arrY: y - TRACK_GAP, depY: y + TRACK_GAP })
  }

  const platforms: PlatformDef[] = []
  for (let k = 0; k < cfg.p; k++) {
    const y = spread(cfg.p, PLAT_TOP, PLAT_BOT, k)
    platforms.push({ index: k + 1, y, leftX: XPL, rightX: XPR, centerX: (XPL + XPR) / 2 })
  }

  const routes: RouteDef[] = []
  const entryMap = new Map<string, RouteDef>()
  const exitMap = new Map<string, RouteDef>()
  const idMap = new Map<string, RouteDef>()

  for (const line of lines) {
    const innerX = line.side === 'W' ? XPL : XPR
    for (const pf of platforms) {
      // entry: line arrival track -> platform
      const entryDiag: [Pt, Pt] = [{ x: line.stubX, y: line.arrY }, { x: innerX, y: pf.y }]
      const entryPoly: Pt[] = [
        { x: line.edgeX, y: line.arrY },
        { x: line.stubX, y: line.arrY },
        { x: innerX, y: pf.y },
        { x: pf.centerX, y: pf.y }
      ]
      const eId = `e:${line.id}:${pf.index}`
      const eRoute: RouteDef = { id: eId, kind: 'entry', lineId: line.id, side: line.side, platform: pf.index, poly: entryPoly, diag: entryDiag }
      routes.push(eRoute); entryMap.set(`${line.id}:${pf.index}`, eRoute); idMap.set(eId, eRoute)

      // exit: platform -> line departure track
      const exitDiag: [Pt, Pt] = [{ x: innerX, y: pf.y }, { x: line.stubX, y: line.depY }]
      const exitPoly: Pt[] = [
        { x: pf.centerX, y: pf.y },
        { x: innerX, y: pf.y },
        { x: line.stubX, y: line.depY },
        { x: line.edgeX, y: line.depY }
      ]
      const xId = `x:${line.id}:${pf.index}`
      const xRoute: RouteDef = { id: xId, kind: 'exit', lineId: line.id, side: line.side, platform: pf.index, poly: exitPoly, diag: exitDiag }
      routes.push(xRoute); exitMap.set(`${line.id}:${pf.index}`, xRoute); idMap.set(xId, xRoute)
    }
  }

  return {
    preset,
    name: cfg.name,
    vw: VW,
    vh: VH,
    lines,
    platforms,
    routes,
    entry: (l, p) => entryMap.get(`${l}:${p}`),
    exit: (l, p) => exitMap.get(`${l}:${p}`),
    byId: (id) => idMap.get(id)
  }
}

// proper segment intersection (crossing), excludes collinear/touch-only
function ccw(a: Pt, b: Pt, c: Pt): number {
  return Math.sign((c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x))
}
export function segCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = ccw(p1, p2, p3), d2 = ccw(p1, p2, p4)
  const d3 = ccw(p3, p4, p1), d4 = ccw(p3, p4, p2)
  return d1 !== d2 && d3 !== d4
}

export function routesConflict(a: RouteDef, b: RouteDef): boolean {
  if (a.side !== b.side) return false
  return segCross(a.diag[0], a.diag[1], b.diag[0], b.diag[1])
}
