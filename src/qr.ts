import jsQR from "jsqr";
import QRCode from "qrcode";
import { ALLOWED_IMAGE_TYPES, MAX_QR_IMAGE_BYTES } from "./config";
import { detectImageMime } from "./images";

const QR_ERROR_CORRECTION_LEVEL = "L" as const;
const QR_MARGIN_MODULES = 4;
const MIN_QR_RENDER_PIXELS = 960;

interface DetectedBarcode {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

function createNativeQrDetector(): BarcodeDetectorLike | null {
  const constructor = (
    window as typeof window & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    }
  ).BarcodeDetector;

  if (!constructor) {
    return null;
  }

  try {
    return new constructor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function createQrRenderOptions(value: string) {
  const moduleCount =
    QRCode.create(value, {
      errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    }).modules.size +
    QR_MARGIN_MODULES * 2;
  const scale = Math.max(6, Math.ceil(MIN_QR_RENDER_PIXELS / moduleCount));

  return {
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    margin: QR_MARGIN_MODULES,
    scale,
    color: {
      dark: "#102b24",
      light: "#ffffff",
    },
  };
}

export async function renderQrCode(
  canvas: HTMLCanvasElement,
  value: string,
): Promise<void> {
  await QRCode.toCanvas(canvas, value, createQrRenderOptions(value));
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "QR-Code mit Verbindungsdaten");
}

export function decodeQrPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  return (
    jsQR(data, width, height, {
      inversionAttempts: "attemptBoth",
    })?.data ?? null
  );
}

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) {
    return null;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return decodeQrPixels(imageData.data, imageData.width, imageData.height);
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
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
    throw new Error("Das QR-Bild konnte nicht gelesen werden.");
  }
}

export async function scanQrImage(file: File): Promise<string> {
  if (
    !ALLOWED_IMAGE_TYPES.has(file.type) ||
    file.size === 0 ||
    file.size > MAX_QR_IMAGE_BYTES
  ) {
    throw new Error("Bitte wähle ein JPEG-, PNG- oder WebP-Bild bis 10 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectImageMime(bytes) !== file.type) {
    throw new Error("Das ausgewählte QR-Bild hat einen ungültigen Dateityp.");
  }

  const decoded = await loadImage(file);
  try {
    const maxDimension = 1_600;
    const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Der QR-Code kann auf diesem Gerät nicht verarbeitet werden.");
    }
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const code = decodeCanvas(canvas);
    if (!code) {
      throw new Error("Auf dem Bild wurde kein lesbarer QR-Code gefunden.");
    }
    return code;
  } finally {
    decoded.close();
  }
}

export class CameraQrScanner {
  private readonly video: HTMLVideoElement;
  private readonly canvas = document.createElement("canvas");
  private stream: MediaStream | null = null;
  private animationFrame = 0;
  private lastScanAt = 0;
  private active = false;
  private nativeDetector = createNativeQrDetector();

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(onCode: (code: string) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Die Kamera ist in diesem Browser nicht verfügbar.");
    }

    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch (error) {
      this.stop();
      throw error;
    }
    this.active = true;
    this.lastScanAt = 0;

    const scanFrame = (time: number) => {
      if (!this.active) {
        return;
      }

      if (time - this.lastScanAt >= 160) {
        this.lastScanAt = time;
        void this.decodeVideoFrame()
          .then((code) => {
            if (!this.active) {
              return;
            }
            if (code) {
              this.stop();
              onCode(code);
              return;
            }
            this.animationFrame = requestAnimationFrame(scanFrame);
          })
          .catch(() => {
            if (this.active) {
              this.animationFrame = requestAnimationFrame(scanFrame);
            }
          });
        return;
      }

      this.animationFrame = requestAnimationFrame(scanFrame);
    };

    this.animationFrame = requestAnimationFrame(scanFrame);
  }

  private async decodeVideoFrame(): Promise<string | null> {
    if (
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      this.video.videoWidth === 0 ||
      this.video.videoHeight === 0
    ) {
      return null;
    }

    if (this.nativeDetector) {
      try {
        const result = await this.nativeDetector.detect(this.video);
        const code = result.find((item) => item.rawValue)?.rawValue;
        if (code) {
          return code;
        }
      } catch {
        this.nativeDetector = null;
      }
    }

    const maxDimension = 1_280;
    const scale = Math.min(
      1,
      maxDimension / Math.max(this.video.videoWidth, this.video.videoHeight),
    );
    this.canvas.width = Math.max(
      1,
      Math.round(this.video.videoWidth * scale),
    );
    this.canvas.height = Math.max(
      1,
      Math.round(this.video.videoHeight * scale),
    );
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }
    context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return decodeCanvas(this.canvas);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.lastScanAt = 0;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
  }
}
