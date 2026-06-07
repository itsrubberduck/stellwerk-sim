# Netzwerk-Korridor — Design (ersetzt Ein-Bahnhof-Modell)

Mehrere Stellwerke bilden einen Korridor. Jede:r Spieler:in betreibt am **Laptop**
ein eigenes Stellwerk; die Stellwerke sind über **Übergabegleise** verbunden.
Kern ist die **Zug-Übergabe** an den Nachbarn. Ein **Beamer** zeigt das Gesamtnetz.

## Entscheidungen (Brainstorming)
- Zugführung: **geplante Soll-Route durchs Netz, in deinem Abschnitt umleitbar** (Umleiten kostet).
- Geräte: **Beamer-Übersicht + Laptops** (jeder sein Stellbereich).
- Das Netzwerk **ersetzt** das alte Ein-Bahnhof-Modell (1 Spieler = Netz mit 1 Stellwerk).
- Steuerung **am Zug**: Klick → Menü (Gleis/Übergabegleis), Hover → geplante Route.

## Welt
- Kette `S1–S2–…–Sn` (n = Spielerzahl). Phase 1: n=2.
- Zwischen Nachbarn ein **Link** aus L≈4 **Übergabegleisen**.
- Kettenenden haben **Rand-Portale** (Züge entstehen/verlassen das Netz).
- Jedes Stellwerk = bestehendes Through-Layout. Eine Seite ist **PORTAL**, die
  andere **LINK** (Verbindung zum Nachbarn). S1: West=Portal, Ost=Link.
  S2: West=Link, Ost=Portal.

## Übergabe = geteilter Block (Multiplayer-Kern)
- Übergabegleis k = **gemeinsamer Block** (ein Zug). S1s Ost-Linie k ≙ S2s West-Linie k.
- Ausfahrt S1 Ost auf Gleis k → Zug in Transit auf Link k → erscheint bei S2 als
  **Einfahrt auf Linie k** → blockiert k, bis S2 ihn reinnimmt. Erst dann ist k frei.
- Spannung: du kannst erst übergeben, wenn der Nachbar geräumt hat.

## Zug & Soll-Route
- Jeder Zug: Gattung, **Laufweg** (Stationsfolge) + Richtung (E/W), und pro Stellwerk
  ein **Soll** = { Soll-Gleis, Soll-Ausfahrlinie (welches Übergabe-/Portalgleis) }.
- In deinem Stellwerk entscheidest du **Gleis** und **Ausfahrlinie**; Abweichung vom
  Soll = **Umleitung** → Punktabzug. Restriktionen (Gleisklassen) + weichengenaue
  Konflikte + **Vormerken** (Auto-Feuern in Reihenfolge) bleiben.

## Architektur
- Server: **NetworkEngine** hält alle Stellwerke (`Station`-Objekte) + Links + alle
  Züge, autoritativ, tick-basiert. Spawn an Portalen, Transfer über Links, Scoring.
- `Station` kapselt Layout, Bahnsteig-/Kopf-Zustand und die per-Stellwerk-Logik
  (Reservierung/Commit/Bewegung) — refaktoriert aus der bisherigen Engine.
- **Beamer `/`**: Gesamtübersicht (alle Stellwerke nebeneinander + Links + Züge),
  Lobby (Stellwerk beanspruchen, Start), HUD.
- **Laptop `/play`**: eigener Stellbereich, **interaktiv** — Zug anklicken → Menü
  (Gleis + Ausfahrlinie wählen/umleiten, vormerken), Hover → Soll-/Ist-Route
  hervorgehoben. Zeigt auch die Übergabegleise zu den Nachbarn.

## Topologie je Spielerzahl (Phase 2)
- 2 → A–B; 3 → A–B–C; 4 → Kette/Ring; ab 5 → Kette (nicht alle direkt verbunden).
- Phase 1 implementiert nur n=2 (beidseitig befahren).

## Wertung
- Gemeinsam: Netz-Pünktlichkeit, gelungene Übergaben, Abzüge für Umleitung /
  Verspätung / Zwangsbremsung. Überlastung (Rückstau an Portalen/Links) = Game Over.

## Phasen
- **Phase 1 (jetzt):** 2 Stellwerke, Übergabe-Block, Soll-Route + Umleiten,
  Klick/Hover-Steuerung, Übersichts-Screen.
- **Phase 2:** variable Spielerzahl + Topologien (Ring/Hub), Feinschliff.

## Wiederverwendung
Layout-Engine (Through/Terminus/Junction), Vormerken/Reservierung, Restriktionen,
weichengenaue Konflikte (routesConflict), Störungen. Neu: Netz-Verschaltung,
Zug-Transfer über Links, interaktive Zug-Steuerung, Gesamtübersicht.
