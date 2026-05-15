import crypto from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { __dangerouslyCorruptSnapshotForTest } from "./db";
import {
  simulateCrashRecoveryForTests,
  startServer,
  stopServer,
} from "./index";

type WireEvent = Record<string, unknown>;

let serverPort = 0;
const openSockets = new Set<WebSocket>();
let idCounter = 0;

function nextMessageId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}-${crypto.randomBytes(2).toString("hex")}`;
}

async function openClient(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
  openSockets.add(ws);
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      ws.off("open", onOpen);
      reject(err);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
  return ws;
}

function send(ws: WebSocket, payload: Record<string, unknown>) {
  ws.send(JSON.stringify(payload));
}

function closeSocket(ws: WebSocket): Promise<void> {
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

function waitForEvent(
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

async function createAndJoinHost(gameType: string) {
  const host = await openClient();
  send(host, {
    type: "CREATE_SESSION",
    gameType,
    messageId: nextMessageId("create"),
  });

  const created = await waitForEvent(
    host,
    (msg) => msg.type === "SESSION_CREATED",
  );
  const sessionId = String(created.sessionId);
  const inviteToken = String(created.inviteToken);
  const sessionToken = String(created.sessionToken);

  send(host, {
    type: "JOIN_LOBBY",
    sessionToken,
    player: { name: "Host", team: "TEAM_A", seatIndex: 0 },
    messageId: nextMessageId("join-host"),
  });

  const hostState = await waitForEvent(
    host,
    (msg) =>
      msg.type === "STATE_UPDATE" &&
      typeof msg.yourPlayerId === "string" &&
      typeof msg.reconnectToken === "string",
  );

  return { host, sessionId, inviteToken, hostState };
}

async function joinPlayer(
  sessionId: string,
  inviteToken: string,
  name: string,
) {
  const player = await openClient();
  send(player, {
    type: "JOIN_SESSION",
    sessionId,
    inviteToken,
    messageId: nextMessageId("join-session"),
  });

  const joined = await waitForEvent(
    player,
    (msg) =>
      msg.type === "SESSION_JOINED" && typeof msg.sessionToken === "string",
  );
  const sessionToken = String(joined.sessionToken);

  send(player, {
    type: "JOIN_LOBBY",
    sessionToken,
    player: { name, team: "TEAM_B", seatIndex: 1 },
    messageId: nextMessageId("join-player"),
  });

  const playerState = await waitForEvent(
    player,
    (msg) =>
      msg.type === "STATE_UPDATE" &&
      typeof msg.yourPlayerId === "string" &&
      typeof msg.reconnectToken === "string",
  );

  return { player, playerState };
}

describe("multiplayer security and reconnect hardening", () => {
  beforeAll(async () => {
    serverPort = await startServer(0);
  });

  afterEach(async () => {
    await Promise.all(Array.from(openSockets.values()).map(closeSocket));
    openSockets.clear();
  });

  afterAll(async () => {
    await stopServer();
  });

  it("rejects malformed payloads with unknown keys", async () => {
    const client = await openClient();
    send(client, {
      type: "CREATE_SESSION",
      gameType: "LITERATURE",
      messageId: nextMessageId("bad-create"),
      unexpected: true,
    });

    const error = await waitForEvent(
      client,
      (msg) => msg.type === "ERROR" && typeof msg.message === "string",
    );
    expect(String(error.message)).toContain("Invalid");
  });

  it("requires invite or reconnect token for JOIN_SESSION", async () => {
    const { sessionId } = await createAndJoinHost("LITERATURE");
    const client = await openClient();

    send(client, {
      type: "JOIN_SESSION",
      sessionId,
      messageId: nextMessageId("missing-auth"),
    });

    const error = await waitForEvent(
      client,
      (msg) => msg.type === "ERROR" && typeof msg.message === "string",
    );
    expect(String(error.message)).toContain(
      "requires inviteToken or reconnectToken",
    );
  });

  it("rotates reconnect tokens and rejects stale reconnect reuse", async () => {
    const { host, sessionId, hostState } =
      await createAndJoinHost("SECRET_HITLER");
    const reconnectToken1 = String(hostState.reconnectToken);
    await closeSocket(host);
    openSockets.delete(host);

    const reconnectClient = await openClient();
    send(reconnectClient, {
      type: "JOIN_SESSION",
      sessionId,
      reconnectToken: reconnectToken1,
      messageId: nextMessageId("reconnect-fresh"),
    });

    const joined = await waitForEvent(
      reconnectClient,
      (msg) => msg.type === "SESSION_JOINED" && msg.resumed === true,
    );
    expect(typeof joined.reconnectToken).toBe("string");

    await closeSocket(reconnectClient);
    openSockets.delete(reconnectClient);

    const staleClient = await openClient();
    send(staleClient, {
      type: "JOIN_SESSION",
      sessionId,
      reconnectToken: reconnectToken1,
      messageId: nextMessageId("reconnect-stale"),
    });

    const staleError = await waitForEvent(
      staleClient,
      (msg) => msg.type === "ERROR" && typeof msg.message === "string",
    );
    expect(String(staleError.message)).toContain("Stale reconnect token");
  });

  it("suppresses duplicate actions and rejects delayed stale actions", async () => {
    const { host, hostState } = await createAndJoinHost("SECRET_HITLER");
    const baseVersion = Number(hostState.stateVersion);
    const duplicateMessageId = nextMessageId("start-dup");

    send(host, {
      type: "START_GAME",
      test: true,
      messageId: duplicateMessageId,
      expectedStateVersion: baseVersion,
    });
    const firstUpdate = await waitForEvent(
      host,
      (msg) =>
        msg.type === "STATE_UPDATE" &&
        typeof msg.stateVersion === "number" &&
        Number(msg.stateVersion) > baseVersion,
    );
    const versionAfterFirst = Number(firstUpdate.stateVersion);

    send(host, {
      type: "START_GAME",
      test: true,
      messageId: duplicateMessageId,
      expectedStateVersion: baseVersion,
    });
    const duplicateUpdate = await waitForEvent(
      host,
      (msg) =>
        msg.type === "STATE_UPDATE" && typeof msg.stateVersion === "number",
    );
    expect(Number(duplicateUpdate.stateVersion)).toBe(versionAfterFirst);

    send(host, {
      type: "START_GAME",
      test: true,
      messageId: nextMessageId("start-stale"),
      expectedStateVersion: baseVersion,
    });
    const staleError = await waitForEvent(
      host,
      (msg) =>
        msg.type === "ERROR" &&
        typeof msg.message === "string" &&
        String(msg.message).includes("Stale state version"),
    );
    expect(String(staleError.message)).toContain("Stale state version");
  });

  it("handles simultaneous host and player start attempts deterministically", async () => {
    const { host, sessionId, inviteToken } =
      await createAndJoinHost("SECRET_HITLER");
    const { player, playerState } = await joinPlayer(sessionId, inviteToken, "Guest");
    const baseVersion = Number(playerState.stateVersion);

    send(host, {
      type: "START_GAME",
      test: true,
      messageId: nextMessageId("host-start"),
      expectedStateVersion: baseVersion,
    });
    send(player, {
      type: "START_GAME",
      test: true,
      messageId: nextMessageId("player-start"),
      expectedStateVersion: baseVersion,
    });

    const [hostUpdate, playerError] = await Promise.all([
      waitForEvent(
        host,
        (msg) =>
          msg.type === "STATE_UPDATE" &&
          typeof msg.stateVersion === "number" &&
          Number(msg.stateVersion) > baseVersion,
      ),
      waitForEvent(
        player,
        (msg) =>
          msg.type === "ERROR" &&
          typeof msg.message === "string" &&
          (String(msg.message).includes("Only the host can start the game") ||
            String(msg.message).includes("Stale state version")),
      ),
    ]);

    expect(Number(hostUpdate.stateVersion)).toBeGreaterThan(baseVersion);
    expect(
      String(playerError.message).includes("Only the host can start the game") ||
        String(playerError.message).includes("Stale state version"),
    ).toBe(true);
  });

  it("migrates host authority when host disconnects", async () => {
    const { host, sessionId, inviteToken } =
      await createAndJoinHost("LITERATURE");
    const { player, playerState } = await joinPlayer(
      sessionId,
      inviteToken,
      "Guest",
    );
    const playerId = String(playerState.yourPlayerId);

    await closeSocket(host);
    openSockets.delete(host);

    const migrated = await waitForEvent(
      player,
      (msg) =>
        msg.type === "STATE_UPDATE" &&
        typeof msg.state === "object" &&
        msg.state !== null &&
        (msg.state as Record<string, unknown>).hostPlayerId === playerId,
    );

    expect((migrated.state as Record<string, unknown>).hostPlayerId).toBe(
      playerId,
    );
  });

  it("enforces role capabilities for spectators", async () => {
    const { sessionId, inviteToken } = await createAndJoinHost("SECRET_HITLER");
    const spectator = await openClient();

    send(spectator, {
      type: "JOIN_SESSION",
      sessionId,
      inviteToken,
      joinAs: "SPECTATOR",
      messageId: nextMessageId("spectator-join"),
    });
    const joined = await waitForEvent(
      spectator,
      (msg) => msg.type === "SESSION_JOINED" && typeof msg.stateVersion === "number",
    );
    const spectatorVersion = Number(joined.stateVersion);

    send(spectator, {
      type: "START_GAME",
      messageId: nextMessageId("spectator-start"),
      expectedStateVersion: spectatorVersion,
    });

    const error = await waitForEvent(
      spectator,
      (msg) => msg.type === "ERROR" && typeof msg.message === "string",
    );
    expect(String(error.message)).toContain(
      "Join the lobby before sending actions",
    );
  });

  it("recovers persisted sessions after simulated process crash", async () => {
    const { host, sessionId, hostState } = await createAndJoinHost("LITERATURE");
    const reconnectToken = String(hostState.reconnectToken);

    simulateCrashRecoveryForTests();
    await closeSocket(host);
    openSockets.delete(host);

    const resumed = await openClient();
    send(resumed, {
      type: "JOIN_SESSION",
      sessionId,
      reconnectToken,
      messageId: nextMessageId("recover-host"),
    });

    const joined = await waitForEvent(
      resumed,
      (msg) =>
        msg.type === "SESSION_JOINED" &&
        msg.resumed === true &&
        typeof msg.reconnectToken === "string",
    );
    expect(joined.sessionId).toBe(sessionId);
  });

  it("replays event log when snapshot is corrupted", async () => {
    const { host, sessionId, hostState } = await createAndJoinHost("SECRET_HITLER");
    const reconnectToken = String(hostState.reconnectToken);

    __dangerouslyCorruptSnapshotForTest(sessionId);
    simulateCrashRecoveryForTests();
    await closeSocket(host);
    openSockets.delete(host);

    const resumed = await openClient();
    send(resumed, {
      type: "JOIN_SESSION",
      sessionId,
      reconnectToken,
      messageId: nextMessageId("recover-corrupt"),
    });

    const joined = await waitForEvent(
      resumed,
      (msg) => msg.type === "SESSION_JOINED" && msg.resumed === true,
    );
    expect(joined.sessionId).toBe(sessionId);
  });

  it("stays stable under reconnect storms", async () => {
    const { host, sessionId, inviteToken } = await createAndJoinHost("LITERATURE");
    const { player, playerState } = await joinPlayer(sessionId, inviteToken, "Storm");
    let reconnectToken = String(playerState.reconnectToken);

    let activePlayerSocket = player;
    for (let i = 0; i < 20; i += 1) {
      await closeSocket(activePlayerSocket);
      openSockets.delete(activePlayerSocket);

      const reconnectClient = await openClient();
      send(reconnectClient, {
        type: "JOIN_SESSION",
        sessionId,
        reconnectToken,
        messageId: nextMessageId(`storm-${i}`),
      });

      const joined = await waitForEvent(
        reconnectClient,
        (msg) =>
          msg.type === "SESSION_JOINED" &&
          msg.resumed === true &&
          typeof msg.reconnectToken === "string",
      );
      reconnectToken = String(joined.reconnectToken);
      activePlayerSocket = reconnectClient;
    }

    const hostState = await waitForEvent(
      host,
      (msg) =>
        msg.type === "STATE_UPDATE" &&
        typeof msg.state === "object" &&
        msg.state !== null &&
        Array.isArray((msg.state as Record<string, unknown>).players),
    );
    const players = (hostState.state as Record<string, unknown>).players as Array<
      Record<string, unknown>
    >;
    expect(players.length).toBe(2);
  });

  it("applies token-bucket rate limiting on sustained bursts", async () => {
    const client = await openClient();
    for (let i = 0; i < 45; i += 1) {
      client.send("not-json");
    }

    const error = await waitForEvent(
      client,
      (msg) =>
        msg.type === "ERROR" &&
        typeof msg.message === "string" &&
        String(msg.message).includes("Rate limit exceeded"),
      5_000,
    );
    expect(String(error.message)).toContain("Rate limit exceeded");
  });
});
