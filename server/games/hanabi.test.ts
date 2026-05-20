import { describe, it, expect } from 'vitest';
import { handleAction } from './hanabi';
import { setupHanabi } from '../../src/games/hanabi/logic';
import type { GameState, Player } from '../../src/games/hanabi/types';

function makePlayer(id: string, name: string): Player {
  return { id, name, hand: [], isConnected: true };
}

function makeLobbyState(players: Player[]): GameState {
  return {
    sessionId: 'TEST',
    gameType: 'HANABI',
    phase: 'LOBBY',
    players,
    activePlayerIndex: 0,
    deck: [],
    playArea: { RED: 0, BLUE: 0, GREEN: 0, YELLOW: 0, WHITE: 0 },
    discardPile: [],
    hintTokens: 8,
    mistakeTokens: 0,
    score: 0,
    lastMove: null,
    moveLog: [],
    turnsLeft: null,
  };
}

describe('Hanabi Server Handler Tests', () => {
  const P1 = makePlayer('p1', 'Alice');
  const P2 = makePlayer('p2', 'Bob');
  
  const broadcastMock = () => {};

  describe('START_GAME', () => {
    it('starts game with 2+ players', () => {
      const state = makeLobbyState([P1, P2]);
      const result = handleAction(state, { type: 'START_GAME' }, broadcastMock);
      expect(result.error).toBeUndefined();
      expect(result.state?.phase).toBe('PLAYING');
    });

    it('rejects start with less than 2 players', () => {
      const state = makeLobbyState([P1]);
      const result = handleAction(state, { type: 'START_GAME' });
      expect(result.error).toMatch(/Need 2-5 players/);
    });
  });

  describe('GAME_ACTION', () => {
    it('rejects action if not active player', () => {
      const state = setupHanabi(makeLobbyState([P1, P2]));
      state.activePlayerIndex = 1; // Bob's turn
      
      const result = handleAction(state, { type: 'DISCARD_CARD', actorId: 'p1', cardIndex: 0 });
      expect(result.error).toBe('Not your turn');
    });

    it('handles PLAY_CARD', () => {
      const state = JSON.parse(JSON.stringify(setupHanabi(makeLobbyState([P1, P2]))));
      state.players[0].hand[0] = { id: 'test', color: 'RED', rank: 1 };
      
      const result = handleAction(state, { type: 'PLAY_CARD', actorId: 'p1', cardIndex: 0 });
      expect(result.error).toBeUndefined();
      expect(result.state?.playArea.RED).toBe(1);
    });

    it('handles DISCARD', () => {
      const state = JSON.parse(JSON.stringify(setupHanabi(makeLobbyState([P1, P2]))));
      state.hintTokens = 5;
      
      const result = handleAction(state, { type: 'DISCARD_CARD', actorId: 'p1', cardIndex: 0 });
      expect(result.error).toBeUndefined();
      expect(result.state?.hintTokens).toBe(6);
    });

    it('handles HINT', () => {
      const state = JSON.parse(JSON.stringify(setupHanabi(makeLobbyState([P1, P2]))));
      // Force P2 hand to have a RED card
      state.players[1].hand[0] = { id: 'test-h', color: 'RED', rank: 1 };
      
      const result = handleAction(state, { 
        type: 'GIVE_HINT', 
        actorId: 'p1', 
        targetPlayerId: 'p2', 
        hintType: 'COLOR', 
        hintValue: 'RED' 
      });
      expect(result.error).toBeUndefined();
      expect(result.state?.hintTokens).toBe(7);
    });
  });
});
