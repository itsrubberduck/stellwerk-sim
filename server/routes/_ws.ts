// WebSocket endpoint. The screen and all phones connect here.

import { roomHub } from '../utils/room'

export default defineWebSocketHandler({
  message(peer, message) {
    roomHub.handle(peer, message.text())
  },
  close(peer) {
    roomHub.remove(peer)
  },
  error(peer) {
    roomHub.remove(peer)
  }
})
