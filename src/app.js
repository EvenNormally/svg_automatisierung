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

const COMPARISON_MAX_SIDE = 360;
const THRESHOLD_SEARCH_OFFSETS = [-48, -32, -20, -12, -6, 0, 6, 12, 20, 32, 48];
const EXTRA_THRESHOLD_CANDIDATES = [64, 96, 128, 160, 192];
const TOLERANCE_CANDIDATES = [0, 0.03, 0.08, 0.15, 0.25, 0.4];
const PATH_CANDIDATES = [
  { pathMode: 'line', smoothingPasses: 0, curveTension: 0 },
  { pathMode: 'curve', smoothingPasses: 0, curveTension: 0.65 },
  { pathMode: 'curve', smoothingPasses: 1, curveTension: 0.65 },
];

let currentSvg = '';
let currentParams = {};
let approvedSvg = '';
let currentImage = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getPixelIndex = (x, y, width) => y * width + x;

const getPixelBlackness = (data, pixelIndex) => {
  const dataIndex = pixelIndex * 4;
  const alpha = data[dataIndex + 3] / 255;
  const luminance =
    0.2126 * data[dataIndex] + 0.7152 * data[dataIndex + 1] + 0.0722 * data[dataIndex + 2];

  return alpha * (1 - luminance / 255);
};

const getUniqueNumbers = (values) =>
  [...new Set(values.map((value) => Number(value.toFixed(3))))].sort((first, second) => first - second);

const readFormState = () => {
  const data = new FormData(form);
  const params = Object.fromEntries(data.entries());

  return {
    ...params,
    autoOptimize: data.has('autoOptimize'),
    crop: data.has('crop'),
  };
};

const syncParameterControlState = () => {
  const formData = new FormData(form);
  const autoOptimize = formData.has('autoOptimize');

  for (const field of form.querySelectorAll('[name="threshold"], [name="tolerance"]')) {
    field.disabled = autoOptimize;
  }
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

const createThresholdCandidates = (imageData) => {
  const estimated = vectorizeBlackShape(imageData, { autoOptimize: true, crop: false }).parameters.threshold ?? 128;
  const centered = THRESHOLD_SEARCH_OFFSETS.map((offset) => clamp(estimated + offset, 0, 255));

  return getUniqueNumbers([...centered, ...EXTRA_THRESHOLD_CANDIDATES]);
};

const compareSvgPathWithImage = (imageData, pathData) => {
  if (!pathData || typeof Path2D === 'undefined') {
    return Number.POSITIVE_INFINITY;
  }

  const { data, width, height } = imageData;
  const scale = Math.min(1, COMPARISON_MAX_SIDE / Math.max(width, height));
  const comparisonWidth = Math.max(1, Math.round(width * scale));
  const comparisonHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = comparisonWidth;
  canvas.height = comparisonHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.save();
  context.scale(scale, scale);
  context.fillStyle = '#000000';
  context.fill(new Path2D(pathData), 'evenodd');
  context.restore();

  const rendered = context.getImageData(0, 0, comparisonWidth, comparisonHeight).data;
  let error = 0;

  for (let y = 0; y < comparisonHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));

    for (let x = 0; x < comparisonWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const renderedPixelIndex = getPixelIndex(x, y, comparisonWidth);
      const sourcePixelIndex = getPixelIndex(sourceX, sourceY, width);
      const targetBlackness = getPixelBlackness(data, sourcePixelIndex);
      const svgBlackness = getPixelBlackness(rendered, renderedPixelIndex);
      const difference = targetBlackness - svgBlackness;
      error += difference * difference;
    }
  }

  return error / (comparisonWidth * comparisonHeight);
};

const findBestMatchingParameters = (imageData, params) => {
  if (typeof Path2D === 'undefined') {
    return null;
  }

  let best = null;

  for (const threshold of createThresholdCandidates(imageData)) {
    for (const tolerance of TOLERANCE_CANDIDATES) {
      for (const pathCandidate of PATH_CANDIDATES) {
        const candidateParams = {
          ...params,
          autoOptimize: false,
          crop: false,
          threshold,
          tolerance,
          ...pathCandidate,
        };
        const result = vectorizeBlackShape(imageData, candidateParams);
        const matchError = compareSvgPathWithImage(imageData, result.pathData);

        if (!best || matchError < best.matchError) {
          best = {
            matchError,
            parameters: candidateParams,
          };
        }
      }
    }
  }

  return best;
};

const vectorizeWithBestPreviewMatch = (imageData, params) => {
  if (!params.autoOptimize) {
    return vectorizeBlackShape(imageData, params);
  }

  const best = findBestMatchingParameters(imageData, params);

  if (!best) {
    return vectorizeBlackShape(imageData, params);
  }

  const result = vectorizeBlackShape(imageData, {
    ...params,
    ...best.parameters,
    crop: params.crop,
  });

  return {
    ...result,
    parameters: {
      ...result.parameters,
      autoOptimize: true,
      matchError: best.matchError,
    },
  };
};

const render = () => {
  syncParameterControlState();
  currentParams = readFormState();

  if (!currentImage) {
    currentSvg = '';
    previewElement.innerHTML = '<p class="empty-state">Bitte lade ein Schwarz-Weiß-Bild hoch.</p>';
    svgCodeElement.textContent = '';
    setActionState(false);
    return;
  }

  const result = vectorizeWithBestPreviewMatch(getImageData(currentImage), currentParams);
  currentParams = { ...currentParams, resolvedParameters: result.parameters };
  currentSvg = result.svg;

  previewElement.innerHTML = currentSvg || '<p class="empty-state">Keine schwarze Form erkannt.</p>';
  svgCodeElement.textContent = currentSvg;
  setActionState(Boolean(currentSvg));

  if (!currentSvg) {
    statusElement.textContent = 'Keine schwarze Form erkannt. Erhöhe den Schwellenwert oder prüfe das Bild.';
    return;
  }

  const parameterInfo = result.parameters?.autoOptimize
    ? [
        ` Automatisch per Bildvergleich: Schwellenwert ${Math.round(result.parameters.threshold)}`,
        `Glättung ${result.parameters.tolerance.toFixed(2)}`,
        result.parameters.pathMode === 'curve' ? 'Kurvenpfad' : 'Linienpfad',
        Number.isFinite(result.parameters.matchError)
          ? `Abweichung ${(result.parameters.matchError * 100).toFixed(2)}%`
          : 'Abweichung nicht messbar',
      ].join(', ')
    : '';
  statusElement.textContent = `${result.shapeCount} Kontur(en) erkannt. SVG-Größe: ${result.width} × ${result.height}px.${parameterInfo}`;

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
