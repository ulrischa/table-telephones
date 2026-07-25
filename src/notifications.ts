export type IncomingNotificationKind = "text" | "image";

interface NotificationContent {
  title: string;
  body: string;
}

export function supportsLocalNotifications(): boolean {
  return "Notification" in window && "serviceWorker" in navigator;
}

export function shouldShowIncomingNotification(
  isOwn: boolean,
  visibilityState: DocumentVisibilityState,
  permission: NotificationPermission,
): boolean {
  return !isOwn && visibilityState === "hidden" && permission === "granted";
}

export function createNotificationContent(
  senderName: string,
  kind: IncomingNotificationKind,
): NotificationContent {
  return {
    title: `New message from ${senderName}`,
    body: kind === "image" ? "Sent an image." : "Open table-telephones to read it.",
  };
}

export async function showIncomingNotification(
  senderName: string,
  kind: IncomingNotificationKind,
): Promise<void> {
  if (
    !supportsLocalNotifications() ||
    !shouldShowIncomingNotification(
      false,
      document.visibilityState,
      Notification.permission,
    )
  ) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  if (
    !shouldShowIncomingNotification(
      false,
      document.visibilityState,
      Notification.permission,
    )
  ) {
    return;
  }

  const content = createNotificationContent(senderName, kind);
  const options: NotificationOptions & { renotify: boolean } = {
    body: content.body,
    icon: new URL("./icons/icon-192.png", document.baseURI).href,
    badge: new URL("./icons/icon-192.png", document.baseURI).href,
    tag: "table-telephones-incoming-message",
    renotify: true,
    data: { url: "./" },
  };
  await registration.showNotification(content.title, options);
}
