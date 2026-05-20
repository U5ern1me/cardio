import { useGame } from "../../context/GameContextStore";
import RulesButton from "../../components/RulesButton";
import type { GameState, Card, Player } from "./types";

const suitIconNames: Record<string, string> = {
  SPADE: "playing_cards",
  CLUB: "playing_cards",
  HEART: "favorite",
  DIAMOND: "favorite",
};

const suitColors: Record<string, string> = {
  SPADE: "text-on-surface",
  CLUB: "text-on-surface",
  HEART: "text-error",
  DIAMOND: "text-error",
};

export default function SpadesBoard() {
  const { state: gameState, sendAction, playerId } = useGame();
  const state = gameState as GameState;

  if (!state || state.gameType !== "SPADES") return null;

  const currentPlayer = state.players.find((p) => p.id === playerId);
  const myIndex = state.players.findIndex((p) => p.id === playerId);
  const isCurrentPlayerTurn =
    state.players[state.activePlayerIndex]?.id === playerId;

  const getPlayerRelative = (offset: number): Player | null => {
    if (myIndex === -1 || state.players.length === 0) return null;
    return state.players[(myIndex + offset) % state.players.length] as Player;
  };

  const partner = getPlayerRelative(2);
  const leftOpponent = getPlayerRelative(1);
  const rightOpponent = getPlayerRelative(3);

  const handlePlaceBid = (bidAmount: number) => {
    if (isCurrentPlayerTurn && state.phase === "BIDDING") {
      sendAction({ type: "PLACE_BID", bid: bidAmount });
    }
  };

  const handlePlayCard = (card: Card) => {
    if (isCurrentPlayerTurn && state.phase === "PLAYING") {
      sendAction({ type: "PLAY_CARD", card });
    }
  };

  const myTeam = currentPlayer?.team || "TEAM_A";
  const otherTeam = myTeam === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const myTeamScore = myTeam === "TEAM_A" ? state.teamAScore : state.teamBScore;
  const otherTeamScore =
    otherTeam === "TEAM_A" ? state.teamAScore : state.teamBScore;

  const renderPlayerAvatar = (player: Player | null, isPartner: boolean) => {
    if (!player) return null;
    const isTheirTurn =
      state.players[state.activePlayerIndex]?.id === player.id;
    return (
      <div
        className={`bg-surface-container-lowest px-6 py-3 rounded-xl border-2 ${isPartner ? "border-primary" : "border-secondary"} shadow-sm flex flex-col items-center relative overflow-hidden`}
      >
        {isTheirTurn && (
          <div
            className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[currentColor] to-transparent animate-pulse text-[currentColor] opacity-50"
            style={{
              color: isPartner
                ? "var(--color-primary)"
                : "var(--color-secondary)",
            }}
          ></div>
        )}
        <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">
          {player.name} {isPartner ? "(P)" : ""}
        </span>
        {state.phase === "BIDDING" ? (
          <div
            className={`font-headline-md text-headline-md ${isPartner ? "text-primary" : "text-secondary"} flex items-center h-[38px] gap-2`}
          >
            {player.bid !== null ? (
              <span>Bid: {player.bid}</span>
            ) : isTheirTurn ? (
              <>
                <span>Bidding</span>
                <div className="flex items-center gap-1">
                  <span
                    className={`w-2 h-2 rounded-full ${isPartner ? "bg-primary" : "bg-secondary"} animate-pulse`}
                  ></span>
                  <span
                    className={`w-2 h-2 rounded-full ${isPartner ? "bg-primary" : "bg-secondary"} animate-pulse delay-75`}
                  ></span>
                  <span
                    className={`w-2 h-2 rounded-full ${isPartner ? "bg-primary" : "bg-secondary"} animate-pulse delay-150`}
                  ></span>
                </div>
              </>
            ) : (
              <span className="text-surface-variant">Wait</span>
            )}
          </div>
        ) : (
          <div
            className={`font-headline-md text-headline-md ${isPartner ? "text-primary" : "text-secondary"} flex items-center h-[38px]`}
          >
            {player.bid !== null ? `Bid: ${player.bid}` : ""}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col py-8 overflow-hidden">
      <main className="flex-grow max-w-7xl w-full mx-auto px-container-margin pb-section-gap flex flex-col gap-gutter">
        <header className="flex justify-between items-center pb-4 border-b border-outline-variant mb-6">
          <div>
            <h1 className="font-headline-sm text-headline-sm text-on-surface">
              Spades{" "}
              <span className="text-outline-variant text-sm ml-2">
                #{state.sessionId}
              </span>
            </h1>
            <span className="font-label-md text-[10px] text-primary uppercase tracking-widest">
              {state.phase}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <RulesButton />
            <button
              onClick={() =>
                confirm("Leave this session?") && sendAction({ type: "LEAVE" })
              }
              className="text-error hover:text-on-error hover:bg-error px-3 py-1.5 rounded-lg font-label-md text-xs transition-colors"
            >
              Leave
            </button>
          </div>
        </header>
        {/* Scoreboard Header */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-gutter mb-8">
          {/* Team A (Us) */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border-t-4 border-primary relative overflow-hidden flex flex-col justify-between">
            <div className="absolute -right-4 -top-4 opacity-5 text-primary">
              <span
                className="material-symbols-outlined text-[120px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                playing_cards
              </span>
            </div>
            <div className="flex justify-between items-start z-10">
              <div>
                <h2 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-1">
                  Team {myTeam === "TEAM_A" ? "A" : "B"} (Us)
                </h2>
                <div className="font-headline-lg text-headline-lg text-primary">
                  {myTeamScore?.score || 0}
                </div>
              </div>
              <div className="text-right">
                <div className="font-label-md text-label-md text-on-surface-variant mb-1">
                  Bags
                </div>
                <div className="font-headline-sm text-headline-sm text-on-surface">
                  {myTeamScore?.bags || 0}/10
                </div>
              </div>
            </div>
            <div className="w-full bg-surface-container h-2 rounded-full mt-6 overflow-hidden z-10">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(((myTeamScore?.bags || 0) / 10) * 100, 100)}%`,
                }}
              ></div>
            </div>
          </div>

          {/* Team B (Them) */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border-t-4 border-secondary relative overflow-hidden flex flex-col justify-between">
            <div className="absolute -right-4 -top-4 opacity-5 text-secondary">
              <span
                className="material-symbols-outlined text-[120px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                playing_cards
              </span>
            </div>
            <div className="flex justify-between items-start z-10">
              <div>
                <h2 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-1">
                  Team {otherTeam === "TEAM_A" ? "A" : "B"} (Them)
                </h2>
                <div className="font-headline-lg text-headline-lg text-secondary">
                  {otherTeamScore?.score || 0}
                </div>
              </div>
              <div className="text-right">
                <div className="font-label-md text-label-md text-on-surface-variant mb-1">
                  Bags
                </div>
                <div className="font-headline-sm text-headline-sm text-on-surface">
                  {otherTeamScore?.bags || 0}/10
                </div>
              </div>
            </div>
            <div className="w-full bg-surface-container h-2 rounded-full mt-6 overflow-hidden z-10">
              <div
                className="bg-secondary h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(((otherTeamScore?.bags || 0) / 10) * 100, 100)}%`,
                }}
              ></div>
            </div>
          </div>
        </section>

        {/* Main Game Area (Table + Layout) */}
        <section className="bg-surface-container rounded-xl p-8 shadow-[inset_0_0_40px_rgba(0,0,0,0.02)] min-h-[400px] flex flex-col justify-between relative border border-outline-variant/30 mb-8">
          {/* Table Center Status */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none z-0">
            {state.phase === "GAME_OVER" ? (
              <div className="bg-surface-container-lowest px-8 py-6 rounded-3xl shadow-lg border-2 border-primary/50 flex flex-col items-center gap-4 text-center">
                <span
                  className="material-symbols-outlined text-primary text-[48px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  emoji_events
                </span>
                <h2 className="font-headline-lg text-headline-lg text-on-surface">
                  Game Over
                </h2>
                <p className="font-headline-sm text-headline-sm text-primary">
                  {(myTeamScore?.score || 0) > (otherTeamScore?.score || 0)
                    ? "Victory!"
                    : (myTeamScore?.score || 0) < (otherTeamScore?.score || 0)
                      ? "Defeat"
                      : "Tie!"}
                </p>
              </div>
            ) : (
              <>
                <div className="bg-surface-container-lowest px-6 py-3 rounded-full shadow-sm border border-outline-variant/50 flex items-center gap-3">
                  <span
                    className="material-symbols-outlined text-primary"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    campaign
                  </span>
                  <span className="font-headline-sm text-headline-sm text-on-surface">
                    {state.phase === "BIDDING"
                      ? "Bidding Phase"
                      : "Playing Phase"}
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant mt-4">
                  Target: 500
                </p>
              </>
            )}
          </div>

          {/* Current Trick Display (if playing) */}
          {state.phase === "PLAYING" &&
            state.currentTrick?.cards &&
            state.currentTrick.cards.length > 0 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 flex gap-4">
                {state.currentTrick.cards.map((play: { playerId: string; card: Card }, idx: number) => {
                  const isWinner = false; // Add logic if you want to highlight winning card later
                  return (
                    <div
                      key={idx}
                      className={`w-20 h-28 bg-white rounded-xl border-2 ${isWinner ? "border-primary ring-4 ring-primary/30" : "border-outline-variant"} shadow-lg flex flex-col justify-between p-2 transform rotate-[${(idx - 1.5) * 10}deg]`}
                    >
                      <span
                        className={`font-headline-md text-[20px] leading-none ${suitColors[play.card.suit]}`}
                      >
                        {play.card.rank}
                      </span>
                      <span
                        className={`material-symbols-outlined ${suitColors[play.card.suit]} text-[24px] self-center`}
                        style={{
                          fontVariationSettings:
                            play.card.suit === "SPADE" ||
                            play.card.suit === "CLUB"
                              ? "'FILL' 1"
                              : "'FILL' 0",
                        }}
                      >
                        {suitIconNames[play.card.suit]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

          {/* Top Player (Partner) */}
          <div className="flex justify-center w-full relative z-20">
            <div className="flex flex-col items-center gap-2">
              {renderPlayerAvatar(partner, true)}
            </div>
          </div>

          {/* Middle Players (Opponents) */}
          <div className="flex justify-between w-full mt-8 relative z-20">
            {/* Left Player */}
            <div className="flex flex-col items-center gap-2">
              {renderPlayerAvatar(leftOpponent, false)}
            </div>

            {/* Right Player */}
            <div className="flex flex-col items-center gap-2">
              {renderPlayerAvatar(rightOpponent, false)}
            </div>
          </div>

          {/* Bottom Player (You) */}
          <div className="flex justify-center w-full mt-8 relative z-20">
            <div className="flex flex-col items-center gap-2">
              <div
                className={`px-8 py-3 rounded-xl shadow-md flex flex-col items-center ${isCurrentPlayerTurn ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}
              >
                <span className="font-label-md text-label-md opacity-80 uppercase tracking-widest">
                  {isCurrentPlayerTurn ? "Your Turn" : "Waiting..."}
                </span>
                <span className="font-headline-md text-headline-md">
                  {state.phase === "BIDDING" && currentPlayer?.bid === null
                    ? "Place Bid"
                    : state.phase === "PLAYING" && isCurrentPlayerTurn
                      ? "Play Card"
                      : currentPlayer?.bid !== null
                        ? `Bid: ${currentPlayer?.bid}`
                        : "You"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Hand & Actions Area */}
        {currentPlayer &&
          (state.phase === "BIDDING" || state.phase === "PLAYING") && (
            <section className="bg-surface-container-lowest rounded-2xl p-6 sm:p-10 shadow-md border-2 border-primary/20 flex flex-col gap-6 sm:gap-10 overflow-hidden">
              <div className="flex justify-between items-end text-center w-full">
                <div className="w-full">
                  <h3 className="font-headline-lg text-headline-lg text-on-surface">
                    Your Hand
                  </h3>
                  <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
                    {state.phase === "BIDDING"
                      ? "Review your cards and predict your tricks."
                      : "Select a card to play."}
                  </p>
                </div>
              </div>

              {/* Visual representation of cards */}
              <div className="flex justify-center items-center gap-[-10px] overflow-visible py-8 -space-x-4 sm:-space-x-6 overflow-x-auto px-4 min-h-[160px] pb-12">
                {(currentPlayer.hand || []).map((card: Card, idx: number) => {
                  const totalCards = currentPlayer.hand?.length || 1;
                  const centerIdx = (totalCards - 1) / 2;
                  const offset = idx - centerIdx;
                  const rotation = offset * 4; // Spread angle
                  const translateY = Math.abs(offset) * 2;

                  return (
                    <button
                      key={idx}
                      disabled={
                        state.phase !== "PLAYING" || !isCurrentPlayerTurn
                      }
                      onClick={() => handlePlayCard(card)}
                      style={{
                        transform: `rotate(${rotation}deg) translateY(${translateY}px)`,
                        zIndex: idx + 10,
                      }}
                      className={`group w-20 sm:w-24 h-32 sm:h-36 bg-white rounded-xl border-2 shadow-md flex flex-col justify-between p-2 sm:p-3 transition-all duration-300 origin-bottom 
                      ${state.phase === "PLAYING" && isCurrentPlayerTurn ? "hover:-translate-y-8 cursor-pointer hover:shadow-xl hover:border-primary focus:outline-none focus:ring-4 focus:ring-primary/40" : "cursor-default"}
                      border-outline-variant hover:z-50
                    `}
                    >
                      <span
                        className={`font-headline-md text-[20px] sm:text-[24px] ${suitColors[card.suit]} leading-none text-left`}
                      >
                        {card.rank}
                      </span>
                      <span
                        className={`material-symbols-outlined ${suitColors[card.suit]} text-[28px] sm:text-[32px] self-center`}
                        style={{
                          fontVariationSettings:
                            card.suit === "SPADE" || card.suit === "CLUB"
                              ? "'FILL' 1"
                              : "'FILL' 0",
                        }}
                      >
                        {suitIconNames[card.suit]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Bidding Controls */}
              {state.phase === "BIDDING" && isCurrentPlayerTurn && (
                <div className="pt-8 border-t-2 border-surface-variant">
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 sm:gap-4 max-w-4xl mx-auto">
                    {/* Nil Bid */}
                    <button
                      onClick={() => handlePlaceBid(0)}
                      className="col-span-1 bg-surface-variant text-on-surface hover:bg-secondary-container hover:text-on-secondary-container rounded-xl py-3 sm:py-6 flex flex-col items-center justify-center transition-all active:scale-95 shadow-sm border border-transparent hover:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary"
                    >
                      <span className="font-headline-md text-headline-sm sm:text-headline-md leading-none">
                        0
                      </span>
                      <span className="font-label-md text-[10px] sm:text-label-md uppercase tracking-widest opacity-80">
                        Nil
                      </span>
                    </button>

                    {/* Standard Bids 1-13 */}
                    {Array.from({ length: 13 }).map((_, i) => (
                      <button
                        key={i + 1}
                        onClick={() => handlePlaceBid(i + 1)}
                        className="bg-surface-container-high text-on-surface hover:bg-primary hover:text-on-primary shadow-sm rounded-xl py-3 sm:py-6 font-headline-md text-headline-sm sm:text-headline-md transition-all active:scale-95 border border-transparent hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
      </main>
    </div>
  );
}
