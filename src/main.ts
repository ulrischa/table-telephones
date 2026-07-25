import "./styles.css";
import { ChatView } from "./chat-view";
import {
  clearInviteFromAddress,
  hasInviteLink,
  readInviteLink,
} from "./invite-link";
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
let pendingInvite: OfferSignal | null = null;

const toastRegion = getRequiredElement("#toast-region", HTMLElement);
const startForm = getRequiredElement("#start-form", HTMLFormElement);
const displayName = getRequiredElement("#display-name", HTMLInputElement);
const inviteNotice = getRequiredElement("#invite-notice", HTMLElement);
const inviteHostName = getRequiredElement("#invite-host-name", HTMLElement);
const hostButton = getRequiredElement("#host-button", HTMLButtonElement);
const joinButton = getRequiredElement("#join-button", HTMLButtonElement);
const discardInviteButton = getRequiredElement(
  "#discard-invite-button",
  HTMLButtonElement,
);
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
    throw new Error("The chat has not been started.");
  }
  return room;
}

async function addPerson(): Promise<void> {
  const currentRoom = requireRoom();

  try {
    const offer = await currentRoom.createInvite();

    const result = await signalUi.showCode({
      signal: offer,
      step: "Step 1 of 2",
      title: "Share invitation",
      instruction:
        "Share the invitation link. Without internet, choose a local transfer method such as Quick Share, AirDrop, or Bluetooth. The other person opens it, enters a name, and sends an answer back.",
      nextLabel: "Enter answer",
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
    notify(error instanceof Error ? error.message : "The invitation failed.");
  }
}

async function joinRoom(invite: OfferSignal | null = null): Promise<void> {
  try {
    const signal = invite ?? (await signalUi.scanSignal("offer"));
    const guestRoom = new LocalRoom("guest", displayName.value, createRoomEvents());
    let answer: AnswerSignal;
    try {
      answer = await guestRoom.acceptInvite(signal as OfferSignal);
    } catch (error) {
      guestRoom.close();
      throw error;
    }

    room = guestRoom;
    pendingInvite = null;
    chatView.show("guest");
    pendingAnswer = answer;
    chatView.setHeaderAction("Show answer", true);
    await showGuestAnswer(answer);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    notify(error instanceof Error ? error.message : "Joining failed.");
  }
}

async function showGuestAnswer(answer: AnswerSignal): Promise<void> {
  try {
    await signalUi.showCode({
      signal: answer,
      step: "Step 2 of 2",
      title: "Send answer back",
      instruction:
        "Share or copy the answer code back to the room host. The host enters it in the open app.",
    });
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : "The answer code could not be displayed.",
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

function showPendingInvite(invite: OfferSignal): void {
  pendingInvite = invite;
  inviteHostName.textContent = `Invitation from ${invite.host.name}`;
  inviteNotice.hidden = false;
  hostButton.hidden = true;
  joinButton.textContent = "Accept invitation";
  joinButton.classList.remove("button-secondary");
  joinButton.classList.add("button-primary");
  discardInviteButton.hidden = false;
  displayName.focus();
}

function discardPendingInvite(): void {
  pendingInvite = null;
  inviteNotice.hidden = true;
  hostButton.hidden = false;
  joinButton.textContent = "Join a chat";
  joinButton.classList.remove("button-primary");
  joinButton.classList.add("button-secondary");
  discardInviteButton.hidden = true;
}

function loadInviteFromAddress(): void {
  if (!hasInviteLink(window.location.href)) {
    return;
  }

  try {
    const invite = readInviteLink(window.location.href);
    if (invite) {
      showPendingInvite(invite);
    }
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : "The invitation link could not be read.",
    );
  } finally {
    clearInviteFromAddress();
  }
}

startForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = normalizeName(displayName.value);
  if (!name) {
    displayName.setCustomValidity("Enter your name.");
    displayName.reportValidity();
    return;
  }
  displayName.setCustomValidity("");
  displayName.value = name;

  if (!supportsRequiredApis()) {
    notify("This browser does not support the required WebRTC features.");
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
    submitter.id === "host-button"
      ? startHost()
      : submitter.id === "join-button"
        ? joinRoom(pendingInvite)
        : null;

  void action?.finally(() => {
    if (!room) {
      startForm.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  });
});

displayName.addEventListener("input", () => displayName.setCustomValidity(""));
discardInviteButton.addEventListener("click", () => {
  discardPendingInvite();
  displayName.focus();
});

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
  notify("table-telephones was installed.");
});

window.addEventListener("pagehide", () => {
  signalUi.closeAll();
  room?.close();
});

window.addEventListener("hashchange", loadInviteFromAddress);
loadInviteFromAddress();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
      notify("Offline mode could not be set up.");
    });
  });
}
