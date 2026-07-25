import type { APP_PROTOCOL_VERSION } from "./config";

export type Role = "host" | "guest";

export interface Participant {
  id: string;
  name: string;
  isHost: boolean;
  isSelf: boolean;
}

export interface PublicParticipant {
  id: string;
  name: string;
  isHost: boolean;
}

export interface SessionDescriptionData {
  type: "offer" | "answer";
  sdp: string;
}

export interface OfferSignal {
  v: typeof APP_PROTOCOL_VERSION;
  kind: "offer";
  roomId: string;
  connectionId: string;
  host: PublicParticipant;
  description: SessionDescriptionData & { type: "offer" };
}

export interface AnswerSignal {
  v: typeof APP_PROTOCOL_VERSION;
  kind: "answer";
  roomId: string;
  connectionId: string;
  guest: PublicParticipant;
  description: SessionDescriptionData & { type: "answer" };
}

export type ConnectionSignal = OfferSignal | AnswerSignal;

export interface Sender {
  id: string;
  name: string;
}

export interface ChatTextMessage {
  id: string;
  kind: "text";
  sender: Sender;
  text: string;
  createdAt: number;
  isOwn: boolean;
}

export interface ChatImageMessage {
  id: string;
  kind: "image";
  sender: Sender;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
  isOwn: boolean;
}

export interface PreparedImage {
  bytes: Uint8Array<ArrayBuffer>;
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
}

export interface BasePacket {
  v: typeof APP_PROTOCOL_VERSION;
  type: string;
}

export interface TextPacket extends BasePacket {
  type: "text";
  id: string;
  text: string;
  createdAt: number;
  sender?: Sender;
}

export interface ImageStartPacket extends BasePacket {
  type: "image-start";
  id: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
  width: number;
  height: number;
  createdAt: number;
  sender?: Sender;
}

export interface ImageEndPacket extends BasePacket {
  type: "image-end";
  id: string;
}

export interface RoomStatePacket extends BasePacket {
  type: "room-state";
  participants: PublicParticipant[];
}

export type ControlPacket =
  | TextPacket
  | ImageStartPacket
  | ImageEndPacket
  | RoomStatePacket;

export interface ReceivedImage {
  meta: ImageStartPacket;
  bytes: Uint8Array<ArrayBuffer>;
  blob: Blob;
}

export interface RoomEvents {
  onParticipants: (participants: Participant[]) => void;
  onText: (message: ChatTextMessage) => void;
  onImage: (message: ChatImageMessage) => void;
  onSystem: (message: string) => void;
  onStatus: (message: string, ready: boolean) => void;
  onError: (message: string) => void;
}
