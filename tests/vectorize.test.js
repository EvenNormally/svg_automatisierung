import assert from 'node:assert/strict';
import test from 'node:test';
import { vectorizeBlackShape } from '../src/vectorize.js';

const createImageData = (width, height, pixels) => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const [red, green, blue, alpha = 255] = pixels[index] || [255, 255, 255, 255];
    const dataIndex = index * 4;
    data[dataIndex] = red;
    data[dataIndex + 1] = green;
    data[dataIndex + 2] = blue;
    data[dataIndex + 3] = alpha;
  }

  return { data, width, height };
};

const black = [0, 0, 0, 255];
const white = [255, 255, 255, 255];
const gray = [128, 128, 128, 255];

test('creates an evenodd SVG path for a black shape', () => {
  const imageData = createImageData(3, 3, [white, white, white, white, black, white, white, white, white]);
  const result = vectorizeBlackShape(imageData, { threshold: 200, tolerance: 0 });

  assert.equal(result.shapeCount, 1);
  assert.match(result.svg, /<path d="M /);
  assert.match(result.svg, /fill="#000000" fill-rule="evenodd"/);
  assert.ok(result.width > 0);
  assert.ok(result.height > 0);
});

test('creates crisp pixel-edge contours for black-and-white sources', () => {
  const imageData = createImageData(2, 1, [black, gray]);
  const result = vectorizeBlackShape(imageData, { threshold: 64, crop: false, tolerance: 0 });

  assert.equal(result.pathData, 'M 0 0 L 1 0 L 1 1 L 0 1 Z');
  assert.equal(result.comparison.errorRate, 0);
});

test('returns an empty result when no dark shape is present', () => {
  const imageData = createImageData(2, 2, [white, white, white, white]);
  const result = vectorizeBlackShape(imageData, { threshold: 64 });

  assert.equal(result.svg, '');
  assert.equal(result.shapeCount, 0);
  assert.equal(result.viewBox, '0 0 0 0');
});

test('auto optimization compares candidates and chooses the closest image match', () => {
  const imageData = createImageData(4, 4, [
    white,
    white,
    white,
    white,
    white,
    black,
    black,
    white,
    white,
    black,
    black,
    white,
    white,
    white,
    white,
    white,
  ]);
  const result = vectorizeBlackShape(imageData, {
    autoOptimize: true,
    threshold: 0,
    tolerance: 0,
    crop: false,
  });

  assert.equal(result.shapeCount, 1);
  assert.equal(result.parameters.autoOptimize, true);
  assert.ok(result.parameters.threshold > 0, result.parameters);
  assert.equal(result.parameters.tolerance, 0);
  assert.equal(result.parameters.smoothingPasses, 0);
  assert.equal(result.comparison.errorRate, 0);
  assert.equal(result.comparison.matched, result.comparison.total);
});

test('removes small speckles before tracing contours', () => {
  const imageData = createImageData(4, 2, [
    black,
    white,
    black,
    black,
    white,
    white,
    black,
    black,
  ]);
  const result = vectorizeBlackShape(imageData, {
    threshold: 64,
    crop: false,
    tolerance: 0,
    speckleThreshold: 2,
  });

  assert.equal(result.shapeCount, 1);
  assert.equal(result.pathData, 'M 2 0 L 4 0 L 4 2 L 2 2 Z');
  assert.equal(result.parameters.speckleThreshold, 2);
});
