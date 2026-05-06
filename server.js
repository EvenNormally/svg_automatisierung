import { createWriteStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const ONLINE_CONVERT_URL = 'https://image.online-convert.com/convert/png-to-svg';
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const TEXT_TYPES = new Map([
  ['.html', 'text/html;charset=utf-8'],
  ['.css', 'text/css;charset=utf-8'],
  ['.js', 'text/javascript;charset=utf-8'],
  ['.svg', 'image/svg+xml;charset=utf-8'],
]);

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, { 'content-type': 'application/json;charset=utf-8' });
  response.end(JSON.stringify(payload));
};

const sanitizeFilename = (filename) =>
  path
    .basename(filename || 'upload.png')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_UPLOAD_SIZE) {
        reject(new Error('Die Datei ist größer als 25 MB.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

const parseMultipartUpload = (body, contentType) => {
  const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);

  if (!boundaryMatch) {
    throw new Error('Ungültige Upload-Anfrage: Multipart-Boundary fehlt.');
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  let offset = 0;

  while (offset < body.length) {
    const boundaryStart = body.indexOf(boundary, offset);

    if (boundaryStart === -1) {
      break;
    }

    const headerStart = boundaryStart + boundary.length + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);

    if (headerEnd === -1) {
      break;
    }

    const header = body.subarray(headerStart, headerEnd).toString('utf8');
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);

    if (nextBoundary === -1) {
      break;
    }

    const disposition = header.match(/content-disposition:[^\r\n]*name="image"[^\r\n]*filename="([^"]+)"/i);

    if (disposition) {
      const fileContentEnd = nextBoundary - 2;
      return {
        filename: sanitizeFilename(disposition[1]),
        buffer: body.subarray(headerEnd + 4, fileContentEnd),
      };
    }

    offset = nextBoundary;
  }

  throw new Error('Keine Bilddatei im Feld „image“ gefunden.');
};

const clickIfVisible = async (page, locator, timeout = 2500) => {
  try {
    await locator.first().click({ timeout });
    return true;
  } catch {
    return false;
  }
};

const acceptCookieDialog = async (page) => {
  const candidates = [
    page.getByRole('button', { name: /accept all|alle akzeptieren|zustimmen/i }),
    page.locator('button:has-text("Accept")'),
    page.locator('button:has-text("Akzeptieren")'),
  ];

  for (const candidate of candidates) {
    if (await clickIfVisible(page, candidate, 1200)) {
      return;
    }
  }
};

const convertWithOnlineConvert = async ({ filePath, originalFilename }) => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(ONLINE_CONVERT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await acceptCookieDialog(page);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath, { timeout: 30_000 });

    const startButton = page
      .getByRole('button', { name: /start conversion|start konvertierung|start/i })
      .first();
    await startButton.click({ timeout: 30_000 });

    const downloadLocator = page
      .locator('a:has-text("Download"), a:has-text("Herunterladen"), a[download], a[href$=".svg"]')
      .first();
    await downloadLocator.waitFor({ state: 'visible', timeout: 180_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      downloadLocator.click(),
    ]);
    const downloadPath = await download.path();

    if (!downloadPath) {
      throw new Error('Online-Convert hat keine herunterladbare SVG-Datei bereitgestellt.');
    }

    const svg = await fs.readFile(downloadPath, 'utf8');
    const suggestedFilename = sanitizeFilename(download.suggestedFilename());

    return {
      filename: suggestedFilename || originalFilename.replace(/\.[^.]+$/, '.svg'),
      svg,
    };
  } finally {
    await context.close();
    await browser.close();
  }
};

const handleConvert = async (request, response) => {
  let uploadedPath;

  try {
    const body = await readRequestBody(request);
    const upload = parseMultipartUpload(body, request.headers['content-type'] || '');

    if (!upload.filename.toLowerCase().endsWith('.png')) {
      throw new Error('Bitte lade eine PNG-Datei hoch.');
    }

    uploadedPath = path.join(tmpdir(), `${Date.now()}-${upload.filename}`);
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(uploadedPath);
      stream.on('finish', resolve);
      stream.on('error', reject);
      stream.end(upload.buffer);
    });

    const result = await convertWithOnlineConvert({
      filePath: uploadedPath,
      originalFilename: upload.filename,
    });

    if (!result.svg.includes('<svg')) {
      throw new Error('Online-Convert hat keine gültige SVG-Datei geliefert.');
    }

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  } finally {
    if (uploadedPath) {
      await fs.rm(uploadedPath, { force: true });
    }
  }
};

const serveStaticFile = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(__dirname, requestedPath));

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const type = TEXT_TYPES.get(path.extname(filePath)) || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
};

createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/convert') {
    handleConvert(request, response);
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveStaticFile(request, response);
    return;
  }

  response.writeHead(405);
  response.end('Method not allowed');
}).listen(PORT, () => {
  console.log(`SVG-Konverter läuft auf http://localhost:${PORT}`);
});
