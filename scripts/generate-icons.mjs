import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { PNG } from "pngjs";

const COLORS = {
  lacquer: [17, 21, 23, 255],
  gold: [195, 154, 73, 255],
  mutedGold: [109, 80, 33, 255],
  ivory: [234, 217, 183, 255],
};

function insideCircle(x, y, centerX, centerY, radius) {
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius));
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - closestX) ** 2 + (y - closestY) ** 2 <= radius ** 2;
}

function insidePolygon(x, y, points) {
  let inside = false;

  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1
  ) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const crosses =
      currentPoint.y > y !== previousPoint.y > y &&
      x <
        ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

function createOctagon(centerX, centerY, radius, cut) {
  return [
    { x: centerX - cut, y: centerY - radius },
    { x: centerX + cut, y: centerY - radius },
    { x: centerX + radius, y: centerY - cut },
    { x: centerX + radius, y: centerY + cut },
    { x: centerX + cut, y: centerY + radius },
    { x: centerX - cut, y: centerY + radius },
    { x: centerX - radius, y: centerY + cut },
    { x: centerX - radius, y: centerY - cut },
  ];
}

const OUTER_OCTAGON = createOctagon(256, 256, 208, 82);
const INNER_OCTAGON = createOctagon(256, 256, 184, 71);
const OUTER_BODY = [
  { x: 166, y: 270 },
  { x: 184, y: 244 },
  { x: 328, y: 244 },
  { x: 346, y: 270 },
  { x: 385, y: 409 },
  { x: 127, y: 409 },
];
const INNER_BODY = [
  { x: 183, y: 282 },
  { x: 196, y: 264 },
  { x: 316, y: 264 },
  { x: 329, y: 282 },
  { x: 357, y: 384 },
  { x: 155, y: 384 },
];
const BASE = [
  { x: 110, y: 396 },
  { x: 402, y: 396 },
  { x: 420, y: 430 },
  { x: 92, y: 430 },
];
const DIAL_HOLES = Array.from({ length: 8 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 8 - Math.PI / 2;
  return {
    x: 256 + Math.cos(angle) * 38,
    y: 326 + Math.sin(angle) * 38,
  };
});

function isInHandset(x, y) {
  const center = insideRoundedRect(x, y, 139, 138, 373, 192, 24);
  const leftEarpiece = insideRoundedRect(x, y, 105, 127, 174, 220, 24);
  const rightEarpiece = insideRoundedRect(x, y, 338, 127, 407, 220, 24);
  return center || leftEarpiece || rightEarpiece;
}

function sampleIcon(x, y) {
  const distance = Math.hypot(x - 256, y - 256);
  const angle = Math.atan2(y - 256, x - 256) + Math.PI;
  let color = COLORS.lacquer;

  if (distance > 176 && Math.floor(angle / (Math.PI / 12)) % 2 === 0) {
    color = COLORS.mutedGold;
  }

  if (insidePolygon(x, y, OUTER_OCTAGON)) {
    color = COLORS.gold;
  }
  if (insidePolygon(x, y, INNER_OCTAGON)) {
    color = COLORS.ivory;
  }

  if (isInHandset(x, y) || insideRoundedRect(x, y, 231, 191, 281, 285, 11)) {
    color = COLORS.lacquer;
  }

  if (insidePolygon(x, y, OUTER_BODY)) {
    color = COLORS.gold;
  }
  if (insidePolygon(x, y, INNER_BODY)) {
    color = COLORS.lacquer;
  }

  if (insideCircle(x, y, 256, 326, 68)) {
    color = COLORS.gold;
  }
  if (insideCircle(x, y, 256, 326, 52)) {
    color = COLORS.lacquer;
  }

  for (const hole of DIAL_HOLES) {
    if (insideCircle(x, y, hole.x, hole.y, 10)) {
      color = COLORS.ivory;
    }
  }

  if (insideCircle(x, y, 256, 326, 18)) {
    color = COLORS.gold;
  }

  if (insidePolygon(x, y, BASE)) {
    color = COLORS.gold;
  }

  return color;
}

function setPixel(png, x, y, color) {
  const offset = (png.width * y + x) << 2;
  png.data[offset] = color[0];
  png.data[offset + 1] = color[1];
  png.data[offset + 2] = color[2];
  png.data[offset + 3] = color[3];
}

function createIcon(size) {
  const png = new PNG({ width: size, height: size });
  const scale = size / 512;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(png, x, y, sampleIcon((x + 0.5) / scale, (y + 0.5) / scale));
    }
  }

  return png;
}

await mkdir("public/app-icons", { recursive: true });

for (const size of [192, 512]) {
  const png = createIcon(size);
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(`public/app-icons/icon-${size}.png`);
    stream.on("finish", resolve);
    stream.on("error", reject);
    png.pack().pipe(stream);
  });
}
