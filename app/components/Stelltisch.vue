<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { TRAIN_KINDS, type GameSnapshot, type TrainView } from '../../shared/game'
import { PLATFORM_CLASS_META, generateLayout, type Layout, type Pt } from '../../shared/layout'

const props = defineProps<{ snap: GameSnapshot }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let raf = 0

const layout = computed<Layout>(() => generateLayout(props.snap.preset))

function alongPoly(poly: Pt[], t: number): Pt {
  let total = 0
  const segLen: number[] = []
  for (let i = 0; i < poly.length - 1; i++) { const d = Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y); segLen.push(d); total += d }
  let target = Math.min(0.999, Math.max(0, t)) * total
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i]!) { const f = segLen[i]! ? target / segLen[i]! : 0; return { x: poly[i]!.x + (poly[i + 1]!.x - poly[i]!.x) * f, y: poly[i]!.y + (poly[i + 1]!.y - poly[i]!.y) * f } }
    target -= segLen[i]!
  }
  return poly[poly.length - 1]!
}

function draw() {
  const cv = canvas.value
  if (!cv) { raf = requestAnimationFrame(draw); return }
  const snap = props.snap
  const L = layout.value
  const ctx = cv.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  const cw = cv.clientWidth, ch = cv.clientHeight
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr) }
  const scale = Math.min((cw * dpr) / L.vw, (ch * dpr) / L.vh)
  ctx.setTransform(scale, 0, 0, scale, ((cw * dpr) - L.vw * scale) / 2, ((ch * dpr) - L.vh * scale) / 2)

  ctx.fillStyle = '#0c0f12'; ctx.fillRect(0, 0, L.vw, L.vh)

  const byTrain = (id: string | null) => id ? snap.trains.find(t => t.id === id) : undefined
  const routeOf = (t: TrainView) => t.routeId ? L.byId(t.routeId) : undefined

  // ---- base: harp (all entry diagonals faint) ----
  for (const r of L.routes) if (r.kind === 'entry') line(ctx, r.diag[0], r.diag[1], '#283038', 2)

  // ---- base: line stubs (double track) ----
  for (const ln of L.lines) {
    line(ctx, { x: ln.edgeX, y: ln.arrY }, { x: ln.stubX, y: ln.arrY }, '#5a636e', 5)
    line(ctx, { x: ln.edgeX, y: ln.depY }, { x: ln.stubX, y: ln.depY }, '#5a636e', 5)
    // small switch diamonds where stubs meet throat
    diamond(ctx, { x: ln.stubX, y: ln.y }, 5, '#7a8590')
    const lx = ln.side === 'W' ? ln.edgeX + 6 : ln.edgeX - 6
    text(ctx, ln.label.toUpperCase(), lx, ln.y - 22, '#6b7682', 20, ln.side === 'W' ? 'left' : 'right')
  }

  // ---- base: platforms ----
  for (const pf of L.platforms) {
    line(ctx, { x: pf.leftX, y: pf.y }, { x: pf.rightX, y: pf.y }, '#5a636e', 6)
    if (snap.platformDisabled[pf.index - 1]) hatch(ctx, pf.leftX, pf.rightX, pf.y)
    text(ctx, `Gl ${pf.index}`, pf.leftX - 14, pf.y - 9, '#8b97a3', 22, 'right')
    const m = PLATFORM_CLASS_META[pf.cls]
    text(ctx, m.tag, pf.leftX - 14, pf.y + 11, m.color, 16, 'right')
  }

  // ---- reserved (vorgemerkte) routes: dashed amber ----
  ctx.setLineDash([10, 8])
  for (const t of snap.trains) {
    if (!t.resvKind) continue
    const r = t.resvKind === 'entry' ? (t.resvPlatform != null ? L.entry(t.entryLine, t.resvPlatform) : undefined)
      : (t.platform != null ? L.exit(t.exitLine, t.platform) : undefined)
    if (!r) continue
    for (let i = 0; i < r.poly.length - 1; i++) line(ctx, r.poly[i]!, r.poly[i + 1]!, '#ffb020', 3)
  }
  ctx.setLineDash([])

  // ---- lit active routes ----
  for (const t of snap.trains) {
    if (t.state !== 'ENTERING' && t.state !== 'EXITING' && t.state !== 'STUCK') continue
    const r = routeOf(t); if (!r) continue
    const col = t.state === 'STUCK' ? '#ff3b30' : '#f4f7fa'
    for (let i = 0; i < r.poly.length - 1; i++) line(ctx, r.poly[i]!, r.poly[i + 1]!, col, 7)
  }

  // ---- platform occupancy ----
  for (const pf of L.platforms) {
    const occ = byTrain(snap.platforms[pf.index - 1] ?? null)
    if (occ && (occ.state === 'DWELL' || occ.state === 'READY_DEPART' || occ.state === 'STUCK')) {
      const ready = occ.state === 'READY_DEPART'
      const color = occ.state === 'STUCK' ? '#ff3b30' : ready ? '#ffb020' : '#ff3b30'
      line(ctx, { x: pf.leftX + 14, y: pf.y }, { x: pf.rightX - 14, y: pf.y }, color, 16)
      labelTrain(ctx, occ, pf.centerX, pf.y - 20, ready)
      if (occ.dwellLeft > 0 && occ.state === 'DWELL') text(ctx, `${occ.dwellLeft}s`, pf.centerX, pf.y + 28, '#8b97a3', 20, 'center')
      if (occ.connectionId) text(ctx, '🔗', pf.rightX - 4, pf.y - 2, occ.connectionMet ? '#34d058' : '#ffd23b', 20, 'center')
    }
  }

  // ---- waiting trains on arrival tracks ----
  for (const t of snap.trains) {
    if (t.state !== 'APPROACH') continue
    const ln = L.lines.find(l => l.id === t.entryLine); if (!ln) continue
    const x = ln.side === 'W' ? ln.edgeX + 40 : ln.edgeX - 40
    line(ctx, { x: ln.edgeX, y: ln.arrY }, { x: ln.stubX, y: ln.arrY }, '#ff3b30', 5)
    marker(ctx, { x, y: ln.arrY }, t, false)
  }

  // ---- moving trains ----
  for (const t of snap.trains) {
    if (t.state !== 'ENTERING' && t.state !== 'EXITING' && t.state !== 'STUCK') continue
    const r = routeOf(t); if (!r) continue
    marker(ctx, alongPoly(r.poly, t.progress), t, t.state === 'STUCK')
  }

  // ---- signals at line ends ----
  for (const ln of L.lines) {
    const c = signalColor(snap, ln.id)
    signal(ctx, { x: ln.side === 'W' ? ln.edgeX + 22 : ln.edgeX - 22, y: ln.arrY }, c, L.vw)
  }

  // ---- side fault overlay ----
  for (const side of ['W', 'E'] as const) {
    if (!snap.sideDisabled[side]) continue
    const x = side === 'W' ? (W_THROAT_X) : (E_THROAT_X)
    ctx.fillStyle = 'rgba(255,59,48,0.10)'; ctx.fillRect(side === 'W' ? 360 : 1040, 80, 200, L.vh - 160)
    text(ctx, 'KOPF GESTÖRT', x, 70, '#ff3b30', 22, 'center')
  }

  raf = requestAnimationFrame(draw)
}
const W_THROAT_X = 460, E_THROAT_X = 1140

function signalColor(snap: GameSnapshot, lineId: string): 'r' | 'g' | 'off' {
  const t = snap.trains.find(x => (x.state === 'ENTERING' && x.entryLine === lineId) || (x.state === 'EXITING' && x.exitLine === lineId))
  if (t) return 'g'
  if (snap.trains.some(x => x.state === 'APPROACH' && x.entryLine === lineId)) return 'r'
  return 'off'
}

// ---- primitives ----
function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, w: number) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
}
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color; ctx.font = `700 ${size}px ui-monospace, monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y)
}
function labelTrain(ctx: CanvasRenderingContext2D, t: TrainView, x: number, y: number, ready: boolean) {
  const meta = TRAIN_KINDS[t.kind]
  ctx.font = '700 22px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const w = ctx.measureText(t.number).width + 26
  ctx.fillStyle = '#0c0f12'; ctx.fillRect(x - w / 2, y - 16, w, 32)
  ctx.strokeStyle = meta.color; ctx.lineWidth = 2; ctx.strokeRect(x - w / 2, y - 16, w, 32)
  ctx.fillStyle = meta.color; ctx.fillRect(x - w / 2, y - 16, 6, 32)
  ctx.fillStyle = ready ? '#ffb020' : '#e7edf2'; ctx.fillText(t.number, x + 3, y)
  text(ctx, `→${t.exitLine}`, x + w / 2 + 22, y, '#8b97a3', 16, 'center')
}
function marker(ctx: CanvasRenderingContext2D, p: Pt, t: TrainView, stuck: boolean) {
  ctx.fillStyle = stuck ? '#ff3b30' : TRAIN_KINDS[t.kind].color
  ctx.fillRect(p.x - 15, p.y - 8, 30, 16)
  ctx.fillStyle = '#0c0f12'; ctx.font = '700 13px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(stuck ? 'HALT' : (t.number.split(' ')[1] ?? t.number), p.x, p.y)
}
function signal(ctx: CanvasRenderingContext2D, p: Pt, c: 'r' | 'g' | 'off', vw: number) {
  ctx.fillStyle = '#000'; ctx.fillRect(p.x - 7, p.y - 7, 14, 14)
  ctx.fillStyle = c === 'g' ? '#34d058' : c === 'r' ? '#ff3b30' : '#2a2f36'
  ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill()
}
function diamond(ctx: CanvasRenderingContext2D, p: Pt, r: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill()
}
function hatch(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number) {
  ctx.save(); ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 4
  for (let x = x0; x < x1; x += 22) { ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 11, y + 11); ctx.stroke() }
  ctx.restore()
}

onMounted(() => { raf = requestAnimationFrame(draw) })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <canvas ref="canvas" class="stelltisch" />
</template>

<style scoped>
.stelltisch { display: block; width: 100%; height: 100%; }
</style>
