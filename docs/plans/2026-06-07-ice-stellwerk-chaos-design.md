# ICE-Stellwerk-Chaos — Design

Lokales Coop-Spiel für ICE-Nerds. Ein großer Screen ist der Leitstand, jede:r
Mitspieler:in verbindet sich per Handy als Stellpult. Läuft komplett im LAN über
`yarn dev --host`, keine Cloud.

## Entscheidungen (aus dem Brainstorming)

- **Coop-Modell:** Sektoren (Spaceteam-Stil). Jede:r besitzt einen Teil des
  Knotens; Züge wandern zwischen Sektoren → Zurufen erzwungen.
- **Aufmerksamkeit:** Screen = Spiel (Wahrheit), Handy = taktiles Pult nur für
  den eigenen Sektor. Augen bleiben am gemeinsamen Screen.
- **Optik:** Authentischer DrS/SpDrS-Spurplan. Flach und knackig, keine weichen
  Schatten/Rundungen. Touch-Flächen auf dem Handy klar erkennbar und gut
  treffbar (Tastenfeld-Look).
- **Spielerzahl:** 2–4 skalierend, plus Solo-Notbetrieb (1 Spieler steuert alles).

## Architektur

- **Nuxt 4 + Nitro-WebSocket** (`nitro.experimental.websocket`). Keine externen
  Dienste.
- **Server-autoritativ:** Eine `GameEngine` läuft auf dem Server und tickt die
  Simulation (~10 Hz). Der Screen ist reiner Renderer; Handys senden nur kurze
  Befehle. Damit kein Desync, Touch-Latenz unkritisch.
- **Routen:**
  - `/` — Leitstand-Screen. Lobby mit Room-Code + QR → live Stelltisch + Wertung.
  - `/play` — Handy-Stellpult. QR scannen → Room beitreten → Sektor wählen → Pult.
- **WebSocket** `/_ws`: Nachrichten `hello/join`, `claimSector`, `command`
  (Fahrstraße einstellen/auflösen, Störung quittieren), `start`. Server broadcastet
  Snapshots (Screen: voller State; Handy: gefilterter Sektor-State).
- **Ein aktiver Raum** pro Dev-Server (Room-Code nur für Flair + QR-URL).
- **QR:** kodiert `http://<screen-host>/play?room=<code>`. `<screen-host>` =
  `window.location.host` des Screens → Handys im selben WLAN sind sofort drin.

## Topologie (Taktknoten)

- **4 Linien-Zuläufe** in den Himmelsrichtungen NW, SW, NE, SE. Jeder Zulauf hat
  Einfahr- und Ausfahrsignal.
- **Bahnhofskopf** (West/Ost) mit Weichen verbindet die Zuläufe mit den
  **4 Bahnsteiggleisen** (Gl 1–4).
- **Blockprinzip:** jeder Block (Zulauf, Kopf-Fahrweg, Bahnsteig) hält genau
  einen Zug. Fahrstraße = Weg vom Signal über Kopf-Weichen auf ein Gleis (oder
  vom Gleis hinaus). Einstellen verschließt die beteiligten Blöcke/Weichen
  (Flankenschutz vereinfacht: sich kreuzende Kopf-Fahrwege schließen sich aus).

## Sektoren

- **Sektor = ein Linien-Zulauf** (NW/SW/NE/SE). Besitzt Einfahr-/Ausfahr-
  Fahrstraßen seiner Linie.
- 2 Spieler → je 2 Linien; 3 → 2/1/1; 4 → je eine. Solo → alle.
- Bahnsteige sind **geteilte Ressource** → Aushandeln/Zurufen. Ausfahrt erfolgt
  oft über die Linie eines anderen Spielers → Übergabe-Moment.

## Core Loop pro Zug

1. Zug wird auf Linie X angekündigt (Fahrplan-Streifen), mit Soll-Gleis-Wunsch
   bzw. freier Wahl, Zugtyp und ggf. Anschluss-Marker.
2. Sektor-X stellt **Einfahr-Fahrstraße** auf ein freies Gleis, bevor der Zug das
   Einfahrsignal erreicht. Sonst Halt am Signal → Verspätung wächst.
3. Zug hält am Bahnsteig (Haltezeit). **Anschluss:** zwei Züge müssen gleichzeitig
   am Bahnsteig stehen.
4. Zug fährt zur Soll-Zeit auf Linie Y aus; Sektor-Y stellt **Ausfahr-Fahrstraße**.

## Mechanik & Risiko

- **Konflikt:** Fahrstraße auf belegtes Gleis / sich kreuzender Kopf-Fahrweg →
  Einstellen verweigert. Fährt ein Zug dennoch in belegten Block (Fehlleitung)
  → **Zwangsbremsung**: großer Punktabzug, Zug steht bis zur Räumung.
- **Zugtypen & Gewichtung:** ICE-Sprinter ×3, ICE ×2, IC ×1, Güter ×0,5
  (Güter darf warten).
- **Störungen** (telegrafiert amber→rot, quittierbar): Weichenstörung im Kopf
  (Fahrweg umleiten), Gleissperrung (Bahnsteig gesperrt), Person im Gleis
  (globaler Halt).
- **Eskalation** in Phasen: Ruhe → Berufsverkehr → Störungsbetrieb (dichterer
  Takt, mehr Störungen).

## Scoring

- **Pünktlichkeitsquote** als Headline-Zahl.
- + Anschlüsse, + Durchsatz; − Verspätungsminuten (gewichtet), − Zwangsbremsung.
- Überfüllung/zu viele wartende Züge → Game Over.

## MVP-Scope

1. WS-Infra + Lobby + Join/QR + Sektor-Auswahl.
2. Server-Engine: Topologie, Blöcke, Fahrstraßen, Zuglauf, Zwangsbremsung,
   Verspätung, Anschlüsse, mind. 2–3 Störungen, Phasen, Scoring.
3. Screen-Renderer: Stelltisch-Canvas (authentisch, flach).
4. Handy-Stellpult: Sektor-Spurplan + große Touch-Tasten.
5. Solo-Fallback + Balancing + Spieltest über `yarn dev --host`.

## Nicht im MVP (YAGNI)

- Mehrere parallele Räume, Persistenz/Accounts, echte DB-Live-Daten,
  konfigurierbare Knoten-Layouts, Replays.
