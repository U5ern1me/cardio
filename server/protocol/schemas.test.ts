import { describe, expect, it } from "vitest";
import {
  parseClientMessage,
  parseServerEvent,
  type ClientMessage,
} from "./schemas.js";

describe("protocol schemas", () => {
  it("parses legacy client payloads without protocol metadata", () => {
    const parsed = parseClientMessage({
      type: "CREATE_SESSION",
      gameType: "LITERATURE",
    });
    expect(parsed.ok).toBe(true);
  });

  it("accepts request envelope metadata", () => {
    const parsed = parseClientMessage({
      protocolVersion: 1,
      requestId: "request-12345",
      type: "START_GAME",
      messageId: "message-12345",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const message = parsed.data as ClientMessage;
    expect(message.requestId).toBe("request-12345");
  });

  it("validates reject events with typed error codes", () => {
    const parsed = parseServerEvent({
      type: "REJECT",
      protocolVersion: 1,
      requestId: "request-67890",
      code: "STALE_STATE",
      message: "stale",
      retryable: false,
    });
    expect(parsed.ok).toBe(true);
  });
});
