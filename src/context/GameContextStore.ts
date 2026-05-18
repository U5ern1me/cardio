import { createContext, useContext } from "react";
import type { BaseGameState as GameState, GameType } from "../shared/types";

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
export type OutgoingMessage = { type: string; [key: string]: unknown };

export interface GameContextProps {
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

export const useGame = () => useContext(GameContext);
