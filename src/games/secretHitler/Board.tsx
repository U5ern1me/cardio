import { useState } from "react";
import { useGame } from "../../context/GameContextStore";
import RulesButton from "../../components/RulesButton";
import type { Policy, SecretHitlerState } from "./types";

export default function SecretHitlerBoard() {
  const {
    gameState: baseState,
    myPlayerId,
    sendMessage,
    clearSession,
  } = useGame();
  const gameState = baseState as SecretHitlerState;

  if (!gameState || !myPlayerId) return null;

  const me = gameState.players.find((p) => p.id === myPlayerId);
  const president = gameState.players.find(
    (p) => p.id === gameState.presidentId,
  );
  const chancellor = gameState.players.find(
    (p) => p.id === gameState.chancellorId,
  );
  const nominated = gameState.players.find(
    (p) => p.id === gameState.nominatedChancellorId,
  );
  const isPresident = gameState.presidentId === myPlayerId;
  const isChancellor =
    gameState.nominatedChancellorId === myPlayerId ||
    gameState.chancellorId === myPlayerId;

  const canVote =
    gameState.phase === "VOTING" &&
    !!me?.isAlive &&
    !gameState.votes[myPlayerId];

  const actionPlayers = gameState.players.filter(
    (p) => p.isAlive && p.id !== myPlayerId,
  );

  const sendAction = (
    action: string,
    payload: Record<string, unknown> = {},
  ) => {
    sendMessage({ type: "SECRET_HITLER_ACTION", action, ...payload });
  };

  return (
    <div className="bg-surface text-on-surface font-body-md min-h-screen flex flex-col overflow-hidden">
      <main className="flex-1 overflow-y-auto relative p-gutter md:p-container-margin flex flex-col gap-section-gap">
        {/* Header area */}
        <header className="flex justify-between items-end border-b border-outline-variant pb-4">
          <div>
            <span className="font-label-md text-label-md text-primary uppercase tracking-widest mb-1 block">
              Live Match
            </span>
            <h1 className="font-headline-md text-headline-md text-on-surface">
              Secret Hitler #{gameState.sessionId}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center gap-1 bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full font-label-md text-[12px]">
              <span className="material-symbols-outlined text-[16px]">
                visibility_off
              </span>
              {me?.role === "HITLER"
                ? "Hitler"
                : me?.partyMembership === "FASCIST"
                  ? "Fascist"
                  : "Liberal"}
            </span>
            <div className="flex items-center gap-2">
              <RulesButton />
              <button
                onClick={() => confirm("Leave this session?") && clearSession()}
                className="text-error hover:text-on-error hover:bg-error px-2 py-1 rounded text-xs transition-colors"
              >
                Leave Game
              </button>
            </div>
          </div>
        </header>

        {/* Top Stats Bar: Tracker & Boards */}
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-gutter">
          {/* Liberal Track */}
          <div className="xl:col-span-5 bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-gutter flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-secondary">
                Liberal
              </h3>
              <span className="font-label-md text-label-md text-secondary-container bg-secondary/10 px-2 py-1 rounded-DEFAULT">
                5 to win
              </span>
            </div>
            <div className="flex gap-2 justify-between w-full">
              {[1, 2, 3, 4, 5].map((i) => {
                if (i <= gameState.liberalPolicies) {
                  return (
                    <div
                      key={i}
                      className="flex-1 aspect-[2.5/3.5] bg-secondary border-2 border-secondary rounded-lg shadow-[0_4px_12px_-4px_rgba(0,99,152,0.4)] flex justify-center items-center"
                    >
                      <span
                        className="material-symbols-outlined text-on-secondary text-3xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        description
                      </span>
                    </div>
                  );
                }
                if (i === 5) {
                  return (
                    <div
                      key={i}
                      className="flex-1 aspect-[2.5/3.5] bg-surface border-2 border-dashed border-outline-variant rounded-lg flex justify-center items-center bg-tertiary-fixed/30 text-tertiary"
                    >
                      <span className="material-symbols-outlined">
                        emoji_events
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className="flex-1 aspect-[2.5/3.5] bg-surface border-2 border-dashed border-outline-variant rounded-lg"
                  ></div>
                );
              })}
            </div>
          </div>

          {/* Fascist Track */}
          <div className="xl:col-span-7 bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-gutter flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-error">
                Fascist
              </h3>
              <span className="font-label-md text-label-md text-error bg-error-container/30 px-2 py-1 rounded-DEFAULT">
                6 to win
              </span>
            </div>
            <div className="flex gap-2 justify-between w-full">
              {[1, 2, 3, 4, 5, 6].map((i) => {
                if (i <= gameState.fascistPolicies) {
                  return (
                    <div
                      key={i}
                      className="flex-1 aspect-[2.5/3.5] bg-error border-2 border-error rounded-lg shadow-[0_4px_12px_-4px_rgba(186,26,26,0.4)] flex justify-center items-center"
                    >
                      <span
                        className="material-symbols-outlined text-on-error text-3xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        description
                      </span>
                    </div>
                  );
                }
                if (i === 6) {
                  return (
                    <div
                      key={i}
                      className="flex-1 aspect-[2.5/3.5] bg-surface border-2 border-dashed border-outline-variant rounded-lg flex justify-center items-center bg-error-container/20 text-error"
                    >
                      <span className="material-symbols-outlined">skull</span>
                    </div>
                  );
                }
                if (i === 3 && gameState.players.length >= 5) {
                  return (
                    <div
                      key={i}
                      className="flex-1 aspect-[2.5/3.5] bg-surface border-2 border-dashed border-outline-variant rounded-lg flex flex-col justify-center items-center gap-1 text-on-surface-variant relative text-center px-1"
                    >
                      <span className="material-symbols-outlined text-2xl">
                        policy
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-label-md uppercase">
                        Investigate
                      </span>
                    </div>
                  );
                }
                if (i === 4 || i === 5) {
                  return (
                    <div
                      key={i}
                      className="flex-1 aspect-[2.5/3.5] bg-surface border-2 border-dashed border-outline-variant rounded-lg flex flex-col justify-center items-center gap-1 text-on-surface-variant relative text-center px-1"
                    >
                      <span className="material-symbols-outlined text-2xl">
                        target
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-label-md uppercase">
                        Execution
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className="flex-1 aspect-[2.5/3.5] bg-surface border-2 border-dashed border-outline-variant rounded-lg"
                  ></div>
                );
              })}
            </div>
          </div>

          {/* Election Tracker */}
          <div className="xl:col-span-12 flex justify-center items-center gap-6 bg-surface-container-low py-4 rounded-xl border border-surface-variant">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase">
              Election Tracker
            </span>
            <div className="flex items-center gap-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full ${gameState.electionTracker >= i ? "bg-primary w-6 h-6 shadow-[0_0_15px_rgba(249,115,22,0.5)] border-2 border-surface-container-lowest" : "bg-outline-variant"}`}
                ></div>
              ))}
              <span
                className="material-symbols-outlined text-error"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                warning
              </span>
            </div>
          </div>
        </section>

        {/* Central Action Area (Bento Grid) */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          {/* Active Task */}
          <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-gutter lg:p-container-margin shadow-[0_20px_40px_-15px_rgba(249,115,22,0.05)] border border-outline-variant flex flex-col relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary-fixed/20 rounded-full blur-3xl pointer-events-none"></div>

            <div className="mb-6 relative z-10">
              <span className="font-label-md text-label-md text-primary bg-primary-fixed/30 px-3 py-1 rounded-full uppercase inline-block mb-2">
                {gameState.phase.replaceAll("_", " ")}
              </span>

              {gameState.phase === "NOMINATE_CHANCELLOR" && isPresident ? (
                <>
                  <h2 className="font-headline-md text-headline-md text-on-surface">
                    You are the President.
                  </h2>
                  <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
                    Nominate a Chancellor.
                  </p>
                  <div className="flex flex-wrap gap-3 mt-6">
                    {actionPlayers.map((p) => (
                      <button
                        key={p.id}
                        onClick={() =>
                          sendAction("NOMINATE_CHANCELLOR", { targetId: p.id })
                        }
                        className="bg-surface-container text-on-surface font-label-md px-4 py-2 rounded-lg border border-outline-variant hover:border-primary hover:bg-primary/10 transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : gameState.phase === "VOTING" ? (
                <>
                  <h2 className="font-headline-md text-headline-md text-on-surface">
                    Voting Phase
                  </h2>
                  <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
                    President {president?.name} nominated {nominated?.name}.
                  </p>
                  {canVote ? (
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={() => sendAction("CAST_VOTE", { vote: "JA" })}
                        className="flex-1 bg-secondary text-on-secondary font-headline-sm py-4 rounded-xl hover:bg-secondary/90 transition-colors"
                      >
                        JA! (Yes)
                      </button>
                      <button
                        onClick={() =>
                          sendAction("CAST_VOTE", { vote: "NEIN" })
                        }
                        className="flex-1 bg-error text-on-error font-headline-sm py-4 rounded-xl hover:bg-error/90 transition-colors"
                      >
                        NEIN (No)
                      </button>
                    </div>
                  ) : (
                    <div className="mt-6 p-4 rounded-lg border border-dashed border-outline-variant text-center text-on-surface-variant">
                      Waiting for all players to vote...
                    </div>
                  )}
                </>
              ) : gameState.phase === "LEGISLATIVE_PRESIDENT" && isPresident ? (
                <PolicySelector
                  title="You are the President."
                  subtitle="Select one policy to discard. The remaining two will be passed to your Chancellor."
                  policies={gameState.presidentCards}
                  onPick={(policy) =>
                    sendAction("PRESIDENT_DISCARD_POLICY", { policy })
                  }
                  buttonText="Discard & Pass Remaining"
                />
              ) : gameState.phase === "LEGISLATIVE_CHANCELLOR" &&
                isChancellor ? (
                <div className="space-y-4">
                  <PolicySelector
                    title="You are the Chancellor."
                    subtitle="Select one policy to enact."
                    policies={gameState.chancellorCards}
                    onPick={(policy) =>
                      sendAction("CHANCELLOR_ENACT_POLICY", { policy })
                    }
                    buttonText="Enact Policy"
                  />
                  {gameState.fascistPolicies >= 5 && (
                    <div className="mt-4 p-4 rounded-lg bg-error-container text-on-error-container flex justify-between items-center">
                      <div>
                        <h3 className="font-bold mb-1">Veto Power Unlocked</h3>
                        <p className="text-sm">
                          You may request to veto this agenda.
                        </p>
                      </div>
                      <button
                        onClick={() => sendAction("CHANCELLOR_REQUEST_VETO")}
                        className="bg-error text-on-error px-4 py-2 rounded-lg font-bold hover:bg-error/90"
                      >
                        Request Veto
                      </button>
                    </div>
                  )}
                </div>
              ) : gameState.phase === "VETO_RESPONSE" && isPresident ? (
                <>
                  <h2 className="font-headline-md text-headline-md text-on-surface">
                    Veto Requested
                  </h2>
                  <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
                    The Chancellor requested a veto.
                  </p>
                  <div className="flex gap-4 mt-6">
                    <button
                      onClick={() =>
                        sendAction("PRESIDENT_VETO_RESPONSE", { accept: true })
                      }
                      className="flex-1 bg-secondary text-on-secondary font-headline-sm py-4 rounded-xl hover:bg-secondary/90 transition-colors"
                    >
                      Accept Veto
                    </button>
                    <button
                      onClick={() =>
                        sendAction("PRESIDENT_VETO_RESPONSE", { accept: false })
                      }
                      className="flex-1 bg-error text-on-error font-headline-sm py-4 rounded-xl hover:bg-error/90 transition-colors"
                    >
                      Reject Veto
                    </button>
                  </div>
                </>
              ) : gameState.phase === "EXECUTIVE_ACTION" && isPresident ? (
                <>
                  <h2 className="font-headline-md text-headline-md text-on-surface">
                    Executive Action
                  </h2>
                  <p className="font-body-lg text-body-lg text-on-surface-variant mt-1 uppercase">
                    {gameState.executiveAction?.replaceAll("_", " ")}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-6">
                    {actionPlayers.map((p) => (
                      <button
                        key={p.id}
                        onClick={() =>
                          sendAction("PRESIDENT_EXECUTIVE_ACTION", {
                            targetId: p.id,
                          })
                        }
                        className="bg-surface-container text-on-surface font-label-md px-4 py-2 rounded-lg border border-outline-variant hover:border-error hover:text-error hover:bg-error/10 transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : gameState.phase === "GAME_OVER" ? (
                <>
                  <h2 className="font-headline-lg text-headline-lg text-on-surface">
                    Game Over
                  </h2>
                  <p
                    className={`font-headline-sm mt-2 ${gameState.winner === "LIBERAL" ? "text-secondary" : "text-error"}`}
                  >
                    Winner: {gameState.winner}
                  </p>
                  <p className="font-body-md text-on-surface-variant mt-4 p-4 bg-surface-container-low rounded-lg">
                    {gameState.winnerReason}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="font-headline-md text-headline-md text-on-surface">
                    Waiting for others...
                  </h2>
                  <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
                    Current President: {president?.name || "None"}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Current Government / Status */}
          <div className="lg:col-span-1 flex flex-col gap-gutter">
            <div className="bg-surface-container-lowest rounded-xl p-gutter border border-outline-variant shadow-sm flex-1">
              <h3 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-4">
                Current Government
              </h3>
              <div className="flex flex-col gap-4">
                {president ? (
                  <div className="flex items-center gap-4 bg-primary-fixed/10 p-3 rounded-lg border border-primary-fixed">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center font-headline-sm">
                        {president.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-surface-container-lowest rounded-full p-0.5">
                        <span
                          className="material-symbols-outlined text-[16px] text-primary"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          stars
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="block font-label-md text-[12px] text-primary">
                        President
                      </span>
                      <span className="font-headline-sm text-[18px] text-on-surface">
                        {president.name} {isPresident && "(You)"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-on-surface-variant text-sm italic">
                    No President
                  </div>
                )}

                {chancellor || nominated ? (
                  <div className="flex items-center gap-4 bg-secondary-fixed/20 p-3 rounded-lg border border-secondary-fixed">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center font-headline-sm border border-outline-variant">
                        {(chancellor || nominated)!.name
                          .substring(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-surface-container-lowest rounded-full p-0.5">
                        <span
                          className="material-symbols-outlined text-[16px] text-secondary"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          verified_user
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="block font-label-md text-[12px] text-secondary">
                        {chancellor ? "Chancellor" : "Nominated"}
                      </span>
                      <span className="font-headline-sm text-[18px] text-on-surface">
                        {(chancellor || nominated)!.name}{" "}
                        {(chancellor?.id === myPlayerId ||
                          nominated?.id === myPlayerId) &&
                          "(You)"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-on-surface-variant text-sm italic">
                    No Chancellor
                  </div>
                )}
              </div>
            </div>

            {/* Game Log Snippet */}
            <div className="bg-surface-container-low rounded-xl p-gutter border border-outline-variant h-32 overflow-hidden relative">
              <h3 className="font-label-md text-[12px] text-on-surface-variant uppercase mb-2">
                Recent Event
              </h3>
              {gameState.lastMove ? (
                <p className="font-body-md text-[13px] text-on-surface-variant">
                  {gameState.lastMove.details}
                </p>
              ) : (
                <p className="font-body-md text-[13px] text-on-surface-variant italic">
                  Game started.
                </p>
              )}
              <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-surface-container-low to-transparent"></div>
            </div>
          </div>
        </section>

        {/* Player Roster */}
        <section>
          <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4">
            The Table
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-base">
            {gameState.players.map((p) => {
              const isPres = gameState.presidentId === p.id;
              const isChan =
                gameState.chancellorId === p.id ||
                gameState.nominatedChancellorId === p.id;

              return (
                <div
                  key={p.id}
                  className={`bg-surface-container-lowest p-4 rounded-xl border ${isPres ? "border-2 border-primary" : isChan ? "border-2 border-secondary" : "border-outline-variant"} shadow-sm flex flex-col items-center text-center relative pt-8 ${!p.isAlive ? "opacity-50 grayscale" : ""}`}
                >
                  {isPres && (
                    <span className="absolute top-2 right-2 bg-primary text-on-primary text-[10px] font-label-md px-2 py-0.5 rounded-full uppercase">
                      President
                    </span>
                  )}
                  {isChan && (
                    <span className="absolute top-2 right-2 bg-secondary text-on-secondary text-[10px] font-label-md px-2 py-0.5 rounded-full uppercase">
                      Chancellor
                    </span>
                  )}
                  {!p.isAlive && (
                    <span className="absolute top-2 right-2 bg-error text-on-error text-[10px] font-label-md px-2 py-0.5 rounded-full uppercase">
                      Dead
                    </span>
                  )}

                  <span
                    className={`font-label-md text-label-md text-on-surface line-clamp-1 w-full ${!p.isAlive ? "line-through" : ""}`}
                  >
                    {p.name} {p.id === myPlayerId && "(You)"}
                  </span>
                  <span
                    className={`font-body-md text-[12px] mt-1 ${!p.isAlive ? "text-error" : "text-on-surface-variant"}`}
                  >
                    {!p.isAlive ? "Executed" : "Alive"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function PolicySelector({
  title,
  subtitle,
  policies,
  onPick,
  buttonText,
}: {
  title: string;
  subtitle: string;
  policies: Policy[];
  onPick: (policy: Policy) => void;
  buttonText: string;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  return (
    <>
      <h2 className="font-headline-md text-headline-md text-on-surface">
        {title}
      </h2>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
        {subtitle}
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8 relative z-10 flex-1 mt-6">
        {policies.map((policy, idx) => (
          <label
            key={`${policy}-${idx}`}
            className={`cursor-pointer group relative w-40 aspect-[2.5/3.5] ${policy === "FASCIST" ? "bg-error" : "bg-secondary"} border-4 border-surface-container-lowest rounded-xl shadow-lg hover:-translate-y-2 transition-transform duration-300`}
          >
            <input
              className="peer sr-only"
              name="discard_policy"
              type="radio"
              checked={selectedIdx === idx}
              onChange={() => setSelectedIdx(idx)}
            />
            <div className="absolute inset-0 border-4 border-transparent peer-checked:border-primary rounded-xl pointer-events-none"></div>
            <div className="w-full h-full flex flex-col justify-between p-4">
              <span
                className={`material-symbols-outlined ${policy === "FASCIST" ? "text-on-error" : "text-on-secondary"} opacity-50`}
              >
                {policy === "FASCIST" ? "gavel" : "balance"}
              </span>
              <div
                className={`text-center ${policy === "FASCIST" ? "text-on-error" : "text-on-secondary"} font-headline-sm uppercase tracking-wider scale-y-150`}
              >
                {policy}
              </div>
              <span
                className={`material-symbols-outlined ${policy === "FASCIST" ? "text-on-error" : "text-on-secondary"} opacity-50 self-end`}
              >
                {policy === "FASCIST" ? "gavel" : "balance"}
              </span>
            </div>
            <div className="absolute -top-3 -right-3 bg-surface-container-lowest rounded-full p-1 opacity-0 peer-checked:opacity-100 transition-opacity shadow-sm">
              <span
                className="material-symbols-outlined text-primary"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end relative z-10 border-t border-outline-variant pt-4 mt-auto">
        <button
          disabled={selectedIdx === null}
          onClick={() => {
            if (selectedIdx !== null) {
              onPick(policies[selectedIdx]);
              setSelectedIdx(null);
            }
          }}
          className={`font-label-md text-label-md px-8 py-3 rounded-lg shadow-md transition-all flex items-center gap-2 ${selectedIdx !== null ? "bg-primary text-on-primary hover:bg-surface-tint active:scale-95" : "bg-surface-variant text-on-surface-variant cursor-not-allowed"}`}
        >
          {buttonText}
          <span className="material-symbols-outlined text-sm">
            arrow_forward
          </span>
        </button>
      </div>
    </>
  );
}
