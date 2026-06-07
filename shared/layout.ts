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
  if (kind === 'SPRINTER' || kind === 'ICE' || kind === 'TGV' || kind === 'CD') return cls === 'LANG'
  if (kind === 'IC' || kind === 'SBAHN' || kind === 'V60' || kind === 'V100') return true
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
  barL?: number // platform-edge extent (varies by length/class + stagger); set in finish()
  barR?: number
  yL?: number // angled tracks: y at left / right end (set in finish); pf.y stays the centre
  yR?: number
}

export interface SidingDef { index: number, y: number, leftX: number, rightX: number, centerX: number }

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
  sidings: SidingDef[]
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
      const openY = line.side === 'W' ? (pf.yL ?? pf.y) : (pf.yR ?? pf.y)
      const eArr: Pt = { x: line.stubX, y: line.arrY }
      const oPt: Pt = { x: open, y: openY }
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
    return finish(preset, cfg.name, cfg.type, ['W', 'E'], lines, platforms, reach)
  }

  if (cfg.type === 'TERMINUS') {
    for (let i = 0; i < cfg.w; i++) { const y = spread(cfg.w, LINE_TOP, LINE_BOT, i); lines.push(mkLine(`W${i + 1}`, 'W', `Strecke ${i + 1}`, i, y, y)) }
    // bay platforms: open to the west (left), buffer stop on the right
    for (let k = 0; k < cfg.p; k++) platforms.push({ index: k + 1, y: spread(cfg.p, PLAT_TOP, PLAT_BOT, k), leftX: PL, rightX: PR + 60, centerX: CENTER + 30, cls: cfg.classes[k] ?? 'LANG', openL: true, openR: false })
    const reach = (l: LineDef, p: PlatformDef) => Math.abs(norm(cfg.w, l.index) - norm(cfg.p, p.index - 1)) <= cfg.window
    return finish(preset, cfg.name, cfg.type, ['W'], lines, platforms, reach)
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
  return finish(preset, cfg.name, cfg.type, ['W', 'E'], lines, platforms, reach)
}

function finish(preset: Preset, name: string, type: StationType, sides: Side[], lines: LineDef[], platforms: PlatformDef[], reach: (l: LineDef, p: PlatformDef) => boolean, sidings: SidingDef[] = []): Layout {
  // organic variety: asymmetric switch positions, staggered platforms, variable bar lengths
  // asymmetric switch positions in the throat; platforms stay parallel (real Bf)
  lines.forEach((l, i) => { l.stubX += (l.side === 'W' ? 1 : -1) * (i % 2 ? 16 : -11) })
  platforms.forEach((pf, i) => { pf.y += (i % 2 ? 11 : -7) })
  for (const pf of platforms) {
    const f = pf.cls === 'KURZ' ? 0.5 : pf.cls === 'GUETER' ? 0.78 : 1.0
    const span = pf.rightX - pf.leftX, len = span * f
    const off = (pf.index % 2 === 0 ? 0.14 : -0.05) * span
    const l = Math.max(pf.leftX + 6, Math.min(pf.leftX + (span - len) / 2 + off, pf.rightX - len - 6))
    pf.barL = l; pf.barR = l + len
  }
  const { routes, eMap, xMap, idMap } = buildRoutes(lines, platforms, reach)
  return {
    preset, name, type, sides, vw: VW, vh: VH, lines, platforms, sidings, routes,
    entry: (l, p) => eMap.get(`${l}:${p}`),
    exit: (l, p) => xMap.get(`${l}:${p}`),
    byId: (id) => idMap.get(id)
  }
}

function corridorSidings(): SidingDef[] {
  return [
    { index: 1, y: 770, leftX: PL + 120, rightX: PR - 180, centerX: (PL + 120 + PR - 180) / 2 },
    { index: 2, y: 816, leftX: PL + 180, rightX: PR - 120, centerX: (PL + 180 + PR - 120) / 2 }
  ]
}

// ---- corridor station types (selectable per station) ----
export type CorridorKind = 'DURCHGANG' | 'KNOTEN' | 'ABZWEIG' | 'GROSS' | 'VORORT' | 'GUETERBF'
const KIND_CONF: Record<CorridorKind, { p: number, classes: PlatformClass[] }> = {
  DURCHGANG: { p: 5, classes: ['LANG', 'LANG', 'LANG', 'KURZ', 'GUETER'] },
  KNOTEN:    { p: 6, classes: ['LANG', 'LANG', 'LANG', 'LANG', 'KURZ', 'GUETER'] },
  ABZWEIG:   { p: 6, classes: ['LANG', 'LANG', 'LANG', 'LANG', 'KURZ', 'GUETER'] },
  GROSS:     { p: 8, classes: ['LANG', 'LANG', 'LANG', 'LANG', 'LANG', 'KURZ', 'KURZ', 'GUETER'] },
  VORORT:    { p: 3, classes: ['LANG', 'LANG', 'KURZ'] },
  GUETERBF:  { p: 5, classes: ['LANG', 'KURZ', 'LANG', 'GUETER', 'GUETER'] },
}
export const CORRIDOR_KIND_LABEL: Record<string, string> = {
  DURCHGANG: 'Durchgang', KNOTEN: 'Knoten', ABZWEIG: 'Abzweig', GROSS: 'Großbf', KOPF: 'Kopfbahnhof',
  VORORT: 'Vorortbf', GUETERBF: 'Güterbf'
}

// Non-uniform platform Y positions — creates natural clusters instead of ruler-grid
const KIND_PLAT_Y: Partial<Record<CorridorKind, number[]>> = {
  DURCHGANG: [165, 272, 425, 562, 658],
  KNOTEN:    [158, 262, 383, 502, 614, 682],
  ABZWEIG:   [160, 265, 388, 508, 616, 685],
}
// Per-platform X stagger — subtle offset so platform ends don't all line up perfectly
const KIND_PLAT_X: Partial<Record<CorridorKind, Array<{ l: number, r: number }>>> = {
  DURCHGANG: [{ l: 578, r: 1022 }, { l: 563, r: 1007 }, { l: 586, r: 1032 }, { l: 592, r: 1016 }, { l: 558, r: 988 }],
  KNOTEN:    [{ l: 578, r: 1022 }, { l: 566, r: 1010 }, { l: 584, r: 1030 }, { l: 572, r: 1018 }, { l: 596, r: 1024 }, { l: 554, r: 986 }],
  ABZWEIG:   [{ l: 576, r: 1024 }, { l: 562, r: 1008 }, { l: 588, r: 1034 }, { l: 574, r: 1016 }, { l: 598, r: 1022 }, { l: 552, r: 984 }],
}

export function buildCorridorStation(name: string, kind: CorridorKind, wCount: number, eCount: number): Layout {
  const conf = KIND_CONF[kind]
  const lines: LineDef[] = []
  const platforms: PlatformDef[] = []

  // --- GUETERBF: two-sector layout (passenger top + freight bypass bottom) ---
  // Inspired by Duisburg Gbf / Maschen: dedicated bypass tracks run alongside the passenger hall.
  // Freight trains on GUETER tracks auto-dispatch (handled in engine).
  if (kind === 'GUETERBF') {
    const passW = Math.max(1, Math.floor(wCount / 2)), frtW = wCount - passW
    const passE = Math.max(1, Math.floor(eCount / 2)), frtE = eCount - passE
    for (let i = 0; i < passW; i++) { const y = spread(passW, 178, 428, i); lines.push(mkLine(`W${i + 1}`, 'W', `Gl ${i + 1}`, i, y, y)) }
    for (let i = 0; i < frtW; i++) { const y = spread(frtW, 558, 650, i); lines.push(mkLine(`W${passW + i + 1}`, 'W', `Gü ${i + 1}`, passW + i, y, y)) }
    for (let j = 0; j < passE; j++) { const y = spread(passE, 178, 428, j); lines.push(mkLine(`E${j + 1}`, 'E', `Gl ${j + 1}`, j, y, y)) }
    for (let j = 0; j < frtE; j++) { const y = spread(frtE, 558, 650, j); lines.push(mkLine(`E${passE + j + 1}`, 'E', `Gü ${j + 1}`, passE + j, y, y)) }
    // passenger sector
    const pYs = [178, 308, 428]
    const pXs = [{ l: 596, r: 1004 }, { l: 610, r: 990 }, { l: 584, r: 1016 }]
    for (let k = 0; k < 3; k++) { const px = pXs[k]!; platforms.push({ index: k + 1, y: pYs[k]!, leftX: px.l, rightX: px.r, centerX: (px.l + px.r) / 2, cls: conf.classes[k]!, openL: true, openR: true }) }
    // freight bypass (much wider — nearly straight-through)
    platforms.push({ index: 4, y: 558, leftX: 438, rightX: 1162, centerX: 800, cls: 'GUETER', openL: true, openR: true })
    platforms.push({ index: 5, y: 652, leftX: 428, rightX: 1172, centerX: 800, cls: 'GUETER', openL: true, openR: true })
    const reach = (l: LineDef, p: PlatformDef) => (l.y >= 490) === (p.cls === 'GUETER')
    return finish('KNOTEN', name, 'THROUGH', ['W', 'E'], lines, platforms, reach, corridorSidings())
  }

  // --- VORORT: compact suburban through-station ---
  // Inspired by Reutlingen Hbf / Darmstadt Hbf (small): tight platform cluster,
  // fewer tracks, narrower platform zone.
  if (kind === 'VORORT') {
    for (let i = 0; i < wCount; i++) { const y = spread(wCount, 318, 564, i); lines.push(mkLine(`W${i + 1}`, 'W', `Gl ${i + 1}`, i, y, y)) }
    for (let j = 0; j < eCount; j++) { const y = spread(eCount, 318, 564, j); lines.push(mkLine(`E${j + 1}`, 'E', `Gl ${j + 1}`, j, y, y)) }
    platforms.push({ index: 1, y: 322, leftX: 648, rightX: 972, centerX: 810, cls: 'LANG', openL: true, openR: true })
    platforms.push({ index: 2, y: 456, leftX: 655, rightX: 966, centerX: 810, cls: 'LANG', openL: true, openR: true })
    platforms.push({ index: 3, y: 563, leftX: 670, rightX: 952, centerX: 811, cls: 'KURZ', openL: true, openR: true })
    const reach = (l: LineDef, p: PlatformDef) => {
      const n = l.side === 'W' ? wCount : eCount
      return Math.abs(norm(n, l.index) - norm(3, p.index - 1)) <= 0.75
    }
    return finish('KNOTEN', name, 'THROUGH', ['W', 'E'], lines, platforms, reach, corridorSidings())
  }

  // --- Standard kinds: DURCHGANG / KNOTEN / ABZWEIG / GROSS ---
  // West lines: uniform spread
  for (let i = 0; i < wCount; i++) {
    const y = spread(wCount, LINE_TOP, LINE_BOT, i)
    lines.push(mkLine(`W${i + 1}`, 'W', `West ${i + 1}`, i, y, y))
  }
  // East lines: ABZWEIG gets a dramatic branch fan-out (upper tracks converge from above,
  // lower tracks from below) — inspired by Würzburg Hbf / Mannheim Hbf Y-junction geometry.
  for (let j = 0; j < eCount; j++) {
    const y = spread(eCount, LINE_TOP, LINE_BOT, j)
    if (kind === 'ABZWEIG') {
      const nj = norm(eCount, j)
      const fan = nj < 0.5 ? -118 : 118
      const edgeY = Math.max(15, Math.min(VH - 15, y + fan))
      lines.push(mkLine(`E${j + 1}`, 'E', `Ast ${j + 1}`, j, y, edgeY))
    } else {
      lines.push(mkLine(`E${j + 1}`, 'E', `Ost ${j + 1}`, j, y, y))
    }
  }

  // Platforms with custom Y (non-uniform) and per-platform X stagger
  const platYs = KIND_PLAT_Y[kind]
  const platXs = KIND_PLAT_X[kind]
  for (let k = 0; k < conf.p; k++) {
    const y = platYs ? (platYs[k] ?? spread(conf.p, PLAT_TOP, PLAT_BOT, k)) : spread(conf.p, PLAT_TOP, PLAT_BOT, k)
    const px = platXs?.[k]
    const lx = px?.l ?? PL, rx = px?.r ?? PR
    platforms.push({ index: k + 1, y, leftX: lx, rightX: rx, centerX: (lx + rx) / 2, cls: conf.classes[k] ?? 'LANG', openL: true, openR: true })
  }

  const reach = (l: LineDef, pf: PlatformDef) => {
    const n = l.side === 'W' ? wCount : eCount
    const tp = norm(n, l.index), pp = norm(conf.p, pf.index - 1)
    if (kind === 'DURCHGANG') return Math.abs(tp - pp) <= 0.95
    if (kind === 'ABZWEIG') return tp < 0.5 ? pp <= 0.6 : pp >= 0.4
    return Math.abs(tp - pp) <= 0.5
  }
  return finish('KNOTEN', name, 'THROUGH', ['W', 'E'], lines, platforms, reach, corridorSidings())
}

export function buildCorridorTerminus(name: string, linkSide: Side, linkCount: number): Layout {
  const classes: PlatformClass[] = ['LANG', 'LANG', 'LANG', 'LANG', 'KURZ', 'GUETER']
  const p = classes.length
  const lines: LineDef[] = []
  for (let i = 0; i < linkCount; i++) { const y = spread(linkCount, LINE_TOP, LINE_BOT, i); lines.push(mkLine(`${linkSide}${i + 1}`, linkSide, `Gleis ${i + 1}`, i, y, y)) }
  const platforms: PlatformDef[] = []
  for (let k = 0; k < p; k++) platforms.push({ index: k + 1, y: spread(p, PLAT_TOP, PLAT_BOT, k), leftX: PL, rightX: PR, centerX: CENTER, cls: classes[k] ?? 'LANG', openL: linkSide === 'W', openR: linkSide === 'E' })
  const reach = (l: LineDef, pf: PlatformDef) => Math.abs(norm(linkCount, l.index) - norm(p, pf.index - 1)) <= 0.6
  return finish('KNOTEN', name, 'TERMINUS', [linkSide], lines, platforms, reach, corridorSidings())
}

// Build a through-station layout with explicit side line counts — used by the
// network/corridor (e.g. 2 portal tracks on one side, 4 link tracks on the other).
export function buildThrough(name: string, w: number, e: number, p: number, window: number, classes: PlatformClass[]): Layout {
  const lines: LineDef[] = []
  for (let i = 0; i < w; i++) { const y = spread(w, LINE_TOP, LINE_BOT, i); lines.push(mkLine(`W${i + 1}`, 'W', `West ${i + 1}`, i, y, y)) }
  for (let j = 0; j < e; j++) { const y = spread(e, LINE_TOP, LINE_BOT, j); lines.push(mkLine(`E${j + 1}`, 'E', `Ost ${j + 1}`, j, y, y)) }
  const platforms: PlatformDef[] = []
  for (let k = 0; k < p; k++) platforms.push({ index: k + 1, y: spread(p, PLAT_TOP, PLAT_BOT, k), leftX: PL, rightX: PR, centerX: CENTER, cls: classes[k] ?? 'LANG', openL: true, openR: true })
  const reach = (l: LineDef, pf: PlatformDef) => { const n = l.side === 'W' ? w : e; return Math.abs(norm(n, l.index) - norm(p, pf.index - 1)) <= window }
  return finish('KNOTEN', name, 'THROUGH', ['W', 'E'], lines, platforms, reach)
}
