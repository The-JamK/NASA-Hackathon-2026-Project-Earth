// The globe texture is the whole planet, so its resolution is a product claim:
// 8192×4096 is 30 texels per degree at the equator, 4096×2048 is 15. Read the
// real image headers rather than trusting a filename.

import { readFileSync } from "node:fs";

const DIR = new URL("../public/textures/", import.meta.url);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function measure(name, minimum) {
  const buffer = readFileSync(new URL(name, DIR));
  const size = buffer[0] === 0xff && buffer[1] === 0xd8 ? jpegSize(buffer) : pngSize(buffer);
  if (!size) fail(`${name} has no readable image header`);
  if (size.width < minimum.width || size.height < minimum.height) {
    fail(
      `${name} is ${size.width}×${size.height}, below the ${minimum.width}×${minimum.height} the globe claims`
    );
  }
  if (size.width !== size.height * 2) fail(`${name} is ${size.width}×${size.height}, not a 2:1 equirectangular map`);
  return `${name} ${size.width}×${size.height} · ${(buffer.length / 1e6).toFixed(2)} MB`;
}

const report = [
  measure("earth-blue-marble.jpg", { width: 8192, height: 4096 }),
  measure("earth-topology.jpg", { width: 4096, height: 2048 }),
  measure("night-sky.png", { width: 4096, height: 2048 }),
];

for (const line of report) console.log(`  ${line}`);
console.log("textures verified");
