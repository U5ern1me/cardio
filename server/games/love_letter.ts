import * as LoveLetterLogic from '../../src/games/love_letter/logic.js';

import type { GameState, LoveLetterRole, Player } from '../../src/games/love_letter/types.js';

interface ActionData {
  type: string;
  actorId?: string;
  test?: boolean;
  cardRole?: LoveLetterRole;
  targetPlayerId?: string;
  guessedRole?: LoveLetterRole;
}

interface ActionResult {
  state?: GameState;
  error?: string;
}

export function handleAction(state: GameState, data: ActionData): ActionResult {
  const { actorId } = data;
  const actor = state.players.find((p: Player) => p.id === actorId);

  switch (data.type) {
    case 'START_GAME': {
      if (!data.test && (state.players.length < 2 || state.players.length > 4)) {
        return { error: `Need 2-4 players to start Love Letter (${state.players.length} present)` };
      }
      return { state: LoveLetterLogic.setupLoveLetter(state) };
    }

    case 'PLAY_CARD': {
      if (!actor || state.activePlayerIndex !== state.players.indexOf(actor)) {
        return { error: 'Not your turn' };
      }

      if (data.cardRole === 'PRINCE' && !data.targetPlayerId) {
        return { error: 'Prince must target a player' };
      }

      const result = LoveLetterLogic.playCard(
        state,
        actorId,
        data.cardRole,
        data.targetPlayerId,
        data.guessedRole
      );

      if (result.error) return result;

      const newState = result.state!;
      newState.lastMove = {
        type: 'PLAY_CARD',
        timestamp: new Date().toISOString(),
        playerName: actor.name,
        details: `${actor.name} played ${data.cardRole}${data.targetPlayerId ? ' on ' + state.players.find((p: Player) => p.id === data.targetPlayerId)?.name : ''}`,
        success: true
      };

      return { state: newState };
    }
  }

  return { state };
}
