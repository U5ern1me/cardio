import type {
  ExecutiveActionType,
  Policy,
  SecretHitlerPlayer,
  SecretHitlerState,
  SecretRole,
  Vote,
} from './types';

const ROLE_SETUP: Record<number, { liberals: number; fascists: number }> = {
  1: { liberals: 0, fascists: 0 },
  2: { liberals: 1, fascists: 0 },
  3: { liberals: 1, fascists: 1 },
  4: { liberals: 2, fascists: 1 },
  5: { liberals: 3, fascists: 1 },
  6: { liberals: 4, fascists: 1 },
  7: { liberals: 4, fascists: 2 },
  8: { liberals: 5, fascists: 2 },
  9: { liberals: 5, fascists: 3 },
  10: { liberals: 6, fascists: 3 },
};

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function getAlivePlayers(state: SecretHitlerState): SecretHitlerPlayer[] {
  return state.players.filter((p) => p.isAlive);
}

function getPlayerIndex(players: SecretHitlerPlayer[], playerId: string): number {
  return players.findIndex((p) => p.id === playerId);
}

function buildPolicyDeck(): Policy[] {
  return shuffle([...Array(6).fill('LIBERAL'), ...Array(11).fill('FASCIST')] as Policy[]);
}

export function ensureDeck(state: SecretHitlerState): SecretHitlerState {
  if (state.drawPile.length >= 3) return state;
  return {
    ...state,
    drawPile: shuffle([...state.drawPile, ...state.discardPile]),
    discardPile: [],
  };
}

function nextAlivePresidentId(state: SecretHitlerState, startIndex: number): string {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const idx = (startIndex + offset) % state.players.length;
    if (state.players[idx].isAlive) return state.players[idx].id;
  }
  return state.players[startIndex]?.id ?? '';
}

function executiveActionFor(state: SecretHitlerState): ExecutiveActionType | null {
  const p = state.players.length;
  const f = state.fascistPolicies;
  if (f < 1 || f > 5) return null;
  if (p <= 6) {
    if (f === 3) return 'POLICY_PEEK';
    if (f >= 4) return 'EXECUTE';
    return null;
  }
  if (p <= 8) {
    if (f === 2) return 'INVESTIGATE';
    if (f === 3) return 'SPECIAL_ELECTION';
    if (f >= 4) return 'EXECUTE';
    return null;
  }
  if (f <= 2) return 'INVESTIGATE';
  if (f === 3) return 'SPECIAL_ELECTION';
  return 'EXECUTE';
}

export function setupSecretHitler(state: SecretHitlerState): SecretHitlerState {
  const count = state.players.length;
  const setup = ROLE_SETUP[count];
  if (!setup) return state;

  const roles = shuffle([
    ...Array(setup.liberals).fill('LIBERAL'),
    ...Array(setup.fascists).fill('FASCIST'),
    'HITLER',
  ] as SecretRole[]);

  const players = state.players.map((player, i) => {
    const role = roles[i];
    const partyMembership: 'LIBERAL' | 'FASCIST' = role === 'LIBERAL' ? 'LIBERAL' : 'FASCIST';
    return {
      ...player,
      isAlive: true,
      role,
      partyMembership,
    };
  });

  const firstPresidentId = players[0]?.id ?? null;

  return {
    ...state,
    players,
    phase: 'NOMINATE_CHANCELLOR',
    drawPile: buildPolicyDeck(),
    discardPile: [],
    electionTracker: 0,
    liberalPolicies: 0,
    fascistPolicies: 0,
    presidentId: firstPresidentId,
    nominatedChancellorId: null,
    chancellorId: null,
    previousPresidentId: null,
    previousChancellorId: null,
    presidentCards: [],
    chancellorCards: [],
    vetoRequested: false,
    votes: {},
    executiveAction: null,
    policyPeek: null,
    specialElectionReturnIndex: null,
    winner: undefined,
    winnerReason: undefined,
    moveLog: [],
    lastMove: null,
  };
}

export function canNominateChancellor(state: SecretHitlerState, presidentId: string, targetId: string): string | null {
  if (state.phase !== 'NOMINATE_CHANCELLOR') return 'Not nomination phase.';
  if (state.presidentId !== presidentId) return 'Only the current president can nominate.';
  if (presidentId === targetId && state.players.length > 1) return 'President cannot nominate themselves.';
  const target = state.players.find((p) => p.id === targetId);
  if (!target || !target.isAlive) return 'Target must be alive.';
  if (state.previousChancellorId === targetId) return 'Cannot nominate previous chancellor.';
  if (state.players.length > 5 && state.previousPresidentId === targetId) {
    return 'Cannot nominate previous president in games with more than 5 players.';
  }
  return null;
}

export function countJa(votes: Record<string, Vote>): number {
  return Object.values(votes).filter((v) => v === 'JA').length;
}

export function passPresident(state: SecretHitlerState): SecretHitlerState {
  const currentIndex = state.presidentId ? getPlayerIndex(state.players, state.presidentId) : 0;
  const nextPresidentId = nextAlivePresidentId(state, currentIndex);
  return {
    ...state,
    presidentId: nextPresidentId,
    nominatedChancellorId: null,
    chancellorId: null,
    votes: {},
    phase: 'NOMINATE_CHANCELLOR',
  };
}

export function topDeckChaosPolicy(state: SecretHitlerState): SecretHitlerState {
  let next = ensureDeck(state);
  const [policy, ...rest] = next.drawPile;
  if (!policy) return next;
  const move = {
    type: 'POLICY_ENACTED',
    timestamp: new Date().toISOString(),
    playerName: 'Table',
    details: `Election tracker reached 3. Chaos policy enacted: ${policy}.`,
    success: true,
  } as const;
  next = {
    ...next,
    drawPile: rest,
    electionTracker: 0,
    nominatedChancellorId: null,
    chancellorId: null,
    vetoRequested: false,
    votes: {},
    lastMove: move,
  };
  next.moveLog = [move, ...next.moveLog];
  return enactPolicy(next, policy, true);
}

export function enactPolicy(state: SecretHitlerState, policy: Policy, isChaos = false): SecretHitlerState {
  const next: SecretHitlerState = {
    ...state,
    presidentCards: [],
    chancellorCards: [],
    vetoRequested: false,
    policyPeek: null,
  };

  if (policy === 'LIBERAL') next.liberalPolicies += 1;
  else next.fascistPolicies += 1;

  if (!isChaos && next.nominatedChancellorId) {
    next.previousPresidentId = next.presidentId;
    next.previousChancellorId = next.nominatedChancellorId;
    next.chancellorId = next.nominatedChancellorId;
  }

  const move = {
    type: 'POLICY_ENACTED',
    timestamp: new Date().toISOString(),
    playerName: 'Government',
    details: `${policy} policy enacted.`,
    success: true,
  } as const;
  next.lastMove = move;
  next.moveLog = [move, ...next.moveLog];

  if (next.liberalPolicies >= 5) {
    next.phase = 'GAME_OVER';
    next.winner = 'LIBERAL';
    next.winnerReason = 'Five liberal policies enacted.';
    return next;
  }

  if (next.fascistPolicies >= 6) {
    next.phase = 'GAME_OVER';
    next.winner = 'FASCIST';
    next.winnerReason = 'Six fascist policies enacted.';
    return next;
  }

  if (policy === 'FASCIST' && !isChaos) {
    const action = executiveActionFor(next);
    if (action) {
      next.phase = 'EXECUTIVE_ACTION';
      next.executiveAction = action;
      if (action === 'POLICY_PEEK') {
        next.policyPeek = next.drawPile.slice(0, 3);
      }
      return next;
    }
  }

  next.executiveAction = null;
  return moveToNextGovernment(next);
}

export function moveToNextGovernment(state: SecretHitlerState): SecretHitlerState {
  const next = {
    ...state,
    nominatedChancellorId: null,
    chancellorId: null,
    votes: {},
    executiveAction: null,
    vetoRequested: false,
  };
  if (next.specialElectionReturnIndex !== null) {
    next.presidentId = nextAlivePresidentId(next, next.specialElectionReturnIndex);
    next.specialElectionReturnIndex = null;
    next.phase = 'NOMINATE_CHANCELLOR';
    return next;
  }
  const currentIdx = next.presidentId ? getPlayerIndex(next.players, next.presidentId) : 0;
  next.presidentId = nextAlivePresidentId(next, currentIdx);
  next.phase = 'NOMINATE_CHANCELLOR';
  return next;
}

export function hitlerElectedAsChancellor(state: SecretHitlerState): boolean {
  if (state.fascistPolicies < 3 || !state.nominatedChancellorId) return false;
  const player = state.players.find((p) => p.id === state.nominatedChancellorId);
  return player?.role === 'HITLER';
}

export function getAliveCount(state: SecretHitlerState): number {
  return getAlivePlayers(state).length;
}

export function handleInvestigate(state: SecretHitlerState, presidentId: string, targetId: string): { state: SecretHitlerState, error?: string } {
  const target = state.players.find((p) => p.id === targetId);
  const party = target?.partyMembership;
  if (!target || !party) return { state, error: 'Target does not have a valid membership card.' };
  return {
    state: moveToNextGovernment({
      ...state,
      executiveAction: null,
      investigateResults: {
        ...state.investigateResults,
        [presidentId]: { targetName: target.name, party },
      },
    }),
  };
}

export function handleSpecialElection(state: SecretHitlerState, targetId: string): SecretHitlerState {
  const currentPresidentIndex = state.presidentId
    ? getPlayerIndex(state.players, state.presidentId)
    : 0;
  return {
    ...state,
    executiveAction: null,
    presidentId: targetId,
    nominatedChancellorId: null,
    votes: {},
    phase: 'NOMINATE_CHANCELLOR',
    specialElectionReturnIndex: currentPresidentIndex,
  };
}

export function handleExecute(state: SecretHitlerState, targetId: string): SecretHitlerState {
  const players = state.players.map((p) => (p.id === targetId ? { ...p, isAlive: false } : p));
  const target = players.find((p) => p.id === targetId);
  if (target?.role === 'HITLER') {
    return {
      ...state,
      players,
      phase: 'GAME_OVER',
      winner: 'LIBERAL',
      winnerReason: 'Hitler was executed.',
      executiveAction: null,
    };
  }
  return moveToNextGovernment({
    ...state,
    players,
    executiveAction: null,
  });
}
