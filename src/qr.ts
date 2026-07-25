import jsQR from "jsqr";
import QRCode from "qrcode";
import { ALLOWED_IMAGE_TYPES, MAX_QR_IMAGE_BYTES } from "./config";
import { detectImageMime } from "./images";

export async function renderQrCode(
  canvas: HTMLCanvasElement,
  value: string,
): Promise<void> {
  const width = Math.min(360, Math.max(240, window.innerWidth - 80));
  await QRCode.toCanvas(canvas, value, {
    errorCorrectionLevel: "L",
    margin: 2,
    width,
    color: {
      dark: "#102b24",
      light: "#ffffff",
    },
  });
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "QR-Code mit Verbindungsdaten");
}

export function canvasToPngFile(
  canvas: HTMLCanvasElement,
  fileName: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Der QR-Code konnte nicht als Bild erstellt werden."));
        return;
      }
      resolve(new File([blob], fileName, { type: "image/png" }));
    }, "image/png");
  });
}

export async function shareQrCode(file: File, code: string): Promise<void> {
  if (!navigator.share) {
    throw new Error("Teilen wird von diesem Browser nicht unterstützt.");
  }

  const fileData: ShareData = {
    title: "table-telephones Verbindung",
    text: "Verbindungscode für table-telephones",
    files: [file],
  };

  if (navigator.canShare?.(fileData)) {
    await navigator.share(fileData);
    return;
  }

  await navigator.share({
    title: "table-telephones Verbindung",
    text: code,
  });
}

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) {
    return null;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return (
    jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    })?.data ?? null
  );
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
    await this.video.play();
    this.active = true;

    const scanFrame = (time: number) => {
      if (!this.active) {
        return;
      }

      if (
        time - this.lastScanAt >= 120 &&
        this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        this.lastScanAt = time;
        const maxWidth = 720;
        const scale = Math.min(1, maxWidth / this.video.videoWidth);
        this.canvas.width = Math.max(1, Math.round(this.video.videoWidth * scale));
        this.canvas.height = Math.max(1, Math.round(this.video.videoHeight * scale));
        const context = this.canvas.getContext("2d", { willReadFrequently: true });
        context?.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        const code = decodeCanvas(this.canvas);
        if (code) {
          this.stop();
          onCode(code);
          return;
        }
      }

      this.animationFrame = requestAnimationFrame(scanFrame);
    };

    this.animationFrame = requestAnimationFrame(scanFrame);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
  }
}
