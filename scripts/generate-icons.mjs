import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { PNG } from "pngjs";

const COLORS = {
  green: [22, 56, 47, 255],
  cream: [244, 240, 231, 255],
  orange: [233, 101, 59, 255],
};

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius));
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - closestX) ** 2 + (y - closestY) ** 2 <= radius ** 2;
}

function insideCircle(x, y, centerX, centerY, radius) {
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
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
      const sourceX = x / scale;
      const sourceY = y / scale;
      let color = COLORS.green;

      if (insideCircle(sourceX, sourceY, 256, 256, 178)) {
        color = COLORS.cream;
      }

      const handset =
        sourceY >= 145 &&
        sourceY <= 252 &&
        sourceX >= 132 &&
        sourceX <= 380 &&
        (
          sourceY <= 215 ||
          sourceX <= 205 ||
          sourceX >= 307
        );

      if (handset) {
        color = COLORS.green;
      }

      if (insideRoundedRect(sourceX, sourceY, 124, 264, 388, 369, 56)) {
        color = COLORS.orange;
      }

      if (insideCircle(sourceX, sourceY, 256, 314, 30)) {
        color = COLORS.cream;
      }

      setPixel(png, x, y, color);
    }
  }

  return png;
}

await mkdir("public/icons", { recursive: true });

for (const size of [192, 512]) {
  const png = createIcon(size);
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(`public/icons/icon-${size}.png`);
    stream.on("finish", resolve);
    stream.on("error", reject);
    png.pack().pipe(stream);
  });
}
