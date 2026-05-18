import { useState, useMemo } from "react";
import { useGame } from "../../context/GameContextStore";
import RulesButton from "../../components/RulesButton";
import type {
  Card,
  Player,
  HalfSuitName,
  GameState as LiteratureGameState,
} from "./types";
import { getHalfSuit, getCardsInHalfSuit, isSameCard } from "./logic";

// ─── Constants ───────────────────────────────────────────

const SUIT_SYMBOLS: Record<string, string> = {
  CLUB: "♣",
  DIAMOND: "♦",
  HEART: "♥",
  SPADE: "♠",
};

const HALF_SUIT_LABELS: Record<string, string> = {
  LOW_CLUB: "Low Clubs",
  HIGH_CLUB: "High Clubs",
  LOW_DIAMOND: "Low Diamonds",
  HIGH_DIAMOND: "High Diamonds",
  LOW_HEART: "Low Hearts",
  HIGH_HEART: "High Hearts",
  LOW_SPADE: "Low Spades",
  HIGH_SPADE: "High Spades",
  EIGHTS_AND_JOKERS: "Eights & Jokers",
};

const ALL_HALF_SUITS: HalfSuitName[] = [
  "LOW_CLUB",
  "HIGH_CLUB",
  "LOW_DIAMOND",
  "HIGH_DIAMOND",
  "LOW_HEART",
  "HIGH_HEART",
  "LOW_SPADE",
  "HIGH_SPADE",
  "EIGHTS_AND_JOKERS",
];

const RANK_ORDER = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "Jk1",
  "Jk2",
];

function isRedSuit(suit: string) {
  return suit === "HEART" || suit === "DIAMOND";
}

function cardKey(c: Card) {
  return `${c.rank}-${c.suit}`;
}

// ─── Playing Card ────────────────────────────────────────

function PlayingCard({
  card,
  selected,
  onClick,
  size = "normal",
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  size?: "normal" | "small";
}) {
  const red = isRedSuit(card.suit) || card.rank === "Jk1";
  let symbol = SUIT_SYMBOLS[card.suit] || "?";
  let rank: React.ReactNode = card.rank;

  if (card.suit === "JOKER") {
    symbol = card.rank === "Jk1" ? "★" : "☆";
    rank = (
      <span className="material-symbols-outlined text-lg leading-none mt-1">
        theater_comedy
      </span>
    );
  }

  const isSmall = size === "small";
  const textColor = red ? "text-error" : "text-on-surface";

  const widthClass = isSmall ? "w-12" : "w-16 md:w-20";
  const heightClass = isSmall ? "h-16" : "h-24 md:h-28";

  return (
    <div
      onClick={onClick}
      className={`
        bg-surface border border-outline-variant rounded-lg shadow-sm flex flex-col justify-between p-1.5 md:p-2 cursor-pointer transition-transform
        ${widthClass} ${heightClass}
        ${selected ? "ring-2 ring-primary -translate-y-4 shadow-md" : ""}
      `}
    >
      <span
        className={`font-headline-sm flex justify-start items-start ${isSmall ? "text-xs md:text-sm" : "text-base md:text-headline-sm"} ${textColor} leading-none`}
      >
        {rank}
      </span>
      <span
        className={`${textColor} self-end font-headline-sm leading-none ${isSmall ? "text-sm" : "text-xl"}`}
      >
        {symbol}
      </span>
    </div>
  );
}

// ─── Player Seat ─────────────────────────────────────────

function PlayerSeat({
  player,
  isActive,
  cardCount,
}: {
  player: Player;
  isActive: boolean;
  cardCount: number;
}) {
  return (
    <div
      className={`bg-surface-container-lowest px-4 py-2 rounded-full shadow-md border ${isActive ? "border-primary ring-2 ring-primary/20 bg-primary-fixed/10" : "border-surface-variant"} flex items-center gap-3 transition-transform ${isActive ? "scale-105" : ""}`}
    >
      <span
        className={`font-label-md text-label-md ${isActive ? "text-primary" : "text-on-surface"}`}
      >
        {player.name}
      </span>
      <span className="text-secondary font-bold text-sm">
        {cardCount} Cards
      </span>
    </div>
  );
}

// ─── Ask Modal ───────────────────────────────────────────

function AskModal({
  opponents,
  myHand,
  onAsk,
  onClose,
}: {
  opponents: Player[];
  myHand: Card[];
  onAsk: (targetId: string, card: Card) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [target, setTarget] = useState<Player | null>(null);

  const myHalfSuits = useMemo(() => {
    const s = new Set<HalfSuitName>();
    myHand.forEach((c) => s.add(getHalfSuit(c)));
    return Array.from(s);
  }, [myHand]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-surface-container-lowest rounded-3xl p-6 md:p-8 w-full mx-4 shadow-2xl transition-all ${step === 1 ? "max-w-md" : "max-w-2xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-label-md text-primary uppercase tracking-widest mb-2">
          {step === 1 ? "Step 1: Target" : "Step 2: Choose Card"}
        </p>
        <h2 className="font-headline-sm text-headline-sm text-on-surface mb-6">
          {step === 1 ? "Choose an Opponent" : `Asking ${target?.name}`}
        </h2>

        {step === 1 && (
          <div className="grid grid-cols-1 gap-2">
            {opponents.map((op) => (
              <button
                key={op.id}
                onClick={() => {
                  setTarget(op);
                  setStep(2);
                }}
                className="w-full py-4 px-5 rounded-2xl text-left bg-surface-container hover:bg-surface-container-high transition-all font-label-md text-on-surface flex items-center justify-between group"
              >
                <span>{op.name}</span>
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary">
                  arrow_forward
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-6 custom-scrollbar">
            {myHalfSuits.map((hs) => {
              const allCards = getCardsInHalfSuit(hs);
              return (
                <div key={hs} className="space-y-3">
                  <h3 className="font-label-md text-xs text-on-surface-variant uppercase tracking-wider border-b border-outline-variant pb-1.5">
                    {HALF_SUIT_LABELS[hs]}
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {allCards.map((c) => {
                      const isHeld = myHand.some((m) => isSameCard(m, c));
                      return (
                        <div key={cardKey(c)} className="relative group">
                          <PlayingCard
                            card={c}
                            size="small"
                            onClick={() =>
                              !isHeld && target && onAsk(target.id, c)
                            }
                          />
                          {isHeld && (
                            <div className="absolute inset-0 bg-surface/60 backdrop-blur-[1px] flex items-center justify-center rounded-lg cursor-not-allowed">
                              <span className="text-[10px] font-label-md text-primary bg-primary-container px-2 py-1 rounded uppercase">
                                Held
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {myHalfSuits.length === 0 && (
              <p className="text-sm text-on-surface-variant text-center py-8">
                You don't hold any cards to start an ask!
              </p>
            )}
          </div>
        )}

        <div className="mt-8 flex gap-4">
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high font-label-md transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={onClose}
            className={`py-3 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high font-label-md transition-colors ${step === 1 ? "w-full" : "flex-1"}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Claim Modal ─────────────────────────────────────────

function ClaimModal({
  onClaim,
  onClose,
}: {
  onClaim: (halfSuit: HalfSuitName) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest rounded-3xl p-8 max-w-xl w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-6">
          <p className="text-xs font-label-md text-primary uppercase tracking-widest mb-2">
            Collection Claim
          </p>
          <h2 className="font-headline-md text-headline-md text-on-surface">
            Choose a Half-Suit
          </h2>
          <p className="text-body-md text-on-surface-variant mt-1">
            Select a book your team collectively holds.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {ALL_HALF_SUITS.map((hs) => (
            <button
              key={hs}
              onClick={() => onClaim(hs)}
              className="group relative flex flex-col items-center justify-center p-4 rounded-2xl bg-surface hover:bg-primary-container hover:text-on-primary-container border border-outline-variant hover:border-primary transition-all text-center"
            >
              <span className="font-label-md text-xs group-hover:text-on-primary-container text-on-surface leading-tight">
                {HALF_SUIT_LABELS[hs]}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-8 w-full py-3 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high font-label-md transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main Board ──────────────────────────────────────────

export default function LiteratureBoard() {
  const {
    gameState: baseState,
    myPlayerId,
    cardCounts,
    sendMessage,
    clearSession,
  } = useGame();
  const gameState = baseState as LiteratureGameState;
  const [showAskModal, setShowAskModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);

  if (!gameState || !myPlayerId) return null;

  const myHand = gameState.hands[myPlayerId] || [];
  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn = activePlayer?.id === myPlayerId;
  const myPlayer = gameState.players.find(
    (p: any) => p.id === myPlayerId,
  ) as Player;
  const opponents = gameState.players.filter(
    (p: any) => p.team !== myPlayer?.team,
  );
  const otherPlayers = gameState.players.filter(
    (p: any) => p.id !== myPlayerId,
  );

  // Group + sort hand
  const groupedHand: Record<string, Card[]> = {};
  myHand.forEach((c: any) => {
    const hs = getHalfSuit(c);
    if (!groupedHand[hs]) groupedHand[hs] = [];
    groupedHand[hs].push(c);
  });
  for (const hs of Object.keys(groupedHand)) {
    groupedHand[hs].sort(
      (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank),
    );
  }

  const handleAsk = (targetId: string, card: Card) => {
    sendMessage({ type: "ASK_CARD", askerId: myPlayerId, targetId, card });
    setShowAskModal(false);
  };

  const handleClaim = (halfSuit: HalfSuitName) => {
    sendMessage({ type: "CLAIM_BOOK", claimerId: myPlayerId, halfSuit });
    setShowClaimModal(false);
  };

  const seatPositions = [
    { top: "8%", left: "50%", transform: "translateX(-50%)" },
    { top: "22%", left: "12%" },
    { top: "22%", right: "12%", left: "auto" },
    { top: "50%", left: "8%" },
    { top: "50%", right: "8%", left: "auto" },
    { top: "68%", left: "25%" },
    { top: "68%", right: "25%", left: "auto" },
  ];

  return (
    <div className="bg-surface text-on-surface font-body-md h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center p-4 border-b border-outline-variant bg-surface-container-lowest z-50 relative">
        <div>
          <h1 className="font-headline-sm text-headline-sm text-on-surface">
            Literature{" "}
            <span className="text-outline-variant text-sm ml-2">
              #{gameState.sessionId}
            </span>
          </h1>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <span className="font-label-md text-xs uppercase tracking-widest text-primary">
              Team A
            </span>
            <span className="font-headline-sm text-on-surface">
              {gameState.scores.teamA}
            </span>
            <span className="text-outline-variant">|</span>
            <span className="font-label-md text-xs uppercase tracking-widest text-secondary">
              Team B
            </span>
            <span className="font-headline-sm text-on-surface">
              {gameState.scores.teamB}
            </span>
          </div>
          <RulesButton />
          <button
            onClick={() => confirm("Leave this session?") && clearSession()}
            className="text-error hover:text-on-error hover:bg-error px-3 py-1.5 rounded-lg font-label-md text-xs transition-colors"
          >
            Leave
          </button>
        </div>
      </header>

      {/* Main Game Canvas */}
      <main className="flex-1 relative flex flex-col items-center justify-center bg-surface-bright pb-[140px] md:pb-[160px] overflow-hidden">
        {/* Center Table */}
        <div className="w-56 h-56 md:w-80 md:h-80 rounded-full bg-surface-container-lowest border-2 border-surface-container-low shadow-[0_40px_80px_-20px_rgba(0,0,0,0.05)] flex items-center justify-center relative">
          <div className="text-center absolute">
            <span className="font-label-md text-secondary tracking-widest uppercase opacity-50">
              Literature
            </span>
          </div>

          {/* Claimed Books */}
          <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-2 p-8 overflow-hidden z-10">
            {gameState.books && gameState.books.length > 0 ? (
              gameState.books.map((book: any, idx: number) => (
                <div
                  key={`${book.halfSuit}-${idx}`}
                  className={`px-2 py-1 rounded text-[10px] font-bold shadow-sm ${book.team === "TEAM_A" ? "bg-primary-container text-on-primary-container" : "bg-secondary-container text-on-secondary-container"}`}
                >
                  {HALF_SUIT_LABELS[book.halfSuit]}
                </div>
              ))
            ) : (
              <>
                <div className="absolute w-16 h-24 bg-surface-container-low rounded-lg border border-outline-variant shadow-sm -rotate-6 translate-x-8 translate-y-8"></div>
                <div className="absolute w-16 h-24 bg-surface border border-outline shadow-sm rotate-3 flex items-center justify-center">
                  <span className="material-symbols-outlined text-outline text-3xl">
                    playing_cards
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Desktop Seats */}
        <div className="hidden md:block">
          {otherPlayers.map((p: any, i: number) => (
            <div
              key={p.id}
              className="absolute"
              style={
                seatPositions[i % seatPositions.length] as React.CSSProperties
              }
            >
              <PlayerSeat
                player={p}
                isActive={activePlayer?.id === p.id}
                cardCount={cardCounts[p.id] || 0}
              />
            </div>
          ))}
        </div>

        {/* Mobile Opponent Carousel */}
        <div className="md:hidden flex overflow-x-auto px-4 py-4 gap-3 no-scrollbar absolute top-0 left-0 w-full z-10 bg-surface/50 backdrop-blur-sm border-b border-outline-variant">
          {otherPlayers.map((p: any) => (
            <div key={p.id} className="flex-shrink-0">
              <PlayerSeat
                player={p}
                isActive={activePlayer?.id === p.id}
                cardCount={cardCounts[p.id] || 0}
              />
            </div>
          ))}
        </div>

        {/* Turn Indicator */}
        <div className="absolute top-[35%] md:top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10 w-full px-8 pointer-events-none">
          <div className="px-6 py-4 rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md shadow-md border border-outline-variant inline-block mx-auto min-w-[140px]">
            <p className="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest leading-none mb-1">
              Turn
            </p>
            <p className="font-headline-sm text-on-surface leading-none">
              {activePlayer
                ? activePlayer.name.length > 12
                  ? activePlayer.name.substring(0, 10) + "..."
                  : activePlayer.name
                : "..."}
            </p>
            {isMyTurn && (
              <p className="text-[10px] font-label-md text-primary mt-1 animate-pulse uppercase tracking-wider leading-none">
                Your move
              </p>
            )}
          </div>
        </div>

        {/* Last Move Overlay (Top Right now) */}
        {gameState.lastMove && (
          <div className="absolute top-20 right-4 z-40 max-w-[280px]">
            <div className="bg-inverse-surface backdrop-blur-xl border border-outline-variant rounded-xl p-3 shadow-xl flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${gameState.lastMove.success ? "bg-primary" : "bg-error"}`}
                />
                <p className="text-[9px] font-label-md text-inverse-on-surface opacity-70 uppercase tracking-widest">
                  Last Move
                </p>
              </div>
              <p className="text-xs font-body-md text-inverse-on-surface leading-tight pl-4">
                {gameState.lastMove.details}
              </p>
            </div>
          </div>
        )}

        {/* Game Over */}
        {gameState.phase === "GAME_OVER" && (
          <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-surface-container-lowest max-w-md w-full rounded-3xl p-12 shadow-2xl border border-outline-variant text-center">
              <h2 className="font-headline-lg text-primary mb-2">Game Over</h2>
              <p className="font-headline-sm text-on-surface">
                Winner:{" "}
                {gameState.scores.teamA > gameState.scores.teamB
                  ? "Team A"
                  : "Team B"}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-8 w-full bg-primary text-on-primary py-4 rounded-xl font-label-md shadow-md active:scale-95 transition-all"
              >
                Back to Lobby
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Sleek Player Dashboard (Bottom Section) */}
      <section className="fixed bottom-0 left-0 w-full bg-surface-container-lowest shadow-[0_-10px_30px_rgba(0,0,0,0.05)] border-t border-outline-variant/30 z-40">
        <div className="flex flex-col md:flex-row items-center justify-between w-full h-full">
          {/* Action Buttons (Left) */}
          <div className="flex flex-row w-full md:w-auto p-2 md:p-4 gap-2 shrink-0 border-b md:border-b-0 md:border-r border-outline-variant/30">
            <button
              disabled={!isMyTurn}
              onClick={() => setShowAskModal(true)}
              className="flex-1 md:flex-none bg-surface border border-outline-variant hover:border-secondary text-secondary font-label-md text-xs md:text-sm px-4 py-3 md:py-4 rounded-xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">
                record_voice_over
              </span>
              Ask
            </button>
            <button
              disabled={!isMyTurn}
              onClick={() => setShowClaimModal(true)}
              className="flex-1 md:flex-none bg-primary hover:bg-surface-tint text-on-primary font-label-md text-xs md:text-sm px-4 py-3 md:py-4 rounded-xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">
                library_add
              </span>
              Claim
            </button>
          </div>

          {/* Cards Display (Center/Right) */}
          <div className="flex-1 w-full overflow-x-auto custom-scrollbar p-3 md:p-4 flex items-center justify-start">
            <div className="flex gap-6 min-w-max px-4 mx-auto md:mx-0">
              {Object.entries(groupedHand).map(([hs, cards]) => (
                <div key={hs} className="flex -space-x-6">
                  {cards.map((c) => (
                    <div
                      key={cardKey(c)}
                      className="relative group hover:-translate-y-4 transition-transform duration-200"
                    >
                      <PlayingCard card={c} />
                    </div>
                  ))}
                </div>
              ))}
              {myHand.length === 0 && (
                <p className="text-on-surface-variant italic font-body-sm my-auto">
                  Hand empty
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Modals */}
      {showAskModal && (
        <AskModal
          opponents={opponents as Player[]}
          myHand={myHand}
          onAsk={handleAsk}
          onClose={() => setShowAskModal(false)}
        />
      )}
      {showClaimModal && (
        <ClaimModal
          onClaim={handleClaim}
          onClose={() => setShowClaimModal(false)}
        />
      )}
    </div>
  );
}
