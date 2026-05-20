import { describe, it, expect } from 'vitest';
import { setupHanabi, playCard, discardCard, giveHint } from './logic';
import type { GameState, Player } from './types';

function makePlayer(id: string, name: string): Player {
  return { id, name, hand: [], isConnected: true, seatIndex: 0, team: 'TEAM_A' };
}

function makeState(players: Player[]): GameState {
  return {
    sessionId: 'test',
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

describe('Hanabi Logic', () => {
  it('should setup the game correctly', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2')];
    const state = makeState(players);
    const setup = setupHanabi(state);

    expect(setup.phase).toBe('PLAYING');
    expect(setup.players[0].hand.length).toBe(5);
    expect(setup.hintTokens).toBe(8);
    expect(setup.mistakeTokens).toBe(0);
    expect(setup.deck.length).toBe(50 - 10); // 50 total - 5*2
  });

  it('should allow playing a valid card', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2')];
    const state = JSON.parse(JSON.stringify(setupHanabi(makeState(players))));
    
    // Force first card to be Red 1
    state.players[0].hand[0] = { id: 'test-card', color: 'RED', rank: 1 };
    
    const result = playCard(state, '1', 0); // Use index 0
    expect(result.error).toBeUndefined();
    expect(result.state?.playArea.RED).toBe(1);
    expect(result.state?.players[0].hand.length).toBe(5); // Drew a new one
  });

  it('should increment mistake token on invalid play', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2')];
    const state = JSON.parse(JSON.stringify(setupHanabi(makeState(players))));
    
    // Force first card to be Red 2 (Red 1 not played yet)
    state.players[0].hand[0] = { id: 'test-card', color: 'RED', rank: 2 };
    
    const result = playCard(state, '1', 0); // Use index 0
    expect(result.state?.mistakeTokens).toBe(1);
    expect(result.state?.discardPile).toContainEqual({ id: 'test-card', color: 'RED', rank: 2 });
  });

  it('should allow discarding a card to regain hint token', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2')];
    const state = JSON.parse(JSON.stringify(setupHanabi(makeState(players))));
    state.hintTokens = 5;
    
    const result = discardCard(state, '1', 0);
    expect(result.state?.hintTokens).toBe(6);
    expect(result.state?.discardPile.length).toBe(1);
  });

  it('should allow giving a hint', () => {
    const players = [makePlayer('1', 'P1'), makePlayer('2', 'P2')];
    const state = JSON.parse(JSON.stringify(setupHanabi(makeState(players))));
    
    // Force P2 hand
    state.players[1].hand = [
      { id: 'c1', color: 'RED', rank: 1 },
      { id: 'c2', color: 'BLUE', rank: 1 },
    ];
    
    const result = giveHint(state, '1', '2', 'COLOR', 'RED'); // Use uppercase
    expect(result.error).toBeUndefined();
    expect(result.state?.hintTokens).toBe(7);
    expect(result.state?.players[1].hand[0].hintedColor).toBe(true);
    expect(result.state?.players[1].hand[1].hintedColor).toBeUndefined();
  });
});
