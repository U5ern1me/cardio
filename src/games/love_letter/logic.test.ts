import { describe, it, expect } from 'vitest';
import { setupLoveLetter, playCard } from './logic';
import type { GameState, Player } from './types';

function makePlayer(id: string, name: string): Player {
  return { id, name, hand: [], isEliminated: false, tokens: 0, isConnected: true, seatIndex: 0, team: 'TEAM_A' };
}

function makeState(players: Player[]): GameState {
  return {
    sessionId: 'test',
    gameType: 'LOVE_LETTER',
    phase: 'LOBBY',
    players,
    activePlayerIndex: 0,
    deck: [],
    setAsideCard: null,
    discardPile: [],
    eliminatedThisRound: [],
    currentRound: 1,
    handmaidProtections: [],
    priestPeeks: [],
    lastMove: null,
    moveLog: [],
  };
}

describe('Love Letter Logic', () => {
  it('should setup the game correctly', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3')];
    const setup = setupLoveLetter(makeState(players));

    expect(setup.phase).toBe('PLAYING');
    expect(setup.players[0].hand.length).toBe(2); // Start of turn draw
    expect(setup.players[1].hand.length).toBe(1);
    expect(setup.setAsideCard).not.toBeNull();
  });

  it('should handle Guard correctly', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3')];
    const state = setupLoveLetter(makeState(players));
    
    // P1 plays Guard on P2, guessing Priest
    state.players[0].hand = [{ role: 'GUARD', value: 1 }, { role: 'KING', value: 6 }];
    state.players[1].hand = [{ role: 'PRIEST', value: 2 }];
    
    const result = playCard(state, '1', 'GUARD', '2', 'PRIEST');
    expect(result.state?.players[1].isEliminated).toBe(true);
  });

  it('should enforce Countess restriction', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3')];
    const state = setupLoveLetter(makeState(players));
    
    state.players[0].hand = [{ role: 'COUNTESS', value: 7 }, { role: 'KING', value: 6 }];
    
    const result = playCard(state, '1', 'KING', '2');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Countess');
  });

  it('should handle Handmaid protection', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3')];
    const state = setupLoveLetter(makeState(players));
    
    // P1 plays Handmaid
    state.players[0].hand = [{ role: 'HANDMAID', value: 4 }, { role: 'GUARD', value: 1 }];
    const res1 = playCard(state, '1', 'HANDMAID');
    const newState = res1.state!;
    expect(newState.handmaidProtections).toContain('1');
    
    // P2 tries to play Guard on P1
    newState.players[1].hand = [{ role: 'GUARD', value: 1 }, { role: 'KING', value: 6 }];
    const res2 = playCard(newState, '2', 'GUARD', '1', 'KING');
    expect(res2.state?.players[0].isEliminated).toBe(false); // Protected
  });

  it('should handle Princess elimination', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3')];
    const state = setupLoveLetter(makeState(players));
    
    state.players[0].hand = [{ role: 'PRINCESS', value: 8 }, { role: 'GUARD', value: 1 }];
    const result = playCard(state, '1', 'PRINCESS');
    expect(result.state?.players[0].isEliminated).toBe(true);
  });
});
