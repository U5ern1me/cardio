import type { SessionLifecycleState } from "./sessionLifecycle.js";

export interface OrchestratorSessionView {
  lifecycleState: SessionLifecycleState;
  lastActionTimestamp: number;
  clients: Map<unknown, unknown>;
  state: {
    phase?: string;
    players?: unknown[];
    activePlayerIndex?: number;
  };
}

interface SessionOrchestratorOptions<TSession extends OrchestratorSessionView> {
  tickIntervalMs: number;
  inactivityTimeoutMs: number;
  cleanupDelayMs: number;
  disconnectGraceMs: number;
  getSessions: () => Readonly<Record<string, TSession>>;
  onInactivityTimeout: (sessionId: string) => void;
  onCleanupDue: (sessionId: string) => void;
  onDisconnectDue: (sessionId: string, playerId: string) => void;
}

export class SessionOrchestrator<TSession extends OrchestratorSessionView> {
  private readonly tickIntervalMs: number;
  private readonly inactivityTimeoutMs: number;
  private readonly cleanupDelayMs: number;
  private readonly disconnectGraceMs: number;
  private readonly getSessions: () => Readonly<Record<string, TSession>>;
  private readonly onInactivityTimeout: (sessionId: string) => void;
  private readonly onCleanupDue: (sessionId: string) => void;
  private readonly onDisconnectDue: (
    sessionId: string,
    playerId: string,
  ) => void;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly cleanupDeadlines = new Map<string, number>();
  private readonly disconnectDeadlines = new Map<string, Map<string, number>>();

  constructor(options: SessionOrchestratorOptions<TSession>) {
    this.tickIntervalMs = Math.max(500, options.tickIntervalMs);
    this.inactivityTimeoutMs = options.inactivityTimeoutMs;
    this.cleanupDelayMs = options.cleanupDelayMs;
    this.disconnectGraceMs = options.disconnectGraceMs;
    this.getSessions = options.getSessions;
    this.onInactivityTimeout = options.onInactivityTimeout;
    this.onCleanupDue = options.onCleanupDue;
    this.onDisconnectDue = options.onDisconnectDue;
  }

  start() {
    if (this.intervalHandle) {
      return;
    }
    this.intervalHandle = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.cleanupDeadlines.clear();
    this.disconnectDeadlines.clear();
  }

  scheduleCleanup(sessionId: string, nowMs = Date.now()) {
    this.cleanupDeadlines.set(sessionId, nowMs + this.cleanupDelayMs);
  }

  cancelCleanup(sessionId: string) {
    this.cleanupDeadlines.delete(sessionId);
  }

  scheduleDisconnect(sessionId: string, playerId: string, nowMs = Date.now()) {
    const bySession =
      this.disconnectDeadlines.get(sessionId) ?? new Map<string, number>();
    bySession.set(playerId, nowMs + this.disconnectGraceMs);
    this.disconnectDeadlines.set(sessionId, bySession);
  }

  cancelDisconnect(sessionId: string, playerId: string) {
    const bySession = this.disconnectDeadlines.get(sessionId);
    if (!bySession) {
      return;
    }
    bySession.delete(playerId);
    if (bySession.size === 0) {
      this.disconnectDeadlines.delete(sessionId);
    }
  }

  clearSession(sessionId: string) {
    this.cleanupDeadlines.delete(sessionId);
    this.disconnectDeadlines.delete(sessionId);
  }

  private tick(nowMs = Date.now()) {
    this.processDisconnectDeadlines(nowMs);
    this.processCleanupDeadlines(nowMs);
    this.processInactivity(nowMs);
  }

  private processDisconnectDeadlines(nowMs: number) {
    for (const [sessionId, byPlayer] of this.disconnectDeadlines.entries()) {
      for (const [playerId, deadline] of byPlayer.entries()) {
        if (deadline > nowMs) {
          continue;
        }
        byPlayer.delete(playerId);
        this.onDisconnectDue(sessionId, playerId);
      }
      if (byPlayer.size === 0) {
        this.disconnectDeadlines.delete(sessionId);
      }
    }
  }

  private processCleanupDeadlines(nowMs: number) {
    for (const [sessionId, deadline] of this.cleanupDeadlines.entries()) {
      if (deadline > nowMs) {
        continue;
      }
      this.cleanupDeadlines.delete(sessionId);
      this.onCleanupDue(sessionId);
    }
  }

  private processInactivity(nowMs: number) {
    const sessions = this.getSessions();
    for (const [sessionId, session] of Object.entries(sessions)) {
      if (session.lifecycleState !== "ACTIVE") {
        continue;
      }
      if (session.state.phase !== "PLAYING") {
        continue;
      }
      if (session.clients.size === 0) {
        continue;
      }
      if (
        typeof session.state.activePlayerIndex !== "number" ||
        !Array.isArray(session.state.players) ||
        session.state.players.length === 0
      ) {
        continue;
      }
      if (nowMs - session.lastActionTimestamp > this.inactivityTimeoutMs) {
        this.onInactivityTimeout(sessionId);
      }
    }
  }
}
