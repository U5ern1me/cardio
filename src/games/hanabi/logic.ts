import type { GameState, Card, HanabiColor, HanabiRank } from './types.js';

const COLORS: HanabiColor[] = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'WHITE'];

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  
  for (const color of COLORS) {
    if (color === 'HIDDEN') continue;
    
    // Three 1s
    deck.push({ id: generateId(), color, rank: 1 });
    deck.push({ id: generateId(), color, rank: 1 });
    deck.push({ id: generateId(), color, rank: 1 });
    
    // Two 2s, 3s, 4s
    for (const rank of [2, 3, 4] as HanabiRank[]) {
      deck.push({ id: generateId(), color, rank });
      deck.push({ id: generateId(), color, rank });
    }
    
    // One 5
    deck.push({ id: generateId(), color, rank: 5 });
  }
  
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

export function setupHanabi(state: GameState): GameState {
  const playerCount = state.players.length;
  if (playerCount < 2 || playerCount > 5) return state;

  const deck = createDeck();
  const handSize = playerCount === 2 || playerCount === 3 ? 5 : 4;

  const players = state.players.map(p => ({
    ...p,
    hand: deck.splice(0, handSize)
  }));

  return {
    ...state,
    players,
    deck,
    playArea: { RED: 0, BLUE: 0, GREEN: 0, YELLOW: 0, WHITE: 0 },
    discardPile: [],
    hintTokens: 8,
    mistakeTokens: 0,
    score: 0,
    turnsLeft: null,
    phase: 'PLAYING',
    activePlayerIndex: 0,
  };
}

function advanceTurn(state: GameState): GameState {
  const newState = { ...state };
  
  if (newState.turnsLeft !== null) {
    newState.turnsLeft -= 1;
    if (newState.turnsLeft <= 0) {
      newState.phase = 'GAME_OVER';
    }
  }

  // End conditions
  if (newState.mistakeTokens >= 3) {
    newState.phase = 'GAME_OVER';
  } else if (newState.score === 25) {
    newState.phase = 'GAME_OVER';
  }

  if (newState.phase !== 'GAME_OVER') {
    newState.activePlayerIndex = (newState.activePlayerIndex + 1) % newState.players.length;
  } else {
    newState.winner = newState.score >= 25 ? 'ALL' : 'NONE';
  }

  return newState;
}

function drawCard(state: GameState, playerId: string): GameState {
  if (state.deck.length === 0) return state;

  const players = state.players.map(p => {
    if (p.id === playerId) {
      return { ...p, hand: [...p.hand, state.deck[0]] };
    }
    return p;
  });

  const newDeck = state.deck.slice(1);
  let turnsLeft = state.turnsLeft;
  if (newDeck.length === 0 && turnsLeft === null) {
    turnsLeft = state.players.length;
  }

  return {
    ...state,
    players,
    deck: newDeck,
    turnsLeft
  };
}

export function playCard(state: GameState, playerId: string, cardIndex: number): { state?: GameState; error?: string } {
  const player = state.players.find(p => p.id === playerId);
  if (!player || cardIndex < 0 || cardIndex >= player.hand.length) return { error: 'Invalid card index' };

  const card = player.hand[cardIndex];
  const nextRank = (state.playArea[card.color as Exclude<HanabiColor, 'HIDDEN'>] as number) + 1;

  let newState = { ...state };
  const newHand = [...player.hand];
  newHand.splice(cardIndex, 1);

  newState.players = newState.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p);

  if (card.rank === nextRank) {
    newState.playArea = { ...newState.playArea, [card.color]: card.rank };
    newState.score += 1;
    if (card.rank === 5 && newState.hintTokens < 8) {
      newState.hintTokens += 1;
    }
  } else {
    newState.mistakeTokens += 1;
    newState.discardPile = [...newState.discardPile, card];
  }

  newState = drawCard(newState, playerId);
  return { state: advanceTurn(newState) };
}

export function discardCard(state: GameState, playerId: string, cardIndex: number): { state?: GameState; error?: string } {
  const player = state.players.find(p => p.id === playerId);
  if (!player || cardIndex < 0 || cardIndex >= player.hand.length) return { error: 'Invalid card index' };
  
  if (state.hintTokens >= 8) return { error: 'Cannot discard when hint tokens are full' };

  const card = player.hand[cardIndex];
  let newState = { ...state };
  const newHand = [...player.hand];
  newHand.splice(cardIndex, 1);

  newState.players = newState.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p);
  newState.discardPile = [...newState.discardPile, card];
  newState.hintTokens += 1;

  newState = drawCard(newState, playerId);
  return { state: advanceTurn(newState) };
}

export function giveHint(
  state: GameState,
  fromPlayerId: string,
  toPlayerId: string,
  hintType: 'COLOR' | 'RANK',
  hintValue: HanabiColor | HanabiRank
): { state?: GameState; error?: string } {
  const type = hintType.toUpperCase();
  if (state.hintTokens < 1) return { error: 'No hint tokens' };
  if (fromPlayerId === toPlayerId) return { error: 'Cannot hint yourself' };

  const targetPlayer = state.players.find(p => p.id === toPlayerId);
  if (!targetPlayer) return { error: 'Target not found' };

  let didHintApply = false;
  const newHand = targetPlayer.hand.map(card => {
    if (type === 'COLOR' && card.color === hintValue) {
      didHintApply = true;
      return { ...card, hintedColor: true };
    }
    if (type === 'RANK' && card.rank === hintValue) {
      didHintApply = true;
      return { ...card, hintedRank: true };
    }
    return card;
  });

  if (!didHintApply) {
    return { error: 'Hint must apply to at least one card' };
  }

  const newState = {
    ...state,
    hintTokens: state.hintTokens - 1,
    players: state.players.map(p => p.id === toPlayerId ? { ...p, hand: newHand } : p)
  };

  return { state: advanceTurn(newState) };
}
