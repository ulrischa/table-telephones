import {
  APP_PROTOCOL_VERSION,
  DATA_BUFFER_HIGH_WATER,
  DATA_CHUNK_BYTES,
  MAX_IMAGE_BYTES,
  MAX_RECEIVED_IMAGE_DIMENSION,
  MAX_TEXT_LENGTH,
} from "./config";
import { validateReceivedImage } from "./images";
import type {
  ControlPacket,
  ImageEndPacket,
  ImageStartPacket,
  PublicParticipant,
  ReceivedImage,
  RoomStatePacket,
  Sender,
  TextPacket,
} from "./types";
import { isPlainObject, isValidId, normalizeName } from "./utils";

const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_PARTICIPANTS = 128;

interface ChannelCallbacks {
  onControl: (packet: Exclude<ControlPacket, ImageStartPacket | ImageEndPacket>) => void;
  onImage: (image: ReceivedImage) => void;
  onOpen: () => void;
  onClose: () => void;
  onProtocolError: (message: string) => void;
}

interface IncomingImageState {
  meta: ImageStartPacket;
  chunks: Uint8Array<ArrayBuffer>[];
  receivedBytes: number;
}

function validateSender(value: unknown): Sender | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value) || !isValidId(value.id) || typeof value.name !== "string") {
    throw new Error("Ungültige Absenderdaten.");
  }
  const name = normalizeName(value.name);
  if (!name) {
    throw new Error("Ungültiger Absendername.");
  }
  return { id: value.id, name };
}

function validateTimestamp(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  ) {
    throw new Error("Ungültiger Zeitstempel.");
  }
  return Math.round(value);
}

function validateTextPacket(value: Record<string, unknown>): TextPacket {
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (
    !isValidId(value.id) ||
    text.length === 0 ||
    text.length > MAX_TEXT_LENGTH
  ) {
    throw new Error("Ungültige Textnachricht.");
  }

  const sender = validateSender(value.sender);
  const packet: TextPacket = {
    v: APP_PROTOCOL_VERSION,
    type: "text",
    id: value.id,
    text,
    createdAt: validateTimestamp(value.createdAt),
  };
  if (sender) {
    packet.sender = sender;
  }
  return packet;
}

function validateImageStart(value: Record<string, unknown>): ImageStartPacket {
  if (
    !isValidId(value.id) ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(value.mime)) ||
    typeof value.byteLength !== "number" ||
    !Number.isInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > MAX_IMAGE_BYTES ||
    typeof value.width !== "number" ||
    !Number.isInteger(value.width) ||
    value.width < 1 ||
    value.width > MAX_RECEIVED_IMAGE_DIMENSION ||
    typeof value.height !== "number" ||
    !Number.isInteger(value.height) ||
    value.height < 1 ||
    value.height > MAX_RECEIVED_IMAGE_DIMENSION
  ) {
    throw new Error("Ungültige Bildmetadaten.");
  }

  const sender = validateSender(value.sender);
  const packet: ImageStartPacket = {
    v: APP_PROTOCOL_VERSION,
    type: "image-start",
    id: value.id,
    mime: value.mime as ImageStartPacket["mime"],
    byteLength: value.byteLength,
    width: value.width,
    height: value.height,
    createdAt: validateTimestamp(value.createdAt),
  };
  if (sender) {
    packet.sender = sender;
  }
  return packet;
}

function validateRoomState(value: Record<string, unknown>): RoomStatePacket {
  if (!Array.isArray(value.participants) || value.participants.length > MAX_PARTICIPANTS) {
    throw new Error("Ungültige Teilnehmerliste.");
  }

  const ids = new Set<string>();
  const participants: PublicParticipant[] = value.participants.map((entry) => {
    if (
      !isPlainObject(entry) ||
      !isValidId(entry.id) ||
      typeof entry.name !== "string" ||
      typeof entry.isHost !== "boolean"
    ) {
      throw new Error("Ungültige Teilnehmerdaten.");
    }
    const name = normalizeName(entry.name);
    if (!name || ids.has(entry.id)) {
      throw new Error("Ungültige oder doppelte Teilnehmerdaten.");
    }
    ids.add(entry.id);
    return { id: entry.id, name, isHost: entry.isHost };
  });

  return { v: APP_PROTOCOL_VERSION, type: "room-state", participants };
}

export function parseControlPacket(raw: string): ControlPacket {
  if (new Blob([raw]).size > MAX_CONTROL_BYTES) {
    throw new Error("Steuernachricht ist zu groß.");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Steuernachricht ist kein gültiges JSON.");
  }

  if (!isPlainObject(value) || value.v !== APP_PROTOCOL_VERSION) {
    throw new Error("Unbekannte Protokollversion.");
  }

  switch (value.type) {
    case "text":
      return validateTextPacket(value);
    case "image-start":
      return validateImageStart(value);
    case "image-end":
      if (!isValidId(value.id)) {
        throw new Error("Ungültiger Bildabschluss.");
      }
      return { v: APP_PROTOCOL_VERSION, type: "image-end", id: value.id };
    case "room-state":
      return validateRoomState(value);
    default:
      throw new Error("Unbekannter Nachrichtentyp.");
  }
}

export class ChannelTransport {
  readonly channel: RTCDataChannel;
  private readonly callbacks: ChannelCallbacks;
  private incomingImage: IncomingImageState | null = null;
  private incomingQueue: Promise<void> = Promise.resolve();
  private outgoingQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(channel: RTCDataChannel, callbacks: ChannelCallbacks) {
    this.channel = channel;
    this.callbacks = callbacks;
    this.channel.binaryType = "arraybuffer";
    this.channel.bufferedAmountLowThreshold = DATA_BUFFER_HIGH_WATER / 2;

    this.channel.addEventListener("open", () => callbacks.onOpen());
    this.channel.addEventListener("close", () => {
      this.closed = true;
      callbacks.onClose();
    });
    this.channel.addEventListener("error", () => {
      callbacks.onProtocolError("Die Datenverbindung ist fehlgeschlagen.");
    });
    this.channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      this.incomingQueue = this.incomingQueue
        .then(() => this.handleIncoming(event.data))
        .catch((error: unknown) => this.fail(error));
    });
  }

  isOpen(): boolean {
    return !this.closed && this.channel.readyState === "open";
  }

  sendControl(packet: ControlPacket): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen();
      this.channel.send(JSON.stringify(packet));
    });
  }

  sendImage(meta: ImageStartPacket, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen();
      this.channel.send(JSON.stringify(meta));

      for (let offset = 0; offset < bytes.byteLength; offset += DATA_CHUNK_BYTES) {
        await this.waitForBuffer();
        const chunk = bytes.slice(offset, offset + DATA_CHUNK_BYTES);
        this.channel.send(chunk);
      }

      const end: ImageEndPacket = {
        v: APP_PROTOCOL_VERSION,
        type: "image-end",
        id: meta.id,
      };
      this.channel.send(JSON.stringify(end));
    });
  }

  close(): void {
    this.closed = true;
    if (this.channel.readyState !== "closed") {
      this.channel.close();
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.outgoingQueue.then(task);
    this.outgoingQueue = result.catch(() => undefined);
    return result;
  }

  private assertOpen(): void {
    if (!this.isOpen()) {
      throw new Error("Die Datenverbindung ist nicht geöffnet.");
    }
  }

  private async waitForBuffer(): Promise<void> {
    if (this.channel.bufferedAmount <= DATA_BUFFER_HIGH_WATER) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Die Datenübertragung hat zu lange gedauert."));
      }, 15_000);

      const onLow = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Die Datenverbindung wurde geschlossen."));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        this.channel.removeEventListener("bufferedamountlow", onLow);
        this.channel.removeEventListener("close", onClose);
      };

      this.channel.addEventListener("bufferedamountlow", onLow, { once: true });
      this.channel.addEventListener("close", onClose, { once: true });
    });
  }

  private async handleIncoming(data: unknown): Promise<void> {
    if (typeof data === "string") {
      await this.handleControl(parseControlPacket(data));
      return;
    }

    let bytes: Uint8Array<ArrayBuffer>;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (data instanceof Blob) {
      bytes = new Uint8Array<ArrayBuffer>(await data.arrayBuffer());
    } else {
      throw new Error("Unbekanntes Binärformat.");
    }

    if (!this.incomingImage) {
      throw new Error("Bilddaten ohne Metadaten empfangen.");
    }

    this.incomingImage.receivedBytes += bytes.byteLength;
    if (this.incomingImage.receivedBytes > this.incomingImage.meta.byteLength) {
      throw new Error("Zu viele Bilddaten empfangen.");
    }
    this.incomingImage.chunks.push(bytes);
  }

  private async handleControl(packet: ControlPacket): Promise<void> {
    if (packet.type === "image-start") {
      if (this.incomingImage) {
        throw new Error("Überlappende Bildübertragung.");
      }
      this.incomingImage = { meta: packet, chunks: [], receivedBytes: 0 };
      return;
    }

    if (packet.type === "image-end") {
      const incoming = this.incomingImage;
      if (
        !incoming ||
        incoming.meta.id !== packet.id ||
        incoming.receivedBytes !== incoming.meta.byteLength
      ) {
        throw new Error("Unvollständige Bildübertragung.");
      }

      const bytes = new Uint8Array(incoming.receivedBytes) as Uint8Array<ArrayBuffer>;
      let offset = 0;
      for (const chunk of incoming.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      this.incomingImage = null;

      const blob = await validateReceivedImage(
        bytes,
        incoming.meta.mime,
        incoming.meta.width,
        incoming.meta.height,
      );
      this.callbacks.onImage({ meta: incoming.meta, bytes, blob });
      return;
    }

    if (this.incomingImage) {
      throw new Error("Steuernachricht während einer Bildübertragung.");
    }

    this.callbacks.onControl(packet);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : "Ungültige Daten empfangen.";
    this.callbacks.onProtocolError(message);
    this.close();
  }
}
