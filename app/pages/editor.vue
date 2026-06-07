<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGame, sendMsg } from '../composables/useGame'
import type { StationView } from '../../shared/game'
import {
  buildCustomStation, validateCustomSpec, defaultCustomLines,
  PLATFORM_CLASS_META, CUSTOM_PLAT_Y, CUSTOM_PLAT_X, CUSTOM_LINE_Y,
  type CustomStationSpec, type CustomLine, type CustomPlatform, type PlatformClass
} from '../../shared/layout'

const { snapshot } = useGame('screen')

// ---- working spec --------------------------------------------------------
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'bf'
function newId(name: string) { return `custom:${slug(name)}-${Math.random().toString(36).slice(2, 6)}` }

const specId = ref(newId('Mein Bahnhof'))
const name = ref('Mein Bahnhof')
const lines = ref<CustomLine[]>(defaultCustomLines())
const platforms = ref<CustomPlatform[]>([
  { y: 230, leftX: 580, rightX: 1020, cls: 'LANG' },
  { y: 400, leftX: 560, rightX: 1010, cls: 'LANG' },
  { y: 560, leftX: 600, rightX: 980, cls: 'KURZ' },
  { y: 690, leftX: 600, rightX: 980, cls: 'GUETER' }
])
const reach = ref<string[]>([])

const wLines = computed(() => lines.value.filter(l => l.side === 'W'))
const eLines = computed(() => lines.value.filter(l => l.side === 'E'))

const spec = computed<CustomStationSpec>(() => ({
  id: specId.value, name: name.value,
  lines: lines.value, platforms: platforms.value, reach: reach.value
}))
const validation = computed(() => validateCustomSpec(spec.value))
const layout = computed(() => { try { return buildCustomStation(spec.value) } catch { return null } })
const previewStation = computed<StationView>(() => ({
  id: 'preview',
  platforms: platforms.value.map(() => null),
  platformDisabled: platforms.value.map(() => false),
  sidings: [null, null],
  sideDisabled: { W: false, E: false }
}))

// ---- matrix --------------------------------------------------------------
const key = (lineId: string, pIdx: number) => `${lineId}:${pIdx}`
const has = (lineId: string, pIdx: number) => reach.value.includes(key(lineId, pIdx))
function toggle(lineId: string, pIdx: number) {
  const k = key(lineId, pIdx)
  reach.value = has(lineId, pIdx) ? reach.value.filter(x => x !== k) : [...reach.value, k]
}
function autoConnect() {
  // connect each platform to the 2 nearest lines on each side (by Y)
  const next: string[] = []
  platforms.value.forEach((p, i) => {
    for (const side of ['W', 'E'] as const) {
      const nearest = lines.value.filter(l => l.side === side)
        .map(l => ({ id: l.id, d: Math.abs(l.y - p.y) }))
        .sort((a, b) => a.d - b.d).slice(0, 2)
      for (const l of nearest) next.push(key(l.id, i + 1))
    }
  })
  reach.value = [...new Set(next)]
}

// ---- platform editing ----------------------------------------------------
function addPlatform() {
  const y = platforms.value.length ? Math.min(CUSTOM_PLAT_Y.max, platforms.value[platforms.value.length - 1]!.y + 110) : 230
  platforms.value = [...platforms.value, { y, leftX: 580, rightX: 1020, cls: 'LANG' }]
}
function removePlatform(i: number) {
  const removedIdx = i + 1
  platforms.value = platforms.value.filter((_, k) => k !== i)
  // drop reach entries for the removed platform and renumber higher platforms
  reach.value = reach.value.flatMap(k => {
    const [lineId, idxStr] = k.split(':'); const idx = Number(idxStr)
    if (idx === removedIdx) return []
    return [idx > removedIdx ? `${lineId}:${idx - 1}` : k]
  })
}
const CLASSES: PlatformClass[] = ['LANG', 'KURZ', 'GUETER']

// ---- applied (registered) stations --------------------------------------
const applied = computed<CustomStationSpec[]>(() => snapshot.value?.customStations ?? [])
function apply() {
  if (!validation.value.ok) return
  sendMsg({ t: 'registerCustom', spec: JSON.parse(JSON.stringify(spec.value)) })
}
function editApplied(s: CustomStationSpec) {
  specId.value = s.id; name.value = s.name
  lines.value = s.lines.map(l => ({ ...l }))
  platforms.value = s.platforms.map(p => ({ ...p }))
  reach.value = [...s.reach]
}
function deleteApplied(id: string) { sendMsg({ t: 'deleteCustom', specId: id }) }

function resetNew() {
  specId.value = newId('Mein Bahnhof'); name.value = 'Mein Bahnhof'
  lines.value = defaultCustomLines()
  platforms.value = [{ y: 230, leftX: 580, rightX: 1020, cls: 'LANG' }, { y: 460, leftX: 580, rightX: 1020, cls: 'LANG' }]
  reach.value = []
  autoConnect()
}

// ---- export / import -----------------------------------------------------
function exportJson() {
  const data = JSON.stringify(spec.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${slug(name.value)}.json`; a.click()
  URL.revokeObjectURL(url)
}
const fileInput = ref<HTMLInputElement | null>(null)
function importClick() { fileInput.value?.click() }
function importFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const r = new FileReader()
  r.onload = () => { try { loadSpec(JSON.parse(String(r.result))) } catch { alert('Ungültige JSON-Datei') } }
  r.readAsText(file)
  ;(ev.target as HTMLInputElement).value = ''
}
function loadSpec(s: Partial<CustomStationSpec>) {
  if (!s || !Array.isArray(s.lines) || !Array.isArray(s.platforms)) { alert('Spec unvollständig'); return }
  specId.value = (typeof s.id === 'string' && s.id.startsWith('custom:')) ? s.id : newId(s.name || 'Import')
  name.value = s.name || 'Importierter Bf'
  lines.value = s.lines.map(l => ({ ...l }))
  platforms.value = s.platforms.map(p => ({ ...p }))
  reach.value = Array.isArray(s.reach) ? [...s.reach] : []
}

// seed sensible connections on first load
autoConnect()
</script>

<template>
  <div class="editor">
    <header class="ed-head">
      <NuxtLink to="/" class="key back">← Leitzentrale</NuxtLink>
      <h1>Bahnhof-Editor</h1>
      <div class="spacer" />
      <button class="key" @click="resetNew">Neu</button>
      <button class="key" @click="importClick">JSON laden</button>
      <button class="key" @click="exportJson">JSON exportieren</button>
      <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="importFile">
    </header>

    <div class="ed-body">
      <!-- live preview -->
      <section class="preview">
        <div class="name-row">
          <input v-model="name" class="name-input" maxlength="22" placeholder="Bahnhofsname">
        </div>
        <div class="canvas-wrap">
          <StationCanvas v-if="layout" :layout="layout" :station="previewStation" :trains="[]" />
        </div>
        <div class="legend">
          <span v-for="c in CLASSES" :key="c" class="leg"><i :style="{ background: PLATFORM_CLASS_META[c].color }" />{{ PLATFORM_CLASS_META[c].label }}</span>
          <span class="leg muted">Gleise fix 4 je Seite (W1–W4 / E1–E4) · Abstellgleise immer dabei</span>
        </div>
        <!-- validation -->
        <div class="valid">
          <div v-for="e in validation.errors" :key="e" class="v-err">⛔ {{ e }}</div>
          <div v-for="w in validation.warnings" :key="w" class="v-warn">⚠ {{ w }}</div>
          <div v-if="validation.ok && !validation.warnings.length" class="v-ok">✓ Bereit</div>
        </div>
        <button class="key primary big apply" :disabled="!validation.ok" @click="apply">In Lobby übernehmen</button>
      </section>

      <!-- controls -->
      <section class="controls">
        <!-- platforms -->
        <div class="block">
          <div class="block-head"><b>Bahnsteige</b><button class="key tiny" @click="addPlatform">+ Bahnsteig</button></div>
          <div v-for="(p, i) in platforms" :key="i" class="prow">
            <span class="pidx">Gl {{ i + 1 }}</span>
            <select v-model="p.cls" class="psel">
              <option v-for="c in CLASSES" :key="c" :value="c">{{ PLATFORM_CLASS_META[c].tag }}</option>
            </select>
            <label>Y<input v-model.number="p.y" type="range" :min="CUSTOM_PLAT_Y.min" :max="CUSTOM_PLAT_Y.max"></label>
            <label>L<input v-model.number="p.leftX" type="range" :min="CUSTOM_PLAT_X.min" :max="p.rightX - 60"></label>
            <label>R<input v-model.number="p.rightX" type="range" :min="p.leftX + 60" :max="CUSTOM_PLAT_X.max"></label>
            <button class="key tiny danger" @click="removePlatform(i)">✕</button>
          </div>
        </div>

        <!-- lines -->
        <div class="block">
          <div class="block-head"><b>Gleise &amp; Fächer</b><span class="muted small">edgeY ≠ Y ⇒ Weiche fächert</span></div>
          <div class="lgrid">
            <div class="lcol">
              <div class="muted small">West (Einfahrt Ost-Züge)</div>
              <div v-for="l in wLines" :key="l.id" class="lrow">
                <span class="lid">{{ l.id }}</span>
                <label>Y<input v-model.number="l.y" type="range" :min="CUSTOM_LINE_Y.min" :max="CUSTOM_LINE_Y.max"></label>
                <label title="Rand-Y am Kartenrand (Fächer)">Rand<input v-model.number="l.edgeY" type="range" :min="CUSTOM_LINE_Y.min" :max="CUSTOM_LINE_Y.max"></label>
              </div>
            </div>
            <div class="lcol">
              <div class="muted small">Ost (Einfahrt West-Züge)</div>
              <div v-for="l in eLines" :key="l.id" class="lrow">
                <span class="lid">{{ l.id }}</span>
                <label>Y<input v-model.number="l.y" type="range" :min="CUSTOM_LINE_Y.min" :max="CUSTOM_LINE_Y.max"></label>
                <label title="Rand-Y am Kartenrand (Fächer)">Rand<input v-model.number="l.edgeY" type="range" :min="CUSTOM_LINE_Y.min" :max="CUSTOM_LINE_Y.max"></label>
              </div>
            </div>
          </div>
        </div>

        <!-- matrix -->
        <div class="block">
          <div class="block-head"><b>Verbindungen (Gleis → Bahnsteig)</b><button class="key tiny" @click="autoConnect">Auto (Nähe)</button></div>
          <table class="matrix">
            <thead>
              <tr><th></th><th v-for="(p, i) in platforms" :key="i">Gl{{ i + 1 }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in lines" :key="l.id" :class="{ esep: l.id === 'E1' }">
                <th class="mlid">{{ l.id }}</th>
                <td v-for="(p, i) in platforms" :key="i">
                  <button class="cell" :class="{ on: has(l.id, i + 1) }" @click="toggle(l.id, i + 1)">{{ has(l.id, i + 1) ? '●' : '' }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- applied list -->
        <div v-if="applied.length" class="block">
          <div class="block-head"><b>Übernommene Bahnhöfe</b><span class="muted small">in Lobby wählbar</span></div>
          <div v-for="s in applied" :key="s.id" class="arow">
            <span class="aname">{{ s.name }}</span>
            <span class="muted small">{{ s.platforms.length }} Bahnsteige</span>
            <div class="spacer" />
            <button class="key tiny" @click="editApplied(s)">Bearbeiten</button>
            <button class="key tiny danger" @click="deleteApplied(s.id)">Löschen</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.editor { min-height: 100vh; background: #0c0f12; color: #e7edf2; font: 14px/1.4 system-ui, sans-serif; }
.ed-head { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #1d2530; position: sticky; top: 0; background: #0c0f12; z-index: 5; }
.ed-head h1 { font-size: 18px; margin: 0; letter-spacing: 1px; }
.spacer { flex: 1; }
.hidden { display: none; }
.muted { color: #7e8997; }
.small { font-size: 12px; }
.ed-body { display: grid; grid-template-columns: minmax(520px, 1fr) 540px; gap: 16px; padding: 16px; align-items: start; }
@media (max-width: 1200px) { .ed-body { grid-template-columns: 1fr; } .preview { position: static !important; } }

.preview { position: sticky; top: 64px; }
.name-row { margin-bottom: 8px; }
.name-input { width: 100%; background: #11161c; border: 1px solid #2a3744; color: #e7edf2; border-radius: 8px; padding: 8px 12px; font-size: 16px; }
.canvas-wrap { background: #0a0d10; border: 1px solid #1d2530; border-radius: 12px; overflow: hidden; aspect-ratio: 1600 / 860; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 2px; font-size: 12px; }
.leg { display: inline-flex; align-items: center; gap: 5px; }
.leg i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.valid { margin: 8px 0; min-height: 22px; }
.v-err { color: #ff6b6b; } .v-warn { color: #ffc14d; } .v-ok { color: #48d17a; }
.apply { width: 100%; margin-top: 4px; }

.controls { display: flex; flex-direction: column; gap: 14px; }
.block { background: #11161c; border: 1px solid #1d2530; border-radius: 12px; padding: 12px; }
.block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
.prow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.pidx { width: 38px; font-weight: 600; font-size: 12px; }
.psel { background: #0c0f12; border: 1px solid #2a3744; color: #e7edf2; border-radius: 6px; padding: 3px; }
.prow label, .lrow label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #7e8997; }
.prow input[type=range] { width: 90px; } .lrow input[type=range] { width: 76px; }

.lgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lrow { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.lid, .mlid { width: 30px; font-weight: 600; font-size: 12px; }

.matrix { border-collapse: collapse; width: 100%; }
.matrix th, .matrix td { text-align: center; padding: 2px; }
.matrix thead th { font-size: 11px; color: #7e8997; font-weight: 500; }
.matrix tbody th { text-align: left; }
.matrix tr.esep td, .matrix tr.esep th { border-top: 2px solid #2a3744; padding-top: 5px; }
.cell { width: 26px; height: 26px; border: 1px solid #2a3744; background: #0c0f12; color: #48d17a; border-radius: 5px; cursor: pointer; font-size: 12px; }
.cell.on { background: #14361f; border-color: #2f7d4a; }
.cell:hover { border-color: #3f8cff; }

.arow { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid #1a222c; }
.aname { font-weight: 600; }

.key { background: #1a222c; border: 1px solid #2a3744; color: #e7edf2; border-radius: 7px; padding: 6px 12px; cursor: pointer; font-size: 13px; text-decoration: none; display: inline-block; }
.key:hover { border-color: #3f8cff; }
.key.tiny { padding: 3px 8px; font-size: 12px; }
.key.danger { border-color: #5a2730; color: #ff9b9b; }
.key.danger:hover { border-color: #ff6b6b; }
.key.primary { background: #14361f; border-color: #2f7d4a; color: #9ff0bd; }
.key.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.key.big { padding: 10px; font-size: 15px; }
.key.back { font-size: 13px; }
</style>
