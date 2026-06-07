<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { useGame, sendMsg } from '../composables/useGame'
import { PHASE_LABEL, avatarProfile, type TrainView } from '../../shared/game'
import { CORRIDOR_KIND_LABEL } from '../../shared/layout'
import { generateNetwork, type StationKind } from '../../shared/network'

const THROUGH_KINDS: StationKind[] = ['DURCHGANG', 'KNOTEN', 'ABZWEIG', 'GROSS']

const { snapshot, connected, toasts } = useGame('screen')

const joinUrl = ref(''); const qr = ref('')
watch(() => snapshot.value?.roomCode, async (code) => {
  if (!code) return
  joinUrl.value = `${location.origin}/play?room=${code}`
  qr.value = await QRCode.toDataURL(joinUrl.value, { margin: 1, width: 320, color: { dark: '#0c0f12', light: '#e7edf2' } })
}, { immediate: true })

const s = computed(() => snapshot.value)
const phase = computed(() => s.value?.phase ?? 'LOBBY')
const net = computed(() => generateNetwork(s.value?.netCount ?? 2, (s.value?.netTypes as StationKind[] | undefined)))
const stations = computed(() => net.value.stations)
const kindsFor = (i: number): StationKind[] => {
  const isEnd = i === 0 || i === (s.value?.netCount ?? 2) - 1
  return isEnd && (s.value?.netCount ?? 2) > 1 ? [...THROUGH_KINDS, 'KOPF'] : THROUGH_KINDS
}
function setType(i: number, kind: StationKind) { sendMsg({ t: 'setStationType', index: i, kind }) }
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const ownerOf = (sid: string) => s.value?.players.find(p => p.station === sid)
const ownerStyle = (sid: string) => {
  const owner = ownerOf(sid)
  return owner ? { '--owner-color': avatarProfile(owner.avatarId).color } : {}
}
const stationView = (sid: string) => s.value?.stations.find(st => st.id === sid)
const trainsIn = (sid: string): TrainView[] => (s.value?.trains ?? []).filter(t => t.station === sid)
const linkBetween = (aId: string) => s.value?.links.find(l => l.a === aId)

function start() { sendMsg({ t: 'start' }) }
function restart() { sendMsg({ t: 'restart' }) }
function abort() { if (confirm('Betrieb abbrechen und zurück zur Lobby?')) sendMsg({ t: 'abort' }) }
function setCount(n: number) { sendMsg({ t: 'setNetwork', count: n }) }
</script>

<template>
  <div class="screen">
    <div v-if="!connected" class="center muted">Verbinde mit Leitzentrale …</div>

    <!-- LOBBY -->
    <div v-else-if="phase === 'LOBBY'" class="lobby">
      <div class="lobby-left">
        <div class="brand">ICE&nbsp;·&nbsp;STELLWERK&nbsp;·&nbsp;KORRIDOR</div>
        <p class="muted lead">Mehrere Stellwerke, verbunden über Übergabegleise. Jede:r betreibt
          am Laptop einen Bereich und übergibt Züge an die Nachbarn.</p>

        <div class="muted small label">Stellwerke im Korridor</div>
        <div class="counts">
          <button v-for="n in [1,2,3,4,5]" :key="n" class="key cnt" :class="{ on: s?.netCount === n }" @click="setCount(n)">{{ n }}</button>
        </div>

        <div class="join">
          <img v-if="qr" :src="qr" class="qr" alt="QR" />
          <div>
            <div class="muted small">Laptop ins selbe WLAN, öffnen:</div>
            <div class="url mono">{{ joinUrl }}</div>
            <div class="code">RAUM <b class="mono">{{ s?.roomCode }}</b></div>
          </div>
        </div>

        <button class="key primary big" @click="start">Betrieb aufnehmen</button>
      </div>

      <div class="lobby-right">
        <div class="muted small label">Stellwerke &amp; Besetzung</div>
        <div class="st-list">
          <div v-for="(st, i) in stations" :key="st.id" class="st-row" :class="{ taken: !!ownerOf(st.id) }" :style="ownerStyle(st.id)">
            <div class="st-top">
              <div><div class="st-name">{{ st.name }}</div><div class="muted small">{{ CORRIDOR_KIND_LABEL[st.kind] }}</div></div>
              <div v-if="ownerOf(st.id)" class="owner-badge">
                <PlayerAvatar :avatar-id="ownerOf(st.id)!.avatarId" :size="58" />
                <b>{{ ownerOf(st.id)!.name }}</b>
              </div>
              <div v-else class="st-owner">frei</div>
            </div>
            <div class="type-chips">
              <button v-for="k in kindsFor(i)" :key="k" class="key chip" :class="{ on: st.kind === k }" @click="setType(i, k)">{{ CORRIDOR_KIND_LABEL[k] }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- OVERVIEW (running) -->
    <div v-else class="game">
      <header class="hud">
        <div class="stat big"><div class="num" :class="{ low: (s?.punctualityPct ?? 100) < 70 }">{{ s?.punctualityPct }}%</div><div class="lbl">Pünktlich</div></div>
        <div class="stat"><div class="num">{{ s?.score }}</div><div class="lbl">Punkte</div></div>
        <div class="stat"><div class="num">{{ s?.departed }}</div><div class="lbl">Durchs Netz</div></div>
        <div class="stat"><div class="num">{{ s?.handoffs }}</div><div class="lbl">Übergaben</div></div>
        <div class="stat"><div class="num" :class="{ low: (s?.deviations ?? 0) > 0 }">{{ s?.deviations }}</div><div class="lbl">Umleitungen</div></div>
        <div class="stat"><div class="num" :class="{ low: (s?.backlog ?? 0) > (s?.maxBacklog ?? 9) * 0.6 }">{{ s?.backlog }}/{{ s?.maxBacklog }}</div><div class="lbl">Rückstau</div></div>
        <div class="spacer" />
        <div class="stat"><div class="num">{{ fmtTime(s?.elapsed ?? 0) }}</div><div class="lbl">{{ PHASE_LABEL[phase] }}</div></div>
        <button class="key danger abort-btn" @click="abort">⊗ Abbrechen</button>
      </header>
      <div class="crew-strip">
        <div v-for="st in stations" :key="st.id" class="crew-member" :class="{ vacant: !ownerOf(st.id) }" :style="ownerStyle(st.id)">
          <PlayerAvatar v-if="ownerOf(st.id)" :avatar-id="ownerOf(st.id)!.avatarId" :size="42" />
          <div><b>{{ st.name }}</b><span>{{ ownerOf(st.id)?.name ?? 'unbesetzt' }}</span></div>
        </div>
      </div>

      <div class="corridor">
        <template v-for="(st, i) in stations" :key="st.id">
          <div class="st-panel" :class="{ owned: !!ownerOf(st.id) }" :style="ownerStyle(st.id)">
            <div class="st-head">
              <div><b>{{ st.name }}</b><span class="muted">{{ CORRIDOR_KIND_LABEL[st.kind] }}</span></div>
              <div v-if="ownerOf(st.id)" class="panel-owner">
                <PlayerAvatar :avatar-id="ownerOf(st.id)!.avatarId" :size="38" />
                <b>{{ ownerOf(st.id)!.name }}</b>
              </div>
              <span v-else class="muted">unbesetzt</span>
            </div>
            <div class="st-canvas">
              <StationCanvas v-if="stationView(st.id)" :layout="st.layout" :station="stationView(st.id)!" :trains="trainsIn(st.id)" compact />
            </div>
          </div>
          <div v-if="i < stations.length - 1" class="link-col">
            <div class="link-label">Übergabe</div>
            <div v-for="(occ, k) in linkBetween(st.id)?.occupant ?? []" :key="k" class="link-track" :class="{ busy: !!occ }">{{ k + 1 }}</div>
          </div>
        </template>
      </div>

      <div v-if="phase === 'GAMEOVER'" class="overlay">
        <div class="go-title">Betrieb eingestellt</div>
        <div class="go-stats"><span>{{ s?.punctualityPct }}% pünktlich</span> · <span>{{ s?.departed }} Züge</span> · <span>{{ s?.score }} Punkte</span></div>
        <button class="key primary big" @click="restart">Neue Schicht</button>
      </div>
    </div>

    <div class="toasts"><div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div></div>
  </div>
</template>

<style scoped>
.screen { position: fixed; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
.center { margin: auto; } .muted { color: var(--muted); } .small { font-size: 13px; }
.label { text-transform: uppercase; letter-spacing: 0.08em; margin: 14px 0 8px; }

.lobby { flex: 1; display: grid; grid-template-columns: 1.25fr 1fr; gap: 36px; padding: 4vh 4vw; overflow: auto; }
.brand { font-size: clamp(24px, 3.6vw, 52px); font-weight: 800; letter-spacing: 0.05em; }
.lead { font-size: clamp(13px, 1.3vw, 18px); max-width: 44ch; }
.counts { display: flex; gap: 10px; }
.cnt { width: 56px; height: 56px; font-size: 20px; } .cnt.on { border-color: var(--accent); background: #2a2410; }
.join { display: flex; gap: 22px; align-items: center; margin: 22px 0; }
.qr { width: clamp(130px, 13vw, 190px); border: 6px solid #e7edf2; background: #e7edf2; }
.url { color: var(--accent); word-break: break-all; } .code { margin-top: 8px; } .code b { color: var(--accent); font-size: 26px; }
.big { font-size: 18px; padding: 16px 26px; }
.lobby-right { background: var(--panel); border: 2px solid var(--grid); padding: 20px; overflow: auto; }
.st-list { display: flex; flex-direction: column; gap: 10px; }
.st-row { background: var(--panel-2); border: 2px solid var(--grid); border-left-width: 5px; padding: 12px; }
.st-row.taken { border-color: var(--owner-color); box-shadow: inset 5px 0 var(--owner-color); }
.st-top { display: flex; justify-content: space-between; align-items: baseline; }
.st-name { font-size: 18px; font-weight: 800; }
.st-owner { color: var(--accent); font-weight: 700; font-size: 13px; }
.owner-badge { display: flex; align-items: center; gap: 8px; color: var(--owner-color); font-size: 16px; }
.type-chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.chip { padding: 7px 10px; font-size: 12px; text-transform: none; letter-spacing: 0; }
.chip.on { border-color: var(--accent); background: #2a2410; color: var(--accent); }

.game { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.hud { display: flex; align-items: center; gap: 22px; padding: 10px 22px; background: var(--panel); border-bottom: 2px solid var(--grid); flex-wrap: wrap; }
.stat { text-align: center; } .stat .num { font-size: 24px; font-weight: 800; font-family: ui-monospace, monospace; } .stat.big .num { font-size: 36px; }
.stat .num.low { color: var(--red); } .stat .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; } .spacer { flex: 1; }
.abort-btn { padding: 9px 12px; font-size: 12px; }
.crew-strip { display: flex; gap: 8px; padding: 8px 12px; background: #10151a; border-bottom: 1px solid var(--grid); }
.crew-member { flex: 1 1 150px; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--owner-color); background: color-mix(in srgb, var(--owner-color) 10%, var(--panel)); }
.crew-member > div { display: flex; flex-direction: column; }.crew-member b { font-size: 13px; }.crew-member span { color: var(--owner-color); font-size: 12px; font-weight: 800; }
.crew-member.vacant { --owner-color: var(--grid); opacity: 0.55; }

.corridor { flex: 1; min-height: 0; display: flex; align-items: stretch; padding: 12px; gap: 0; }
.st-panel { flex: 1; min-width: 0; display: flex; flex-direction: column; border: 2px solid var(--grid); background: #0e1318; }
.st-panel.owned { border-color: var(--owner-color); box-shadow: 0 0 16px color-mix(in srgb, var(--owner-color) 22%, transparent); }
.st-head { min-height: 54px; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--grid); }
.st-head > div:first-child { display: flex; flex-direction: column; }.st-head b { font-size: 16px; } .st-head .muted { font-size: 11px; }
.panel-owner { display: flex; align-items: center; gap: 6px; color: var(--owner-color); }
.st-canvas { flex: 1; min-height: 0; }
.link-col { width: 70px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.link-label { font-size: 10px; color: var(--muted); text-transform: uppercase; writing-mode: vertical-rl; position: absolute; opacity: 0; }
.link-track { width: 40px; height: 26px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--grid); background: var(--panel-2); color: var(--muted); font-family: ui-monospace, monospace; font-weight: 700; font-size: 12px; }
.link-track.busy { border-color: var(--red); background: #3a1816; color: #ffd0cc; }

.overlay { position: absolute; inset: 0; background: rgba(8,10,13,0.86); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.go-title { font-size: 52px; font-weight: 800; color: var(--red); } .go-stats { font-size: 20px; }
.toasts { position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
.toast { padding: 9px 15px; border: 2px solid var(--grid); background: var(--panel-2); font-weight: 700; }
.toast.good { border-color: var(--green); color: #c8ffd4; } .toast.bad { border-color: var(--red); color: #ffd0cc; } .toast.info { border-color: var(--grid); }
</style>
