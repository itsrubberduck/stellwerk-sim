// Parametric track-layout generator. Deterministic from a station id, so server
// (conflict logic) and client (rendering) build the identical layout without
// serializing geometry. Different station TYPES (through / terminus / junction)
// give genuinely different topology & flow. Conflicts: two route throat-
// diagonals on the same Bahnhofskopf that geometrically cross lock each other;
// non-crossing routes run in parallel.

export type Preset = 'LANDHALT' | 'KNOTEN' | 'HBF' | 'KOPF' | 'ABZWEIG'
export type StationType = 'THROUGH' | 'TERMINUS' | 'JUNCTION'
export type Side = 'W' | 'E'
export type PlatformClass = 'LANG' | 'KURZ' | 'GUETER'

export const PLATFORM_CLASS_META: Record<PlatformClass, { tag: string, label: string, color: string }> = {
  LANG: { tag: 'L', label: 'Langbahnsteig (ICE)', color: '#34d058' },
  KURZ: { tag: 'K', label: 'Kurzbahnsteig (IC)', color: '#3bd1ff' },
  GUETER: { tag: 'G', label: 'Güter-/Durchfahrt', color: '#9aa3ad' }
}

export function kindAllowed(kind: string, cls: PlatformClass): boolean {
  if (kind === 'SPRINTER' || kind === 'ICE') return cls === 'LANG'
  if (kind === 'IC') return true
  if (kind === 'FREIGHT') return cls === 'KURZ' || cls === 'GUETER'
  return true
}

export interface Pt { x: number, y: number }

export interface LineDef {
  id: string
  side: Side
  label: string
  index: number
  y: number
  edgeX: number
  edgeY: number
  stubX: number
  arrY: number
  depY: number
}

export interface PlatformDef {
  index: number
  y: number
  leftX: number
  rightX: number
  centerX: number
  cls: PlatformClass
  openL: boolean
  openR: boolean
}

export interface RouteDef {
  id: string
  kind: 'entry' | 'exit'
  lineId: string
  side: Side
  platform: number
  poly: Pt[]
  diag: [Pt, Pt]
}

export interface Layout {
  preset: Preset
  name: string
  type: StationType
  sides: Side[]
  vw: number
  vh: number
  lines: LineDef[]
  platforms: PlatformDef[]
  routes: RouteDef[]
  entry: (lineId: string, platform: number) => RouteDef | undefined
  exit: (lineId: string, platform: number) => RouteDef | undefined
  byId: (id: string) => RouteDef | undefined
}

interface StationCfg { name: string, type: StationType, w: number, e: number, p: number, window: number, classes: PlatformClass[] }
export const PRESETS: Record<Preset, StationCfg> = {
  LANDHALT: { name: 'Landhalt', type: 'THROUGH', w: 1, e: 1, p: 3, window: 2, classes: ['LANG', 'LANG', 'GUETER'] },
  KNOTEN: { name: 'Knoten', type: 'THROUGH', w: 2, e: 2, p: 5, window: 0.62, classes: ['LANG', 'LANG', 'LANG', 'KURZ', 'GUETER'] },
  HBF: { name: 'Hauptbahnhof', type: 'THROUGH', w: 3, e: 3, p: 7, window: 0.55, classes: ['LANG', 'LANG', 'LANG', 'LANG', 'KURZ', 'KURZ', 'GUETER'] },
  KOPF: { name: 'Kopfbahnhof', type: 'TERMINUS', w: 4, e: 0, p: 6, window: 0.6, classes: ['LANG', 'LANG', 'LANG', 'KURZ', 'KURZ', 'GUETER'] },
  ABZWEIG: { name: 'Abzweig-Bf', type: 'JUNCTION', w: 2, e: 2, p: 5, window: 0.8, classes: ['LANG', 'LANG', 'LANG', 'KURZ', 'GUETER'] }
}

const VW = 1600, VH = 860
const PLAT_TOP = 150, PLAT_BOT = 710
const LINE_TOP = 180, LINE_BOT = 680
const GAP = 9
const PL = 580, PR = 1020, CENTER = (PL + PR) / 2
const W_EDGE = 60, W_STUB = 372
const E_EDGE = 1540, E_STUB = 1228

function spread(n: number, lo: number, hi: number, i: number): number { return n <= 1 ? (lo + hi) / 2 : lo + (i * (hi - lo)) / (n - 1) }
function norm(n: number, i: number): number { return n <= 1 ? 0.5 : i / (n - 1) }

function ccw(a: Pt, b: Pt, c: Pt): number { return Math.sign((c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x)) }
export function segCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  return ccw(p1, p2, p3) !== ccw(p1, p2, p4) && ccw(p3, p4, p1) !== ccw(p3, p4, p2)
}
export function routesConflict(a: RouteDef, b: RouteDef): boolean {
  if (a.side !== b.side) return false
  return segCross(a.diag[0], a.diag[1], b.diag[0], b.diag[1])
}

function mkLine(id: string, side: Side, label: string, index: number, y: number, edgeY: number): LineDef {
  const edgeX = side === 'W' ? W_EDGE : E_EDGE
  const stubX = side === 'W' ? W_STUB : E_STUB
  return { id, side, label, index, y, edgeX, edgeY, stubX, arrY: y - GAP, depY: y + GAP }
}

function buildRoutes(lines: LineDef[], platforms: PlatformDef[], reach: (l: LineDef, p: PlatformDef) => boolean) {
  const routes: RouteDef[] = []
  const eMap = new Map<string, RouteDef>(), xMap = new Map<string, RouteDef>(), idMap = new Map<string, RouteDef>()
  for (const line of lines) {
    for (const pf of platforms) {
      if (!reach(line, pf)) continue
      const open = line.side === 'W' ? pf.leftX : pf.rightX
      const eArr: Pt = { x: line.stubX, y: line.arrY }
      const oPt: Pt = { x: open, y: pf.y }
      const entryDiag: [Pt, Pt] = [eArr, oPt]
      const entryPoly: Pt[] = [{ x: line.edgeX, y: line.edgeY - GAP }, eArr, oPt, { x: pf.centerX, y: pf.y }]
      const eId = `e:${line.id}:${pf.index}`
      const er: RouteDef = { id: eId, kind: 'entry', lineId: line.id, side: line.side, platform: pf.index, poly: entryPoly, diag: entryDiag }
      routes.push(er); eMap.set(`${line.id}:${pf.index}`, er); idMap.set(eId, er)

      const dDep: Pt = { x: line.stubX, y: line.depY }
      const exitDiag: [Pt, Pt] = [oPt, dDep]
      const exitPoly: Pt[] = [{ x: pf.centerX, y: pf.y }, oPt, dDep, { x: line.edgeX, y: line.edgeY + GAP }]
      const xId = `x:${line.id}:${pf.index}`
      const xr: RouteDef = { id: xId, kind: 'exit', lineId: line.id, side: line.side, platform: pf.index, poly: exitPoly, diag: exitDiag }
      routes.push(xr); xMap.set(`${line.id}:${pf.index}`, xr); idMap.set(xId, xr)
    }
  }
  return { routes, eMap, xMap, idMap }
}

export function generateLayout(preset: Preset): Layout {
  const cfg = PRESETS[preset]
  const lines: LineDef[] = []
  const platforms: PlatformDef[] = []

  if (cfg.type === 'THROUGH') {
    for (let i = 0; i < cfg.w; i++) { const y = spread(cfg.w, LINE_TOP, LINE_BOT, i); lines.push(mkLine(`W${i + 1}`, 'W', `West ${i + 1}`, i, y, y)) }
    for (let j = 0; j < cfg.e; j++) { const y = spread(cfg.e, LINE_TOP, LINE_BOT, j); lines.push(mkLine(`E${j + 1}`, 'E', `Ost ${j + 1}`, j, y, y)) }
    for (let k = 0; k < cfg.p; k++) platforms.push({ index: k + 1, y: spread(cfg.p, PLAT_TOP, PLAT_BOT, k), leftX: PL, rightX: PR, centerX: CENTER, cls: cfg.classes[k] ?? 'LANG', openL: true, openR: true })
    const reach = (l: LineDef, p: PlatformDef) => {
      const n = l.side === 'W' ? cfg.w : cfg.e
      return Math.abs(norm(n, l.index) - norm(cfg.p, p.index - 1)) <= cfg.window
    }
    return finish(preset, cfg, ['W', 'E'], lines, platforms, reach)
  }

  if (cfg.type === 'TERMINUS') {
    for (let i = 0; i < cfg.w; i++) { const y = spread(cfg.w, LINE_TOP, LINE_BOT, i); lines.push(mkLine(`W${i + 1}`, 'W', `Strecke ${i + 1}`, i, y, y)) }
    // bay platforms: open to the west (left), buffer stop on the right
    for (let k = 0; k < cfg.p; k++) platforms.push({ index: k + 1, y: spread(cfg.p, PLAT_TOP, PLAT_BOT, k), leftX: PL, rightX: PR + 60, centerX: CENTER + 30, cls: cfg.classes[k] ?? 'LANG', openL: true, openR: false })
    const reach = (l: LineDef, p: PlatformDef) => Math.abs(norm(cfg.w, l.index) - norm(cfg.p, p.index - 1)) <= cfg.window
    return finish(preset, cfg, ['W'], lines, platforms, reach)
  }

  // JUNCTION (Abzweig): west lines normal; east lines fan into two branches.
  for (let i = 0; i < cfg.w; i++) { const y = spread(cfg.w, LINE_TOP + 40, LINE_BOT - 40, i); lines.push(mkLine(`W${i + 1}`, 'W', `West ${i + 1}`, i, y, y)) }
  // E1 = upper branch (fans up at the edge), E2 = lower branch (fans down)
  const e1y = spread(2, LINE_TOP, LINE_BOT, 0), e2y = spread(2, LINE_TOP, LINE_BOT, 1)
  lines.push(mkLine('E1', 'E', 'Ast Nord', 0, e1y, LINE_TOP - 60))
  lines.push(mkLine('E2', 'E', 'Ast Süd', 1, e2y, LINE_BOT + 60))
  for (let k = 0; k < cfg.p; k++) platforms.push({ index: k + 1, y: spread(cfg.p, PLAT_TOP, PLAT_BOT, k), leftX: PL, rightX: PR, centerX: CENTER, cls: cfg.classes[k] ?? 'LANG', openL: true, openR: true })
  const reach = (l: LineDef, p: PlatformDef) => {
    const pp = norm(cfg.p, p.index - 1)
    if (l.side === 'W') return Math.abs(norm(cfg.w, l.index) - pp) <= cfg.window
    // east: Ast Nord serves upper platforms, Ast Süd lower (overlap in the middle)
    return l.id === 'E1' ? pp <= 0.58 : pp >= 0.42
  }
  return finish(preset, cfg, ['W', 'E'], lines, platforms, reach)
}

function finish(preset: Preset, cfg: StationCfg, sides: Side[], lines: LineDef[], platforms: PlatformDef[], reach: (l: LineDef, p: PlatformDef) => boolean): Layout {
  const { routes, eMap, xMap, idMap } = buildRoutes(lines, platforms, reach)
  return {
    preset, name: cfg.name, type: cfg.type, sides, vw: VW, vh: VH, lines, platforms, routes,
    entry: (l, p) => eMap.get(`${l}:${p}`),
    exit: (l, p) => xMap.get(`${l}:${p}`),
    byId: (id) => idMap.get(id)
  }
}
