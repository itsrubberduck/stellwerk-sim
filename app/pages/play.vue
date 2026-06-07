<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGame, sendMsg, setPlayerName } from '../composables/useGame'
import { PHASE_LABEL, TRAIN_KINDS, type TimetableEntry, type TrainView } from '../../shared/game'
import { PLATFORM_CLASS_META, kindAllowed, type Side } from '../../shared/layout'
import { generateNetwork, type StationKind } from '../../shared/network'

const { snapshot, connected, playerId, toasts } = useGame('player')
const name = ref(''); const view = ref<'setup' | 'panel'>('setup')
const tab = ref<string | null>(null) // solo: which station viewed
const sel = ref<{ id: string, x: number, y: number } | null>(null)
const hoverId = ref<string | null>(null)
onMounted(() => { try { name.value = localStorage.getItem('swk_name') || '' } catch {} })

const s = computed(() => snapshot.value)
const net = computed(() => generateNetwork(s.value?.netCount ?? 2, (s.value?.netTypes as StationKind[] | undefined)))
const me = computed(() => s.value?.players.find(p => p.id === playerId.value))
const myStationId = computed(() => s.value?.soloMode ? (tab.value ?? net.value.stations[0]?.id ?? null) : (me.value?.station ?? null))
const myStation = computed(() => net.value.stations.find(st => st.id === myStationId.value) ?? null)
const myLayout = computed(() => myStation.value?.layout ?? null)
const stationView = computed(() => s.value?.stations.find(st => st.id === myStationId.value) ?? null)
const myTrains = computed<TrainView[]>(() => (s.value?.trains ?? []).filter(t => t.station === myStationId.value))
const ownerOf = (sid: string) => s.value?.players.find(p => p.station === sid)
const stationTaken = (sid: string) => {
  const owner = ownerOf(sid)
  return !!owner?.connected && owner.id !== playerId.value
}

function saveName() { try { localStorage.setItem('swk_name', name.value) } catch {}; setPlayerName(name.value || 'Fdl') }
function claim(sid: string) { sendMsg({ t: 'claimStation', station: sid }) }
function openPanel() { saveName(); view.value = 'panel' }

const fSide = (t: TrainView): Side => t.dir === 'E' ? 'E' : 'W'
const selTrain = computed<TrainView | null>(() => sel.value ? (myTrains.value.find(t => t.id === sel.value!.id) ?? null) : null)

function platformDisabled(p: number) { return !!stationView.value?.platformDisabled[p - 1] }
function platformOcc(p: number) { return !!stationView.value?.platforms[p - 1] }
function compatible(t: TrainView, p: number) { return !!myLayout.value && kindAllowed(t.kind, myLayout.value.platforms[p - 1]!.cls) }
function hasForwardExit(t: TrainView, p: number) { const L = myLayout.value!; const f = fSide(t); return L.lines.some(l => l.side === f && L.exit(l.id, p)) }
function reachable(t: TrainView, p: number) { return !!myLayout.value?.entry(t.arrLine, p) && hasForwardExit(t, p) }
function canEntry(t: TrainView, p: number) { return compatible(t, p) && reachable(t, p) && !platformDisabled(p) }
function exitOptions(t: TrainView) { const L = myLayout.value!; const f = fSide(t); return t.platform == null ? [] : L.lines.filter(l => l.side === f && L.exit(l.id, t.platform!)) }
function exitLabel(lineId: string): string {
  const st = myStation.value!; const side = lineId[0] === 'W' ? 'W' : 'E'
  const role = side === 'W' ? st.west : st.east
  if (role.kind === 'PORTAL') return `Netz-Ausfahrt · ${lineId}`
  const nb = net.value.stations.find(x => x.id === role.neighbor)
  return `→ ${nb?.name ?? 'Nachbar'} · Gl ${lineId.slice(1)}`
}
function linkBusy(lineId: string): boolean {
  const st = myStation.value!; const side = lineId[0] === 'W' ? 'W' : 'E'
  const role = side === 'W' ? st.west : st.east
  if (role.kind !== 'LINK') return false
  const lk = s.value?.links.find(l => l.id === role.linkId)
  return !!lk?.occupant[parseInt(lineId.slice(1), 10) - 1]
}

function onTrainClick(p: { id: string, x: number, y: number }) { sel.value = p }
function reserveEntry(t: TrainView, p: number) { if (canEntry(t, p)) sendMsg({ t: 'setEntry', trainId: t.id, platform: p }) }
function reserveExit(t: TrainView, line: string) { sendMsg({ t: 'setExit', trainId: t.id, exitLine: line }) }
function cancel(t: TrainView) { sendMsg({ t: 'cancelResv', trainId: t.id }) }
const sidings = computed(() => myLayout.value?.sidings ?? [])
function sidingFree(i: number) { return !!stationView.value && stationView.value.sidings[i - 1] == null }
function park(t: TrainView, sd: number) { sendMsg({ t: 'park', trainId: t.id, siding: sd }) }
function retrieve(t: TrainView, p: number) { sendMsg({ t: 'retrieve', trainId: t.id, platform: p }) }
function canRetrieve(t: TrainView, p: number) { return !platformOcc(p) && !platformDisabled(p) && compatible(t, p) }

// hover-preview of the exact route an option would set
const previewPoly = ref<{ x: number, y: number }[] | null>(null)
function sidingDef(i: number) { return myLayout.value?.sidings[i - 1] }
function platDef(i: number) { return myLayout.value?.platforms[i - 1] }
function parkPath(pIdx: number, sIdx: number) {
  const L = myLayout.value; const pf = platDef(pIdx), sd = sidingDef(sIdx); if (!L || !pf || !sd) return null
  const refY = Math.max(...L.platforms.map(p => p.y))
  return [{ x: pf.centerX, y: pf.y }, { x: sd.leftX, y: refY }, { x: sd.leftX, y: sd.y }, { x: sd.centerX, y: sd.y }]
}
function previewEntry(t: TrainView, p: number) { previewPoly.value = myLayout.value?.entry(t.arrLine, p)?.poly ?? null }
function previewExit(t: TrainView, l: string) { previewPoly.value = (t.platform != null ? myLayout.value?.exit(l, t.platform)?.poly : null) ?? null }
function previewPark(t: TrainView, s: number) { previewPoly.value = t.platform != null ? parkPath(t.platform, s) : null }
function previewRetrieve(t: TrainView, p: number) { previewPoly.value = t.sidingIndex != null ? parkPath(p, t.sidingIndex) : null }
function clearPreview() { previewPoly.value = null }
const platforms = computed(() => myLayout.value?.platforms ?? [])
const timetable = computed<TimetableEntry[]>(() => (s.value?.timetable ?? [])
  .filter(row => row.station === myStationId.value)
  .sort((a, b) => (a.estimatedTime ?? a.plannedTime) - (b.estimatedTime ?? b.plannedTime))
  .slice(0, 12))
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, '0')}`
function rowDelay(row: TimetableEntry) {
  return row.estimatedTime == null ? null : Math.max(0, Math.round(row.estimatedTime - row.plannedTime))
}
function rowStatus(row: TimetableEntry): string {
  if (row.state === 'SCHEDULED') return row.staged ? 'wird bereitgestellt' : 'angekündigt'
  const train = row.trainId ? s.value?.trains.find(t => t.id === row.trainId) : null
  if (train?.station !== row.station) {
    const from = net.value.stations.find(st => st.id === train?.station)
    return from ? `noch in ${from.name}` : 'im Zulauf'
  }
  const labels: Record<string, string> = {
    APPROACH: 'im Zulauf', ENTERING: 'Einfahrt', DWELL: 'am Bahnsteig',
    READY_DEPART: 'abfahrbereit', EXITING: 'fährt aus', STUCK: 'Zwangshalt',
    PARKING: 'wird abgestellt', PARKED: 'abgestellt', RETRIEVING: 'wird bereitgestellt'
  }
  return labels[row.state] ?? 'geplant'
}
function platformLabel(row: TimetableEntry) {
  const platform = row.platform ?? row.plannedPlatform
  if (row.platformStatus === 'ACTUAL') return `Gl ${platform}`
  if (row.platformStatus === 'RESERVED') return `Gl ${platform} vorg.`
  return `Gl ${platform} Soll`
}
const menuPos = computed(() => sel.value ? { left: Math.min(sel.value.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 280) + 'px', top: Math.min(sel.value.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320) + 'px' } : {})
</script>

<template>
  <div class="play">
    <div v-if="!connected" class="banner">Verbinde …</div>

    <!-- SETUP -->
    <div v-else-if="view === 'setup'" class="setup">
      <div class="title">Stellwerk übernehmen</div>
      <div class="muted small">Raum {{ s?.roomCode }} · {{ PHASE_LABEL[s?.phase ?? 'LOBBY'] }}</div>
      <label class="fld">Dein Name<input v-model="name" class="inp" maxlength="14" placeholder="Fdl" @change="saveName" /></label>
      <div class="muted small mt">Wähle dein Stellwerk:</div>
      <div class="st-grid">
        <button v-for="st in net.stations" :key="st.id" class="key st"
          :class="{ mine: me?.station === st.id, taken: stationTaken(st.id) }"
          :disabled="stationTaken(st.id)" @click="claim(st.id)">
          <span class="st-id">{{ st.name }}</span>
          <span class="st-own">{{ ownerOf(st.id)?.name ?? 'frei' }}</span>
        </button>
      </div>
      <div v-if="s?.soloMode" class="hint">Solo-Notbetrieb — du steuerst alle Stellwerke (oben umschaltbar).</div>
      <button class="key primary big" :disabled="!s?.soloMode && !me?.station" @click="openPanel">Stellbereich öffnen</button>
    </div>

    <!-- PANEL -->
    <div v-else class="panel">
      <header class="ph">
        <button class="key tiny" @click="view = 'setup'">≡</button>
        <div class="ph-mid">
          <div class="ph-name">{{ myStation?.name ?? '—' }}</div>
          <div class="muted small">{{ PHASE_LABEL[s?.phase ?? 'LOBBY'] }} · {{ myTrains.length }} Züge</div>
        </div>
        <div class="ph-stat mono" :class="{ low: (s?.punctualityPct ?? 100) < 70 }">{{ s?.punctualityPct }}%</div>
      </header>
      <div v-if="s?.soloMode" class="tabs">
        <button v-for="st in net.stations" :key="st.id" class="key tab" :class="{ on: myStationId === st.id }" @click="tab = st.id; sel = null">{{ st.name }}</button>
      </div>
      <div v-if="!s?.soloMode && !me?.station" class="reassign" @click="view = 'setup'">Kein Stellwerk — tippe hier zum Wählen</div>

      <div class="workspace">
        <div class="board" @pointerdown.self="sel = null">
          <StationCanvas v-if="myLayout && stationView" :layout="myLayout" :station="stationView" :trains="myTrains"
            interactive :sel-id="sel?.id ?? null" :hover-id="hoverId" :preview-poly="previewPoly"
            @train-click="onTrainClick" @train-hover="hoverId = $event" @bg="sel = null" />
          <div class="hint-tip muted">Zug anklicken zum Disponieren · Hover zeigt Soll-Route</div>

          <!-- train menu -->
          <div v-if="selTrain" class="menu" :style="menuPos" @pointerdown.stop>
            <div class="menu-head">
              <span class="kbar" :style="{ background: TRAIN_KINDS[selTrain.kind].color }" />
              <b class="mono">{{ selTrain.number }}</b>
              <span class="muted">{{ selTrain.dir === 'E' ? '▶ Ost' : '◀ West' }}</span>
              <button class="x" @click="sel = null">✕</button>
            </div>
            <div class="menu-soll">Soll: Gl {{ selTrain.sollPlatform }}<span v-if="selTrain.delaySec > 5" class="delay"> · +{{ selTrain.delaySec }}s</span></div>

            <!-- reserved -->
            <div v-if="selTrain.resvKind" class="resv">
              <span>{{ selTrain.resvKind === 'entry' ? `→ Gl ${selTrain.resvPlatform} vorgemerkt` : `Ausfahrt ${selTrain.resvExitLine} vorgemerkt` }}</span>
              <button class="key danger sm" @click="cancel(selTrain)">Abbrechen</button>
            </div>

            <!-- entry: pick platform -->
            <template v-else-if="selTrain.state === 'APPROACH'">
              <div class="menu-label">Einfahrt auf Gleis:</div>
              <div class="opt-grid">
                <button v-for="pf in platforms" :key="pf.index" class="key opt"
                  :class="{ soll: pf.index === selTrain.sollPlatform, bad: !canEntry(selTrain, pf.index), occ: platformOcc(pf.index) }"
                  :disabled="!canEntry(selTrain, pf.index)" @click="reserveEntry(selTrain, pf.index)"
                  @mouseenter="previewEntry(selTrain, pf.index)" @mouseleave="clearPreview()">
                  Gl {{ pf.index }} <span class="tag" :style="{ color: PLATFORM_CLASS_META[pf.cls].color }">{{ PLATFORM_CLASS_META[pf.cls].tag }}</span>
                </button>
              </div>
            </template>

            <!-- exit: pick line / hand-over track + park -->
            <template v-else-if="selTrain.state === 'DWELL' || selTrain.state === 'READY_DEPART'">
              <div v-if="exitOptions(selTrain).length" class="menu-label">Ausfahrt / Übergabe über:</div>
              <div class="opt-list">
                <button v-for="l in exitOptions(selTrain)" :key="l.id" class="key opt wide"
                  :class="{ soll: l.id === selTrain.sollExitLine, bad: linkBusy(l.id) }" @click="reserveExit(selTrain, l.id)"
                  @mouseenter="previewExit(selTrain, l.id)" @mouseleave="clearPreview()">
                  {{ exitLabel(l.id) }}<span v-if="linkBusy(l.id)" class="muted"> · belegt</span>
                </button>
              </div>
              <div v-if="sidings.length" class="menu-label">Abstellen (Rangieren):</div>
              <div v-if="sidings.length" class="opt-grid">
                <button v-for="sd in sidings" :key="sd.index" class="key opt park" :disabled="!sidingFree(sd.index)" @click="park(selTrain, sd.index)"
                  @mouseenter="previewPark(selTrain, sd.index)" @mouseleave="clearPreview()">Abst {{ sd.index }}</button>
              </div>
              <div v-if="selTrain.state === 'DWELL'" class="muted sm">hält noch {{ selTrain.dwellLeft }}s (vormerkbar)</div>
            </template>

            <!-- parked: bring back to a platform -->
            <template v-else-if="selTrain.state === 'PARKED'">
              <div class="menu-label">Bereitstellen auf Gleis:</div>
              <div class="opt-grid">
                <button v-for="pf in platforms" :key="pf.index" class="key opt"
                  :class="{ soll: pf.index === selTrain.sollPlatform, occ: platformOcc(pf.index), bad: !compatible(selTrain, pf.index) }"
                  :disabled="!canRetrieve(selTrain, pf.index)" @click="retrieve(selTrain, pf.index)"
                  @mouseenter="previewRetrieve(selTrain, pf.index)" @mouseleave="clearPreview()">
                  Gl {{ pf.index }} <span class="tag" :style="{ color: PLATFORM_CLASS_META[pf.cls].color }">{{ PLATFORM_CLASS_META[pf.cls].tag }}</span>
                </button>
              </div>
            </template>

            <div v-else class="muted sm">fährt …</div>
          </div>
        </div>

        <aside class="timetable">
          <div class="tt-head">
            <div><b>Fahrplan</b><span>{{ myStation?.name }}</span></div>
            <div class="tt-clock mono">{{ fmtTime(s?.elapsed ?? 0) }}</div>
          </div>
          <div class="tt-cols"><span>Zeit</span><span>Zug · Ziel</span><span>Gleis</span></div>
          <div class="tt-list">
            <div v-for="row in timetable" :key="row.id" class="tt-row" :class="{ uncertain: row.estimatedTime == null }">
              <div class="tt-time mono">
                <b>{{ row.estimatedTime == null ? 'offen' : fmtTime(row.estimatedTime) }}</b>
                <span v-if="row.estimatedTime != null && rowDelay(row)! >= 5" class="late">+{{ rowDelay(row) }}s</span>
                <span v-else class="plan">Plan {{ fmtTime(row.plannedTime) }}</span>
              </div>
              <div class="tt-train">
                <div><span class="tt-kind" :style="{ background: TRAIN_KINDS[row.kind].color }" /><b class="mono">{{ row.number }}</b></div>
                <div class="tt-dest">{{ row.event === 'ARRIVAL' ? 'Ankunft' : 'nach' }} {{ row.destination }}</div>
                <div class="tt-status">{{ rowStatus(row) }}</div>
              </div>
              <div class="tt-platform" :class="row.platformStatus.toLowerCase()">{{ platformLabel(row) }}</div>
            </div>
            <div v-if="!timetable.length" class="tt-empty muted">Keine Fahrten angekündigt</div>
          </div>
          <div class="tt-legend"><span>Plan = Sollfahrplan</span><span>Prognose hängt von den Nachbarstellwerken ab</span></div>
        </aside>
      </div>
    </div>

    <div class="toasts"><div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div></div>
  </div>
</template>

<style scoped>
.play { position: fixed; inset: 0; display: flex; flex-direction: column; }
.banner { margin: auto; color: var(--muted); }
.muted { color: var(--muted); } .small { font-size: 13px; } .sm { font-size: 12px; } .mt { margin-top: 14px; }

.setup { padding: 22px; display: flex; flex-direction: column; gap: 10px; max-width: 640px; }
.title { font-size: 28px; font-weight: 800; }
.fld { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; font-size: 13px; color: var(--muted); }
.inp { background: var(--panel-2); border: 2px solid var(--grid); color: var(--text); padding: 13px; font-size: 18px; font-weight: 700; }
.st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.st { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px; text-transform: none; }
.st-id { font-size: 18px; font-weight: 800; } .st-own { font-size: 12px; color: var(--accent); }
.st.mine { border-color: var(--green); background: #1f3a23; } .st.taken { opacity: 0.7; }
.hint { color: var(--amber); font-size: 13px; } .big { font-size: 18px; padding: 16px; margin-top: 10px; }

.panel { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.ph { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--panel); border-bottom: 2px solid var(--grid); }
.ph .tiny { padding: 9px 13px; font-size: 18px; } .ph-mid { flex: 1; } .ph-name { font-size: 18px; font-weight: 800; }
.ph-stat { font-size: 24px; font-weight: 800; } .ph-stat.low { color: var(--red); }
.tabs { display: flex; gap: 6px; padding: 8px 14px; background: var(--panel); border-bottom: 1px solid var(--grid); }
.tab { padding: 8px 12px; font-size: 13px; text-transform: none; } .tab.on { border-color: var(--accent); background: #2a2410; }
.reassign { background: #2a2410; border: 2px solid var(--amber); color: #ffe6b0; font-weight: 700; text-align: center; padding: 12px; }

.workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 350px; }
.board { min-width: 0; min-height: 0; position: relative; background: #0c0f12; }
.hint-tip { position: absolute; bottom: 8px; left: 12px; font-size: 12px; pointer-events: none; }
.menu { position: fixed; z-index: 50; width: 270px; background: var(--panel); border: 2px solid var(--accent); padding: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.6); }
.menu-head { display: flex; align-items: center; gap: 8px; }
.menu-head .kbar { width: 6px; height: 22px; } .menu-head b { font-size: 18px; } .menu-head .x { margin-left: auto; background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; }
.menu-soll { font-size: 13px; color: var(--muted); margin: 8px 0; } .delay { color: var(--amber); }
.menu-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 8px 0 6px; }
.opt-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.opt-list { display: flex; flex-direction: column; gap: 6px; }
.opt { padding: 12px 8px; font-size: 14px; } .opt.wide { text-align: left; text-transform: none; letter-spacing: 0; }
.opt .tag { font-size: 10px; }
.opt.soll { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.opt.occ { opacity: 0.9; } .opt.bad { opacity: 0.35; }
.opt.park { border-color: #5a4fb0; color: #cfc8ff; }
.resv { display: flex; align-items: center; gap: 8px; margin-top: 8px; background: #2a2410; border: 2px dashed var(--amber); padding: 10px; font-size: 13px; color: #ffe6b0; }
.resv .sm { margin-left: auto; padding: 8px 10px; }

.timetable { min-height: 0; display: flex; flex-direction: column; background: #10151a; border-left: 2px solid var(--grid); }
.tt-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 2px solid var(--grid); }
.tt-head > div:first-child { display: flex; flex-direction: column; gap: 2px; }
.tt-head b { font-size: 18px; text-transform: uppercase; letter-spacing: 0.06em; }
.tt-head span { color: var(--muted); font-size: 12px; }
.tt-clock { color: var(--accent); font-size: 20px; font-weight: 800; }
.tt-cols { display: grid; grid-template-columns: 70px minmax(0, 1fr) 74px; gap: 8px; padding: 7px 10px; color: var(--muted); border-bottom: 1px solid var(--grid); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
.tt-cols span:last-child { text-align: right; }
.tt-list { flex: 1; min-height: 0; overflow-y: auto; }
.tt-row { display: grid; grid-template-columns: 70px minmax(0, 1fr) 74px; gap: 8px; align-items: start; padding: 10px; border-bottom: 1px solid #242c34; }
.tt-row.uncertain { background: #211b13; }
.tt-time { display: flex; flex-direction: column; gap: 3px; }
.tt-time b { font-size: 16px; }
.tt-time span { font-size: 10px; color: var(--muted); }
.tt-time .late { color: var(--amber); font-weight: 800; }
.tt-train { min-width: 0; }
.tt-train > div:first-child { display: flex; align-items: center; gap: 6px; }
.tt-kind { width: 4px; height: 16px; flex: 0 0 auto; }
.tt-train b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt-dest { margin-top: 3px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt-status { margin-top: 3px; color: var(--muted); font-size: 10px; }
.tt-platform { justify-self: end; padding: 5px 6px; border: 1px solid var(--grid); font-size: 10px; font-weight: 800; text-align: center; white-space: nowrap; }
.tt-platform.actual { border-color: var(--green); color: #c8ffd4; }
.tt-platform.reserved { border-color: var(--amber); color: #ffe6b0; }
.tt-platform.planned { color: var(--muted); }
.tt-empty { padding: 24px 12px; text-align: center; font-size: 12px; }
.tt-legend { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-top: 1px solid var(--grid); color: var(--muted); font-size: 9px; }

.toasts { position: fixed; bottom: 12px; left: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.toast { padding: 9px 14px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; font-size: 14px; }
.toast.good { border-color: var(--green); color: #c8ffd4; } .toast.bad { border-color: var(--red); color: #ffd0cc; } .toast.info { border-color: var(--grid); }

@media (max-width: 920px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(300px, 1fr) minmax(190px, 36vh);
  }
  .timetable { border-left: 0; border-top: 2px solid var(--grid); }
  .tt-row, .tt-cols { grid-template-columns: 62px minmax(0, 1fr) 66px; }
}
</style>
