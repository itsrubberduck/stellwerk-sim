<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { useGame, sendMsg } from '../composables/useGame'
import {
  PHASE_LABEL, SECTORS, SECTOR_LABEL, TRAIN_KINDS, sideOf, type SectorId
} from '../../shared/game'

const { snapshot, connected, toasts } = useGame('screen')

const joinUrl = ref('')
const qr = ref('')
watch(() => snapshot.value?.roomCode, async (code) => {
  if (!code) return
  joinUrl.value = `${location.origin}/play?room=${code}`
  qr.value = await QRCode.toDataURL(joinUrl.value, {
    margin: 1, width: 360, color: { dark: '#0c0f12', light: '#e7edf2' }
  })
}, { immediate: true })

const s = computed(() => snapshot.value)
const phase = computed(() => s.value?.phase ?? 'LOBBY')
const ownerOf = (sec: SectorId) => s.value?.players.find(p => p.sectors.includes(sec))
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

const headState = (side: 'W' | 'E') => {
  const h = s.value?.heads[side]
  if (!h) return { txt: '—', cls: 'off' }
  if (h.disabled) return { txt: 'GESTÖRT', cls: 'r' }
  if (h.lockedBy) return { txt: 'BELEGT', cls: 'a' }
  return { txt: 'FREI', cls: 'g' }
}

function start() { sendMsg({ t: 'start' }) }
function restart() { sendMsg({ t: 'restart' }) }
function toggleSolo() { sendMsg({ t: 'setSolo', solo: !s.value?.soloMode }) }
</script>

<template>
  <div class="screen">
    <div v-if="!connected" class="center muted">Verbinde mit Leitstand …</div>

    <!-- LOBBY -->
    <div v-else-if="phase === 'LOBBY'" class="lobby">
      <div class="lobby-left">
        <div class="brand">ICE&nbsp;·&nbsp;STELLWERK&nbsp;·&nbsp;CHAOS</div>
        <p class="muted lead">Kooperatives Stellwerk für den Taktknoten. Jede:r übernimmt
          einen Sektor, bringt Züge rein, raus und durch — ohne Konflikt.</p>

        <div class="join">
          <img v-if="qr" :src="qr" class="qr" alt="QR" />
          <div class="join-info">
            <div class="muted small">Handy ins selbe WLAN, scannen oder öffnen:</div>
            <div class="url mono">{{ joinUrl }}</div>
            <div class="code">RAUM <b class="mono">{{ s?.roomCode }}</b></div>
          </div>
        </div>

        <div class="controls">
          <button class="key primary big" @click="start">Schicht beginnen</button>
          <button class="key" :class="{ warn: s?.soloMode }" @click="toggleSolo">
            Solo-Notbetrieb: {{ s?.soloMode ? 'AN' : 'AUS' }}
          </button>
        </div>
      </div>

      <div class="lobby-right">
        <div class="sector-head">Sektoren</div>
        <div class="sector-grid">
          <div v-for="sec in SECTORS" :key="sec" class="sector-card" :class="{ taken: !!ownerOf(sec) }">
            <div class="sector-id mono">{{ sec }}</div>
            <div class="sector-label">{{ SECTOR_LABEL[sec] }}</div>
            <div class="sector-owner">{{ ownerOf(sec)?.name ?? 'frei' }}</div>
          </div>
        </div>
        <div class="players">
          <div class="muted small">Verbunden ({{ s?.players.length ?? 0 }})</div>
          <div v-for="p in s?.players" :key="p.id" class="player-row">
            <span class="led" :class="p.connected ? 'g' : 'off'" />
            <span>{{ p.name }}</span>
            <span class="muted mono">{{ p.sectors.join(' ') || '–' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- GAME / GAMEOVER -->
    <div v-else class="game">
      <header class="hud">
        <div class="stat big">
          <div class="num" :class="{ low: (s?.punctualityPct ?? 100) < 70 }">{{ s?.punctualityPct }}%</div>
          <div class="lbl">Pünktlich</div>
        </div>
        <div class="stat"><div class="num">{{ s?.score }}</div><div class="lbl">Punkte</div></div>
        <div class="stat"><div class="num">{{ s?.departed }}</div><div class="lbl">Abgefertigt</div></div>
        <div class="stat"><div class="num">{{ s?.connectionsMade }}</div><div class="lbl">Anschlüsse</div></div>
        <div class="stat"><div class="num warn-num">{{ s?.forcedBrakes }}</div><div class="lbl">Zwangsbr.</div></div>
        <div class="spacer" />
        <div class="stat"><div class="num">{{ fmtTime(s?.elapsed ?? 0) }}</div><div class="lbl">{{ PHASE_LABEL[phase] }}</div></div>
        <div class="heads">
          <div class="head-pill">West <span class="led" :class="headState('W').cls" /> {{ headState('W').txt }}</div>
          <div class="head-pill">Ost <span class="led" :class="headState('E').cls" /> {{ headState('E').txt }}</div>
        </div>
      </header>

      <div class="board">
        <Stelltisch v-if="s" :snap="s" />

        <div v-if="phase === 'GAMEOVER'" class="overlay">
          <div class="go-title">Betrieb eingestellt</div>
          <div class="go-stats">
            <span>{{ s?.punctualityPct }}% pünktlich</span> ·
            <span>{{ s?.departed }} Züge</span> ·
            <span>{{ s?.score }} Punkte</span>
          </div>
          <button class="key primary big" @click="restart">Neue Schicht</button>
        </div>

        <!-- disturbance ticker -->
        <div class="disturb" v-if="s?.disturbances.length">
          <div v-for="d in s.disturbances" :key="d.id" class="dist-pill" :class="d.phase === 'ACTIVE' ? 'act' : 'warn'">
            {{ d.phase === 'WARN' ? '⚠' : '🛑' }}
            {{ d.kind === 'HEAD_FAULT' ? `Weichenstörung ${d.side === 'W' ? 'West' : 'Ost'}`
              : d.kind === 'PLATFORM_BLOCK' ? `Gleis ${d.platform} gesperrt`
              : 'Person im Gleis' }}
            <b class="mono">{{ d.secLeft }}s</b>
          </div>
        </div>
      </div>

      <!-- Fahrplan strip -->
      <footer class="fahrplan">
        <div class="fp-label">Nächste Einfahrten</div>
        <div class="fp-strip">
          <div v-for="(t, i) in s?.incoming" :key="i" class="fp-card">
            <span class="fp-bar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="fp-num mono">{{ t.number }}</span>
            <span class="fp-route mono">{{ t.entryLine }}→{{ t.exitLine }}</span>
            <span class="fp-eta mono">{{ t.inSec }}s</span>
          </div>
          <div v-if="(s?.backlog ?? 0) > 0" class="fp-card backlog">⏳ {{ s?.backlog }} ohne Gleis</div>
        </div>
      </footer>
    </div>

    <!-- toasts -->
    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.screen { position: fixed; inset: 0; display: flex; flex-direction: column; }
.center { margin: auto; }
.muted { color: var(--muted); }
.small { font-size: 13px; }

/* lobby */
.lobby { flex: 1; display: grid; grid-template-columns: 1.3fr 1fr; gap: 40px; padding: 5vh 5vw; }
.brand { font-size: clamp(28px, 4.5vw, 64px); font-weight: 800; letter-spacing: 0.05em; }
.lead { font-size: clamp(14px, 1.4vw, 20px); max-width: 36ch; }
.join { display: flex; gap: 28px; align-items: center; margin: 30px 0; }
.qr { width: clamp(150px, 16vw, 240px); height: auto; border: 6px solid #e7edf2; background: #e7edf2; }
.url { font-size: clamp(14px, 1.4vw, 22px); color: var(--accent); word-break: break-all; }
.code { margin-top: 12px; font-size: 20px; letter-spacing: 0.1em; }
.code b { color: var(--accent); font-size: 30px; }
.controls { display: flex; gap: 16px; flex-wrap: wrap; }
.big { font-size: 20px; padding: 20px 32px; }

.lobby-right { background: var(--panel); border: 2px solid var(--grid); padding: 24px; display: flex; flex-direction: column; }
.sector-head { font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 14px; }
.sector-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sector-card { background: var(--panel-2); border: 2px solid var(--grid); padding: 14px; }
.sector-card.taken { border-color: var(--green); }
.sector-id { font-size: 30px; font-weight: 800; }
.sector-label { color: var(--muted); font-size: 13px; }
.sector-owner { margin-top: 8px; font-weight: 700; color: var(--accent); }
.players { margin-top: auto; padding-top: 18px; }
.player-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }

/* game */
.game { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.hud { display: flex; align-items: center; gap: 28px; padding: 12px 28px; background: var(--panel); border-bottom: 2px solid var(--grid); }
.stat { text-align: center; }
.stat .num { font-size: 26px; font-weight: 800; font-family: ui-monospace, monospace; }
.stat.big .num { font-size: 40px; }
.stat .num.low { color: var(--red); }
.stat .num.warn-num { color: var(--amber); }
.stat .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.spacer { flex: 1; }
.heads { display: flex; gap: 12px; }
.head-pill { background: var(--panel-2); border: 2px solid var(--grid); padding: 8px 12px; font-weight: 700; display: flex; align-items: center; gap: 8px; }

.board { position: relative; flex: 1; min-height: 0; }
.disturb { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; }
.dist-pill { padding: 8px 16px; font-weight: 800; border: 2px solid; }
.dist-pill.warn { background: #3a2a14; border-color: var(--amber); color: #ffe6b0; }
.dist-pill.act { background: #3a1816; border-color: var(--red); color: #ffd0cc; animation: blink 0.7s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0.45; } }

.overlay { position: absolute; inset: 0; background: rgba(8,10,13,0.86); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; }
.go-title { font-size: 56px; font-weight: 800; color: var(--red); }
.go-stats { font-size: 22px; color: var(--text); }

.fahrplan { background: var(--panel); border-top: 2px solid var(--grid); padding: 10px 20px; }
.fp-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.fp-strip { display: flex; gap: 10px; overflow: hidden; }
.fp-card { display: flex; align-items: center; gap: 10px; background: var(--panel-2); border: 2px solid var(--grid); padding: 8px 12px; white-space: nowrap; }
.fp-bar { width: 6px; height: 22px; display: inline-block; }
.fp-num { font-weight: 800; }
.fp-route { color: var(--muted); }
.fp-eta { color: var(--accent); }
.fp-card.backlog { border-color: var(--amber); color: var(--amber); font-weight: 700; }

.toasts { position: fixed; bottom: 90px; right: 20px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
.toast { padding: 10px 16px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; }
.toast.good { border-color: var(--green); color: #c8ffd4; }
.toast.bad { border-color: var(--red); color: #ffd0cc; }
.toast.info { border-color: var(--grid); }
</style>
