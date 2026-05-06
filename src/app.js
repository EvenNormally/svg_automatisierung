const form = document.querySelector('#converter-form');
const fileInput = document.querySelector('#image-file');
const convertButton = document.querySelector('#convert-btn');
const downloadButton = document.querySelector('#download-btn');
const statusElement = document.querySelector('#status');
const previewElement = document.querySelector('#preview');
const svgCodeElement = document.querySelector('#svg-code');
const fileNameElement = document.querySelector('#file-name');

let convertedSvg = '';
let convertedFileName = 'converted.svg';

const setStatus = (message, type = 'info') => {
  statusElement.textContent = message;
  statusElement.dataset.type = type;
};

const setBusy = (busy) => {
  convertButton.disabled = busy || !fileInput.files?.length;
  fileInput.disabled = busy;
};

const resetResult = () => {
  convertedSvg = '';
  convertedFileName = 'converted.svg';
  downloadButton.disabled = true;
  previewElement.innerHTML = '<p class="empty-state">Noch keine SVG-Datei konvertiert.</p>';
  svgCodeElement.textContent = '';
};

const ensureSvgMarkup = (markup) => {
  if (!markup.includes('<svg')) {
    throw new Error('Die heruntergeladene Datei enthält kein SVG-Markup.');
  }

  return markup.trim();
};

const renderSvg = (markup) => {
  convertedSvg = ensureSvgMarkup(markup);
  previewElement.innerHTML = convertedSvg;
  svgCodeElement.textContent = convertedSvg;
  downloadButton.disabled = false;
};

const downloadConvertedSvg = () => {
  if (!convertedSvg) {
    return;
  }

  const blob = new Blob([convertedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = convertedFileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const convertSelectedFile = async () => {
  const file = fileInput.files?.[0];

  if (!file) {
    setStatus('Bitte wähle zuerst eine PNG-Datei aus.', 'error');
    return;
  }

  resetResult();
  setBusy(true);
  setStatus(
    'Bild wird zu Online-Convert hochgeladen. Die Konvertierung kann je nach Dateigröße etwas dauern …',
  );

  try {
    const payload = new FormData();
    payload.append('image', file);

    const response = await fetch('/api/convert', {
      method: 'POST',
      body: payload,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Die Konvertierung ist fehlgeschlagen.');
    }

    convertedFileName = result.filename || file.name.replace(/\.png$/i, '.svg') || 'converted.svg';
    renderSvg(result.svg);
    setStatus(`SVG wurde von Online-Convert heruntergeladen: ${convertedFileName}`, 'success');
  } catch (error) {
    resetResult();
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
};

fileInput.addEventListener('change', () => {
  resetResult();
  convertButton.disabled = !fileInput.files?.length;
  fileNameElement.textContent = fileInput.files?.[0]?.name || 'Keine Datei ausgewählt';

  if (fileInput.files?.length) {
    setStatus('Bereit zum Hochladen auf Online-Convert.');
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  convertSelectedFile();
});

downloadButton.addEventListener('click', downloadConvertedSvg);

resetResult();
setBusy(false);
setStatus('Wähle eine PNG-Datei aus, um sie über Online-Convert in SVG umzuwandeln.');
