import { describe, expect, it } from "vitest";
import { strToU8, zlibSync } from "fflate";
import { MAX_SIGNAL_JSON_BYTES, SIGNAL_PREFIX } from "../src/config";
import { decodeSignal, encodeSignal, validateSignal } from "../src/signaling";
import type { AnswerSignal, OfferSignal } from "../src/types";

const id = "0123456789abcdef0123456789abcdef";

const offer: OfferSignal = {
  v: 1,
  kind: "offer",
  roomId: id,
  connectionId: "abcdef0123456789abcdef0123456789",
  host: {
    id: "11111111111111111111111111111111",
    name: "Uli",
    isHost: true,
  },
  description: {
    type: "offer",
    sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
  },
};

const answer: AnswerSignal = {
  v: 1,
  kind: "answer",
  roomId: id,
  connectionId: "abcdef0123456789abcdef0123456789",
  guest: {
    id: "22222222222222222222222222222222",
    name: "Kim",
    isHost: false,
  },
  description: {
    type: "answer",
    sdp: "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
  },
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

describe("manual signaling codec", () => {
  it.each([offer, answer])("round-trips a $kind signal", (signal) => {
    expect(decodeSignal(encodeSignal(signal))).toEqual(signal);
  });

  it("rejects a signal with an incompatible role", () => {
    expect(() =>
      validateSignal({
        ...offer,
        host: { ...offer.host, isHost: false },
      }),
    ).toThrow(/Teilnehmer/);
  });

  it("rejects non-table-telephones content", () => {
    expect(() => decodeSignal("https://example.org")).toThrow(
      /kein table-telephones/,
    );
  });

  it("bounds decompressed signal data", () => {
    const compressed = zlibSync(strToU8("x".repeat(MAX_SIGNAL_JSON_BYTES + 1)));
    const code = `${SIGNAL_PREFIX}${toBase64Url(compressed)}`;
    expect(() => decodeSignal(code)).toThrow(/zu groß/);
  });
});
