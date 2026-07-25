import { MAX_SIGNAL_TEXT_LENGTH } from "./config";
import { decodeSignal, encodeSignal } from "./signaling";
import type { ConnectionSignal, OfferSignal } from "./types";

const INVITE_FRAGMENT_KEY = "invite";
const MAX_INVITE_FRAGMENT_LENGTH = MAX_SIGNAL_TEXT_LENGTH + 64;

export function createInviteLink(
  signal: OfferSignal,
  baseUrl: string = window.location.href,
): string {
  const url = new URL(baseUrl);
  const fragment = new URLSearchParams();
  fragment.set(INVITE_FRAGMENT_KEY, encodeSignal(signal));

  url.search = "";
  url.hash = fragment.toString();
  return url.toString();
}

export function createInviteShareText(
  signal: OfferSignal,
  inviteLink: string,
): string {
  return [
    `${signal.host.name} invited you to a local chat with table-telephones.`,
    "",
    `Invitation link: ${inviteLink}`,
    "",
    'If the link does not open offline, start the installed app, choose "Join a chat", and paste this connection code:',
    encodeSignal(signal),
  ].join("\n");
}

export function hasInviteLink(urlValue: string): boolean {
  try {
    const url = new URL(urlValue);
    if (url.hash.length > MAX_INVITE_FRAGMENT_LENGTH) {
      return true;
    }
    return new URLSearchParams(url.hash.slice(1)).has(INVITE_FRAGMENT_KEY);
  } catch {
    return false;
  }
}

export function readInviteLink(urlValue: string): OfferSignal | null {
  const url = new URL(urlValue);
  const rawFragment = url.hash.slice(1);

  if (rawFragment.length === 0) {
    return null;
  }
  if (rawFragment.length > MAX_INVITE_FRAGMENT_LENGTH) {
    throw new Error("The invitation link is too large.");
  }

  const inviteValues = new URLSearchParams(rawFragment).getAll(INVITE_FRAGMENT_KEY);
  if (inviteValues.length === 0) {
    return null;
  }
  if (inviteValues.length !== 1) {
    throw new Error("The invitation link is ambiguous.");
  }

  const signal = decodeSignal(inviteValues[0] ?? "");
  if (signal.kind !== "offer") {
    throw new Error("This link does not contain an invitation.");
  }
  return signal;
}

export function decodeSharedSignal(rawValue: string): ConnectionSignal {
  try {
    return decodeSignal(rawValue);
  } catch (codeError) {
    try {
      const invite = readInviteLink(rawValue);
      if (invite) {
        return invite;
      }
    } catch (linkError) {
      if (hasInviteLink(rawValue)) {
        throw linkError;
      }
    }
    throw codeError;
  }
}

export function clearInviteFromAddress(): void {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
}
