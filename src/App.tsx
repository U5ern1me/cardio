import { useGame } from "./context/GameContextStore";
import LandingPage from "./components/LandingPage";
import Lobby from "./components/Lobby";
import LiteratureBoard from "./games/literature/Board";
import CoupBoard from "./games/coup/Board";
import SecretHitlerBoard from "./games/secretHitler/Board";
import HanabiBoard from "./games/hanabi/Board";
import LoveLetterBoard from "./games/love_letter/Board";
import SpadesBoard from "./games/spades/Board";
import HostControls from "./components/HostControls";

function App() {
  const { gameState, error, connectionStatus } = useGame();

  const renderBoard = () => {
    if (!gameState) return null;
    if (gameState.gameType === "LITERATURE") return <LiteratureBoard />;
    if (gameState.gameType === "COUP") return <CoupBoard />;
    if (gameState.gameType === "SECRET_HITLER") return <SecretHitlerBoard />;
    if (gameState.gameType === "HANABI") return <HanabiBoard />;
    if (gameState.gameType === "LOVE_LETTER") return <LoveLetterBoard />;
    if (gameState.gameType === "SPADES") return <SpadesBoard />;
    return <div className="p-8 text-center">Unknown Game Type</div>;
  };

  return (
    <>
      {/* Error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-900/90 text-red-200 px-6 py-3 rounded-xl shadow-2xl backdrop-blur-sm text-sm font-medium animate-[fadeIn_0.3s]">
          {error}
        </div>
      )}

      {/* Connection status banner */}
      {connectionStatus === "reconnecting" && gameState && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-600/95 text-white text-center py-2 text-xs font-semibold tracking-wide backdrop-blur-sm flex items-center justify-center gap-2 shadow-lg">
          <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Reconnecting to session...
        </div>
      )}
      {connectionStatus === "disconnected" && gameState && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-red-700/95 text-white text-center py-2 text-xs font-semibold tracking-wide backdrop-blur-sm shadow-lg">
          Connection lost. Check your network.
        </div>
      )}

      {!gameState ? (
        <LandingPage />
      ) : gameState.phase === "LOBBY" ? (
        <Lobby />
      ) : (
        renderBoard()
      )}

      {/* Host Controls */}
      {gameState && <HostControls />}
    </>
  );
}

export default App;
