<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGame, sendMsg, setPlayerName } from '../composables/useGame'
import {
  PHASE_LABEL, PLATFORM_COUNT, SECTORS, SECTOR_LABEL, TRAIN_KINDS, sideOf,
  type SectorId, type TrainView
} from '../../shared/game'

const { snapshot, connected, playerId, toasts } = useGame('player')

const name = ref('')
const view = ref<'setup' | 'panel'>('setup')

onMounted(() => {
  try { name.value = localStorage.getItem('swk_name') || '' } catch {}
})

const s = computed(() => snapshot.value)
const me = computed(() => s.value?.players.find(p => p.id === playerId.value))
const mySectors = computed<SectorId[]>(() =>
  s.value?.soloMode ? [...SECTORS] : (me.value?.sectors ?? []))
const ownerOf = (sec: SectorId) => s.value?.players.find(p => p.sectors.includes(sec))
const globalStop = computed(() =>
  !!s.value?.disturbances.some(d => d.kind === 'PERSON_ON_TRACK' && d.phase === 'ACTIVE'))

function saveName() {
  try { localStorage.setItem('swk_name', name.value) } catch {}
  setPlayerName(name.value || 'FdL')
}
function toggleSector(sec: SectorId) {
  if (me.value?.sectors.includes(sec)) sendMsg({ t: 'releaseSector', sector: sec })
  else sendMsg({ t: 'claimSector', sector: sec })
}
function enterPanel() { saveName(); view.value = 'panel' }

const headFree = (side: 'W' | 'E') => {
  const h = s.value?.heads[side]
  return !!h && !h.lockedBy && !h.disabled && !globalStop.value
}

// trains I can act on
const arrivals = computed<TrainView[]>(() =>
  (s.value?.trains ?? []).filter(t => t.state === 'APPROACH' && mySectors.value.includes(t.entryLine)))
const departures = computed<TrainView[]>(() =>
  (s.value?.trains ?? []).filter(t => t.state === 'READY_DEPART' && mySectors.value.includes(t.exitLine)))
const dwelling = computed<TrainView[]>(() =>
  (s.value?.trains ?? []).filter(t => t.state === 'DWELL' && mySectors.value.includes(t.exitLine)))

function platformFree(p: number) {
  return s.value && s.value.platforms[p - 1] == null && !s.value.platformDisabled[p - 1]
}
function canEntry(t: TrainView, p: number) {
  return platformFree(p) && headFree(sideOf(t.entryLine))
}
function canExit(t: TrainView) {
  return headFree(sideOf(t.exitLine)) && s.value?.approach[t.exitLine] == null
}
function entry(t: TrainView, p: number) { if (canEntry(t, p)) sendMsg({ t: 'setEntry', trainId: t.id, platform: p }) }
function exit(t: TrainView) { if (canExit(t)) sendMsg({ t: 'setExit', trainId: t.id }) }

const platforms = Array.from({ length: PLATFORM_COUNT }, (_, i) => i + 1)
const conn = (t: TrainView) => t.connectionId
  ? (s.value?.trains.find(x => x.id === t.connectionId) ?? null) : null
</script>

<template>
  <div class="play">
    <div v-if="!connected" class="banner">Verbinde …</div>

    <!-- SETUP -->
    <div v-else-if="view === 'setup'" class="setup">
      <div class="title">Stellpult</div>
      <div class="muted small">Raum {{ s?.roomCode }} · {{ PHASE_LABEL[s?.phase ?? 'LOBBY'] }}</div>

      <label class="fld">Dein Name
        <input v-model="name" class="inp" maxlength="14" placeholder="FdL" @change="saveName" />
      </label>

      <div class="muted small mt">Wähle deine Sektoren (Linien-Zuläufe):</div>
      <div class="sec-grid">
        <button v-for="sec in SECTORS" :key="sec" class="key sec"
          :class="{ mine: me?.sectors.includes(sec), taken: ownerOf(sec) && !me?.sectors.includes(sec) }"
          @click="toggleSector(sec)">
          <span class="sec-id">{{ sec }}</span>
          <span class="sec-lbl">{{ SECTOR_LABEL[sec] }}</span>
          <span class="sec-own">{{ ownerOf(sec)?.name ?? 'frei' }}</span>
        </button>
      </div>
      <div v-if="s?.soloMode" class="hint">Solo-Notbetrieb aktiv — du steuerst alle Sektoren.</div>

      <button class="key primary big" :disabled="!s?.soloMode && (me?.sectors.length ?? 0) === 0" @click="enterPanel">
        Pult öffnen
      </button>
    </div>

    <!-- PANEL -->
    <div v-else class="panel">
      <header class="ph">
        <button class="key tiny" @click="view = 'setup'">≡</button>
        <div class="ph-mid">
          <div class="ph-sec mono">{{ mySectors.join(' ') || '—' }}</div>
          <div class="muted small">{{ PHASE_LABEL[s?.phase ?? 'LOBBY'] }}</div>
        </div>
        <div class="ph-stat">
          <div class="mono big" :class="{ low: (s?.punctualityPct ?? 100) < 70 }">{{ s?.punctualityPct }}%</div>
        </div>
      </header>

      <div class="heads">
        <div class="hpill" :class="headFree('W') ? 'ok' : 'bad'">
          <span class="led" :class="headFree('W') ? 'g' : 'r'" /> Kopf West
        </div>
        <div class="hpill" :class="headFree('E') ? 'ok' : 'bad'">
          <span class="led" :class="headFree('E') ? 'g' : 'r'" /> Kopf Ost
        </div>
      </div>

      <div v-if="globalStop" class="vollhalt">🛑 PERSON IM GLEIS — VOLLHALT</div>
      <div v-if="s?.phase === 'GAMEOVER'" class="vollhalt">Betrieb eingestellt</div>

      <!-- arrivals -->
      <section>
        <h3>Einfahrten <span v-if="arrivals.length" class="cnt">{{ arrivals.length }}</span></h3>
        <div v-if="!arrivals.length" class="empty">— wartet auf Anmeldung —</div>
        <div v-for="t in arrivals" :key="t.id" class="card">
          <div class="card-top">
            <span class="kbar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="tnum mono">{{ t.number }}</span>
            <span class="ttype">{{ TRAIN_KINDS[t.kind].label }}</span>
            <span class="troute mono">{{ t.entryLine }} → {{ t.exitLine }}</span>
          </div>
          <div v-if="conn(t)" class="conn">🔗 Anschluss mit {{ conn(t)?.number }}</div>
          <div v-if="t.delaySec > 0" class="delay">+{{ t.delaySec }}s Verspätung</div>
          <div class="plat-row">
            <button v-for="p in platforms" :key="p" class="key plat"
              :class="{ taken: !platformFree(p) }"
              :disabled="!canEntry(t, p)" @click="entry(t, p)">
              Gl {{ p }}
            </button>
          </div>
        </div>
      </section>

      <!-- departures -->
      <section>
        <h3>Ausfahrten <span v-if="departures.length" class="cnt amber">{{ departures.length }}</span></h3>
        <div v-if="!departures.length && !dwelling.length" class="empty">— keine —</div>
        <div v-for="t in departures" :key="t.id" class="card ready">
          <div class="card-top">
            <span class="kbar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="tnum mono">{{ t.number }}</span>
            <span class="troute mono">Gl {{ t.platform }} → {{ t.exitLine }}</span>
          </div>
          <div v-if="conn(t)" class="conn" :class="{ met: t.connectionMet }">
            🔗 {{ t.connectionMet ? 'Anschluss erreicht' : `wartet auf ${conn(t)?.number}` }}
          </div>
          <button class="key primary wide" :disabled="!canExit(t)" @click="exit(t)">
            Ausfahrt Gl {{ t.platform }} → {{ t.exitLine }}
          </button>
        </div>
        <!-- still dwelling, will need exit soon -->
        <div v-for="t in dwelling" :key="t.id" class="card dim">
          <div class="card-top">
            <span class="kbar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="tnum mono">{{ t.number }}</span>
            <span class="troute mono">Gl {{ t.platform }} → {{ t.exitLine }}</span>
            <span class="dwell mono">{{ t.dwellLeft }}s Halt</span>
          </div>
        </div>
      </section>
    </div>

    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.play { min-height: 100dvh; display: flex; flex-direction: column; }
.banner { margin: auto; color: var(--muted); }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.mt { margin-top: 16px; }

/* setup */
.setup { padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.title { font-size: 30px; font-weight: 800; letter-spacing: 0.04em; }
.fld { display: flex; flex-direction: column; gap: 6px; margin-top: 18px; font-size: 13px; color: var(--muted); }
.inp { background: var(--panel-2); border: 2px solid var(--grid); color: var(--text); padding: 14px; font-size: 18px; font-weight: 700; }
.sec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sec { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 14px; }
.sec-id { font-size: 26px; font-weight: 800; }
.sec-lbl { font-size: 11px; color: var(--muted); text-transform: none; letter-spacing: 0; }
.sec-own { font-size: 12px; color: var(--accent); text-transform: none; }
.sec.mine { border-color: var(--green); background: #1f3a23; }
.sec.taken { opacity: 0.7; }
.hint { color: var(--amber); font-size: 13px; }
.big { font-size: 18px; padding: 18px; margin-top: 12px; }

/* panel */
.panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; padding-bottom: 60px; }
.ph { display: flex; align-items: center; gap: 12px; }
.ph .tiny { padding: 10px 14px; font-size: 18px; }
.ph-mid { flex: 1; }
.ph-sec { font-size: 22px; font-weight: 800; }
.ph-stat .big { font-size: 28px; font-weight: 800; }
.ph-stat .low { color: var(--red); }
.heads { display: flex; gap: 10px; }
.hpill { flex: 1; display: flex; align-items: center; gap: 8px; justify-content: center; padding: 10px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; }
.hpill.bad { border-color: var(--red); }
.hpill.ok { border-color: var(--green); }
.vollhalt { background: #3a1816; border: 2px solid var(--red); color: #ffd0cc; font-weight: 800; text-align: center; padding: 14px; animation: blink 0.7s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0.5; } }

h3 { margin: 6px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.cnt { background: var(--green); color: #04210b; border-radius: 2px; padding: 0 8px; font-weight: 800; }
.cnt.amber { background: var(--amber); color: #2a1a00; }
.empty { color: var(--muted); font-size: 13px; padding: 8px 0; }

.card { background: var(--panel); border: 2px solid var(--grid); padding: 12px; margin-bottom: 10px; }
.card.ready { border-color: var(--amber); }
.card.dim { opacity: 0.6; }
.card-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kbar { width: 6px; height: 24px; }
.tnum { font-size: 20px; font-weight: 800; }
.ttype { font-size: 12px; color: var(--muted); }
.troute { margin-left: auto; color: var(--text); font-weight: 700; }
.dwell { color: var(--muted); }
.conn { margin-top: 8px; font-size: 13px; color: var(--accent); }
.conn.met { color: var(--green); }
.delay { margin-top: 4px; font-size: 13px; color: var(--amber); }
.plat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.plat { padding: 18px 0; font-size: 16px; }
.plat.taken { opacity: 0.4; }
.wide { width: 100%; margin-top: 12px; padding: 18px; font-size: 17px; }

.toasts { position: fixed; bottom: 10px; left: 10px; right: 10px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.toast { padding: 10px 14px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; font-size: 14px; }
.toast.good { border-color: var(--green); color: #c8ffd4; }
.toast.bad { border-color: var(--red); color: #ffd0cc; }
.toast.info { border-color: var(--grid); }
</style>
