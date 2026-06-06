// Single-room manager: owns the engine, the tick loop and connected peers.

import { GameEngine } from './engine'
import type { ClientMessage, ServerMessage } from '../../shared/game'

interface PeerMeta {
  role: 'screen' | 'player' | 'unknown'
  playerId?: string
}

interface Peerish {
  send: (data: string) => void
}

class Room {
  engine = new GameEngine()
  peers = new Map<Peerish, PeerMeta>()
  private last = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null

  ensureLoop() {
    if (this.timer) return
    this.last = Date.now()
    this.timer = setInterval(() => this.loop(), 100)
  }

  private loop() {
    const now = Date.now()
    const dt = Math.min(0.25, (now - this.last) / 1000)
    this.last = now
    this.engine.tick(dt)
    const snap: ServerMessage = { t: 'snapshot', state: this.engine.snapshot() }
    const payload = JSON.stringify(snap)
    for (const peer of this.peers.keys()) peer.send(payload)
    for (const toast of this.engine.drainToasts()) {
      const msg: ServerMessage = { t: 'toast', ...toast }
      const p = JSON.stringify(msg)
      for (const peer of this.peers.keys()) peer.send(p)
    }
  }

  add(peer: Peerish) {
    this.peers.set(peer, { role: 'unknown' })
    this.ensureLoop()
    this.sendSnapshot(peer)
  }

  remove(peer: Peerish) {
    const meta = this.peers.get(peer)
    if (meta?.playerId) {
      // mark disconnected only if no other peer holds this player
      const stillHere = [...this.peers.entries()].some(([p, m]) => p !== peer && m.playerId === meta.playerId)
      if (!stillHere) this.engine.setPlayerConnected(meta.playerId, false)
    }
    this.peers.delete(peer)
  }

  private sendSnapshot(peer: Peerish) {
    const snap: ServerMessage = { t: 'snapshot', state: this.engine.snapshot() }
    peer.send(JSON.stringify(snap))
  }

  private send(peer: Peerish, msg: ServerMessage) { peer.send(JSON.stringify(msg)) }

  handle(peer: Peerish, raw: string) {
    let msg: ClientMessage
    try { msg = JSON.parse(raw) } catch { return }
    const meta = this.peers.get(peer)
    if (!meta) return
    const e = this.engine

    switch (msg.t) {
      case 'helloScreen':
        meta.role = 'screen'
        break
      case 'helloPlayer': {
        meta.role = 'player'
        const id = msg.playerId || `p${Math.random().toString(36).slice(2, 8)}`
        meta.playerId = id
        e.addPlayer(id, msg.name ?? '')
        this.send(peer, { t: 'welcome', playerId: id })
        break
      }
      case 'claimSector':
        if (meta.playerId) e.claimSector(meta.playerId, msg.sector)
        break
      case 'releaseSector':
        if (meta.playerId) e.releaseSector(meta.playerId, msg.sector)
        break
      case 'setEntry':
        e.setEntry(msg.trainId, msg.platform)
        break
      case 'setExit':
        e.setExit(msg.trainId)
        break
      case 'ackDisturbance':
        break // client-side dismiss only
      case 'start':
        e.start()
        break
      case 'restart':
        e.restart()
        break
      case 'setSolo':
        e.setSolo(msg.solo)
        break
    }
    this.sendSnapshot(peer)
  }
}

export const room = new Room()
