import { describe, it, expect } from 'vitest';
import {
  createDeck,
  shuffle,
  getHalfSuit,
  getCardsInHalfSuit,
  dealCards,
  isSameCard,
  handleAsk,
  handleClaim,
  LOW_RANKS,
  HIGH_RANKS,
} from './logic';
import type { Card, GameState, HalfSuitName, Player } from './types';

// ─── Helpers ──────────────────────────────────────────────

function makePlayer(id: string, name: string, team: 'TEAM_A' | 'TEAM_B', seatIndex: number): Player {
  return { id, name, team, seatIndex, isConnected: true };
}

function makeLobbyState(players: Player[]): GameState {
  return {
    sessionId: 'TEST',
    gameType: 'LITERATURE',
    phase: 'LOBBY',
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

function makePlayingState(players: Player[], hands: Record<string, Card[]>): GameState {
  return {
    ...makeLobbyState(players),
    phase: 'PLAYING',
    hands,
  };
}

const P1 = makePlayer('p1', 'Alice', 'TEAM_A', 0);
const P2 = makePlayer('p2', 'Bob', 'TEAM_B', 1);
const P3 = makePlayer('p3', 'Carol', 'TEAM_A', 2);
const P4 = makePlayer('p4', 'Dave', 'TEAM_B', 3);

// ─── createDeck ───────────────────────────────────────────

describe('createDeck', () => {
  it('creates a 54-card deck for 6-player (non-8-player) games', () => {
    const deck = createDeck(false);
    expect(deck).toHaveLength(54);
  });

  it('creates a 48-card deck for 8-player games', () => {
    const deck = createDeck(true);
    expect(deck).toHaveLength(48);
  });

  it('8-player deck has no eights or jokers', () => {
    const deck = createDeck(true);
    const eightsOrJokers = deck.filter(c => c.rank === '8' || c.suit === 'JOKER');
    expect(eightsOrJokers).toHaveLength(0);
  });

  it('6-player deck includes 4 eights and 2 jokers', () => {
    const deck = createDeck(false);
    const eights = deck.filter(c => c.rank === '8');
    const jokers = deck.filter(c => c.suit === 'JOKER');
    expect(eights).toHaveLength(4);
    expect(jokers).toHaveLength(2);
  });

  it('contains no duplicate cards', () => {
    const deck = createDeck(false);
    const keys = deck.map(c => `${c.rank}-${c.suit}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every card belongs to a valid half-suit', () => {
    const deck = createDeck(false);
    for (const card of deck) {
      const hs = getHalfSuit(card);
      expect(hs).toBeTruthy();
    }
  });
});

// ─── shuffle ──────────────────────────────────────────────

describe('shuffle', () => {
  it('returns an array of the same length', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect(shuffled).toHaveLength(arr.length);
  });

  it('contains the same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect(shuffled.sort()).toEqual(arr.sort());
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffle(arr);
    expect(arr).toEqual(copy);
  });
});

// ─── getHalfSuit ──────────────────────────────────────────

describe('getHalfSuit', () => {
  it('maps low cards correctly', () => {
    expect(getHalfSuit({ suit: 'CLUB', rank: '2' })).toBe('LOW_CLUB');
    expect(getHalfSuit({ suit: 'DIAMOND', rank: '7' })).toBe('LOW_DIAMOND');
    expect(getHalfSuit({ suit: 'HEART', rank: '5' })).toBe('LOW_HEART');
    expect(getHalfSuit({ suit: 'SPADE', rank: '3' })).toBe('LOW_SPADE');
  });

  it('maps high cards correctly', () => {
    expect(getHalfSuit({ suit: 'CLUB', rank: '9' })).toBe('HIGH_CLUB');
    expect(getHalfSuit({ suit: 'DIAMOND', rank: 'A' })).toBe('HIGH_DIAMOND');
    expect(getHalfSuit({ suit: 'HEART', rank: 'K' })).toBe('HIGH_HEART');
    expect(getHalfSuit({ suit: 'SPADE', rank: 'J' })).toBe('HIGH_SPADE');
  });

  it('maps eights and jokers to EIGHTS_AND_JOKERS', () => {
    expect(getHalfSuit({ suit: 'CLUB', rank: '8' })).toBe('EIGHTS_AND_JOKERS');
    expect(getHalfSuit({ suit: 'DIAMOND', rank: '8' })).toBe('EIGHTS_AND_JOKERS');
    expect(getHalfSuit({ suit: 'JOKER', rank: 'Jk1' })).toBe('EIGHTS_AND_JOKERS');
    expect(getHalfSuit({ suit: 'JOKER', rank: 'Jk2' })).toBe('EIGHTS_AND_JOKERS');
  });
});

// ─── getCardsInHalfSuit ───────────────────────────────────

describe('getCardsInHalfSuit', () => {
  it('returns 6 cards for each standard half-suit', () => {
    const standardHalfSuits: HalfSuitName[] = [
      'LOW_CLUB', 'HIGH_CLUB', 'LOW_DIAMOND', 'HIGH_DIAMOND',
      'LOW_HEART', 'HIGH_HEART', 'LOW_SPADE', 'HIGH_SPADE',
    ];
    for (const hs of standardHalfSuits) {
      expect(getCardsInHalfSuit(hs)).toHaveLength(6);
    }
  });

  it('returns 6 cards for EIGHTS_AND_JOKERS', () => {
    expect(getCardsInHalfSuit('EIGHTS_AND_JOKERS')).toHaveLength(6);
  });

  it('LOW_CLUB contains ranks 2-7 of clubs', () => {
    const cards = getCardsInHalfSuit('LOW_CLUB');
    expect(cards.every(c => c.suit === 'CLUB')).toBe(true);
    const ranks = cards.map(c => c.rank);
    expect(ranks).toEqual(LOW_RANKS);
  });

  it('HIGH_SPADE contains ranks 9-A of spades', () => {
    const cards = getCardsInHalfSuit('HIGH_SPADE');
    expect(cards.every(c => c.suit === 'SPADE')).toBe(true);
    const ranks = cards.map(c => c.rank);
    expect(ranks).toEqual(HIGH_RANKS);
  });

  it('every card in a half-suit maps back to that half-suit via getHalfSuit', () => {
    const allHalfSuits: HalfSuitName[] = [
      'LOW_CLUB', 'HIGH_CLUB', 'LOW_DIAMOND', 'HIGH_DIAMOND',
      'LOW_HEART', 'HIGH_HEART', 'LOW_SPADE', 'HIGH_SPADE',
      'EIGHTS_AND_JOKERS',
    ];
    for (const hs of allHalfSuits) {
      for (const card of getCardsInHalfSuit(hs)) {
        expect(getHalfSuit(card)).toBe(hs);
      }
    }
  });
});

// ─── isSameCard ───────────────────────────────────────────

describe('isSameCard', () => {
  it('returns true for identical cards', () => {
    expect(isSameCard({ suit: 'CLUB', rank: '2' }, { suit: 'CLUB', rank: '2' })).toBe(true);
  });

  it('returns false for different ranks', () => {
    expect(isSameCard({ suit: 'CLUB', rank: '2' }, { suit: 'CLUB', rank: '3' })).toBe(false);
  });

  it('returns false for different suits', () => {
    expect(isSameCard({ suit: 'CLUB', rank: '2' }, { suit: 'HEART', rank: '2' })).toBe(false);
  });
});

// ─── dealCards ────────────────────────────────────────────

describe('dealCards', () => {
  const sixPlayers = [
    makePlayer('a', 'A', 'TEAM_A', 0),
    makePlayer('b', 'B', 'TEAM_B', 1),
    makePlayer('c', 'C', 'TEAM_A', 2),
    makePlayer('d', 'D', 'TEAM_B', 3),
    makePlayer('e', 'E', 'TEAM_A', 4),
    makePlayer('f', 'F', 'TEAM_B', 5),
  ];

  const eightPlayers = [
    ...sixPlayers,
    makePlayer('g', 'G', 'TEAM_A', 6),
    makePlayer('h', 'H', 'TEAM_B', 7),
  ];

  it('sets phase to PLAYING', () => {
    const state = dealCards(makeLobbyState(sixPlayers));
    expect(state.phase).toBe('PLAYING');
  });

  it('deals 9 cards to each of 6 players', () => {
    const state = dealCards(makeLobbyState(sixPlayers));
    for (const player of sixPlayers) {
      expect(state.hands[player.id]).toHaveLength(9);
    }
  });

  it('deals 6 cards to each of 8 players', () => {
    const state = dealCards(makeLobbyState(eightPlayers));
    for (const player of eightPlayers) {
      expect(state.hands[player.id]).toHaveLength(6);
    }
  });

  it('total cards dealt equals deck size', () => {
    const state = dealCards(makeLobbyState(sixPlayers));
    const totalCards = Object.values(state.hands).reduce((sum, hand) => sum + hand.length, 0);
    expect(totalCards).toBe(54);
  });

  it('no duplicate cards across all hands', () => {
    const state = dealCards(makeLobbyState(sixPlayers));
    const allCards = Object.values(state.hands).flat();
    const keys = allCards.map(c => `${c.rank}-${c.suit}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resets scores, books, and moveLog', () => {
    const state = dealCards(makeLobbyState(sixPlayers));
    expect(state.scores).toEqual({ teamA: 0, teamB: 0 });
    expect(state.books).toEqual([]);
    expect(state.moveLog).toEqual([]);
  });

  it('sets activePlayerIndex to 0', () => {
    const state = dealCards(makeLobbyState(sixPlayers));
    expect(state.activePlayerIndex).toBe(0);
  });
});

// ─── handleAsk ────────────────────────────────────────────

describe('handleAsk', () => {
  const card2C: Card = { suit: 'CLUB', rank: '2' };
  const card3C: Card = { suit: 'CLUB', rank: '3' };
  const card9H: Card = { suit: 'HEART', rank: '9' };

  it('transfers card on successful ask', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C],        // Alice (TEAM_A) has 3♣ — same half-suit as 2♣
      p2: [card2C],        // Bob (TEAM_B) has 2♣
      p3: [], p4: [],
    });

    const result = handleAsk(state, 'p1', 'p2', card2C);
    expect(result.success).toBe(true);
    expect(result.state.hands['p1']).toContainEqual(card2C);
    expect(result.state.hands['p2']).not.toContainEqual(card2C);
  });

  it('keeps turn with asker on successful ask', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C], p2: [card2C], p3: [], p4: [],
    });
    state.activePlayerIndex = 0; // Alice's turn

    const result = handleAsk(state, 'p1', 'p2', card2C);
    expect(result.state.activePlayerIndex).toBe(0);
  });

  it('passes turn to target on failed ask', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C], p2: [card9H], p3: [], p4: [],
    });
    state.activePlayerIndex = 0;

    const result = handleAsk(state, 'p1', 'p2', card2C);
    expect(result.success).toBe(false);
    expect(result.state.activePlayerIndex).toBe(1); // Bob's index
  });

  it('rejects asking a teammate', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C], p2: [], p3: [card2C], p4: [],
    });

    const result = handleAsk(state, 'p1', 'p3', card2C);
    expect(result.error).toBe('Cannot ask teammate');
  });

  it('rejects if asker does not hold a card in the half-suit', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card9H],  // only has HIGH_HEART, not LOW_CLUB
      p2: [card2C], p3: [], p4: [],
    });

    const result = handleAsk(state, 'p1', 'p2', card2C);
    expect(result.error).toBe('You do not hold a card from this half-suit');
  });

  it('rejects if asker already holds the asked card', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card2C, card3C], p2: [], p3: [], p4: [],
    });

    const result = handleAsk(state, 'p1', 'p2', card2C);
    expect(result.error).toBe('You already hold this card');
  });

  it('rejects invalid player IDs', () => {
    const state = makePlayingState([P1, P2], { p1: [card3C], p2: [] });
    const result = handleAsk(state, 'p1', 'nonexistent', card2C);
    expect(result.error).toBe('Invalid players');
  });

  it('logs the move', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C], p2: [card2C], p3: [], p4: [],
    });

    const result = handleAsk(state, 'p1', 'p2', card2C);
    expect(result.state.lastMove).not.toBeNull();
    expect(result.state.lastMove!.type).toBe('ASK');
    expect(result.state.lastMove!.playerName).toBe('Alice');
    expect(result.state.moveLog).toHaveLength(1);
  });

  it('does not mutate the original state', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [card3C], p2: [card2C], p3: [], p4: [],
    });
    const originalP2Hand = [...state.hands['p2']];

    handleAsk(state, 'p1', 'p2', card2C);
    expect(state.hands['p2']).toEqual(originalP2Hand);
    expect(state.lastMove).toBeNull();
  });
});

// ─── handleClaim ──────────────────────────────────────────

describe('handleClaim', () => {
  const lowClubCards = getCardsInHalfSuit('LOW_CLUB');

  it('awards book to claiming team when team holds all cards', () => {
    // Split LOW_CLUB cards between Team A players
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards.slice(0, 3),
      p2: [],
      p3: lowClubCards.slice(3),
      p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    expect(result.success).toBe(true);
    expect(result.state.books).toHaveLength(1);
    expect(result.state.books[0].team).toBe('TEAM_A');
    expect(result.state.books[0].halfSuit).toBe('LOW_CLUB');
    expect(result.state.scores.teamA).toBe(1);
    expect(result.state.scores.teamB).toBe(0);
  });

  it('awards book to opposing team when claim fails', () => {
    // Opponent holds one of the cards
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards.slice(0, 3),
      p2: [lowClubCards[3]],            // Bob (TEAM_B) has one
      p3: lowClubCards.slice(4),        // Carol has the rest
      p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    expect(result.success).toBe(false);
    expect(result.state.books[0].team).toBe('TEAM_B');
    expect(result.state.scores.teamB).toBe(1);
  });

  it('removes claimed half-suit cards from all hands', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [...lowClubCards, { suit: 'HEART', rank: '9' }],
      p2: [],
      p3: [],
      p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    // P1 should only have the heart card left
    expect(result.state.hands['p1']).toHaveLength(1);
    expect(result.state.hands['p1'][0]).toEqual({ suit: 'HEART', rank: '9' });
  });

  it('removes opponent cards too when claim fails', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards.slice(0, 3),
      p2: lowClubCards.slice(3),  // Opponent holds cards
      p3: [],
      p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    // All low club cards removed from everyone
    for (const hand of Object.values(result.state.hands)) {
      for (const card of hand) {
        expect(getHalfSuit(card)).not.toBe('LOW_CLUB');
      }
    }
  });

  it('returns error for invalid player', () => {
    const state = makePlayingState([P1, P2], { p1: [], p2: [] });
    const result = handleClaim(state, 'nonexistent', 'LOW_CLUB');
    expect(result.error).toBe('Invalid player');
  });

  it('logs the move with correct details', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards,
      p2: [], p3: [], p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    expect(result.state.lastMove!.type).toBe('CLAIM');
    expect(result.state.lastMove!.success).toBe(true);
    expect(result.state.lastMove!.details).toContain('correctly claimed');
  });

  it('logs failure details when claim fails', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards.slice(0, 3),
      p2: lowClubCards.slice(3),
      p3: [], p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    expect(result.state.lastMove!.details).toContain('failed to claim');
    expect(result.state.lastMove!.details).toContain('opposing team');
  });

  it('does not mutate the original state', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: [...lowClubCards],
      p2: [], p3: [], p4: [],
    });
    const originalBooks = [...state.books];
    const originalScore = { ...state.scores };

    handleClaim(state, 'p1', 'LOW_CLUB');
    expect(state.books).toEqual(originalBooks);
    expect(state.scores).toEqual(originalScore);
    expect(state.lastMove).toBeNull();
  });

  it('sets phase to GAME_OVER when all books claimed (8-player)', () => {
    const eightPlayers = Array.from({ length: 8 }, (_, i) =>
      makePlayer(`p${i}`, `P${i}`, i % 2 === 0 ? 'TEAM_A' : 'TEAM_B', i)
    );

    // All 8 half-suits for 8-player mode (no EIGHTS_AND_JOKERS)
    const allHalfSuits: HalfSuitName[] = [
      'LOW_CLUB', 'HIGH_CLUB', 'LOW_DIAMOND', 'HIGH_DIAMOND',
      'LOW_HEART', 'HIGH_HEART', 'LOW_SPADE', 'HIGH_SPADE',
    ];

    // Pre-claim 7 books, then claim the 8th
    const state = makePlayingState(eightPlayers, {
      p0: getCardsInHalfSuit('HIGH_SPADE'),
      p1: [], p2: [], p3: [], p4: [], p5: [], p6: [], p7: [],
    });
    state.books = allHalfSuits.slice(0, 7).map(hs => ({ team: 'TEAM_A' as const, halfSuit: hs }));
    state.scores = { teamA: 4, teamB: 3 };

    const result = handleClaim(state, 'p0', 'HIGH_SPADE');
    expect(result.state.phase).toBe('GAME_OVER');
    expect(result.state.books).toHaveLength(8);
  });

  it('does not end game before max books reached', () => {
    const state = makePlayingState([P1, P2, P3, P4], {
      p1: lowClubCards,
      p2: [], p3: [], p4: [],
    });

    const result = handleClaim(state, 'p1', 'LOW_CLUB');
    expect(result.state.phase).toBe('PLAYING');
  });
});

// ─── Integration: multi-step game flow ────────────────────

describe('integration: game flow', () => {
  it('deal → ask → claim produces consistent state', () => {
    const players = [P1, P2, P3, P4];
    let state = dealCards(makeLobbyState(players));

    // Find a card that P1 can ask P2 for
    const p1Hand = state.hands['p1'];
    const p2Hand = state.hands['p2'];

    // Find a half-suit P1 has, and a card in that half-suit that P2 has
    let askableCard: Card | null = null;
    for (const myCard of p1Hand) {
      const hs = getHalfSuit(myCard);
      const targetCard = p2Hand.find(c => getHalfSuit(c) === hs && !isSameCard(c, myCard));
      if (targetCard) {
        askableCard = targetCard;
        break;
      }
    }

    if (askableCard) {
      const askResult = handleAsk(state, 'p1', 'p2', askableCard);
      expect(askResult.error).toBeUndefined();
      state = askResult.state;

      // Total cards should be preserved
      const totalCards = Object.values(state.hands).reduce((s, h) => s + h.length, 0);
      // 4 players with 54/4 ≈ 13-14 cards each, total still 54
      expect(totalCards).toBe(54);
    }
  });
});
