import crypto from "crypto";
import { WebSocket } from "ws";

export type WireEvent = Record<string, unknown>;

export function createMessageIdFactory(prefix = "msg") {
  let counter = 0;
  return (label: string = prefix) => {
    counter += 1;
    return `${label}-${Date.now()}-${counter}-${crypto.randomBytes(2).toString("hex")}`;
  };
}

export async function openClient(
  serverPort: number,
  openSockets: Set<WebSocket>,
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
  openSockets.add(ws);
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      ws.off("open", onOpen);
      reject(error);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
  return ws;
}

export function send(ws: WebSocket, payload: Record<string, unknown>) {
  ws.send(JSON.stringify(payload));
}

export function closeSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState >= WebSocket.CLOSING) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => resolve(), 400);
    ws.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.close();
  });
}

export function waitForEvent(
  ws: WebSocket,
  predicate: (event: WireEvent) => boolean,
  timeoutMs = 4_000,
): Promise<WireEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for websocket event"));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString()) as WireEvent;
        if (predicate(parsed)) {
          clearTimeout(timeout);
          ws.off("message", onMessage);
          resolve(parsed);
        }
      } catch {
        // ignore malformed frames in tests
      }
    };

    ws.on("message", onMessage);
  });
}
