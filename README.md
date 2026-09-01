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
- Maintenance-Status mit Reserve-Warnungen und API-MIN/MAX-Balken
- Priority Feed für Health- und Maintenance-Probleme
- Watchlist für frei wählbare Commodities
- Cross-POB Network Matrix für Maintenance + Watchlist
- Cargo Manifest mit Suche sowie Buy/Sell/Watch-Filtern
- Last-Good-Cache und klarer LIVE/CACHE/OFFLINE-Status
- installierbare PWA / Offline-App-Shell
- sichtbarer `UPDATE NOW`-Flow für neue App-Builds
- ATTENTION-Modus zum Ausblenden normaler/unkritischer Daten
- erweiterter System Check für Build, Runtime, Local Storage, Netzwerk, Darkstat, POB-Matches, PWA und Update-Status
- privacy-sicherer `COPY DIAGNOSTICS`-Report ohne Warenmengen, Preise oder POB-Credits
- Recovery für beschädigte lokale JSON-Caches
- persistente Attention-Einstellung und App-Präferenzen
- mobile Daumen-Navigation für ALL / SANCTUM / INVICTA / FORJA / TORRE
- sichtbare DTR-Version + Build-ID

## Facility Maintenance

Die drei Grundversorgungen sind bewusst Teil der Core-POB-Ansicht und nicht des späteren Produktionssystems:

- Basic Alloy
- Food Rations
- Consumer Goods

Aktuelle Reserve-Ampel: kritisch unter 2.500, niedrig unter 15.000, ansonsten operational. Die sichtbaren Stock-Balken verwenden – wenn von Darkstat geliefert – die echten API-Werte `min_stock` und `max_stock`.

## Noch nicht Teil der Grundstruktur

Produktionslinien, Rezepte und POB-spezifische Produktionslogik werden erst nach gemeinsamer Definition je POB ergänzt. Calculator-, Forum-/BBCode- und RHW-Comms-Funktionen sind für DTR derzeit ausdrücklich nicht vorgesehen.

## GitHub Pages

Live: `https://phytehq.github.io/DTR/`
