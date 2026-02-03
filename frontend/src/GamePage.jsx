import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { formatAccuracyCompat as formatAccuracy } from './utils/helpers';

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4001";

function RulesModal({ title, rules, onClose }) {
  if (!rules) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-8 max-w-lg w-full relative shadow-3xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold transition-colors duration-200"
        >
          &times;
        </button>
        <h2 className="text-4xl font-extrabold text-cyan-300 mb-6 text-center">
          {title} Rules
        </h2>
        <div className="text-gray-200 text-lg leading-relaxed max-h-80 overflow-y-auto custom-scrollbar">
          <p>{rules}</p>
        </div>
      </div>
    </div>
  );
}

function TopPlayersModal({ players, loading, error, onClose, onRetry }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 max-w-4xl w-full relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold transition-colors duration-200"
        >
          &times;
        </button>
        <h2 className="text-3xl font-extrabold text-cyan-300 mb-4 text-center">
          🏆 Global Leaderboard
        </h2>

        {loading ? (
          <div className="text-center text-gray-400 py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
            <p>Loading leaderboard...</p>
          </div>
        ) : error ? (
          <div className="text-center text-red-400 py-8">
            <p>Failed to load leaderboard: {error}</p>
            <button
              onClick={onRetry}
              className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-white min-w-full">
              <thead>
                <tr className="bg-cyan-700">
                  <th className="p-3 text-left">Rank</th>
                  <th className="p-3 text-left">Student</th>
                  <th className="p-3 text-left">Email</th>
                  <th className="p-3 text-right">Score</th>
                  <th className="p-3 text-right">Accuracy</th>
                  <th className="p-3 text-right">
                    Attempted Questions(out of 30)
                  </th>
                </tr>
              </thead>
              <tbody>
                {players.map((player, index) => (
                  <tr
                    key={player.user_id}
                    className="border-b border-gray-700 hover:bg-gray-700"
                  >
                    <td className="p-3 font-bold text-cyan-300">
                      {index + 1}
                      {index === 0 && " 🥇"}
                      {index === 1 && " 🥈"}
                      {index === 2 && " 🥉"}
                    </td>
                    <td className="p-3 font-medium">
                      {player.display_name || "Anonymous"}
                    </td>
                    <td className="p-3 text-gray-300">{player.email}</td>
                    <td className="p-3 text-right font-bold text-cyan-300">
                      {player.score || 0}
                    </td>
                    <td className="p-3 text-right text-green-400 font-bold">
                      {formatAccuracy(player.accuracy)}%
                    </td>
                    <td className="p-3 text-right text-gray-300">
                      {player.attempts || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {players.length === 0 && (
              <div className="text-center text-gray-400 py-8">
                <div className="text-6xl mb-4">📊</div>
                <p className="text-xl">No players yet</p>
                <p className="text-sm mt-2">
                  Students need to play games to appear on leaderboard
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function GameCard({ title, icon, onViewRules, onEnterGame, disabled }) {
  const [code, setCode] = useState("");

  const handleEnter = () => {
    if (title === "Wisdom Warfare" || title === "A. Crossword") {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) {
        alert("Please enter the game code sent by your teacher.");
        return;
      }
      onEnterGame(trimmed, title);
    } else {
      onEnterGame(code.trim(), title);
    }
  };

  return (
    <div className="bg-gray-900 rounded-3xl p-6 shadow-3xl border-2 border-cyan-600 relative transition-all duration-300 hover:scale-105 hover-lift">
      <h3 className="text-3xl font-extrabold text-cyan-300 mb-4 text-center">
        <span role="img" aria-label="game-icon" className="mr-2 text-3xl">
          {icon}
        </span>
        {title}
      </h3>

      {(title === "Wisdom Warfare" || title === "A. Crossword") && (
        <input
          type="text"
          placeholder="Enter game code from teacher"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-full p-3 mb-4 bg-gray-800 border-2 border-cyan-700 rounded-lg text-white text-center placeholder-gray-400"
        />
      )}

      <div className="space-y-3">
        <button
          onClick={() => onViewRules(title)}
          className="w-full py-2 rounded-xl border-2 border-cyan-500 text-cyan-300 hover:bg-cyan-900 transition-colors"
        >
          📖 View Rules
        </button>
        <button
          onClick={handleEnter}
          disabled={disabled}
          className="w-full py-3 rounded-xl font-extrabold text-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-800 text-white transition-colors"
        >
          {disabled ? "Please wait..." : "🚀 Enter Game"}
        </button>
      </div>
    </div>
  );
}

function GamePage({ user, onLogout }) {
  const navigate = useNavigate();

  const [showRulesModal, setShowRulesModal] = useState(false);
  const [currentGameRules, setCurrentGameRules] = useState({
    title: "",
    rules: "",
  });
  const [showTopPlayersModal, setShowTopPlayersModal] = useState(false);
  const [topPlayers, setTopPlayers] = useState([]);
  const [topPlayersLoading, setTopPlayersLoading] = useState(false);
  const [topPlayersError, setTopPlayersError] = useState(null);
  const [enteringGame, setEnteringGame] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  if (!user) return null;

  const gameRulesContent = {
    "Wisdom Warfare": {
      title: "Wisdom Warfare",
      rules:
        "Answer multiple-choice questions quickly to earn points. Correct answers earn 10 points, with a 5-point bonus for being the first to answer correctly. The game code will be shared by your teacher. Each student can only play once.",
    },
    "Mystery Spinner": {
      title: "Mystery Spinner",
      rules:
        "Spin the wheel to get random questions from different categories. Each spin reveals a new challenge. Collect points and compete with others!",
    },
    "Escape Room": {
      title: "Escape Room",
      rules:
        "Solve compiler design puzzles and challenges to escape the virtual room. Work through increasingly difficult problems to earn your freedom and top scores!",
    },
    "A. Crossword": {
      title: "A. Crossword",
      rules:
        "Players solve a live crossword grid. First correct word earns 15 points. Other correct answers earn 10 points. Each word can be solved once. The first player to complete the grid wins. Spectators can watch in real time.",
    },
  };

  const handleViewRules = (gameTitle) => {
    const content = gameRulesContent[gameTitle] || { 
      title: gameTitle, 
      rules: "No rules found." 
    };
    setCurrentGameRules(content);
    setShowRulesModal(true);
  };

  const handleEnterGame = async (code, gameType) => {
    const trimmed = (code || "").trim().toUpperCase();
    if (!trimmed) {
      alert("Please enter the game code sent by your teacher.");
      return;
    }

    try {
      setEnteringGame(true);

      // Validate game code
      const res = await fetch(
        `${API_BASE}/game/code/${encodeURIComponent(trimmed)}`
      );

      if (!res.ok) {
        if (res.status === 404) {
          alert("Invalid game code. Please check the code sent by your teacher.");
        } else {
          alert("Error validating game code.");
        }
        return;
      }

      const data = await res.json();
      const game = data.game || data;

      if (!game || !game.game_code || !game.game_name) {
        alert("Invalid game session returned from server.");
        return;
      }

      // ✅ ADD GAME TYPE VALIDATION
      const actualGameName = game.game_name || "";
      const expectedGameName = gameType;
      
      // Map game names for validation
      const gameTypeMap = {
        "Wisdom Warfare": ["Wisdom Warfare", "QUIZ", "MCQ"],
        "A. Crossword": ["A. Crossword", "CROSSWORD", "Crossword"],
        "Mystery Spinner": ["Mystery Spinner", "SPINNER"],
        "Escape Room": ["Escape Room", "ESCAPE"]
      };
      
      const allowedNames = gameTypeMap[expectedGameName] || [expectedGameName];
      
      // Check if the actual game name matches what we expect
      const isGameTypeValid = allowedNames.some(name => 
        actualGameName.toLowerCase().includes(name.toLowerCase())
      );
      
      if (!isGameTypeValid) {
        alert(`❌ Invalid game code!\n\nThis code is for "${actualGameName}" but you're trying to enter "${expectedGameName}".\n\nPlease use the correct game code for ${expectedGameName}.`);
        setEnteringGame(false);
        return;
      }

      const finalCode = game.game_code.toUpperCase();
      const finalGameName = game.game_name;

      // Store game info for GameUI
      localStorage.setItem("GAME_CODE", finalCode);
      localStorage.setItem("GAME_NAME", finalGameName);
      localStorage.setItem("GAME_TYPE", gameType);

      // Navigate to GameUI
      navigate(`/play/${finalCode}`, {
        state: {
          gameCode: finalCode,
          gameName: finalGameName,
          gameType: gameType,
          user,
        },
      });
    } catch (err) {
      console.error("Error entering game:", err);
      alert("Failed to enter game.");
    } finally {
      setEnteringGame(false);
    }
  };

  const fetchLeaderboard = useCallback(async () => {
    setTopPlayersLoading(true);
    setTopPlayersError(null);
    try {
      const res = await fetch(`${API_BASE}/leaderboard?limit=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTopPlayers(data);
    } catch (err) {
      console.error("Failed to fetch leaderboard:", err);
      setTopPlayersError(err.message || String(err));
    } finally {
      setTopPlayersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showTopPlayersModal) {
      fetchLeaderboard();
    }
  }, [showTopPlayersModal, fetchLeaderboard]);

  const displayName =
    user?.display_name || user?.displayName || user?.email || "Player";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex flex-col items-center p-6">
      <div className="text-center mb-8">
        <h1 className="text-5xl font-black text-cyan-400 mb-4 glow-text">
          ⚔ WISDOM WARFARE
        </h1>
        <p className="text-xl text-cyan-200">
          Interactive Compiler Design Learning
        </p>
        {user && (
          <div className="mt-4 p-3 bg-cyan-900 rounded-lg inline-block">
            <p className="text-cyan-100">
              Welcome, <span className="font-bold">{displayName}</span>
            </p>
            <p className="text-cyan-200 text-sm">{user.email}</p>
          </div>
        )}
      </div>

      <div className="mb-8">
        <button
          onClick={() => setShowTopPlayersModal(true)}
          className="px-8 py-4 rounded-full bg-cyan-700 hover:bg-cyan-600 border-2 border-cyan-500 text-cyan-100 font-bold text-lg transition-all hover-lift"
        >
          🏆 View Global Leaderboard
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl w-full">
        <GameCard
          title="Wisdom Warfare"
          icon="🧠"
          onViewRules={handleViewRules}
          onEnterGame={handleEnterGame}
          disabled={enteringGame}
        />
        <GameCard
          title="Mystery Spinner"
          icon="🎡"
          onViewRules={handleViewRules}
          onEnterGame={handleEnterGame}
          disabled={true}
        />
        <GameCard
          title="Escape Room"
          icon="🗝"
          onViewRules={() => handleViewRules("Escape Room")}
          onEnterGame={handleEnterGame}
          disabled={true}
        />
        <GameCard
          title="A. Crossword"
          icon="📝"
          onViewRules={handleViewRules}
          onEnterGame={handleEnterGame}
          disabled={enteringGame}
        />
      </div>

      <button
        onClick={() => navigate("/dashboard")}
        className="mt-8 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-bold"
      >
        📊 View My Dashboard
      </button>

      <button
        onClick={onLogout}
        className="mt-12 bg-red-600 hover:bg-red-500 px-8 py-4 rounded-lg text-white font-bold text-lg transition-colors"
      >
        🚪 Logout
      </button>

      {showRulesModal && (
        <RulesModal
          title={currentGameRules.title}
          rules={currentGameRules.rules}
          onClose={() => setShowRulesModal(false)}
        />
      )}

      {showTopPlayersModal && (
        <TopPlayersModal
          players={topPlayers}
          loading={topPlayersLoading}
          error={topPlayersError}
          onClose={() => setShowTopPlayersModal(false)}
          onRetry={fetchLeaderboard}
        />
      )}
    </div>
  );
}

export default GamePage;