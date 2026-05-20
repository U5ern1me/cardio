import type { GameState, Card, LoveLetterRole } from './types.js';

const CARD_DECK: Array<{ role: LoveLetterRole; value: number }> = [
  { role: 'GUARD', value: 1 },
  { role: 'GUARD', value: 1 },
  { role: 'GUARD', value: 1 },
  { role: 'GUARD', value: 1 },
  { role: 'GUARD', value: 1 },
  { role: 'PRIEST', value: 2 },
  { role: 'PRIEST', value: 2 },
  { role: 'BARON', value: 3 },
  { role: 'BARON', value: 3 },
  { role: 'HANDMAID', value: 4 },
  { role: 'HANDMAID', value: 4 },
  { role: 'PRINCE', value: 5 },
  { role: 'PRINCE', value: 5 },
  { role: 'KING', value: 6 },
  { role: 'COUNTESS', value: 7 },
  { role: 'PRINCESS', value: 8 },
];

export function createDeck(): Card[] {
  const deck = [...CARD_DECK];

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

export function setupLoveLetter(state: GameState): GameState {
  const playerCount = state.players.length;
  if (playerCount < 2 || playerCount > 4) {
    return state;
  }

  const deck = createDeck();
  const setAsideCard = deck.shift() || null;

  const players = state.players.map(p => ({
    ...p,
    hand: deck.splice(0, 1),
    isEliminated: false,
    tokens: p.tokens || 0
  }));

  // Active player draws a card to start the round
  const activeIndex = 0;
  players[activeIndex].hand.push(deck.shift()!);

  return {
    ...state,
    players,
    deck,
    setAsideCard,
    discardPile: [],
    eliminatedThisRound: [],
    currentRound: state.currentRound || 1,
    handmaidProtections: [],
    priestPeeks: [],
    phase: 'PLAYING',
    activePlayerIndex: activeIndex,
  };
}

function eliminatePlayer(state: GameState, playerId: string): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? { ...p, isEliminated: true } : p),
    eliminatedThisRound: [...state.eliminatedThisRound, playerId]
  };
}

export function playCard(
  state: GameState,
  playerId: string,
  cardRole: LoveLetterRole,
  targetId?: string,
  guessedRole?: LoveLetterRole
): { state?: GameState; error?: string } {
  let newState = { ...state };
  const player = newState.players.find(p => p.id === playerId);
  if (!player || player.isEliminated) return { error: 'Invalid player' };

  const handIndex = player.hand.findIndex(c => c.role === cardRole);
  if (handIndex === -1) return { error: 'Card not in hand' };


  // Countess restriction: If you have the Countess and the King or Prince, you must play the Countess.
  if (cardRole !== 'COUNTESS' && player.hand.some(c => c.role === 'COUNTESS') && (cardRole === 'KING' || cardRole === 'PRINCE')) {
    return { error: 'You must play the Countess if you hold the King or Prince.' };
  }

  const playedCard = player.hand[handIndex];
  const newHand = [...player.hand];
  newHand.splice(handIndex, 1);

  newState.discardPile = [...newState.discardPile, playedCard];
  newState.players = newState.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p);

  const target = targetId ? newState.players.find(p => p.id === targetId) : null;
  const isProtected = target && newState.handmaidProtections.includes(target.id);

  // Apply card effect
  if (cardRole === 'PRINCESS') {
    newState = eliminatePlayer(newState, playerId);
  } else if (cardRole === 'HANDMAID') {
    if (!newState.handmaidProtections.includes(playerId)) {
      newState.handmaidProtections = [...newState.handmaidProtections, playerId];
    }
  } else if (target && target.id === playerId && cardRole === 'PRINCE') {
    // Prince self
    const discardedCard = target.hand[0];
    if (discardedCard) {
      newState.discardPile = [...newState.discardPile, discardedCard];
      if (discardedCard.role === 'PRINCESS') {
        newState = eliminatePlayer(newState, playerId);
        newState.players = newState.players.map(p => p.id === playerId ? { ...p, hand: [] } : p);
      } else {
        const draw = newState.deck.length > 0 ? newState.deck[0] : newState.setAsideCard;
        const remainingDeck = newState.deck.length > 0 ? newState.deck.slice(1) : newState.deck;
        newState.deck = remainingDeck;
        newState.players = newState.players.map(p => p.id === playerId ? { ...p, hand: draw ? [draw] : [] } : p);
      }
    }
  } else if (target && !isProtected && !target.isEliminated) {
    if (cardRole === 'GUARD' && guessedRole) {
      if (target.hand[0]?.role === guessedRole) {
        newState = eliminatePlayer(newState, target.id);
      }
    } else if (cardRole === 'PRIEST') {
      if (target.hand[0]) {
        newState.priestPeeks = [
          ...newState.priestPeeks,
          { viewerId: playerId, targetId: target.id, cardRole: target.hand[0].role }
        ];
      }
    } else if (cardRole === 'BARON') {
      const playerValue = newState.players.find(p => p.id === playerId)?.hand[0]?.value || 0;
      const targetValue = target.hand[0]?.value || 0;
      if (playerValue > targetValue) {
        newState = eliminatePlayer(newState, target.id);
      } else if (targetValue > playerValue) {
        newState = eliminatePlayer(newState, playerId);
      }
    } else if (cardRole === 'PRINCE') {
      const discardedCard = target.hand[0];
      if (discardedCard) {
        newState.discardPile = [...newState.discardPile, discardedCard];
        if (discardedCard.role === 'PRINCESS') {
          newState = eliminatePlayer(newState, target.id);
          newState.players = newState.players.map(p => p.id === target.id ? { ...p, hand: [] } : p);
        } else {
          const draw = newState.deck.length > 0 ? newState.deck[0] : newState.setAsideCard;
          const remainingDeck = newState.deck.length > 0 ? newState.deck.slice(1) : newState.deck;
          newState.deck = remainingDeck;
          newState.players = newState.players.map(p => p.id === target.id ? { ...p, hand: draw ? [draw] : [] } : p);
        }
      }
    } else if (cardRole === 'KING') {
      const p1 = newState.players.find(p => p.id === playerId)!;
      const p2 = newState.players.find(p => p.id === target.id)!;
      newState.players = newState.players.map(p => {
        if (p.id === p1.id) return { ...p, hand: [...p2.hand] };
        if (p.id === p2.id) return { ...p, hand: [...p1.hand] };
        return p;
      });
    }
  }

  // End turn & advance phase
  return { state: advancePhase(newState) };
}

function checkRoundEnd(state: GameState): boolean {
  const activePlayers = state.players.filter(p => !p.isEliminated);
  if (activePlayers.length <= 1) return true;
  if (state.deck.length === 0) return true;
  return false;
}

export function advancePhase(state: GameState): GameState {
  if (checkRoundEnd(state)) {
    return endRound(state);
  }

  const newState = { ...state };
  let nextIndex = (newState.activePlayerIndex + 1) % newState.players.length;
  while (newState.players[nextIndex].isEliminated) {
    nextIndex = (nextIndex + 1) % newState.players.length;
  }
  
  newState.activePlayerIndex = nextIndex;
  const nextPlayerId = newState.players[nextIndex].id;

  // Remove handmaid protection for next player
  newState.handmaidProtections = newState.handmaidProtections.filter(id => id !== nextPlayerId);

  // Next player draws
  const draw = newState.deck[0];
  if (draw) {
    newState.deck = newState.deck.slice(1);
    newState.players = newState.players.map(p => p.id === nextPlayerId ? { ...p, hand: [...p.hand, draw] } : p);
  }

  return newState;
}

function endRound(state: GameState): GameState {
  let newState = { ...state };
  const activePlayers = newState.players.filter(p => !p.isEliminated);
  let roundWinnerId = activePlayers[0]?.id;

  if (activePlayers.length > 1) {
    // Highest card wins
    let highestValue = -1;
    for (const p of activePlayers) {
      const val = p.hand[0]?.value || 0;
      if (val > highestValue) {
        highestValue = val;
        roundWinnerId = p.id;
      }
    }
  }

  if (roundWinnerId) {
    newState.players = newState.players.map(p => p.id === roundWinnerId ? { ...p, tokens: p.tokens + 1 } : p);
  }

  const playerCount = newState.players.length;
  const tokensNeeded = playerCount === 2 ? 7 : playerCount === 3 ? 5 : 4;
  const winner = newState.players.find(p => p.tokens >= tokensNeeded);

  if (winner) {
    newState.phase = 'GAME_OVER';
    newState.winner = winner.id;
  } else {
    newState = setupLoveLetter({ ...newState, currentRound: newState.currentRound + 1 });
  }

  return newState;
}
