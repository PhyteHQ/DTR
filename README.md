# DTR POB Tracker

Schlanke statische GitHub-Pages-Seite für vier DTR/Corsair POBs:

- Deterrence Sanctum
- Ravenna Invicta
- Forja del Vacio
- Fort Torrelavega

## Datenquelle

Live-POB-Daten werden direkt von Darkstat geladen:

`POST https://darkstat.dd84ai.com/api/pobs`

Die Seite nutzt nur HTML, CSS und Vanilla JavaScript. Es gibt keinen Server, keine Datenbank und kein Login.

## Funktionen

- Übersicht aller vier POBs
- POB-Tabs mit identischer Detailansicht
- Health, Credits, freier Storage, System/Region/Sector/Position
- komplettes POB-Inventar
- Base-buy/Base-sell-Preise
- Inventarsuche
- 5-Minuten-Autorefresh + manueller Refresh
- Last-Good-Cache im Browser, falls Darkstat kurz ausfällt
- responsive Mobile-Ansicht

## GitHub Pages

Repository öffentlich anlegen, Dateien in `main` legen und unter:

`Settings -> Pages -> Deploy from a branch -> main / (root)`

aktivieren.

Bei einem Repo `PhyteHQ/DTR` lautet die Seite anschließend:

`https://phytehq.github.io/DTR/`
