# Schwarz-Weiß-Bild zu SVG

Diese Browser-App wandelt ein hochgeladenes Schwarz-Weiß-Bild in eine SVG-Datei um:

- Bild hochladen, z. B. `gti.png`.
- Schwellenwert automatisch bestimmen lassen oder manuell einstellen.
- Kleine schwarze Störpixel über ein Speckle-Limit entfernen.
- Optional auf die erkannte Form zuschneiden.
- Die erkannte schwarze Kontur als transparente SVG exportieren oder freigeben.

Die SVG enthält keine eingebettete Rastergrafik, sondern einen echten `<path>` mit `fill="#000000"` und `fill-rule="evenodd"`, damit auch weiße Aussparungen innerhalb der schwarzen Form erhalten bleiben.

Die Vektorisierung ist bewusst auf Schwarz-Weiß-Quellen optimiert: Das Bild wird per Helligkeitsschwelle in eine Binärmaske gewandelt, kleine zusammenhängende Störflächen können entfernt werden und anschließend werden nur die Außenkanten der schwarzen Pixel in geschlossene SVG-Pfade überführt. Dadurch arbeitet die Konvertierung linear zur Pixelanzahl und erzeugt für Logos, Stempel, Scans oder Piktogramme sehr robuste Konturen.

## Starten

Da der Browser ES-Module lädt, bitte über einen lokalen Webserver starten:

```bash
python3 -m http.server 8080
```

Dann öffnen: <http://localhost:8080>

## Bedienung

1. Über **Schwarz-Weiß-Bild** eine PNG/JPG/WebP-Datei auswählen.
2. **Automatisch passenden Schwarz-Weiß-Schwellenwert wählen** aktiv lassen, wenn die App wie ein Online-Converter selbst zwischen Vordergrund und Hintergrund trennen soll.
3. Falls zu viel oder zu wenig erkannt wird, die Automatik deaktivieren und den **Schwellenwert für Schwarz** manuell anpassen.
4. Mit **Speckle entfernen bis Pixelgröße** kleine schwarze Flecken unterhalb der angegebenen zusammenhängenden Pixelanzahl entfernen. `0` deaktiviert diesen Schritt.
5. Mit **Konturen vereinfachen** die Anzahl der Stützpunkte reduzieren. `0` exportiert maximal detailgetreu; ein kleiner Wert wie `0.15` entfernt nur unnötige Zwischenpunkte auf fast geraden Kanten.
6. **SVG exportieren** lädt die erzeugte Datei `schwarze-form.svg` herunter.
7. **SVG freigeben & weiter** löst weiterhin das Integrations-Event aus.

## Code prüfen

Vor Änderungen oder vor dem Weitergeben kannst du Syntax und Vektorisierungs-Tests ausführen:

```bash
npm run check
```

Der Check prüft `src/app.js` und `src/vectorize.js` syntaktisch und testet die SVG-Vektorisierung mit Node.js.

## Integrationspunkt für das Gesamtsystem

Bei Freigabe wird im Frontend ein Event ausgelöst:

- Event-Name: `svg-approved`
- Payload: `{ svg, params, approvedAt }`

Der Integrationspunkt ist in `src/app.js` in `startNextStep(...)` dokumentiert.
