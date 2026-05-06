# Schwarz-Weiß-Bild zu SVG

Diese Browser-App wandelt ein hochgeladenes Schwarz-Weiß-Bild in eine SVG-Datei um:

- Bild hochladen, z. B. `gti.png`.
- Schwellenwert einstellen, damit die schwarze Form sauber erkannt wird.
- Optional auf die erkannte Form zuschneiden.
- Die erkannte schwarze Kontur als transparente SVG exportieren oder freigeben.

Die SVG enthält keine eingebettete Rastergrafik, sondern einen echten `<path>` mit `fill="#000000"` und `fill-rule="evenodd"`, damit auch weiße Aussparungen innerhalb der schwarzen Form erhalten bleiben. Die Kontur wird subpixelgenau aus den Helligkeitswerten berechnet, sodass Anti-Aliasing-Kanten deutlich sauberer nachgezeichnet werden als mit einer reinen Pixel-Treppen-Kontur.

## Starten

Da der Browser ES-Module lädt, bitte über einen lokalen Webserver starten:

```bash
python3 -m http.server 8080
```

Dann öffnen: <http://localhost:8080>

## Bedienung

1. Über **Schwarz-Weiß-Bild** eine PNG/JPG/WebP-Datei auswählen.
2. Falls zu viel oder zu wenig erkannt wird, den **Schwellenwert für Schwarz** anpassen.
3. Mit **Glättung** die Anzahl der Stützpunkte reduzieren. `0` exportiert maximal detailgetreu, kleine Werte wie `0.15` entfernen nur minimales Zittern, höhere Werte glätten stärker.
4. **SVG exportieren** lädt die erzeugte Datei `schwarze-form.svg` herunter.
5. **SVG freigeben & weiter** löst weiterhin das Integrations-Event aus.

## Integrationspunkt für das Gesamtsystem

Bei Freigabe wird im Frontend ein Event ausgelöst:

- Event-Name: `svg-approved`
- Payload: `{ svg, params, approvedAt }`

Der Integrationspunkt ist in `src/app.js` in `startNextStep(...)` dokumentiert.
