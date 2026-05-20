import { describe, it, expect } from "vitest";
import { sanitizeStateForPlayer } from "./index";
import type { GameState } from "../src/games/secretHitler/types";

describe("Server Index Tests", () => {
  describe("sanitizeStateForPlayer", () => {
    it("sanitizes Secret Hitler state for 7+ players (Hitler cannot see fascists)", () => {
      const state: GameState = {
        sessionId: "TEST",
        gameType: "SECRET_HITLER",
        phase: "PLAYING",
        players: Array(7)
          .fill(null)
          .map((_, i) => ({
            id: `p${i}`,
            name: `P${i}`,
            role: i === 0 ? "HITLER" : i === 1 ? "FASCIST" : "LIBERAL",
            partyMembership:
              i === 0 ? "FASCIST" : i === 1 ? "FASCIST" : "LIBERAL",
            isConnected: true,
          })),
        activePlayerIndex: 0,
        presidentIndex: 0,
        chancellorIndex: null,
        previousPresidentIndex: null,
        previousChancellorIndex: null,
        electionTracker: 0,
        liberalPolicies: 0,
        fascistPolicies: 0,
        deck: [],
        discardPile: [],
        drawnPolicies: [],
        votes: {},
        vetoRequested: false,
        lastMove: null,
        moveLog: [],
        winner: undefined,
      };

      const sanitized = sanitizeStateForPlayer(state, "p0");
      // Hitler shouldn't see fascists in 7 player game
      expect(sanitized.players[1].role).toBeUndefined();
    });

    it("sanitizes Secret Hitler state for 5-6 players (Hitler can see fascists)", () => {
      const state: GameState = {
        sessionId: "TEST",
        gameType: "SECRET_HITLER",
        phase: "PLAYING",
        players: Array(5)
          .fill(null)
          .map((_, i) => ({
            id: `p${i}`,
            name: `P${i}`,
            role: i === 0 ? "HITLER" : i === 1 ? "FASCIST" : "LIBERAL",
            partyMembership:
              i === 0 ? "FASCIST" : i === 1 ? "FASCIST" : "LIBERAL",
            isConnected: true,
          })),
        activePlayerIndex: 0,
        presidentIndex: 0,
        chancellorIndex: null,
        previousPresidentIndex: null,
        previousChancellorIndex: null,
        electionTracker: 0,
        liberalPolicies: 0,
        fascistPolicies: 0,
        deck: [],
        discardPile: [],
        drawnPolicies: [],
        votes: {},
        vetoRequested: false,
        lastMove: null,
        moveLog: [],
        winner: undefined,
      };

      const sanitized = sanitizeStateForPlayer(state, "p0");
      // Hitler should see fascists in 5 player game
      expect(sanitized.players[1].role).toBe("FASCIST");
    });

    it("sanitizes deck and hands correctly", () => {
      const state = {
        gameType: "LITERATURE",
        players: [
          { id: "p1", name: "Alice" },
          { id: "p2", name: "Bob" },
        ],
        deck: ["c1", "c2"],
        hands: {
          p1: ["c3"],
          p2: ["c4"],
        },
      };

      const sanitized = sanitizeStateForPlayer(state as unknown as GameState, "p1") as unknown as {
        deck?: unknown;
        hands: Record<string, unknown>;
        cardCounts: Record<string, number>;
        playerCardCounts: Record<string, number>;
      };
      expect(sanitized.deck).toBeUndefined(); // Deck hidden
      expect(sanitized.hands["p1"]).toBeDefined(); // Can see own hand
      expect(sanitized.hands["p2"]).toBeUndefined(); // Cannot see other hand
      // Replaced by card counts
      expect(sanitized.cardCounts["p2"]).toBe(1);
      expect(sanitized.playerCardCounts["p2"]).toBe(1);
    });
  });
});
