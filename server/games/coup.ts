import * as CoupLogic from '../../src/games/coup/logic.js';

import type { GameState, CoupRole, CoupActionType, Player, Influence } from '../../src/games/coup/types.js';

interface ActionData {
  type: string;
  actorId?: string;
  test?: boolean;
  timestamp?: number;
  actionType?: CoupActionType;
  targetId?: string;
  roleClaimed?: CoupRole;
}

interface ActionResult {
  state?: GameState;
  error?: string;
}

export function handleAction(
  state: GameState,
  data: ActionData,
  broadcastState: (sid: string) => void,
  dispatch?: (action: { type: string; timestamp?: number }) => void
): ActionResult {
  const { actorId } = data;
  const actor = state.players.find((p: Player) => p.id === actorId);

  switch (data.type) {
    case 'START_GAME':
      if (!data.test && state.players.length < 3) return { error: 'Need at least 3 players to start' };
      if (!data.test && state.players.length > 6) return { error: 'Maximum 6 players allowed' };
      return { state: CoupLogic.setupCoup(state) };

    case 'TIMER_RESOLVE': {
      if (state.pendingAction && state.pendingAction.timestamp === data.timestamp && 
          (state.phase === 'WAITING_FOR_CHALLENGE' || state.phase === 'WAITING_FOR_BLOCK' || state.phase === 'WAITING_FOR_BLOCK_CHALLENGE')) {
        return { state: resolveAction(state, dispatch) };
      }
      return { state };
    }

    case 'COUP_ACTION': {
      const { actionType, targetId, roleClaimed } = data;

      // 1. Basic Instant Actions (Income, Coup)
      if (['INCOME', 'COUP'].includes(actionType)) {
        return { state: CoupLogic.handleBasicAction(state, actorId, actionType, targetId) };
      }

      // 2. Character Actions (Challengeable/Blockable)
      if (['TAX', 'ASSASSINATE', 'STEAL', 'EXCHANGE', 'FOREIGN_AID', 'BLOCK'].includes(actionType)) {
        if (!actor) return { state };

        // Blocking Action
        if (actionType === 'BLOCK') {
          if (!state.pendingAction || !roleClaimed) return { state };
          if (['STEAL', 'ASSASSINATE'].includes(state.pendingAction.type) && actorId !== state.pendingAction.targetId) {
            return { error: 'Only the target can block this action' };
          }
          const timestamp = Date.now();
          
          const nextState = {
            ...state,
            phase: 'WAITING_FOR_BLOCK_CHALLENGE',
            pendingAction: {
              ...state.pendingAction,
              blocks: { blockerId: actorId, roleClaimed },
              challengers: [],
              timestamp
            },
            lastMove: {
              ...state.lastMove,
              type: 'BLOCK',
              details: `${actor.name} is blocking with ${CoupLogic.formatRoleName(roleClaimed)}. Waiting for responses...`
            }
          };
          nextState.moveLog = [nextState.lastMove, ...state.moveLog];
          
          startResolutionTimer(timestamp, dispatch);
          return { state: nextState };
        }

        // Standard Action Declaration
        if (actionType === 'ASSASSINATE' && actor.coins < 3) return { error: 'Not enough coins for Assassination' };
        
        const nextPlayers = state.players.map((p: Player) => 
          (actionType === 'ASSASSINATE' && p.id === actorId) ? { ...p, coins: p.coins - 3 } : p
        );

        const timestamp = Date.now();
        const actionLabel = CoupLogic.formatActionName(actionType);
        
        const phase = actionType === 'FOREIGN_AID' ? 'WAITING_FOR_BLOCK' : 'WAITING_FOR_CHALLENGE';
        const targetName = targetId ? (state.players.find((p: Player) => p.id === targetId)?.name || 'someone') : '';
        const details = actionType === 'FOREIGN_AID' 
          ? `${actor.name} is taking Foreign Aid. Waiting for blocks...`
          : `${actor.name} is choosing to ${actionLabel}${targetName ? ' on ' + targetName : ''}. Waiting for responses...`;

        const lastMove = {
          type: actionType,
          timestamp: new Date().toISOString(),
          playerName: actor.name,
          details,
          success: true
        };

        const nextState = {
          ...state,
          players: nextPlayers,
          phase,
          lastMove,
          moveLog: [lastMove, ...state.moveLog],
          pendingAction: {
            actorId,
            type: actionType,
            targetId,
            challengers: [],
            timestamp,
            blocks: null
          }
        };

        startResolutionTimer(timestamp, dispatch);
        return { state: nextState };
      }

      // 3. Challenge Action
      if (actionType === 'CHALLENGE') {
        if (!state.pendingAction) return { state };
        const isChallengingBlock = state.phase === 'WAITING_FOR_BLOCK_CHALLENGE';
        if (!isChallengingBlock && state.phase !== 'WAITING_FOR_CHALLENGE') return { state };

        const action = state.pendingAction;
        const challengedPlayerId = isChallengingBlock ? action.blocks!.blockerId : action.actorId;
        const requiredRole = isChallengingBlock ? action.blocks!.roleClaimed : CoupLogic.getRequiredRole(action.type);
        const challengedPlayer = state.players.find((p: Player) => p.id === challengedPlayerId);
        if (!challengedPlayer) return { state };
        
        const hasRole = challengedPlayer.influences.some((i: Influence) => !i.isRevealed && i.role === requiredRole);

        const nextState = { ...state };

        if (hasRole) {
          // Challenger loses influence
          nextState.phase = 'SELECT_INFLUENCE_TO_LOSE';
          nextState.loserId = actorId; // The challenger
          nextState.resolution = isChallengingBlock ? 'BLOCK_CHALLENGE_FAILED' : 'CHALLENGE_FAILED';

          // Truthful player swaps card
          const { newPlayers, newDeck } = swapPlayerCard(state.players, challengedPlayerId, requiredRole as CoupRole, state.deck);
          nextState.players = newPlayers;
          nextState.deck = newDeck;

          nextState.lastMove = {
            ...state.lastMove,
            details: `${challengedPlayer.name} showed their ${CoupLogic.formatRoleName(requiredRole)}! ${actor.name} must lose an influence.`
          };
        } else {
          // Challenged player loses influence
          nextState.players = [...state.players]; // shallow clone array
          nextState.phase = 'SELECT_INFLUENCE_TO_LOSE';
          nextState.loserId = challengedPlayerId; 
          nextState.resolution = isChallengingBlock ? 'BLOCK_CHALLENGE_SUCCESSFUL' : 'CHALLENGE_SUCCESSFUL';
          nextState.lastMove = {
            ...state.lastMove,
            details: `${actor.name} challenged ${challengedPlayer.name}'s ${isChallengingBlock ? 'block' : 'action'}. They were bluffing!`
          };
        }
        
        nextState.moveLog = [nextState.lastMove, ...state.moveLog.slice(1)];
        return { state: nextState };
      }

      // 4. Pass Action
      if (actionType === 'PASS') {
        if (!state.pendingAction) return { state };
        if (state.pendingAction.challengers.includes(actorId)) return { state };
        
        const nextState = {
          ...state,
          pendingAction: {
            ...state.pendingAction,
            challengers: [...state.pendingAction.challengers, actorId]
          }
        };

        const othersCount = state.players.filter((p: Player) => p.influences.some((i: Influence) => !i.isRevealed)).length - 1;
        if (nextState.pendingAction.challengers.length >= othersCount) {
          return { state: resolveAction(nextState, dispatch) };
        }
        return { state: nextState };
      }

      // 5. Select Influence to Lose
      if (actionType === 'LOSE_INFLUENCE') {
        if (state.phase !== 'SELECT_INFLUENCE_TO_LOSE' || state.loserId !== actorId) return { state };

        const { influenceIndex } = data;
        const loser = state.players.find((p: Player) => p.id === actorId);
        if (!loser || loser.influences[influenceIndex].isRevealed) return { state };

        const nextPlayers = state.players.map((p: Player) => {
          if (p.id === actorId) {
            const nextInfluences = [...p.influences];
            nextInfluences[influenceIndex] = { ...nextInfluences[influenceIndex], isRevealed: true };
            return { ...p, influences: nextInfluences };
          }
          return p;
        });

        const nextState = { ...state, players: nextPlayers };

        // Determine what happens next
        if (state.resolution === 'CHALLENGE_FAILED' || state.resolution === 'BLOCK_CHALLENGE_SUCCESSFUL') {
          if (state.resolution === 'BLOCK_CHALLENGE_SUCCESSFUL') {
            nextState.pendingAction = { ...state.pendingAction, blocks: null };
          }
          return { state: resolveAction(nextState, dispatch) };
        } else {
          return { state: moveToNextTurn({ ...nextState, phase: 'PLAYING', pendingAction: null }) };
        }
      }

      // 6. Select Exchange Cards
      if (actionType === 'FINALIZE_EXCHANGE') {
        if (state.phase !== 'SELECTING_EXCHANGE_CARDS') return { state };
        const { selectedRoles } = data;
        const unrevealedCount = actor.influences.filter((i: Influence) => !i.isRevealed).length;

        if (selectedRoles.length !== unrevealedCount) return { error: `Must select exactly ${unrevealedCount} cards` };

        const currentOptions = [...state.exchangeOptions];
        selectedRoles.forEach((role: string) => {
          const idx = currentOptions.indexOf(role as CoupRole);
          if (idx > -1) currentOptions.splice(idx, 1);
        });

        const newDeck = [...state.deck, ...currentOptions];
        CoupLogic.shuffle(newDeck);

        let selectedIdx = 0;
        const nextPlayers = state.players.map((p: Player) => {
          if (p.id === actorId) {
            const nextInfluences = p.influences.map((inf: Influence) => {
              if (!inf.isRevealed) {
                return { ...inf, role: selectedRoles[selectedIdx++] };
              }
              return inf;
            });
            return { ...p, influences: nextInfluences };
          }
          return p;
        });

        const nextState = {
          ...state,
          players: nextPlayers,
          deck: newDeck,
          exchangeOptions: [],
          phase: 'PLAYING',
          pendingAction: null
        };
        return { state: moveToNextTurn(nextState) };
      }

      return { state };
    }

    default:
      return { state };
  }
}

function startResolutionTimer(timestamp: number, dispatch?: (action: { type: string; timestamp?: number }) => void) {
  if (dispatch) {
    setTimeout(() => {
      dispatch({ type: 'TIMER_RESOLVE', timestamp });
    }, 10000);
  }
}

function swapPlayerCard(players: Player[], playerId: string, role: CoupRole, deck: CoupRole[]): { newPlayers: Player[]; newDeck: CoupRole[] } {
  let newRole: CoupRole = 'HIDDEN';
  let finalDeck = [...deck];

  const newPlayers = players.map(p => {
    if (p.id !== playerId) return p;
    const roleIndex = p.influences.findIndex((i: Influence) => !i.isRevealed && i.role === role);
    if (roleIndex === -1) return p;
    
    const tempDeck = [...deck, p.influences[roleIndex].role];
    CoupLogic.shuffle(tempDeck);
    newRole = tempDeck.shift()!;
    finalDeck = tempDeck;
    
    const newInfluences = [...p.influences];
    newInfluences[roleIndex] = { ...newInfluences[roleIndex], role: newRole };
    return { ...p, influences: newInfluences };
  });

  return { newPlayers, newDeck: finalDeck };
}

function moveToNextTurn(state: GameState): GameState {
  const nextState = { ...state };
  const alivePlayers = state.players.filter((p: Player) => p.influences.some((i: Influence) => !i.isRevealed));

  if (alivePlayers.length <= 1) {
    nextState.phase = 'GAME_OVER';
    nextState.winner = alivePlayers[0]?.id;
    return nextState;
  }

  let activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
  while (!state.players[activePlayerIndex].influences.some((i: Influence) => !i.isRevealed)) {
    activePlayerIndex = (activePlayerIndex + 1) % state.players.length;
  }
  nextState.activePlayerIndex = activePlayerIndex;
  return nextState;
}

function resolveAction(state: GameState, dispatch?: (action: { type: string; timestamp?: number }) => void): GameState {
  if (!state.pendingAction) return state;

  const { type, actorId, targetId, blocks } = state.pendingAction;
  const nextState = { ...state };
  
  if (state.phase === 'WAITING_FOR_CHALLENGE' && CoupLogic.isBlockable(type) && !blocks) {
    const timestamp = Date.now();
    nextState.phase = 'WAITING_FOR_BLOCK';
    nextState.pendingAction = {
      ...state.pendingAction,
      challengers: [],
      timestamp
    };
    startResolutionTimer(timestamp, dispatch);
    return nextState;
  }

  if (blocks && state.phase !== 'SELECT_INFLUENCE_TO_LOSE') {
    nextState.lastMove = {
      ...state.lastMove,
      details: `Action was blocked by ${CoupLogic.formatRoleName(blocks.roleClaimed)}.`
    };
    nextState.moveLog = [nextState.lastMove, ...state.moveLog.slice(1)];
    nextState.phase = 'PLAYING';
    nextState.pendingAction = null;
    return moveToNextTurn(nextState);
  }

  const nextPlayers = [...state.players];
  const actorIndex = nextPlayers.findIndex(p => p.id === actorId);
  if (actorIndex === -1) return state;
  const actor = { ...nextPlayers[actorIndex] };
  nextPlayers[actorIndex] = actor;
  
  let details = '';

  if (type === 'TAX') { 
    actor.coins += 3; 
    details = `${actor.name} successfully collected Tax.`; 
  }
  else if (type === 'FOREIGN_AID') { 
    actor.coins += 2; 
    details = `${actor.name} successfully collected Foreign Aid.`; 
  }
  else if (type === 'STEAL') {
    const targetIndex = nextPlayers.findIndex(p => p.id === targetId);
    if (targetIndex !== -1) {
      const target = { ...nextPlayers[targetIndex] };
      const amount = Math.min(target.coins, 2);
      target.coins -= amount;
      actor.coins += amount;
      nextPlayers[targetIndex] = target;
      details = `${actor.name} successfully stole ${amount} coins from ${target.name}.`;
    }
  }
  else if (type === 'ASSASSINATE') {
    const target = nextPlayers.find(p => p.id === targetId);
    details = `${actor.name} successfully assassinated ${target?.name}.`;
    nextState.lastMove = { ...state.lastMove, details };
    nextState.moveLog = [nextState.lastMove, ...state.moveLog.slice(1)];
    
    const hasInfluences = target?.influences?.some((i: Influence) => !i.isRevealed);
    if (!hasInfluences) {
      nextState.players = nextPlayers;
      nextState.phase = 'PLAYING';
      nextState.pendingAction = null;
      return moveToNextTurn(nextState);
    }

    nextState.players = nextPlayers;
    nextState.phase = 'SELECT_INFLUENCE_TO_LOSE';
    nextState.loserId = targetId;
    nextState.resolution = 'ACTION_COMPLETE';
    nextState.pendingAction = null;
    return nextState;
  }
  else if (type === 'EXCHANGE') {
    details = `${actor.name} successfully used Exchange.`;
    const unrevealedRoles = actor.influences.filter((i: Influence) => !i.isRevealed).map((i: Influence) => i.role);
    const newDeck = [...state.deck];
    const drawnRoles = [newDeck.shift()!, newDeck.shift()!];
    
    nextState.players = nextPlayers;
    nextState.lastMove = { ...state.lastMove, details };
    nextState.moveLog = [nextState.lastMove, ...state.moveLog.slice(1)];
    nextState.deck = newDeck;
    nextState.exchangeOptions = [...unrevealedRoles, ...drawnRoles];
    nextState.phase = 'SELECTING_EXCHANGE_CARDS';
    nextState.pendingAction = null;
    return nextState;
  }

  nextState.players = nextPlayers;
  if (details) {
    nextState.lastMove = { ...state.lastMove, details };
    nextState.moveLog = [nextState.lastMove, ...state.moveLog.slice(1)];
  }
  
  nextState.phase = 'PLAYING';
  nextState.pendingAction = null;
  return moveToNextTurn(nextState);
}
