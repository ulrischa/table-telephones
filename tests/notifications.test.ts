import { describe, expect, it } from "vitest";
import {
  createNotificationContent,
  shouldShowIncomingNotification,
} from "../src/notifications";

describe("local notifications", () => {
  it("only notifies for incoming messages while the page is hidden", () => {
    expect(shouldShowIncomingNotification(false, "hidden", "granted")).toBe(true);
    expect(shouldShowIncomingNotification(true, "hidden", "granted")).toBe(false);
    expect(shouldShowIncomingNotification(false, "visible", "granted")).toBe(false);
    expect(shouldShowIncomingNotification(false, "hidden", "default")).toBe(false);
    expect(shouldShowIncomingNotification(false, "hidden", "denied")).toBe(false);
  });

  it("keeps chat content out of system notifications", () => {
    expect(createNotificationContent("Alice", "text")).toEqual({
      title: "New message from Alice",
      body: "Open table-telephones to read it.",
    });
    expect(createNotificationContent("Alice", "image")).toEqual({
      title: "New message from Alice",
      body: "Sent an image.",
    });
  });
});
