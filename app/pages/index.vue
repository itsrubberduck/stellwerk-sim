<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { useGame, sendMsg } from '../composables/useGame'
import { PHASE_LABEL, TRAIN_KINDS, type Preset } from '../../shared/game'
import { PRESETS, generateLayout } from '../../shared/layout'

const { snapshot, connected, toasts } = useGame('screen')

const joinUrl = ref('')
const qr = ref('')
watch(() => snapshot.value?.roomCode, async (code) => {
  if (!code) return
  joinUrl.value = `${location.origin}/play?room=${code}`
  qr.value = await QRCode.toDataURL(joinUrl.value, { margin: 1, width: 360, color: { dark: '#0c0f12', light: '#e7edf2' } })
}, { immediate: true })

const s = computed(() => snapshot.value)
const phase = computed(() => s.value?.phase ?? 'LOBBY')
const layout = computed(() => generateLayout(s.value?.preset ?? 'MITTEL'))
const lines = computed(() => layout.value.lines)
const ownerOf = (id: string) => s.value?.players.find(p => p.sectors.includes(id))
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const presetList = Object.keys(PRESETS) as Preset[]

function start() { sendMsg({ t: 'start' }) }
function restart() { sendMsg({ t: 'restart' }) }
function toggleSolo() { sendMsg({ t: 'setSolo', solo: !s.value?.soloMode }) }
function pickPreset(p: Preset) { sendMsg({ t: 'setPreset', preset: p }) }
</script>

<template>
  <div class="screen">
    <div v-if="!connected" class="center muted">Verbinde mit Leitstand …</div>

    <!-- LOBBY -->
    <div v-else-if="phase === 'LOBBY'" class="lobby">
      <div class="lobby-left">
        <div class="brand">ICE&nbsp;·&nbsp;STELLWERK&nbsp;·&nbsp;CHAOS</div>
        <p class="muted lead">Kooperatives Stellwerk. Jede:r übernimmt einen Sektor (Linie),
          bringt Züge rein, raus und durch — kreuzende Fahrstraßen sperren sich.</p>

        <div class="presets">
          <button v-for="p in presetList" :key="p" class="key preset" :class="{ on: s?.preset === p }" @click="pickPreset(p)">
            <span class="p-name">{{ PRESETS[p].name }}</span>
            <span class="p-meta mono">{{ PRESETS[p].w + PRESETS[p].e }} Linien · {{ PRESETS[p].p }} Gleise</span>
          </button>
        </div>

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
          <button class="key" :class="{ warn: s?.soloMode }" @click="toggleSolo">Solo-Notbetrieb: {{ s?.soloMode ? 'AN' : 'AUS' }}</button>
        </div>
      </div>

      <div class="lobby-right">
        <div class="sector-head">Sektoren · {{ PRESETS[s?.preset ?? 'MITTEL'].name }}</div>
        <div class="sector-grid" :style="{ gridTemplateColumns: lines.length > 4 ? '1fr 1fr 1fr' : '1fr 1fr' }">
          <div v-for="ln in lines" :key="ln.id" class="sector-card" :class="{ taken: !!ownerOf(ln.id), w: ln.side === 'W', e: ln.side === 'E' }">
            <div class="sector-id mono">{{ ln.id }}</div>
            <div class="sector-label">{{ ln.label }}</div>
            <div class="sector-owner">{{ ownerOf(ln.id)?.name ?? 'frei' }}</div>
          </div>
        </div>
        <div class="players">
          <div class="muted small">Verbunden ({{ s?.players.length ?? 0 }})</div>
          <div v-for="p in s?.players" :key="p.id" class="player-row">
            <span class="led" :class="p.connected ? 'g' : 'off'" /><span>{{ p.name }}</span>
            <span class="muted mono">{{ p.sectors.join(' ') || '–' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- GAME / GAMEOVER -->
    <div v-else class="game">
      <header class="hud">
        <div class="stat big"><div class="num" :class="{ low: (s?.punctualityPct ?? 100) < 70 }">{{ s?.punctualityPct }}%</div><div class="lbl">Pünktlich</div></div>
        <div class="stat"><div class="num">{{ s?.score }}</div><div class="lbl">Punkte</div></div>
        <div class="stat"><div class="num">{{ s?.departed }}</div><div class="lbl">Abgefertigt</div></div>
        <div class="stat"><div class="num">{{ s?.connectionsMade }}</div><div class="lbl">Anschlüsse</div></div>
        <div class="stat"><div class="num warn-num">{{ s?.forcedBrakes }}</div><div class="lbl">Zwangsbr.</div></div>
        <div class="stat"><div class="num" :class="{ low: (s?.backlog ?? 0) > (s?.maxBacklog ?? 9) * 0.6 }">{{ s?.backlog }}/{{ s?.maxBacklog }}</div><div class="lbl">Rückstau</div></div>
        <div class="spacer" />
        <div class="stat"><div class="num">{{ fmtTime(s?.elapsed ?? 0) }}</div><div class="lbl">{{ PHASE_LABEL[phase] }}</div></div>
        <div class="heads">
          <div class="head-pill"><span class="led" :class="s?.sideDisabled.W ? 'r' : 'g'" /> West</div>
          <div class="head-pill"><span class="led" :class="s?.sideDisabled.E ? 'r' : 'g'" /> Ost</div>
        </div>
      </header>

      <div class="board">
        <Stelltisch v-if="s" :snap="s" />
        <div v-if="phase === 'GAMEOVER'" class="overlay">
          <div class="go-title">Betrieb eingestellt</div>
          <div class="go-stats"><span>{{ s?.punctualityPct }}% pünktlich</span> · <span>{{ s?.departed }} Züge</span> · <span>{{ s?.score }} Punkte</span></div>
          <button class="key primary big" @click="restart">Neue Schicht</button>
        </div>
        <div class="disturb" v-if="s?.disturbances.length">
          <div v-for="d in s.disturbances" :key="d.id" class="dist-pill" :class="d.phase === 'ACTIVE' ? 'act' : 'warn'">
            {{ d.phase === 'WARN' ? '⚠' : '🛑' }}
            {{ d.kind === 'HEAD_FAULT' ? `Weichenstörung ${d.side === 'W' ? 'West' : 'Ost'}` : d.kind === 'PLATFORM_BLOCK' ? `Gleis ${d.platform} gesperrt` : 'Person im Gleis' }}
            <b class="mono">{{ d.secLeft }}s</b>
          </div>
        </div>
      </div>

      <footer class="fahrplan">
        <div class="fp-label">Nächste Einfahrten</div>
        <div class="fp-strip">
          <div v-for="(t, i) in s?.incoming" :key="i" class="fp-card">
            <span class="fp-bar" :style="{ background: TRAIN_KINDS[t.kind].color }" />
            <span class="fp-num mono">{{ t.number }}</span>
            <span class="fp-route mono">{{ t.entryLine }}→{{ t.exitLine }}</span>
            <span class="fp-eta mono">{{ t.inSec }}s</span>
          </div>
        </div>
      </footer>
    </div>

    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.screen { position: fixed; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
.center { margin: auto; }
.muted { color: var(--muted); } .small { font-size: 13px; }

.lobby { flex: 1; display: grid; grid-template-columns: 1.25fr 1fr; gap: 36px; padding: 4vh 4vw; overflow: auto; }
.brand { font-size: clamp(26px, 4vw, 58px); font-weight: 800; letter-spacing: 0.05em; }
.lead { font-size: clamp(13px, 1.3vw, 18px); max-width: 42ch; }
.presets { display: flex; gap: 12px; margin: 18px 0; flex-wrap: wrap; }
.preset { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px 16px; }
.preset.on { border-color: var(--accent); background: #2a2410; }
.p-name { font-size: 16px; text-transform: none; }
.p-meta { font-size: 12px; color: var(--muted); text-transform: none; letter-spacing: 0; }
.join { display: flex; gap: 24px; align-items: center; margin: 18px 0; }
.qr { width: clamp(140px, 14vw, 210px); height: auto; border: 6px solid #e7edf2; background: #e7edf2; }
.url { font-size: clamp(13px, 1.2vw, 19px); color: var(--accent); word-break: break-all; }
.code { margin-top: 10px; font-size: 18px; letter-spacing: 0.1em; } .code b { color: var(--accent); font-size: 28px; }
.controls { display: flex; gap: 14px; flex-wrap: wrap; }
.big { font-size: 19px; padding: 18px 28px; }

.lobby-right { background: var(--panel); border: 2px solid var(--grid); padding: 22px; display: flex; flex-direction: column; overflow: auto; }
.sector-head { font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; font-size: 14px; }
.sector-grid { display: grid; gap: 10px; }
.sector-card { background: var(--panel-2); border: 2px solid var(--grid); padding: 12px; border-left-width: 5px; }
.sector-card.w { border-left-color: #3bd1ff; } .sector-card.e { border-left-color: #ffd23b; }
.sector-card.taken { border-color: var(--green); }
.sector-id { font-size: 24px; font-weight: 800; }
.sector-label { color: var(--muted); font-size: 12px; }
.sector-owner { margin-top: 6px; font-weight: 700; color: var(--accent); font-size: 14px; }
.players { margin-top: auto; padding-top: 16px; }
.player-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }

.game { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.hud { display: flex; align-items: center; gap: 22px; padding: 10px 24px; background: var(--panel); border-bottom: 2px solid var(--grid); flex-wrap: wrap; }
.stat { text-align: center; }
.stat .num { font-size: 24px; font-weight: 800; font-family: ui-monospace, monospace; }
.stat.big .num { font-size: 38px; } .stat .num.low { color: var(--red); } .stat .num.warn-num { color: var(--amber); }
.stat .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.spacer { flex: 1; }
.heads { display: flex; gap: 10px; }
.head-pill { background: var(--panel-2); border: 2px solid var(--grid); padding: 8px 12px; font-weight: 700; display: flex; align-items: center; gap: 8px; }

.board { position: relative; flex: 1; min-height: 0; }
.disturb { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.dist-pill { padding: 8px 14px; font-weight: 800; border: 2px solid; }
.dist-pill.warn { background: #3a2a14; border-color: var(--amber); color: #ffe6b0; }
.dist-pill.act { background: #3a1816; border-color: var(--red); color: #ffd0cc; animation: blink 0.7s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0.45; } }
.overlay { position: absolute; inset: 0; background: rgba(8,10,13,0.86); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
.go-title { font-size: 54px; font-weight: 800; color: var(--red); } .go-stats { font-size: 21px; }

.fahrplan { background: var(--panel); border-top: 2px solid var(--grid); padding: 9px 18px; }
.fp-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.fp-strip { display: flex; gap: 10px; overflow: hidden; }
.fp-card { display: flex; align-items: center; gap: 9px; background: var(--panel-2); border: 2px solid var(--grid); padding: 7px 11px; white-space: nowrap; }
.fp-bar { width: 6px; height: 20px; } .fp-num { font-weight: 800; } .fp-route { color: var(--muted); } .fp-eta { color: var(--accent); }

.toasts { position: fixed; bottom: 86px; right: 18px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
.toast { padding: 9px 15px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; }
.toast.good { border-color: var(--green); color: #c8ffd4; } .toast.bad { border-color: var(--red); color: #ffd0cc; } .toast.info { border-color: var(--grid); }
</style>
