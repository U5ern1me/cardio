import type { BaseGameState } from "../src/shared/types.js";

export type SessionLifecycleState =
  | "LOBBY"
  | "ACTIVE"
  | "COMPLETED"
  | "IDLE_EMPTY"
  | "ENDED";

const ALLOWED_TRANSITIONS: Record<
  SessionLifecycleState,
  readonly SessionLifecycleState[]
> = {
  LOBBY: ["ACTIVE", "IDLE_EMPTY", "ENDED"],
  ACTIVE: ["COMPLETED", "IDLE_EMPTY", "ENDED"],
  COMPLETED: ["IDLE_EMPTY", "ENDED"],
  IDLE_EMPTY: ["LOBBY", "ACTIVE", "COMPLETED", "ENDED"],
  ENDED: [],
};

export interface LifecycleCarrier {
  lifecycleState: SessionLifecycleState;
  lifecycleUpdatedAt: number;
  lifecycleReason: string;
}

export function transitionLifecycle(
  session: LifecycleCarrier,
  next: SessionLifecycleState,
  reason: string,
) {
  if (session.lifecycleState === next) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[session.lifecycleState].includes(next)) {
    throw new Error(
      `Invalid lifecycle transition ${session.lifecycleState} -> ${next}`,
    );
  }
  session.lifecycleState = next;
  session.lifecycleUpdatedAt = Date.now();
  session.lifecycleReason = reason;
}

export function deriveLifecycleFromState(
  state: BaseGameState,
): SessionLifecycleState {
  if (state.phase === "LOBBY") {
    return "LOBBY";
  }
  if (state.phase === "GAME_OVER" || state.winner != null) {
    return "COMPLETED";
  }
  return "ACTIVE";
}
