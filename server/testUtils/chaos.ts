import { WebSocket } from "ws";
import {
  closeSocket,
  openClient,
  send,
  waitForEvent,
  type WireEvent,
} from "./wsHarness.js";

export async function runReconnectStorm(args: {
  iterations: number;
  serverPort: number;
  openSockets: Set<WebSocket>;
  sessionId: string;
  reconnectToken: string;
  nextMessageId: (prefix: string) => string;
}): Promise<string> {
  let token = args.reconnectToken;
  let activeSocket = await openClient(args.serverPort, args.openSockets);

  send(activeSocket, {
    type: "JOIN_SESSION",
    sessionId: args.sessionId,
    reconnectToken: token,
    messageId: args.nextMessageId("storm-bootstrap"),
  });
  const bootstrap = await waitForEvent(
    activeSocket,
    (msg) =>
      msg.type === "SESSION_JOINED" &&
      msg.resumed === true &&
      typeof msg.reconnectToken === "string",
  );
  token = String(bootstrap.reconnectToken);

  for (let i = 0; i < args.iterations; i += 1) {
    await closeSocket(activeSocket);
    args.openSockets.delete(activeSocket);

    const reconnectClient = await openClient(args.serverPort, args.openSockets);
    send(reconnectClient, {
      type: "JOIN_SESSION",
      sessionId: args.sessionId,
      reconnectToken: token,
      messageId: args.nextMessageId(`storm-${i}`),
    });

    const joined = (await waitForEvent(
      reconnectClient,
      (msg: WireEvent) =>
        msg.type === "SESSION_JOINED" &&
        msg.resumed === true &&
        typeof msg.reconnectToken === "string",
    )) as WireEvent;
    token = String(joined.reconnectToken);
    activeSocket = reconnectClient;
  }

  return token;
}
