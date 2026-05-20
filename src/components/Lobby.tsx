import { useState } from "react";
import { useGame } from "../context/GameContextStore";

export default function Lobby() {
  const { gameState, sendMessage, myPlayerId, clearSession, inviteToken } = useGame();
  const [playerName, setPlayerName] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<"TEAM_A" | "TEAM_B" | null>(
    null,
  );

  if (!gameState) return null;

  const isLiterature = gameState.gameType === "LITERATURE";
  const isSpades = gameState.gameType === "SPADES";
  const isJoined =
    !!myPlayerId && !!gameState.players.find((p) => p.id === myPlayerId);

  // Determine host using server authority, with legacy fallback.
  const hostId =
    gameState.hostPlayerId ??
    (gameState.players.length > 0 ? gameState.players[0].id : null);
  const isHost = myPlayerId === hostId;

  const MAX_PLAYERS: Record<string, number> = {
    LITERATURE: 8,
    COUP: 6,
    SECRET_HITLER: 10,
    HANABI: 5,
    LOVE_LETTER: 4,
    SPADES: 4,
  };
  const maxPlayers = MAX_PLAYERS[gameState.gameType] || 6;

  const cleanGameString = (gameType: string) => {
    return gameType
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
  };

  const handleJoin = () => {
    if (!playerName.trim()) return;
    if (isLiterature && !selectedTeam) return;
    if (isSpades && !selectedTeam) return;

    sendMessage({
      type: "JOIN_LOBBY",
      player: {
        name: playerName.trim(),
        team: selectedTeam || "TEAM_A",
        seatIndex: gameState.players.length,
      },
    });
  };

  const teamA = gameState.players.filter((p) => p.team === "TEAM_A");
  const teamB = gameState.players.filter((p) => p.team === "TEAM_B");

  return (
    <div className="min-h-screen flex flex-col p-6 md:p-8 bg-surface font-body-md text-on-surface">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10 max-w-7xl mx-auto w-full">
        <div>
          <p className="text-[10px] md:text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-2 font-label-md">
            Lobby · {gameState.gameType}
          </p>
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] md:text-xs text-outline uppercase tracking-widest font-label-md">
              Session Code
            </span>
            <span className="text-lg md:text-xl font-mono font-bold text-primary px-4 py-1.5 rounded-xl bg-primary-container/20 tracking-widest border border-outline-variant">
              {gameState.sessionId}
            </span>
          </div>
          {isHost && inviteToken && (
            <div className="mt-3 max-w-xl">
              <p className="text-[10px] md:text-xs text-outline uppercase tracking-widest font-label-md mb-1">
                Invite Token
              </p>
              <div className="text-[11px] md:text-xs font-mono break-all bg-surface-container-low border border-outline-variant rounded-xl p-3">
                {inviteToken}
              </div>
            </div>
          )}
        </div>
        <div className="w-full sm:w-auto text-left sm:text-right flex flex-row-reverse sm:flex-col items-center sm:items-end justify-between sm:justify-end gap-2">
          <button
            onClick={() => {
              if (confirm("Are you sure you want to leave this session?")) {
                clearSession();
              }
            }}
            className="text-[10px] font-label-md text-error uppercase tracking-widest hover:text-on-error hover:bg-error px-3 py-1 rounded-lg transition-colors"
          >
            Leave Session
          </button>
          <div>
            <p className="text-[10px] md:text-xs text-outline uppercase tracking-widest font-label-md">
              Participants
            </p>
            <p className="text-2xl md:text-3xl font-headline-md text-on-surface">
              {gameState.players.length}
              <span className="text-sm text-outline font-label-md ml-1">
                /{maxPlayers}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full">
        <div
          className={`grid ${isLiterature || isSpades ? "md:grid-cols-3" : "md:grid-cols-2"} gap-6`}
        >
          {(isLiterature || isSpades) && (
            <div className="rounded-3xl p-6 bg-surface-container-lowest shadow-sm border border-outline-variant">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <h3 className="text-xs font-label-md text-primary uppercase tracking-wider">
                  Team A
                </h3>
              </div>
              <div className="space-y-3">
                {teamA.map((p) => (
                    <PlayerCard
                      key={p.id}
                      p={p}
                      isMe={p.id === myPlayerId}
                      isHost={p.id === hostId}
                      color="primary"
                    />
                ))}
                {teamA.length === 0 && <EmptySlot />}
              </div>
            </div>
          )}

          {/* Join / Start Panel */}
          <div className="rounded-[32px] p-6 flex flex-col bg-surface-container-lowest border border-outline-variant shadow-md relative overflow-hidden order-first md:order-none">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <span className="material-symbols-outlined text-6xl md:text-8xl">
                sports_esports
              </span>
            </div>

            {!isJoined ? (
              <>
                <h3 className="font-headline-sm text-on-surface mb-2">
                  Claim Your Spot
                </h3>
                <p className="text-sm font-body-md text-on-surface-variant mb-8">
                  Enter your alias to join the session.
                </p>

                <div className="space-y-6 flex-1">
                  <div>
                    <label className="block text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest mb-2">
                      Your Name
                    </label>
                    <input
                      type="text"
                      maxLength={20}
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      className="w-full p-4 rounded-2xl text-on-surface font-body-md outline-none bg-surface-container focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all border border-transparent focus:border-primary"
                      placeholder="e.g. Ace"
                    />
                  </div>

                  {(isLiterature || isSpades) && (
                    <div>
                      <label className="block text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest mb-2">
                        Choose Side
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setSelectedTeam("TEAM_A")}
                          className={`p-4 rounded-2xl font-label-md text-sm transition-all border-2 ${
                            selectedTeam === "TEAM_A"
                              ? "bg-primary-container/20 text-primary border-primary"
                              : "bg-surface-container text-on-surface-variant border-transparent hover:bg-surface-container-high"
                          }`}
                        >
                          Team A
                        </button>
                        <button
                          onClick={() => setSelectedTeam("TEAM_B")}
                          className={`p-4 rounded-2xl font-label-md text-sm transition-all border-2 ${
                            selectedTeam === "TEAM_B"
                              ? "bg-secondary-container/20 text-secondary border-secondary"
                              : "bg-surface-container text-on-surface-variant border-transparent hover:bg-surface-container-high"
                          }`}
                        >
                          Team B
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleJoin}
                  disabled={
                    !playerName.trim() ||
                    ((isLiterature || isSpades) && !selectedTeam)
                  }
                  className="w-full py-4 rounded-xl bg-primary text-on-primary font-label-md text-sm mt-8 transition-all hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:grayscale"
                >
                  Enter Lobby
                </button>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                <div className="w-20 h-20 rounded-3xl bg-primary-container/20 flex items-center justify-center mb-6 border border-primary-container/50 rotate-3 animate-pulse">
                  <span className="material-symbols-outlined text-4xl text-primary">
                    check_circle
                  </span>
                </div>
                <h3 className="font-headline-sm text-on-surface mb-2">
                  Ready to Play
                </h3>
                <p className="text-sm font-body-md text-on-surface-variant mb-10 max-w-[200px]">
                  {isHost
                    ? "You are the host. Start when ready."
                    : "Waiting for the host to initiate the game."}
                </p>

                {isHost ? (
                  <>
                    <button
                      onClick={() => sendMessage({ type: "START_GAME" })}
                      className="w-full py-4 rounded-xl bg-primary text-on-primary font-label-md text-sm transition-all hover:opacity-90 active:scale-95"
                    >
                      Start {cleanGameString(gameState.gameType)}
                    </button>
                    {import.meta.env.DEV && (
                      <button
                        onClick={() =>
                          sendMessage({ type: "START_GAME", test: true })
                        }
                        className="w-full py-2 rounded-xl text-primary font-label-md text-xs mt-3 border border-primary transition-all hover:bg-primary-container/20 active:scale-95"
                      >
                        Debug UI (1 Player)
                      </button>
                    )}
                  </>
                ) : (
                  <div className="w-full py-4 rounded-xl bg-surface-variant text-on-surface-variant font-label-md text-sm text-center">
                    Waiting for host...
                  </div>
                )}
              </div>
            )}
          </div>

          {!(isLiterature || isSpades) && (
            <div className="rounded-3xl p-6 bg-surface-container-lowest shadow-sm border border-outline-variant">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
                <h3 className="text-xs font-label-md text-secondary uppercase tracking-wider">
                  Players
                </h3>
              </div>
              <div className="space-y-3">
                {gameState.players.map((p) => (
                    <PlayerCard
                      key={p.id}
                      p={p}
                      isMe={p.id === myPlayerId}
                      isHost={p.id === hostId}
                      color="secondary"
                    />
                ))}
                {gameState.players.length === 0 && <EmptySlot />}
              </div>
            </div>
          )}

          {(isLiterature || isSpades) && (
            <div className="rounded-3xl p-6 bg-surface-container-lowest shadow-sm border border-outline-variant">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
                <h3 className="text-xs font-label-md text-secondary uppercase tracking-wider">
                  Team B
                </h3>
              </div>
              <div className="space-y-3">
                {teamB.map((p) => (
                    <PlayerCard
                      key={p.id}
                      p={p}
                      isMe={p.id === myPlayerId}
                      isHost={p.id === hostId}
                      color="secondary"
                    />
                ))}
                {teamB.length === 0 && <EmptySlot />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import type { Player } from "../shared/types.js";

function PlayerCard({
  p,
  isMe,
  isHost,
  color,
}: {
  p: Player;
  isMe: boolean;
  isHost: boolean;
  color: "primary" | "secondary";
}) {
  const bg =
    color === "primary"
      ? "bg-primary-container/20"
      : "bg-secondary-container/20";
  const text = color === "primary" ? "text-primary" : "text-secondary";
  const iconBg =
    color === "primary"
      ? "bg-primary-container/40"
      : "bg-secondary-container/40";
  const isDisconnected = p.isConnected === false;

  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 rounded-2xl ${bg} border border-transparent hover:border-outline-variant transition-all ${isDisconnected ? "opacity-50" : ""}`}
    >
      <div
        className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center ${text} font-headline-sm text-sm`}
      >
        {p.name.charAt(0).toUpperCase()}
      </div>
      <span
        className={`text-sm font-label-md text-on-surface ${isDisconnected ? "line-through" : ""}`}
      >
        {p.name}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {isDisconnected && (
          <span className="text-[9px] font-label-md text-error uppercase tracking-widest">
            offline
          </span>
        )}
        {isHost && (
          <span className="text-[9px] font-label-md text-primary uppercase tracking-widest bg-primary-container/30 px-2 py-0.5 rounded-full">
            host
          </span>
        )}
        {isMe && (
          <span
            className={`${text} text-[10px] font-label-md uppercase tracking-widest`}
          >
            You
          </span>
        )}
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="h-[52px] rounded-2xl border-2 border-dashed border-outline-variant flex items-center justify-center text-[10px] font-label-md text-outline uppercase tracking-widest">
      Waiting for player...
    </div>
  );
}
