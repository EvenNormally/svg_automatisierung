import { createSvgMarkup } from './svg-template.js';
import { downloadSvg } from './export.js';

const form = document.querySelector('#parameter-form');
const previewElement = document.querySelector('#preview');
const statusElement = document.querySelector('#status');
const svgCodeElement = document.querySelector('#svg-code');
const exportButton = document.querySelector('#export-btn');
const approveButton = document.querySelector('#approve-btn');

let currentSvg = '';
let currentParams = {};
let approvedSvg = '';

const readFormState = () => {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
};

const render = () => {
  currentParams = readFormState();
  currentSvg = createSvgMarkup(currentParams);

  previewElement.innerHTML = currentSvg;
  svgCodeElement.textContent = currentSvg;

  if (approvedSvg && approvedSvg !== currentSvg) {
    statusElement.textContent =
      'Parameter geändert. Bitte SVG erneut freigeben, bevor der nächste Prozessschritt startet.';
  }
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

form.addEventListener('input', render);

exportButton.addEventListener('click', () => {
  downloadSvg({ markup: currentSvg });
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

render();
