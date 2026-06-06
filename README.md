# ICE · Stellwerk · Chaos

Kooperatives Stellwerk-Spiel für ICE-Nerds. Ein großer Screen ist der Leitstand,
alle Mitspieler:innen verbinden sich per Handy als Stellpult. Läuft komplett im
lokalen WLAN — keine Cloud.

## Starten

```bash
yarn install
yarn dev --host
```

- **Großer Screen / Beamer:** `http://localhost:3000/` öffnen (oder die `Network:`-URL).
- **Handys:** im selben WLAN den QR-Code auf dem Screen scannen (führt auf `/play`).

> Hinweis: Das `dev`-Script setzt `TMPDIR=$HOME/.tmp/`, um die Nuxt-4.4-Regression
> mit langen macOS-`/var/folders`-Temp-Pfaden (`Failed to restrict vite-node
> socket permissions`) zu umgehen.

## So wird gespielt

Ein Taktknoten mit vier Linien-Zuläufen (NW/SW/NE/SE) und vier Bahnsteiggleisen.

1. Am Screen **Schicht beginnen** drücken.
2. Jede:r wählt am Handy eine:n oder mehrere **Sektoren** (= Linien). Bei 2
   Spielern je zwei Linien, bei 4 je eine. **Solo-Notbetrieb** lässt eine Person
   alles steuern.
3. **Einfahrt:** ankommenden Zug am Handy auf ein freies Gleis stellen.
4. **Halt:** Haltezeit am Bahnsteig abwarten (Anschlüsse 🔗 müssen sich treffen).
5. **Ausfahrt:** Zug auf seine Ziellinie ausfahren lassen — oft die Linie einer
   anderen Person → zurufen!

**Regeln & Risiko:** Blockprinzip (ein Block, ein Zug). Ein Bahnhofskopf (West/Ost)
lässt nur einen Zug gleichzeitig durch. Auf eine belegte Ausfahrlinie kann nicht
ausgefahren werden. Telegrafierte Störungen (Weichenstörung, Gleissperrung, Person
im Gleis) → Kopf rechtzeitig freihalten, sonst **Zwangsbremsung**. Überlasteter
Knoten = Betrieb eingestellt.

Wertung: Pünktlichkeitsquote, Anschlüsse, Punkte; Sprinter zählen ×3, Güter ×0,5.

## Architektur

- **Nuxt 4 + Nitro-WebSocket** (`/_ws`), server-autoritative Simulation.
- `server/utils/engine.ts` — die Spiel-Engine (Tick-Loop, Topologie, Scoring).
- `server/utils/room.ts` — Raum/Peers + 10-Hz-Broadcast.
- `app/pages/index.vue` — Leitstand-Screen, `app/components/Stelltisch.vue` — Canvas.
- `app/pages/play.vue` — Handy-Stellpult.
- `shared/game.ts` — geteilte Typen/Konstanten.

Design-Dokument: `docs/plans/2026-06-07-ice-stellwerk-chaos-design.md`.
