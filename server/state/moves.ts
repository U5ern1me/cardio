import type { GameStateUnion } from "./gameState.js";
import type { Move } from "../../src/shared/types.js";

const MAX_MOVE_LOG_ENTRIES = 50;

export function capMoveLog(state: GameStateUnion): GameStateUnion {
  if (
    !Array.isArray(state.moveLog) ||
    state.moveLog.length <= MAX_MOVE_LOG_ENTRIES
  ) {
    return state;
  }

  return {
    ...state,
    moveLog: state.moveLog.slice(0, MAX_MOVE_LOG_ENTRIES),
  };
}

export function createServerMove(
  details: string,
  playerName: string = "System",
): Move {
  return {
    type: "SYSTEM",
    timestamp: new Date().toISOString(),
    playerName,
    details,
    success: true,
  };
}

export function prependServerMove(state: GameStateUnion, move: Move): GameStateUnion {
  return capMoveLog({
    ...state,
    lastMove: move,
    moveLog: [move, ...(state.moveLog ?? [])],
  });
}
