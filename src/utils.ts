import { MAX_NAME_LENGTH } from "./config";

const ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;

export function createId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFC")
    .replace(
      /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("de", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function getRequiredElement<T extends Element>(
  selector: string,
  constructor: { new (): T },
  root: ParentNode = document,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}
