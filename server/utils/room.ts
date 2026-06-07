// Room instances own one isolated simulation and their connected peers.

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
  engine: GameEngine
  peers = new Map<Peerish, PeerMeta>()
  private last = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(code: string) {
    this.engine = new GameEngine(code)
  }

  ensureLoop() {
    if (this.timer) return
    this.last = Date.now()
    this.timer = setInterval(() => this.loop(), 100)
  }

  stopLoop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
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
    if (this.peers.size === 0) this.stopLoop()
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
        const previousId = meta.playerId
        const id = msg.playerId || `p${Math.random().toString(36).slice(2, 8)}`
        const player = e.addPlayer(id, msg.avatarId)
        meta.playerId = player.id
        for (const oldId of new Set([previousId, id])) {
          if (!oldId || oldId === player.id) continue
          const oldPlayerStillHere = [...this.peers.entries()].some(([p, m]) => p !== peer && m.playerId === oldId)
          if (!oldPlayerStillHere) e.setPlayerConnected(oldId, false)
        }
        this.send(peer, { t: 'welcome', playerId: player.id })
        break
      }
      case 'claimStation':
        if (meta.playerId) e.claimStation(meta.playerId, msg.station)
        break
      case 'releaseStation':
        if (meta.playerId) e.releaseStation(meta.playerId, msg.station)
        break
      case 'setEntry':
        e.setEntry(msg.trainId, msg.platform)
        break
      case 'setExit':
        e.setExit(msg.trainId, msg.exitLine)
        break
      case 'park':
        e.park(msg.trainId, msg.siding)
        break
      case 'retrieve':
        e.retrieve(msg.trainId, msg.platform)
        break
      case 'cancelResv':
        e.cancelResv(msg.trainId)
        break
      case 'sendBack':
        e.sendBack(msg.trainId)
        break
      case 'start':
        e.start()
        break
      case 'restart':
        e.restart()
        break
      case 'abort':
        e.abort()
        break
      case 'setSolo':
        e.setSolo(msg.solo)
        break
      case 'setNetwork':
        e.setNetwork(msg.count)
        break
      case 'setStationType':
        e.setStationType(msg.index, msg.kind)
        break
    }
    this.sendSnapshot(peer)
  }
}

const normalizeRoomCode = (value?: string) => value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || ''
const randomRoomCode = () => Math.random().toString(36).slice(2, 6).toUpperCase()

class RoomHub {
  rooms = new Map<string, Room>()
  peerRooms = new Map<Peerish, Room>()

  remove(peer: Peerish) {
    const room = this.peerRooms.get(peer)
    if (room) room.remove(peer)
    this.peerRooms.delete(peer)
  }

  handle(peer: Peerish, raw: string) {
    let msg: ClientMessage
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.t === 'helloScreen' || msg.t === 'helloPlayer') {
      const requested = normalizeRoomCode(msg.roomCode)
      let code = requested
      if (!code) {
        do code = randomRoomCode()
        while (this.rooms.has(code))
      }

      const current = this.peerRooms.get(peer)
      let room = this.rooms.get(code)
      if (!room) {
        room = new Room(code)
        this.rooms.set(code, room)
      }
      if (current !== room) {
        if (current) current.remove(peer)
        room.add(peer)
        this.peerRooms.set(peer, room)
      }
      room.handle(peer, raw)
      return
    }

    this.peerRooms.get(peer)?.handle(peer, raw)
  }
}

export const roomHub = new RoomHub()
