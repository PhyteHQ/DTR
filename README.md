# DTR POB Network Control

Schlanke Corsair-Kontrollseite für vier DTR-POBs:

- Deterrence Sanctum
- Ravenna Invicta
- Forja del Vacio
- Fort Torrelavega

Live-Daten: `POST https://darkstat.dd84ai.com/api/pobs`

## Aktuelle Grundstruktur

- Network Overview für alle vier Nodes
- Health, Credits, freier Storage und Standortdaten
- Facility Maintenance pro POB: Basic Alloy, Food Rations, Consumer Goods
- Maintenance-Status mit Reserve-Warnungen
- Priority Feed für Health- und Maintenance-Probleme
- Veränderungen gegenüber dem vorherigen Live-Snapshot
- Watchlist für frei wählbare Commodities
- Cross-POB Network Matrix für Maintenance + Watchlist
- Cargo Manifest mit Suche sowie Buy/Sell/Watch-Filtern
- Last-Good-Cache und klarer LIVE/CACHE/OFFLINE-Status
- installierbare PWA / Offline-App-Shell
- kompakter System Check für Netzwerk, Darkstat, POB-Auflösung, Local Storage und PWA
- responsive Mobile-Oberfläche

## Facility Maintenance

Die drei Grundversorgungen sind bewusst Teil der Core-POB-Ansicht und nicht des späteren Produktionssystems:

- Basic Alloy
- Food Rations
- Consumer Goods

Aktuelle Reserve-Ampel: kritisch unter 2.500, niedrig unter 15.000, ansonsten operational.

## Noch nicht Teil der Grundstruktur

Produktionslinien, Rezepte und POB-spezifische Produktionslogik werden erst nach gemeinsamer Definition je POB ergänzt. Calculator-, Forum-/BBCode- und RHW-Comms-Funktionen sind für DTR derzeit ausdrücklich nicht vorgesehen.

## GitHub Pages

Live: `https://phytehq.github.io/DTR/`
