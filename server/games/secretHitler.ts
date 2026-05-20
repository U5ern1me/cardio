import * as SH from '../../src/games/secretHitler/logic.js';
import type { Policy, SecretHitlerState, Vote } from '../../src/games/secretHitler/types.js';

function isAlivePlayer(state: SecretHitlerState, playerId: string | null): boolean {
  if (!playerId) return false;
  return !!state.players.find((p) => p.id === playerId && p.isAlive);
}

interface ActionData {
  type: string;
  action?: string;
  actorId?: string | null;
  test?: boolean;
  targetId?: string;
  vote?: Vote;
  policy?: Policy;
  accept?: boolean;
}

export function handleAction(state: SecretHitlerState, data: ActionData) {
  const actorId = data.actorId ?? null;
  if (!actorId) return { error: 'Not joined as a player.' };

  switch (data.type) {
    case 'START_GAME': {
      const minPlayers = data.test ? 1 : 3;
      if (state.players.length < minPlayers) return { error: `Need at least ${minPlayers} players for Secret Hitler.` };
      if (state.players.length > 10) return { error: 'Maximum 10 players allowed.' };
      return { state: SH.setupSecretHitler(state) };
    }

    case 'SECRET_HITLER_ACTION': {
      const action = data.action as string;
      if (state.phase === 'GAME_OVER') return { state };

      if (action === 'NOMINATE_CHANCELLOR') {
        const targetId = data.targetId as string;
        const error = SH.canNominateChancellor(state, actorId, targetId);
        if (error) return { error };
        const next = {
          ...state,
          nominatedChancellorId: targetId,
          chancellorId: null,
          votes: {},
          phase: 'VOTING' as const,
          lastMove: {
            type: 'NOMINATE_CHANCELLOR',
            timestamp: new Date().toISOString(),
            playerName: state.players.find((p) => p.id === actorId)?.name ?? 'Unknown',
            details: `${state.players.find((p) => p.id === actorId)?.name} nominated ${state.players.find((p) => p.id === targetId)?.name}.`,
            success: true,
          },
        };
        next.moveLog = [next.lastMove, ...next.moveLog];
        return { state: next };
      }

      if (action === 'CAST_VOTE') {
        if (state.phase !== 'VOTING') return { error: 'Not voting phase.' };
        if (!isAlivePlayer(state, actorId)) return { error: 'Dead players cannot vote.' };
        const vote = data.vote as Vote;
        if (!vote || (vote !== 'JA' && vote !== 'NEIN')) return { error: 'Invalid vote.' };
        const votes = { ...state.votes, [actorId]: vote };
        const aliveCount = SH.getAliveCount(state);
        if (Object.keys(votes).length < aliveCount) return { state: { ...state, votes } };

        const ja = SH.countJa(votes);
        if (ja > aliveCount / 2) {
          if (SH.hitlerElectedAsChancellor({ ...state, votes })) {
            const hitlerWin = {
              ...state,
              votes,
              phase: 'GAME_OVER' as const,
              winner: 'FASCIST' as const,
              winnerReason: 'Hitler was elected chancellor after three fascist policies.',
            };
            return { state: hitlerWin };
          }

          let next = SH.ensureDeck({ ...state, votes });
          const drawn = next.drawPile.slice(0, 3);
          next = {
            ...next,
            drawPile: next.drawPile.slice(3),
            presidentCards: drawn,
            chancellorCards: [],
            vetoRequested: false,
            electionTracker: 0,
            phase: 'LEGISLATIVE_PRESIDENT',
          };
          return { state: next };
        }

        let failed = {
          ...state,
          votes,
          electionTracker: state.electionTracker + 1,
          nominatedChancellorId: null,
          chancellorId: null,
          vetoRequested: false,
        };
        if (failed.electionTracker >= 3) {
          failed = SH.topDeckChaosPolicy(failed);
          return { state: failed };
        }
        return { state: SH.passPresident(failed) };
      }

      if (action === 'PRESIDENT_DISCARD_POLICY') {
        if (state.phase !== 'LEGISLATIVE_PRESIDENT') return { error: 'Not in president legislative phase.' };
        if (state.presidentId !== actorId) return { error: 'Only president may discard now.' };
        const discard = data.policy as Policy;
        if (!state.presidentCards.includes(discard)) return { error: 'Policy not in hand.' };

        const cards = [...state.presidentCards];
        const idx = cards.indexOf(discard);
        cards.splice(idx, 1);
        if (cards.length !== 2) return { error: 'President must pass exactly 2 cards.' };
        return {
          state: {
            ...state,
            discardPile: [...state.discardPile, discard],
            presidentCards: [],
            chancellorCards: cards,
            vetoRequested: false,
            phase: 'LEGISLATIVE_CHANCELLOR',
          },
        };
      }

      if (action === 'CHANCELLOR_REQUEST_VETO') {
        if (state.phase !== 'LEGISLATIVE_CHANCELLOR') return { error: 'Veto is only possible during chancellor legislative phase.' };
        if (state.nominatedChancellorId !== actorId) return { error: 'Only the chancellor can request veto.' };
        if (state.fascistPolicies < 5) return { error: 'Veto power is unlocked after 5 fascist policies.' };
        return {
          state: {
            ...state,
            vetoRequested: true,
            phase: 'VETO_RESPONSE',
          },
        };
      }

      if (action === 'PRESIDENT_VETO_RESPONSE') {
        if (state.phase !== 'VETO_RESPONSE') return { error: 'No veto response pending.' };
        if (state.presidentId !== actorId) return { error: 'Only president can answer veto request.' };
        const accept = !!data.accept;
        if (!accept) {
          return {
            state: {
              ...state,
              vetoRequested: false,
              phase: 'LEGISLATIVE_CHANCELLOR',
            },
          };
        }

        const discardPile = [...state.discardPile, ...state.chancellorCards];
        let next = {
          ...state,
          discardPile,
          chancellorCards: [],
          presidentCards: [],
          vetoRequested: false,
          electionTracker: state.electionTracker + 1,
          nominatedChancellorId: null,
          chancellorId: null,
          votes: {},
        };
        if (next.electionTracker >= 3) {
          next = SH.topDeckChaosPolicy(next);
          return { state: next };
        }
        return { state: SH.passPresident(next) };
      }

      if (action === 'CHANCELLOR_ENACT_POLICY') {
        if (state.phase !== 'LEGISLATIVE_CHANCELLOR') return { error: 'Not in chancellor legislative phase.' };
        if (state.nominatedChancellorId !== actorId) return { error: 'Only chancellor may enact now.' };
        const enact = data.policy as Policy;
        if (!state.chancellorCards.includes(enact)) return { error: 'Policy not in hand.' };

        const other = state.chancellorCards.find((p) => p !== enact);
        let next = {
          ...state,
          discardPile: other ? [...state.discardPile, other] : [...state.discardPile],
        };
        next = SH.enactPolicy(next, enact);
        return { state: next };
      }

      if (action === 'PRESIDENT_EXECUTIVE_ACTION') {
        if (state.phase !== 'EXECUTIVE_ACTION') return { error: 'No executive action pending.' };
        if (state.presidentId !== actorId) return { error: 'Only current president can use executive action.' };

        if (state.executiveAction === 'POLICY_PEEK') {
          return { state: SH.moveToNextGovernment({ ...state, executiveAction: null, policyPeek: null }) };
        }

        const targetId = data.targetId as string;
        if (!isAlivePlayer(state, targetId)) return { error: 'Target must be alive.' };
        if (targetId === actorId) return { error: 'Cannot target yourself.' };

        if (state.executiveAction === 'INVESTIGATE') {
          const result = SH.handleInvestigate(state, actorId, targetId);
          if (result.error) return { error: result.error };
          return { state: result.state };
        }

        if (state.executiveAction === 'SPECIAL_ELECTION') {
          return { state: SH.handleSpecialElection(state, targetId) };
        }

        if (state.executiveAction === 'EXECUTE') {
          return { state: SH.handleExecute(state, targetId) };
        }
      }

      return { state };
    }

    default:
      return { state };
  }
}
