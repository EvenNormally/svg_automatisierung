const POINT_KEY_PRECISION = 4;
const DEFAULT_THRESHOLD = 128;
const DEFAULT_TOLERANCE = 0.15;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const numberOrDefault = (value, defaultValue) => {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : defaultValue;
};

const formatNumber = (value) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
};

const getPointKey = ([x, y]) => `${x.toFixed(POINT_KEY_PRECISION)},${y.toFixed(POINT_KEY_PRECISION)}`;

const getSampleIndex = (x, y, width) => y * width + x;

const getPixelIndex = (x, y, width) => y * width + x;

const getSamplePoint = (x, y) => [x - 0.5, y - 0.5];

const getBoundsFromLoops = (loops) => {
  if (!loops.length) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const loop of loops) {
    for (const [x, y] of loop) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, minY, maxX, maxY };
};

const createDarknessSamples = (imageData) => {
  const { data, width, height } = imageData;
  const sampleWidth = width + 2;
  const sampleHeight = height + 2;
  const samples = new Float32Array(sampleWidth * sampleHeight);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dataIndex = getPixelIndex(x, y, width) * 4;
      const alpha = data[dataIndex + 3] / 255;
      const luminance = 0.2126 * data[dataIndex] + 0.7152 * data[dataIndex + 1] + 0.0722 * data[dataIndex + 2];
      const darkness = (255 - luminance) * alpha;

      samples[getSampleIndex(x + 1, y + 1, sampleWidth)] = darkness;
    }
  }

  return { samples, sampleWidth, sampleHeight };
};

const interpolatePoint = (pointA, pointB, valueA, valueB, isoValue) => {
  if (valueA === valueB) {
    return [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
  }

  const ratio = clamp((isoValue - valueA) / (valueB - valueA), 0, 1);
  return [pointA[0] + (pointB[0] - pointA[0]) * ratio, pointA[1] + (pointB[1] - pointA[1]) * ratio];
};

const getCellIntersections = ({ x, y, topLeft, topRight, bottomRight, bottomLeft, isoValue }) => {
  const points = {
    top: interpolatePoint(getSamplePoint(x, y), getSamplePoint(x + 1, y), topLeft, topRight, isoValue),
    right: interpolatePoint(getSamplePoint(x + 1, y), getSamplePoint(x + 1, y + 1), topRight, bottomRight, isoValue),
    bottom: interpolatePoint(getSamplePoint(x, y + 1), getSamplePoint(x + 1, y + 1), bottomLeft, bottomRight, isoValue),
    left: interpolatePoint(getSamplePoint(x, y), getSamplePoint(x, y + 1), topLeft, bottomLeft, isoValue),
  };

  return points;
};

const getSegmentsForCell = (caseIndex, intersections) => {
  const { top, right, bottom, left } = intersections;

  switch (caseIndex) {
    case 1:
      return [[left, bottom]];
    case 2:
      return [[bottom, right]];
    case 3:
      return [[left, right]];
    case 4:
      return [[right, top]];
    case 5:
      return [
        [left, top],
        [bottom, right],
      ];
    case 6:
      return [[bottom, top]];
    case 7:
      return [[left, top]];
    case 8:
      return [[top, left]];
    case 9:
      return [[top, bottom]];
    case 10:
      return [
        [top, right],
        [left, bottom],
      ];
    case 11:
      return [[top, right]];
    case 12:
      return [[right, left]];
    case 13:
      return [[right, bottom]];
    case 14:
      return [[bottom, left]];
    default:
      return [];
  }
};

const addSegment = (segments, edgesByPoint, start, end) => {
  const startKey = getPointKey(start);
  const endKey = getPointKey(end);

  if (startKey === endKey) {
    return;
  }

  const edge = { start, end, startKey, endKey, used: false };
  segments.push(edge);

  for (const key of [startKey, endKey]) {
    if (!edgesByPoint.has(key)) {
      edgesByPoint.set(key, []);
    }

    edgesByPoint.get(key).push(edge);
  }
};

const buildSubpixelSegments = (imageData, luminanceThreshold) => {
  const { samples, sampleWidth, sampleHeight } = createDarknessSamples(imageData);
  const threshold = clamp(numberOrDefault(luminanceThreshold, DEFAULT_THRESHOLD), 0, 255);
  const isoValue = clamp(255 - threshold + 0.5, 0.5, 254.5);
  const segments = [];
  const edgesByPoint = new Map();

  for (let y = 0; y < sampleHeight - 1; y += 1) {
    for (let x = 0; x < sampleWidth - 1; x += 1) {
      const topLeft = samples[getSampleIndex(x, y, sampleWidth)];
      const topRight = samples[getSampleIndex(x + 1, y, sampleWidth)];
      const bottomRight = samples[getSampleIndex(x + 1, y + 1, sampleWidth)];
      const bottomLeft = samples[getSampleIndex(x, y + 1, sampleWidth)];
      const caseIndex =
        (topLeft >= isoValue ? 8 : 0) |
        (topRight >= isoValue ? 4 : 0) |
        (bottomRight >= isoValue ? 2 : 0) |
        (bottomLeft >= isoValue ? 1 : 0);

      if (caseIndex === 0 || caseIndex === 15) {
        continue;
      }

      const intersections = getCellIntersections({ x, y, topLeft, topRight, bottomRight, bottomLeft, isoValue });

      for (const [start, end] of getSegmentsForCell(caseIndex, intersections)) {
        addSegment(segments, edgesByPoint, start, end);
      }
    }
  }

  return { segments, edgesByPoint };
};

const getOtherPoint = (edge, pointKey) => (edge.startKey === pointKey ? edge.end : edge.start);

const getOtherKey = (edge, pointKey) => (edge.startKey === pointKey ? edge.endKey : edge.startKey);

const getNextUnusedEdge = (edgesByPoint, pointKey) => (edgesByPoint.get(pointKey) || []).find((edge) => !edge.used) || null;

const traceLoops = (segments, edgesByPoint) => {
  const loops = [];

  for (const segment of segments) {
    if (segment.used) {
      continue;
    }

    const startKey = segment.startKey;
    const points = [segment.start, segment.end];
    let currentKey = segment.endKey;

    segment.used = true;

    while (currentKey !== startKey) {
      const nextEdge = getNextUnusedEdge(edgesByPoint, currentKey);

      if (!nextEdge) {
        break;
      }

      const nextPoint = getOtherPoint(nextEdge, currentKey);
      currentKey = getOtherKey(nextEdge, currentKey);
      nextEdge.used = true;
      points.push(nextPoint);
    }

    const first = points[0];
    const last = points.at(-1);

    if (points.length > 3 && Math.abs(first[0] - last[0]) < 0.0001 && Math.abs(first[1] - last[1]) < 0.0001) {
      loops.push(points);
    }
  }

  return loops;
};

const perpendicularDistance = (point, lineStart, lineEnd) => {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }

  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
};

const simplifyOpenPoints = (points, tolerance) => {
  if (points.length <= 2 || tolerance <= 0) {
    return points;
  }

  let maxDistance = 0;
  let splitIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points.at(-1));

    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points.at(-1)];
  }

  const left = simplifyOpenPoints(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyOpenPoints(points.slice(splitIndex), tolerance);

  return left.slice(0, -1).concat(right);
};

const simplifyClosedLoop = (loop, tolerance) => {
  if (loop.length <= 4 || tolerance <= 0) {
    return loop;
  }

  const openLoop = loop.slice(0, -1);
  const anchorIndex = openLoop.reduce((bestIndex, point, index) => {
    const best = openLoop[bestIndex];
    return point[0] < best[0] || (point[0] === best[0] && point[1] < best[1]) ? index : bestIndex;
  }, 0);
  const rotated = openLoop.slice(anchorIndex).concat(openLoop.slice(0, anchorIndex), [openLoop[anchorIndex]]);
  const simplified = simplifyOpenPoints(rotated, tolerance);

  if (simplified.length < 3) {
    return loop;
  }

  const first = simplified[0];
  return simplified.at(-1)[0] === first[0] && simplified.at(-1)[1] === first[1]
    ? simplified
    : simplified.concat([first]);
};

const loopsToPathData = (loops, { offsetX = 0, offsetY = 0, tolerance = DEFAULT_TOLERANCE } = {}) =>
  loops
    .map((loop) => simplifyClosedLoop(loop, tolerance))
    .map((loop) => {
      const [firstX, firstY] = loop[0];
      const commands = [`M ${formatNumber(firstX - offsetX)} ${formatNumber(firstY - offsetY)}`];

      for (const [x, y] of loop.slice(1, -1)) {
        commands.push(`L ${formatNumber(x - offsetX)} ${formatNumber(y - offsetY)}`);
      }

      commands.push('Z');
      return commands.join(' ');
    })
    .join(' ');

export const vectorizeBlackShape = (imageData, options = {}) => {
  const { width, height } = imageData;
  const { segments, edgesByPoint } = buildSubpixelSegments(imageData, options.threshold);
  const loops = traceLoops(segments, edgesByPoint);
  const bounds = getBoundsFromLoops(loops);

  if (!bounds) {
    return {
      svg: '',
      pathData: '',
      width: 0,
      height: 0,
      viewBox: '0 0 0 0',
      shapeCount: 0,
      pointCount: 0,
    };
  }

  const crop = options.crop !== false;
  const offsetX = crop ? bounds.minX : 0;
  const offsetY = crop ? bounds.minY : 0;
  const svgWidth = crop ? bounds.maxX - bounds.minX : width;
  const svgHeight = crop ? bounds.maxY - bounds.minY : height;
  const tolerance = Math.max(0, numberOrDefault(options.tolerance, DEFAULT_TOLERANCE));
  const pathData = loopsToPathData(loops, { offsetX, offsetY, tolerance });
  const viewBox = `0 0 ${formatNumber(svgWidth)} ${formatNumber(svgHeight)}`;
  const pointCount = loops.reduce((total, loop) => total + simplifyClosedLoop(loop, tolerance).length, 0);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(svgWidth)}" height="${formatNumber(svgHeight)}" viewBox="${viewBox}" shape-rendering="geometricPrecision">
  <path d="${pathData}" fill="#000000" fill-rule="evenodd"/>
</svg>`;

  return {
    svg,
    pathData,
    width: svgWidth,
    height: svgHeight,
    viewBox,
    shapeCount: loops.length,
    pointCount,
  };
};
