import { describe, it, expect } from 'vitest';
import { handleAction } from './love_letter';
import { setupLoveLetter } from '../../src/games/love_letter/logic';
import type { GameState, Player } from '../../src/games/love_letter/types';

function makePlayer(id: string, name: string): Player {
  return { id, name, hand: [], isEliminated: false, isProtected: false, tokens: 0, isConnected: true };
}

function makeLobbyState(players: Player[]): GameState {
  return {
    sessionId: 'TEST',
    gameType: 'LOVE_LETTER',
    phase: 'LOBBY',
    players,
    activePlayerIndex: 0,
    deck: [],
    discardPile: [],
    removedCard: null,
    moveLog: [],
    lastMove: null,
    winner: undefined,
  };
}

describe('Love Letter Server Handler Tests', () => {
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
      expect(result.error).toMatch(/Need 2-4 players/);
    });
  });

  describe('GAME_ACTION', () => {
    it('rejects action if not active player', () => {
      const state = setupLoveLetter(makeLobbyState([P1, P2]));
      state.activePlayerIndex = 1; // Bob's turn
      
      const result = handleAction(state, { type: 'PLAY_CARD', actorId: 'p1', cardRole: 'GUARD', targetPlayerId: 'p2', guessedRole: 'PRIEST' });
      expect(result.error).toBe('Not your turn');
    });

    it('rejects PRINCE action if no target is provided', () => {
      const state = setupLoveLetter(makeLobbyState([P1, P2]));
      state.activePlayerIndex = 0;
      
      const result = handleAction(state, { type: 'PLAY_CARD', actorId: 'p1', cardRole: 'PRINCE' });
      expect(result.error).toBe('Prince must target a player');
    });

    it('handles playing a card', () => {
      const state = JSON.parse(JSON.stringify(setupLoveLetter(makeLobbyState([P1, P2]))));
      state.deck = [{ role: 'GUARD', value: 1 }, { role: 'GUARD', value: 1 }]; // Ensure deck not empty
      state.players[0].hand = [{ role: 'GUARD', value: 1 }, { role: 'PRIEST', value: 2 }];
      state.players[1].hand = [{ role: 'BARON', value: 3 }]; // Ensure they don't have a PRIEST
      
      const result = handleAction(state, { 
        type: 'PLAY_CARD', 
        actorId: 'p1', 
        cardRole: 'GUARD',
        targetPlayerId: 'p2',
        guessedRole: 'PRIEST'
      });
      
      expect(result.error).toBeUndefined();
      expect(result.state?.phase).toBe('PLAYING');
      expect(result.state?.activePlayerIndex).toBe(1);
    });
  });
});
