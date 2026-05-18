import { useState } from "react";
import { useGame } from "../../context/GameContextStore";
import RulesButton from "../../components/RulesButton";
import type { GameState, LoveLetterRole } from "./types";

const ROLE_VALUES: Record<LoveLetterRole, number> = {
  GUARD: 1,
  PRIEST: 2,
  BARON: 3,
  HANDMAID: 4,
  PRINCE: 5,
  KING: 6,
  COUNTESS: 7,
  PRINCESS: 8,
  HIDDEN: 0,
};

const ROLE_ICONS: Record<LoveLetterRole, string> = {
  GUARD: "local_fire_department",
  PRIEST: "visibility",
  BARON: "shield",
  HANDMAID: "favorite",
  PRINCE: "swap_horiz",
  KING: "star",
  COUNTESS: "favorite_border",
  PRINCESS: "diamond",
  HIDDEN: "visibility_off",
};

const ROLE_DESC: Record<LoveLetterRole, string> = {
  GUARD: "Guess another player's hand. If correct, that player is knocked out.",
  PRIEST: "Look at another player's hand privately.",
  BARON: "Compare hands with another player. Lower value is knocked out.",
  HANDMAID:
    "Until your next turn, ignore all effects from other players' cards.",
  PRINCE:
    "Choose any player (including yourself) to discard their hand and draw a new card.",
  KING: "Trade hands with another player of your choice.",
  COUNTESS:
    "If you have this card and the King or Prince, you must discard this card.",
  PRINCESS: "If you discard this card, you are knocked out of the round.",
  HIDDEN: "Hidden card",
};

export default function LoveLetterBoard() {
  const { state: gameState, sendAction, playerId } = useGame();
  const state = gameState as GameState;
  const [selectedCardRole, setSelectedCardRole] =
    useState<LoveLetterRole | null>(null);
  const [targetPlayerId, setTargetPlayerId] = useState<string | null>(null);
  const [guessedRole, setGuessedRole] = useState<LoveLetterRole | null>(null);

  if (!state || state.gameType !== "LOVE_LETTER") return null;

  const currentPlayer = state.players.find((p) => p.id === playerId);
  const isCurrentPlayerTurn =
    state.players[state.activePlayerIndex]?.id === playerId;
  const opponents = state.players.filter((p) => p.id !== playerId);
  const lastDiscarded = state.discardPile?.[state.discardPile.length - 1];

  const handlePlayCard = () => {
    if (selectedCardRole && isCurrentPlayerTurn) {
      const action: any = { type: "PLAY_CARD", cardRole: selectedCardRole };

      if (
        targetPlayerId &&
        ["GUARD", "PRIEST", "BARON", "PRINCE", "KING"].includes(
          selectedCardRole,
        )
      ) {
        action.targetPlayerId = targetPlayerId;
      }
      if (selectedCardRole === "GUARD" && guessedRole) {
        action.guessedRole = guessedRole;
      }
      sendAction(action);
      setSelectedCardRole(null);
      setTargetPlayerId(null);
      setGuessedRole(null);
    }
  };

  const getAliveOtherPlayers = () =>
    state.players.filter((p) => p.id !== playerId && !p.isEliminated);

  return (
    <div className="bg-surface text-on-surface font-body-md min-h-screen flex flex-col antialiased">
      {/* Main Game Canvas */}
      <main className="flex-grow flex flex-col relative py-4 md:py-8 overflow-hidden max-w-7xl mx-auto w-full px-container-margin">
        {/* Game Stats Header */}
        <div className="flex justify-between items-center w-full py-base border-b border-surface-variant/50 mb-4 z-20 relative">
          <div className="flex items-center gap-base">
            <span
              className="material-symbols-outlined text-primary-container"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              cycle
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-tight">
              Round {state.currentRound}
            </h2>
          </div>
          <div className="flex items-center gap-base">
            <RulesButton />
            <div className="flex items-center gap-base bg-surface-container-low px-4 py-2 rounded-full border border-surface-variant">
              <span
                className="material-symbols-outlined text-secondary"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                style
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                Deck: {state.deck?.length || 0}
              </span>
            </div>
            <button
              onClick={() =>
                confirm("Leave this session?") && sendAction({ type: "LEAVE" })
              }
              className="text-error hover:text-on-error hover:bg-error px-3 py-1.5 rounded-lg font-label-md text-xs transition-colors"
            >
              Leave
            </button>
          </div>
        </div>

        {/* The Table (Opponents & Center) */}
        <div className="flex-grow flex flex-col relative w-full h-full justify-between items-center py-8">
          {/* Opponents Layout */}
          <div className="flex justify-center w-full relative h-[150px] mb-8">
            {opponents.map((p: any, index: number) => {
              // Simple arc positioning
              const positions = [
                "absolute top-0 left-1/2 transform -translate-x-1/2",
                "absolute top-8 left-1/4 transform -translate-x-1/2",
                "absolute top-8 right-1/4 transform translate-x-1/2",
                "absolute top-16 left-0",
                "absolute top-16 right-0",
              ];
              const positionClass = positions[index % positions.length];
              return (
                <div
                  key={p.id}
                  className={`${positionClass} flex flex-col items-center gap-2 transition-transform cursor-pointer ${p.isEliminated ? "opacity-40 grayscale" : ""} ${targetPlayerId === p.id ? "scale-110" : ""}`}
                  onClick={() => !p.isEliminated && setTargetPlayerId(p.id)}
                >
                  <div
                    className={`bg-surface-container-lowest px-4 py-1.5 rounded-full shadow-sm border flex items-center gap-3 ${state.players[state.activePlayerIndex]?.id === p.id ? "border-secondary ring-2 ring-secondary/20" : "border-surface-variant"} ${targetPlayerId === p.id ? "border-primary ring-2 ring-primary/50" : ""}`}
                  >
                    <span
                      className={`font-label-md text-label-md truncate max-w-[100px] md:max-w-[150px] ${p.isEliminated ? "line-through text-on-surface-variant" : "text-on-surface"}`}
                    >
                      {p.name}
                    </span>
                    {state.handmaidProtections?.includes(p.id) && (
                      <span
                        className="material-symbols-outlined text-secondary text-[16px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        shield
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <span
                        className="material-symbols-outlined text-primary-container text-[16px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        favorite
                      </span>
                      <span className="font-label-md text-label-md text-primary">
                        {p.tokens || 0}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center Discard Pile (Recently Played) */}
          <div className="flex flex-col items-center justify-center h-48 md:h-64 my-auto relative z-0 w-full">
            <span className="font-label-md text-[10px] md:text-label-md text-on-surface-variant mb-2 md:mb-4 uppercase tracking-widest">
              {lastDiscarded ? "Last Played" : "No Cards Played"}
            </span>

            {lastDiscarded ? (
              <div className="w-32 h-44 md:w-40 md:h-56 bg-surface-container-lowest rounded-xl border border-surface-variant shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] flex flex-col p-3 transform -rotate-6 transition-transform hover:rotate-0 duration-300">
                <div className="flex justify-between items-start w-full">
                  <span className="font-headline-sm text-headline-sm text-secondary">
                    {ROLE_VALUES[lastDiscarded.role as LoveLetterRole]}
                  </span>
                  <span
                    className="material-symbols-outlined text-secondary"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {ROLE_ICONS[lastDiscarded.role as LoveLetterRole]}
                  </span>
                </div>
                <div className="flex-grow flex items-center justify-center">
                  <div className="w-full h-16 md:h-24 bg-surface-container-high rounded-lg overflow-hidden relative flex items-center justify-center">
                    <span className="material-symbols-outlined text-4xl md:text-6xl text-outline-variant">
                      {ROLE_ICONS[lastDiscarded.role as LoveLetterRole]}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-center">
                  <h4 className="font-label-md text-xs md:text-label-md text-on-surface">
                    {lastDiscarded.role}
                  </h4>
                </div>
              </div>
            ) : (
              <div className="w-32 h-44 md:w-40 md:h-56 bg-surface-container rounded-xl border-2 border-dashed border-outline-variant flex items-center justify-center opacity-50">
                <span className="material-symbols-outlined text-outline-variant text-4xl">
                  inbox
                </span>
              </div>
            )}

            {/* Game Over Overlay */}
            {state.phase === "GAME_OVER" && (
              <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl shadow-xl border border-outline-variant">
                <span
                  className="material-symbols-outlined text-5xl text-primary mb-2"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  emoji_events
                </span>
                <h2 className="text-headline-md font-headline-md text-on-surface">
                  Game Over!
                </h2>
                <p className="font-label-md text-label-md text-secondary uppercase mt-2">
                  {state.players.find((p) => p.id === state.winner)?.name} Wins!
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Action Panel for Guard Guesses & Targets */}
        {isCurrentPlayerTurn &&
          selectedCardRole &&
          !state.players.find((p) => p.id === playerId)?.isEliminated && (
            <div className="w-full max-w-3xl mx-auto mb-6 p-4 md:p-6 bg-surface-container-lowest border-2 border-primary-container rounded-2xl shadow-lg z-20">
              <h3 className="font-headline-sm text-on-surface mb-4">
                Playing {selectedCardRole}
              </h3>

              {/* Target Selection */}
              {["GUARD", "PRIEST", "BARON", "PRINCE", "KING"].includes(
                selectedCardRole,
              ) && (
                <div className="mb-4">
                  <label className="font-label-md text-on-surface-variant uppercase tracking-wider text-xs block mb-2">
                    Select Target
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {getAliveOtherPlayers().length > 0 ? (
                      getAliveOtherPlayers().map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => setTargetPlayerId(p.id)}
                          className={`px-4 py-2 rounded-lg font-label-md text-sm border transition-all ${targetPlayerId === p.id ? "bg-primary text-on-primary border-primary shadow-md" : "bg-surface border-surface-variant hover:border-outline"}`}
                        >
                          {p.name}
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-on-surface-variant italic">
                        No valid targets. You must target yourself (if Prince)
                        or card has no effect.
                      </p>
                    )}
                    {selectedCardRole === "PRINCE" && (
                      <button
                        onClick={() => setTargetPlayerId(playerId)}
                        className={`px-4 py-2 rounded-lg font-label-md text-sm border transition-all ${targetPlayerId === playerId ? "bg-primary text-on-primary border-primary shadow-md" : "bg-surface border-surface-variant hover:border-outline"}`}
                      >
                        Yourself
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Guard Guess Selection */}
              {selectedCardRole === "GUARD" && targetPlayerId && (
                <div className="mb-4">
                  <label className="font-label-md text-on-surface-variant uppercase tracking-wider text-xs block mb-2">
                    Guess Their Card
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {(Object.keys(ROLE_ICONS) as LoveLetterRole[])
                      .filter((r) => r !== "GUARD")
                      .map((role) => (
                        <button
                          key={role}
                          onClick={() => setGuessedRole(role)}
                          className={`px-3 py-2 rounded-lg font-label-md text-xs border flex items-center justify-center gap-1 transition-all ${guessedRole === role ? "bg-secondary text-on-secondary border-secondary shadow-md" : "bg-surface border-surface-variant hover:border-outline"}`}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {ROLE_ICONS[role]}
                          </span>{" "}
                          {role}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Confirm Play */}
              <div className="flex justify-end mt-6 border-t border-surface-variant pt-4">
                <button
                  onClick={handlePlayCard}
                  disabled={
                    (["GUARD", "PRIEST", "BARON", "PRINCE", "KING"].includes(
                      selectedCardRole,
                    ) &&
                      !targetPlayerId) ||
                    (selectedCardRole === "GUARD" && !guessedRole)
                  }
                  className="bg-primary-container text-on-primary hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95 duration-200 px-6 py-3 rounded-xl font-label-md tracking-widest uppercase shadow-md flex gap-2 items-center"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    play_arrow
                  </span>{" "}
                  Confirm Play
                </button>
              </div>
            </div>
          )}

        {/* The User's Hand (Bottom Area) */}
        {currentPlayer && !currentPlayer.isEliminated && (
          <div className="w-full flex flex-col items-center justify-end z-10 mt-auto pt-4 relative">
            <div className="flex flex-wrap items-center justify-center gap-4 w-full max-w-3xl relative">
              {(currentPlayer.hand || []).map((card: any, idx: number) => {
                const isSelected = selectedCardRole === card.role;
                const roleValue = ROLE_VALUES[card.role as LoveLetterRole];
                const icon = ROLE_ICONS[card.role as LoveLetterRole];
                const desc = ROLE_DESC[card.role as LoveLetterRole];

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedCardRole(card.role)}
                    className={`
                      w-[140px] md:w-72 h-[220px] md:h-[420px] rounded-xl flex flex-col overflow-hidden transition-all duration-300 cursor-pointer group relative
                      ${isSelected ? "bg-primary-fixed/20 border-2 border-primary shadow-[0_20px_40px_-15px_rgba(249,115,22,0.3)] -translate-y-8 z-30" : "bg-surface-container-lowest border border-surface-variant shadow-[0_10px_20px_-10px_rgba(0,0,0,0.1)] hover:-translate-y-4 z-10"}
                    `}
                  >
                    {/* Inner Card content */}
                    <div className="p-3 md:p-4 flex justify-between items-start z-10 relative">
                      <span
                        className={`font-headline-lg ${isSelected ? "text-primary" : "text-on-surface"} text-2xl md:text-headline-lg drop-shadow-md`}
                      >
                        {roleValue}
                      </span>
                      <span
                        className={`material-symbols-outlined ${isSelected ? "text-primary" : "text-on-surface-variant"} text-2xl md:text-3xl drop-shadow-md`}
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {icon}
                      </span>
                    </div>

                    <div className="absolute inset-0 top-12 md:top-16 bottom-16 md:bottom-[160px] flex items-center justify-center opacity-10 group-hover:opacity-20 transition-opacity">
                      <span className="material-symbols-outlined text-[80px] md:text-[160px]">
                        {icon}
                      </span>
                    </div>

                    <div className="mt-auto p-3 md:p-6 z-10 relative flex flex-col bg-surface-container-lowest h-[80px] md:h-[160px] border-t border-surface-variant">
                      <h3
                        className={`font-headline-sm md:font-headline-md text-sm md:text-[32px] mb-1 md:mb-2 ${isSelected ? "text-primary" : "text-on-surface"}`}
                      >
                        {card.role}
                      </h3>
                      <p className="font-body-md text-[9px] md:text-body-md text-on-surface-variant leading-tight line-clamp-3 hidden md:block">
                        {desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6">
              <span className="font-label-md text-label-md text-on-surface bg-surface-container-high px-4 py-2 rounded-full shadow-sm">
                Your Tokens: {currentPlayer.tokens || 0}
              </span>
            </div>
          </div>
        )}

        {currentPlayer?.isEliminated && (
          <div className="mt-auto p-6 bg-error-container/50 border border-error rounded-xl text-center max-w-lg mx-auto w-full">
            <span className="material-symbols-outlined text-4xl text-error mb-2">
              sentiment_dissatisfied
            </span>
            <h3 className="font-headline-sm text-error">Eliminated</h3>
            <p className="text-on-error-container text-sm">
              You are out for this round. Waiting for the next round...
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
