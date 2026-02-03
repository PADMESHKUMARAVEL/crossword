import React, { useState, useEffect } from 'react';

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4001";

// Helper function to format accuracy
const formatAccuracy = (accuracy) => {
  if (accuracy === null || accuracy === undefined) return '0.0';
  return typeof accuracy === 'number' ? accuracy.toFixed(1) : parseFloat(accuracy || 0).toFixed(1);
};

const StudentDashboard = () => {
  const [userStats, setUserStats] = useState(null);
  const [gameSummary, setGameSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);
  const [gameSessions, setGameSessions] = useState([]);

  const userId = localStorage.getItem('user_id');
  const userEmail = localStorage.getItem('user_email');

  useEffect(() => {
    if (userId) {
      fetchUserStats();
      fetchLeaderboard();
    } else {
      setLoading(false);
    }
  }, [userId]);

  const fetchUserStats = async () => {
    if (!userId) return;
    
    try {
      const response = await fetch(`${API_BASE}/user/${userId}/stats`);
      if (response.ok) {
        const stats = await response.json();
        setUserStats(stats);
        setGameSessions(stats.game_sessions || []);
        
        // Extract game summary from stats
        if (stats.game_stats) {
          setGameSummary({
            summary: {
              total_score: stats.performance?.score || 0,
              questions_answered: stats.performance?.attempts || 0,
              correct_answers: stats.performance?.correct_answers || 0,
              accuracy: stats.performance?.accuracy || 0,
              total_possible: 450,
              by_difficulty: stats.game_stats.by_difficulty || {}
            }
          });
        }
      }
    } catch (error) {
      console.error('Error fetching user stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${API_BASE}/leaderboard?limit=10`);
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data);
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading dashboard...</div>
      </div>
    );
  }

  const performance = userStats?.performance || {};
  const gameStats = userStats?.game_stats || {};
  const userRank = leaderboard.findIndex(player => player.user_id == userId) + 1;

  const difficultyData = gameSummary?.summary?.by_difficulty || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-purple-400 mb-4">Student Dashboard</h1>
          <p className="text-xl text-purple-200">Track your learning progress</p>
        </div>

        {userStats ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* User Info Card */}
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-purple-600">
              <h2 className="text-2xl font-bold text-purple-300 mb-4">👤 Student Profile</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-sm">Name</label>
                  <p className="text-white font-semibold">{userStats.user?.display_name || 'Anonymous'}</p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm">Email</label>
                  <p className="text-white font-semibold">{userStats.user?.email || userEmail}</p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm">Member Since</label>
                  <p className="text-white font-semibold">
                    {userStats.user?.created_at ? new Date(userStats.user.created_at).toLocaleDateString() : 'Recent'}
                  </p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm">Global Rank</label>
                  <p className="text-white font-semibold">
                    {userRank > 0 ? `#${userRank}` : 'Not ranked yet'}
                  </p>
                </div>
              </div>
            </div>

            {/* Game Progress */}
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4">🎮 Game Progress</h2>
              <div className="text-center mb-4">
                <div className="text-4xl font-bold text-cyan-400 mb-2">
                  {performance.score || 0} / {gameStats.total_possible_score || 450}
                </div>
                <div className="text-cyan-200">Total Score</div>
                <div className="text-lg text-green-400 mt-2">
                  {gameStats.current_percentage || 0}% Complete
                </div>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-4">
                <div 
                  className="bg-cyan-600 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${gameStats.current_percentage || 0}%` }}
                ></div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-center">
                <div className="p-2 bg-cyan-900 rounded">
                  <div className="text-cyan-300 font-bold">{gameStats.questions_answered || 0}</div>
                  <div className="text-cyan-200 text-sm">Answered(out of 30)</div>
                </div>
                <div className="p-2 bg-green-900 rounded">
                  <div className="text-green-300 font-bold">{performance.correct_answers || 0}</div>
                  <div className="text-green-200 text-sm">Correct</div>
                </div>
              </div>
            </div>

            {/* Rank Card */}
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-yellow-600">
              <h2 className="text-2xl font-bold text-yellow-300 mb-4">🏆 Your Rank</h2>
              <div className="text-center py-4">
                <div className="text-6xl font-bold text-yellow-400 mb-4">
                  #{userRank > 0 ? userRank : '--'}
                </div>
                <p className="text-yellow-200">
                  {userRank > 0 
                    ? `You are ranked ${userRank} out of ${leaderboard.length} students`
                    : 'Play some games to get ranked!'
                  }
                </p>
                {userRank > 0 && (
                  <div className="mt-4 text-sm text-gray-300">
                    <div>Accuracy: {formatAccuracy(performance.accuracy)}%</div>
                    <div>Total Attempted questions(out of 30): {performance.attempts || 0}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Game Sessions History */}
            {gameSessions.length > 0 && (
              <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-blue-600">
                <h2 className="text-2xl font-bold text-blue-300 mb-4">📈 Game Session History</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-white">
                    <thead>
                      <tr className="bg-blue-700">
                        <th className="p-3 text-left">Session ID</th>
                        <th className="p-3 text-right">Questions</th>
                        <th className="p-3 text-right">Correct</th>
                        <th className="p-3 text-right">Score</th>
                        <th className="p-3 text-right">Accuracy</th>
                        <th className="p-3 text-right">Last Played</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameSessions.map((session, index) => (
                        <tr key={session.game_session_id} className="border-b border-gray-700 hover:bg-gray-700">
                          <td className="p-3 text-blue-300 font-mono text-sm">
                            {session.game_session_id?.substring(0, 8)}...
                          </td>
                          <td className="p-3 text-right">{session.questions_answered || 0}</td>
                          <td className="p-3 text-right text-green-400">{session.correct_answers || 0}</td>
                          <td className="p-3 text-right font-bold text-cyan-300">{session.session_score || 0}</td>
                          <td className="p-3 text-right">
                            {session.questions_answered > 0 
                              ? `${formatAccuracy((session.correct_answers / session.questions_answered) * 100)}%`
                              : '0%'
                            }
                          </td>
                          <td className="p-3 text-right text-gray-400 text-sm">
                            {session.last_answered ? new Date(session.last_answered).toLocaleDateString() : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Score Breakdown */}
            <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-green-600">
              <h2 className="text-2xl font-bold text-green-300 mb-4">📊 Score Breakdown by Difficulty</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-blue-900 rounded-lg">
                  <div className="text-2xl font-bold text-blue-300">{difficultyData.easy?.score || 0}</div>
                  <div className="text-blue-200">Easy Questions</div>
                  <div className="text-sm text-blue-300 mt-2">
                    {difficultyData.easy?.correct || 0} correct of {difficultyData.easy?.total || 0} answered
                  </div>
                  <div className="text-xs text-blue-200 mt-1">
                    {difficultyData.easy?.total ? 
                      formatAccuracy((difficultyData.easy.correct / difficultyData.easy.total) * 100) : 0
                    }% accuracy
                  </div>
                </div>
                <div className="text-center p-4 bg-yellow-900 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-300">{difficultyData.medium?.score || 0}</div>
                  <div className="text-yellow-200">Medium Questions</div>
                  <div className="text-sm text-yellow-300 mt-2">
                    {difficultyData.medium?.correct || 0} correct of {difficultyData.medium?.total || 0} answered
                  </div>
                  <div className="text-xs text-yellow-200 mt-1">
                    {difficultyData.medium?.total ? 
                      formatAccuracy((difficultyData.medium.correct / difficultyData.medium.total) * 100) : 0
                    }% accuracy
                  </div>
                </div>
                <div className="text-center p-4 bg-red-900 rounded-lg">
                  <div className="text-2xl font-bold text-red-300">{difficultyData.hard?.score || 0}</div>
                  <div className="text-red-200">Hard Questions</div>
                  <div className="text-sm text-red-300 mt-2">
                    {difficultyData.hard?.correct || 0} correct of {difficultyData.hard?.total || 0} answered
                  </div>
                  <div className="text-xs text-red-200 mt-1">
                    {difficultyData.hard?.total ? 
                      formatAccuracy((difficultyData.hard.correct / difficultyData.hard.total) * 100) : 0
                    }% accuracy
                  </div>
                </div>
              </div>
              <div className="mt-4 text-center">
                <div className="text-lg text-gray-300">
                  Total Score: <span className="font-bold text-green-400">{gameSummary?.summary?.total_score || 0}</span> / {gameSummary?.summary?.total_possible || 450}
                </div>
                <div className="text-sm text-gray-400">
                  {gameSummary?.summary?.correct_answers || 0} correct out of {gameSummary?.summary?.questions_answered || 0} answered
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-blue-600">
              <h2 className="text-2xl font-bold text-blue-300 mb-4">⚡ Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => window.location.href = '/gamepage'}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold transition-colors"
                >
                  🎯 Play Wisdom Warfare
                </button>
                <button
                  onClick={() => window.location.href = '/'}
                  className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold transition-colors"
                >
                  🔄 Back to Main Menu
                </button>
                <button
                  onClick={() => {
                    fetchUserStats();
                    fetchLeaderboard();
                  }}
                  className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold transition-colors"
                >
                  📈 Refresh Stats
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-white bg-gray-800 rounded-2xl p-12">
            <div className="text-6xl mb-4">🎮</div>
            <h2 className="text-2xl font-bold mb-4">Ready to Start Learning?</h2>
            <p className="text-gray-300 mb-6">Play some games to see your statistics and progress!</p>
            <button
              onClick={() => window.location.href = '/gamepage'}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-3 rounded-lg font-bold text-lg"
            >
              Start Playing Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentDashboard;