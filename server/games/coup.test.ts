import { describe, it, expect } from 'vitest';
import { handleAction } from './coup';
import { setupCoup } from '../../src/games/coup/logic';
import type { GameState, Player } from '../../src/games/coup/types';

function makePlayer(id: string, name: string): Player {
  return { id, name, coins: 0, influences: [], isConnected: true };
}

function makeLobbyState(players: Player[]): GameState {
  return {
    sessionId: 'TEST',
    gameType: 'COUP',
    phase: 'LOBBY',
    players,
    activePlayerIndex: 0,
    deck: [],
    moveLog: [],
    lastMove: null,
    pendingAction: null,
  };
}

describe('Coup Server Handler Tests', () => {
  const P1 = makePlayer('p1', 'Alice');
  const P2 = makePlayer('p2', 'Bob');
  const P3 = makePlayer('p3', 'Carol');

  const broadcastMock = () => {};

  describe('START_GAME', () => {
    it('starts game with 3+ players', () => {
      const state = makeLobbyState([P1, P2, P3]);
      const result = handleAction(state, { type: 'START_GAME' }, broadcastMock);
      expect(result.error).toBeUndefined();
      expect(result.state.phase).toBe('PLAYING');
    });
  });

  describe('COUP_ACTION - INCOME', () => {
    it('handles income action', () => {
      const state = setupCoup(makeLobbyState([P1, P2, P3]));
      const result = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'INCOME' }, broadcastMock);
      expect(result.state.players[0].coins).toBe(3);
    });
  });

  describe('COUP_ACTION - Character Actions', () => {
    it('transitions to WAITING_FOR_CHALLENGE on TAX', () => {
      const state = setupCoup(makeLobbyState([P1, P2, P3]));
      const result = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'TAX' }, broadcastMock);
      expect(result.state.phase).toBe('WAITING_FOR_CHALLENGE');
      expect(result.state.pendingAction.type).toBe('TAX');
    });
    
    it('transitions to WAITING_FOR_BLOCK on FOREIGN_AID', () => {
      const state = setupCoup(makeLobbyState([P1, P2, P3]));
      const result = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'FOREIGN_AID' }, broadcastMock);
      expect(result.state.phase).toBe('WAITING_FOR_BLOCK');
    });
  });

  describe('Coup Chain Interactions', () => {
    it('handles Steal -> Pass -> Block -> Challenge Block (Success/Bluff) -> Influence Loss -> Resolution correctly', () => {
      let state = JSON.parse(JSON.stringify(setupCoup(makeLobbyState([P1, P2, P3]))));
      
      // Hardcode roles for deterministic outcomes
      state.players[0].influences[0].role = 'CAPTAIN';
      state.players[1].influences[0].role = 'DUKE'; // Bob cannot block truthfully
      state.players[1].influences[1].role = 'CONTESSA';
      state.players[1].coins = 5;
      state.players[0].coins = 0;
      state.activePlayerIndex = 0;

      // 1. Alice steals from Bob
      let res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'STEAL', targetId: 'p2' }, broadcastMock);
      state = res.state;
      expect(state.phase).toBe('WAITING_FOR_CHALLENGE');

      // 2. Everyone passes the initial Steal challenge
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p2', actionType: 'PASS' }, broadcastMock);
      res = handleAction(res.state, { type: 'COUP_ACTION', actorId: 'p3', actionType: 'PASS' }, broadcastMock);
      state = res.state;
      expect(state.phase).toBe('WAITING_FOR_BLOCK');

      // 3. Bob blocks with Captain (Bluffing)
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p2', actionType: 'BLOCK', roleClaimed: 'CAPTAIN' }, broadcastMock);
      state = res.state;
      expect(state.phase).toBe('WAITING_FOR_BLOCK_CHALLENGE');

      // 4. Alice challenges Bob's block
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'CHALLENGE' }, broadcastMock);
      state = res.state;
      
      // Bob doesn't have Captain, so Bob loses influence. Block fails.
      expect(state.phase).toBe('SELECT_INFLUENCE_TO_LOSE');
      expect(state.loserId).toBe('p2');
      expect(state.resolution).toBe('BLOCK_CHALLENGE_SUCCESSFUL');

      // 5. Bob selects an influence to lose
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p2', actionType: 'LOSE_INFLUENCE', influenceIndex: 0 }, broadcastMock);
      state = res.state;

      // Steal resolves: Alice gets 2 coins, Bob loses 2 coins.
      expect(state.phase).toBe('PLAYING');
      expect(state.players[0].coins).toBe(2);
      expect(state.players[1].coins).toBe(3);
      expect(state.players[1].influences[0].isRevealed).toBe(true);
      expect(state.activePlayerIndex).toBe(1);
    });

    it('handles Steal -> Pass -> Block -> Challenge Block (Fail/Truthful) -> Influence Loss -> Blocked correctly', () => {
      let state = JSON.parse(JSON.stringify(setupCoup(makeLobbyState([P1, P2, P3]))));
      
      // Hardcode roles
      state.players[0].influences[0].role = 'CAPTAIN';
      state.players[1].influences[0].role = 'CAPTAIN'; // Bob CAN block truthfully
      state.players[1].influences[1].role = 'CONTESSA';
      state.players[1].coins = 5;
      state.players[0].coins = 0;
      state.activePlayerIndex = 0;

      // 1. Alice steals from Bob
      let res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'STEAL', targetId: 'p2' }, broadcastMock);
      state = res.state;

      // 2. Everyone passes
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p2', actionType: 'PASS' }, broadcastMock);
      res = handleAction(res.state, { type: 'COUP_ACTION', actorId: 'p3', actionType: 'PASS' }, broadcastMock);
      state = res.state;

      // 3. Bob blocks with Captain (Truthful)
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p2', actionType: 'BLOCK', roleClaimed: 'CAPTAIN' }, broadcastMock);
      state = res.state;

      // 4. Alice challenges Bob's block
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'CHALLENGE' }, broadcastMock);
      state = res.state;
      
      // Bob HAS Captain, so Alice loses influence. Block succeeds.
      expect(state.phase).toBe('SELECT_INFLUENCE_TO_LOSE');
      expect(state.loserId).toBe('p1');
      expect(state.resolution).toBe('BLOCK_CHALLENGE_FAILED');

      // 5. Alice selects an influence to lose
      res = handleAction(state, { type: 'COUP_ACTION', actorId: 'p1', actionType: 'LOSE_INFLUENCE', influenceIndex: 0 }, broadcastMock);
      state = res.state;

      // Steal blocked: Alice gets 0 coins, Bob loses 0 coins. Turn ends.
      expect(state.phase).toBe('PLAYING');
      expect(state.players[0].coins).toBe(0);
      expect(state.players[1].coins).toBe(5);
      expect(state.players[0].influences[0].isRevealed).toBe(true);
      expect(state.activePlayerIndex).toBe(1);
    });
  });
});
