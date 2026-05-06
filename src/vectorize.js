const POINT_KEY_SEPARATOR = ',';
const WHITE_LUMINANCE = 255;
const KEY_PRECISION = 6;
const NUMBER_PRECISION = 3;
const HISTOGRAM_SIZE = 256;
const MIN_CONTRAST = 12;
const DEFAULT_CURVE_TENSION = 0.9;
const EXACT_CURVE_TENSION = 0;
const MAX_FIT_SAMPLE_PIXELS = 12000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatNumber = (value) => {
  const rounded = Number(value.toFixed(NUMBER_PRECISION));
  return Object.is(rounded, -0) ? '0' : `${rounded}`;
};

const getPointKey = (x, y) => `${x.toFixed(KEY_PRECISION)}${POINT_KEY_SEPARATOR}${y.toFixed(KEY_PRECISION)}`;

const getPixelIndex = (x, y, width) => y * width + x;

const getPixelLuminance = (data, pixelIndex) => {
  const dataIndex = pixelIndex * 4;
  const alpha = data[dataIndex + 3] / 255;
  const luminance = 0.2126 * data[dataIndex] + 0.7152 * data[dataIndex + 1] + 0.0722 * data[dataIndex + 2];

  return alpha * luminance + (1 - alpha) * WHITE_LUMINANCE;
};

const getPercentileFromHistogram = (histogram, total, percentile) => {
  const target = Math.max(0, Math.min(total - 1, Math.floor((total - 1) * percentile)));
  let seen = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];

    if (seen > target) {
      return value;
    }
  }

  return histogram.length - 1;
};

const getOtsuThreshold = (histogram, total) => {
  let weightedSum = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    weightedSum += value * histogram[value];
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestThreshold = 128;
  let bestVariance = -1;

  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];

    if (backgroundWeight === 0) {
      continue;
    }

    const foregroundWeight = total - backgroundWeight;

    if (foregroundWeight === 0) {
      break;
    }

    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedSum - backgroundSum) / foregroundWeight;
    const betweenClassVariance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;

    if (betweenClassVariance > bestVariance) {
      bestVariance = betweenClassVariance;
      bestThreshold = value;
    }
  }

  return bestThreshold;
};

const createLuminanceHistogram = (imageData) => {
  const { data, width, height } = imageData;
  const histogram = new Uint32Array(HISTOGRAM_SIZE);
  const total = width * height;

  for (let pixelIndex = 0; pixelIndex < total; pixelIndex += 1) {
    histogram[Math.round(getPixelLuminance(data, pixelIndex))] += 1;
  }

  return { histogram, total };
};

const estimateAutoParameters = (imageData) => {
  const { width, height } = imageData;
  const { histogram, total } = createLuminanceHistogram(imageData);

  const low = getPercentileFromHistogram(histogram, total, 0.05);
  const high = getPercentileFromHistogram(histogram, total, 0.95);
  const contrast = high - low;
  const threshold = contrast >= MIN_CONTRAST ? (low + high) / 2 : getOtsuThreshold(histogram, total);
  const longestSide = Math.max(width, height);
  const tolerance = clamp(longestSide * 0.0025, 0.35, 2.2);
  const smoothingPasses = longestSide >= 300 ? 2 : 1;

  return {
    threshold: clamp(threshold, 0, 255),
    tolerance,
    smoothingPasses,
    curveTension: DEFAULT_CURVE_TENSION,
  };
};

const createThresholdCandidates = (imageData, preferredThreshold) => {
  const { histogram, total } = createLuminanceHistogram(imageData);
  const otsu = getOtsuThreshold(histogram, total);
  const low = getPercentileFromHistogram(histogram, total, 0.02);
  const high = getPercentileFromHistogram(histogram, total, 0.98);
  const midpoint = (low + high) / 2;
  const seeds = [preferredThreshold, otsu, midpoint, 32, 64, 96, 128, 160, 192, 224]
    .filter((value) => Number.isFinite(Number(value)))
    .map((value) => Math.round(clamp(Number(value), 0, 255)));
  const candidates = new Set();

  for (const seed of seeds) {
    for (const delta of [-24, -12, -6, 0, 6, 12, 24]) {
      candidates.add(Math.round(clamp(seed + delta, 0, 255)));
    }
  }

  return [...candidates].sort((a, b) => a - b);
};

const signedArea = (loop) => {
  const points = stripClosingPoint(loop);
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
};

const pointInLoop = (pointX, pointY, loop) => {
  const points = stripClosingPoint(loop);
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = points.length - 1;
    currentIndex < points.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const [currentX, currentY] = points[currentIndex];
    const [previousX, previousY] = points[previousIndex];
    const crosses = currentY > pointY !== previousY > pointY;

    if (crosses) {
      const intersectionX = ((previousX - currentX) * (pointY - currentY)) / (previousY - currentY) + currentX;

      if (pointX < intersectionX) {
        inside = !inside;
      }
    }
  }

  return inside;
};

const pointInEvenOddLoops = (pointX, pointY, loops) => loops.reduce(
  (inside, loop) => (pointInLoop(pointX, pointY, loop) ? !inside : inside),
  false,
);

const createFitSamples = (imageData, targetThreshold) => {
  const { width, height, data } = imageData;
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_FIT_SAMPLE_PIXELS)));
  const samples = [];
  let darkCount = 0;

  for (let y = Math.floor(step / 2); y < height; y += step) {
    for (let x = Math.floor(step / 2); x < width; x += step) {
      const isDark = getPixelLuminance(data, getPixelIndex(x, y, width)) <= targetThreshold;
      samples.push({ x: x + 0.5, y: y + 0.5, isDark });
      darkCount += isDark ? 1 : 0;
    }
  }

  return { samples, darkCount, lightCount: samples.length - darkCount };
};

const scoreLoopsAgainstImage = (loops, fitSamples) => {
  if (!loops.length || !fitSamples.samples.length) {
    return {
      errorRate: 1,
      falsePositiveRate: 1,
      falseNegativeRate: 1,
      matched: 0,
      total: fitSamples.samples.length,
    };
  }

  let falsePositive = 0;
  let falseNegative = 0;
  let matched = 0;

  for (const sample of fitSamples.samples) {
    const inSvg = pointInEvenOddLoops(sample.x, sample.y, loops);

    if (inSvg === sample.isDark) {
      matched += 1;
    } else if (inSvg) {
      falsePositive += 1;
    } else {
      falseNegative += 1;
    }
  }

  return {
    errorRate: (falsePositive + falseNegative) / fitSamples.samples.length,
    falsePositiveRate: falsePositive / Math.max(1, fitSamples.lightCount),
    falseNegativeRate: falseNegative / Math.max(1, fitSamples.darkCount),
    matched,
    total: fitSamples.samples.length,
  };
};

const createFitCandidateOptions = (imageData, options = {}) => {
  const estimated = estimateAutoParameters(imageData);
  const thresholds = createThresholdCandidates(imageData, options.threshold ?? estimated.threshold);
  const toleranceValues = [0, 0.05, 0.1, 0.2, estimated.tolerance]
    .map((value) => Number(value.toFixed(3)))
    .filter((value, index, values) => values.indexOf(value) === index);
  const candidates = [];

  for (const threshold of thresholds) {
    for (const tolerance of toleranceValues) {
      candidates.push({
        threshold,
        tolerance,
        smoothingPasses: 0,
        curveTension: EXACT_CURVE_TENSION,
      });
    }
  }

  candidates.push({ ...estimated, smoothingPasses: 1, curveTension: DEFAULT_CURVE_TENSION });
  return candidates;
};

const prepareLoops = (loops, { tolerance = 0, smoothingPasses = 0 } = {}) =>
  loops
    .map((loop) => simplifyClosedLoop(loop, Math.max(0, Number(tolerance) || 0)))
    .map((loop) => chaikinSmoothClosedLoop(loop, Math.max(0, Number(smoothingPasses) || 0)))
    .filter((loop) => stripClosingPoint(loop).length >= 3)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

const fitParametersToImage = (imageData, options = {}) => {
  const targetParameters = estimateAutoParameters(imageData);
  const targetThreshold = targetParameters.threshold;
  const fitSamples = createFitSamples(imageData, targetThreshold);
  let best = null;

  for (const candidate of createFitCandidateOptions(imageData, options)) {
    const segments = buildContourSegments(imageData, candidate);
    const rawLoops = traceLoops(segments);
    const loops = prepareLoops(rawLoops, candidate);
    const score = scoreLoopsAgainstImage(loops, fitSamples);

    if (
      !best ||
      score.errorRate < best.score.errorRate ||
      (score.errorRate === best.score.errorRate && candidate.tolerance < best.parameters.tolerance)
    ) {
      best = { parameters: candidate, rawLoops, loops, score };
    }
  }

  return {
    ...best,
    parameters: {
      ...best.parameters,
      autoOptimize: true,
      targetThreshold,
    },
  };
};

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
      samples[getSampleIndex(x + 1, y + 1, sampleWidth)] = getPixelLuminance(
        data,
        getPixelIndex(x, y, width),
      );
    }
  }

  return {
    samples,
    sampleWidth,
    threshold: clamp(Number(threshold ?? 128), 0, 255),
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

const stripClosingPoint = (loop) => {
  const first = loop[0];
  const last = loop.at(-1);

  return first && last && first[0] === last[0] && first[1] === last[1] ? loop.slice(0, -1) : loop.slice();
};

const chaikinSmoothClosedLoop = (loop, passes) => {
  let points = stripClosingPoint(loop);

  for (let pass = 0; pass < passes && points.length >= 4; pass += 1) {
    const smoothed = [];

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      smoothed.push([
        current[0] * 0.75 + next[0] * 0.25,
        current[1] * 0.75 + next[1] * 0.25,
      ]);
      smoothed.push([
        current[0] * 0.25 + next[0] * 0.75,
        current[1] * 0.25 + next[1] * 0.75,
      ]);
    }

    points = smoothed;
  }

  return points;
};

const loopToCubicPathData = (loop, { offsetX, offsetY, curveTension }) => {
  const points = stripClosingPoint(loop);

  if (points.length < 3) {
    return '';
  }

  const commands = [`M ${formatNumber(points[0][0] - offsetX)} ${formatNumber(points[0][1] - offsetY)}`];
  const tension = clamp(Number(curveTension) || DEFAULT_CURVE_TENSION, 0, 1.5);

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    const control1 = [
      current[0] + ((next[0] - previous[0]) * tension) / 6,
      current[1] + ((next[1] - previous[1]) * tension) / 6,
    ];
    const control2 = [
      next[0] - ((afterNext[0] - current[0]) * tension) / 6,
      next[1] - ((afterNext[1] - current[1]) * tension) / 6,
    ];

    commands.push(
      `C ${formatNumber(control1[0] - offsetX)} ${formatNumber(control1[1] - offsetY)} ${formatNumber(
        control2[0] - offsetX,
      )} ${formatNumber(control2[1] - offsetY)} ${formatNumber(next[0] - offsetX)} ${formatNumber(
        next[1] - offsetY,
      )}`,
    );
  }

  commands.push('Z');
  return commands.join(' ');
};

const loopsToPathData = (
  loops,
  { offsetX = 0, offsetY = 0, tolerance = 1, smoothingPasses = 0, curveTension = DEFAULT_CURVE_TENSION } = {},
) =>
  loops
    .map((loop) => simplifyClosedLoop(loop, tolerance))
    .map((loop) => chaikinSmoothClosedLoop(loop, Math.max(0, Number(smoothingPasses) || 0)))
    .map((loop) => loopToCubicPathData(loop, { offsetX, offsetY, curveTension }))
    .filter(Boolean)
    .join(' ');

export const vectorizeBlackShape = (imageData, options = {}) => {
  const { width, height } = imageData;
  const fit = options.autoOptimize ? fitParametersToImage(imageData, options) : null;
  const autoParameters = fit?.parameters || {};
  const resolvedOptions = { ...options, ...autoParameters };
  const loops = fit?.rawLoops || traceLoops(buildContourSegments(imageData, resolvedOptions));
  const bounds = getBounds(loops);

  if (!bounds) {
    return {
      svg: '',
      pathData: '',
      width: 0,
      height: 0,
      viewBox: '0 0 0 0',
      shapeCount: 0,
      parameters: { ...autoParameters },
      comparison: fit?.score || null,
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
    tolerance: Math.max(0, Number(resolvedOptions.tolerance) || 0),
    smoothingPasses: Math.max(0, Number(resolvedOptions.smoothingPasses) || 0),
    curveTension: resolvedOptions.curveTension,
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
    parameters: {
      threshold: resolvedOptions.threshold,
      tolerance: Math.max(0, Number(resolvedOptions.tolerance) || 0),
      smoothingPasses: Math.max(0, Number(resolvedOptions.smoothingPasses) || 0),
      curveTension: resolvedOptions.curveTension ?? DEFAULT_CURVE_TENSION,
      autoOptimize: Boolean(options.autoOptimize),
      targetThreshold: resolvedOptions.targetThreshold,
    },
    comparison: fit?.score || null,
  };
};
