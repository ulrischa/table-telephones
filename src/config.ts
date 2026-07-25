export const APP_PROTOCOL_VERSION = 1 as const;
export const MAX_NAME_LENGTH = 40;
export const MAX_TEXT_LENGTH = 4_000;
export const MAX_SIGNAL_TEXT_LENGTH = 12_000;
export const MAX_SIGNAL_JSON_BYTES = 96 * 1024;
export const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1_600;
export const MAX_RECEIVED_IMAGE_DIMENSION = 4_096;
export const DATA_CHUNK_BYTES = 16 * 1024;
export const DATA_BUFFER_HIGH_WATER = 512 * 1024;
export const ICE_GATHERING_TIMEOUT_MS = 8_000;
export const INVITE_TTL_MS = 15 * 60 * 1_000;
export const SIGNAL_PREFIX = "tt1:";

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const PEER_CONFIGURATION: RTCConfiguration = {
  iceServers: [],
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 0,
};
