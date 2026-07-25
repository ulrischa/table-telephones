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
    `${signal.host.name} lädt dich zu einem lokalen Chat mit table-telephones ein.`,
    "",
    `Einladungslink: ${inviteLink}`,
    "",
    "Falls der Link offline nicht öffnet: Starte die bereits installierte App, wähle „Chat beitreten“ und füge diesen Verbindungscode ein:",
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
    throw new Error("Der Einladungslink ist zu groß.");
  }

  const inviteValues = new URLSearchParams(rawFragment).getAll(INVITE_FRAGMENT_KEY);
  if (inviteValues.length === 0) {
    return null;
  }
  if (inviteValues.length !== 1) {
    throw new Error("Der Einladungslink ist nicht eindeutig.");
  }

  const signal = decodeSignal(inviteValues[0] ?? "");
  if (signal.kind !== "offer") {
    throw new Error("Dieser Link enthält keine Einladung.");
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
