import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_RECEIVED_IMAGE_DIMENSION,
  MAX_SOURCE_IMAGE_BYTES,
} from "./config";
import type { PreparedImage } from "./types";

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Das Bild konnte nicht verarbeitet werden."));
        }
      },
      type,
      quality,
    );
  });
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Die Bilddatei ist beschädigt oder wird nicht unterstützt.");
  }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) {
    return false;
  }
  const text = String.fromCharCode(...bytes.subarray(0, 12));
  return text.startsWith("RIFF") && text.endsWith("WEBP");
}

export function detectImageMime(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (isJpeg(bytes)) {
    return "image/jpeg";
  }
  if (isPng(bytes)) {
    return "image/png";
  }
  if (isWebp(bytes)) {
    return "image/webp";
  }
  return null;
}

function fitDimensions(width: number, height: number, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Erlaubt sind JPEG-, PNG- und WebP-Bilder.");
  }
  if (file.size === 0 || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Das Ausgangsbild darf höchstens 12 MB groß sein.");
  }

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  if (detectImageMime(sourceBytes) !== file.type) {
    throw new Error("Dateityp und Bildinhalt stimmen nicht überein.");
  }

  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new Error("Die Bilddatei ist beschädigt oder wird nicht unterstützt.");
  }

  try {
    if (
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width > 20_000 ||
      decoded.height > 20_000
    ) {
      throw new Error("Die Bildabmessungen sind ungültig.");
    }

    const canvas = document.createElement("canvas");
    const initial = fitDimensions(
      decoded.width,
      decoded.height,
      MAX_IMAGE_DIMENSION,
    );
    canvas.width = initial.width;
    canvas.height = initial.height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Das Bild kann auf diesem Gerät nicht verarbeitet werden.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const attempts = [
      { type: "image/webp" as const, quality: 0.82, scale: 1 },
      { type: "image/webp" as const, quality: 0.68, scale: 0.82 },
      { type: "image/jpeg" as const, quality: 0.72, scale: 0.68 },
    ];

    let output: Blob | null = null;

    for (const attempt of attempts) {
      const targetWidth = Math.max(1, Math.round(initial.width * attempt.scale));
      const targetHeight = Math.max(1, Math.round(initial.height * attempt.scale));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        const resized = document.createElement("canvas");
        resized.width = targetWidth;
        resized.height = targetHeight;
        const resizedContext = resized.getContext("2d", { alpha: false });
        if (!resizedContext) {
          continue;
        }
        resizedContext.fillStyle = "#ffffff";
        resizedContext.fillRect(0, 0, targetWidth, targetHeight);
        resizedContext.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        context.drawImage(resized, 0, 0);
      }

      output = await canvasToBlob(canvas, attempt.type, attempt.quality);
      if (output.size <= MAX_IMAGE_BYTES) {
        break;
      }
    }

    if (!output || output.size > MAX_IMAGE_BYTES) {
      throw new Error("Das Bild bleibt nach der Verkleinerung zu groß.");
    }

    const bytes = new Uint8Array<ArrayBuffer>(await output.arrayBuffer());
    const detectedMime = detectImageMime(bytes);
    if (!detectedMime) {
      throw new Error("Das verarbeitete Bild ist ungültig.");
    }

    const blob = new Blob([bytes], { type: detectedMime });
    return {
      bytes,
      blob,
      width: canvas.width,
      height: canvas.height,
      fileName: file.name.slice(0, 120),
    };
  } finally {
    decoded.close();
  }
}

export async function validateReceivedImage(
  bytes: Uint8Array<ArrayBuffer>,
  declaredMime: string,
  declaredWidth: number,
  declaredHeight: number,
): Promise<Blob> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Das empfangene Bild ist zu groß.");
  }

  const detectedMime = detectImageMime(bytes);
  if (!detectedMime || detectedMime !== declaredMime) {
    throw new Error("Der empfangene Bildtyp ist ungültig.");
  }

  const blob = new Blob([bytes], { type: detectedMime });
  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(blob);
  } catch {
    throw new Error("Das empfangene Bild ist beschädigt.");
  }

  try {
    if (
      decoded.width !== declaredWidth ||
      decoded.height !== declaredHeight ||
      decoded.width > MAX_RECEIVED_IMAGE_DIMENSION ||
      decoded.height > MAX_RECEIVED_IMAGE_DIMENSION
    ) {
      throw new Error("Die empfangenen Bildabmessungen sind ungültig.");
    }
  } finally {
    decoded.close();
  }

  return blob;
}
