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
    this.scannerDialog.addEventListener("close", () => this.scanner.stop());
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
      isInvite ? "Einladung teilen" : "Antwort teilen",
      "button-primary",
    );
    shareButton.hidden = !navigator.share;
    const copyButton = this.createButton(
      isInvite ? "Einladungslink kopieren" : "Antwortcode kopieren",
      "button-secondary",
    );
    actions.append(shareButton, copyButton);

    const details = document.createElement("details");
    details.className = "code-details";
    const summary = document.createElement("summary");
    summary.textContent = isInvite
      ? "Einladungslink anzeigen"
      : "Antwortcode anzeigen";
    const codeField = document.createElement("textarea");
    codeField.readOnly = true;
    codeField.rows = 4;
    codeField.spellcheck = false;
    codeField.value = sharedValue;
    codeField.setAttribute(
      "aria-label",
      isInvite ? "Einladungslink" : "Antwortcode",
    );
    details.append(summary, codeField);

    const qrDetails = document.createElement("details");
    qrDetails.className = "qr-details";
    const qrSummary = document.createElement("summary");
    qrSummary.textContent = "QR-Code zum direkten Scannen anzeigen";
    const qrPanel = document.createElement("div");
    qrPanel.className = "qr-panel";
    const canvas = document.createElement("canvas");
    qrPanel.append(canvas);
    qrDetails.append(qrSummary, qrPanel);

    const privacy = document.createElement("p");
    privacy.className = "privacy-note";
    privacy.textContent =
      "Teile diese Verbindungsdaten nur mit den gewünschten Teilnehmern. Sie enthalten lokale Netzwerkdaten.";

    this.signalContent.append(instruction, actions, details, qrDetails);

    if (isInvite) {
      const offlineNote = document.createElement("p");
      offlineNote.className = "privacy-note";
      offlineNote.textContent =
        "Ohne Internet im Teilen-Menü Quick Share, AirDrop oder Bluetooth wählen. Der Link öffnet offline nur, wenn die App auf dem anderen Gerät bereits installiert oder zuvor vollständig geladen wurde.";
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
        isInvite ? "Einladungslink kopiert." : "Antwortcode kopiert.",
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
    this.scannerTitle.textContent =
      expectedKind === "offer" ? "Einladung öffnen" : "Antwort eingeben";
    this.scannerStatus.textContent =
      "Scanne den QR-Code oder füge die Verbindungsdaten unten ein.";
    this.signalPasteLabel.textContent =
      expectedKind === "offer"
        ? "Einladungslink oder Verbindungscode einfügen"
        : "Antwortcode einfügen";
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

      void this.scanner
        .start(processCode)
        .then(() => {
          if (!settled) {
            this.scannerStatus.textContent =
              "Kamera aktiv. Halte den QR-Code vollständig und möglichst gerade in den Rahmen.";
          }
        })
        .catch(() => {
          this.scannerStatus.textContent =
            "Kamera nicht verfügbar. Du kannst ein QR-Bild auswählen oder die Verbindungsdaten einfügen.";
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

  private async shareSignal(
    signal: ConnectionSignal,
    sharedValue: string,
  ): Promise<void> {
    if (!navigator.share) {
      throw new Error("Teilen wird von diesem Browser nicht unterstützt.");
    }

    if (signal.kind === "offer") {
      await navigator.share({
        title: "Einladung zu table-telephones",
        text: createInviteShareText(signal, sharedValue),
      });
      return;
    }

    await navigator.share({
      title: "Antwort für table-telephones",
      text: `Antwortcode für table-telephones:\n${sharedValue}`,
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
      this.notify("Bitte den markierten Text manuell kopieren.");
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Die Aktion ist fehlgeschlagen.";
  }
}
