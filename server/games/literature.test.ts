import { describe, it, expect } from "vitest";
import { handleAction } from "./literature";
import type { GameState, Card, Player } from "../../src/games/literature/types";
import { getCardsInHalfSuit } from "../../src/games/literature/logic";

// ─── Helpers ──────────────────────────────────────────────

function makePlayer(
  id: string,
  name: string,
  team: "TEAM_A" | "TEAM_B",
  seatIndex: number,
): Player {
  return { id, name, team, seatIndex, isConnected: true };
}

function makeLobbyState(players: Player[]): GameState {
  return {
    sessionId: "TEST",
    gameType: "LITERATURE",
    phase: "LOBBY",
    players,
    activePlayerIndex: 0,
    lastMove: null,
    moveLog: [],
    hands: {},
    books: [],
    houseRules: {
      mandatory_declaration: false,
      announce_one_card: false,
      high_book_double: false,
      claim_any_turn: false,
      claim_passes_turn: false,
    },
    scores: { teamA: 0, teamB: 0 },
  };
}

function makePlayingState(
  players: Player[],
  hands: Record<string, Card[]>,
): GameState {
  return {
    ...makeLobbyState(players),
    phase: "PLAYING",
    hands,
  };
}

const P1 = makePlayer("p1", "Alice", "TEAM_A", 0);
const P2 = makePlayer("p2", "Bob", "TEAM_B", 1);
const P3 = makePlayer("p3", "Carol", "TEAM_A", 2);
const P4 = makePlayer("p4", "Dave", "TEAM_B", 3);

// ─── START_GAME ───────────────────────────────────────────

describe("handleAction: START_GAME", () => {
  it("starts game in test mode with any players", () => {
    const state = makeLobbyState([P1, P2]);
    const result = handleAction(state, {
      type: "START_GAME",
      test: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.state!.phase).toBe("PLAYING");
  });

  it("rejects start with invalid number of players", () => {
    const state = makeLobbyState([P1, P2, P3, P4]);
    const result = handleAction(state, { type: "START_GAME" });
    expect(result.error).toBe("Literature requires exactly 6 or 8 players");
  });

  it("deals cards to all players", () => {
    const players = [P1, P2, P3, P4];
    const state = makeLobbyState(players);
    const result = handleAction(state, {
      type: "START_GAME",
      test: true,
    });
    for (const p of players) {
      expect(result.state!.hands[p.id].length).toBeGreaterThan(0);
    }
  });
});

// ─── ASK_CARD ─────────────────────────────────────────────

describe("handleAction: ASK_CARD", () => {
  const card2C: Card = { suit: "CLUB", rank: "2" };
  const card3C: Card = { suit: "CLUB", rank: "3" };

  it("processes valid ask", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C],
      p2: [card2C],
      p3: [],
      p4: [],
    });

    const result = handleAction(state, {
      type: "ASK_CARD",
      askerId: "p1",
      targetId: "p2",
      card: card2C,
    });

    expect(result.error).toBeUndefined();
    expect(result.state!.hands["p1"]).toContainEqual(card2C);
  });

  it("rejects ask when not the active player", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C],
      p2: [card2C],
      p3: [],
      p4: [],
    });
    state.activePlayerIndex = 1; // Bob's turn, not Alice's

    const result = handleAction(state, {
      type: "ASK_CARD",
      askerId: "p1",
      targetId: "p2",
      card: card2C,
    });

    expect(result.error).toBe("It is not your turn");
  });

  it("rejects ask with missing fields", () => {
    const state = makePlayingState([P1, P2], { p1: [card3C], p2: [] });

    const result = handleAction(state, {
      type: "ASK_CARD",
      askerId: "p1",
      // missing targetId and card
    });

    expect(result.error).toBe("Missing required fields");
  });

  it("rejects ask when actorId mismatches askerId", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C],
      p2: [card2C],
      p3: [],
      p4: [],
    });

    const result = handleAction(state, {
      type: "ASK_CARD",
      actorId: "p2",
      askerId: "p1",
      targetId: "p2",
      card: card2C,
    });

    expect(result.error).toBe("Invalid actor context");
  });
});

// ─── CLAIM_BOOK ───────────────────────────────────────────

describe("handleAction: CLAIM_BOOK", () => {
  const lowClubCards = getCardsInHalfSuit("LOW_CLUB");

  it("awards book on successful claim", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards.slice(0, 3),
      p2: [],
      p3: lowClubCards.slice(3),
      p4: [],
    });

    const result = handleAction(state, {
      type: "CLAIM_BOOK",
      claimerId: "p1",
      halfSuit: "LOW_CLUB",
    });

    expect(result.error).toBeUndefined();
    expect(result.state!.books).toHaveLength(1);
    expect(result.state!.books[0].team).toBe("TEAM_A");
    expect(result.state!.scores.teamA).toBe(1);
  });

  it("awards book to opponents on failed claim", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards.slice(0, 3),
      p2: lowClubCards.slice(3), // Opponent has rest
      p3: [],
      p4: [],
    });

    const result = handleAction(state, {
      type: "CLAIM_BOOK",
      claimerId: "p1",
      halfSuit: "LOW_CLUB",
    });

    expect(result.state!.books[0].team).toBe("TEAM_B");
    expect(result.state!.scores.teamB).toBe(1);
  });

  it("rejects claim when not the active player", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards,
      p2: [],
      p3: [],
      p4: [],
    });
    state.activePlayerIndex = 2; // Carol's turn, not Alice's

    const result = handleAction(state, {
      type: "CLAIM_BOOK",
      claimerId: "p1",
      halfSuit: "LOW_CLUB",
    });

    expect(result.error).toBe("It is not your turn");
  });

  it("rejects claim with missing fields", () => {
    const state = makePlayingState([P1, P2], { p1: [], p2: [] });

    const result = handleAction(state, {
      type: "CLAIM_BOOK",
      claimerId: "p1",
      // missing halfSuit
    });

    expect(result.error).toBe("Missing required fields");
  });

  it("rejects claim when actorId mismatches claimerId", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards,
      p2: [],
      p3: [],
      p4: [],
    });

    const result = handleAction(state, {
      type: "CLAIM_BOOK",
      actorId: "p2",
      claimerId: "p1",
      halfSuit: "LOW_CLUB",
    });

    expect(result.error).toBe("Invalid actor context");
  });

  it("does not mutate the original state", () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [...lowClubCards],
      p2: [],
      p3: [],
      p4: [],
    });
    const origBooks = state.books.length;
    const origScore = state.scores.teamA;

    handleAction(state, {
      type: "CLAIM_BOOK",
      claimerId: "p1",
      halfSuit: "LOW_CLUB",
    });

    expect(state.books.length).toBe(origBooks);
    expect(state.scores.teamA).toBe(origScore);
  });
});

// ─── Unknown action ───────────────────────────────────────

describe("handleAction: unknown type", () => {
  it("returns state unchanged for unknown action types", () => {
    const state = makePlayingState([P1, P2], { p1: [], p2: [] });
    const result = handleAction(state, { type: "NONEXISTENT" });
    expect(result.state).toBe(state);
    expect(result.error).toBeUndefined();
  });
});
