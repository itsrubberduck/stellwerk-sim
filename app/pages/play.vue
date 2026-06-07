<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGame, sendMsg, setPlayerName } from '../composables/useGame'
import { PHASE_LABEL, TRAIN_KINDS, type TrainView } from '../../shared/game'
import { PLATFORM_CLASS_META, generateLayout, kindAllowed, routesConflict, type PlatformClass, type Side } from '../../shared/layout'

const { snapshot, connected, playerId, toasts } = useGame('player')

const name = ref('')
const view = ref<'setup' | 'panel'>('setup')
onMounted(() => { try { name.value = localStorage.getItem('swk_name') || '' } catch {} })

const s = computed(() => snapshot.value)
const layout = computed(() => generateLayout(s.value?.preset ?? 'MITTEL'))
const lines = computed(() => layout.value.lines)
const me = computed(() => s.value?.players.find(p => p.id === playerId.value))
const mySectors = computed<string[]>(() => s.value?.soloMode ? lines.value.map(l => l.id) : (me.value?.sectors ?? []))
const ownerOf = (id: string) => s.value?.players.find(p => p.sectors.includes(id))
const sideOfLine = (id: string): Side => lines.value.find(l => l.id === id)?.side ?? 'W'
const platforms = computed(() => layout.value.platforms)
const platformCls = (p: number): PlatformClass => layout.value.platforms[p - 1]?.cls ?? 'LANG'

function saveName() { try { localStorage.setItem('swk_name', name.value) } catch {}; setPlayerName(name.value || 'FdL') }
function toggleSector(id: string) { if (me.value?.sectors.includes(id)) sendMsg({ t: 'releaseSector', sector: id }); else sendMsg({ t: 'claimSector', sector: id }) }
function enterPanel() { saveName(); view.value = 'panel' }

const globalStop = computed(() => !!s.value?.globalStop)
const headFree = (side: Side) => !!s.value && !s.value.sideDisabled[side]

function throatBusy(routeId: string | undefined): boolean {
  if (!routeId) return true
  const cand = layout.value.byId(routeId); if (!cand) return true
  return (s.value?.trains ?? []).some(t => (t.state === 'ENTERING' || t.state === 'EXITING' || t.state === 'STUCK') && t.routeId && (() => { const r = layout.value.byId(t.routeId!); return !!r && routesConflict(cand, r) })())
}
function depTrackBusy(lineId: string): boolean {
  return (s.value?.trains ?? []).some(t => (t.state === 'EXITING' || t.state === 'STUCK') && t.exitLine === lineId && layout.value.byId(t.routeId ?? '')?.kind === 'exit')
}
function platformOcc(p: number) { return !!s.value && s.value.platforms[p - 1] != null }
function platformBlocked(p: number) { return !!s.value && s.value.platformDisabled[p - 1] }
function compatible(t: TrainView, p: number) { return kindAllowed(t.kind, platformCls(p)) }
function canReserve(t: TrainView, p: number) { return compatible(t, p) && !platformBlocked(p) }

function reserveEntry(t: TrainView, p: number) { if (canReserve(t, p)) sendMsg({ t: 'setEntry', trainId: t.id, platform: p }) }
function reserveExit(t: TrainView) { sendMsg({ t: 'setExit', trainId: t.id }) }
function cancel(t: TrainView) { sendMsg({ t: 'cancelResv', trainId: t.id }) }

function entryStatus(t: TrainView): string {
  if (globalStop.value) return 'Vollhalt'
  const p = t.resvPlatform; if (p == null) return '…'
  if (!headFree(sideOfLine(t.entryLine))) return 'Kopf gestört'
  if (platformBlocked(p)) return `Gl ${p} gesperrt`
  if (platformOcc(p)) return `wartet: Gl ${p} belegt`
  const r = layout.value.entry(t.entryLine, p)
  if (r && throatBusy(r.id)) return 'wartet: Kopf belegt'
  return 'stellt sich …'
}
function exitStatus(t: TrainView): string {
  if (t.state === 'DWELL') return `Halt ${t.dwellLeft}s`
  if (globalStop.value) return 'Vollhalt'
  if (!headFree(sideOfLine(t.exitLine))) return 'Kopf gestört'
  if (depTrackBusy(t.exitLine)) return `${t.exitLine} belegt`
  if (t.platform != null) { const r = layout.value.exit(t.exitLine, t.platform); if (r && throatBusy(r.id)) return 'wartet: Kopf belegt' }
  return 'fährt …'
}
function reqClass(kind: string): string {
  if (kind === 'SPRINTER' || kind === 'ICE') return 'Langbahnsteig'
  if (kind === 'FREIGHT') return 'Kurz/Güter'
  return 'beliebig'
}

const arrivals = computed<TrainView[]>(() => (s.value?.trains ?? []).filter(t => t.state === 'APPROACH' && mySectors.value.includes(t.entryLine)))
const departures = computed<TrainView[]>(() => (s.value?.trains ?? []).filter(t => (t.state === 'DWELL' || t.state === 'READY_DEPART') && mySectors.value.includes(t.exitLine)))
const conn = (t: TrainView) => t.connectionId ? (s.value?.trains.find(x => x.id === t.connectionId) ?? null) : null
</script>

<template>
  <div class="play">
    <div v-if="!connected" class="banner">Verbinde …</div>

    <!-- SETUP -->
    <div v-else-if="view === 'setup'" class="setup">
      <div class="title">Stellpult</div>
      <div class="muted small">Raum {{ s?.roomCode }} · {{ PHASE_LABEL[s?.phase ?? 'LOBBY'] }}</div>
      <label class="fld">Dein Name<input v-model="name" class="inp" maxlength="14" placeholder="FdL" @change="saveName" /></label>
      <div class="muted small mt">Wähle deine Sektoren (Linien):</div>
      <div class="sec-grid">
        <button v-for="ln in lines" :key="ln.id" class="key sec"
          :class="{ mine: me?.sectors.includes(ln.id), taken: ownerOf(ln.id) && !me?.sectors.includes(ln.id), w: ln.side === 'W', e: ln.side === 'E' }"
          @click="toggleSector(ln.id)">
          <span class="sec-id">{{ ln.id }}</span><span class="sec-lbl">{{ ln.label }}</span>
          <span class="sec-own">{{ ownerOf(ln.id)?.name ?? 'frei' }}</span>
        </button>
      </div>
      <div v-if="s?.soloMode" class="hint">Solo-Notbetrieb aktiv — du steuerst alle Linien.</div>
      <button class="key primary big" :disabled="!s?.soloMode && (me?.sectors.length ?? 0) === 0" @click="enterPanel">Pult öffnen</button>
    </div>

    <!-- PANEL -->
    <div v-else class="panel">
      <header class="ph">
        <button class="key tiny" @click="view = 'setup'">≡</button>
        <div class="ph-mid"><div class="ph-sec mono">{{ mySectors.join(' ') || '—' }}</div><div class="muted small">{{ PHASE_LABEL[s?.phase ?? 'LOBBY'] }}</div></div>
        <div class="ph-stat"><div class="mono big" :class="{ low: (s?.punctualityPct ?? 100) < 70 }">{{ s?.punctualityPct }}%</div></div>
      </header>

      <div class="heads">
        <div class="hpill" :class="headFree('W') && !globalStop ? 'ok' : 'bad'"><span class="led" :class="headFree('W') && !globalStop ? 'g' : 'r'" /> Kopf West</div>
        <div class="hpill" :class="headFree('E') && !globalStop ? 'ok' : 'bad'"><span class="led" :class="headFree('E') && !globalStop ? 'g' : 'r'" /> Kopf Ost</div>
      </div>
      <div v-if="globalStop" class="vollhalt">🛑 PERSON IM GLEIS — VOLLHALT</div>
      <div v-if="s?.phase === 'GAMEOVER'" class="vollhalt">Betrieb eingestellt</div>

      <section>
        <h3>Einfahrten <span v-if="arrivals.length" class="cnt">{{ arrivals.length }}</span></h3>
        <div v-if="!arrivals.length" class="empty">— wartet auf Anmeldung —</div>
        <div v-for="t in arrivals" :key="t.id" class="card">
          <div class="card-top">
            <span class="kbar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="tnum mono">{{ t.number }}</span><span class="ttype">{{ TRAIN_KINDS[t.kind].label }}</span>
            <span class="troute mono">{{ t.entryLine }} → {{ t.exitLine }}</span>
          </div>
          <div class="soll">Soll: <b>Gl {{ t.sollPlatform }}</b> · braucht {{ reqClass(t.kind) }}<span v-if="t.delaySec > 5" class="delay"> · +{{ t.delaySec }}s</span></div>
          <div v-if="conn(t)" class="conn">🔗 Anschluss mit {{ conn(t)?.number }}</div>

          <div v-if="t.resvKind === 'entry'" class="resv">
            <div class="resv-info">→ Gl {{ t.resvPlatform }} vorgemerkt <span class="rstatus">{{ entryStatus(t) }}</span></div>
            <button class="key danger small-btn" @click="cancel(t)">✕</button>
          </div>
          <div v-else class="plat-row" :style="{ gridTemplateColumns: `repeat(${Math.min(platforms.length, 4)}, 1fr)` }">
            <button v-for="pf in platforms" :key="pf.index" class="key plat"
              :class="{ soll: pf.index === t.sollPlatform, occ: platformOcc(pf.index), bad: !compatible(t, pf.index) }"
              :disabled="!canReserve(t, pf.index)" @click="reserveEntry(t, pf.index)">
              <span>Gl {{ pf.index }}</span>
              <span class="ptag" :style="{ color: PLATFORM_CLASS_META[pf.cls].color }">{{ PLATFORM_CLASS_META[pf.cls].tag }}{{ platformOcc(pf.index) ? '·belegt' : '' }}</span>
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3>Ausfahrten <span v-if="departures.length" class="cnt amber">{{ departures.length }}</span></h3>
        <div v-if="!departures.length" class="empty">— keine —</div>
        <div v-for="t in departures" :key="t.id" class="card" :class="{ ready: t.state === 'READY_DEPART', dim: t.state === 'DWELL' && t.resvKind !== 'exit' }">
          <div class="card-top">
            <span class="kbar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="tnum mono">{{ t.number }}</span>
            <span class="troute mono">Gl {{ t.platform }} → {{ t.exitLine }}</span>
            <span v-if="t.state === 'DWELL'" class="dwell mono">{{ t.dwellLeft }}s Halt</span>
          </div>
          <div v-if="conn(t)" class="conn" :class="{ met: t.connectionMet }">🔗 {{ t.connectionMet ? 'Anschluss erreicht' : `wartet auf ${conn(t)?.number}` }}</div>
          <div v-if="t.resvKind === 'exit'" class="resv">
            <div class="resv-info">Ausfahrt → {{ t.exitLine }} vorgemerkt <span class="rstatus">{{ exitStatus(t) }}</span></div>
            <button class="key danger small-btn" @click="cancel(t)">✕</button>
          </div>
          <button v-else class="key primary wide" @click="reserveExit(t)">Ausfahrt → {{ t.exitLine }} vormerken</button>
        </div>
      </section>
    </div>

    <div class="toasts"><div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div></div>
  </div>
</template>

<style scoped>
.play { min-height: 100dvh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.banner { padding: 40px; text-align: center; color: var(--muted); }
.muted { color: var(--muted); } .small { font-size: 13px; } .mt { margin-top: 16px; }

.setup { padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.title { font-size: 30px; font-weight: 800; letter-spacing: 0.04em; }
.fld { display: flex; flex-direction: column; gap: 6px; margin-top: 18px; font-size: 13px; color: var(--muted); }
.inp { background: var(--panel-2); border: 2px solid var(--grid); color: var(--text); padding: 14px; font-size: 18px; font-weight: 700; }
.sec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sec { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 14px; border-left-width: 5px; }
.sec.w { border-left-color: #3bd1ff; } .sec.e { border-left-color: #ffd23b; }
.sec-id { font-size: 24px; font-weight: 800; } .sec-lbl { font-size: 11px; color: var(--muted); text-transform: none; letter-spacing: 0; }
.sec-own { font-size: 12px; color: var(--accent); text-transform: none; }
.sec.mine { border-color: var(--green); background: #1f3a23; } .sec.taken { opacity: 0.72; }
.hint { color: var(--amber); font-size: 13px; } .big { font-size: 18px; padding: 18px; margin-top: 12px; }

.panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; padding-bottom: 80px; }
.ph { display: flex; align-items: center; gap: 12px; } .ph .tiny { padding: 10px 14px; font-size: 18px; }
.ph-mid { flex: 1; } .ph-sec { font-size: 20px; font-weight: 800; }
.ph-stat .big { font-size: 26px; font-weight: 800; } .ph-stat .low { color: var(--red); }
.heads { display: flex; gap: 10px; }
.hpill { flex: 1; display: flex; align-items: center; gap: 8px; justify-content: center; padding: 10px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; }
.hpill.bad { border-color: var(--red); } .hpill.ok { border-color: var(--green); }
.vollhalt { background: #3a1816; border: 2px solid var(--red); color: #ffd0cc; font-weight: 800; text-align: center; padding: 14px; animation: blink 0.7s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0.5; } }

h3 { margin: 6px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.cnt { background: var(--green); color: #04210b; padding: 0 8px; font-weight: 800; } .cnt.amber { background: var(--amber); color: #2a1a00; }
.empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
.card { background: var(--panel); border: 2px solid var(--grid); padding: 12px; margin-bottom: 10px; }
.card.ready { border-color: var(--amber); } .card.dim { opacity: 0.7; }
.card-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kbar { width: 6px; height: 24px; } .tnum { font-size: 20px; font-weight: 800; } .ttype { font-size: 12px; color: var(--muted); }
.troute { margin-left: auto; font-weight: 700; } .dwell { color: var(--muted); }
.soll { margin-top: 8px; font-size: 13px; color: var(--muted); } .soll b { color: var(--accent); }
.delay { color: var(--amber); }
.conn { margin-top: 6px; font-size: 13px; color: var(--accent); } .conn.met { color: var(--green); }

.resv { display: flex; align-items: center; gap: 10px; margin-top: 12px; background: #2a2410; border: 2px dashed var(--amber); padding: 12px; }
.resv-info { flex: 1; font-weight: 700; color: #ffe6b0; }
.rstatus { display: block; font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 2px; }
.small-btn { padding: 12px 16px; }

.plat-row { display: grid; gap: 8px; margin-top: 12px; }
.plat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 0; font-size: 15px; }
.plat .ptag { font-size: 10px; letter-spacing: 0; text-transform: none; }
.plat.soll { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.plat.occ { opacity: 0.85; } .plat.bad { opacity: 0.3; }
.wide { width: 100%; margin-top: 12px; padding: 18px; font-size: 17px; }

.toasts { position: fixed; bottom: 10px; left: 10px; right: 10px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.toast { padding: 10px 14px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; font-size: 14px; }
.toast.good { border-color: var(--green); color: #c8ffd4; } .toast.bad { border-color: var(--red); color: #ffd0cc; } .toast.info { border-color: var(--grid); }
</style>
