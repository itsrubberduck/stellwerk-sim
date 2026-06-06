<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { TRAIN_KINDS, sideOf, type GameSnapshot, type SectorId, type TrainView } from '../../shared/game'

const props = defineProps<{ snap: GameSnapshot }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let raf = 0

// virtual coordinate system
const VW = 1600, VH = 900
const PY = [250, 395, 540, 685]
const XPL = 605, XPR = 995
const Wn: P = { x: 420, y: 467 }
const En: P = { x: 1180, y: 467 }
const ENDS: Record<SectorId, P> = {
  NW: { x: 70, y: 150 }, SW: { x: 70, y: 790 },
  NE: { x: 1530, y: 150 }, SE: { x: 1530, y: 790 }
}

interface P { x: number, y: number }
const platLeft = (p: number): P => ({ x: XPL, y: PY[p - 1]! })
const platRight = (p: number): P => ({ x: XPR, y: PY[p - 1]! })

function lerp(a: P, b: P, t: number): P { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
function alongPath(pts: P[], t: number): P {
  if (pts.length < 2) return pts[0]!
  const segs = pts.length - 1
  const ft = Math.min(0.999, Math.max(0, t)) * segs
  const i = Math.floor(ft)
  return lerp(pts[i]!, pts[i + 1]!, ft - i)
}

// path a train traverses, depending on state/direction
function enterPath(t: TrainView): P[] {
  const side = sideOf(t.entryLine)
  const thr = side === 'W' ? Wn : En
  const pl = side === 'W' ? platLeft(t.platform!) : platRight(t.platform!)
  return [ENDS[t.entryLine], thr, pl]
}
function exitPath(t: TrainView): P[] {
  const side = sideOf(t.exitLine)
  const thr = side === 'W' ? Wn : En
  const pl = side === 'W' ? platLeft(t.platform!) : platRight(t.platform!)
  return [pl, thr, ENDS[t.exitLine]]
}

function draw() {
  const cv = canvas.value
  const snap = props.snap
  if (!cv) { raf = requestAnimationFrame(draw); return }
  const ctx = cv.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  const cw = cv.clientWidth, ch = cv.clientHeight
  if (cv.width !== cw * dpr || cv.height !== ch * dpr) { cv.width = cw * dpr; cv.height = ch * dpr }
  const scale = Math.min((cw * dpr) / VW, (ch * dpr) / VH)
  const offx = ((cw * dpr) - VW * scale) / 2
  const offy = ((ch * dpr) - VH * scale) / 2
  ctx.setTransform(scale, 0, 0, scale, offx, offy)

  // panel
  ctx.fillStyle = '#0c0f12'
  ctx.fillRect(0, 0, VW, VH)
  ctx.fillStyle = '#10151a'
  ctx.fillRect(20, 20, VW - 40, VH - 40)

  const byId = (id: string | null) => id ? snap.trains.find(t => t.id === id) : undefined

  // ---- base tracks ----
  const baseLine = (a: P, b: P) => seg(ctx, a, b, '#5a636e', 7)
  for (let p = 1; p <= 4; p++) {
    baseLine(platLeft(p), platRight(p)) // platform
    baseLine(Wn, platLeft(p))
    baseLine(En, platRight(p))
  }
  baseLine(Wn, ENDS.NW); baseLine(Wn, ENDS.SW)
  baseLine(En, ENDS.NE); baseLine(En, ENDS.SE)

  // ---- lit routes (head locked) ----
  for (const side of ['W', 'E'] as const) {
    const head = snap.heads[side]
    const t = byId(head.lockedBy)
    if (!t) continue
    const stuck = t.state === 'STUCK'
    const col = stuck ? '#ff3b30' : '#f2f5f7'
    let path: P[] | null = null
    if ((t.state === 'ENTERING' || (stuck && sideOf(t.entryLine) === side && (t.platform != null))) && sideOf(t.entryLine) === side)
      path = enterPath(t)
    else if (t.state === 'EXITING' && sideOf(t.exitLine) === side)
      path = exitPath(t)
    else if (stuck) path = sideOf(t.exitLine) === side ? exitPath(t) : enterPath(t)
    if (path) for (let i = 0; i < path.length - 1; i++) seg(ctx, path[i]!, path[i + 1]!, col, 9)
  }

  // ---- platform occupancy ----
  for (let p = 1; p <= 4; p++) {
    const occ = byId(snap.platforms[p - 1] ?? null)
    const disabled = snap.platformDisabled[p - 1]
    const a = platLeft(p), b = platRight(p)
    if (disabled) hatch(ctx, a, b)
    if (occ && (occ.state === 'DWELL' || occ.state === 'READY_DEPART' || occ.state === 'STUCK')) {
      const ready = occ.state === 'READY_DEPART'
      const color = occ.state === 'STUCK' ? '#ff3b30' : ready ? '#ffb020' : '#ff3b30'
      seg(ctx, { x: a.x + 12, y: a.y }, { x: b.x - 12, y: b.y }, color, 16)
      labelTrain(ctx, occ, (a.x + b.x) / 2, a.y - 22, ready)
      if (occ.connectionId) connMark(ctx, occ, b.x - 6, b.y)
      if (occ.dwellLeft > 0 && occ.state === 'DWELL')
        text(ctx, `${occ.dwellLeft}s`, (a.x + b.x) / 2, a.y + 30, '#8b97a3', 22, 'center')
    }
    // platform label
    text(ctx, `Gl ${p}`, a.x - 44, a.y + 8, '#6b7682', 24, 'center')
  }

  // ---- approach occupancy (waiting trains) ----
  for (const line of ['NW', 'SW', 'NE', 'SE'] as SectorId[]) {
    const t = byId(snap.approach[line])
    const end = ENDS[line]
    const thr = sideOf(line) === 'W' ? Wn : En
    const labelPos = lerp(end, thr, 0.22)
    if (t) {
      seg(ctx, end, lerp(end, thr, 0.55), '#ff3b30', 9)
      labelTrain(ctx, t, labelPos.x, labelPos.y - 26, false)
      if (t.connectionId) connMark(ctx, t, labelPos.x + 70, labelPos.y - 26)
    }
    // line label + signal
    text(ctx, line, end.x + (end.x < VW / 2 ? -2 : 2), end.y + (end.y < VH / 2 ? -26 : 44),
      '#6b7682', 26, end.x < VW / 2 ? 'left' : 'right')
    signal(ctx, end, signalColor(snap, line))
  }

  // ---- moving trains ----
  for (const t of snap.trains) {
    if (t.state === 'ENTERING') marker(ctx, alongPath(enterPath(t), t.progress), t, false)
    else if (t.state === 'EXITING') marker(ctx, alongPath(exitPath(t), t.progress), t, false)
    else if (t.state === 'STUCK') {
      const path = t.platform != null && t.progress < 1 && snap.heads[sideOf(t.entryLine)].lockedBy === t.id
        ? enterPath(t) : exitPath(t)
      marker(ctx, alongPath(path, t.progress), t, true)
    }
  }

  // ---- throats / head fault ----
  for (const side of ['W', 'E'] as const) {
    const n = side === 'W' ? Wn : En
    const head = snap.heads[side]
    ctx.fillStyle = head.disabled ? '#ff3b30' : '#7a8590'
    diamond(ctx, n, head.disabled ? 13 : 9)
    if (head.disabled) text(ctx, 'STÖRUNG', n.x, n.y + (side === 'W' ? -28 : 40), '#ff3b30', 22, 'center')
  }

  raf = requestAnimationFrame(draw)
}

function signalColor(snap: GameSnapshot, line: SectorId): 'r' | 'g' | 'off' {
  const t = snap.trains.find(x =>
    (x.state === 'ENTERING' && x.entryLine === line) ||
    (x.state === 'EXITING' && x.exitLine === line))
  if (t) return 'g'
  if (snap.approach[line]) return 'r'
  return 'off'
}

// ---- primitives ----
function seg(ctx: CanvasRenderingContext2D, a: P, b: P, color: string, w: number) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
}
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color; ctx.font = `700 ${size}px ui-monospace, monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
}
function labelTrain(ctx: CanvasRenderingContext2D, t: TrainView, x: number, y: number, ready: boolean) {
  const meta = TRAIN_KINDS[t.kind]
  ctx.font = '700 24px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const w = ctx.measureText(t.number).width + 28
  ctx.fillStyle = '#0c0f12'; ctx.fillRect(x - w / 2, y - 17, w, 34)
  ctx.strokeStyle = meta.color; ctx.lineWidth = 2; ctx.strokeRect(x - w / 2, y - 17, w, 34)
  ctx.fillStyle = '#0c0f12'; ctx.fillRect(x - w / 2, y - 17, 6, 34)
  ctx.fillStyle = meta.color; ctx.fillRect(x - w / 2, y - 17, 6, 34)
  ctx.fillStyle = ready ? '#ffb020' : '#e7edf2'
  ctx.fillText(t.number, x + 3, y)
  text(ctx, `→${t.exitLine}`, x + w / 2 + 24, y, '#8b97a3', 18, 'center')
}
function marker(ctx: CanvasRenderingContext2D, p: P, t: TrainView, stuck: boolean) {
  const meta = TRAIN_KINDS[t.kind]
  ctx.fillStyle = stuck ? '#ff3b30' : meta.color
  ctx.fillRect(p.x - 16, p.y - 9, 32, 18)
  ctx.fillStyle = '#0c0f12'
  ctx.font = '700 14px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const short = t.number.split(' ')[1] ?? t.number
  ctx.fillText(stuck ? 'HALT' : short, p.x, p.y)
}
function signal(ctx: CanvasRenderingContext2D, p: P, c: 'r' | 'g' | 'off') {
  const inside = p.x < VW / 2 ? 26 : -26
  const cx = p.x + inside, cy = p.y
  ctx.fillStyle = '#000'; ctx.fillRect(cx - 8, cy - 8, 16, 16)
  ctx.fillStyle = c === 'g' ? '#34d058' : c === 'r' ? '#ff3b30' : '#2a2f36'
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill()
}
function diamond(ctx: CanvasRenderingContext2D, p: P, r: number) {
  ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill()
}
function hatch(ctx: CanvasRenderingContext2D, a: P, b: P) {
  ctx.save(); ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 4
  for (let x = a.x; x < b.x; x += 22) { ctx.beginPath(); ctx.moveTo(x, a.y - 12); ctx.lineTo(x + 12, a.y + 12); ctx.stroke() }
  ctx.restore()
}
function connMark(ctx: CanvasRenderingContext2D, t: TrainView, x: number, y: number) {
  text(ctx, '🔗', x + 16, y, t.connectionMet ? '#34d058' : '#ffd23b', 22, 'center')
}

onMounted(() => { raf = requestAnimationFrame(draw) })
onBeforeUnmount(() => cancelAnimationFrame(raf))
watch(() => props.snap, () => {}, { deep: false })
</script>

<template>
  <canvas ref="canvas" class="stelltisch" />
</template>

<style scoped>
.stelltisch { display: block; width: 100%; height: 100%; }
</style>
