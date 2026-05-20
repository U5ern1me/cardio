import { describe, it, expect } from 'vitest';
import { setupSpades, placeBid, playCard } from './logic';
import type { GameState, Player } from './types';

function makePlayer(id: string, name: string): Player {
  return { id, name, hand: [], bid: null, tricksTaken: 0, bags: 0, isConnected: true, team: 'TEAM_A', seatIndex: 0 };
}

function makeState(players: Player[]): GameState {
  return {
    sessionId: 'test',
    gameType: 'SPADES',
    phase: 'LOBBY',
    players,
    activePlayerIndex: 0,
    deck: [],
    currentTrick: { leadSuit: 'SPADE', cards: [] },
    trickHistory: [],
    teamAScore: { tricks: 0, bags: 0, score: 0 },
    teamBScore: { tricks: 0, bags: 0, score: 0 },
    allPlayersBid: false,
    spadesBroken: false,
    lastMove: null,
    moveLog: [],
  };
}

describe('Spades Logic', () => {
  it('should setup the game correctly with teams', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3'), makePlayer('4', 'P4')];
    const setup = setupSpades(makeState(players));

    expect(setup.players[0].team).toBe('TEAM_A');
    expect(setup.players[1].team).toBe('TEAM_B');
    expect(setup.players[2].team).toBe('TEAM_A');
    expect(setup.players[3].team).toBe('TEAM_B');
    expect(setup.players[0].hand.length).toBe(13);
  });

  it('should move to playing phase after all bids', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3'), makePlayer('4', 'P4')];
    let state = setupSpades(makeState(players));
    
    state = placeBid(state, '1', 3).state!;
    state = placeBid(state, '2', 2).state!;
    state = placeBid(state, '3', 4).state!;
    state = placeBid(state, '4', 1).state!;
    
    expect(state.allPlayersBid).toBe(true);
    expect(state.phase).toBe('PLAYING');
  });

  it('should enforce follow suit', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3'), makePlayer('4', 'P4')];
    const state = setupSpades(makeState(players));
    state.phase = 'PLAYING';
    state.currentTrick = { leadSuit: 'HEART', cards: [{ playerId: '1', card: { suit: 'HEART', rank: 'A' } }] };
    
    // P2 has hearts but tries to play spade
    state.players[1].hand = [{ suit: 'SPADE', rank: '2' }, { suit: 'HEART', rank: '2' }];
    const result = playCard(state, '2', { suit: 'SPADE', rank: '2' });
    expect(result.error).toContain('follow lead suit');
  });

  it('should resolve trick correctly', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3'), makePlayer('4', 'P4')];
    const state = setupSpades(makeState(players));
    state.phase = 'PLAYING';
    state.spadesBroken = false;
    state.currentTrick = { 
      leadSuit: 'HEART', 
      cards: [
        { playerId: '1', card: { suit: 'HEART', rank: '10' } },
        { playerId: '2', card: { suit: 'HEART', rank: 'K' } },
        { playerId: '3', card: { suit: 'HEART', rank: '2' } }
      ] 
    };
    
    // P4 void in hearts, plays spade
    state.players[3].hand = [{ suit: 'SPADE', rank: '2' }];
    const result = playCard(state, '4', { suit: 'SPADE', rank: '2' });
    
    expect(result.error).toBeUndefined();
    const newState = result.state!;
    expect(newState.players[3].tricksTaken).toBe(1);
    expect(newState.spadesBroken).toBe(true);
  });

  it('should let highest spade win', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2'), makePlayer('3', 'P3'), makePlayer('4', 'P4')];
    const state = setupSpades(makeState(players));
    state.phase = 'PLAYING';
    state.currentTrick = { 
      leadSuit: 'HEART', 
      cards: [
        { playerId: '1', card: { suit: 'HEART', rank: '10' } },
        { playerId: '2', card: { suit: 'SPADE', rank: '2' } },
        { playerId: '3', card: { suit: 'SPADE', rank: '10' } }
      ] 
    };
    
    state.players[3].hand = [{ suit: 'HEART', rank: 'A' }]; // P4 follows suit but loses to spades
    const result = playCard(state, '4', { suit: 'HEART', rank: 'A' });
    
    expect(result.state?.players[2].tricksTaken).toBe(1); // P3 wins with Spade 10
  });
});
