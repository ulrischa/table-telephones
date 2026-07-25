import jsQR from "jsqr";
import QRCode from "qrcode";
import { ALLOWED_IMAGE_TYPES, MAX_QR_IMAGE_BYTES } from "./config";
import { detectImageMime } from "./images";

const QR_ERROR_CORRECTION_LEVEL = "L" as const;
const QR_MARGIN_MODULES = 4;
const MIN_QR_RENDER_PIXELS = 960;
const MAX_CAMERA_DECODE_DIMENSION = 1_600;

type CameraFocusMode = "continuous" | "single-shot";

interface CameraRange {
  min: number;
  max: number;
  step: number;
}

interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  torch?: boolean;
  zoom?: CameraRange;
}

interface ExtendedMediaTrackSettings extends MediaTrackSettings {
  zoom?: number;
}

interface CameraConstraintSet {
  focusMode?: CameraFocusMode;
  torch?: boolean;
  zoom?: number;
}

export interface CameraControlState {
  canRefocus: boolean;
  canUseTorch: boolean;
  zoom: (CameraRange & { value: number }) | null;
}

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
  const moduleCount = getQrModuleCount(value);
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

export function getQrModuleCount(value: string): number {
  return (
    QRCode.create(value, {
      errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    }).modules.size +
    QR_MARGIN_MODULES * 2
  );
}

export function createQrDisplaySize(
  value: string,
  maxCssPixels: number,
  devicePixelRatio: number,
): number {
  const moduleCount = getQrModuleCount(value);
  const pixelRatio = Math.max(1, devicePixelRatio);
  const physicalModuleScale = Math.max(
    1,
    Math.floor((maxCssPixels * pixelRatio) / moduleCount),
  );
  return (moduleCount * physicalModuleScale) / pixelRatio;
}

export async function renderQrCode(
  canvas: HTMLCanvasElement,
  value: string,
): Promise<void> {
  await QRCode.toCanvas(canvas, value, createQrRenderOptions(value));
  const maxCssPixels = Math.min(360, Math.max(200, window.innerWidth - 64));
  const displaySize = createQrDisplaySize(
    value,
    maxCssPixels,
    window.devicePixelRatio,
  );
  canvas.style.setProperty("--qr-display-size", `${displaySize}px`);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "QR code containing connection data");
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
    throw new Error("The QR image could not be read.");
  }
}

export async function scanQrImage(file: File): Promise<string> {
  if (
    !ALLOWED_IMAGE_TYPES.has(file.type) ||
    file.size === 0 ||
    file.size > MAX_QR_IMAGE_BYTES
  ) {
    throw new Error("Choose a JPEG, PNG, or WebP image up to 10 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectImageMime(bytes) !== file.type) {
    throw new Error("The selected QR image has an invalid file type.");
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
      throw new Error("This device cannot process the QR code.");
    }
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const code = decodeCanvas(canvas);
    if (!code) {
      throw new Error("No readable QR code was found in the image.");
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
  private videoTrack: MediaStreamTrack | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(onCode: (code: string) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("The camera is not available in this browser.");
    }

    this.stop();
    this.stream = await this.openCamera();
    this.videoTrack = this.stream.getVideoTracks()[0] ?? null;
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
      try {
        await this.applyPreferredFocus();
      } catch {
        // Camera enhancements are optional; scanning must still remain available.
      }
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

      if (time - this.lastScanAt >= 180) {
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

  getControlState(): CameraControlState {
    const capabilities = this.getCapabilities();
    const settings = this.videoTrack?.getSettings() as
      | ExtendedMediaTrackSettings
      | undefined;
    const focusModes = capabilities?.focusMode ?? [];
    const zoom = capabilities?.zoom;

    return {
      canRefocus:
        focusModes.includes("single-shot") ||
        focusModes.includes("continuous"),
      canUseTorch: capabilities?.torch === true,
      zoom:
        zoom && zoom.max > zoom.min
          ? {
              ...zoom,
              step: zoom.step > 0 ? zoom.step : 0.1,
              value: Math.min(
                zoom.max,
                Math.max(zoom.min, settings?.zoom ?? zoom.min),
              ),
            }
          : null,
    };
  }

  async refocus(): Promise<void> {
    const focusModes = this.getCapabilities()?.focusMode ?? [];
    if (focusModes.includes("single-shot")) {
      await this.applyAdvancedConstraint({ focusMode: "single-shot" });
      if (focusModes.includes("continuous")) {
        window.setTimeout(() => {
          if (this.active) {
            void this.applyAdvancedConstraint({ focusMode: "continuous" });
          }
        }, 750);
      }
      return;
    }

    if (focusModes.includes("continuous")) {
      await this.applyAdvancedConstraint({ focusMode: "continuous" });
    }
  }

  async setZoom(value: number): Promise<void> {
    const zoom = this.getCapabilities()?.zoom;
    if (!zoom) {
      return;
    }
    const safeValue = Math.min(zoom.max, Math.max(zoom.min, value));
    await this.applyAdvancedConstraint({ zoom: safeValue });
  }

  async setTorch(enabled: boolean): Promise<void> {
    if (this.getCapabilities()?.torch !== true) {
      return;
    }
    await this.applyAdvancedConstraint({ torch: enabled });
  }

  private async openCamera(): Promise<MediaStream> {
    const createConstraints = (
      facingMode: ConstrainDOMString,
    ): MediaStreamConstraints => ({
      audio: false,
      video: {
        facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
        advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
      },
    });

    try {
      return await navigator.mediaDevices.getUserMedia(
        createConstraints({ exact: "environment" }),
      );
    } catch (error) {
      if (
        error instanceof DOMException &&
        ["NotAllowedError", "SecurityError"].includes(error.name)
      ) {
        throw error;
      }
      return navigator.mediaDevices.getUserMedia(
        createConstraints({ ideal: "environment" }),
      );
    }
  }

  private getCapabilities(): ExtendedMediaTrackCapabilities | null {
    if (!this.videoTrack?.getCapabilities) {
      return null;
    }
    return this.videoTrack.getCapabilities() as ExtendedMediaTrackCapabilities;
  }

  private async applyPreferredFocus(): Promise<void> {
    const focusModes = this.getCapabilities()?.focusMode ?? [];
    if (focusModes.includes("continuous")) {
      await this.applyAdvancedConstraint({ focusMode: "continuous" });
    }
  }

  private applyAdvancedConstraint(
    constraint: CameraConstraintSet,
  ): Promise<void> {
    if (!this.videoTrack) {
      return Promise.resolve();
    }
    return this.videoTrack.applyConstraints({
      advanced: [constraint as MediaTrackConstraintSet],
    });
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

    const scale = Math.min(
      1,
      MAX_CAMERA_DECODE_DIMENSION /
        Math.max(this.video.videoWidth, this.video.videoHeight),
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
    this.videoTrack = null;
    this.video.srcObject = null;
  }
}
