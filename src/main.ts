import "./styles.css";
import { ChatView } from "./chat-view";
import { LocalRoom } from "./room";
import { SignalUi } from "./signal-ui";
import type { AnswerSignal, OfferSignal, RoomEvents } from "./types";
import { getRequiredElement, normalizeName } from "./utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let room: LocalRoom | null = null;
let installPrompt: BeforeInstallPromptEvent | null = null;
let pendingAnswer: AnswerSignal | null = null;

const toastRegion = getRequiredElement("#toast-region", HTMLElement);
const startForm = getRequiredElement("#start-form", HTMLFormElement);
const displayName = getRequiredElement("#display-name", HTMLInputElement);
const installButton = getRequiredElement("#install-button", HTMLButtonElement);

function notify(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.replaceChildren(toast);
  window.setTimeout(() => {
    if (toast.isConnected) {
      toast.remove();
    }
  }, 4_500);
}

const signalUi = new SignalUi(notify);
const chatView = new ChatView({
  onSendText: (text) => requireRoom().sendText(text),
  onSendImage: (image) => requireRoom().sendImage(image),
  onAddPerson: () => {
    if (room?.role === "host") {
      void addPerson();
    } else if (pendingAnswer) {
      void showGuestAnswer(pendingAnswer);
    }
  },
  onError: notify,
});

function createRoomEvents(): RoomEvents {
  return {
    onParticipants: (participants) => chatView.updateParticipants(participants),
    onText: (message) => chatView.addText(message),
    onImage: (message) => chatView.addImage(message),
    onSystem: (message) => chatView.addSystem(message),
    onStatus: (message, ready) => {
      chatView.setStatus(message, ready);
      if (ready) {
        pendingAnswer = null;
        chatView.setHeaderAction("", false);
        signalUi.closeCodeDialog();
      }
    },
    onError: notify,
  };
}

function requireRoom(): LocalRoom {
  if (!room) {
    throw new Error("Der Chat wurde noch nicht gestartet.");
  }
  return room;
}

async function addPerson(): Promise<void> {
  const currentRoom = requireRoom();

  try {
    const offer = await currentRoom.createInvite();

    const result = await signalUi.showCode({
      signal: offer,
      step: "Schritt 1 von 2",
      title: "Einladung zeigen",
      instruction:
        "Die andere Person scannt diesen Code und erzeugt anschließend eine Antwort.",
      fileName: "table-telephones-einladung.png",
      nextLabel: "Antwort scannen",
    });

    if (result !== "next") {
      return;
    }

    const answer = await signalUi.scanSignal("answer");
    await currentRoom.acceptAnswer(answer as AnswerSignal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    notify(error instanceof Error ? error.message : "Die Einladung ist fehlgeschlagen.");
  }
}

async function joinRoom(): Promise<void> {
  try {
    const signal = await signalUi.scanSignal("offer");
    const guestRoom = new LocalRoom("guest", displayName.value, createRoomEvents());
    let answer: AnswerSignal;
    try {
      answer = await guestRoom.acceptInvite(signal as OfferSignal);
    } catch (error) {
      guestRoom.close();
      throw error;
    }

    room = guestRoom;
    chatView.show("guest");
    pendingAnswer = answer;
    chatView.setHeaderAction("Antwort zeigen", true);
    await showGuestAnswer(answer);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    notify(error instanceof Error ? error.message : "Der Beitritt ist fehlgeschlagen.");
  }
}

async function showGuestAnswer(answer: AnswerSignal): Promise<void> {
  try {
    await signalUi.showCode({
      signal: answer,
      step: "Schritt 2 von 2",
      title: "Antwort zurückgeben",
      instruction:
        "Der Raum-Ersteller scannt diesen Antwortcode. Danach öffnet sich der Chat automatisch.",
      fileName: "table-telephones-antwort.png",
    });
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : "Der Antwortcode konnte nicht angezeigt werden.",
    );
  }
}

async function startHost(): Promise<void> {
  room = new LocalRoom("host", displayName.value, createRoomEvents());
  chatView.show("host");
  await addPerson();
}

function supportsRequiredApis(): boolean {
  return (
    "RTCPeerConnection" in window &&
    "crypto" in window &&
    typeof crypto.randomUUID === "function" &&
    "TextEncoder" in window
  );
}

startForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = normalizeName(displayName.value);
  if (!name) {
    displayName.setCustomValidity("Bitte gib einen Namen ein.");
    displayName.reportValidity();
    return;
  }
  displayName.setCustomValidity("");
  displayName.value = name;

  if (!supportsRequiredApis()) {
    notify("Dieser Browser unterstützt die benötigten WebRTC-Funktionen nicht.");
    return;
  }

  const submitter = (event as SubmitEvent).submitter;
  if (!(submitter instanceof HTMLButtonElement)) {
    return;
  }

  startForm.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });

  const action =
    submitter.id === "host-button" ? startHost() : submitter.id === "join-button" ? joinRoom() : null;

  void action?.finally(() => {
    if (!room) {
      startForm.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  });
});

displayName.addEventListener("input", () => displayName.setCustomValidity(""));

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as BeforeInstallPromptEvent;
  installButton.hidden = false;
});

installButton.addEventListener("click", () => {
  if (!installPrompt) {
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  void prompt.prompt();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.hidden = true;
  notify("table-telephones wurde installiert.");
});

window.addEventListener("pagehide", () => {
  signalUi.closeAll();
  room?.close();
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
      notify("Der Offline-Modus konnte nicht eingerichtet werden.");
    });
  });
}
