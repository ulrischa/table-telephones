import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import {
  createQrDisplaySize,
  createQrRenderOptions,
  decodeQrPixels,
  getQrModuleCount,
} from "../src/qr";
import { encodeSignal } from "../src/signaling";
import type { AnswerSignal } from "../src/types";

const answer: AnswerSignal = {
  v: 1,
  kind: "answer",
  roomId: "0123456789abcdef0123456789abcdef",
  connectionId: "abcdef0123456789abcdef0123456789",
  guest: {
    id: "22222222222222222222222222222222",
    name: "Kim",
    isHost: false,
  },
  description: {
    type: "answer",
    sdp: [
      "v=0",
      "o=- 123 2 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "a=group:BUNDLE 0",
      "a=ice-ufrag:abcd",
      "a=ice-pwd:abcdefghijklmnopqrstuvwxyz",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF",
      "a=setup:active",
      "a=mid:0",
      "a=sctp-port:5000",
      "a=max-message-size:262144",
      "a=candidate:842163049 1 udp 1677734910 192.168.178.42 52345 typ host generation 0 network-cost 999",
      "",
    ].join("\r\n"),
  },
};

function renderQrPixels(value: string): {
  data: Uint8ClampedArray;
  size: number;
} {
  const qr = QRCode.create(value, { errorCorrectionLevel: "L" });
  const options = createQrRenderOptions(value);
  const margin = options.margin;
  const scale = options.scale;
  const size = (qr.modules.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(255);

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) {
        continue;
      }

      const startX = (column + margin) * scale;
      const startY = (row + margin) * scale;
      for (let y = startY; y < startY + scale; y += 1) {
        for (let x = startX; x < startX + scale; x += 1) {
          const offset = (y * size + x) * 4;
          data[offset] = 16;
          data[offset + 1] = 43;
          data[offset + 2] = 36;
        }
      }
    }
  }

  return { data, size };
}

describe("QR rendering", () => {
  it("renders a dense answer code at an integer module scale and decodes it", () => {
    const code = encodeSignal(answer);
    const options = createQrRenderOptions(code);
    const rendered = renderQrPixels(code);

    expect(Number.isInteger(options.scale)).toBe(true);
    expect(options.margin).toBe(4);
    expect(rendered.size).toBeGreaterThanOrEqual(960);
    expect(decodeQrPixels(rendered.data, rendered.size, rendered.size)).toBe(code);
  });

  it("uses an integer number of physical pixels for every displayed module", () => {
    const code = encodeSignal(answer);
    const moduleCount = getQrModuleCount(code);
    const devicePixelRatio = 3;
    const displaySize = createQrDisplaySize(code, 296, devicePixelRatio);
    const physicalModuleSize =
      (displaySize * devicePixelRatio) / moduleCount;

    expect(displaySize).toBeLessThanOrEqual(296);
    expect(Number.isInteger(physicalModuleSize)).toBe(true);
    expect(physicalModuleSize).toBeGreaterThanOrEqual(1);
  });
});
