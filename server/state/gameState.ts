import type { GameState as LiteratureState } from "../../src/games/literature/types.js";
import type { GameState as CoupState } from "../../src/games/coup/types.js";
import type { SecretHitlerState } from "../../src/games/secretHitler/types.js";
import type { GameState as HanabiState } from "../../src/games/hanabi/types.js";
import type { Card as HanabiCard } from "../../src/games/hanabi/types.js";
import type { GameState as LoveLetterState } from "../../src/games/love_letter/types.js";
import type { Card as LoveLetterCard } from "../../src/games/love_letter/types.js";
import type { GameState as SpadesState } from "../../src/games/spades/types.js";
import type { BaseGameState, GameType } from "../../src/shared/types.js";

export type GameStateUnion =
  | LiteratureState
  | CoupState
  | SecretHitlerState
  | HanabiState
  | LoveLetterState
  | SpadesState
  | BaseGameState;

export function sanitizeStateForPlayer(
  state: GameStateUnion,
  playerId: string,
): GameStateUnion {
  if (state.gameType === "LITERATURE") {
    const cardCounts: Record<string, number> = {};
    for (const [id, hand] of Object.entries(state.hands || {})) {
      cardCounts[id] = (hand as unknown[]).length;
    }
    const { deck: hiddenDeck, ...rest } = state as LiteratureState & {
      deck?: unknown;
    };
    void hiddenDeck;
    return {
      ...rest,
      hands: { [playerId]: state.hands[playerId] || [] },
      cardCounts,
      playerCardCounts: cardCounts,
    };
  }

  if (state.gameType === "COUP") {
    const players = state.players.map((player) => ({
      ...player,
      influences:
        player.id === playerId
          ? player.influences
          : player.influences.map((influence) =>
              influence.isRevealed
                ? influence
                : { role: "HIDDEN", isRevealed: false },
            ),
    }));
    return { ...state, players };
  }

  if (state.gameType === "SECRET_HITLER") {
    const me = state.players.find((player) => player.id === playerId);
    const visiblePlayers = state.players.map((player) => ({
      ...player,
      role: player.id === playerId ? player.role : undefined,
      partyMembership:
        player.id === playerId ? player.partyMembership : undefined,
    }));

    const fascists = state.players.filter((player) => player.role === "FASCIST");
    const hitler = state.players.find((player) => player.role === "HITLER");
    if (me?.role === "FASCIST") {
      for (const other of fascists) {
        const target = visiblePlayers.find((player) => player.id === other.id);
        if (target) target.role = other.role;
      }
      if (hitler) {
        const target = visiblePlayers.find((player) => player.id === hitler.id);
        if (target) target.role = "HITLER";
      }
    } else if (me?.role === "HITLER") {
      const playerCount = state.players.length;
      if (playerCount <= 6) {
        for (const fascist of fascists) {
          const target = visiblePlayers.find(
            (player) => player.id === fascist.id,
          );
          if (target) target.role = "FASCIST";
        }
      }
    }

    return {
      ...state,
      players: visiblePlayers,
      presidentCards: me?.id === state.presidentId ? state.presidentCards : [],
      chancellorCards:
        me?.id === state.nominatedChancellorId ? state.chancellorCards : [],
      policyPeek:
        me?.id === state.presidentId && state.executiveAction === "POLICY_PEEK"
          ? state.policyPeek
          : null,
    };
  }

  if (state.gameType === "HANABI") {
    return {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        hand:
          player.id === playerId
            ? player.hand.map((card): HanabiCard => ({
                id: card.id,
                color: "HIDDEN",
                rank: 0,
                hintedColor: card.hintedColor,
                hintedRank: card.hintedRank,
              }))
            : player.hand,
      })),
    };
  }

  if (state.gameType === "LOVE_LETTER") {
    return {
      ...state,
      deck: [],
      players: state.players.map((player) => ({
        ...player,
        hand:
          player.id === playerId
            ? player.hand
            : player.hand.map(
                (): LoveLetterCard => ({ role: "HIDDEN", value: 0 }),
              ),
      })),
      setAsideCard: state.setAsideCard ? { role: "HIDDEN", value: 0 } : null,
      priestPeeks: state.priestPeeks
        ? state.priestPeeks.filter((peek) => peek.viewerId === playerId)
        : [],
    };
  }

  if (state.gameType === "SPADES") {
    return {
      ...state,
      deck: [],
      players: state.players.map((player) => ({
        ...player,
        hand: player.id === playerId ? player.hand : [],
      })),
    };
  }

  return state;
}

export function createEmptyState(
  sessionId: string,
  gameType: GameType,
): GameStateUnion {
  const base = {
    sessionId,
    gameType,
    phase: "LOBBY",
    players: [],
    activePlayerIndex: 0,
    lastMove: null,
    moveLog: [],
  };

  if (gameType === "LITERATURE") {
    return {
      ...base,
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

  if (gameType === "COUP") {
    return {
      ...base,
      deck: [],
      pendingAction: null,
    };
  }

  if (gameType === "SECRET_HITLER") {
    return {
      ...base,
      drawPile: [],
      discardPile: [],
      electionTracker: 0,
      liberalPolicies: 0,
      fascistPolicies: 0,
      presidentId: null,
      nominatedChancellorId: null,
      chancellorId: null,
      previousPresidentId: null,
      previousChancellorId: null,
      presidentCards: [],
      chancellorCards: [],
      votes: {},
      vetoRequested: false,
      executiveAction: null,
      policyPeek: null,
      specialElectionReturnIndex: null,
      winner: null,
      winnerReason: null,
      investigateResults: {},
    };
  }

  if (gameType === "HANABI") {
    return {
      ...base,
      deck: [],
      playArea: { RED: 0, BLUE: 0, GREEN: 0, YELLOW: 0, WHITE: 0 },
      discardPile: [],
      hintTokens: 8,
      mistakeTokens: 0,
      score: 0,
      turnsLeft: null,
    };
  }

  if (gameType === "LOVE_LETTER") {
    return {
      ...base,
      deck: [],
      setAsideCard: null,
      discardPile: [],
      eliminatedThisRound: [],
      currentRound: 1,
      handmaidProtections: [],
      priestPeeks: [],
    };
  }

  if (gameType === "SPADES") {
    return {
      ...base,
      deck: [],
      currentTrick: { leadSuit: "SPADE", cards: [] },
      trickHistory: [],
      teamAScore: { tricks: 0, bags: 0, score: 0 },
      teamBScore: { tricks: 0, bags: 0, score: 0 },
      allPlayersBid: false,
      spadesBroken: false,
    };
  }

  return base;
}
