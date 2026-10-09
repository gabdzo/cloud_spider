import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { buildingFrame } from "../src/sprites.js";

const PALETTE = {
  0: [26, 22, 18, 255],
  1: [58, 42, 20, 255],
  2: [107, 83, 68, 255],
  3: [255, 204, 51, 255],
  4: [26, 18, 12, 255],
  5: [255, 242, 168, 255],
  7: [196, 85, 58, 255],
};

const panels = [
  ["running", 0],
  ["stopped", 0],
  ["pending", 0],
  ["pending", 1],
  ["stopping", 0],
  ["stopping", 1],
];

const scale = 10;
const pad = 16;
const cell = 16 * scale;
const width = panels.length * (cell + pad) + pad;
const height = cell + pad * 2;
const pixels = Buffer.alloc(width * height * 4, 0);
for (let i = 0; i < width * height; i += 1) {
  pixels[i * 4] = 20;
  pixels[i * 4 + 1] = 17;
  pixels[i * 4 + 2] = 13;
  pixels[i * 4 + 3] = 255;
}

panels.forEach(([state, phase], index) => {
  const frame = buildingFrame(state, phase);
  const originX = pad + index * (cell + pad);
  const originY = pad;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const color = PALETTE[frame[y][x]] || PALETTE[0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = originX + x * scale + sx;
          const py = originY + y * scale + sy;
          const offset = (py * width + px) * 4;
          pixels[offset] = color[0];
          pixels[offset + 1] = color[1];
          pixels[offset + 2] = color[2];
          pixels[offset + 3] = color[3];
        }
      }
    }
  }
});

writeFileSync(new URL("../preview.png", import.meta.url), png(width, height, pixels));

function png(imageWidth, imageHeight, rgba) {
  const raw = Buffer.alloc((imageWidth * 4 + 1) * imageHeight);
  for (let y = 0; y < imageHeight; y += 1) {
    const row = y * (imageWidth * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * imageWidth * 4, (y + 1) * imageWidth * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(imageWidth, 0);
  ihdr.writeUInt32BE(imageHeight, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return crc ^ 0xffffffff;
}
