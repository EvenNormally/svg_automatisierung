const POINT_KEY_SEPARATOR = ',';
const WHITE_LUMINANCE = 255;
const KEY_PRECISION = 6;
const NUMBER_PRECISION = 3;
const HISTOGRAM_SIZE = 256;
const MIN_CONTRAST = 12;
const DEFAULT_CURVE_TENSION = 0.75;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatNumber = (value) => {
  const rounded = Number(value.toFixed(NUMBER_PRECISION));
  return Object.is(rounded, -0) ? '0' : `${rounded}`;
};

const getPointKey = (x, y) => `${x.toFixed(KEY_PRECISION)}${POINT_KEY_SEPARATOR}${y.toFixed(KEY_PRECISION)}`;

const getMaskIndex = (x, y, width) => y * width + x;

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

const estimateThreshold = (imageData) => {
  const { histogram, total } = createLuminanceHistogram(imageData);
  const low = getPercentileFromHistogram(histogram, total, 0.05);
  const high = getPercentileFromHistogram(histogram, total, 0.95);

  return high - low >= MIN_CONTRAST ? (low + high) / 2 : getOtsuThreshold(histogram, total);
};

const resolveParameters = (imageData, options = {}) => {
  const autoOptimize = Boolean(options.autoOptimize);
  const threshold = autoOptimize || options.threshold === undefined
    ? estimateThreshold(imageData)
    : clamp(Number(options.threshold), 0, 255);
  const longestSide = Math.max(imageData.width, imageData.height);
  const tolerance = options.tolerance === undefined
    ? clamp(longestSide * 0.0015, 0, 1.5)
    : Math.max(0, Number(options.tolerance) || 0);
  const smoothingPasses = options.smoothingPasses === undefined
    ? (autoOptimize && longestSide >= 220 ? 1 : 0)
    : Math.max(0, Math.floor(Number(options.smoothingPasses) || 0));
  const curveTension = options.curveTension === undefined
    ? (smoothingPasses > 0 ? DEFAULT_CURVE_TENSION : 0)
    : clamp(Number(options.curveTension), 0, 1.5);
  const speckleThreshold = Math.max(0, Math.floor(Number(options.speckleThreshold) || 0));

  return {
    autoOptimize,
    threshold: clamp(threshold, 0, 255),
    tolerance,
    smoothingPasses,
    curveTension,
    speckleThreshold,
  };
};

const createBinaryMask = (imageData, threshold) => {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  let darkCount = 0;

  for (let index = 0; index < mask.length; index += 1) {
    const isDark = getPixelLuminance(data, index) <= threshold;
    mask[index] = isDark ? 1 : 0;
    darkCount += isDark ? 1 : 0;
  }

  return { mask, width, height, darkCount };
};

const isDarkAt = ({ mask, width, height }, x, y) =>
  x >= 0 && y >= 0 && x < width && y < height && mask[getMaskIndex(x, y, width)] === 1;

const removeSpeckles = (binary, speckleThreshold) => {
  if (speckleThreshold <= 1 || binary.darkCount === 0) {
    return binary;
  }

  const { mask, width, height } = binary;
  const visited = new Uint8Array(mask.length);
  let darkCount = binary.darkCount;

  for (let startIndex = 0; startIndex < mask.length; startIndex += 1) {
    if (mask[startIndex] === 0 || visited[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    const component = [];
    visited[startIndex] = 1;

    while (stack.length) {
      const index = stack.pop();
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];

      for (const nextIndex of neighbors) {
        if (nextIndex >= 0 && mask[nextIndex] === 1 && !visited[nextIndex]) {
          visited[nextIndex] = 1;
          stack.push(nextIndex);
        }
      }
    }

    if (component.length < speckleThreshold) {
      for (const index of component) {
        mask[index] = 0;
      }

      darkCount -= component.length;
    }
  }

  return { ...binary, darkCount };
};

const addEdge = (edgesByStart, start, end) => {
  const edge = { start, end };
  const key = getPointKey(start[0], start[1]);

  if (!edgesByStart.has(key)) {
    edgesByStart.set(key, []);
  }

  edgesByStart.get(key).push(edge);
};

const buildBoundaryEdges = (binary) => {
  const edgesByStart = new Map();
  const { width, height } = binary;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isDarkAt(binary, x, y)) {
        continue;
      }

      if (!isDarkAt(binary, x, y - 1)) {
        addEdge(edgesByStart, [x, y], [x + 1, y]);
      }

      if (!isDarkAt(binary, x + 1, y)) {
        addEdge(edgesByStart, [x + 1, y], [x + 1, y + 1]);
      }

      if (!isDarkAt(binary, x, y + 1)) {
        addEdge(edgesByStart, [x + 1, y + 1], [x, y + 1]);
      }

      if (!isDarkAt(binary, x - 1, y)) {
        addEdge(edgesByStart, [x, y + 1], [x, y]);
      }
    }
  }

  return edgesByStart;
};

const popNextEdge = (edgesByStart, point) => {
  const key = getPointKey(point[0], point[1]);
  const edges = edgesByStart.get(key);

  if (!edges?.length) {
    return null;
  }

  const edge = edges.pop();

  if (edges.length === 0) {
    edgesByStart.delete(key);
  }

  return edge;
};

const traceBoundaryLoops = (edgesByStart) => {
  const loops = [];

  while (edgesByStart.size > 0) {
    const firstEdges = edgesByStart.values().next().value;
    const firstEdge = firstEdges.pop();

    if (firstEdges.length === 0) {
      edgesByStart.delete(getPointKey(firstEdge.start[0], firstEdge.start[1]));
    }

    const loop = [firstEdge.start, firstEdge.end];
    const startKey = getPointKey(firstEdge.start[0], firstEdge.start[1]);
    let current = firstEdge.end;

    while (getPointKey(current[0], current[1]) !== startKey) {
      const nextEdge = popNextEdge(edgesByStart, current);

      if (!nextEdge) {
        break;
      }

      current = nextEdge.end;
      loop.push(current);
    }

    if (loop.length > 3 && getPointKey(current[0], current[1]) === startKey) {
      loops.push(loop);
    }
  }

  return loops;
};

const stripClosingPoint = (loop) => {
  const first = loop[0];
  const last = loop.at(-1);

  return first && last && first[0] === last[0] && first[1] === last[1] ? loop.slice(0, -1) : loop.slice();
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


const removeCollinearPoints = (loop) => {
  const points = stripClosingPoint(loop);

  if (points.length <= 3) {
    return loop;
  }

  const compacted = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const crossProduct = (current[0] - previous[0]) * (next[1] - current[1])
      - (current[1] - previous[1]) * (next[0] - current[0]);

    if (crossProduct !== 0) {
      compacted.push(current);
    }
  }

  return compacted.concat([compacted[0]]);
};

const simplifyClosedLoop = (loop, tolerance) => {
  if (loop.length <= 4 || tolerance <= 0) {
    return loop;
  }

  const openLoop = stripClosingPoint(loop);
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

const prepareLoops = (loops, parameters) => loops
  .map(removeCollinearPoints)
  .map((loop) => simplifyClosedLoop(loop, parameters.tolerance))
  .map((loop) => chaikinSmoothClosedLoop(loop, parameters.smoothingPasses))
  .filter((loop) => stripClosingPoint(loop).length >= 3)
  .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

const loopToPathData = (loop, { offsetX, offsetY, curveTension }) => {
  const points = stripClosingPoint(loop);

  if (points.length < 3) {
    return '';
  }

  const commands = [`M ${formatNumber(points[0][0] - offsetX)} ${formatNumber(points[0][1] - offsetY)}`];
  const tension = clamp(Number(curveTension) || 0, 0, 1.5);

  if (tension === 0) {
    for (let index = 1; index < points.length; index += 1) {
      commands.push(`L ${formatNumber(points[index][0] - offsetX)} ${formatNumber(points[index][1] - offsetY)}`);
    }
  } else {
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
  }

  commands.push('Z');
  return commands.join(' ');
};

const loopsToPathData = (loops, pathOptions) => loops
  .map((loop) => loopToPathData(loop, pathOptions))
  .filter(Boolean)
  .join(' ');

const countMatchedPixels = (binary, loops) => {
  const total = binary.width * binary.height;
  let matched = 0;

  for (let y = 0; y < binary.height; y += 1) {
    for (let x = 0; x < binary.width; x += 1) {
      const isDark = isDarkAt(binary, x, y);
      const inSvg = pointInEvenOddLoops(x + 0.5, y + 0.5, loops);
      matched += isDark === inSvg ? 1 : 0;
    }
  }

  return {
    errorRate: total === 0 ? 0 : (total - matched) / total,
    matched,
    total,
  };
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

export const vectorizeBlackShape = (imageData, options = {}) => {
  const { width, height } = imageData;
  const parameters = resolveParameters(imageData, options);
  const binary = removeSpeckles(createBinaryMask(imageData, parameters.threshold), parameters.speckleThreshold);

  if (binary.darkCount === 0) {
    return {
      svg: '',
      pathData: '',
      width: 0,
      height: 0,
      viewBox: '0 0 0 0',
      shapeCount: 0,
      parameters,
      comparison: null,
    };
  }

  const rawLoops = traceBoundaryLoops(buildBoundaryEdges(binary));
  const loops = prepareLoops(rawLoops, parameters);
  const bounds = getBounds(loops);

  if (!bounds) {
    return {
      svg: '',
      pathData: '',
      width: 0,
      height: 0,
      viewBox: '0 0 0 0',
      shapeCount: 0,
      parameters,
      comparison: null,
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
    curveTension: parameters.curveTension,
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
    parameters,
    comparison: countMatchedPixels(binary, loops),
  };
};
