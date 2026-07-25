import { strFromU8, strToU8, Unzlib, zlibSync } from "fflate";
import {
  APP_PROTOCOL_VERSION,
  MAX_NAME_LENGTH,
  MAX_SIGNAL_JSON_BYTES,
  MAX_SIGNAL_TEXT_LENGTH,
  SIGNAL_PREFIX,
} from "./config";
import type {
  AnswerSignal,
  ConnectionSignal,
  OfferSignal,
  PublicParticipant,
  SessionDescriptionData,
} from "./types";
import { isPlainObject, isValidId, normalizeName } from "./utils";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const batchSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    const batch = bytes.subarray(offset, offset + batchSize);
    binary += String.fromCharCode(...batch);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new Error("The connection code contains invalid characters.");
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safeUnzlib(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  const decompressor = new Unzlib((chunk) => {
    totalLength += chunk.length;
    if (totalLength > MAX_SIGNAL_JSON_BYTES) {
      throw new Error("The connection code is too large.");
    }
    chunks.push(chunk);
  });

  decompressor.push(bytes, true);

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function validateParticipant(
  value: unknown,
  expectedHost: boolean,
): PublicParticipant {
  if (!isPlainObject(value) || !isValidId(value.id)) {
    throw new Error("The connection code contains invalid participant data.");
  }

  const name = typeof value.name === "string" ? normalizeName(value.name) : "";
  if (
    name.length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    value.isHost !== expectedHost
  ) {
    throw new Error("The participant name in the connection code is invalid.");
  }

  return { id: value.id, name, isHost: expectedHost };
}

function validateDescription(
  value: unknown,
  expectedType: "offer" | "answer",
): SessionDescriptionData {
  if (
    !isPlainObject(value) ||
    value.type !== expectedType ||
    typeof value.sdp !== "string" ||
    value.sdp.length < 10 ||
    value.sdp.length > MAX_SIGNAL_JSON_BYTES ||
    !value.sdp.startsWith("v=0")
  ) {
    throw new Error("The WebRTC description in the connection code is invalid.");
  }

  return { type: expectedType, sdp: value.sdp };
}

export function validateSignal(value: unknown): ConnectionSignal {
  if (
    !isPlainObject(value) ||
    value.v !== APP_PROTOCOL_VERSION ||
    !isValidId(value.roomId) ||
    !isValidId(value.connectionId)
  ) {
    throw new Error("The connection code is not compatible with this app.");
  }

  if (value.kind === "offer") {
    const signal: OfferSignal = {
      v: APP_PROTOCOL_VERSION,
      kind: "offer",
      roomId: value.roomId,
      connectionId: value.connectionId,
      host: validateParticipant(value.host, true),
      description: {
        ...validateDescription(value.description, "offer"),
        type: "offer",
      },
    };
    return signal;
  }

  if (value.kind === "answer") {
    const signal: AnswerSignal = {
      v: APP_PROTOCOL_VERSION,
      kind: "answer",
      roomId: value.roomId,
      connectionId: value.connectionId,
      guest: validateParticipant(value.guest, false),
      description: {
        ...validateDescription(value.description, "answer"),
        type: "answer",
      },
    };
    return signal;
  }

  throw new Error("The connection code has an unknown type.");
}

export function encodeSignal(signal: ConnectionSignal): string {
  const json = JSON.stringify(signal);
  const bytes = strToU8(json);

  if (bytes.length > MAX_SIGNAL_JSON_BYTES) {
    throw new Error("The connection data is too large.");
  }

  const compressed = zlibSync(bytes, { level: 9 });
  return `${SIGNAL_PREFIX}${toBase64Url(compressed)}`;
}

export function decodeSignal(rawValue: string): ConnectionSignal {
  const value = rawValue.trim();

  if (value.length === 0 || value.length > MAX_SIGNAL_TEXT_LENGTH) {
    throw new Error("The connection code is empty or too large.");
  }
  if (!value.startsWith(SIGNAL_PREFIX)) {
    throw new Error("This is not a table-telephones connection code.");
  }

  const compressed = fromBase64Url(value.slice(SIGNAL_PREFIX.length));
  const jsonBytes = safeUnzlib(compressed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(jsonBytes));
  } catch {
    throw new Error("The connection code is corrupted.");
  }

  return validateSignal(parsed);
}
