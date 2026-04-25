const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export const createSvgMarkup = (params) => {
  const width = Math.max(1, Number(params.width) || 1);
  const height = Math.max(1, Number(params.height) || 1);
  const radius = Math.max(0, Math.min(width / 2, Math.min(height / 2, Number(params.radius) || 0)));
  const strokeWidth = Math.max(0, Number(params.strokeWidth) || 0);
  const background = params.background || '#ffffff';
  const accent = params.accent || '#0f62fe';
  const label = escapeXml(params.label || 'SVG Preview');
  const fontSize = Math.max(8, Number(params.fontSize) || 8);

  const centerX = width / 2;
  const centerY = height / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${background}" stroke="${accent}" stroke-width="${strokeWidth}"/>
  <circle cx="${centerX}" cy="${centerY}" r="${Math.max(12, Math.min(width, height) * 0.14)}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, strokeWidth * 0.8)}"/>
  <text x="50%" y="86%" text-anchor="middle" dominant-baseline="middle" fill="${accent}" font-size="${fontSize}" font-family="Inter, Arial, sans-serif">${label}</text>
</svg>`;
};
