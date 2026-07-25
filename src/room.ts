import {
  APP_PROTOCOL_VERSION,
  ICE_GATHERING_TIMEOUT_MS,
  INVITE_TTL_MS,
  MAX_TEXT_LENGTH,
  PEER_CONFIGURATION,
} from "./config";
import { ChannelTransport } from "./channel";
import type {
  AnswerSignal,
  ChatImageMessage,
  ChatTextMessage,
  ControlPacket,
  ImageStartPacket,
  OfferSignal,
  Participant,
  PreparedImage,
  PublicParticipant,
  ReceivedImage,
  Role,
  RoomEvents,
  RoomStatePacket,
  TextPacket,
} from "./types";
import { createId, normalizeName } from "./utils";

interface PeerLink {
  connectionId: string;
  createdAt: number;
  peerConnection: RTCPeerConnection;
  transport: ChannelTransport | null;
  participant: PublicParticipant | null;
  active: boolean;
}

function waitForIceGathering(peerConnection: RTCPeerConnection): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ICE_GATHERING_TIMEOUT_MS);

    const onStateChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
    };

    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function publicParticipant(
  id: string,
  name: string,
  isHost: boolean,
): PublicParticipant {
  return { id, name, isHost };
}

export class LocalRoom {
  readonly role: Role;
  readonly self: PublicParticipant;
  private roomId: string;
  private readonly events: RoomEvents;
  private readonly pendingLinks = new Map<string, PeerLink>();
  private readonly activeLinks = new Map<string, PeerLink>();
  private guestHostLink: PeerLink | null = null;
  private guestParticipants: PublicParticipant[] = [];
  private readonly seenMessageIds = new Set<string>();
  private closed = false;

  constructor(role: Role, displayName: string, events: RoomEvents) {
    const name = normalizeName(displayName);
    if (!name) {
      throw new Error("Bitte gib einen Namen ein.");
    }

    this.role = role;
    this.roomId = createId();
    this.self = publicParticipant(createId(), name, role === "host");
    this.events = events;

    if (role === "host") {
      this.publishParticipants();
      this.events.onStatus("Warte auf die erste Verbindung.", false);
    }
  }

  async createInvite(): Promise<OfferSignal> {
    this.assertRole("host");
    this.assertNotClosed();

    if (this.pendingLinks.size >= 10) {
      throw new Error("Zu viele offene Einladungen. Lade die App neu, um sie zu verwerfen.");
    }

    const connectionId = createId();
    const link = this.createLink(connectionId);
    const channel = link.peerConnection.createDataChannel("table-telephones", {
      ordered: true,
    });
    this.attachTransport(link, channel);
    this.pendingLinks.set(connectionId, link);

    try {
      const offer = await link.peerConnection.createOffer();
      await link.peerConnection.setLocalDescription(offer);
      await waitForIceGathering(link.peerConnection);

      const description = link.peerConnection.localDescription;
      if (!description?.sdp || description.type !== "offer") {
        throw new Error("Die lokale Verbindungsbeschreibung fehlt.");
      }
      this.assertLocalCandidate(description.sdp);

      return {
        v: APP_PROTOCOL_VERSION,
        kind: "offer",
        roomId: this.roomId,
        connectionId,
        host: this.self,
        description: { type: "offer", sdp: description.sdp },
      };
    } catch (error) {
      this.pendingLinks.delete(connectionId);
      link.transport?.close();
      link.peerConnection.close();
      throw error;
    }
  }

  async acceptAnswer(answer: AnswerSignal): Promise<void> {
    this.assertRole("host");
    this.assertNotClosed();

    if (answer.roomId !== this.roomId) {
      throw new Error("Diese Antwort gehört zu einem anderen Chat.");
    }
    if (this.activeLinks.has(answer.guest.id)) {
      throw new Error("Dieser Teilnehmer ist bereits verbunden.");
    }

    const link = this.pendingLinks.get(answer.connectionId);
    if (!link) {
      throw new Error("Die zugehörige Einladung ist nicht mehr offen.");
    }
    if (Date.now() - link.createdAt > INVITE_TTL_MS) {
      this.pendingLinks.delete(link.connectionId);
      link.transport?.close();
      link.peerConnection.close();
      throw new Error("Die Einladung ist abgelaufen. Erstelle eine neue.");
    }

    link.participant = answer.guest;

    try {
      await link.peerConnection.setRemoteDescription(answer.description);
    } catch {
      link.participant = null;
      throw new Error("Die Antwort konnte nicht übernommen werden.");
    }
  }

  async acceptInvite(offer: OfferSignal): Promise<AnswerSignal> {
    this.assertRole("guest");
    this.assertNotClosed();

    if (this.guestHostLink) {
      throw new Error("Es wurde bereits eine Einladung übernommen.");
    }

    this.roomId = offer.roomId;
    const link = this.createLink(offer.connectionId);
    link.participant = offer.host;
    this.guestHostLink = link;
    this.guestParticipants = [this.self, offer.host];
    this.publishParticipants();

    link.peerConnection.addEventListener("datachannel", (event) => {
      if (link.transport) {
        event.channel.close();
        return;
      }
      this.attachTransport(link, event.channel);
    });

    try {
      await link.peerConnection.setRemoteDescription(offer.description);
      const answer = await link.peerConnection.createAnswer();
      await link.peerConnection.setLocalDescription(answer);
      await waitForIceGathering(link.peerConnection);

      const description = link.peerConnection.localDescription;
      if (!description?.sdp || description.type !== "answer") {
        throw new Error("Die lokale Antwortbeschreibung fehlt.");
      }
      this.assertLocalCandidate(description.sdp);

      this.events.onStatus("Zeige die Antwort dem Raum-Ersteller.", false);
      return {
        v: APP_PROTOCOL_VERSION,
        kind: "answer",
        roomId: this.roomId,
        connectionId: offer.connectionId,
        guest: this.self,
        description: { type: "answer", sdp: description.sdp },
      };
    } catch (error) {
      this.guestHostLink = null;
      link.transport?.close();
      link.peerConnection.close();
      throw error;
    }
  }

  async sendText(rawText: string): Promise<void> {
    this.assertNotClosed();
    const text = rawText.trim();
    if (!text || text.length > MAX_TEXT_LENGTH) {
      throw new Error("Die Nachricht ist leer oder zu lang.");
    }

    const message: ChatTextMessage = {
      id: createId(),
      kind: "text",
      sender: { id: this.self.id, name: this.self.name },
      text,
      createdAt: Date.now(),
      isOwn: true,
    };

    const packet: TextPacket = {
      v: APP_PROTOCOL_VERSION,
      type: "text",
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
    };

    if (this.role === "host") {
      packet.sender = message.sender;
      await this.broadcastControl(packet);
    } else {
      await this.requireGuestTransport().sendControl(packet);
    }

    this.rememberMessage(message.id);
    this.events.onText(message);
  }

  async sendImage(image: PreparedImage): Promise<void> {
    this.assertNotClosed();

    const message: ChatImageMessage = {
      id: createId(),
      kind: "image",
      sender: { id: this.self.id, name: this.self.name },
      blob: image.blob,
      width: image.width,
      height: image.height,
      createdAt: Date.now(),
      isOwn: true,
    };

    const meta: ImageStartPacket = {
      v: APP_PROTOCOL_VERSION,
      type: "image-start",
      id: message.id,
      mime: image.blob.type as ImageStartPacket["mime"],
      byteLength: image.bytes.byteLength,
      width: image.width,
      height: image.height,
      createdAt: message.createdAt,
    };

    if (this.role === "host") {
      meta.sender = message.sender;
      await this.broadcastImage(meta, image.bytes);
    } else {
      await this.requireGuestTransport().sendImage(meta, image.bytes);
    }

    this.rememberMessage(message.id);
    this.events.onImage(message);
  }

  close(): void {
    this.closed = true;
    for (const link of [...this.pendingLinks.values(), ...this.activeLinks.values()]) {
      link.transport?.close();
      link.peerConnection.close();
    }
    this.guestHostLink?.transport?.close();
    this.guestHostLink?.peerConnection.close();
    this.pendingLinks.clear();
    this.activeLinks.clear();
  }

  private createLink(connectionId: string): PeerLink {
    const peerConnection = new RTCPeerConnection(PEER_CONFIGURATION);
    const link: PeerLink = {
      connectionId,
      createdAt: Date.now(),
      peerConnection,
      transport: null,
      participant: null,
      active: false,
    };

    peerConnection.addEventListener("connectionstatechange", () => {
      if (["failed", "closed"].includes(peerConnection.connectionState)) {
        this.deactivateLink(link);
      }
    });
    return link;
  }

  private attachTransport(link: PeerLink, channel: RTCDataChannel): void {
    link.transport = new ChannelTransport(channel, {
      onOpen: () => this.activateLink(link),
      onClose: () => this.deactivateLink(link),
      onProtocolError: (message) => {
        this.events.onError(`Verbindung beendet: ${message}`);
      },
      onControl: (packet) => this.handleControl(link, packet),
      onImage: (image) => {
        void this.handleImage(link, image).catch(() => {
          link.transport?.close();
          this.events.onError("Ein ungültiges Bild wurde abgewiesen.");
        });
      },
    });
  }

  private activateLink(link: PeerLink): void {
    if (link.active || !link.participant) {
      return;
    }

    link.active = true;

    if (this.role === "host") {
      this.pendingLinks.delete(link.connectionId);
      this.activeLinks.set(link.participant.id, link);
      this.events.onSystem(`${link.participant.name} ist dem Chat beigetreten.`);
      this.publishParticipants();
      this.broadcastRoomState();
      this.events.onStatus(
        `${this.activeLinks.size} ${this.activeLinks.size === 1 ? "Person ist" : "Personen sind"} verbunden.`,
        true,
      );
    } else {
      this.events.onStatus("Verbunden – ihr könnt jetzt schreiben.", true);
      this.publishParticipants();
    }
  }

  private deactivateLink(link: PeerLink): void {
    if (!link.active) {
      return;
    }
    link.active = false;

    if (this.role === "host" && link.participant) {
      this.activeLinks.delete(link.participant.id);
      this.events.onSystem(`${link.participant.name} hat den Chat verlassen.`);
      this.publishParticipants();
      this.broadcastRoomState();
      const count = this.activeLinks.size;
      this.events.onStatus(
        count === 0
          ? "Warte auf eine weitere Verbindung."
          : `${count} ${count === 1 ? "Person ist" : "Personen sind"} verbunden.`,
        count > 0,
      );
    } else {
      this.events.onStatus("Verbindung zum Raum-Ersteller verloren.", false);
    }
  }

  private handleControl(
    link: PeerLink,
    packet: Exclude<ControlPacket, ImageStartPacket | { type: "image-end" }>,
  ): void {
    if (packet.type === "room-state") {
      if (this.role !== "guest") {
        link.transport?.close();
        return;
      }
      this.applyGuestRoomState(packet);
      return;
    }

    if (packet.type !== "text" || !link.participant) {
      link.transport?.close();
      return;
    }

    if (this.role === "host") {
      if (packet.sender) {
        link.transport?.close();
        return;
      }

      const message: ChatTextMessage = {
        id: createId(),
        kind: "text",
        sender: { id: link.participant.id, name: link.participant.name },
        text: packet.text,
        createdAt: Date.now(),
        isOwn: false,
      };
      this.rememberMessage(message.id);
      this.events.onText(message);

      const relay: TextPacket = {
        v: APP_PROTOCOL_VERSION,
        type: "text",
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        sender: message.sender,
      };
      void this.broadcastControl(relay, link);
      return;
    }

    if (!packet.sender) {
      link.transport?.close();
      return;
    }
    if (this.hasSeenMessage(packet.id)) {
      return;
    }
    this.rememberMessage(packet.id);
    this.events.onText({
      id: packet.id,
      kind: "text",
      sender: packet.sender,
      text: packet.text,
      createdAt: packet.createdAt,
      isOwn: packet.sender.id === this.self.id,
    });
  }

  private async handleImage(link: PeerLink, image: ReceivedImage): Promise<void> {
    if (!link.participant) {
      throw new Error("Bild ohne Teilnehmer.");
    }

    if (this.role === "host") {
      if (image.meta.sender) {
        throw new Error("Gäste dürfen keinen Absender vorgeben.");
      }

      const message: ChatImageMessage = {
        id: createId(),
        kind: "image",
        sender: { id: link.participant.id, name: link.participant.name },
        blob: image.blob,
        width: image.meta.width,
        height: image.meta.height,
        createdAt: Date.now(),
        isOwn: false,
      };
      this.rememberMessage(message.id);
      this.events.onImage(message);

      const relay: ImageStartPacket = {
        v: APP_PROTOCOL_VERSION,
        type: "image-start",
        id: message.id,
        mime: image.blob.type as ImageStartPacket["mime"],
        byteLength: image.bytes.byteLength,
        width: message.width,
        height: message.height,
        createdAt: message.createdAt,
        sender: message.sender,
      };
      await this.broadcastImage(relay, image.bytes, link);
      return;
    }

    if (!image.meta.sender) {
      throw new Error("Bild ohne Absender.");
    }
    if (this.hasSeenMessage(image.meta.id)) {
      return;
    }
    this.rememberMessage(image.meta.id);
    this.events.onImage({
      id: image.meta.id,
      kind: "image",
      sender: image.meta.sender,
      blob: image.blob,
      width: image.meta.width,
      height: image.meta.height,
      createdAt: image.meta.createdAt,
      isOwn: image.meta.sender.id === this.self.id,
    });
  }

  private applyGuestRoomState(packet: RoomStatePacket): void {
    const previous = new Map(this.guestParticipants.map((participant) => [participant.id, participant]));
    const next = new Map(packet.participants.map((participant) => [participant.id, participant]));

    const ownEntry = next.get(this.self.id);
    const expectedHostId = this.guestHostLink?.participant?.id;
    const hostEntry = expectedHostId ? next.get(expectedHostId) : undefined;
    if (
      !ownEntry ||
      ownEntry.isHost ||
      !hostEntry?.isHost ||
      packet.participants.filter((participant) => participant.isHost).length !== 1
    ) {
      this.guestHostLink?.transport?.close();
      return;
    }

    for (const participant of packet.participants) {
      if (participant.id !== this.self.id && !previous.has(participant.id)) {
        this.events.onSystem(`${participant.name} ist dem Chat beigetreten.`);
      }
    }
    for (const participant of this.guestParticipants) {
      if (participant.id !== this.self.id && !next.has(participant.id)) {
        this.events.onSystem(`${participant.name} hat den Chat verlassen.`);
      }
    }

    this.guestParticipants = packet.participants;
    this.publishParticipants();
  }

  private publishParticipants(): void {
    const participants =
      this.role === "host"
        ? [this.self, ...[...this.activeLinks.values()].flatMap((link) =>
            link.participant ? [link.participant] : [],
          )]
        : this.guestParticipants;

    this.events.onParticipants(
      participants.map((participant): Participant => ({
        ...participant,
        isSelf: participant.id === this.self.id,
      })),
    );
  }

  private broadcastRoomState(): void {
    const packet: RoomStatePacket = {
      v: APP_PROTOCOL_VERSION,
      type: "room-state",
      participants: [
        this.self,
        ...[...this.activeLinks.values()].flatMap((link) =>
          link.participant ? [link.participant] : [],
        ),
      ],
    };
    void this.broadcastControl(packet);
  }

  private async broadcastControl(
    packet: TextPacket | RoomStatePacket,
    excludedLink?: PeerLink,
  ): Promise<void> {
    const tasks = [...this.activeLinks.values()]
      .filter((link) => link !== excludedLink && link.transport?.isOpen())
      .map((link) => link.transport!.sendControl(packet));

    const results = await Promise.allSettled(tasks);
    if (tasks.length > 0 && results.every((result) => result.status === "rejected")) {
      throw new Error("Die Nachricht konnte nicht übertragen werden.");
    }
  }

  private async broadcastImage(
    meta: ImageStartPacket,
    bytes: Uint8Array<ArrayBuffer>,
    excludedLink?: PeerLink,
  ): Promise<void> {
    const tasks = [...this.activeLinks.values()]
      .filter((link) => link !== excludedLink && link.transport?.isOpen())
      .map((link) => link.transport!.sendImage(meta, bytes));

    const results = await Promise.allSettled(tasks);
    if (tasks.length > 0 && results.every((result) => result.status === "rejected")) {
      throw new Error("Das Bild konnte nicht übertragen werden.");
    }
  }

  private requireGuestTransport(): ChannelTransport {
    const transport = this.guestHostLink?.transport;
    if (!transport?.isOpen()) {
      throw new Error("Noch keine Verbindung zum Raum-Ersteller.");
    }
    return transport;
  }

  private rememberMessage(id: string): void {
    this.seenMessageIds.add(id);
    if (this.seenMessageIds.size > 2_000) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest) {
        this.seenMessageIds.delete(oldest);
      }
    }
  }

  private hasSeenMessage(id: string): boolean {
    return this.seenMessageIds.has(id);
  }

  private assertRole(expected: Role): void {
    if (this.role !== expected) {
      throw new Error("Diese Aktion ist in der aktuellen Rolle nicht erlaubt.");
    }
  }

  private assertNotClosed(): void {
    if (this.closed) {
      throw new Error("Der Chat wurde bereits geschlossen.");
    }
  }

  private assertLocalCandidate(sdp: string): void {
    if (!/^a=candidate:/mu.test(sdp)) {
      throw new Error(
        "Der Browser hat keine lokale Netzwerkverbindung freigegeben. Prüfe Browser- und WLAN-Berechtigungen.",
      );
    }
  }
}
