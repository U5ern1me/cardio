import type { GameState, Card, Suit, Rank, TeamScore, Player } from './types.js';

const SUITS: Suit[] = ['SPADE', 'HEART', 'DIAMOND', 'CLUB'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function setupSpades(state: GameState): GameState {
  if (state.players.length !== 4) return state;

  const deck = createDeck();
  const players = state.players.map((p, i) => ({
    ...p,
    team: (i % 2 === 0 ? 'TEAM_A' : 'TEAM_B') as 'TEAM_A' | 'TEAM_B',
    hand: deck.splice(0, 13),
    bid: null,
    tricksTaken: 0,
    bags: 0
  }));

  return {
    ...state,
    players,
    deck: [],
    currentTrick: { leadSuit: 'SPADE', cards: [] },
    trickHistory: [],
    teamAScore: state.teamAScore ? { ...state.teamAScore } : { tricks: 0, bags: 0, score: 0 },
    teamBScore: state.teamBScore ? { ...state.teamBScore } : { tricks: 0, bags: 0, score: 0 },
    allPlayersBid: false,
    spadesBroken: false,
    phase: 'BIDDING',
    activePlayerIndex: 0,
  };
}

export function placeBid(state: GameState, playerId: string, bid: number): { state?: GameState; error?: string } {
  if (state.phase !== 'BIDDING') return { error: 'Not bidding phase' };
  
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const newState = { ...state };
  newState.players = newState.players.map(p => 
    p.id === playerId ? { ...p, bid: Math.max(0, Math.min(bid, 13)) } : p
  );

  if (newState.players.every(p => p.bid !== null)) {
    newState.allPlayersBid = true;
    newState.phase = 'PLAYING';
    newState.currentTrick = { leadSuit: 'SPADE', cards: [] };
    newState.activePlayerIndex = 0; // Player 0 (left of dealer) leads first trick
  } else {
    newState.activePlayerIndex = (newState.activePlayerIndex + 1) % 4;
  }

  return { state: newState };
}

export function canOnlyPlaySpades(player: Player): boolean {
  return player.hand.every((card) => card.suit === 'SPADE');
}

export function playCard(state: GameState, playerId: string, card: Card): { state?: GameState; error?: string } {
  if (state.phase !== 'PLAYING') return { error: 'Not playing phase' };
  
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const cardIndex = player.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
  if (cardIndex === -1) return { error: 'Card not in hand' };

  const leadSuit = state.currentTrick.cards.length === 0 ? card.suit : state.currentTrick.leadSuit;

  if (state.currentTrick.cards.length === 0) {
    if (card.suit === 'SPADE' && !state.spadesBroken && !canOnlyPlaySpades(player)) {
      return { error: 'Spades are not broken yet' };
    }
  } else {
    const mustFollowSuit = player.hand.some(c => c.suit === state.currentTrick.leadSuit);
    if (mustFollowSuit && card.suit !== state.currentTrick.leadSuit) {
      return { error: `Must follow lead suit (${state.currentTrick.leadSuit})` };
    }
  }

  let newState = { ...state };
  if (card.suit === 'SPADE') {
    newState.spadesBroken = true;
  }

  const newHand = [...player.hand];
  newHand.splice(cardIndex, 1);
  newState.players = newState.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p);

  newState.currentTrick = {
    ...newState.currentTrick,
    leadSuit,
    cards: [...newState.currentTrick.cards, { playerId, card }]
  };

  if (newState.currentTrick.cards.length === 4) {
    newState = resolveTrick(newState);
  } else {
    newState.activePlayerIndex = (newState.activePlayerIndex + 1) % 4;
  }

  return { state: newState };
}

export function resolveTrick(state: GameState): GameState {
  const leadSuit = state.currentTrick.leadSuit;
  let highestCard = state.currentTrick.cards[0];
  const hasSpade = state.currentTrick.cards.some(c => c.card.suit === 'SPADE');

  for (const play of state.currentTrick.cards) {
    if (hasSpade && play.card.suit === 'SPADE') {
      if (highestCard.card.suit !== 'SPADE' || RANK_VALUES[play.card.rank] > RANK_VALUES[highestCard.card.rank]) {
        highestCard = play;
      }
    } else if (!hasSpade && play.card.suit === leadSuit) {
      if (RANK_VALUES[play.card.rank] > RANK_VALUES[highestCard.card.rank]) {
        highestCard = play;
      }
    }
  }

  let newState = { ...state };
  const winnerId = highestCard.playerId;
  newState.players = newState.players.map(p => 
    p.id === winnerId ? { ...p, tricksTaken: p.tricksTaken + 1 } : p
  );

  newState.trickHistory = [...newState.trickHistory, { ...newState.currentTrick, winner: winnerId }];
  newState.activePlayerIndex = newState.players.findIndex(p => p.id === winnerId);
  newState.currentTrick = { leadSuit: 'SPADE', cards: [] };

  if (newState.trickHistory.length === 13) {
    newState = endRound(newState);
  }

  return newState;
}

export function endRound(state: GameState): GameState {
  let newState = { ...state };
  newState.teamAScore = { ...newState.teamAScore };
  newState.teamBScore = { ...newState.teamBScore };

  function scoreTeam(team: 'TEAM_A' | 'TEAM_B', teamScore: TeamScore) {
    const members = newState.players.filter(p => p.team === team);
    let combinedBid = 0;
    let partnerTricks = 0;
    let roundScore = 0;
    let nilTricks = 0;

    for (const m of members) {
      if (m.bid === 0) {
        if (m.tricksTaken === 0) {
          roundScore += 100;
        } else {
          roundScore -= 100;
          nilTricks += m.tricksTaken;
        }
      } else {
        combinedBid += (m.bid || 0);
        partnerTricks += m.tricksTaken;
      }
    }

    if (partnerTricks >= combinedBid) {
      roundScore += combinedBid * 10;
      teamScore.bags += (partnerTricks - combinedBid) + nilTricks;
    } else {
      roundScore -= combinedBid * 10;
      teamScore.bags += nilTricks;
    }

    teamScore.score += roundScore;

    if (teamScore.bags >= 10) {
      teamScore.bags -= 10;
      teamScore.score -= 100;
    }
  }

  scoreTeam('TEAM_A', newState.teamAScore);
  scoreTeam('TEAM_B', newState.teamBScore);

  const MAX_SCORE = 500;
  if (newState.teamAScore.score >= MAX_SCORE || newState.teamBScore.score >= MAX_SCORE) {
    newState.phase = 'GAME_OVER';
    newState.winner = newState.teamAScore.score > newState.teamBScore.score ? 'TEAM_A' : 'TEAM_B';
  } else {
    newState = setupSpades(newState);
  }

  return newState;
}
