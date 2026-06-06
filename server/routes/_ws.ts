// WebSocket endpoint. The screen and all phones connect here.

import { room } from '../utils/room'

export default defineWebSocketHandler({
  open(peer) {
    room.add(peer)
  },
  message(peer, message) {
    room.handle(peer, message.text())
  },
  close(peer) {
    room.remove(peer)
  },
  error(peer) {
    room.remove(peer)
  }
})
