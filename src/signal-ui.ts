import type { ConnectionSignal } from "./types";
import { decodeSignal, encodeSignal } from "./signaling";
import {
  CameraQrScanner,
  canvasToPngFile,
  renderQrCode,
  scanQrImage,
  shareQrCode,
} from "./qr";
import { getRequiredElement } from "./utils";

interface ShowCodeOptions {
  signal: ConnectionSignal;
  step: string;
  title: string;
  instruction: string;
  fileName: string;
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
  private readonly qrImageInput = getRequiredElement("#qr-image-input", HTMLInputElement);
  private readonly signalPaste = getRequiredElement("#signal-paste", HTMLTextAreaElement);
  private readonly usePastedSignal = getRequiredElement(
    "#use-pasted-signal",
    HTMLButtonElement,
  );
  private readonly scanner = new CameraQrScanner(this.scannerVideo);
  private readonly notify: (message: string) => void;

  constructor(notify: (message: string) => void) {
    this.notify = notify;
    this.scannerDialog.addEventListener("close", () => this.scanner.stop());
  }

  async showCode(options: ShowCodeOptions): Promise<"next" | "closed"> {
    const code = encodeSignal(options.signal);
    this.signalStep.textContent = options.step;
    this.signalTitle.textContent = options.title;
    this.signalContent.replaceChildren();

    const instruction = document.createElement("p");
    instruction.className = "signal-instruction";
    instruction.textContent = options.instruction;

    const qrPanel = document.createElement("div");
    qrPanel.className = "qr-panel";
    const canvas = document.createElement("canvas");
    qrPanel.append(canvas);

    const actions = document.createElement("div");
    actions.className = "signal-actions";

    const shareButton = this.createButton("QR-Code teilen", "button-primary");
    shareButton.hidden = !navigator.share;
    const copyButton = this.createButton("Code kopieren", "button-secondary");
    actions.append(shareButton, copyButton);

    const details = document.createElement("details");
    details.className = "code-details";
    const summary = document.createElement("summary");
    summary.textContent = "Verbindungscode anzeigen";
    const codeField = document.createElement("textarea");
    codeField.readOnly = true;
    codeField.rows = 4;
    codeField.spellcheck = false;
    codeField.value = code;
    codeField.setAttribute("aria-label", "Verbindungscode");
    details.append(summary, codeField);

    const privacy = document.createElement("p");
    privacy.className = "privacy-note";
    privacy.textContent =
      "Teile diesen QR-Code nur mit den gewünschten Teilnehmern. Er enthält lokale Verbindungsdaten.";

    this.signalContent.append(instruction, qrPanel, actions, details, privacy);

    let nextButton: HTMLButtonElement | null = null;
    if (options.nextLabel) {
      nextButton = this.createButton(options.nextLabel, "button-primary");
      nextButton.classList.add("full-width");
      this.signalContent.append(nextButton);
    }

    await renderQrCode(canvas, code);
    const qrFile = await canvasToPngFile(canvas, options.fileName);

    shareButton.addEventListener("click", () => {
      void shareQrCode(qrFile, code).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        this.notify(this.errorMessage(error));
      });
    });

    copyButton.addEventListener("click", () => {
      void this.copyCode(code, codeField);
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
    this.scannerTitle.textContent =
      expectedKind === "offer" ? "Einladung scannen" : "Antwort scannen";
    this.scannerStatus.textContent = "Halte den QR-Code vollständig in den Rahmen.";
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
          const signal = decodeSignal(raw);
          if (signal.kind !== expectedKind) {
            throw new Error(
              expectedKind === "offer"
                ? "Dieser Code ist eine Antwort, keine Einladung."
                : "Dieser Code ist eine Einladung, keine Antwort.",
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
        reject(new DOMException("Scan abgebrochen.", "AbortError"));
      };
      const onPaste = () => processCode(this.signalPaste.value);
      const onFile = () => {
        const file = this.qrImageInput.files?.[0];
        if (!file) {
          return;
        }
        this.scannerStatus.textContent = "QR-Bild wird gelesen …";
        void scanQrImage(file).then(processCode).catch(fail);
      };

      this.scannerDialog.addEventListener("close", onClose);
      this.usePastedSignal.addEventListener("click", onPaste);
      this.qrImageInput.addEventListener("change", onFile);

      void this.scanner.start(processCode).catch(() => {
        this.scannerStatus.textContent =
          "Kamera nicht verfügbar. Du kannst ein QR-Bild auswählen oder den Code einfügen.";
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

  private async copyCode(
    code: string,
    fallbackField: HTMLTextAreaElement,
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.notify("Verbindungscode kopiert.");
    } catch {
      fallbackField.closest("details")?.setAttribute("open", "");
      fallbackField.focus();
      fallbackField.select();
      this.notify("Bitte den markierten Code manuell kopieren.");
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Die Aktion ist fehlgeschlagen.";
  }
}
