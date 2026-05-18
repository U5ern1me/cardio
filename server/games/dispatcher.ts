import * as CoupHandler from "./coup.js";
import * as HanabiHandler from "./hanabi.js";
import * as LiteratureHandler from "./literature.js";
import * as LoveLetterHandler from "./love_letter.js";
import * as SecretHitlerHandler from "./secretHitler.js";
import * as SpadesHandler from "./spades.js";
import type { GameState as CoupState } from "../../src/games/coup/types.js";
import type { GameState as HanabiState } from "../../src/games/hanabi/types.js";
import type { GameState as LiteratureState } from "../../src/games/literature/types.js";
import type { GameState as LoveLetterState } from "../../src/games/love_letter/types.js";
import type { SecretHitlerState } from "../../src/games/secretHitler/types.js";
import type { GameState as SpadesState } from "../../src/games/spades/types.js";
import type { GameType } from "../../src/shared/types.js";
import type { GameStateUnion } from "../state/gameState.js";

export interface DispatchDependencies {
  broadcastState: (sessionId: string) => void;
  dispatch: (
    actionData: Record<string, unknown>,
    shouldSendError?: boolean,
  ) => void;
}

export function dispatchGameAction(
  gameType: GameType,
  state: GameStateUnion,
  actionData: Record<string, unknown>,
  deps: DispatchDependencies,
): { state?: GameStateUnion; error?: string } {
  if (gameType === "LITERATURE") {
    return LiteratureHandler.handleAction(
      state as LiteratureState,
      actionData,
    ) as { state?: GameStateUnion; error?: string };
  }
  if (gameType === "COUP") {
    return CoupHandler.handleAction(
      state as CoupState,
      actionData,
      deps.broadcastState,
      deps.dispatch,
    ) as { state?: GameStateUnion; error?: string };
  }
  if (gameType === "SECRET_HITLER") {
    return SecretHitlerHandler.handleAction(
      state as SecretHitlerState,
      actionData,
    ) as { state?: GameStateUnion; error?: string };
  }
  if (gameType === "HANABI") {
    return HanabiHandler.handleAction(
      state as HanabiState,
      actionData,
    ) as { state?: GameStateUnion; error?: string };
  }
  if (gameType === "LOVE_LETTER") {
    return LoveLetterHandler.handleAction(
      state as LoveLetterState,
      actionData,
    ) as { state?: GameStateUnion; error?: string };
  }
  if (gameType === "SPADES") {
    return SpadesHandler.handleAction(
      state as SpadesState,
      actionData,
    ) as { state?: GameStateUnion; error?: string };
  }
  return { error: `Unsupported game type: ${gameType}` };
}
