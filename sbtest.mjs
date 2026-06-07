import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:3000/_ws')
let snap = null
const send = (m) => ws.send(JSON.stringify(m))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.t === 'snapshot') snap = m.state
  if (m.t === 'toast') console.log('TOAST', m.kind, m.text)
})

function lineSide(id){ return id[0]==='W'?'W':'E' }

async function main() {
  await new Promise(r => ws.on('open', r))
  send({ t: 'helloScreen', roomCode: 'SBTEST' })
  await sleep(300)
  send({ t: 'setNetwork', count: 2 })
  send({ t: 'setSolo', solo: true })
  await sleep(200)
  send({ t: 'start' })
  await sleep(500)

  // Drive: route every approaching train into a platform, then exit toward the link (east),
  // so trains hand off from S1 -> S2. Once a train is APPROACH at S2 having arrived via link, sendBack it.
  let tested = false
  for (let step = 0; step < 600 && !tested; step++) {
    await sleep(100)
    if (!snap) continue
    const stById = Object.fromEntries(snap.stations.map(s => [s.id, s]))
    for (const t of snap.trains) {
      const st = snap.stations.find(s => s.id === t.station)
      if (!st) continue
      // Identify if this train is at S2 (second station) arriving via link on its W side
      if (t.station === 'S2' && t.state === 'APPROACH' && t.arrLine.startsWith('W') && t.arrLink) {
        console.log(`>>> sendBack candidate ${t.number} at ${t.station} arrLine=${t.arrLine} dir=${t.dir} arrLink=${JSON.stringify(t.arrLink)}`)
        send({ t: 'sendBack', trainId: t.id })
        await sleep(400)
        const after = snap.trains.find(x => x.id === t.id)
        console.log('>>> after sendBack:', after ? `station=${after.station} state=${after.state} dir=${after.dir} arrLine=${after.arrLine}` : 'GONE')
        tested = true
        break
      }
    }
    if (tested) break
    // progress all approaching/dwell trains
    for (const t of snap.trains) {
      if (t.state === 'APPROACH' && t.resvKind == null) {
        // pick soll platform
        send({ t: 'setEntry', trainId: t.id, platform: t.sollPlatform })
      } else if ((t.state === 'DWELL' || t.state === 'READY_DEPART') && t.resvKind == null) {
        // exit: prefer an east (link) line for S1 so it hands to S2; else use soll exit
        const exitLine = t.station === 'S1' ? (t.sollExitLine && t.sollExitLine.startsWith('E') ? t.sollExitLine : 'E1') : t.sollExitLine
        if (exitLine) send({ t: 'setExit', trainId: t.id, exitLine })
      }
    }
  }
  if (!tested) console.log('!!! never reached a sendBack candidate')
  ws.close()
  process.exit(0)
}
main()
