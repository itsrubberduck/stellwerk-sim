import { ref, shallowRef } from 'vue'
import type { ClientMessage, GameSnapshot, ServerMessage } from '../../shared/game'

export interface Toast { id: number, kind: 'good' | 'bad' | 'info', text: string }

let socket: WebSocket | null = null
const snapshot = shallowRef<GameSnapshot | null>(null)
const connected = ref(false)
const playerId = ref<string | null>(null)
const toasts = ref<Toast[]>([])
let toastSeq = 0
const queue: ClientMessage[] = []
let role: 'screen' | 'player' = 'screen'
let helloName = ''
let started = false

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/_ws`
}

function flush() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    while (queue.length) socket.send(JSON.stringify(queue.shift()))
  }
}

export function sendMsg(msg: ClientMessage) {
  queue.push(msg)
  flush()
}

function hello() {
  if (role === 'screen') sendMsg({ t: 'helloScreen' })
  else sendMsg({ t: 'helloPlayer', name: helloName, playerId: playerId.value ?? undefined })
}

function connect() {
  socket = new WebSocket(wsUrl())
  socket.onopen = () => {
    connected.value = true
    hello()
    flush()
  }
  socket.onclose = () => {
    connected.value = false
    setTimeout(() => { if (started) connect() }, 800)
  }
  socket.onerror = () => { socket?.close() }
  socket.onmessage = (ev) => {
    let msg: ServerMessage
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.t === 'snapshot') snapshot.value = msg.state
    else if (msg.t === 'welcome') {
      playerId.value = msg.playerId
      try { localStorage.setItem('swk_playerId', msg.playerId) } catch {}
    } else if (msg.t === 'toast') {
      const toast: Toast = { id: ++toastSeq, kind: msg.kind, text: msg.text }
      toasts.value = [...toasts.value, toast].slice(-5)
      setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== toast.id) }, 4200)
    }
  }
}

export function useGame(asRole: 'screen' | 'player', name = '') {
  if (!started) {
    started = true
    role = asRole
    helloName = name
    if (asRole === 'player') {
      try { playerId.value = localStorage.getItem('swk_playerId') } catch {}
    }
    connect()
  }
  return { snapshot, connected, playerId, toasts, sendMsg }
}

export function setPlayerName(name: string) {
  helloName = name
  sendMsg({ t: 'helloPlayer', name, playerId: playerId.value ?? undefined })
}
