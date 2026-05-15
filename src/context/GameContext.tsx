import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import type { BaseGameState as GameState, GameType } from "../shared/types";
import { parseServerEvent } from "../shared/protocol";

const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;
const MAX_PENDING_MESSAGES = 200;

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
type OutgoingMessage = { type: string; [key: string]: unknown };

interface GameContextProps {
  gameState: GameState | null;
  myPlayerId: string | null;
  cardCounts: Record<string, number>;
  error: string | null;
  connectionStatus: ConnectionStatus;
  inviteToken: string | null;
  createLANSession: (gameType: GameType) => void;
  connectToLAN: (sessionId: string, inviteToken: string) => void;
  sendMessage: (msg: OutgoingMessage) => void;
  sendAction: (action: Record<string, unknown>) => void;
  state: GameState | null;
  playerId: string | null;
  isConnected: boolean;
  clearSession: () => void;
}

export const GameContext = createContext<GameContextProps>(
  {} as GameContextProps,
);

const MUTATING_MESSAGE_TYPES = new Set([
  "JOIN_LOBBY",
  "START_GAME",
  "ASK_CARD",
  "CLAIM_BOOK",
  "COUP_ACTION",
  "SECRET_HITLER_ACTION",
  "PLACE_BID",
  "PLAY_CARD",
  "DISCARD_CARD",
  "GIVE_HINT",
  "MOVE_CARD",
  "GAME_ACTION",
  "HOST_ACTION",
]);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [inviteToken, setInviteTokenState] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const pendingMessagesRef = useRef<OutgoingMessage[]>([]);
  const hasAttemptedInitialReconnectRef = useRef(false);
  const initWsRef = useRef<(onOpen: (s: WebSocket) => void) => void>(() => {});
  const stateVersionRef = useRef(0);
  const sessionTokenRef = useRef<string | null>(null);
  const reconnectTokenRef = useRef<string | null>(null);
  const pendingLobbyJoinRef = useRef<OutgoingMessage | null>(null);
  const reconnectingRef = useRef(false);
  const inviteTokenRef = useRef<string | null>(null);

  const setReconnectToken = useCallback((token: string | null) => {
    reconnectTokenRef.current = token;
    if (token) {
      localStorage.setItem("cardio_reconnectToken", token);
    } else {
      localStorage.removeItem("cardio_reconnectToken");
    }
  }, []);

  const setInviteToken = useCallback((token: string | null) => {
    inviteTokenRef.current = token;
    setInviteTokenState(token);
    if (token) {
      localStorage.setItem("cardio_inviteToken", token);
    } else {
      localStorage.removeItem("cardio_inviteToken");
    }
  }, []);

  const clearPersistedSession = useCallback(() => {
    localStorage.removeItem("cardio_sessionId");
    localStorage.removeItem("cardio_playerName");
    localStorage.removeItem("cardio_reconnectToken");
    localStorage.removeItem("cardio_inviteToken");
  }, []);

  const getPersistedSession = useCallback(
    () => ({
      sessionId: localStorage.getItem("cardio_sessionId"),
      reconnectToken: localStorage.getItem("cardio_reconnectToken"),
    }),
    [],
  );

  const attachMessageMetadata = useCallback((msg: OutgoingMessage) => {
    const out: OutgoingMessage = { ...msg };
    if (typeof out.messageId !== "string") {
      out.messageId = crypto.randomUUID();
    }
    if (
      MUTATING_MESSAGE_TYPES.has(out.type) &&
      typeof out.expectedStateVersion !== "number"
    ) {
      out.expectedStateVersion = stateVersionRef.current;
    }
    return out;
  }, []);

  const flushPendingMessages = useCallback(
    (socket: WebSocket) => {
      while (pendingMessagesRef.current.length > 0) {
        const msg = pendingMessagesRef.current.shift();
        if (!msg) {
          continue;
        }
        socket.send(JSON.stringify(attachMessageMetadata(msg)));
      }
    },
    [attachMessageMetadata],
  );

  const sendPendingLobbyJoinIfReady = useCallback(() => {
    if (
      !pendingLobbyJoinRef.current ||
      !sessionTokenRef.current ||
      wsRef.current?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const joinMsg = {
      ...pendingLobbyJoinRef.current,
      sessionToken: sessionTokenRef.current,
    };
    pendingLobbyJoinRef.current = null;
    wsRef.current.send(JSON.stringify(attachMessageMetadata(joinMsg)));
  }, [attachMessageMetadata]);

  const initWs = useCallback(
    (onOpen: (s: WebSocket) => void) => {
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      const port = window.location.port;
      const url = `${protocol}//${host}${port ? `:${port}` : ""}/ws`;
      const socket = new WebSocket(url);

      socket.onopen = () => {
        setConnectionStatus("connected");
        reconnectAttemptsRef.current = 0;
        intentionalCloseRef.current = false;
        flushPendingMessages(socket);
        onOpen(socket);
      };

      socket.onmessage = (event) => {
        try {
          const rawEvent = JSON.parse(event.data) as unknown;
          const parsedEvent = parseServerEvent(rawEvent);
          if (!parsedEvent.ok) {
            console.warn("Dropped invalid server event:", parsedEvent.error);
            return;
          }
          const data = parsedEvent.data;
          switch (data.type) {
            case "SESSION_CREATED": {
              reconnectingRef.current = false;
              if (typeof data.sessionToken === "string") {
                sessionTokenRef.current = data.sessionToken;
              }
              if (typeof data.inviteToken === "string") {
                setInviteToken(data.inviteToken);
              }
              if (typeof data.sessionId === "string") {
                localStorage.setItem("cardio_sessionId", data.sessionId);
              }
              break;
            }
            case "SESSION_JOINED": {
              reconnectingRef.current = false;
              if (typeof data.sessionToken === "string") {
                sessionTokenRef.current = data.sessionToken;
              }
              if (typeof data.reconnectToken === "string") {
                setReconnectToken(data.reconnectToken);
              }
              if (typeof data.sessionId === "string") {
                localStorage.setItem("cardio_sessionId", data.sessionId);
              }
              sendPendingLobbyJoinIfReady();
              break;
            }
            case "STATE_UPDATE": {
              reconnectingRef.current = false;
              stateVersionRef.current = data.stateVersion;
              if (typeof data.reconnectToken === "string") {
                setReconnectToken(data.reconnectToken);
              }
              if (typeof data.inviteToken === "string") {
                setInviteToken(data.inviteToken);
              }
              if (isGameStatePayload(data.state)) {
                setGameState(data.state);
                const stateRecord = data.state as unknown as Record<string, unknown>;
                const counts =
                  (isRecord(stateRecord.cardCounts) ? stateRecord.cardCounts : null) ??
                  (isRecord(stateRecord.playerCardCounts)
                    ? stateRecord.playerCardCounts
                    : null);
                setCardCounts(toNumberRecord(counts));
              }
              if (typeof data.yourPlayerId === "string") {
                setMyPlayerId(data.yourPlayerId);
              } else if (data.yourPlayerId === null) {
                setMyPlayerId(null);
              }
              break;
            }
            case "ERROR": {
              const message =
                typeof data.message === "string"
                  ? data.message
                  : "Unexpected server error";
              setError(message);
              setTimeout(() => setError(null), 4000);
              if (
                reconnectingRef.current &&
                (message.includes("token") || message.includes("Session not found"))
              ) {
                reconnectingRef.current = false;
                clearPersistedSession();
                setGameState(null);
                setMyPlayerId(null);
                setInviteToken(null);
                setReconnectToken(null);
              }
              break;
            }
          }
        } catch (parseError) {
          console.error("WS parse error", parseError);
        }
      };

      socket.onclose = () => {
        setConnectionStatus("disconnected");
        wsRef.current = null;

        if (intentionalCloseRef.current) {
          intentionalCloseRef.current = false;
          return;
        }

        const persisted = getPersistedSession();
        if (
          persisted.sessionId &&
          persisted.reconnectToken &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
            RECONNECT_MAX_DELAY_MS,
          );
          reconnectAttemptsRef.current++;
          setConnectionStatus("reconnecting");

          reconnectTimerRef.current = setTimeout(() => {
            const { sessionId, reconnectToken } = getPersistedSession();
            if (!sessionId || !reconnectToken) {
              return;
            }
            reconnectingRef.current = true;
            initWsRef.current((s) => {
              s.send(
                JSON.stringify(
                  attachMessageMetadata({
                    type: "JOIN_SESSION",
                    sessionId,
                    reconnectToken,
                  }),
                ),
              );
            });
          }, delay);
        }
      };

      wsRef.current = socket;
    },
    [
      attachMessageMetadata,
      clearPersistedSession,
      flushPendingMessages,
      getPersistedSession,
      sendPendingLobbyJoinIfReady,
      setInviteToken,
      setReconnectToken,
    ],
  );

  useEffect(() => {
    initWsRef.current = initWs;
  }, [initWs]);

  const createLANSession = useCallback(
    (gameType: GameType) => {
      reconnectAttemptsRef.current = 0;
      reconnectingRef.current = false;
      sessionTokenRef.current = null;
      setReconnectToken(null);
      setInviteToken(null);
      initWs((s: WebSocket) =>
        s.send(
          JSON.stringify(
            attachMessageMetadata({ type: "CREATE_SESSION", gameType }),
          ),
        ),
      );
    },
    [attachMessageMetadata, initWs, setInviteToken, setReconnectToken],
  );

  const connectToLAN = useCallback(
    (sessionId: string, inviteTokenValue: string) => {
      reconnectAttemptsRef.current = 0;
      reconnectingRef.current = false;
      sessionTokenRef.current = null;
      setInviteToken(inviteTokenValue.trim());
      initWs((s) =>
        s.send(
          JSON.stringify(
            attachMessageMetadata({
              type: "JOIN_SESSION",
              sessionId: sessionId.trim().toUpperCase(),
              inviteToken: inviteTokenValue.trim(),
            }),
          ),
        ),
      );
    },
    [attachMessageMetadata, initWs, setInviteToken],
  );

  const sendMessage = useCallback(
    (msg: OutgoingMessage) => {
      if (msg.type === "JOIN_LOBBY" && !sessionTokenRef.current) {
        pendingLobbyJoinRef.current = msg;
        return;
      }
      const outbound =
        msg.type === "JOIN_LOBBY"
          ? { ...msg, sessionToken: sessionTokenRef.current }
          : msg;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(attachMessageMetadata(outbound)));
      } else {
        if (pendingMessagesRef.current.length >= MAX_PENDING_MESSAGES) {
          pendingMessagesRef.current.shift();
        }
        pendingMessagesRef.current.push(outbound);
      }
    },
    [attachMessageMetadata],
  );

  const sendAction = useCallback(
    (action: Record<string, unknown>) => {
      sendMessage({ type: "GAME_ACTION", ...action });
    },
    [sendMessage],
  );

  const clearSession = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;

    clearPersistedSession();
    setGameState(null);
    setMyPlayerId(null);
    setCardCounts({});
    setConnectionStatus("disconnected");
    setInviteToken(null);
    setReconnectToken(null);
    stateVersionRef.current = 0;
    sessionTokenRef.current = null;
    pendingMessagesRef.current = [];
    pendingLobbyJoinRef.current = null;

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
    }
  }, [clearPersistedSession, setInviteToken, setReconnectToken]);

  useEffect(() => {
    if (gameState?.sessionId) {
      localStorage.setItem("cardio_sessionId", gameState.sessionId);
    }
  }, [gameState?.sessionId]);

  useEffect(() => {
    if (hasAttemptedInitialReconnectRef.current) {
      return;
    }
    hasAttemptedInitialReconnectRef.current = true;

    const savedSessionId = localStorage.getItem("cardio_sessionId");
    const savedReconnectToken = localStorage.getItem("cardio_reconnectToken");
    const savedInviteToken = localStorage.getItem("cardio_inviteToken");
    if (savedInviteToken) {
      setInviteToken(savedInviteToken);
    }

    if (savedSessionId && savedReconnectToken && !gameState) {
      reconnectingRef.current = true;
      initWs((s) => {
        s.send(
          JSON.stringify(
            attachMessageMetadata({
              type: "JOIN_SESSION",
              sessionId: savedSessionId,
              reconnectToken: savedReconnectToken,
            }),
          ),
        );
      });
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [attachMessageMetadata, gameState, initWs, setInviteToken]);

  return (
    <GameContext.Provider
      value={{
        gameState,
        state: gameState,
        myPlayerId,
        playerId: myPlayerId,
        cardCounts,
        error,
        connectionStatus,
        inviteToken,
        createLANSession,
        connectToLAN,
        sendMessage,
        sendAction,
        isConnected: connectionStatus === "connected",
        clearSession,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isGameStatePayload(value: unknown): value is GameState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.sessionId === "string" &&
    typeof value.gameType === "string" &&
    typeof value.phase === "string" &&
    Array.isArray(value.players) &&
    typeof value.activePlayerIndex === "number" &&
    Array.isArray(value.moveLog)
  );
}

function toNumberRecord(value: Record<string, unknown> | null): Record<string, number> {
  if (!value) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    }
  }
  return out;
}

export const useGame = () => useContext(GameContext);
