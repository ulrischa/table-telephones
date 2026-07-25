import type { ConnectionSignal } from "./types";
import {
  createInviteLink,
  createInviteShareText,
  decodeSharedSignal,
} from "./invite-link";
import { encodeSignal } from "./signaling";
import { CameraQrScanner, renderQrCode, scanQrImage } from "./qr";
import { getRequiredElement } from "./utils";

interface ShowCodeOptions {
  signal: ConnectionSignal;
  step: string;
  title: string;
  instruction: string;
  nextLabel?: string;
}

export class SignalUi {
  private readonly signalDialog = getRequiredElement(
    "#signal-dialog",
    HTMLDialogElement,
  );
  private readonly signalStep = getRequiredElement("#signal-step", HTMLElement);
  private readonly signalTitle = getRequiredElement("#signal-title", HTMLElement);
  private readonly signalContent = getRequiredElement("#signal-content", HTMLElement);
  private readonly scannerDialog = getRequiredElement(
    "#scanner-dialog",
    HTMLDialogElement,
  );
  private readonly scannerTitle = getRequiredElement("#scanner-title", HTMLElement);
  private readonly scannerVideo = getRequiredElement("#scanner-video", HTMLVideoElement);
  private readonly scannerStatus = getRequiredElement("#scanner-status", HTMLElement);
  private readonly scannerControls = getRequiredElement(
    "#scanner-controls",
    HTMLElement,
  );
  private readonly scannerRefocus = getRequiredElement(
    "#scanner-refocus",
    HTMLButtonElement,
  );
  private readonly scannerZoomControl = getRequiredElement(
    "#scanner-zoom-control",
    HTMLLabelElement,
  );
  private readonly scannerZoom = getRequiredElement(
    "#scanner-zoom",
    HTMLInputElement,
  );
  private readonly scannerTorch = getRequiredElement(
    "#scanner-torch",
    HTMLButtonElement,
  );
  private readonly qrImageInput = getRequiredElement("#qr-image-input", HTMLInputElement);
  private readonly signalPasteLabel = getRequiredElement(
    "#signal-paste-label",
    HTMLLabelElement,
  );
  private readonly signalPaste = getRequiredElement("#signal-paste", HTMLTextAreaElement);
  private readonly usePastedSignal = getRequiredElement(
    "#use-pasted-signal",
    HTMLButtonElement,
  );
  private readonly scanner = new CameraQrScanner(this.scannerVideo);
  private readonly notify: (message: string) => void;

  constructor(notify: (message: string) => void) {
    this.notify = notify;
    this.scannerDialog.addEventListener("close", () => {
      this.scanner.stop();
      this.resetCameraControls();
    });
    this.scannerVideo.addEventListener("click", () => {
      void this.refocusCamera();
    });
    this.scannerRefocus.addEventListener("click", () => {
      void this.refocusCamera();
    });
    this.scannerZoom.addEventListener("input", () => {
      void this.scanner.setZoom(this.scannerZoom.valueAsNumber).catch(() => {
        this.scannerStatus.textContent = "Zoom could not be changed.";
      });
    });
    this.scannerTorch.addEventListener("click", () => {
      const enabled = this.scannerTorch.getAttribute("aria-pressed") !== "true";
      void this.scanner
        .setTorch(enabled)
        .then(() => {
          this.scannerTorch.setAttribute("aria-pressed", String(enabled));
          this.scannerTorch.textContent = enabled ? "Light off" : "Light";
        })
        .catch(() => {
          this.scannerStatus.textContent = "The light could not be changed.";
        });
    });
  }

  async showCode(options: ShowCodeOptions): Promise<"next" | "closed"> {
    const code = encodeSignal(options.signal);
    const isInvite = options.signal.kind === "offer";
    const sharedValue =
      options.signal.kind === "offer"
        ? createInviteLink(options.signal)
        : code;
    this.signalStep.textContent = options.step;
    this.signalTitle.textContent = options.title;
    this.signalContent.replaceChildren();

    const instruction = document.createElement("p");
    instruction.className = "signal-instruction";
    instruction.textContent = options.instruction;

    const actions = document.createElement("div");
    actions.className = "signal-actions";

    const shareButton = this.createButton(
      isInvite ? "Share invitation" : "Share answer",
      "button-primary",
    );
    shareButton.hidden = !navigator.share;
    const copyButton = this.createButton(
      isInvite ? "Copy invitation link" : "Copy answer code",
      "button-secondary",
    );
    actions.append(shareButton, copyButton);

    const details = document.createElement("details");
    details.className = "code-details";
    const summary = document.createElement("summary");
    summary.textContent = isInvite
      ? "Show invitation link"
      : "Show answer code";
    const codeField = document.createElement("textarea");
    codeField.readOnly = true;
    codeField.rows = 4;
    codeField.spellcheck = false;
    codeField.value = sharedValue;
    codeField.setAttribute(
      "aria-label",
      isInvite ? "Invitation link" : "Answer code",
    );
    details.append(summary, codeField);

    const qrDetails = document.createElement("details");
    qrDetails.className = "qr-details";
    const qrSummary = document.createElement("summary");
    qrSummary.textContent = "Show QR code for direct scanning";
    const qrPanel = document.createElement("div");
    qrPanel.className = "qr-panel";
    const canvas = document.createElement("canvas");
    qrPanel.append(canvas);
    qrDetails.append(qrSummary, qrPanel);

    const privacy = document.createElement("p");
    privacy.className = "privacy-note";
    privacy.textContent =
      "Share this connection data only with the intended participants. It contains local network data.";

    this.signalContent.append(instruction, actions, details, qrDetails);

    if (isInvite) {
      const offlineNote = document.createElement("p");
      offlineNote.className = "privacy-note";
      offlineNote.textContent =
        "Without internet, choose a local target such as Quick Share, AirDrop, or Bluetooth. The link opens offline only if the app is already installed or fully cached on the other device.";
      this.signalContent.append(offlineNote);
    }

    this.signalContent.append(privacy);

    let nextButton: HTMLButtonElement | null = null;
    if (options.nextLabel) {
      nextButton = this.createButton(options.nextLabel, "button-primary");
      nextButton.classList.add("full-width");
      this.signalContent.append(nextButton);
    }

    await renderQrCode(canvas, isInvite ? sharedValue : code);

    shareButton.addEventListener("click", () => {
      void this.shareSignal(options.signal, sharedValue).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        this.notify(this.errorMessage(error));
      });
    });

    copyButton.addEventListener("click", () => {
      void this.copyValue(
        sharedValue,
        codeField,
        isInvite ? "Invitation link copied." : "Answer code copied.",
      );
    });

    if (!this.signalDialog.open) {
      this.signalDialog.showModal();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: "next" | "closed") => {
        if (settled) {
          return;
        }
        settled = true;
        this.signalDialog.removeEventListener("close", onClose);
        resolve(result);
      };
      const onClose = () => finish("closed");

      this.signalDialog.addEventListener("close", onClose);
      nextButton?.addEventListener(
        "click",
        () => {
          finish("next");
          this.signalDialog.close();
        },
        { once: true },
      );
    });
  }

  scanSignal(expectedKind: "offer" | "answer"): Promise<ConnectionSignal> {
    this.scanner.stop();
    this.resetCameraControls();
    this.scannerTitle.textContent =
      expectedKind === "offer" ? "Open invitation" : "Enter answer";
    this.scannerStatus.textContent =
      "Scan the QR code or paste the connection data below.";
    this.signalPasteLabel.textContent =
      expectedKind === "offer"
        ? "Paste invitation link or connection code"
        : "Paste answer code";
    this.signalPaste.value = "";
    this.qrImageInput.value = "";

    if (!this.scannerDialog.open) {
      this.scannerDialog.showModal();
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        this.scanner.stop();
        this.scannerDialog.removeEventListener("close", onClose);
        this.usePastedSignal.removeEventListener("click", onPaste);
        this.qrImageInput.removeEventListener("change", onFile);
      };
      const finish = (signal: ConnectionSignal) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.scannerDialog.close();
        resolve(signal);
      };
      const fail = (error: unknown) => {
        this.scannerStatus.textContent = this.errorMessage(error);
      };
      const processCode = (raw: string) => {
        try {
          const signal = decodeSharedSignal(raw);
          if (signal.kind !== expectedKind) {
            throw new Error(
              expectedKind === "offer"
                ? "This code is an answer, not an invitation."
                : "This code is an invitation, not an answer.",
            );
          }
          finish(signal);
        } catch (error) {
          fail(error);
        }
      };
      const onClose = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new DOMException("Scan cancelled.", "AbortError"));
      };
      const onPaste = () => processCode(this.signalPaste.value);
      const onFile = () => {
        const file = this.qrImageInput.files?.[0];
        if (!file) {
          return;
        }
        this.scannerStatus.textContent = "Reading QR image…";
        void scanQrImage(file).then(processCode).catch(fail);
      };

      this.scannerDialog.addEventListener("close", onClose);
      this.usePastedSignal.addEventListener("click", onPaste);
      this.qrImageInput.addEventListener("change", onFile);

      void this.scanner
        .start(processCode)
        .then(() => {
          if (!settled) {
            const canRefocus = this.configureCameraControls();
            this.scannerStatus.textContent =
              `Camera active. Hold both devices 20–40 cm apart and keep the full QR code straight in the frame.${canRefocus ? " Tap the preview to refocus." : ""}`;
          }
        })
        .catch(() => {
          this.scannerStatus.textContent =
            "Camera unavailable. You can choose a QR image or paste the connection data.";
        });
    });
  }

  closeCodeDialog(): void {
    if (this.signalDialog.open) {
      this.signalDialog.close();
    }
  }

  closeAll(): void {
    this.closeCodeDialog();
    if (this.scannerDialog.open) {
      this.scannerDialog.close();
    }
    this.scanner.stop();
  }

  private createButton(label: string, variant: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${variant}`;
    button.textContent = label;
    return button;
  }

  private configureCameraControls(): boolean {
    const controls = this.scanner.getControlState();
    this.scannerRefocus.hidden = !controls.canRefocus;
    this.scannerTorch.hidden = !controls.canUseTorch;
    this.scannerTorch.setAttribute("aria-pressed", "false");
    this.scannerTorch.textContent = "Light";

    if (controls.zoom) {
      this.scannerZoom.min = String(controls.zoom.min);
      this.scannerZoom.max = String(controls.zoom.max);
      this.scannerZoom.step = String(controls.zoom.step);
      this.scannerZoom.value = String(controls.zoom.value);
      this.scannerZoomControl.hidden = false;
    } else {
      this.scannerZoomControl.hidden = true;
    }

    this.scannerControls.hidden =
      !controls.canRefocus && !controls.canUseTorch && !controls.zoom;
    return controls.canRefocus;
  }

  private resetCameraControls(): void {
    this.scannerControls.hidden = true;
    this.scannerRefocus.hidden = true;
    this.scannerZoomControl.hidden = true;
    this.scannerTorch.hidden = true;
    this.scannerTorch.setAttribute("aria-pressed", "false");
    this.scannerTorch.textContent = "Light";
  }

  private async refocusCamera(): Promise<void> {
    if (!this.scanner.getControlState().canRefocus) {
      return;
    }
    try {
      await this.scanner.refocus();
      this.scannerStatus.textContent =
        "Refocusing. Keep the QR code steady and fully inside the frame.";
    } catch {
      this.scannerStatus.textContent =
        "Autofocus could not be restarted. Try moving the devices farther apart and use zoom.";
    }
  }

  private async shareSignal(
    signal: ConnectionSignal,
    sharedValue: string,
  ): Promise<void> {
    if (!navigator.share) {
      throw new Error("Sharing is not supported by this browser.");
    }

    if (signal.kind === "offer") {
      await navigator.share({
        title: "Invitation to table-telephones",
        text: createInviteShareText(signal, sharedValue),
      });
      return;
    }

    await navigator.share({
      title: "Answer for table-telephones",
      text: `Answer code for table-telephones:\n${sharedValue}`,
    });
  }

  private async copyValue(
    value: string,
    fallbackField: HTMLTextAreaElement,
    successMessage: string,
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.notify(successMessage);
    } catch {
      fallbackField.closest("details")?.setAttribute("open", "");
      fallbackField.focus();
      fallbackField.select();
      this.notify("Copy the selected text manually.");
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "The action failed.";
  }
}
