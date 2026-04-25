# SVG-Erstellung MVP

Dieser MVP liefert die Basis für euren späteren Gesamtprozess:

- Parameter im Browser anpassen.
- Live-Vorschau des SVG sehen.
- SVG lokal exportieren.
- SVG explizit freigeben, bevor der nächste Prozess startet.

## Starten

Da der Browser ES-Module lädt, bitte über einen lokalen Webserver starten:

```bash
python3 -m http.server 8080
```

Dann öffnen: <http://localhost:8080>

## Integrationspunkt für das Gesamtsystem

Bei Freigabe wird im Frontend ein Event ausgelöst:

- Event-Name: `svg-approved`
- Payload: `{ svg, params, approvedAt }`

Der Integrationspunkt ist in `src/app.js` in `startNextStep(...)` dokumentiert.
