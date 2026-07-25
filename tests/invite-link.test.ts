import { describe, expect, it } from "vitest";
import {
  createInviteLink,
  decodeSharedSignal,
  hasInviteLink,
  readInviteLink,
} from "../src/invite-link";
import { encodeSignal } from "../src/signaling";
import type { AnswerSignal, OfferSignal } from "../src/types";

const offer: OfferSignal = {
  v: 1,
  kind: "offer",
  roomId: "0123456789abcdef0123456789abcdef",
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
  roomId: offer.roomId,
  connectionId: offer.connectionId,
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

describe("invite links", () => {
  it("stores the invitation in the URL fragment", () => {
    const link = createInviteLink(
      offer,
      "https://example.org/table-telephones/?tracking=discarded",
    );
    const url = new URL(link);

    expect(url.origin + url.pathname).toBe(
      "https://example.org/table-telephones/",
    );
    expect(url.search).toBe("");
    expect(url.hash).toContain("invite=");
    expect(url.href).not.toContain("?tracking=");
  });

  it("round-trips an invitation link", () => {
    const link = createInviteLink(
      offer,
      "https://example.org/table-telephones/",
    );

    expect(hasInviteLink(link)).toBe(true);
    expect(readInviteLink(link)).toEqual(offer);
    expect(decodeSharedSignal(link)).toEqual(offer);
  });

  it("still accepts a raw connection code", () => {
    expect(decodeSharedSignal(encodeSignal(answer))).toEqual(answer);
  });

  it("rejects an answer disguised as an invitation link", () => {
    const url = new URL("https://example.org/table-telephones/");
    url.hash = new URLSearchParams({
      invite: encodeSignal(answer),
    }).toString();

    expect(() => readInviteLink(url.toString())).toThrow(
      /keine Einladung/,
    );
  });

  it("rejects duplicate invitation values", () => {
    const url = new URL("https://example.org/table-telephones/");
    const fragment = new URLSearchParams();
    fragment.append("invite", encodeSignal(offer));
    fragment.append("invite", encodeSignal(offer));
    url.hash = fragment.toString();

    expect(() => readInviteLink(url.toString())).toThrow(/nicht eindeutig/);
  });

  it("does not mistake unrelated fragments for invitations", () => {
    const url = "https://example.org/table-telephones/#main";

    expect(hasInviteLink(url)).toBe(false);
    expect(readInviteLink(url)).toBeNull();
  });
});
