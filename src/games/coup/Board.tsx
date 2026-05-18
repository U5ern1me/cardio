import { useState } from "react";
import { useGame } from "../../context/GameContextStore";
import RulesButton from "../../components/RulesButton";
import type { GameState as CoupGameState, Player, CoupRole } from "./types";

// ─── Constants ───────────────────────────────────────────

const ROLE_ICONS: Record<string, string> = {
  DUKE: "account_balance",
  ASSASSIN: "swords",
  CAPTAIN: "military_tech",
  AMBASSADOR: "sync_alt",
  CONTESSA: "shield",
};

const ROLE_COLORS: Record<string, string> = {
  DUKE: "text-tertiary",
  ASSASSIN: "text-on-surface",
  CAPTAIN: "text-primary",
  AMBASSADOR: "text-secondary",
  CONTESSA: "text-error",
};

// ─── Components ──────────────────────────────────────────

function InfluenceCard({
  role,
  isRevealed,
}: {
  role: CoupRole;
  isRevealed: boolean;
}) {
  const isHidden = role === "HIDDEN";

  if (isHidden) {
    return (
      <div className="w-24 h-36 md:w-32 md:h-48 bg-surface-variant rounded-xl border border-outline/20 opacity-50 shadow-none flex items-center justify-center relative overflow-hidden">
        <span className="material-symbols-outlined text-outline/50 text-4xl">
          help
        </span>
      </div>
    );
  }

  const roleColorClass = ROLE_COLORS[role as string] || "text-on-surface";
  const roleIcon = ROLE_ICONS[role as string] || "person";

  return (
    <div
      className={`w-24 h-36 md:w-32 md:h-48 bg-surface-container-lowest rounded-xl shadow-[0_15px_30px_-10px_rgba(0,0,0,0.1)] border border-surface-variant flex flex-col items-center justify-center p-2 hover:-translate-y-2 transition-transform cursor-pointer ${!isRevealed ? `border-2 ${roleColorClass.replace("text-", "border-")}` : "opacity-50 grayscale"}`}
    >
      <span
        className={`material-symbols-outlined text-3xl md:text-4xl mb-2 ${roleColorClass}`}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {roleIcon}
      </span>
      <span className="font-label-md text-[10px] md:text-label-md text-on-surface">
        {role}
      </span>
    </div>
  );
}

function PlayerSeat({
  player,
  isActive,
  isSelf,
  size = "normal",
  isSelected,
}: {
  player: Player;
  isActive: boolean;
  isSelf: boolean;
  size?: "normal" | "compact";
  isSelected?: boolean;
}) {
  const isAlive = player.influences?.some((i) => !i.isRevealed) ?? true;
  const isCompact = size === "compact";

  return (
    <div
      className={`flex items-center space-x-3 md:space-x-4 bg-surface-container-lowest p-3 md:p-4 rounded-xl border shadow-sm w-40 md:w-48 transition-all ${isSelected ? "border-primary ring-2 ring-primary/20" : "border-surface-variant"} ${isActive ? "bg-primary-fixed/10 border-primary" : ""} ${!isAlive ? "opacity-50 grayscale" : ""}`}
    >
      <div className="flex-1 w-full">
        <div className="flex items-center justify-between mb-2">
          <span
            className={`font-label-md text-[12px] md:text-label-md text-on-surface truncate pr-2 ${isSelf ? "font-bold" : ""}`}
          >
            {player.name} {isSelf ? "(You)" : ""}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full font-label-md text-[10px] md:text-xs flex-shrink-0 ${isActive ? "bg-primary-container text-on-primary" : "bg-secondary text-on-secondary"}`}
          >
            {player.coins} Coins
          </span>
        </div>
        {!isCompact && (
          <div className="flex space-x-2 h-10 mt-1">
            {player.influences?.map((inf, i) => {
              if (!inf.isRevealed) {
                return (
                  <div
                    key={i}
                    className="w-8 h-full rounded-md border shadow-sm bg-secondary-container border-secondary/20 flex-shrink-0"
                  />
                );
              }
              const icon = ROLE_ICONS[inf.role];
              const colorClass =
                ROLE_COLORS[inf.role] || "text-on-surface-variant";
              return (
                <div
                  key={i}
                  className="w-8 h-full rounded-md border shadow-sm bg-surface-container border-outline/20 opacity-60 flex flex-col items-center justify-center flex-shrink-0"
                >
                  <span
                    className={`material-symbols-outlined text-sm ${colorClass}`}
                  >
                    {icon}
                  </span>
                  <span
                    className={`text-[8px] font-label-md uppercase tracking-tighter ${colorClass} mt-0.5 leading-none`}
                  >
                    {inf.role.substring(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ExchangeSelectionOverlay({
  options,
  count,
  onConfirm,
}: {
  options: CoupRole[];
  count: number;
  onConfirm: (selected: CoupRole[]) => void;
}) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  const toggleSelection = (idx: number) => {
    if (selectedIndices.includes(idx)) {
      setSelectedIndices((prev) => prev.filter((i) => i !== idx));
    } else if (selectedIndices.length < count) {
      setSelectedIndices((prev) => [...prev, idx]);
    }
  };

  const isConfirmedDisabled = selectedIndices.length !== count;

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 text-center animate-in fade-in">
      <div className="max-w-xl w-full bg-surface-container-lowest rounded-3xl p-8 shadow-2xl border border-outline-variant">
        <h2 className="text-headline-md font-headline-md text-on-surface mb-2">
          Card Exchange
        </h2>
        <p className="text-on-surface-variant mb-8 font-body-lg">
          Choose <span className="font-bold text-primary">{count}</span> cards
          to keep.
        </p>

        <div className="flex flex-wrap justify-center gap-4 mb-8">
          {options.map((role, idx) => {
            const isSelected = selectedIndices.includes(idx);
            return (
              <div
                key={idx}
                className={`relative cursor-pointer transition-all ${isSelected ? "scale-105" : "hover:scale-105 opacity-80"}`}
                onClick={() => toggleSelection(idx)}
              >
                <InfluenceCard role={role} isRevealed={false} />
                {isSelected && (
                  <div className="absolute -top-3 -right-3 w-8 h-8 bg-primary text-on-primary rounded-full flex items-center justify-center text-sm border-2 border-surface-container-lowest shadow-lg">
                    <span
                      className="material-symbols-outlined text-[20px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      check_circle
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          disabled={isConfirmedDisabled}
          onClick={() => onConfirm(selectedIndices.map((i) => options[i]))}
          className={`w-full py-4 rounded-xl font-label-md text-label-md transition-all active:scale-95 shadow-md ${isConfirmedDisabled ? "bg-surface-variant text-on-surface-variant cursor-not-allowed" : "bg-primary text-on-primary hover:bg-surface-tint"}`}
        >
          Finalize Selection
        </button>
      </div>
    </div>
  );
}

// ─── Main Board ──────────────────────────────────────────

export default function CoupBoard() {
  const {
    gameState: baseState,
    myPlayerId,
    sendMessage,
    clearSession,
  } = useGame();
  const gameState = baseState as CoupGameState & { pendingAction?: any };
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  if (!gameState || !myPlayerId) return null;

  const myPlayer = gameState.players.find((p) => p.id === myPlayerId);
  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn = activePlayer?.id === myPlayerId;
  const isExchangePhase =
    gameState.phase === "SELECTING_EXCHANGE_CARDS" && isMyTurn;
  const isChallengePhase = gameState.phase === "WAITING_FOR_CHALLENGE";
  const isBlockPhase = gameState.phase === "WAITING_FOR_BLOCK";
  const isBlockChallengePhase =
    gameState.phase === "WAITING_FOR_BLOCK_CHALLENGE";
  const isLossPhase = gameState.phase === "SELECT_INFLUENCE_TO_LOSE";
  const isGameOver = gameState.phase === "GAME_OVER";
  const isLoser = gameState.loserId === myPlayerId;
  const isActor = gameState.pendingAction?.actorId === myPlayerId;
  const isTarget = gameState.pendingAction?.targetId === myPlayerId;
  const hasPassed = gameState.pendingAction?.challengers?.includes(myPlayerId);
  const isBlocker = gameState.pendingAction?.blocks?.blockerId === myPlayerId;

  const isResponsePhase =
    isChallengePhase || isBlockPhase || isBlockChallengePhase;

  const handleAction = (type: string, targetId?: string, extra?: any) => {
    sendMessage({
      type: "COUP_ACTION",
      actionType: type,
      targetId,
      ...extra,
      timestamp: Date.now(),
    });
    setSelectedTarget(null);
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body-md antialiased overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center p-4 border-b border-outline-variant bg-surface-container-lowest z-20">
        <div>
          <h1 className="font-headline-sm text-headline-sm text-on-surface">
            Coup{" "}
            <span className="text-outline-variant text-sm ml-2">
              #{gameState.sessionId}
            </span>
          </h1>
          <span className="font-label-md text-[10px] text-primary uppercase tracking-widest">
            {gameState.phase.replaceAll("_", " ")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <RulesButton />
          <button
            onClick={() => confirm("Leave this session?") && clearSession()}
            className="text-error hover:text-on-error hover:bg-error px-3 py-1.5 rounded-lg font-label-md text-xs transition-colors"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-container-margin md:p-section-gap overflow-y-auto max-w-6xl mx-auto w-full relative">
        {/* Opponents Row */}
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 mb-8 md:mb-12">
          {gameState.players
            .filter((p) => p.id !== myPlayerId)
            .map((p) => (
              <div
                key={p.id}
                className={`cursor-pointer transition-transform ${selectedTarget === p.id ? "scale-105" : ""}`}
                onClick={() =>
                  !isResponsePhase &&
                  !isLossPhase &&
                  isMyTurn &&
                  setSelectedTarget(p.id)
                }
              >
                <PlayerSeat
                  player={p}
                  isActive={activePlayer?.id === p.id}
                  isSelf={false}
                  isSelected={selectedTarget === p.id}
                />
              </div>
            ))}
        </div>

        {/* Central Action Area */}
        <div className="flex-1 flex flex-col items-center justify-center relative my-4 md:my-8 w-full min-h-[250px]">
          {/* Turn Indicator */}
          {!isGameOver && (
            <div className="absolute -top-6 text-center w-full">
              <span className="font-label-md text-xs uppercase tracking-widest text-primary bg-primary-container/30 px-3 py-1 rounded-full border border-primary/20">
                {isMyTurn ? "Your Turn" : `${activePlayer?.name}'s Turn`}
              </span>
            </div>
          )}

          {isGameOver ? (
            <div className="bg-surface-container-lowest w-full max-w-2xl rounded-xl p-8 shadow-lg border-2 border-primary text-center">
              <span
                className="material-symbols-outlined text-[64px] text-primary mb-4"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                emoji_events
              </span>
              <h2 className="font-headline-lg text-headline-lg text-on-surface">
                Winner!
              </h2>
              <p className="font-headline-sm text-secondary mt-2">
                {gameState.players.find((p) => p.id === gameState.winner)?.name}
              </p>
              <button
                onClick={() => {
                  clearSession();
                  window.location.reload();
                }}
                className="mt-8 bg-primary text-on-primary px-8 py-3 rounded-xl font-label-md shadow-md active:scale-95 transition-all inline-flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">home</span>
                Back to Lobby
              </button>
            </div>
          ) : isResponsePhase ? (
            <div className="bg-surface-container-lowest w-full max-w-2xl rounded-xl p-6 shadow-lg border border-outline-variant text-center">
              <h2 className="font-headline-md text-headline-md text-on-surface mb-2">
                {isChallengePhase
                  ? "Challenge Phase"
                  : isBlockPhase
                    ? "Block Phase"
                    : "Challenge Block"}
              </h2>
              <p className="font-body-lg text-on-surface-variant mb-6">
                {gameState.lastMove?.details}
              </p>

              <div className="flex flex-wrap justify-center gap-4">
                {isChallengePhase && !isActor && !hasPassed && (
                  <>
                    <ActionButton
                      label="Challenge"
                      onClick={() => handleAction("CHALLENGE")}
                      color="rose"
                      icon="gavel"
                    />
                    <ActionButton
                      label="Pass"
                      onClick={() => handleAction("PASS")}
                      color="default"
                      icon="check"
                    />
                  </>
                )}
                {isBlockPhase &&
                  (isTarget ||
                    (gameState.pendingAction?.type === "FOREIGN_AID" &&
                      !isActor)) && (
                    <>
                      {gameState.pendingAction?.type === "STEAL" ? (
                        <>
                          <ActionButton
                            label="Block (Captain)"
                            onClick={() =>
                              handleAction("BLOCK", undefined, {
                                roleClaimed: "CAPTAIN",
                              })
                            }
                            color="indigo"
                            icon="shield"
                          />
                          <ActionButton
                            label="Block (Ambassador)"
                            onClick={() =>
                              handleAction("BLOCK", undefined, {
                                roleClaimed: "AMBASSADOR",
                              })
                            }
                            color="emerald"
                            icon="sync_alt"
                          />
                        </>
                      ) : (
                        <ActionButton
                          label={`Block (${gameState.pendingAction?.type === "FOREIGN_AID" ? "Duke" : "Contessa"})`}
                          onClick={() =>
                            handleAction("BLOCK", undefined, {
                              roleClaimed:
                                gameState.pendingAction?.type === "FOREIGN_AID"
                                  ? "DUKE"
                                  : "CONTESSA",
                            })
                          }
                          color="indigo"
                          icon={
                            gameState.pendingAction?.type === "FOREIGN_AID"
                              ? "sports_martial_arts"
                              : "shield"
                          }
                        />
                      )}
                      <ActionButton
                        label="Pass"
                        onClick={() => handleAction("PASS")}
                        color="default"
                        icon="check"
                      />
                    </>
                  )}
                {isBlockChallengePhase && !isBlocker && !hasPassed && (
                  <>
                    <ActionButton
                      label="Challenge Block"
                      onClick={() => handleAction("CHALLENGE")}
                      color="rose"
                      icon="gavel"
                    />
                    <ActionButton
                      label="Pass"
                      onClick={() => handleAction("PASS")}
                      color="default"
                      icon="check"
                    />
                  </>
                )}
                {(isActor ||
                  hasPassed ||
                  (isBlockChallengePhase && isBlocker)) && (
                  <div className="text-on-surface-variant font-label-md p-4 bg-surface-container rounded-xl">
                    Waiting for others...
                  </div>
                )}
              </div>
            </div>
          ) : isLossPhase ? (
            <div className="bg-error-container w-full max-w-2xl rounded-xl p-6 shadow-lg border border-error text-center">
              <span className="material-symbols-outlined text-4xl text-error mb-2">
                warning
              </span>
              <p className="font-headline-sm text-error uppercase">
                {isLoser
                  ? "Select influence to lose"
                  : `Waiting for ${gameState.players.find((p) => p.id === gameState.loserId)?.name}...`}
              </p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest w-full max-w-2xl rounded-xl p-6 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-surface-variant relative flex flex-col h-[250px]">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary-container"></div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface mb-4 shrink-0">
                Action Log
              </h2>
              <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {gameState.moveLog && gameState.moveLog.length > 0 ? (
                  gameState.moveLog.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center space-x-3 bg-surface-container-low p-3 rounded-lg border-l-4 border-primary"
                    >
                      <span
                        className="material-symbols-outlined text-primary"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        history
                      </span>
                      <p className="font-body-md text-on-surface text-sm leading-tight">
                        {m.details}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-on-surface-variant italic text-sm">
                    Game has started.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {isExchangePhase && gameState.exchangeOptions && (
          <ExchangeSelectionOverlay
            options={gameState.exchangeOptions}
            count={
              myPlayer?.influences?.filter((i) => !i.isRevealed).length || 0
            }
            onConfirm={(selected) =>
              sendMessage({
                type: "COUP_ACTION",
                actionType: "FINALIZE_EXCHANGE",
                selectedRoles: selected,
              })
            }
          />
        )}

        {/* Player Area */}
        <div className="mt-auto pt-8 flex flex-col items-center w-full">
          <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12 w-full max-w-2xl mb-8">
            {/* Player Cards */}
            <div className="flex space-x-4">
              {myPlayer?.influences?.map((inf, i) => (
                <div
                  key={i}
                  onClick={() =>
                    isLossPhase &&
                    isLoser &&
                    !inf.isRevealed &&
                    handleAction("LOSE_INFLUENCE", undefined, {
                      influenceIndex: i,
                    })
                  }
                  className={
                    isLossPhase && isLoser && !inf.isRevealed
                      ? "cursor-pointer ring-4 ring-error/50 rounded-xl"
                      : ""
                  }
                >
                  <InfluenceCard role={inf.role} isRevealed={inf.isRevealed} />
                </div>
              ))}
            </div>

            {/* Player Coins */}
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 md:w-24 md:h-24 bg-primary-container rounded-full flex items-center justify-center shadow-[0_10px_20px_-10px_rgba(249,115,22,0.5)] mb-2">
                <span className="font-headline-lg text-headline-lg text-on-primary text-4xl md:text-5xl">
                  {myPlayer?.coins}
                </span>
              </div>
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                Coins
              </span>
            </div>
          </div>

          {/* Actions Bar */}
          {!isResponsePhase && !isLossPhase && !isGameOver && (
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2 md:gap-4 w-full max-w-4xl justify-center">
              <ActionButton
                label="Income"
                onClick={() => handleAction("INCOME")}
                disabled={!isMyTurn}
                icon="paid"
              />
              <ActionButton
                label="Foreign Aid"
                onClick={() => handleAction("FOREIGN_AID")}
                disabled={!isMyTurn}
                icon="public"
              />
              <ActionButton
                label="Tax"
                onClick={() => handleAction("TAX")}
                disabled={!isMyTurn}
                icon="account_balance"
              />
              <ActionButton
                label="Assassinate"
                onClick={() => {
                  if (!selectedTarget) {
                    alert("Select a target first!");
                    return;
                  }
                  handleAction("ASSASSINATE", selectedTarget);
                }}
                disabled={!isMyTurn || (myPlayer?.coins || 0) < 3}
                icon="sports_martial_arts"
                color="indigo"
              />
              <ActionButton
                label="Steal"
                onClick={() => {
                  if (!selectedTarget) {
                    alert("Select a target first!");
                    return;
                  }
                  handleAction("STEAL", selectedTarget);
                }}
                disabled={!isMyTurn}
                icon="front_hand"
              />
              <ActionButton
                label="Exchange"
                onClick={() => handleAction("EXCHANGE")}
                disabled={!isMyTurn}
                icon="sync_alt"
              />
              <ActionButton
                label="Coup"
                onClick={() => {
                  if (!selectedTarget) {
                    alert("Select a target first!");
                    return;
                  }
                  handleAction("COUP", selectedTarget);
                }}
                disabled={!isMyTurn || (myPlayer?.coins || 0) < 7}
                icon="gavel"
                color="rose"
                className="col-span-3 md:col-span-1"
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  color = "emerald",
  icon,
  className = "",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: "emerald" | "rose" | "default" | "indigo";
  icon?: string;
  className?: string;
}) {
  const styles = {
    emerald:
      "bg-surface-container-lowest border-surface-variant hover:border-secondary hover:shadow-[0_5px_15px_-5px_rgba(0,99,152,0.2)] text-on-surface-variant",
    rose: "bg-error-container border-error hover:border-error hover:shadow-[0_5px_15px_-5px_rgba(186,26,26,0.2)] text-error",
    indigo:
      "bg-primary-fixed border-primary shadow-[0_10px_20px_-10px_rgba(249,115,22,0.3)] hover:-translate-y-1 text-primary",
    default:
      "bg-surface-container-low border-outline-variant hover:bg-surface-container text-on-surface",
  };

  const iconColors = {
    emerald: "group-hover:text-secondary",
    rose: "text-error",
    indigo: "text-primary",
    default: "text-on-surface",
  };

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`
        flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 group border
        ${disabled ? "opacity-50 cursor-not-allowed bg-surface-variant border-outline-variant" : styles[color]}
        ${className}
      `}
    >
      {icon && (
        <span
          className={`material-symbols-outlined mb-1 ${disabled ? "text-outline" : iconColors[color]}`}
          style={{ fontVariationSettings: "'FILL' 0" }}
        >
          {icon}
        </span>
      )}
      <span
        className={`font-label-md text-label-md text-xs ${color === "indigo" ? "font-bold text-primary" : "text-on-surface"}`}
      >
        {label}
      </span>
    </button>
  );
}
