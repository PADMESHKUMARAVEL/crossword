import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { formatAccuracy } from '../../utils/helpers';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4001';

const GameUI = ({ user, onLogout }) => {
  const navigate = useNavigate();
  
  // Get game info from location state or localStorage
  const locationState = window.history.state?.usr || {};
  const gameCode = locationState.gameCode || localStorage.getItem("GAME_CODE");
  const gameType = locationState.gameType || localStorage.getItem("GAME_TYPE") || "Wisdom Warfare";
  const gameName = locationState.gameName || localStorage.getItem("GAME_NAME") || "Wisdom Warfare";
  
  const [socket, setSocket] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [result, setResult] = useState({
    message: '',
    correct: false,
    points: 0,
    correctAnswer: '',
    correctAnswerKey: null,
    showNextButton: false
  });
  const [leaderboard, setLeaderboard] = useState([]);
  const [gameStats, setGameStats] = useState({
    score: 0,
    correct: 0,
    total: 0,
    questionsAnswered: 0
  });
  const [connected, setConnected] = useState(false);
  const [gameCompleted, setGameCompleted] = useState(false);
  const [finalResults, setFinalResults] = useState(null);
  const [gameStatus, setGameStatus] = useState({
    questionsLoaded: 0,
    isGameActive: false,
    currentIndex: -1,
    gameSessionId: null
  });
  const [loading, setLoading] = useState(true);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  
  // Crossword-specific states
  const [crosswordData, setCrosswordData] = useState({
    grid: [],
    acrossClues: [],
    downClues: [],
    cellNumbers: {}
  });
  const [lockedWords, setLockedWords] = useState({});
  const [completedWords, setCompletedWords] = useState([]);
  const [winner, setWinner] = useState(null);
  const [spectators, setSpectators] = useState([]);
  const [wordInput, setWordInput] = useState('');
  const [showWinnerAnimation, setShowWinnerAnimation] = useState(false);
  const [cellInputs, setCellInputs] = useState({});
  const [crosswordClues, setCrosswordClues] = useState([]);

  const timerRef = useRef(null);
  const socketRef = useRef(null);
  const mountedRef = useRef(true);

  // ✅ ADDED: Game type validation on mount
  useEffect(() => {
    if (!mountedRef.current) return;
    
    // Validate game type mismatch
    const validateGameType = () => {
      const actualGameName = gameName || "";
      const expectedGameType = gameType || "";
      
      if (expectedGameType === "Wisdom Warfare" && (
        actualGameName.includes("Crossword") || 
        actualGameName.includes("CROSSWORD")
      )) {
        alert("❌ Game type mismatch! This is a Crossword game code, not Wisdom Warfare.\n\nPlease use the correct game code for Wisdom Warfare.");
        navigate("/game");
        return false;
      }
      
      if (expectedGameType === "A. Crossword" && !(
        actualGameName.includes("Crossword") || 
        actualGameName.includes("CROSSWORD")
      )) {
        alert("❌ Game type mismatch! This is a Wisdom Warfare game code, not Crossword.\n\nPlease use the correct game code for Crossword.");
        navigate("/game");
        return false;
      }
      
      return true;
    };
    
    if (!validateGameType()) {
      return;
    }
    
    console.log('🎮 Initializing', gameType, 'game with code:', gameCode);
    console.log('Game Name:', gameName);
    
    const newSocket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
    setLoading(true);

    // Socket event handlers
    const onConnect = () => {
      console.log('✅ Connected to game server with ID:', newSocket.id);
      if (!mountedRef.current) return;
      setConnected(true);
      setLoading(false);

      // Join game with appropriate game type
      newSocket.emit('joinGame', {
        game_code: gameCode || null,
        user_id: user?.user_id || user?.uid || null,
        email: user?.email || null,
        game_type: gameType
      });

      // Fetch initial game state
      if (gameType === "Wisdom Warfare") {
        newSocket.emit('getGameStatus', { game_code: gameCode || null });
        fetchLeaderboard();
      } else if (gameType === "A. Crossword") {
        // Initialize crossword game
        newSocket.emit('crosswordJoin', {
          game_code: gameCode || null,
          user_id: user?.user_id || user?.uid || null,
          email: user?.email || null
        });
        fetchCrosswordLeaderboard();
      }
    };

    const onConnectError = (err) => {
      console.error('❌ Connection error:', err);
      if (!mountedRef.current) return;
      setConnected(false);
      setLoading(false);
    };

    const onDisconnect = (reason) => {
      console.log('❌ Disconnected from game server:', reason);
      if (!mountedRef.current) return;
      setConnected(false);
    };

    const onReconnect = (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts`);
      if (!mountedRef.current) return;
      setConnected(true);
      newSocket.emit('joinGame', {
        game_code: gameCode || null,
        user_id: user?.user_id || user?.uid || null,
        email: user?.email || null,
        game_type: gameType
      });
    };

    // Common events for all game types
    const onLeaderboardUpdate = (data) => {
      console.log('🏆 Leaderboard updated:', data);
      if (!mountedRef.current) return;
      setLeaderboard(Array.isArray(data) ? data : []);
    };

    // Wisdom Warfare specific events
    const onGameStatus = (status) => {
      console.log('📊 Game status received:', status);
      if (!mountedRef.current) return;
      setGameStatus((prev) => ({
        questionsLoaded: status.questionsLoaded ?? prev.questionsLoaded,
        isGameActive: Boolean(status.isGameActive),
        currentIndex:
          typeof status.currentIndex === 'number'
            ? status.currentIndex
            : prev.currentIndex,
        gameSessionId: status.gameSessionId ?? prev.gameSessionId
      }));
      setLoading(false);
    };

    const onGameStarted = (data) => {
      console.log('🎮 Game started:', data);
      if (!mountedRef.current) return;
      setGameStatus((prev) => ({ ...prev, isGameActive: true }));
    };

    const onNewQuestion = (question) => {
      console.log('❓ New question received:', question);
      if (!mountedRef.current) return;

      setCurrentQuestion(question);
      setTimeLeft(question.time || 30);
      setSelectedAnswer('');
      setResult({
        message: '',
        correct: false,
        points: 0,
        correctAnswer: '',
        correctAnswerKey: null,
        showNextButton: false
      });
      setIsAnswerSubmitted(false);

      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setIsAnswerSubmitted(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    const normalizeCorrectAnswer = (raw, question) => {
      if (!question || !question.options) return null;
      if (!raw) return null;
      if (typeof raw === 'string' && question.options.hasOwnProperty(raw)) {
        return raw;
      }
      for (const [k, v] of Object.entries(question.options)) {
        if (v === raw) return k;
      }
      return null;
    };

    const onAnswerResult = (data) => {
      console.log('📝 Answer result:', data);
      if (!mountedRef.current) return;

      // Check if this result is for current user
      const eventUserMatches =
        !user ||
        (!data.user_id && !data.email) ||
        (user &&
          ((data.user_id &&
            (data.user_id === user.user_id || data.user_id === user.uid)) ||
            (data.email && data.email === user.email)));

      if (!eventUserMatches) return;

      setIsAnswerSubmitted(true);

      const q = currentQuestion;
      const normalizedKey = normalizeCorrectAnswer(
        data.correctAnswer ?? data.correct_answer ?? data.correct ?? '',
        q
      );

      if (data.error) {
        setResult({
          message: data.error,
          correct: false,
          points: 0,
          correctAnswer: data.correctAnswer || data.correct_answer || '',
          correctAnswerKey: normalizedKey || null,
          showNextButton: data.showNextButton ?? true
        });
      } else {
        setResult({
          message: data.message || '',
          correct: Boolean(data.correct),
          points: Number(data.points) || 0,
          correctAnswer: data.correctAnswer || data.correct_answer || '',
          correctAnswerKey: normalizedKey || null,
          showNextButton: data.showNextButton ?? true
        });

        setGameStats((prev) => {
          if (data.correct) {
            return {
              score: prev.score + (Number(data.points) || 0),
              correct: prev.correct + 1,
              total: prev.total + 1,
              questionsAnswered: prev.questionsAnswered + 1
            };
          }

          return {
            ...prev,
            total: prev.total + 1,
            questionsAnswered: prev.questionsAnswered + 1
          };
        });
      }
    };

    const onQuestionClosed = (data) => {
      console.log('⏹️ Question closed:', data);
      if (timerRef.current) clearInterval(timerRef.current);
      if (!mountedRef.current) return;
      setIsAnswerSubmitted(true);

      setResult((prev) => {
        const q = currentQuestion;
        const normalizedKey = normalizeCorrectAnswer(
          data.correctAnswer ?? data.correct_answer ?? '',
          q
        );
        return {
          message:
            data.explanation ||
            `Time's up! Correct answer was: ${
              data.correctAnswer ?? data.correct_answer ?? ''
            }`,
          correct: false,
          points: 0,
          correctAnswer: data.correctAnswer ?? data.correct_answer ?? '',
          correctAnswerKey: normalizedKey,
          showNextButton: true
        };
      });
    };

    const onGameCompleted = (data) => {
      console.log('🎉 Game completed:', data);
      if (timerRef.current) clearInterval(timerRef.current);
      if (!mountedRef.current) return;
      setGameCompleted(true);
      setFinalResults(data);
      setIsAnswerSubmitted(true);
      setResult((prev) => ({ ...prev, showNextButton: false }));
      setGameStatus((prev) => ({ ...prev, isGameActive: false }));
    };

    // Crossword specific events
    const onCrosswordGrid = (data) => {
      console.log('🧩 Crossword grid received:', data);
      if (!mountedRef.current || gameType !== "A. Crossword") return;
      
      // Store the grid data
      if (data.grid && data.acrossClues && data.downClues && data.cellNumbers) {
        setCrosswordData(data);
      } else if (data.grid && data.clues) {
        // Transform old format to new format
        const acrossClues = data.clues.filter(clue => clue.direction === 'across');
        const downClues = data.clues.filter(clue => clue.direction === 'down');
        
        // Generate cell numbers if not provided
        const cellNumbers = data.cellNumbers || {};
        
        setCrosswordData({
          grid: data.grid,
          acrossClues,
          downClues,
          cellNumbers
        });
      }
      
      // Initialize empty inputs for all editable cells
      const inputs = {};
      if (data.grid) {
        data.grid.forEach((row, rowIndex) => {
          row.forEach((cell, colIndex) => {
            if (cell === '.' || cell === ' ') {
              inputs[`${rowIndex}-${colIndex}`] = '';
            }
          });
        });
      }
      setCellInputs(inputs);
      
      // Set clues for the clues panel
      if (data.clues) {
        setCrosswordClues(data.clues);
      } else if (data.acrossClues && data.downClues) {
        setCrosswordClues([...data.acrossClues, ...data.downClues]);
      }
    };

    const onWordLocked = (data) => {
      console.log('🔒 Word locked:', data);
      if (!mountedRef.current) return;
      setLockedWords(prev => ({ ...prev, [data.wordId]: data.user }));
    };

    const onWordSolved = (data) => {
      console.log('✅ Word solved:', data);
      if (!mountedRef.current) return;
      setCompletedWords(prev => [...prev, data.wordId]);

      // Remove from locked words
      setLockedWords(prev => {
        const newLocked = { ...prev };
        delete newLocked[data.wordId];
        return newLocked;
      });

      // Update user stats if it's the current user
      if (data.user && user && (data.user.email === user.email || data.user.user_id === user.user_id)) {
        setResult({
          message: data.points === 15 
            ? "⚡ First correct answer! +15 points" 
            : "✅ Correct answer! +10 points",
          correct: true,
          points: data.points || 10
        });

        setGameStats((prev) => ({
          ...prev,
          score: prev.score + (data.points || 10),
          correct: prev.correct + 1,
          questionsAnswered: prev.questionsAnswered + 1
        }));
      }
    };

    const onCrosswordWinner = (data) => {
      console.log('🏆 Crossword winner:', data);
      if (!mountedRef.current) return;
      setWinner(data);
      setShowWinnerAnimation(true);
      
      setTimeout(() => {
        if (mountedRef.current) {
          setShowWinnerAnimation(false);
          setGameCompleted(true);
        }
      }, 3000);
    };

    const onSpectatorsUpdate = (data) => {
      console.log('👥 Spectators updated:', data);
      if (!mountedRef.current) return;
      setSpectators(Array.isArray(data) ? data : []);
    };

    // Register all event listeners
    newSocket.on('connect', onConnect);
    newSocket.on('connect_error', onConnectError);
    newSocket.on('disconnect', onDisconnect);
    newSocket.on('reconnect', onReconnect);
    
    // Register all game events (not conditional)
    newSocket.on('gameStatus', onGameStatus);
    newSocket.on('gameStarted', onGameStarted);
    newSocket.on('newQuestion', onNewQuestion);
    newSocket.on('answerResult', onAnswerResult);
    newSocket.on('questionClosed', onQuestionClosed);
    newSocket.on('gameCompleted', onGameCompleted);
    newSocket.on('leaderboardUpdate', onLeaderboardUpdate);
    
    // Crossword events
    newSocket.on('crosswordGrid', onCrosswordGrid);
    newSocket.on('wordLocked', onWordLocked);
    newSocket.on('wordSolved', onWordSolved);
    newSocket.on('crosswordWinner', onCrosswordWinner);
    newSocket.on('spectatorsUpdate', onSpectatorsUpdate);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (newSocket) {
        // Remove all listeners
        newSocket.off('connect', onConnect);
        newSocket.off('connect_error', onConnectError);
        newSocket.off('disconnect', onDisconnect);
        newSocket.off('reconnect', onReconnect);
        newSocket.off('gameStatus', onGameStatus);
        newSocket.off('gameStarted', onGameStarted);
        newSocket.off('newQuestion', onNewQuestion);
        newSocket.off('answerResult', onAnswerResult);
        newSocket.off('questionClosed', onQuestionClosed);
        newSocket.off('gameCompleted', onGameCompleted);
        newSocket.off('leaderboardUpdate', onLeaderboardUpdate);
        newSocket.off('crosswordGrid', onCrosswordGrid);
        newSocket.off('wordLocked', onWordLocked);
        newSocket.off('wordSolved', onWordSolved);
        newSocket.off('crosswordWinner', onCrosswordWinner);
        newSocket.off('spectatorsUpdate', onSpectatorsUpdate);

        newSocket.disconnect();
      }

      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [gameCode, user, gameType, gameName, navigate]);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/leaderboard`);
      const data = await res.json();
      if (mountedRef.current) setLeaderboard(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
    }
  };

  const fetchCrosswordLeaderboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/crossword/leaderboard`);
      const data = await res.json();
      if (mountedRef.current) setLeaderboard(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching crossword leaderboard:', err);
    }
  };

  const handleAnswer = (answerKey) => {
    if (!socketRef.current || !user || !currentQuestion || isAnswerSubmitted) {
      console.log('Cannot submit answer');
      return;
    }

    setSelectedAnswer(answerKey);
    setIsAnswerSubmitted(true);

    const payload = {
      user_id: user.user_id || user.uid,
      answer: answerKey,
      email: user.email,
      display_name: user.display_name || user.displayName,
      game_code: gameCode || null
    };

    console.log('Submitting answer:', payload);
    socketRef.current.emit('submitAnswer', payload);
  };

  const lockWord = (wordId, direction) => {
    if (!socketRef.current || !user) {
      console.log('Cannot lock word - no socket or user');
      return;
    }
    
    if (lockedWords[wordId]) {
      console.log('Word already locked by:', lockedWords[wordId]);
      return;
    }
    
    console.log('Locking word:', wordId, 'direction:', direction);
    socketRef.current.emit("crosswordLockWord", {
      game_code: gameCode,
      user_id: user.user_id || user.uid,
      crossword_question_id: wordId,
      direction: direction
    });
  };

  const submitWord = (wordId, answer) => {
    if (!socketRef.current || !user) {
      console.log('Cannot submit word - no socket or user');
      return;
    }
    
    const lockedBy = lockedWords[wordId];
    const isLockedByUser = lockedBy && (lockedBy.email === user.email || lockedBy.user_id === user.user_id);
    
    if (!isLockedByUser) {
      console.log('Word not locked by user');
      return;
    }
    
    if (!answer || answer.trim().length === 0) {
      alert('Please enter an answer');
      return;
    }
    
    console.log('Submitting word:', wordId, 'answer:', answer);
    socketRef.current.emit("crosswordSubmit", {
      game_code: gameCode,
      user_id: user.user_id || user.uid,
      word: answer.trim().toUpperCase(),
      crossword_question_id: wordId
    });
    
    setWordInput('');
  };

  const handleCellInput = (rowIndex, colIndex, value) => {
    const cellId = `${rowIndex}-${colIndex}`;
    const upperValue = value.toUpperCase();
    
    setCellInputs(prev => ({
      ...prev,
      [cellId]: upperValue
    }));
    
    // Auto-focus next cell if a letter was entered
    if (upperValue.length > 0) {
      setTimeout(() => {
        const nextInput = document.querySelector(`[data-row="${rowIndex}"][data-col="${colIndex + 1}"]`);
        if (nextInput) {
          nextInput.focus();
        }
      }, 10);
    }
  };

  const handleKeyDown = (e, rowIndex, colIndex) => {
    if (e.key === 'Backspace' && !cellInputs[`${rowIndex}-${colIndex}`]) {
      // Move to previous cell on backspace when current is empty
      const prevInput = document.querySelector(`[data-row="${rowIndex}"][data-col="${colIndex - 1}"]`);
      if (prevInput) {
        prevInput.focus();
      }
    } else if (e.key === 'ArrowRight') {
      const nextInput = document.querySelector(`[data-row="${rowIndex}"][data-col="${colIndex + 1}"]`);
      if (nextInput) nextInput.focus();
    } else if (e.key === 'ArrowLeft') {
      const prevInput = document.querySelector(`[data-row="${rowIndex}"][data-col="${colIndex - 1}"]`);
      if (prevInput) prevInput.focus();
    } else if (e.key === 'ArrowDown') {
      const downInput = document.querySelector(`[data-row="${rowIndex + 1}"][data-col="${colIndex}"]`);
      if (downInput) downInput.focus();
    } else if (e.key === 'ArrowUp') {
      const upInput = document.querySelector(`[data-row="${rowIndex - 1}"][data-col="${colIndex}"]`);
      if (upInput) upInput.focus();
    }
  };

  const getCellLetter = (rowIndex, colIndex) => {
    const cellId = `${rowIndex}-${colIndex}`;
    return cellInputs[cellId] || '';
  };
  const isCellInWord = (wordId, row, col, clues) => {
  const clue = clues.find(c => (c.id || c.clueId || c.number) === wordId);
  if (!clue) return false;
  
  const { direction, startRow, startCol, length } = clue;
  
  if (direction === 'across' || direction === 'horizontal') {
    return row === startRow && col >= startCol && col < startCol + length;
  } else if (direction === 'down' || direction === 'vertical') {
    return col === startCol && row >= startRow && row < startRow + length;
  }
  
  return false;
};
  const handleNextQuestion = () => {
    if (socketRef.current && socketRef.current.connected) {
      console.log('➡️ Emitting nextQuestion event');
      socketRef.current.emit('nextQuestion', { game_code: gameCode || null });
      setResult((prev) => ({ ...prev, showNextButton: false }));
      setSelectedAnswer('');
      setIsAnswerSubmitted(false);
    } else {
      console.error('Socket not connected');
    }
  };

  const handlePlayAgain = () => {
    setGameCompleted(false);
    setFinalResults(null);
    setGameStats({
      score: 0,
      correct: 0,
      total: 0,
      questionsAnswered: 0
    });
    setCurrentQuestion(null);
    setResult({
      message: '',
      correct: false,
      points: 0,
      correctAnswer: '',
      correctAnswerKey: null,
      showNextButton: false
    });
    setIsAnswerSubmitted(false);
    
    // Reset crossword states
    setCrosswordData({
      grid: [],
      acrossClues: [],
      downClues: [],
      cellNumbers: {}
    });
    setLockedWords({});
    setCompletedWords([]);
    setWinner(null);
    setWordInput('');
    setCellInputs({});
    setCrosswordClues([]);
    setShowWinnerAnimation(false);

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('playAgain', {
        user_id: user?.user_id || user?.uid,
        game_code: gameCode || null
      });
      
      if (gameType === "A. Crossword") {
        fetchCrosswordLeaderboard();
      } else {
        fetchLeaderboard();
      }
    } else {
      window.location.reload();
    }
  };

  const refreshGameStatus = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('getGameStatus', { game_code: gameCode || null });
    }
  };

  const computedAccuracy =
    gameStats.total > 0
      ? formatAccuracy((gameStats.correct / gameStats.total) * 100)
      : '0.00';

  const isCellEditable = (rowIndex, colIndex) => {
    // Check if user has locked any word that includes this cell
    return Object.entries(lockedWords).some(([wordId, locker]) => 
      locker.email === user?.email
    );
  };

const renderCrosswordGrid = () => {
  console.log('DEBUG crosswordData:', crosswordData);
  console.log('DEBUG grid exists?', crosswordData?.grid?.length > 0);
  
  if (!crosswordData.grid || crosswordData.grid.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4 animate-pulse">🧩</div>
        <h3 className="text-2xl font-bold text-white mb-2">Loading Crossword...</h3>
        <p className="text-gray-300">Waiting for crossword puzzle to load</p>
        {socketRef.current && (
          <button 
            onClick={() => {
              socketRef.current.emit('joinGame', {
                game_code: gameCode,
                user_id: user?.user_id || user?.uid
              });
            }}
            className="mt-4 bg-cyan-600 hover:bg-cyan-500 px-4 py-2 rounded-lg text-white"
          >
            Retry Loading
          </button>
        )}
      </div>
    );
  }
  
  const { grid, cellNumbers } = crosswordData;
  const rows = grid.length;
  const cols = grid[0] ? grid[0].length : 0;
  
  // Get clues from the correct place
  const clues = crosswordClues.length > 0 ? crosswordClues : 
                (crosswordData.clues || []);
  const acrossClues = clues.filter(clue => clue.direction === 'across' || clue.direction === 'horizontal');
  const downClues = clues.filter(clue => clue.direction === 'down' || clue.direction === 'vertical');
  
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="lg:w-2/3">
        <div className="bg-gray-900 p-4 rounded-xl border-2 border-cyan-600">
          <h3 className="text-xl font-bold text-white mb-4 text-center">
            {gameName || "Crossword Puzzle"}
          </h3>
          
          {/* DEBUG INFO - Remove in production */}
          <div className="text-xs text-gray-400 mb-2">
            Grid: {rows}x{cols} | Across: {acrossClues.length} | Down: {downClues.length}
          </div>
          
          <div 
            className="grid gap-1 mx-auto"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              maxWidth: `${cols * 44}px`
            }}
          >
            {grid.map((row, rowIndex) =>
              row.map((cell, colIndex) => {
                const cellId = `${rowIndex}-${colIndex}`;
                const isBlack = cell === '#' || cell === null || cell === '.';
                const cellNumber = cellNumbers && cellNumbers[cellId];
                const letter = getCellLetter(rowIndex, colIndex);
                
                // Check if user has locked this cell
                const isLockedByMe = Object.entries(lockedWords).some(([wordId, locker]) => 
                  locker.email === user?.email && isCellInWord(wordId, rowIndex, colIndex, clues)
                );
                
                return (
                  <div
                    key={cellId}
                    className={`relative w-10 h-10 flex items-center justify-center font-bold rounded ${
                      isBlack 
                        ? 'bg-black' 
                        : 'bg-white text-black border border-gray-300'
                    }`}
                  >
                    {cellNumber && !isBlack && (
                      <div className="absolute top-0 left-1 text-xs font-bold text-black">
                        {cellNumber}
                      </div>
                    )}
                    
                    {!isBlack ? (
                      <input
                        type="text"
                        value={letter}
                        onChange={(e) => handleCellInput(rowIndex, colIndex, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                        disabled={!isLockedByMe}
                        data-row={rowIndex}
                        data-col={colIndex}
                        className={`w-full h-full text-center uppercase font-bold text-xl ${
                          isLockedByMe 
                            ? "bg-white text-black focus:bg-blue-100 focus:ring-2 focus:ring-blue-500" 
                            : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        }`}
                        maxLength={1}
                        style={{ fontSize: '1.25rem' }}
                      />
                    ) : null}
                    
                    {!isBlack && isLockedByMe && (
                      <div className="absolute bottom-0 right-0 w-2 h-2 bg-blue-500 rounded-full"></div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      
      <div className="lg:w-1/3">
        <div className="bg-gray-800 rounded-xl p-4 border-2 border-cyan-600">
          <h3 className="text-xl font-bold text-cyan-400 mb-4">Clues</h3>
          
          {/* ACROSS Clues */}
          {acrossClues.length > 0 && (
            <div className="mb-6">
              <h4 className="text-lg font-bold text-white mb-2">ACROSS</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {acrossClues.map((clue) => {
                  const clueId = clue.id || clue.clueId || clue.number;
                  const isLocked = lockedWords[clueId];
                  const isCompleted = completedWords.includes(clueId);
                  const isLockedByMe = isLocked && isLocked.email === user?.email;
                  
                  return (
                    <div
                      key={clueId}
                      className={`p-3 rounded-lg ${
                        isCompleted ? 'bg-green-800' :
                        isLockedByMe ? 'bg-cyan-800' :
                        isLocked ? 'bg-red-800' :
                        'bg-gray-700'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-bold text-white">
                            {clue.number}. {clue.clue || clue.question}
                          </div>
                          <div className="text-sm text-gray-300 mt-1">
                            Length: {clue.length || clue.answer?.length || '?'} letters
                          </div>
                          {isCompleted && (
                            <div className="text-xs text-green-300 mt-1">
                              ✓ Solved
                            </div>
                          )}
                        </div>
                        <div>
                          {isLockedByMe ? (
                            <div className="flex flex-col gap-2 w-32">
                              <input
                                type="text"
                                value={wordInput}
                                onChange={(e) => setWordInput(e.target.value.toUpperCase())}
                                className="px-2 py-1 bg-gray-900 text-white rounded w-full"
                                placeholder="Enter answer"
                                onKeyPress={(e) => e.key === 'Enter' && submitWord(clueId, wordInput)}
                              />
                              <button
                                onClick={() => submitWord(clueId, wordInput)}
                                className="bg-green-600 hover:bg-green-500 px-3 py-1 rounded text-sm"
                              >
                                Submit
                              </button>
                            </div>
                          ) : !isLocked && !isCompleted ? (
                            <button
                              onClick={() => lockWord(clueId, 'across')}
                              className="bg-cyan-600 hover:bg-cyan-500 px-3 py-1 rounded text-sm whitespace-nowrap"
                            >
                              Lock Word
                            </button>
                          ) : isCompleted ? (
                            <span className="text-green-400 text-sm font-bold">✓</span>
                          ) : (
                            <div className="text-right">
                              <div className="text-red-400 text-xs">Locked by</div>
                              <div className="text-red-300 text-sm font-semibold">
                                {isLocked.display_name || isLocked.email?.split('@')[0]}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* DOWN Clues */}
          {downClues.length > 0 && (
            <div>
              <h4 className="text-lg font-bold text-white mb-2">DOWN</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {downClues.map((clue) => {
                  const clueId = clue.id || clue.clueId || clue.number;
                  const isLocked = lockedWords[clueId];
                  const isCompleted = completedWords.includes(clueId);
                  const isLockedByMe = isLocked && isLocked.email === user?.email;
                  
                  return (
                    <div
                      key={clueId}
                      className={`p-3 rounded-lg ${
                        isCompleted ? 'bg-green-800' :
                        isLockedByMe ? 'bg-cyan-800' :
                        isLocked ? 'bg-red-800' :
                        'bg-gray-700'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-bold text-white">
                            {clue.number}. {clue.clue || clue.question}
                          </div>
                          <div className="text-sm text-gray-300 mt-1">
                            Length: {clue.length || clue.answer?.length || '?'} letters
                          </div>
                          {isCompleted && (
                            <div className="text-xs text-green-300 mt-1">
                              ✓ Solved
                            </div>
                          )}
                        </div>
                        <div>
                          {isLockedByMe ? (
                            <div className="flex flex-col gap-2 w-32">
                              <input
                                type="text"
                                value={wordInput}
                                onChange={(e) => setWordInput(e.target.value.toUpperCase())}
                                className="px-2 py-1 bg-gray-900 text-white rounded w-full"
                                placeholder="Enter answer"
                                onKeyPress={(e) => e.key === 'Enter' && submitWord(clueId, wordInput)}
                              />
                              <button
                                onClick={() => submitWord(clueId, wordInput)}
                                className="bg-green-600 hover:bg-green-500 px-3 py-1 rounded text-sm"
                              >
                                Submit
                              </button>
                            </div>
                          ) : !isLocked && !isCompleted ? (
                            <button
                              onClick={() => lockWord(clueId, 'down')}
                              className="bg-cyan-600 hover:bg-cyan-500 px-3 py-1 rounded text-sm whitespace-nowrap"
                            >
                              Lock Word
                            </button>
                          ) : isCompleted ? (
                            <span className="text-green-400 text-sm font-bold">✓</span>
                          ) : (
                            <div className="text-right">
                              <div className="text-red-400 text-xs">Locked by</div>
                              <div className="text-red-300 text-sm font-semibold">
                                {isLocked.display_name || isLocked.email?.split('@')[0]}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {(acrossClues.length === 0 && downClues.length === 0) && (
            <div className="text-center text-gray-400 py-4">
              No clues loaded yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

  const renderWinnerAnimation = () => {
    if (!showWinnerAnimation || !winner) return null;

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-90 z-50">
        <div className="text-center animate-pulse">
          <div className="text-8xl mb-6 animate-bounce">🏆</div>
          <h1 className="text-5xl font-extrabold text-yellow-400 mb-4">
            {winner.display_name || winner.email?.split('@')[0]}
          </h1>
          <p className="text-2xl text-yellow-200 mb-2">
            Wins the {gameType === "A. Crossword" ? "Crossword" : "Game"}!
          </p>
          <p className="text-xl text-yellow-100">
            Final Score: <span className="font-bold">{winner.score || winner.session_score || 0}</span> points
          </p>
        </div>
      </div>
    );
  };

  const renderMCQQuestion = () => {
    if (!currentQuestion) {
      return (
        <div className="text-center py-16">
          <div className="text-6xl text-cyan-400 mb-6">⏳</div>
          <h3 className="text-3xl font-bold text-white mb-4">
            Waiting for Questions
          </h3>
          <p className="text-gray-300 text-lg">
            {gameStatus.questionsLoaded === 0 
              ? "No questions available. Please ask the administrator to upload questions."
              : "The next question will appear shortly. Get ready!"}
          </p>
        </div>
      );
    }

    return (
      <>
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 p-4 bg-gray-700 rounded-lg">
          <div className="flex items-center gap-4 mb-2 sm:mb-0">
            <div className="text-2xl font-bold text-cyan-400 bg-gray-900 px-4 py-2 rounded-lg">
              {timeLeft}s
            </div>
            <div className="text-lg text-gray-300">
              Difficulty:{' '}
              <span className="font-bold text-cyan-300">
                {currentQuestion.difficulty}
              </span>
            </div>
            <div className="text-lg text-cyan-200">
              Question:{' '}
              <span className="font-bold text-cyan-300">
                {(currentQuestion.questionNumber || 1)}/
                {currentQuestion.totalQuestions || gameStatus.questionsLoaded || '?'}
              </span>
            </div>
          </div>

          <div className="text-lg text-cyan-200">
            Your Score:{' '}
            <span className="font-bold text-cyan-300">
              {gameStats.score}
            </span>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white mb-8 leading-relaxed">
          {currentQuestion.text}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {Object.entries(currentQuestion.options || {}).map(
            ([key, value]) => {
              const isSelected = selectedAnswer === key;
              const correctKeyFromResult = result.correctAnswerKey ?? null;
              const isCorrect = Boolean(result.correct) && isSelected;
              const isWrong = !result.correct && isSelected;
              const isCorrectAnswer = correctKeyFromResult
                ? correctKeyFromResult === key
                : result.correctAnswer &&
                  (result.correctAnswer === value ||
                    result.correctAnswer === key);
              const isDisabled = isAnswerSubmitted || timeLeft === 0;

              return (
                <button
                  key={key}
                  onClick={() => handleAnswer(key)}
                  disabled={isDisabled}
                  className={`p-4 rounded-xl text-left font-semibold text-lg transition-all duration-200 ${
                    isSelected
                      ? isCorrect
                        ? 'bg-green-600 text-white border-2 border-green-400'
                        : 'bg-red-600 text-white border-2 border-red-400'
                      : isCorrectAnswer && result.message
                      ? 'bg-green-600 text-white border-2 border-green-400'
                      : isDisabled
                      ? 'bg-gray-800 text-gray-500 border-2 border-gray-700 cursor-not-allowed'
                      : 'bg-gray-700 text-white hover:bg-gray-600 border-2 border-gray-600 hover:border-cyan-500 cursor-pointer hover:scale-105'
                  }`}
                >
                  <span className="font-bold mr-3">{key}.</span>
                  {value}
                </button>
              );
            }
          )}
        </div>

        {result.message && (
          <div
            className={`p-4 rounded-lg mb-4 text-center font-bold text-lg ${
              result.correct
                ? 'bg-green-600 text-white'
                : result.message.includes("Time's up")
                ? 'bg-yellow-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {result.message}
          </div>
        )}

        {result.showNextButton && (
          <div className="text-center">
            <button
              onClick={handleNextQuestion}
              disabled={
                !socketRef.current || !socketRef.current.connected
              }
              className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold text-lg transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {!socketRef.current || !socketRef.current.connected
                ? 'Connecting...'
                : 'Next Question →'}
            </button>
          </div>
        )}
      </>
    );
  };

  if (gameCompleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
        <div className="max-w-4xl mx-auto">
          {renderWinnerAnimation()}
          
          <div className="flex justify-between items-center mb-8 p-6 bg-gray-800 rounded-2xl border-2 border-cyan-600">
            <div>
              <h1 className="text-4xl font-bold text-cyan-400 mb-2">
                🎉 Game Completed! 🎉
              </h1>
              <p className="text-cyan-200">
                {gameName} - Final Results
              </p>
            </div>
            {user && (
              <div className="text-right">
                <p className="text-cyan-100 font-semibold">
                  {user.display_name || user.displayName}
                </p>
                <p className="text-cyan-200 text-sm">{user.email}</p>
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-2xl p-8 border-2 border-cyan-600">
            {winner && !showWinnerAnimation && (
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold text-yellow-400 mb-4">🏆 Winner!</h2>
                <div className="bg-gradient-to-r from-yellow-600 to-yellow-800 p-6 rounded-xl mb-6">
                  <p className="text-3xl font-bold text-white">
                    {winner.display_name || winner.email}
                  </p>
                  <p className="text-xl text-yellow-200 mt-2">
                    Score: {winner.score || winner.session_score || 0} points
                  </p>
                </div>
              </div>
            )}

            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-cyan-300 mb-4">
                Your Final Score
              </h2>
              <div className="text-6xl font-bold text-cyan-400 mb-2">
                {gameStats.score}
              </div>
              {gameType !== "A. Crossword" && (
                <div className="text-xl text-cyan-200">
                  {gameStats.correct}/30 Correct • {computedAccuracy}% Accuracy
                </div>
              )}
              {gameType === "A. Crossword" && (
                <div className="text-xl text-cyan-200">
                  {gameStats.correct} words solved • {gameStats.questionsAnswered} attempts
                </div>
              )}
            </div>

            {finalResults?.finalResults?.results && (
              <div className="mb-8">
                <h3 className="text-2xl font-bold text-cyan-300 mb-4 text-center">
                  🏆 Final Rankings
                </h3>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {finalResults.finalResults.results.map((player, index) => {
                    const isCurrentUser =
                      user && player.email === user.email;
                    return (
                      <div
                        key={player.user_id}
                        className={`flex justify-between items-center p-4 rounded-lg ${
                          isCurrentUser
                            ? 'bg-cyan-700 border-2 border-cyan-400'
                            : index === 0
                            ? 'bg-yellow-600'
                            : index === 1
                            ? 'bg-gray-600'
                            : index === 2
                            ? 'bg-amber-800'
                            : 'bg-gray-700'
                        } ${isCurrentUser ? 'scale-105' : ''}`}
                      >
                        <div className="flex items-center">
                          <span
                            className={`text-xl font-bold mr-4 ${
                              index < 3 ? 'text-white' : 'text-cyan-300'
                            }`}
                          >
                            {index + 1}
                          </span>
                          <div>
                            <div
                              className={`font-semibold ${
                                isCurrentUser ? 'text-cyan-100' : 'text-white'
                              }`}
                            >
                              {player.display_name || player.email}
                            </div>
                            {isCurrentUser && (
                              <div className="text-cyan-200 text-sm">You</div>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-cyan-300">
                            {player.session_score ?? player.score ?? 0} pts
                          </div>
                          {gameType !== "A. Crossword" && (
                            <div className="text-sm text-gray-300">
                              {formatAccuracy(player.accuracy ?? 0)}% accuracy
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => navigate("/dashboard")}
                className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                📊 View Dashboard
              </button>
              <button
                onClick={onLogout}
                className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                🚪 Logout
              </button>
              <button
                onClick={handlePlayAgain}
                className="px-8 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                🔄 Play Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-cyan-400 mb-2">
            Connecting to {gameName}...
          </h2>
          <p className="text-cyan-200">
            Please wait while we connect to the game server
          </p>
          {gameCode && (
            <p className="text-cyan-300 mt-2">Game Code: {gameCode}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
      {renderWinnerAnimation()}
      
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row justify-between items-center mb-8 p-6 bg-gray-800 rounded-2xl border-2 border-cyan-600">
          <div className="text-center lg:text-left mb-4 lg:mb-0">
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">
              {gameType === "A. Crossword" ? "🧩 " : "🧠 "}
              {gameName}
            </h1>
            <p className="text-cyan-200">
              {gameType === "A. Crossword" 
                ? "Collaborative Crossword Puzzle" 
                : "Real-time Compiler Design Quiz"}
            </p>
            <div className="mt-2 text-sm text-cyan-300">
              {gameType === "A. Crossword" ? (
                <>Words: {crosswordData.acrossClues.length + crosswordData.downClues.length} | Solved: {completedWords.length} | Locked: {Object.keys(lockedWords).length}</>
              ) : (
                <>Questions: {gameStatus.questionsLoaded} | Status: {gameStatus.isGameActive ? '🟢 ACTIVE' : '🟡 WAITING'}</>
              )} | Connection: {connected ? '🟢 Connected' : '🔴 Disconnected'}
            </div>
            {gameCode && (
              <div className="mt-1 text-xs text-cyan-400">
                Game Code: <span className="font-mono">{gameCode}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-center">
            {user && (
              <div className="text-center sm:text-right">
                <p className="text-cyan-100 font-semibold">
                  {user.display_name || user.displayName}
                </p>
                <p className="text-cyan-200 text-sm">{user.email}</p>
              </div>
            )}

            <div className="flex gap-2 items-center">
              <div
                className={`w-3 h-3 rounded-full ${
                  connected ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm text-gray-300">
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            <button
              onClick={refreshGameStatus}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              Refresh
            </button>

            <button
              onClick={onLogout}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600">
              {gameType === "A. Crossword" ? (
                // Crossword UI
                <>
                  <div className="mb-6 text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">
                      {gameName || "CROSSWORD PUZZLE"}
                    </h2>
                    <p className="text-gray-300">
                      Solve the crossword by locking words and entering answers. 
                      First correct answer gets +15 points, subsequent correct answers get +10 points.
                    </p>
                  </div>
                  
                  {renderCrosswordGrid()}
                  
                  {result.message && (
                    <div
                      className={`mt-4 p-4 rounded-lg text-center font-bold text-lg ${
                        result.correct && result.points === 15
                          ? 'bg-yellow-600 text-white'
                          : result.correct
                          ? 'bg-green-600 text-white'
                          : 'bg-red-600 text-white'
                      }`}
                    >
                      {result.message}
                    </div>
                  )}
                  
                  {completedWords.length === (crosswordData.acrossClues.length + crosswordData.downClues.length) && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-green-700 to-emerald-800 rounded-lg text-center">
                      <div className="text-2xl font-bold text-white mb-2">
                        🎉 Crossword Completed!
                      </div>
                      <p className="text-green-200">
                        All words have been solved. Waiting for final game results...
                      </p>
                    </div>
                  )}
                </>
              ) : (
                // MCQ UI
                renderMCQQuestion()
              )}
            </div>
          </div>

          <div className="bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600 h-fit">
            <h2 className="text-2xl font-bold text-cyan-400 mb-6 text-center">
              🏆 Live Leaderboard
            </h2>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {leaderboard.map((player, index) => {
                const isCurrentUser = user && player.email === user.email;
                return (
                  <div
                    key={player.user_id || player.email || index}
                    className={`flex justify-between items-center p-3 rounded-lg transition-all ${
                      isCurrentUser
                        ? 'bg-cyan-700 border-2 border-cyan-400'
                        : index === 0
                        ? 'bg-yellow-600'
                        : index === 1
                        ? 'bg-gray-600'
                        : index === 2
                        ? 'bg-amber-800'
                        : 'bg-gray-700'
                    } ${isCurrentUser ? 'scale-105' : ''}`}
                  >
                    <div className="flex items-center min-w-0">
                      <span
                        className={`font-bold mr-3 ${
                          index < 3 ? 'text-white' : 'text-cyan-300'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate font-semibold ${
                            isCurrentUser ? 'text-cyan-100' : 'text-white'
                          }`}
                        >
                          {player.display_name || player.email}
                        </div>
                        {isCurrentUser && (
                          <div className="text-cyan-200 text-xs">You</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-cyan-300">
                        {player.score ?? player.session_score ?? 0}
                      </div>
                      {gameType !== "A. Crossword" && (
                        <div className="text-xs text-gray-300">
                          {formatAccuracy(player.accuracy ?? 0)}%
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {leaderboard.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  No scores yet. Be the first!
                </div>
              )}
            </div>

            <div className="mt-6 p-4 bg-gray-700 rounded-lg">
              <h3 className="text-lg font-bold text-cyan-300 mb-3">
                Your Stats
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-2xl font-bold text-cyan-400">
                    {gameStats.score}
                  </div>
                  <div className="text-xs text-gray-300">Score</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-400">
                    {gameStats.correct}
                  </div>
                  <div className="text-xs text-gray-300">
                    {gameType === "A. Crossword" ? "Words Solved" : "Correct"}
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-cyan-300">
                    {gameStats.questionsAnswered}
                  </div>
                  <div className="text-xs text-gray-300">
                    {gameType === "A. Crossword" ? "Attempts" : "Answered"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-700 rounded-lg">
              <h3 className="text-lg font-bold text-cyan-300 mb-2">
                Game Status
              </h3>
              <div className="text-sm text-gray-300 space-y-1">
                {gameType === "A. Crossword" ? (
                  <>
                    <div className="flex justify-between">
                      <span>Words:</span>
                      <span className="text-cyan-300">
                        {crosswordData.acrossClues.length + crosswordData.downClues.length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Solved:</span>
                      <span className="text-green-400">
                        {completedWords.length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Locked:</span>
                      <span className="text-yellow-400">
                        {Object.keys(lockedWords).length}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span>Questions:</span>
                      <span className="text-cyan-300">
                        {gameStatus.questionsLoaded}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span
                        className={
                          gameStatus.isGameActive
                            ? 'text-green-400'
                            : 'text-yellow-400'
                        }
                      >
                        {gameStatus.isGameActive ? 'Active 🟢' : 'Waiting 🟡'}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span>Connection:</span>
                  <span
                    className={
                      connected ? 'text-green-400' : 'text-red-400'
                    }
                  >
                    {connected ? 'Connected 🟢' : 'Disconnected 🔴'}
                  </span>
                </div>
              </div>
            </div>

            {gameType === "A. Crossword" && spectators.length > 0 && (
              <div className="mt-4 p-3 bg-gray-700 rounded-lg">
                <h3 className="text-lg font-bold text-cyan-300 mb-2">
                  👥 Spectators
                </h3>
                <div className="text-sm text-gray-300">
                  {spectators.map((spec, idx) => (
                    <div key={idx} className="truncate">
                      {spec.display_name || spec.email}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => navigate("/dashboard")}
              className="w-full mt-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold transition-colors"
            >
              Exit Game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameUI;