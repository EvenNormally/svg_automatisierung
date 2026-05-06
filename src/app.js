import { downloadSvg } from './export.js';
import { vectorizeBlackShape } from './vectorize.js';

const form = document.querySelector('#parameter-form');
const fileInput = document.querySelector('#image-file');
const previewElement = document.querySelector('#preview');
const statusElement = document.querySelector('#status');
const svgCodeElement = document.querySelector('#svg-code');
const exportButton = document.querySelector('#export-btn');
const approveButton = document.querySelector('#approve-btn');
const uploadedImage = document.querySelector('#uploaded-image');

let currentSvg = '';
let currentParams = {};
let approvedSvg = '';
let currentImage = null;

const readFormState = () => {
  const data = new FormData(form);
  const params = Object.fromEntries(data.entries());

  return {
    ...params,
    crop: data.has('crop'),
  };
};

const setActionState = (enabled) => {
  exportButton.disabled = !enabled;
  approveButton.disabled = !enabled;
};

const getImageData = (image) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const render = () => {
  currentParams = readFormState();

  if (!currentImage) {
    currentSvg = '';
    previewElement.innerHTML = '<p class="empty-state">Bitte lade ein Schwarz-Weiß-Bild hoch.</p>';
    svgCodeElement.textContent = '';
    setActionState(false);
    return;
  }

  const result = vectorizeBlackShape(getImageData(currentImage), currentParams);
  currentSvg = result.svg;

  previewElement.innerHTML = currentSvg || '<p class="empty-state">Keine schwarze Form erkannt.</p>';
  svgCodeElement.textContent = currentSvg;
  setActionState(Boolean(currentSvg));

  if (!currentSvg) {
    statusElement.textContent = 'Keine schwarze Form erkannt. Erhöhe den Schwellenwert oder prüfe das Bild.';
    return;
  }

  statusElement.textContent = `${result.shapeCount} Kontur(en) erkannt. SVG-Größe: ${result.width} × ${result.height}px.`;

  if (approvedSvg && approvedSvg !== currentSvg) {
    statusElement.textContent =
      'Bild oder Einstellungen geändert. Bitte SVG erneut freigeben, bevor der nächste Prozessschritt startet.';
  }
};

const loadSelectedImage = (file) => {
  if (!file) {
    currentImage = null;
    render();
    return;
  }

  const imageUrl = URL.createObjectURL(file);
  uploadedImage.onload = () => {
    URL.revokeObjectURL(imageUrl);
    currentImage = uploadedImage;
    approvedSvg = '';
    render();
  };
  uploadedImage.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    currentImage = null;
    statusElement.textContent = 'Das Bild konnte nicht geladen werden.';
    render();
  };
  uploadedImage.src = imageUrl;
};

const startNextStep = ({ svg, params }) => {
  const event = new CustomEvent('svg-approved', {
    detail: {
      svg,
      params,
      approvedAt: new Date().toISOString(),
    },
  });

  window.dispatchEvent(event);

  // TODO: Integriere hier den Aufruf des nächsten Workflowschritts, z. B. API-Request.
};

fileInput.addEventListener('change', () => {
  loadSelectedImage(fileInput.files?.[0]);
});

form.addEventListener('input', render);

exportButton.addEventListener('click', () => {
  downloadSvg({ markup: currentSvg, filename: 'schwarze-form.svg' });
  statusElement.textContent = 'SVG wurde als Datei exportiert.';
});

approveButton.addEventListener('click', () => {
  approvedSvg = currentSvg;
  statusElement.textContent =
    'SVG freigegeben. Nachgelagerter Prozess kann jetzt mit genau diesem SVG weiterlaufen.';

  startNextStep({ svg: approvedSvg, params: currentParams });
});

window.addEventListener('svg-approved', (event) => {
  console.debug('SVG-Freigabe-Event für Systemintegration:', event.detail);
});

setActionState(false);
render();
