import assert from 'node:assert/strict';
import { test } from 'node:test';

import { vectorizeBlackShape } from '../src/vectorize.js';

const createWhiteImageData = (width, height) => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }

  return { data, width, height };
};

const setPixel = (imageData, x, y, [red, green, blue, alpha = 255]) => {
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = red;
  imageData.data[index + 1] = green;
  imageData.data[index + 2] = blue;
  imageData.data[index + 3] = alpha;
};

test('exports subpixel SVG contours and preserves white holes', () => {
  const imageData = createWhiteImageData(5, 5);

  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      if (x !== 2 || y !== 2) {
        setPixel(imageData, x, y, [0, 0, 0]);
      }
    }
  }

  const result = vectorizeBlackShape(imageData, { threshold: 128, crop: true, tolerance: 0 });

  assert.equal(result.shapeCount, 2);
  assert.equal(result.width, 3);
  assert.equal(result.height, 3);
  assert.match(result.svg, /fill-rule="evenodd"/);
  assert.match(result.svg, /shape-rendering="geometricPrecision"/);
  assert.match(result.pathData, /0\.5/);
});

test('threshold controls whether grey pixels are considered black', () => {
  const imageData = createWhiteImageData(3, 3);
  setPixel(imageData, 1, 1, [120, 120, 120]);

  const lowThreshold = vectorizeBlackShape(imageData, { threshold: 100 });
  const highThreshold = vectorizeBlackShape(imageData, { threshold: 140 });

  assert.equal(lowThreshold.shapeCount, 0);
  assert.equal(highThreshold.shapeCount, 1);
});

test('returns an empty result when no black shape is present', () => {
  const result = vectorizeBlackShape(createWhiteImageData(4, 4), { threshold: 128 });

  assert.equal(result.svg, '');
  assert.equal(result.shapeCount, 0);
  assert.equal(result.pointCount, 0);
});
