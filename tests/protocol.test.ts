import { describe, expect, it } from "vitest";
import { APP_PROTOCOL_VERSION, MAX_TEXT_LENGTH } from "../src/config";
import { parseControlPacket } from "../src/channel";
import { detectImageMime } from "../src/images";

const id = "0123456789abcdef0123456789abcdef";

describe("data-channel protocol validation", () => {
  it("keeps text as inert data", () => {
    const packet = parseControlPacket(
      JSON.stringify({
        v: APP_PROTOCOL_VERSION,
        type: "text",
        id,
        text: "<img src=x onerror=alert(1)>",
        createdAt: 1,
      }),
    );

    expect(packet.type).toBe("text");
    if (packet.type === "text") {
      expect(packet.text).toBe("<img src=x onerror=alert(1)>");
    }
  });

  it("rejects oversized text", () => {
    expect(() =>
      parseControlPacket(
        JSON.stringify({
          v: APP_PROTOCOL_VERSION,
          type: "text",
          id,
          text: "x".repeat(MAX_TEXT_LENGTH + 1),
          createdAt: 1,
        }),
      ),
    ).toThrow(/text message/);
  });

  it("rejects duplicate participants", () => {
    expect(() =>
      parseControlPacket(
        JSON.stringify({
          v: APP_PROTOCOL_VERSION,
          type: "room-state",
          participants: [
            { id, name: "A", isHost: true },
            { id, name: "B", isHost: false },
          ],
        }),
      ),
    ).toThrow(/duplicate/);
  });
});

describe("image signatures", () => {
  it("recognizes only allowed raster formats", () => {
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe(
      "image/jpeg",
    );
    expect(
      detectImageMime(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(
      detectImageMime(
        new TextEncoder().encode("RIFFxxxxWEBP"),
      ),
    ).toBe("image/webp");
    expect(detectImageMime(new TextEncoder().encode("<svg>"))).toBeNull();
  });
});
