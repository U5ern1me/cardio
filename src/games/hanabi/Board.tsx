import { useState } from "react";
import { useGame } from "../../context/GameContextStore";
import RulesButton from "../../components/RulesButton";
import type { GameState, HanabiColor, HanabiRank, Player, Card } from "./types";

const COLORS: HanabiColor[] = ["RED", "BLUE", "GREEN", "YELLOW", "WHITE"];
const RANKS: HanabiRank[] = [1, 2, 3, 4, 5];

const colorConfig: Record<
  HanabiColor,
  { bg: string; text: string; shadow: string; border: string; bgLow: string }
> = {
  RED: {
    bg: "bg-red-500",
    text: "text-red-500",
    shadow: "shadow-red-500/20",
    border: "border-red-500",
    bgLow: "bg-red-500/10",
  },
  BLUE: {
    bg: "bg-blue-500",
    text: "text-blue-500",
    shadow: "shadow-blue-500/20",
    border: "border-blue-500",
    bgLow: "bg-blue-500/10",
  },
  GREEN: {
    bg: "bg-green-500",
    text: "text-green-500",
    shadow: "shadow-green-500/20",
    border: "border-green-500",
    bgLow: "bg-green-500/10",
  },
  YELLOW: {
    bg: "bg-yellow-400",
    text: "text-yellow-500",
    shadow: "shadow-yellow-500/20",
    border: "border-yellow-400",
    bgLow: "bg-yellow-400/10",
  },
  WHITE: {
    bg: "bg-white",
    text: "text-outline",
    shadow: "shadow-outline/10",
    border: "border-outline-variant",
    bgLow: "bg-surface-variant",
  },
  HIDDEN: {
    bg: "bg-slate-700",
    text: "text-transparent",
    shadow: "shadow-black/50",
    border: "border-slate-600",
    bgLow: "bg-slate-700/20",
  },
};

export default function HanabiBoard() {
  const { state: gameState, sendAction, playerId, clearSession } = useGame();
  const state = gameState as GameState;
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(
    null,
  );
  const [hintTarget, setHintTarget] = useState<string | null>(null);
  const [hintType, setHintType] = useState<"COLOR" | "RANK" | null>(null);
  const [hintValue, setHintValue] = useState<HanabiColor | HanabiRank | null>(
    null,
  );

  if (!state || state.gameType !== "HANABI") return null;

  const currentPlayer = state.players.find((p) => p.id === playerId);
  const isCurrentPlayerTurn =
    state.players[state.activePlayerIndex]?.id === playerId;
  const opponents = state.players.filter((p) => p.id !== playerId);

  const handlePlayCard = () => {
    if (selectedCardIndex !== null && isCurrentPlayerTurn) {
      sendAction({ type: "PLAY_CARD", cardIndex: selectedCardIndex });
      setSelectedCardIndex(null);
    }
  };

  const handleDiscardCard = () => {
    if (selectedCardIndex !== null && isCurrentPlayerTurn) {
      sendAction({ type: "DISCARD_CARD", cardIndex: selectedCardIndex });
      setSelectedCardIndex(null);
    }
  };

  const handleGiveHint = () => {
    if (
      hintTarget &&
      hintType &&
      hintValue &&
      state.hintTokens > 0 &&
      isCurrentPlayerTurn
    ) {
      sendAction({
        type: "GIVE_HINT",
        targetPlayerId: hintTarget,
        hintType,
        hintValue,
      });
      setHintTarget(null);
      setHintType(null);
      setHintValue(null);
    }
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body-md">
      {/* Header */}
      <header className="flex justify-between items-center p-4 border-b border-outline-variant bg-surface-container-lowest z-20">
        <div>
          <h1 className="font-headline-sm text-headline-sm text-on-surface">
            Hanabi
          </h1>
          <span className="font-label-md text-[10px] text-primary uppercase tracking-widest">
            {state.phase?.replaceAll("_", " ")}
          </span>
        </div>
        <div className="flex gap-3 items-center">
          <RulesButton />
          <button
            onClick={() => confirm("Leave this session?") && clearSession()}
            className="text-error hover:text-on-error hover:bg-error px-3 py-1.5 rounded-lg font-label-md text-xs transition-colors"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="flex-grow pt-4 md:pt-6 px-4 md:px-6 pb-8 max-w-7xl mx-auto w-full flex flex-col gap-6">
        {/* Status Bar */}
        <section className="bg-surface-container-lowest rounded-xl shadow-[0_20px_40px_-15px_rgba(249,115,22,0.1)] border border-outline-variant p-4 md:p-6 flex flex-wrap gap-4 justify-between items-center relative overflow-hidden">
          <div className="flex flex-col relative z-10">
            <span className="font-label-md text-xs md:text-label-md text-on-surface-variant uppercase tracking-widest">
              Score
            </span>
            <span className="font-headline-lg-mobile md:font-headline-lg text-4xl md:text-[48px] text-primary leading-none">
              {state.score || 0}
            </span>
          </div>

          <div className="flex gap-6 relative z-10">
            <div className="flex flex-col items-center">
              <div className="flex gap-0.5 md:gap-1 text-secondary">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span
                    key={i}
                    className={`material-symbols-outlined text-lg md:text-2xl ${i < state.hintTokens ? "" : "opacity-20"}`}
                    style={{
                      fontVariationSettings:
                        i < state.hintTokens ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >
                    lightbulb
                  </span>
                ))}
              </div>
              <span className="font-label-md text-[10px] md:text-label-md text-on-surface-variant mt-2">
                Hints ({state.hintTokens})
              </span>
            </div>
            <div className="flex flex-col items-center">
              <div className="flex gap-0.5 md:gap-1 text-error">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span
                    key={i}
                    className={`material-symbols-outlined text-lg md:text-2xl ${i < state.mistakeTokens ? "" : "opacity-20"}`}
                    style={{
                      fontVariationSettings:
                        i < state.mistakeTokens ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >
                    close
                  </span>
                ))}
              </div>
              <span className="font-label-md text-[10px] md:text-label-md text-on-surface-variant mt-2">
                Mistakes ({state.mistakeTokens})
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="font-headline-sm text-lg md:text-headline-sm text-on-surface leading-none pt-1">
                {state.turnsLeft !== null
                  ? state.turnsLeft
                  : state.deck?.length || 0}
              </span>
              <span className="font-label-md text-[10px] md:text-label-md text-on-surface-variant mt-2">
                {state.turnsLeft !== null ? "Turns Left" : "Deck"}
              </span>
            </div>
          </div>
        </section>

        {/* Central Play Area (Fireworks Stacks) */}
        <section className="grid grid-cols-5 gap-2 md:gap-4 flex-grow">
          {COLORS.map((color) => {
            const conf = colorConfig[color];
            const val =
              state.playArea?.[color as Exclude<HanabiColor, "HIDDEN">] || 0;
            return (
              <div
                key={color}
                className={`bg-surface-container-lowest rounded-xl border border-outline-variant h-32 md:h-64 flex flex-col items-center justify-end p-2 relative overflow-hidden group shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)]`}
              >
                <div
                  className={`absolute inset-0 ${conf.bgLow} opacity-50`}
                ></div>
                <div
                  className={`w-full h-full border-2 border-dashed ${conf.border} opacity-30 rounded-lg flex items-center justify-center absolute inset-2 pointer-events-none`}
                >
                  <span
                    className={`font-headline-lg-mobile text-5xl md:text-8xl opacity-20 ${conf.text}`}
                  >
                    {color[0]}
                  </span>
                </div>

                {val > 0 && (
                  <div
                    className={`w-full aspect-[2/3] ${conf.bg} rounded-lg shadow-md flex items-center justify-center ${color === "WHITE" ? "text-on-surface border border-outline-variant" : "text-white"} font-headline-lg-mobile md:font-headline-lg text-3xl md:text-[48px] z-10 transform transition-transform group-hover:-translate-y-2`}
                  >
                    {val}
                  </div>
                )}
                <div
                  className={`absolute bottom-1 right-2 ${conf.text} font-label-md text-[8px] md:text-xs opacity-50 z-10 hidden md:block`}
                >
                  {color}
                </div>
              </div>
            );
          })}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Player Hands (Others) */}
          <section className="lg:col-span-2 bg-surface-container-low rounded-xl p-4 md:p-6 shadow-inner">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-sm text-headline-sm text-secondary">
                Other Players
              </h3>
              {isCurrentPlayerTurn && (
                <span className="bg-primary-fixed text-on-primary-fixed px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest animate-pulse shadow-sm">
                  Your Turn
                </span>
              )}
            </div>

            <div className="space-y-4">
              {opponents.map((p: Player) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 bg-surface-container-lowest p-3 md:p-4 rounded-xl border border-outline-variant shadow-sm"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-label-md text-xs md:text-label-md text-secondary font-bold uppercase tracking-wider">
                      {p.name}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-grow overflow-x-auto pb-2 custom-scrollbar">
                    {(p.hand || []).map((card: Card, idx: number) => {
                      const conf =
                        colorConfig[card.color as HanabiColor] ||
                        colorConfig.WHITE;
                      return (
                        <div
                          key={idx}
                          className={`w-12 md:w-16 aspect-[2/3] ${conf.bg} ${card.color === "WHITE" ? "border border-outline-variant text-on-surface" : "text-white"} rounded shadow flex flex-col items-center justify-center font-headline-sm text-lg md:text-headline-sm relative shrink-0`}
                        >
                          {card.rank}
                        </div>
                      );
                    })}
                    {(!p.hand || p.hand.length === 0) && (
                      <span className="text-on-surface-variant text-sm italic">
                        No cards
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Action Area / Give Hint */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_20px_40px_-15px_rgba(249,115,22,0.1)] border border-outline-variant p-4 md:p-6 flex flex-col gap-4 relative">
            <h3 className="font-headline-sm text-headline-sm text-primary">
              Give Hint
            </h3>

            <div className="flex flex-col gap-2">
              <label className="font-label-md text-xs md:text-label-md text-on-surface-variant">
                Target Player
              </label>
              <select
                value={hintTarget || ""}
                onChange={(e) => setHintTarget(e.target.value)}
                className="form-select w-full bg-surface rounded-lg border-outline-variant text-body-md p-2 md:p-3 focus:ring-2 focus:ring-secondary focus:border-secondary outline-none"
                disabled={!isCurrentPlayerTurn || state.hintTokens === 0}
              >
                <option value="">Select a player</option>
                {opponents.map((p: Player) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-label-md text-xs md:text-label-md text-on-surface-variant">
                Hint Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setHintType("COLOR");
                    setHintValue(null);
                  }}
                  disabled={!isCurrentPlayerTurn || state.hintTokens === 0}
                  className={`rounded-lg py-2 md:py-3 font-label-md text-xs md:text-label-md transition-colors ${hintType === "COLOR" ? "bg-secondary text-on-secondary shadow-sm" : "bg-surface border border-outline-variant text-on-surface hover:bg-surface-container-low disabled:opacity-50"}`}
                >
                  Color
                </button>
                <button
                  onClick={() => {
                    setHintType("RANK");
                    setHintValue(null);
                  }}
                  disabled={!isCurrentPlayerTurn || state.hintTokens === 0}
                  className={`rounded-lg py-2 md:py-3 font-label-md text-xs md:text-label-md transition-colors ${hintType === "RANK" ? "bg-secondary text-on-secondary shadow-sm" : "bg-surface border border-outline-variant text-on-surface hover:bg-surface-container-low disabled:opacity-50"}`}
                >
                  Number
                </button>
              </div>
            </div>

            {hintType && (
              <div className="flex flex-col gap-2 mt-2 animate-in fade-in">
                <label className="font-label-md text-xs md:text-label-md text-on-surface-variant">
                  Select {hintType === "COLOR" ? "Color" : "Number"}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {hintType === "COLOR" &&
                    COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setHintValue(color)}
                        className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 transition-all ${colorConfig[color].bg} ${hintValue === color ? "ring-2 ring-offset-2 ring-secondary scale-110" : "opacity-70 hover:opacity-100"}`}
                      />
                    ))}
                  {hintType === "RANK" &&
                    RANKS.map((rank) => (
                      <button
                        key={rank}
                        onClick={() => setHintValue(rank)}
                        className={`w-8 h-8 md:w-10 md:h-10 rounded-full border flex items-center justify-center font-label-md transition-all ${hintValue === rank ? "bg-secondary text-on-secondary border-secondary shadow-sm scale-110" : "border-outline-variant hover:bg-surface-container-low text-on-surface"}`}
                      >
                        {rank}
                      </button>
                    ))}
                </div>
              </div>
            )}

            <button
              onClick={handleGiveHint}
              disabled={
                !isCurrentPlayerTurn ||
                !hintTarget ||
                !hintType ||
                !hintValue ||
                state.hintTokens === 0
              }
              className="mt-auto w-full bg-primary text-white font-label-md py-3 md:py-4 rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Hint
            </button>

            {!isCurrentPlayerTurn && (
              <div className="absolute inset-0 bg-surface/50 backdrop-blur-[1px] rounded-xl z-10 flex items-center justify-center">
                <span className="bg-surface-container px-4 py-2 rounded-full font-label-md text-sm shadow">
                  Not Your Turn
                </span>
              </div>
            )}
          </section>
        </div>

        {/* My Hand (Self) */}
        {currentPlayer && (
          <section className="mt-auto bg-surface-container-lowest p-4 md:p-6 rounded-xl border border-outline-variant shadow-sm relative">
            <h3 className="font-headline-sm text-sm md:text-headline-sm mb-4 text-on-surface-variant text-center">
              My Hand{" "}
              {isCurrentPlayerTurn && (
                <span className="text-primary">(Your Turn)</span>
              )}
            </h3>

            <div className="flex justify-center gap-2 md:gap-4 flex-wrap">
              {(currentPlayer.hand || []).map((card: Card, idx: number) => {
                const isSelected = selectedCardIndex === idx;
                // Use colors/ranks if available, otherwise just show as hidden
                const hasColor = !!card.color;
                const hasRank = !!card.rank;
                const conf = hasColor
                  ? colorConfig[card.color as HanabiColor]
                  : null;

                return (
                  <div key={idx} className="flex flex-col items-center gap-2">
                    <div
                      onClick={() =>
                        isCurrentPlayerTurn && setSelectedCardIndex(idx)
                      }
                      className={`w-16 md:w-28 aspect-[2/3] rounded-lg shadow-md flex flex-col items-center justify-center relative overflow-hidden transition-all cursor-pointer ${isSelected ? "ring-4 ring-primary scale-110 -translate-y-4" : "hover:-translate-y-2"} ${hasColor && conf ? `${conf.bg} ${card.color === "WHITE" ? "border border-outline-variant text-on-surface" : "text-white"}` : "bg-surface-container-highest border border-outline-variant"}`}
                    >
                      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary via-surface to-surface"></div>

                      {hasRank ? (
                        <span className="font-headline-lg-mobile md:font-headline-lg text-3xl md:text-6xl z-10 relative drop-shadow-sm">
                          {card.rank}
                        </span>
                      ) : (
                        <span className="material-symbols-outlined text-outline text-3xl md:text-5xl opacity-30 z-10">
                          visibility_off
                        </span>
                      )}

                      {/* Show hint tags if the logic provides them in state (assuming hintColor/hintRank could exist) */}
                      <div className="absolute top-1 left-1 right-1 flex justify-between gap-1">
                        {(card.hintedColor || hasColor) && (
                          <span
                            className={`w-3 h-3 md:w-4 md:h-4 rounded-full shadow-sm border border-outline/20 ${conf ? conf.bg : ""}`}
                          />
                        )}
                        {(card.hintedRank || hasRank) && (
                          <span className="bg-surface/80 rounded px-1 font-label-md text-[8px] md:text-xs text-on-surface shadow-sm">
                            {card.hintedRank || card.rank}
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelected && isCurrentPlayerTurn && (
                      <div className="flex gap-1 animate-in slide-in-from-top-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayCard();
                          }}
                          className="bg-green-500 hover:bg-green-600 text-white p-1 md:p-2 rounded-full shadow transition-all"
                          title="Play"
                        >
                          <span
                            className="material-symbols-outlined text-sm md:text-base"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            play_arrow
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDiscardCard();
                          }}
                          className="bg-error hover:bg-error/90 text-white p-1 md:p-2 rounded-full shadow transition-all"
                          title="Discard"
                        >
                          <span
                            className="material-symbols-outlined text-sm md:text-base"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            delete
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Game Over Overlay */}
        {state.phase === "GAME_OVER" && (
          <div className="fixed inset-0 bg-surface/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-surface-container-lowest max-w-md w-full rounded-3xl p-8 md:p-12 shadow-2xl border-2 border-primary text-center">
              <span
                className="material-symbols-outlined text-[64px] text-primary mb-4"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                star
              </span>
              <h2 className="font-headline-lg text-headline-lg text-on-surface">
                Game Over
              </h2>
              <div className="my-6">
                <p className="font-label-md text-on-surface-variant uppercase tracking-widest">
                  Final Score
                </p>
                <p className="font-headline-lg text-[64px] text-secondary leading-none">
                  {state.score}
                </p>
                <p className="font-body-md text-on-surface-variant mt-2">
                  out of 25
                </p>
              </div>
              {state.score === 25 && (
                <p className="font-headline-sm text-primary mb-6 animate-pulse">
                  Perfect Score!
                </p>
              )}
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-primary text-white py-4 rounded-xl font-label-md shadow-md active:scale-95 transition-all"
              >
                Back to Lobby
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
