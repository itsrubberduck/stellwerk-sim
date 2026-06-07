<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TRAIN_KINDS, type StationView, type TrainView } from '../../shared/game'
import { PLATFORM_CLASS_META, type Layout, type Pt } from '../../shared/layout'

const props = defineProps<{
  layout: Layout
  station: StationView
  trains: TrainView[]
  interactive?: boolean
  selId?: string | null
  hoverId?: string | null
  compact?: boolean
}>()
const emit = defineEmits<{ (e: 'trainClick', p: { id: string, x: number, y: number }): void, (e: 'trainHover', id: string | null): void, (e: 'bg'): void }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let raf = 0
let tf = { scale: 1, offX: 0, offY: 0, dpr: 1 }

function alongPoly(poly: Pt[], t: number): Pt {
  let total = 0; const seg: number[] = []
  for (let i = 0; i < poly.length - 1; i++) { const d = Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y); seg.push(d); total += d }
  let tg = Math.min(0.999, Math.max(0, t)) * total
  for (let i = 0; i < seg.length; i++) { if (tg <= seg[i]!) { const f = seg[i]! ? tg / seg[i]! : 0; return { x: poly[i]!.x + (poly[i + 1]!.x - poly[i]!.x) * f, y: poly[i]!.y + (poly[i + 1]!.y - poly[i]!.y) * f } } tg -= seg[i]! }
  return poly[poly.length - 1]!
}
function parkPoly(pf: { centerX: number, y: number }, sd: { centerX: number, y: number }): Pt[] { return [{ x: pf.centerX, y: pf.y }, { x: sd.centerX, y: (pf.y + sd.y) / 2 }, { x: sd.centerX, y: sd.y }] }
function trainPos(t: TrainView): Pt | null {
  const L = props.layout
  if (t.state === 'APPROACH') { const ln = L.lines.find(l => l.id === t.arrLine); if (!ln) return null; return { x: ln.side === 'W' ? ln.edgeX + 42 : ln.edgeX - 42, y: ln.arrY } }
  if (t.state === 'ENTERING' || t.state === 'EXITING' || t.state === 'STUCK') { const r = t.routeId ? L.byId(t.routeId) : undefined; if (r) return alongPoly(r.poly, t.progress) }
  if (t.state === 'PARKED' && t.sidingIndex != null) { const sd = L.sidings[t.sidingIndex - 1]; if (sd) return { x: sd.centerX, y: sd.y } }
  if ((t.state === 'PARKING' || t.state === 'RETRIEVING') && t.platform != null && t.sidingIndex != null) {
    const pf = L.platforms[t.platform - 1], sd = L.sidings[t.sidingIndex - 1]
    if (pf && sd) { const poly = parkPoly(pf, sd); return alongPoly(t.state === 'PARKING' ? poly : [...poly].reverse(), t.progress) }
  }
  if (t.platform != null) { const pf = L.platforms[t.platform - 1]; if (pf) return { x: pf.centerX, y: pf.y } }
  return null
}

function draw() {
  const cv = canvas.value; if (!cv) { raf = requestAnimationFrame(draw); return }
  const L = props.layout, snap = props.station
  const ctx = cv.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  const cw = cv.clientWidth, ch = cv.clientHeight
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr) }
  const scale = Math.min((cw * dpr) / L.vw, (ch * dpr) / L.vh)
  const offX = ((cw * dpr) - L.vw * scale) / 2, offY = ((ch * dpr) - L.vh * scale) / 2
  tf = { scale, offX, offY, dpr }
  ctx.setTransform(scale, 0, 0, scale, offX, offY)
  ctx.fillStyle = '#0c0f12'; ctx.fillRect(0, 0, L.vw, L.vh)

  const inStation = props.trains
  const byId = (id: string | null) => id ? inStation.find(t => t.id === id) : undefined

  // base harp (entry diagonals)
  for (const r of L.routes) if (r.kind === 'entry') line(ctx, r.diag[0], r.diag[1], '#222a32', 2)
  // line stubs
  for (const ln of L.lines) {
    line(ctx, { x: ln.edgeX, y: ln.edgeY - 9 }, { x: ln.stubX, y: ln.arrY }, '#5a636e', 5)
    line(ctx, { x: ln.edgeX, y: ln.edgeY + 9 }, { x: ln.stubX, y: ln.depY }, '#5a636e', 5)
    diamond(ctx, { x: ln.stubX, y: ln.y }, 5, '#7a8590')
    if (!props.compact) text(ctx, ln.label.toUpperCase(), ln.side === 'W' ? ln.edgeX + 6 : ln.edgeX - 6, ln.edgeY - 22, '#6b7682', 18, ln.side === 'W' ? 'left' : 'right')
  }
  // platforms: thin running line (full span) + thicker platform edge (variable length)
  for (const pf of L.platforms) {
    line(ctx, { x: pf.leftX, y: pf.y }, { x: pf.rightX, y: pf.y }, '#3c454e', 3)
    const bl = pf.barL ?? pf.leftX, br = pf.barR ?? pf.rightX
    line(ctx, { x: bl, y: pf.y }, { x: br, y: pf.y }, '#6b7682', 8)
    if (snap.platformDisabled[pf.index - 1]) hatch(ctx, bl, br, pf.y)
    text(ctx, `Gl ${pf.index}`, pf.leftX - 14, pf.y - 9, '#8b97a3', 21, 'right')
    const m = PLATFORM_CLASS_META[pf.cls]; text(ctx, m.tag, pf.leftX - 14, pf.y + 11, m.color, 15, 'right')
  }

  // sidings (Abstellgleise)
  for (const sd of L.sidings) {
    line(ctx, { x: sd.leftX, y: sd.y }, { x: sd.rightX, y: sd.y }, '#4a5560', 6)
    buffer(ctx, sd.rightX, sd.y); buffer(ctx, sd.leftX, sd.y)
    text(ctx, `Abst ${sd.index}`, sd.leftX - 12, sd.y, '#6b7682', 15, 'right')
    const occ = inStation.find(t => t.sidingIndex === sd.index && t.state === 'PARKED')
    if (occ) line(ctx, { x: sd.leftX + 12, y: sd.y }, { x: sd.rightX - 12, y: sd.y }, '#7a6cff', 14)
  }

  // planned (soll/ist) route for hovered/selected train (cyan)
  const hi = byId(props.selId ?? null) ?? byId(props.hoverId ?? null)
  if (hi) {
    ctx.setLineDash([4, 6])
    const er = L.entry(hi.arrLine, hi.sollPlatform); if (er) for (let i = 0; i < er.poly.length - 1; i++) line(ctx, er.poly[i]!, er.poly[i + 1]!, '#36d6ff', 3)
    const xr = hi.sollExitLine ? L.exit(hi.sollExitLine, hi.sollPlatform) : undefined; if (xr) for (let i = 0; i < xr.poly.length - 1; i++) line(ctx, xr.poly[i]!, xr.poly[i + 1]!, '#36d6ff', 3)
    ctx.setLineDash([])
  }

  // reserved (vorgemerkt) dashed amber
  ctx.setLineDash([10, 8])
  for (const t of inStation) {
    if (!t.resvKind) continue
    const r = t.resvKind === 'entry' ? (t.resvPlatform != null ? L.entry(t.arrLine, t.resvPlatform) : undefined)
      : (t.resvExitLine && t.platform != null ? L.exit(t.resvExitLine, t.platform) : undefined)
    if (r) for (let i = 0; i < r.poly.length - 1; i++) line(ctx, r.poly[i]!, r.poly[i + 1]!, '#ffb020', 3)
  }
  ctx.setLineDash([])

  // active lit routes
  for (const t of inStation) {
    if (t.state !== 'ENTERING' && t.state !== 'EXITING' && t.state !== 'STUCK') continue
    const r = t.routeId ? L.byId(t.routeId) : undefined; if (!r) continue
    const col = t.state === 'STUCK' ? '#ff3b30' : '#f4f7fa'
    for (let i = 0; i < r.poly.length - 1; i++) line(ctx, r.poly[i]!, r.poly[i + 1]!, col, 7)
  }

  // park / retrieve moves (dotted violet)
  ctx.setLineDash([4, 6])
  for (const t of inStation) {
    if ((t.state !== 'PARKING' && t.state !== 'RETRIEVING') || t.platform == null || t.sidingIndex == null) continue
    const pf = L.platforms[t.platform - 1], sd = L.sidings[t.sidingIndex - 1]; if (!pf || !sd) continue
    const poly = parkPoly(pf, sd); for (let i = 0; i < poly.length - 1; i++) line(ctx, poly[i]!, poly[i + 1]!, '#7a6cff', 3)
  }
  ctx.setLineDash([])

  // platform occupancy (within the platform edge)
  for (const pf of L.platforms) {
    const occ = inStation.find(t => t.platform === pf.index && (t.state === 'DWELL' || t.state === 'READY_DEPART' || t.state === 'STUCK'))
    if (!occ) continue
    const ready = occ.state === 'READY_DEPART'
    const color = occ.state === 'STUCK' ? '#ff3b30' : ready ? '#ffb020' : '#ff3b30'
    const bl = pf.barL ?? pf.leftX, br = pf.barR ?? pf.rightX
    line(ctx, { x: bl + 6, y: pf.y }, { x: br - 6, y: pf.y }, color, 16)
  }

  // train markers + labels
  for (const t of inStation) {
    const p = trainPos(t); if (!p) continue
    const sel = t.id === props.selId || t.id === props.hoverId
    marker(ctx, p, t, sel)
  }

  raf = requestAnimationFrame(draw)
}

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, c: string, w: number) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, c: string, sz: number, al: CanvasTextAlign = 'left') { ctx.fillStyle = c; ctx.font = `700 ${sz}px ui-monospace, monospace`; ctx.textAlign = al; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y) }
function diamond(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill() }
function hatch(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number) { ctx.save(); ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 4; for (let x = x0; x < x1; x += 22) { ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 11, y + 11); ctx.stroke() } ctx.restore() }
function marker(ctx: CanvasRenderingContext2D, p: Pt, t: TrainView, sel: boolean) {
  const meta = TRAIN_KINDS[t.kind]
  const w = props.compact ? 24 : 34, h = props.compact ? 12 : 18
  if (sel) { ctx.strokeStyle = '#36d6ff'; ctx.lineWidth = 3; ctx.strokeRect(p.x - w / 2 - 3, p.y - h / 2 - 3, w + 6, h + 6) }
  ctx.fillStyle = t.state === 'STUCK' ? '#ff3b30' : meta.color
  ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h)
  ctx.fillStyle = '#0c0f12'; ctx.font = `700 ${props.compact ? 11 : 13}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(t.state === 'STUCK' ? 'HALT' : (t.number.split(' ')[1] ?? t.number), p.x, p.y)
  if (!props.compact && (t.state === 'DWELL' || t.state === 'READY_DEPART')) text(ctx, t.number, p.x, p.y - h, t.dwellLeft > 0 ? '#8b97a3' : '#ffb020', 16, 'center')
}

function toVirtual(ev: PointerEvent): Pt {
  const cv = canvas.value!; const rect = cv.getBoundingClientRect()
  return { x: ((ev.clientX - rect.left) * tf.dpr - tf.offX) / tf.scale, y: ((ev.clientY - rect.top) * tf.dpr - tf.offY) / tf.scale }
}
function pick(ev: PointerEvent): TrainView | null {
  const v = toVirtual(ev); let best: TrainView | null = null, bd = 46 * 46
  for (const t of props.trains) { const p = trainPos(t); if (!p) continue; const d = (p.x - v.x) ** 2 + (p.y - v.y) ** 2; if (d < bd) { bd = d; best = t } }
  return best
}
function onClick(ev: PointerEvent) { if (!props.interactive) return; const t = pick(ev); if (t) emit('trainClick', { id: t.id, x: ev.clientX, y: ev.clientY }); else emit('bg') }
function onMove(ev: PointerEvent) { if (!props.interactive) return; const t = pick(ev); emit('trainHover', t?.id ?? null) }

onMounted(() => { raf = requestAnimationFrame(draw) })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <canvas ref="canvas" class="stcanvas" :class="{ interactive }" @pointerdown="onClick" @pointermove="onMove" @pointerleave="emit('trainHover', null)" />
</template>

<style scoped>
.stcanvas { display: block; width: 100%; height: 100%; }
.stcanvas.interactive { cursor: pointer; }
</style>
