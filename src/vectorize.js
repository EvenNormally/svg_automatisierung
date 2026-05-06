const POINT_KEY_SEPARATOR = ',';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getPointKey = (x, y) => `${x}${POINT_KEY_SEPARATOR}${y}`;

const getPixelIndex = (x, y, width) => y * width + x;

const getBounds = (blackPixels, width, height) => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!blackPixels[getPixelIndex(x, y, width)]) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

const isBlackAt = (blackPixels, width, height, x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }

  return blackPixels[getPixelIndex(x, y, width)];
};

const addEdge = (edgesByStart, startX, startY, endX, endY) => {
  const startKey = getPointKey(startX, startY);
  const edge = {
    startKey,
    endKey: getPointKey(endX, endY),
    start: [startX, startY],
    end: [endX, endY],
    used: false,
  };

  if (!edgesByStart.has(startKey)) {
    edgesByStart.set(startKey, []);
  }

  edgesByStart.get(startKey).push(edge);
};

const buildBoundaryEdges = (blackPixels, width, height) => {
  const edgesByStart = new Map();
  const edges = [];

  const pushEdge = (startX, startY, endX, endY) => {
    addEdge(edgesByStart, startX, startY, endX, endY);
    edges.push(edgesByStart.get(getPointKey(startX, startY)).at(-1));
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isBlackAt(blackPixels, width, height, x, y)) {
        continue;
      }

      if (!isBlackAt(blackPixels, width, height, x, y - 1)) {
        pushEdge(x, y, x + 1, y);
      }
      if (!isBlackAt(blackPixels, width, height, x + 1, y)) {
        pushEdge(x + 1, y, x + 1, y + 1);
      }
      if (!isBlackAt(blackPixels, width, height, x, y + 1)) {
        pushEdge(x + 1, y + 1, x, y + 1);
      }
      if (!isBlackAt(blackPixels, width, height, x - 1, y)) {
        pushEdge(x, y + 1, x, y);
      }
    }
  }

  return { edges, edgesByStart };
};

const popNextUnusedEdge = (edgesByStart, startKey) => {
  const candidates = edgesByStart.get(startKey) || [];
  return candidates.find((edge) => !edge.used) || null;
};

const traceLoops = (edges, edgesByStart) => {
  const loops = [];

  for (const edge of edges) {
    if (edge.used) {
      continue;
    }

    const points = [edge.start];
    let currentEdge = edge;

    while (currentEdge && !currentEdge.used) {
      currentEdge.used = true;
      points.push(currentEdge.end);

      if (currentEdge.endKey === edge.startKey) {
        break;
      }

      currentEdge = popNextUnusedEdge(edgesByStart, currentEdge.endKey);
    }

    if (points.length > 3 && points.at(-1)[0] === points[0][0] && points.at(-1)[1] === points[0][1]) {
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
      const commands = [`M ${firstX - offsetX} ${firstY - offsetY}`];

      for (const [x, y] of loop.slice(1, -1)) {
        commands.push(`L ${x - offsetX} ${y - offsetY}`);
      }

      commands.push('Z');
      return commands.join(' ');
    })
    .join(' ');

const createBlackPixelMask = (imageData, threshold) => {
  const { data, width, height } = imageData;
  const blackPixels = new Uint8Array(width * height);
  const normalizedThreshold = clamp(Number(threshold) || 128, 0, 255);

  for (let pixel = 0; pixel < blackPixels.length; pixel += 1) {
    const dataIndex = pixel * 4;
    const alpha = data[dataIndex + 3];
    const luminance = 0.2126 * data[dataIndex] + 0.7152 * data[dataIndex + 1] + 0.0722 * data[dataIndex + 2];

    blackPixels[pixel] = alpha > 0 && luminance <= normalizedThreshold ? 1 : 0;
  }

  return blackPixels;
};

export const vectorizeBlackShape = (imageData, options = {}) => {
  const { width, height } = imageData;
  const blackPixels = createBlackPixelMask(imageData, options.threshold);
  const bounds = getBounds(blackPixels, width, height);

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

  const { edges, edgesByStart } = buildBoundaryEdges(blackPixels, width, height);
  const loops = traceLoops(edges, edgesByStart);
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
  const viewBox = `0 0 ${svgWidth} ${svgHeight}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${viewBox}">
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
