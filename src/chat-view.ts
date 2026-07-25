import { prepareImage } from "./images";
import type {
  ChatImageMessage,
  ChatTextMessage,
  Participant,
  PreparedImage,
  Role,
} from "./types";
import { formatBytes, formatTime, getRequiredElement } from "./utils";

interface ChatCallbacks {
  onSendText: (text: string) => Promise<void>;
  onSendImage: (image: PreparedImage) => Promise<void>;
  onAddPerson: () => void;
  onError: (message: string) => void;
}

export class ChatView {
  private readonly view = getRequiredElement("#chat-view", HTMLElement);
  private readonly welcomeView = getRequiredElement("#welcome-view", HTMLElement);
  private readonly addPersonButton = getRequiredElement(
    "#add-person-button",
    HTMLButtonElement,
  );
  private readonly banner = getRequiredElement("#connection-banner", HTMLElement);
  private readonly messageList = getRequiredElement("#message-list", HTMLOListElement);
  private readonly emptyChat = getRequiredElement("#empty-chat", HTMLLIElement);
  private readonly composer = getRequiredElement("#composer", HTMLFormElement);
  private readonly messageInput = getRequiredElement(
    "#message-input",
    HTMLTextAreaElement,
  );
  private readonly imageInput = getRequiredElement("#image-input", HTMLInputElement);
  private readonly sendButton = getRequiredElement("#send-button", HTMLButtonElement);
  private readonly attachmentPreview = getRequiredElement(
    "#attachment-preview",
    HTMLElement,
  );
  private readonly attachmentImage = getRequiredElement(
    "#attachment-image",
    HTMLImageElement,
  );
  private readonly attachmentName = getRequiredElement("#attachment-name", HTMLElement);
  private readonly attachmentSize = getRequiredElement("#attachment-size", HTMLElement);
  private readonly removeAttachment = getRequiredElement(
    "#remove-attachment",
    HTMLButtonElement,
  );
  private readonly participantsButton = getRequiredElement(
    "#participants-button",
    HTMLButtonElement,
  );
  private readonly participantCount = getRequiredElement("#participant-count", HTMLElement);
  private readonly participantsList = getRequiredElement(
    "#participants-list",
    HTMLUListElement,
  );
  private readonly imageDialog = getRequiredElement("#image-dialog", HTMLDialogElement);
  private readonly largeImage = getRequiredElement("#large-image", HTMLImageElement);
  private readonly liveRegion = getRequiredElement("#live-region", HTMLElement);
  private readonly callbacks: ChatCallbacks;
  private readonly objectUrls = new Set<string>();
  private preparedImage: PreparedImage | null = null;
  private attachmentUrl: string | null = null;
  private ready = false;
  private sending = false;

  constructor(callbacks: ChatCallbacks) {
    this.callbacks = callbacks;

    this.addPersonButton.addEventListener("click", callbacks.onAddPerson);
    this.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.sendCurrent();
    });
    this.messageInput.addEventListener("input", () => {
      this.updateSendButton();
    });
    this.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!this.sendButton.disabled) {
          this.composer.requestSubmit();
        }
      }
    });
    this.imageInput.addEventListener("change", () => {
      const file = this.imageInput.files?.[0];
      if (file) {
        void this.setAttachment(file);
      }
    });
    this.removeAttachment.addEventListener("click", () => this.clearAttachment());
    this.imageDialog.addEventListener("close", () => {
      this.largeImage.removeAttribute("src");
      this.largeImage.alt = "";
    });
    window.addEventListener("pagehide", () => this.revokeObjectUrls());
  }

  show(role: Role): void {
    this.welcomeView.hidden = true;
    this.view.hidden = false;
    this.addPersonButton.hidden = role !== "host";
    this.addPersonButton.textContent = "Person hinzufügen";
    this.participantsButton.hidden = false;
    this.messageInput.focus();
  }

  setHeaderAction(label: string, visible: boolean): void {
    this.addPersonButton.textContent = label;
    this.addPersonButton.hidden = !visible;
  }

  setStatus(message: string, ready: boolean): void {
    this.banner.textContent = message;
    this.banner.dataset.state = ready ? "ready" : "waiting";
    this.ready = ready;
    this.messageInput.disabled = !ready;
    this.imageInput.disabled = !ready;
    this.updateSendButton();
    this.liveRegion.textContent = message;
  }

  updateParticipants(participants: Participant[]): void {
    this.participantCount.textContent = String(participants.length);
    this.participantsButton.setAttribute(
      "aria-label",
      `${participants.length} Teilnehmer anzeigen`,
    );
    this.participantsList.replaceChildren(
      ...participants.map((participant) => {
        const item = document.createElement("li");
        const avatar = document.createElement("span");
        avatar.className = "participant-avatar";
        avatar.textContent = participant.name.slice(0, 1).toLocaleUpperCase("de");
        avatar.setAttribute("aria-hidden", "true");

        const text = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = participant.name;
        const role = document.createElement("small");
        role.textContent = [
          participant.isSelf ? "Du" : "",
          participant.isHost ? "Raum-Ersteller" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        text.append(name, role);
        item.append(avatar, text);
        return item;
      }),
    );
  }

  addText(message: ChatTextMessage): void {
    const bubble = this.createMessageShell(message.sender.name, message.createdAt, message.isOwn);
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = message.text;
    bubble.body.append(text);
    this.appendMessage(bubble.item);
    this.liveRegion.textContent = message.isOwn
      ? "Nachricht gesendet."
      : `Neue Nachricht von ${message.sender.name}.`;
  }

  addImage(message: ChatImageMessage): void {
    const url = URL.createObjectURL(message.blob);
    this.objectUrls.add(url);

    const bubble = this.createMessageShell(message.sender.name, message.createdAt, message.isOwn);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-image-button";
    button.setAttribute("aria-label", `Bild von ${message.sender.name} vergrößern`);
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Geteiltes Bild von ${message.sender.name}`;
    image.width = message.width;
    image.height = message.height;
    button.append(image);
    button.addEventListener("click", () => {
      this.largeImage.src = url;
      this.largeImage.alt = image.alt;
      this.imageDialog.showModal();
    });
    bubble.body.append(button);
    this.appendMessage(bubble.item);
    this.liveRegion.textContent = message.isOwn
      ? "Bild gesendet."
      : `Neues Bild von ${message.sender.name}.`;
  }

  addSystem(message: string): void {
    const item = document.createElement("li");
    item.className = "system-message";
    item.textContent = message;
    this.appendMessage(item);
    this.liveRegion.textContent = message;
  }

  private createMessageShell(sender: string, timestamp: number, isOwn: boolean) {
    const item = document.createElement("li");
    item.className = `message ${isOwn ? "message-own" : "message-other"}`;

    const body = document.createElement("article");
    body.className = "message-bubble";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const name = document.createElement("strong");
    name.textContent = isOwn ? "Du" : sender;
    const time = document.createElement("time");
    time.dateTime = new Date(timestamp).toISOString();
    time.textContent = formatTime(timestamp);
    meta.append(name, time);
    body.append(meta);
    item.append(body);
    return { item, body };
  }

  private appendMessage(item: HTMLLIElement): void {
    const nearBottom =
      this.messageList.scrollHeight -
        this.messageList.scrollTop -
        this.messageList.clientHeight <
      120;
    this.emptyChat.remove();
    this.messageList.append(item);
    if (nearBottom) {
      item.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }

  private async setAttachment(file: File): Promise<void> {
    this.sending = true;
    this.updateSendButton();
    this.attachmentName.textContent = "Bild wird vorbereitet …";
    this.attachmentSize.textContent = "";
    this.attachmentPreview.hidden = false;

    try {
      const prepared = await prepareImage(file);
      this.clearAttachment();
      this.preparedImage = prepared;
      this.attachmentUrl = URL.createObjectURL(prepared.blob);
      this.attachmentImage.src = this.attachmentUrl;
      this.attachmentImage.alt = "Vorschau des ausgewählten Bildes";
      this.attachmentName.textContent = prepared.fileName || "Bild";
      this.attachmentSize.textContent = formatBytes(prepared.bytes.byteLength);
      this.attachmentPreview.hidden = false;
    } catch (error) {
      this.clearAttachment();
      this.callbacks.onError(
        error instanceof Error ? error.message : "Das Bild konnte nicht vorbereitet werden.",
      );
    } finally {
      this.sending = false;
      this.updateSendButton();
    }
  }

  private clearAttachment(): void {
    if (this.attachmentUrl) {
      URL.revokeObjectURL(this.attachmentUrl);
      this.attachmentUrl = null;
    }
    this.preparedImage = null;
    this.imageInput.value = "";
    this.attachmentImage.removeAttribute("src");
    this.attachmentPreview.hidden = true;
    this.updateSendButton();
  }

  private async sendCurrent(): Promise<void> {
    if (!this.ready || this.sending) {
      return;
    }

    const text = this.messageInput.value.trim();
    const image = this.preparedImage;
    if (!text && !image) {
      return;
    }

    this.sending = true;
    this.updateSendButton();

    try {
      if (text) {
        await this.callbacks.onSendText(text);
        this.messageInput.value = "";
      }
      if (image) {
        await this.callbacks.onSendImage(image);
        this.clearAttachment();
      }
    } catch (error) {
      this.callbacks.onError(
        error instanceof Error ? error.message : "Die Nachricht konnte nicht gesendet werden.",
      );
    } finally {
      this.sending = false;
      this.updateSendButton();
      this.messageInput.focus();
    }
  }

  private updateSendButton(): void {
    const hasContent = this.messageInput.value.trim().length > 0 || Boolean(this.preparedImage);
    this.sendButton.disabled = !this.ready || this.sending || !hasContent;
  }

  private revokeObjectUrls(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    if (this.attachmentUrl) {
      URL.revokeObjectURL(this.attachmentUrl);
      this.attachmentUrl = null;
    }
  }
}
