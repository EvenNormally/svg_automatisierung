const POINT_KEY_SEPARATOR = ',';
const WHITE_LUMINANCE = 255;
const KEY_PRECISION = 6;
const NUMBER_PRECISION = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatNumber = (value) => {
  const rounded = Number(value.toFixed(NUMBER_PRECISION));
  return Object.is(rounded, -0) ? '0' : `${rounded}`;
};

const getPointKey = (x, y) => `${x.toFixed(KEY_PRECISION)}${POINT_KEY_SEPARATOR}${y.toFixed(KEY_PRECISION)}`;

const getPixelIndex = (x, y, width) => y * width + x;

const getBounds = (loops) => {
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

const getSampleIndex = (x, y, sampleWidth) => y * sampleWidth + x;

const createLuminanceSamples = (imageData, threshold) => {
  const { data, width, height } = imageData;
  const sampleWidth = width + 2;
  const sampleHeight = height + 2;
  const samples = new Float32Array(sampleWidth * sampleHeight);
  samples.fill(WHITE_LUMINANCE);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dataIndex = getPixelIndex(x, y, width) * 4;
      const alpha = data[dataIndex + 3] / 255;
      const luminance =
        0.2126 * data[dataIndex] + 0.7152 * data[dataIndex + 1] + 0.0722 * data[dataIndex + 2];
      const alphaAdjustedLuminance = alpha * luminance + (1 - alpha) * WHITE_LUMINANCE;

      samples[getSampleIndex(x + 1, y + 1, sampleWidth)] = alphaAdjustedLuminance;
    }
  }

  return {
    samples,
    sampleWidth,
    threshold: clamp(Number(threshold) || 128, 0, 255),
  };
};

const interpolate = (from, to, threshold) => {
  const delta = to.value - from.value;
  const ratio = delta === 0 ? 0.5 : clamp((threshold - from.value) / delta, 0, 1);

  return [from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio];
};

const createSamplePoint = (samples, sampleWidth, x, y) => ({
  x: x - 0.5,
  y: y - 0.5,
  value: samples[getSampleIndex(x, y, sampleWidth)],
});

const addSegment = (segments, first, second) => {
  if (first[0] === second[0] && first[1] === second[1]) {
    return;
  }

  segments.push({
    a: first,
    b: second,
    aKey: getPointKey(first[0], first[1]),
    bKey: getPointKey(second[0], second[1]),
    used: false,
  });
};

const buildContourSegments = (imageData, options = {}) => {
  const { width, height } = imageData;
  const { samples, sampleWidth, threshold } = createLuminanceSamples(imageData, options.threshold);
  const segments = [];

  for (let y = 0; y < height + 1; y += 1) {
    for (let x = 0; x < width + 1; x += 1) {
      const topLeft = createSamplePoint(samples, sampleWidth, x, y);
      const topRight = createSamplePoint(samples, sampleWidth, x + 1, y);
      const bottomRight = createSamplePoint(samples, sampleWidth, x + 1, y + 1);
      const bottomLeft = createSamplePoint(samples, sampleWidth, x, y + 1);
      const insideTopLeft = topLeft.value <= threshold;
      const insideTopRight = topRight.value <= threshold;
      const insideBottomRight = bottomRight.value <= threshold;
      const insideBottomLeft = bottomLeft.value <= threshold;
      const caseIndex =
        (insideTopLeft ? 1 : 0) |
        (insideTopRight ? 2 : 0) |
        (insideBottomRight ? 4 : 0) |
        (insideBottomLeft ? 8 : 0);

      if (caseIndex === 0 || caseIndex === 15) {
        continue;
      }

      const edgePoints = {
        top: interpolate(topLeft, topRight, threshold),
        right: interpolate(topRight, bottomRight, threshold),
        bottom: interpolate(bottomLeft, bottomRight, threshold),
        left: interpolate(topLeft, bottomLeft, threshold),
      };

      const segmentSpecs = {
        1: [['left', 'top']],
        2: [['top', 'right']],
        3: [['left', 'right']],
        4: [['right', 'bottom']],
        5: [['left', 'top'], ['right', 'bottom']],
        6: [['top', 'bottom']],
        7: [['left', 'bottom']],
        8: [['bottom', 'left']],
        9: [['top', 'bottom']],
        10: [['top', 'right'], ['bottom', 'left']],
        11: [['right', 'bottom']],
        12: [['left', 'right']],
        13: [['top', 'right']],
        14: [['left', 'top']],
      };

      for (const [firstEdge, secondEdge] of segmentSpecs[caseIndex]) {
        addSegment(segments, edgePoints[firstEdge], edgePoints[secondEdge]);
      }
    }
  }

  return segments;
};

const buildSegmentIndex = (segments) => {
  const segmentsByPoint = new Map();

  const addToIndex = (pointKey, segment) => {
    if (!segmentsByPoint.has(pointKey)) {
      segmentsByPoint.set(pointKey, []);
    }

    segmentsByPoint.get(pointKey).push(segment);
  };

  for (const segment of segments) {
    addToIndex(segment.aKey, segment);
    addToIndex(segment.bKey, segment);
  }

  return segmentsByPoint;
};

const getNextSegment = (segmentsByPoint, currentKey) => {
  const candidates = segmentsByPoint.get(currentKey) || [];
  return candidates.find((segment) => !segment.used) || null;
};

const getOtherEndpoint = (segment, pointKey) =>
  segment.aKey === pointKey ? { point: segment.b, key: segment.bKey } : { point: segment.a, key: segment.aKey };

const traceLoops = (segments) => {
  const loops = [];
  const segmentsByPoint = buildSegmentIndex(segments);

  for (const segment of segments) {
    if (segment.used) {
      continue;
    }

    const points = [segment.a];
    const startKey = segment.aKey;
    let currentSegment = segment;
    let currentKey = segment.aKey;

    while (currentSegment && !currentSegment.used) {
      currentSegment.used = true;
      const next = getOtherEndpoint(currentSegment, currentKey);
      points.push(next.point);
      currentKey = next.key;

      if (currentKey === startKey) {
        break;
      }

      currentSegment = getNextSegment(segmentsByPoint, currentKey);
    }

    if (points.length > 3 && currentKey === startKey) {
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

const loopsToPathData = (loops, { offsetX = 0, offsetY = 0, tolerance = 1 } = {}) =>
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
  const segments = buildContourSegments(imageData, options);
  const loops = traceLoops(segments);
  const bounds = getBounds(loops);

  if (!bounds) {
    return {
      svg: '',
      pathData: '',
      width: 0,
      height: 0,
      viewBox: '0 0 0 0',
      shapeCount: 0,
    };
  }

  const crop = options.crop !== false;
  const offsetX = crop ? bounds.minX : 0;
  const offsetY = crop ? bounds.minY : 0;
  const svgWidth = crop ? bounds.maxX - bounds.minX : width;
  const svgHeight = crop ? bounds.maxY - bounds.minY : height;
  const pathData = loopsToPathData(loops, {
    offsetX,
    offsetY,
    tolerance: Math.max(0, Number(options.tolerance) || 0),
  });
  const viewBox = `0 0 ${formatNumber(svgWidth)} ${formatNumber(svgHeight)}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(svgWidth)}" height="${formatNumber(
    svgHeight,
  )}" viewBox="${viewBox}">
  <path d="${pathData}" fill="#000000" fill-rule="evenodd"/>
</svg>`;

  return {
    svg,
    pathData,
    width: svgWidth,
    height: svgHeight,
    viewBox,
    shapeCount: loops.length,
  };
};
