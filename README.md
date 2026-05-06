# PNG zu SVG mit Online-Convert

Diese App ersetzt die bisherige lokale Vektorisierung vollständig durch eine Automatisierung der Webseite
<https://image.online-convert.com/convert/png-to-svg>.

## Ablauf

1. Im lokalen Frontend eine PNG-Datei auswählen.
2. Der lokale Node-Server öffnet Online-Convert per Playwright.
3. Das PNG wird auf der Online-Convert-Webseite hochgeladen.
4. Die Konvertierung wird gestartet.
5. Die erzeugte SVG-Datei wird heruntergeladen.
6. Das Frontend zeigt die SVG an und kann sie erneut speichern.

## Installation

```bash
npm install
npx playwright install chromium
```

## Starten

```bash
npm start
```

Dann öffnen: <http://localhost:8080>

## Hinweise

- Die Konvertierung nutzt einen externen Dienst. Lade nur Dateien hoch, die dort verarbeitet werden dürfen.
- Wenn Online-Convert seine Oberfläche ändert, müssen eventuell die Playwright-Selektoren in `server.js` angepasst werden.
- Standardmäßig akzeptiert der Server Uploads bis 25 MB.

## Code prüfen

```bash
npm run check
```
