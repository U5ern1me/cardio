import { describe, it, expect } from 'vitest';
import { handleAction } from './secretHitler';
import { setupSecretHitler } from '../../src/games/secretHitler/logic';
import type { SecretHitlerState, SecretHitlerPlayer } from '../../src/games/secretHitler/types';

function makePlayer(id: string, name: string): SecretHitlerPlayer {
  return { id, name, isAlive: true, role: 'LIBERAL', partyMembership: 'LIBERAL', isConnected: true };
}

function makeLobbyState(players: SecretHitlerPlayer[]): SecretHitlerState {
  return {
    sessionId: 'TEST',
    gameType: 'SECRET_HITLER',
    phase: 'LOBBY',
    players,
    drawPile: [],
    discardPile: [],
    liberalPolicies: 0,
    fascistPolicies: 0,
    electionTracker: 0,
    presidentId: null,
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
    moveLog: [],
    lastMove: null,
  };
}

describe('Secret Hitler Server Handler Tests', () => {
  const players = [
    makePlayer('p1', 'Alice'),
    makePlayer('p2', 'Bob'),
    makePlayer('p3', 'Carol'),
    makePlayer('p4', 'Dave'),
    makePlayer('p5', 'Eve'),
  ];

  describe('START_GAME', () => {
    it('starts game with enough players', () => {
      const state = makeLobbyState(players);
      const result = handleAction(state, { type: 'START_GAME', actorId: 'p1' });
      expect(result.error).toBeUndefined();
      expect(result.state?.phase).toBe('NOMINATE_CHANCELLOR');
    });
  });

  describe('NOMINATE_CHANCELLOR', () => {
    it('transitions to VOTING', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      const result = handleAction(state, { type: 'SECRET_HITLER_ACTION', action: 'NOMINATE_CHANCELLOR', actorId: 'p1', targetId: 'p2' });
      expect(result.error).toBeUndefined();
      expect(result.state?.phase).toBe('VOTING');
      expect(result.state?.nominatedChancellorId).toBe('p2');
    });
  });

  describe('CAST_VOTE', () => {
    it('processes votes and transitions correctly on pass', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      state.phase = 'VOTING';
      state.nominatedChancellorId = 'p2';
      
      let res = handleAction(state, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p1', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p2', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p3', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p4', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p5', vote: 'NEIN' });
      
      expect(res.error).toBeUndefined();
      expect(res.state?.phase).toBe('LEGISLATIVE_PRESIDENT');
      expect(res.state?.presidentCards).toHaveLength(3);
    });

    it('handles Hitler elected as Chancellor (Fascist Win)', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      state.phase = 'VOTING';
      state.nominatedChancellorId = 'p3';
      state.fascistPolicies = 3;
      
      // Force p3 to be Hitler
      state.players[2].role = 'HITLER';

      let res = handleAction(state, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p1', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p2', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p3', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p4', vote: 'JA' });
      res = handleAction(res.state!, { type: 'SECRET_HITLER_ACTION', action: 'CAST_VOTE', actorId: 'p5', vote: 'JA' });

      expect(res.state?.phase).toBe('GAME_OVER');
      expect(res.state?.winner).toBe('FASCIST');
      expect(res.state?.winnerReason).toMatch(/Hitler was elected chancellor/);
    });
  });

  describe('EXECUTIVE ACTIONS', () => {
    it('handles POLICY_PEEK', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      state.phase = 'EXECUTIVE_ACTION';
      state.executiveAction = 'POLICY_PEEK';
      state.presidentId = 'p1';
      state.drawPile = ['LIBERAL', 'FASCIST', 'FASCIST'];
      state.policyPeek = ['LIBERAL', 'FASCIST', 'FASCIST'];

      const res = handleAction(state, { type: 'SECRET_HITLER_ACTION', action: 'PRESIDENT_EXECUTIVE_ACTION', actorId: 'p1' });
      expect(res.state?.phase).toBe('NOMINATE_CHANCELLOR');
      expect(res.state?.executiveAction).toBeNull();
      expect(res.state?.policyPeek).toBeNull();
    });

    it('handles INVESTIGATE', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      state.phase = 'EXECUTIVE_ACTION';
      state.executiveAction = 'INVESTIGATE';
      state.presidentId = 'p1';
      state.players[1].partyMembership = 'FASCIST'; // Bob is fascist
      
      const res = handleAction(state, { 
        type: 'SECRET_HITLER_ACTION', 
        action: 'PRESIDENT_EXECUTIVE_ACTION', 
        actorId: 'p1',
        targetId: 'p2'
      });
      
      expect(res.state?.phase).toBe('NOMINATE_CHANCELLOR');
      expect(res.state?.executiveAction).toBeNull();
      
      const investigateResults = res.state!.investigateResults;
      expect(investigateResults['p1']?.targetName).toBe('Bob');
      expect(investigateResults['p1']?.party).toBe('FASCIST');
    });

    it('handles EXECUTION (Liberal dies)', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      state.phase = 'EXECUTIVE_ACTION';
      state.executiveAction = 'EXECUTE';
      state.presidentId = 'p1';
      state.players[1].role = 'LIBERAL';
      
      const res = handleAction(state, { 
        type: 'SECRET_HITLER_ACTION', 
        action: 'PRESIDENT_EXECUTIVE_ACTION', 
        actorId: 'p1',
        targetId: 'p2'
      });
      
      expect(res.state?.phase).toBe('NOMINATE_CHANCELLOR');
      expect(res.state?.executiveAction).toBeNull();
      expect(res.state?.players[1].isAlive).toBe(false);
    });

    it('handles EXECUTION (Hitler dies - Liberal Win)', () => {
      const state = setupSecretHitler(makeLobbyState(players));
      state.phase = 'EXECUTIVE_ACTION';
      state.executiveAction = 'EXECUTE';
      state.presidentId = 'p1';
      state.players[1].role = 'HITLER';
      
      const res = handleAction(state, { 
        type: 'SECRET_HITLER_ACTION', 
        action: 'PRESIDENT_EXECUTIVE_ACTION', 
        actorId: 'p1',
        targetId: 'p2'
      });
      
      expect(res.state?.phase).toBe('GAME_OVER');
      expect(res.state?.winner).toBe('LIBERAL');
      expect(res.state?.winnerReason).toMatch(/Hitler was executed/);
      expect(res.state?.players[1].isAlive).toBe(false);
    });
  });
});
