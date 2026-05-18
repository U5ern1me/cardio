import { useState } from "react";
import Instructions from "./Instructions";
import { useGame } from "../context/GameContextStore";

export default function RulesButton() {
  const [isOpen, setIsOpen] = useState(false);
  const { gameState } = useGame();

  if (!gameState) return null;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-on-surface-variant hover:text-primary transition-colors bg-surface-container hover:bg-surface-container-highest px-3 py-1.5 rounded-lg font-label-md text-xs shadow-sm"
      >
        <span className="material-symbols-outlined text-sm">menu_book</span>
        <span className="hidden sm:inline">Rules</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/60 backdrop-blur-sm p-4 md:p-6">
          <div className="bg-surface rounded-3xl w-full max-w-4xl h-[85vh] relative shadow-2xl overflow-hidden flex flex-col border border-outline-variant/30">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-3 right-3 md:top-4 md:right-4 z-[110] flex items-center justify-center gap-1 px-4 py-2 rounded-full bg-error text-on-error hover:bg-error/90 transition-colors shadow-lg border border-error/50"
              aria-label="Close rules"
            >
              <span className="font-label-md text-sm font-bold tracking-wider">
                CLOSE
              </span>
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
            <div className="flex-1 w-full h-full overflow-hidden">
              <Instructions
                gameId={gameState.gameType}
                onBack={() => setIsOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
