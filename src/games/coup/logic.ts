import type { GameState, CoupRole, Player, Move, CoupActionType } from './types';

export const ROLES: CoupRole[] = ['DUKE', 'ASSASSIN', 'CAPTAIN', 'AMBASSADOR', 'CONTESSA'];

export function formatActionName(type: string): string {
  switch (type) {
    case 'INCOME': return 'Income';
    case 'FOREIGN_AID': return 'Foreign Aid';
    case 'TAX': return 'Tax';
    case 'ASSASSINATE': return 'Assassinate';
    case 'STEAL': return 'Steal';
    case 'EXCHANGE': return 'Exchange';
    case 'COUP': return 'Coup';
    case 'CHALLENGE': return 'Challenge';
    case 'PASS': return 'Pass';
    default: return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}

export function formatRoleName(role: string): string {
  switch (role) {
    case 'DUKE': return 'Duke';
    case 'ASSASSIN': return 'Assassin';
    case 'CAPTAIN': return 'Captain';
    case 'AMBASSADOR': return 'Ambassador';
    case 'CONTESSA': return 'Contessa';
    default: return role;
  }
}

export function createDeck(playerCount: number): CoupRole[] {
  const deck: CoupRole[] = [];
  // 3 players: 2 of each role (10 total)
  // 4 players: 3 of each role (15 total)
  // 5-6 players: 4 of each role (20 total) 
  let countPerRole = 3;
  if (playerCount <= 3) countPerRole = 2;
  else if (playerCount === 4) countPerRole = 3;
  else if (playerCount >= 5) countPerRole = 4;

  for (const role of ROLES) {
    for (let i = 0; i < countPerRole; i++) {
      deck.push(role);
    }
  }
  return shuffle(deck);
}

export function getRequiredRole(actionType: string): CoupRole | '' {
  switch (actionType) {
    case 'TAX': return 'DUKE';
    case 'ASSASSINATE': return 'ASSASSIN';
    case 'STEAL': return 'CAPTAIN';
    case 'EXCHANGE': return 'AMBASSADOR';
    default: return '';
  }
}

export function isBlockable(actionType: string): boolean {
  return ['FOREIGN_AID', 'STEAL', 'ASSASSINATE'].includes(actionType);
}

export function getBlockingRoles(actionType: string): CoupRole[] {
  switch (actionType) {
    case 'FOREIGN_AID': return ['DUKE'];
    case 'STEAL': return ['CAPTAIN', 'AMBASSADOR'];
    case 'ASSASSINATE': return ['CONTESSA'];
    default: return [];
  }
}

export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function setupCoup(gameState: GameState): GameState {
  const deck = createDeck(gameState.players.length);
  const players = gameState.players.map(p => ({
    ...p,
    coins: 2,
    influences: [
      { role: deck.pop()!, isRevealed: false },
      { role: deck.pop()!, isRevealed: false }
    ]
  }));

  return {
    ...gameState,
    phase: 'PLAYING',
    players,
    deck,
    activePlayerIndex: 0,
    pendingAction: null,
    moveLog: []
  };
}

export function getAlivePlayers(players: Player[]): Player[] {
  return players.filter(p => p.influences?.some(i => !i.isRevealed));
}

// Basic action processing (Income, Foreign Aid, Coup)
// Character actions (Tax, Assassinate, Steal, Exchange) will initially mark a 'pending' state
export function handleBasicAction(state: GameState, actorId: string, type: CoupActionType, targetId?: string): GameState {
  const actor = state.players.find(p => p.id === actorId);
  if (!actor) return state;

  let details = '';
  const success = true;
  const actionLabel = formatActionName(type);
  let coinsChange = 0;

  if (type === 'INCOME') {
    coinsChange = 1;
    details = `${actor.name} took ${actionLabel} (+1)`;
  } else if (type === 'COUP') {
    if (actor.coins < 7) return state;
    coinsChange = -7;
    details = `${actor.name} performed a ${actionLabel} on ${state.players.find(p => p.id === targetId)?.name}`;
  }

  const players = state.players.map(p => 
    p.id === actorId ? { ...p, coins: p.coins + coinsChange } : p
  );

  const move: Move = {
    type,
    timestamp: new Date().toISOString(),
    playerName: actor.name,
    details,
    success,
    targetId
  };

  let activePlayerIndex = state.activePlayerIndex;
  let phase = state.phase;
  let loserId = state.loserId;
  let resolution = state.resolution;

  if (type === 'INCOME') {
    activePlayerIndex = (activePlayerIndex + 1) % players.length;
    while (!players[activePlayerIndex].influences?.some(i => !i.isRevealed)) {
      activePlayerIndex = (activePlayerIndex + 1) % players.length;
    }
  } else if (type === 'COUP') {
    phase = 'SELECT_INFLUENCE_TO_LOSE';
    loserId = targetId;
    resolution = 'ACTION_COMPLETE';
  }

  return {
    ...state,
    players,
    lastMove: move,
    moveLog: [move, ...state.moveLog],
    activePlayerIndex,
    phase,
    loserId,
    resolution,
  };
}
