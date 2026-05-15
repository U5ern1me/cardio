import { useState } from "react";
import { useGame } from "../context/GameContext";
import type { GameType } from "../shared/types";
import Instructions from "./Instructions";

import { GAME_RULES } from "../constants/rules";

export default function LandingPage() {
  const { createLANSession, connectToLAN } = useGame();
  const [sessionCode, setSessionCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [selectedGame, setSelectedGame] = useState<GameType>("LITERATURE");
  const [showInstructions, setShowInstructions] = useState(false);
  if (showInstructions) {
    return (
      <Instructions
        gameId={selectedGame}
        onBack={() => setShowInstructions(false)}
        onStart={() => createLANSession(selectedGame as GameType)}
      />
    );
  }

  return (
    <div className="bg-surface text-on-surface antialiased min-h-screen flex flex-col font-body-md text-body-md">
      <header className="w-full py-6 flex justify-center items-center bg-surface/90 backdrop-blur-md relative z-50 border-b border-outline-variant/30 sticky top-0 shadow-[0_4px_30px_rgba(0,0,0,0.03)]">
        <div className="flex items-center gap-3 cursor-default group">
          <div className="w-10 h-10 rounded-xl bg-surface-container-lowest border-2 border-outline-variant/40 flex items-center justify-center shadow-lg shadow-primary/5 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
            <span
              className="material-symbols-outlined text-primary text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              playing_cards
            </span>
          </div>
          <div className="font-headline-lg-mobile text-headline-lg-mobile font-bold select-none drop-shadow-sm tracking-tight">
            <span className="text-on-surface">Card</span>
            <span className="text-primary">io</span>
          </div>
        </div>
      </header>
      <main className="relative flex-1 flex flex-col lg:flex-row">
        {/* OR Divider */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
          <div className="w-16 h-16 rounded-full bg-surface-container-lowest border-2 border-outline-variant/40 flex items-center justify-center font-headline-sm text-headline-sm uppercase text-primary shadow-lg tracking-[0.1em]">
            OR
          </div>
        </div>

        <section className="relative w-full lg:w-1/2 bg-surface-container-lowest p-container-margin md:p-section-gap flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-outline-variant/30 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-tertiary-container/5 rounded-full blur-3xl pointer-events-none"></div>
          <div className="max-w-md mx-auto w-full relative z-10">
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg mb-2 text-on-surface">Host a Game</h1>
            <p className="font-body-lg text-body-lg mb-8 text-on-background"></p>
            <div className="flex flex-col gap-4">
              {Object.entries(GAME_RULES).map(([id, rule]) => (
                <button
                  key={id}
                  onClick={() => {
                    setSelectedGame(id as GameType);
                    setShowInstructions(true);
                  }}
                  className="group relative overflow-hidden bg-surface rounded-xl p-6 border border-outline-variant/20 hover:border-tertiary-container/50 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,162,244,0.1)] hover:-translate-y-1 w-full text-left flex items-center justify-between active:scale-[0.98]"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-tertiary-container/0 via-tertiary-container/5 to-tertiary-container/10 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500"></div>
                  <span className="font-headline-sm text-headline-sm text-on-surface relative z-10 group-hover:text-tertiary-container transition-colors">
                    {rule.title}
                  </span>
                  <span className="material-symbols-outlined text-outline-variant group-hover:text-tertiary-container relative z-10 transition-colors">
                    info
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="w-full lg:w-1/2 bg-surface p-container-margin md:p-section-gap flex flex-col justify-center items-center relative overflow-hidden min-h-[614px] lg:min-h-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-container/5 rounded-full blur-3xl pointer-events-none"></div>
          <div className="max-w-sm w-full relative z-10 text-center">
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg mb-2 text-on-surface">
              Join a Game
            </h2>
            <p className="font-body-lg text-body-lg text-on-surface-variant mb-12">
              Enter the room code and invite token to connect.
            </p>
            <div className="flex flex-col gap-8">
              <div className="relative">
                <input
                  autoComplete="off"
                  className="w-full bg-surface-container-lowest border-2 border-outline-variant/40 rounded-xl py-6 px-4 text-center font-headline-lg text-headline-lg tracking-[0.3em] uppercase text-on-surface focus:outline-none focus:border-tertiary-container focus:ring-4 focus:ring-tertiary-container/20 transition-all placeholder:text-outline-variant/50 placeholder:font-headline-md placeholder:tracking-normal"
                  maxLength={4}
                  placeholder="CODE"
                  spellCheck="false"
                  type="text"
                  value={sessionCode}
                  onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                />
                <div
                  className={`absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity ${sessionCode.length === 4 ? "opacity-100" : "opacity-0"}`}
                >
                  <span className="material-symbols-outlined text-primary-container icon-fill text-[32px]">
                    check_circle
                  </span>
                </div>
              </div>
              <div className="relative">
                <input
                  autoComplete="off"
                  className="w-full bg-surface-container-lowest border-2 border-outline-variant/40 rounded-xl py-4 px-4 text-center font-label-md text-label-md tracking-wide uppercase text-on-surface focus:outline-none focus:border-tertiary-container focus:ring-4 focus:ring-tertiary-container/20 transition-all placeholder:text-outline-variant/50"
                  maxLength={256}
                  placeholder="INVITE TOKEN"
                  spellCheck="false"
                  type="text"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                />
              </div>
              <button
                disabled={
                  sessionCode.length !== 4 || inviteToken.trim().length < 20
                }
                onClick={() => connectToLAN(sessionCode, inviteToken.trim())}
                className={`w-full font-label-md text-label-md py-5 rounded-xl transition-all duration-200 uppercase tracking-wider flex items-center justify-center gap-2 ${
                  sessionCode.length === 4 && inviteToken.trim().length >= 20
                    ? "bg-primary-container text-on-primary hover:bg-primary active:scale-[0.98] shadow-[0_10px_30px_-10px_rgba(249,115,22,0.4)] hover:shadow-[0_15px_40px_-10px_rgba(249,115,22,0.6)] cursor-pointer"
                    : "bg-surface-variant text-on-surface-variant/50 cursor-not-allowed"
                }`}
              >
                <span>Enter Room</span>
                <span className="material-symbols-outlined text-[20px]">
                  login
                </span>
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
