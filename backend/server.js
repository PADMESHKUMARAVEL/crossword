require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const mysql = require("mysql2/promise");
const { Server } = require("socket.io");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordgenerate");

const app = express();

// ----- CORS -----
const corsOptions = {
  origin: (origin, callback) => {
    callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// simple logger
app.use((req, res, next) => {
  if (req.path.startsWith("/auth") || req.path.startsWith("/teacher")) {
    console.log("➡️", req.method, req.path, "Origin:", req.headers.origin);
  }
  next();
});

// ----- SERVER_BASE / PORT handling -----
const DEFAULT_PORT = parseInt(process.env.PORT || "4001", 10);
let SERVER_PORT = DEFAULT_PORT;
function getServerBase() {
  return process.env.SERVER_BASE || `http://localhost:${SERVER_PORT}`;
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ----- DB -----
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "wisdomwarfare",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ==========================================
// ----- GLOBAL GAME STATE MAPS -----
// ==========================================

// ----- Game state -----
let questions = [];
let currentIndex = -1;
let acceptingAnswers = false;
let firstAnswered = false;
let answeredUsers = new Map();
let gameTimer = null;
let currentQuestionStartTime = null;
let gameSessionId = null;
let isGameActive = false;

// ----- Crossword Game State -----
let crosswordGameActive = false;
let crosswordGameSessionId = null;
let crosswordGrid = null;
let crosswordClues = null;
let crosswordPlacedWords = null;
let currentCrosswordQuestions = [];
let crosswordAnswers = new Map(); // user_id -> { answers: {}, score: 0 }

// ==========================================
// ----- HELPERS -----
// ==========================================

async function loadQuestions() {
  try {
    console.log("🔄 Loading questions from database...");

    const [rows] = await pool.query(`
      SELECT * FROM questions 
      WHERE text IS NOT NULL 
      AND option_a IS NOT NULL 
      AND option_b IS NOT NULL 
      AND option_c IS NOT NULL 
      AND option_d IS NOT NULL 
      AND correct IS NOT NULL
      ORDER BY 
        CASE difficulty 
          WHEN 'Easy' THEN 1 
          WHEN 'Medium' THEN 2 
          WHEN 'Hard' THEN 3 
          ELSE 4 
        END, id
      LIMIT 30
    `);

    questions = rows || [];
    console.log(`✅ ${questions.length} questions loaded successfully`);

    return questions.length;
  } catch (err) {
    console.error("❌ Error loading questions:", err.message);
    questions = [];
    return 0;
  }
}

function generateGameSessionId() {
  return `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getCorrectAnswerText(question) {
  if (!question) {
    console.log("❌ No question provided");
    return "Unknown";
  }

  console.log("🔍 DEBUG - getCorrectAnswerText called:", {
    questionId: question.id,
    correct: question.correct,
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d
  });

  const correct = String(question.correct).toLowerCase().trim();

  if (correct === "option_a" || correct === "a") {
    console.log("✅ Mapped to option_a:", question.option_a);
    return question.option_a;
  }
  if (correct === "option_b" || correct === "b") {
    console.log("✅ Mapped to option_b:", question.option_b);
    return question.option_b;
  }
  if (correct === "option_c" || correct === "c") {
    console.log("✅ Mapped to option_c:", question.option_c);
    return question.option_c;
  }
  if (correct === "option_d" || correct === "d") {
    console.log("✅ Mapped to option_d:", question.option_d);
    return question.option_d;
  }

  console.log("❌ Could not map correct answer:", correct);
  return "Unknown";
}

function generateShortGameCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++)
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// ----- Multer -----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ==========================================
// ----- API ROUTES -----
// ==========================================

app.get("/", (req, res) => {
  res.json({
    message: "Wisdom Warfare Backend Running! 🚀",
    status: "healthy",
    questionsLoaded: questions.length,
    gameActive: isGameActive,
  });
});

app.get("/user/:user_id/can-play", async (req, res) => {
  try {
     res.json({
      can_play: true,
      message: "User can play the game",
    });
  } catch (err) {
    console.error("Error checking play status:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/questions", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM questions 
      ORDER BY 
        CASE difficulty 
          WHEN 'Easy' THEN 1 
          WHEN 'Medium' THEN 2 
          WHEN 'Hard' THEN 3 
          ELSE 4 
        END, id
      LIMIT 30
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/game/status", (req, res) => {
  res.json({
    questionsLoaded: questions.length,
    currentIndex: currentIndex,
    acceptingAnswers: acceptingAnswers,
    gameSessionId: gameSessionId,
    isGameActive: isGameActive,
    currentQuestion:
      currentIndex >= 0 && currentIndex < questions.length
        ? questions[currentIndex]
        : null,
  });
});

// 5) START GAME (GLOBAL SESSION – MODE A)
app.post("/admin/start-game", async (req, res) => {
  try {
    console.log("🎮 Admin starting game...");

    const { game_code = null, teacher_game_id = null } = req.body || {};
    if (game_code || teacher_game_id) {
      console.log("👉 start-game called with:", {
        game_code,
        teacher_game_id,
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.log("🔄 No questions in memory, reloading from DB...");
      await loadQuestions();
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.log("❌ Still no questions after reload.");
      return res.status(400).json({
        success: false,
        error: "No questions available. Please upload questions first.",
      });
    }

    startNewGameSession();

    io.emit("gameStatus", {
      questionsLoaded: questions.length,
      currentIndex: currentIndex,
      acceptingAnswers: acceptingAnswers,
      gameSessionId: gameSessionId,
      isGameActive: isGameActive,
      currentQuestion:
        currentIndex >= 0 && currentIndex < questions.length
          ? questions[currentIndex]
          : null,
    });

    console.log(
      `✅ Game started. Session: ${gameSessionId}, total questions: ${questions.length}`
    );

    return res.json({
      success: true,
      message: "Game started successfully",
      questions: questions.length,
      sessionId: gameSessionId,
    });
  } catch (err) {
    console.error("Start game error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.post("/admin/reset-game", (req, res) => {
  currentIndex = -1;
  acceptingAnswers = false;
  firstAnswered = false;
  answeredUsers.clear();
  isGameActive = false;

  if (gameTimer) {
    clearTimeout(gameTimer);
    gameTimer = null;
  }

  res.json({
    success: true,
    message: "Game reset successfully",
  });
});

app.post("/admin/reload-questions", async (req, res) => {
  try {
    const count = await loadQuestions();
    res.json({
      success: true,
      message: "Questions reloaded successfully",
      questionsLoaded: count,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get("/test-db", async (req, res) => {
  try {
    const [dbTest] = await pool.query("SELECT 1 as db_status");
    const [questionCount] = await pool.query(
      "SELECT COUNT(*) as count FROM questions"
    );
    const [sampleQuestions] = await pool.query(
      "SELECT id, text, correct, difficulty FROM questions LIMIT 3"
    );

    res.json({
      database: "Connected ✅",
      totalQuestions: questionCount[0].count,
      sampleQuestions: sampleQuestions,
      gameState: {
        questionsInMemory: questions.length,
        currentIndex: currentIndex,
        gameSessionId: gameSessionId,
        isGameActive: isGameActive,
      },
    });
  } catch (err) {
    res.status(500).json({
      database: "Error ❌",
      error: err.message,
    });
  }
});

app.delete("/questions/reset-all", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    console.log("Starting question reset...");

    await connection.execute("DELETE FROM answers");
    await connection.execute("DELETE FROM scores");
    await connection.execute("DELETE FROM performance");
    await connection.execute("DELETE FROM questions");
    await connection.execute("ALTER TABLE questions AUTO_INCREMENT = 1");

    await connection.commit();

    await loadQuestions();

    console.log("Question reset completed successfully");
    res.json({
      message: "All questions and game data reset successfully",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error resetting questions:", err);
    res.status(500).json({ error: "Database error: " + err.message });
  } finally {
    connection.release();
  }
});

app.post("/admin/reset-duplicate-plays", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [duplicateUsers] = await connection.query(`
      SELECT user_id, COUNT(DISTINCT game_session_id) as session_count 
      FROM answers 
      GROUP BY user_id 
      HAVING session_count > 1
    `);

    for (const user of duplicateUsers) {
      const [firstSession] = await connection.query(
        `
        SELECT game_session_id 
        FROM answers 
        WHERE user_id = ? 
        ORDER BY answered_at ASC 
        LIMIT 1
      `,
        [user.user_id]
      );

      if (firstSession.length > 0) {
        const firstSessionId = firstSession[0].game_session_id;

        await connection.query(
          "DELETE FROM answers WHERE user_id = ? AND game_session_id != ?",
          [user.user_id, firstSessionId]
        );
      }
    }

    await connection.query(`
      UPDATE performance p
      JOIN (
        SELECT 
          user_id,
          SUM(points_earned) as total_score,
          COUNT(*) as total_attempts,
          SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as total_correct
        FROM answers 
        GROUP BY user_id
      ) a ON p.user_id = a.user_id
      SET 
        p.score = a.total_score,
        p.attempts = a.total_attempts,
        p.correct_answers = a.total_correct,
        p.accuracy = CASE 
          WHEN a.total_attempts > 0 THEN (a.total_correct * 100.0 / a.total_attempts)
          ELSE 0 
        END
    `);

    await connection.commit();

    res.json({
      success: true,
      message: `Reset duplicate plays for ${duplicateUsers.length} users`,
      affected_users: duplicateUsers.length,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Reset duplicate plays error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ----- Add single question -----
app.post("/questions", async (req, res) => {
  try {
    const { text, option_a, option_b, option_c, option_d, correct, difficulty } =
      req.body;

    if (!text || !option_a || !option_b || !option_c || !option_d || !correct) {
      return res.status(400).json({ error: "All fields are required" });
    }

    let normalizedCorrect = correct.toString().trim().toUpperCase();

    if (["A", "OPTION_A", "OPTION A", "1"].includes(normalizedCorrect))
      normalizedCorrect = "option_a";
    else if (["B", "OPTION_B", "OPTION B", "2"].includes(normalizedCorrect))
      normalizedCorrect = "option_b";
    else if (["C", "OPTION_C", "OPTION C", "3"].includes(normalizedCorrect))
      normalizedCorrect = "option_c";
    else if (["D", "OPTION_D", "OPTION D", "4"].includes(normalizedCorrect))
      normalizedCorrect = "option_d";

    if (
      !["option_a", "option_b", "option_c", "option_d"].includes(
        normalizedCorrect
      )
    ) {
      return res
        .status(400)
        .json({ error: "Correct answer must be A, B, C, or D" });
    }

    const [result] = await pool.query(
      `
      INSERT INTO questions (text, option_a, option_b, option_c, option_d, correct, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        text,
        option_a,
        option_b,
        option_c,
        option_d,
        normalizedCorrect,
        difficulty || "Medium",
      ]
    );

    await loadQuestions();
    res.json({
      success: true,
      message: "Question added successfully",
      question_id: result.insertId,
    });
  } catch (err) {
    console.error("POST /questions error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// UPDATE MCQ QUESTION
app.put("/questions/:id", async (req, res) => {
  const { id } = req.params;
  const {
    text,
    option_a,
    option_b,
    option_c,
    option_d,
    correct,
    difficulty,
  } = req.body;

  try {
    const [result] = await pool.query(
      `
      UPDATE questions
      SET text=?, option_a=?, option_b=?, option_c=?, option_d=?, correct=?, difficulty=?
      WHERE id=?
      `,
      [
        text,
        option_a,
        option_b,
        option_c,
        option_d,
        correct,
        difficulty,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /questions/:id error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE MCQ QUESTION
app.delete("/questions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      "DELETE FROM questions WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /questions/:id error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ----- CSV Upload -----
app.post("/questions/upload", upload.single("file"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Processing file:", req.file.path);
    const results = [];
    let inserted = 0;
    let errors = [];

    await connection.beginTransaction();

    const processCSV = () => {
      return new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                try {
                  const question = {
                    text: row.question || row.text || row.Question || row.Q,
                    option_a:
                      row.option_a ||
                      row.a ||
                      row.optionA ||
                      row.A ||
                      row["option A"],
                    option_b:
                      row.option_b ||
                      row.b ||
                      row.optionB ||
                      row.B ||
                      row["option B"],
                    option_c:
                      row.option_c ||
                      row.c ||
                      row.optionC ||
                      row.C ||
                      row["option C"],
                    option_d:
                      row.option_d ||
                      row.d ||
                      row.optionD ||
                      row.D ||
                      row["option D"],
                    correct:
                      row.correct ||
                      row.answer ||
                      row.correct_answer ||
                      row.key,
                    difficulty: row.difficulty || row.level || "Medium",
                  };

                  if (
                    !question.text ||
                    !question.option_a ||
                    !question.option_b ||
                    !question.option_c ||
                    !question.option_d ||
                    !question.correct
                  ) {
                    errors.push(`Row ${i + 1}: Missing required fields`);
                    continue;
                  }

                  let normalizedCorrect = question.correct
                    .toString()
                    .toUpperCase()
                    .trim();

                  if (
                    ["A", "OPTION_A", "OPTION A", "1"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_a";
                  else if (
                    ["B", "OPTION_B", "OPTION B", "2"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_b";
                  else if (
                    ["C", "OPTION_C", "OPTION C", "3"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_c";
                  else if (
                    ["D", "OPTION_D", "OPTION D", "4"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_d";
                  else {
                    errors.push(
                      `Row ${i + 1}: Invalid correct answer format: ${
                        question.correct
                      }`
                    );
                    continue;
                  }

                  await connection.query(
                    `
                    INSERT INTO questions (text, option_a, option_b, option_c, option_d, correct, difficulty)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                  `,
                    [
                      question.text.trim(),
                      question.option_a.trim(),
                      question.option_b.trim(),
                      question.option_c.trim(),
                      question.option_d.trim(),
                      normalizedCorrect,
                      question.difficulty.trim(),
                    ]
                  );
                  inserted++;
                } catch (rowError) {
                  errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
              }
              resolve();
            } catch (processError) {
              reject(processError);
            }
          })
          .on("error", (error) => {
            reject(error);
          });
      });
    };

    await processCSV();
    await connection.commit();

    try {
      fs.unlinkSync(req.file.path);
    } catch (unlinkError) {
      console.error("Error deleting file:", unlinkError);
    }

    await loadQuestions();
    res.json({
      success: true,
      message: `CSV processing completed`,
      inserted: inserted,
      total: results.length,
      errors: errors,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      error: "Upload failed: " + error.message,
    });
  } finally {
    connection.release();
  }
});

// ----- Leaderboard / Results -----
app.get("/leaderboard", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "20", 10);

    const sql = `
      SELECT 
        u.user_id, 
        u.email, 
        u.display_name, 
        u.role,
        COALESCE(p.score, 0) as score,
        COALESCE(p.attempts, 0) as attempts,
        COALESCE(p.correct_answers, 0) as correct_answers,
        CASE 
          WHEN p.attempts > 0 THEN ROUND((p.correct_answers * 100.0 / p.attempts), 2)
          ELSE 0 
        END as accuracy
      FROM users u
      LEFT JOIN performance p ON u.user_id = p.user_id
      WHERE u.email IS NOT NULL 
        AND u.role = 'student'
        AND u.email != ''
      ORDER BY p.score DESC, accuracy DESC, p.correct_answers DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [limit]);
    res.json(rows);
  } catch (err) {
    console.error("GET /leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/game-results/wisdom-warfare", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);

    const [results] = await pool.query(
      `
      SELECT 
        u.user_id,
        u.email,
        u.display_name,
        COALESCE(SUM(a.points_earned), 0) as total_score,
        COUNT(a.answer_id) as questions_answered,
        COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
        CASE 
          WHEN COUNT(a.answer_id) > 0 THEN 
            ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
          ELSE 0 
        END as accuracy,
        MAX(a.answered_at) as last_played
      FROM users u
      LEFT JOIN answers a ON u.user_id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.email, u.display_name
      HAVING questions_answered > 0
      ORDER BY total_score DESC, accuracy DESC, last_played DESC
      LIMIT ?
    `,
      [limit]
    );

    res.json({
      game_name: "Wisdom Warfare",
      results: results,
      total_players: results.length,
    });
  } catch (err) {
    console.error("Get game results error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/download-results/wisdom-warfare", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT 
        u.user_id,
        u.email,
        u.display_name,
        COALESCE(SUM(a.points_earned), 0) as total_score,
        COUNT(a.answer_id) as questions_answered,
        COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
        CASE 
          WHEN COUNT(a.answer_id) > 0 THEN 
            ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
          ELSE 0 
        END as accuracy,
        MAX(a.answered_at) as last_played
      FROM users u
      LEFT JOIN answers a ON u.user_id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.email, u.display_name
      HAVING questions_answered > 0
      ORDER BY total_score DESC, accuracy DESC, last_played DESC
    `);

  const csvHeader =
    "Rank,Student Name,Email,Total Score,Questions Answered,Correct Answers,Accuracy%,Last Played\n";
  const csvRows = results
    .map(
      (player, index) =>
        `${index + 1},"${player.display_name || "Anonymous"}","${
          player.email
        }",${player.total_score || 0},${player.questions_answered || 0},${
          player.correct_answers || 0
        },${player.accuracy || 0},"${player.last_played || "Never"}"`
    )
    .join("\n");

  const csvContent = csvHeader + csvRows;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=wisdom-warfare-results.csv"
  );
  res.send(csvContent);
} catch (err) {
  console.error("Download results error:", err);
  res.status(500).json({ error: err.message });
}
});

// ----- Auth -----
app.post("/auth/upsert-user", async (req, res) => {
  const { uid, email, display_name, role = "student" } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingUsers] = await connection.query(
      "SELECT user_id, uid, email, display_name, role FROM users WHERE LOWER(email) = LOWER(?)",
      [normalizedEmail]
    );

    let user;

    if (existingUsers.length > 0) {
      user = existingUsers[0];
      await connection.query(
        "UPDATE users SET uid = ?, display_name = ?, role = ? WHERE user_id = ?",
        [uid, display_name || user.display_name, role, user.user_id]
      );
    } else {
      const [result] = await connection.query(
        `
        INSERT INTO users (uid, email, display_name, role) VALUES (?, ?, ?, ?)
      `,
        [uid, normalizedEmail, display_name || normalizedEmail, role]
      );

      const [newUsers] = await connection.query(
        "SELECT user_id, uid, email, display_name, role FROM users WHERE user_id = ?",
        [result.insertId]
      );
      user = newUsers[0];
    }

    if (role === "student") {
      await connection.query(
        `
        INSERT IGNORE INTO performance (user_id, score, attempts, correct_answers, accuracy)
        VALUES (?, 0, 0, 0, 0)
      `,
        [user.user_id]
      );
    }

    await connection.commit();

    res.json({
      ok: true,
      user_id: user.user_id,
      user: user,
    });
  } catch (err) {
    await connection.rollback();
    console.error("auth/upsert-user error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ----- Record answer -----
app.post("/record-answer", async (req, res) => {
  const {
    user_id,
    question_id,
    selected_answer,
    is_correct,
    points,
    game_name = "Wisdom Warfare",
    game_session_id,
  } = req.body;

  if (!user_id || !question_id || !selected_answer || !game_session_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingAnswers] = await connection.query(
      "SELECT * FROM answers WHERE user_id = ? AND question_id = ? AND game_session_id = ?",
      [user_id, question_id, game_session_id]
    );

    if (existingAnswers.length > 0) {
      await connection.rollback();
      return res.json({
        ok: false,
        error: "You have already answered this question in this game session",
        points_earned: 0,
      });
    }

    const pointsEarned = is_correct ? points || 10 : 0;

    await connection.query(
      `
      INSERT INTO answers (user_id, question_id, selected_answer, is_correct, points_earned, game_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [user_id, question_id, selected_answer, is_correct, pointsEarned, game_session_id]
    );

    await connection.query(
      `
      INSERT INTO scores (user_id, game_name, score, attempts, correct_answers, accuracy, game_session_id)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        score = score + VALUES(score),
        attempts = attempts + 1,
        correct_answers = correct_answers + VALUES(correct_answers),
        accuracy = CASE 
          WHEN (attempts + 1) > 0 THEN ((correct_answers + VALUES(correct_answers)) * 100.0 / (attempts + 1))
          ELSE 0 
        END
    `,
      [
        user_id,
        game_name,
        pointsEarned,
        is_correct ? 1 : 0,
        is_correct ? 100 : 0,
        game_session_id,
      ]
    );

    if (is_correct) {
      await connection.query(
        `
        INSERT INTO performance (user_id, score, attempts, correct_answers, accuracy)
        VALUES (?, ?, 1, 1, 100)
        ON DUPLICATE KEY UPDATE
          score = score + VALUES(score),
          attempts = attempts + 1,
          correct_answers = correct_answers + 1,
          accuracy = CASE 
            WHEN (attempts + 1) > 0 THEN ((correct_answers + 1) * 100.0 / (attempts + 1))
            ELSE 0 
          END
      `,
        [user_id, pointsEarned]
      );
    } else {
      await connection.query(
        `
        INSERT INTO performance (user_id, score, attempts, correct_answers, accuracy)
        VALUES (?, 0, 1, 0, 0)
        ON DUPLICATE KEY UPDATE
          attempts = attempts + 1,
          accuracy = CASE 
            WHEN (attempts + 1) > 0 THEN (correct_answers * 100.0 / (attempts + 1))
            ELSE 0 
          END
      `,
        [user_id]
      );
    }

    await connection.commit();

    const [leaderboard] = await connection.query(
      `
      SELECT 
        u.user_id, u.email, u.display_name, 
        COALESCE(p.score, 0) as score, 
        CASE 
          WHEN p.attempts > 0 THEN ROUND((p.correct_answers * 100.0 / p.attempts), 2)
          ELSE 0 
        END as accuracy,
        p.correct_answers, p.attempts
      FROM users u
      JOIN performance p ON u.user_id = p.user_id
      WHERE u.role = 'student'
      ORDER BY p.score DESC, accuracy DESC
      LIMIT 10
    `
    );

    res.json({
      ok: true,
      points_earned: pointsEarned,
      leaderboard: leaderboard,
    });
  } catch (err) {
    await connection.rollback();
    console.error("record-answer error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ----- User stats -----
app.get("/user/:user_id/stats", async (req, res) => {
  try {
    const userId = req.params.user_id;

    const [performanceRows] = await pool.query(
      "SELECT * FROM performance WHERE user_id = ?",
      [userId]
    );

    const [userRows] = await pool.query(
      "SELECT user_id, email, display_name, role, created_at FROM users WHERE user_id = ?",
      [userId]
    );

    const [difficultyStats] = await pool.query(
      `
      SELECT 
        q.difficulty,
        COUNT(a.answer_id) as total_answered,
        SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) as correct,
        SUM(a.points_earned) as score
      FROM answers a
      JOIN questions q ON a.question_id = q.id
      WHERE a.user_id = ?
      GROUP BY q.difficulty
    `,
      [userId]
    );

    const totalPossibleScore = 450;
    const currentScore = performanceRows[0]?.score || 0;
    const percentage =
      totalPossibleScore > 0 ? (currentScore / totalPossibleScore) * 100 : 0;

    const byDifficulty = {};
    difficultyStats.forEach((stat) => {
      byDifficulty[stat.difficulty.toLowerCase()] = {
        total: stat.total_answered,
        correct: stat.correct,
        score: stat.score,
      };
    });

    const [gameSessions] = await pool.query(
      `
      SELECT 
        game_session_id,
        COUNT(*) as questions_answered,
        SUM(points_earned) as session_score,
        SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) as correct_answers,
        MAX(answered_at) as last_answered
      FROM answers 
      WHERE user_id = ?
      GROUP BY game_session_id
      ORDER BY last_answered DESC
      LIMIT 10
    `,
      [userId]
    );

    res.json({
      user: userRows[0] || null,
      performance:
        performanceRows[0] || {
          score: 0,
          attempts: 0,
          correct_answers: 0,
          accuracy: 0,
        },
      game_stats: {
        total_possible_score: totalPossibleScore,
        current_percentage: percentage.toFixed(1),
        questions_answered: performanceRows[0]?.attempts || 0,
        total_questions: 30,
        by_difficulty: byDifficulty,
      },
      game_sessions: gameSessions,
    });
  } catch (err) {
    console.error("Get user stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/teacher/games", async (req, res) => {
  const { teacher_id, game_name } = req.body;

  // ✅ FIX 1: Remove game_type validation
  if (!teacher_id || !game_name) {
    return res.status(400).json({
      error: "teacher_id and game_name are required"
    });
  }

  const connection = await pool.getConnection();
  try {
    const MAX_ATTEMPTS = 10;
    let code = null;

    // ✅ FIX 2: Generate unique 6-character game code
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateShortGameCode(6);
      const [rows] = await connection.query(
        "SELECT id FROM teacher_games WHERE game_code = ?",
        [candidate]
      );
      if (rows.length === 0) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new Error("Failed to generate a unique game code");
    }

    // ✅ FIX 3: Insert WITHOUT game_type
    const [result] = await connection.query(
      `
      INSERT INTO teacher_games (teacher_id, game_name, game_code)
      VALUES (?, ?, ?)
      `,
      [teacher_id, game_name, code]
    );

    // ✅ FIX 4: Return clean game object
    const [newRow] = await connection.query(
      `
      SELECT id, teacher_id, game_name, game_code, created_at
      FROM teacher_games
      WHERE id = ?
      `,
      [result.insertId]
    );

    res.json({
      ok: true,
      game: newRow[0]
    });
  } catch (err) {
    console.error("Error creating teacher game:", err);
    res.status(500).json({
      error: err.message || "Failed to create teacher game"
    });
  } finally {
    connection.release();
  }
});


app.get("/teacher/games", async (req, res) => {
  const teacherId = req.query.teacher_id || req.query.teacherId;

  if (!teacherId) {
    return res.status(400).json({ error: "teacher_id query param required" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM teacher_games WHERE teacher_id = ? ORDER BY created_at DESC",
      [teacherId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching teacher games:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/teacher/games/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, game: rows[0] });
  } catch (err) {
    console.error("Error fetching teacher game:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/teacher/games/:id/generate-code", async (req, res) => {
  const id = req.params.id;
  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Teacher game not found" });
    }

    const MAX_ATTEMPTS = 10;
    let code = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateShortGameCode(6);
      const [rows] = await connection.query(
        "SELECT id FROM teacher_games WHERE game_code = ? AND id != ?",
        [candidate, id]
      );
      if (rows.length === 0) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new Error(
        "Failed to generate a unique game code after multiple attempts"
      );
    }

    await connection.query(
      "UPDATE teacher_games SET game_code = ? WHERE id = ?",
      [code, id]
    );
    const [updated] = await connection.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );

    res.json({ ok: true, game: updated[0] });
  } catch (err) {
    console.error("Error regenerating code:", err);
    res.status(500).json({ error: err.message || "Failed to regenerate game code" });
  } finally {
    connection.release();
  }
});

// send-link with Nodemailer
app.post("/teacher/games/:id/send-link", async (req, res) => {
  const id = req.params.id;
  const { recipients = null, subject = null, message = null } = req.body || {};

  try {
    const [rows] = await pool.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    const game = rows[0];

    // 👉 this is where we build the link that students will use
    const clientBase =
      process.env.CLIENT_BASE_URL ||
      process.env.FRONTEND_BASE ||
      "http://localhost:3000";

    // Email should point to the Welcome page (root) instead of /play
    const playLink = `${clientBase.replace(/\/$/, "")}/`;

    // -----------------------------
    //  Resolve recipients
    // -----------------------------
    let toList = [];

    if (Array.isArray(recipients) && recipients.length > 0) {
      toList = recipients
        .map((r) => String(r).trim())
        .filter(Boolean);
    } else {
      const [students] = await pool.query(
        "SELECT email FROM users WHERE role = 'student' AND email IS NOT NULL AND TRIM(email) != ''"
      );
      toList = students.map((s) => s.email).filter(Boolean);
    }

    // If no one to mail, just return the link
    if (!toList || toList.length === 0) {
      console.log(
        `No recipients found for teacher_game id=${id}. Returning link only.`
      );
      return res.json({
        ok: true,
        link: playLink,
        game,
        sent: 0,
        message: "No recipients found; link returned.",
      });
    }

    // -----------------------------
    //  SMTP config
    // -----------------------------
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || "465", 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure =
      process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === true;

    // If SMTP is not configured, don't crash – just return the link
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn(
        "SMTP not configured properly. Please set SMTP_HOST/SMTP_USER/SMTP_PASS in .env"
      );
      return res.json({
        ok: false,
        link: playLink,
        game,
        sent: 0,
        message:
          "SMTP not configured on server. Email not sent, but link is provided.",
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailSubject =
      subject || `Join the game: ${game.game_name || "Wisdom Warfare"}`;

    const mailText =
      (message ||
        `Join the game using this link: ${playLink}\n\nOr open the app and enter game code: ${game.game_code}`) +
      `\n\n--\nSent by Wisdom Warfare`;

    const mailHtml =
      (message
        ? `<p>${message}</p>`
        : `<p>Join the game using this link: <a href="${playLink}">${playLink}</a></p>
           <p>Or open the app and enter game code: <strong>${game.game_code}</strong></p>`) +
      `<hr/><p style="font-size:12px;color:#666">Sent by Wisdom Warfare</p>`;

    const first = toList[0];
    const bcc = toList.slice(1);

    const mailOptions = {
      from: process.env.EMAIL_FROM || smtpUser,
      to: first,
      bcc: bcc.length ? bcc : undefined,
      subject: mailSubject,
      text: mailText,
      html: mailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(
      "Emails sent:",
      info?.messageId || info,
      "recipients:",
      toList.length
    );

    res.json({
      ok: true,
      link: playLink,
      game,
      sent: toList.length,
      message: `Link sent to ${toList.length} recipients`,
    });
  } catch (err) {
    console.error("Error in /teacher/games/:id/send-link (send):", err);
    res.status(500).json({
      error: err.message || "Failed to send link",
    });
  }
});

// ========== SINGLE GAME CODE VALIDATION ROUTE ==========
// ✅ FIXED: Game code validation route (works for both Quiz and Crossword)
app.get("/game/code/:code", async (req, res) => {
  const { code } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT id, teacher_id, game_name, game_code, created_at
      FROM teacher_games
      WHERE UPPER(game_code) = UPPER(?)
      `,
      [code]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Invalid game code"
      });
    }

    res.json({
      ok: true,
      game: rows[0]
    });
  } catch (err) {
    console.error("Game code validation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----- Upload students CSV -----
app.post("/students/upload", upload.single("file"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Processing students file:", req.file.path);

    const results = [];
    let created = 0;
    let updated = 0;
    const errors = [];

    await connection.beginTransaction();

    const processCSV = () => {
      return new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                try {
                  const rawEmail =
                    row.email ||
                    row.Email ||
                    row.EMAIL ||
                    row.mail ||
                    row["e-mail"];
                  const displayName =
                    row.display_name ||
                    row.name ||
                    row.Name ||
                    row.fullname ||
                    row["full name"] ||
                    null;
                  let role =
                    row.role ||
                    row.Role ||
                    row.ROLE ||
                    "student";

                  if (!rawEmail) {
                    errors.push(`Row ${i + 1}: Missing email`);
                    continue;
                  }

                  const email = String(rawEmail).trim().toLowerCase();
                  role = String(role).trim().toLowerCase() || "student";

                  if (!email.includes("@")) {
                    errors.push(
                      `Row ${i + 1}: Invalid email format: ${email}`
                    );
                    continue;
                  }

                  // Check if user already exists
                  const [existing] = await connection.query(
                    "SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)",
                    [email]
                  );

                  if (existing.length > 0) {
                    const userId = existing[0].user_id;
                    await connection.query(
                      `
                        UPDATE users
                        SET display_name = COALESCE(?, display_name),
                            role = ?
                        WHERE user_id = ?
                      `,
                      [displayName, role, userId]
                    );
                    updated++;
                  } else {
                    const [insertRes] = await connection.query(
                      `
                        INSERT INTO users (uid, email, display_name, role)
                        VALUES (?, ?, ?, ?)
                      `,
                      [null, email, displayName || email, role]
                    );
                    const newUserId = insertRes.insertId;

                    if (role === "student") {
                      await connection.query(
                        `
                          INSERT IGNORE INTO performance (user_id, score, attempts, correct_answers, accuracy)
                          VALUES (?, 0, 0, 0, 0)
                        `,
                        [newUserId]
                      );
                    }
                    created++;
                  }
                } catch (rowError) {
                  errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
              }
              resolve();
            } catch (processError) {
              reject(processError);
            }
          })
          .on("error", (err) => reject(err));
      });
    };

    await processCSV();
    await connection.commit();

    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      console.warn("Could not delete uploaded student file:", e.message);
    }

    res.json({
      success: true,
      message: "Student upload completed",
      created,
      updated,
      total: results.length,
      errors,
    });
  } catch (err) {
    await connection.rollback();
    console.error("students/upload error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to upload students: " + err.message,
    });
  } finally {
    connection.release();
  }
});

// ----- Simple /me endpoint -----
app.get("/me", async (req, res) => {
  try {
    // Try to find any teacher user
    const [teachers] = await pool.query(
      "SELECT user_id, email, display_name, role FROM users WHERE role = 'teacher' ORDER BY user_id ASC LIMIT 1"
    );

    let user;

    if (teachers.length > 0) {
      user = teachers[0];
    } else {
      // If no teacher exists, create a default one
      const defaultEmail = "teacher@example.com";
      const [insertRes] = await pool.query(
        `
          INSERT INTO users (uid, email, display_name, role)
          VALUES (?, ?, ?, 'teacher')
        `,
        [null, defaultEmail, "Default Teacher"]
      );
      const [rows] = await pool.query(
        "SELECT user_id, email, display_name, role FROM users WHERE user_id = ?",
        [insertRes.insertId]
      );
      user = rows[0];
    }

    res.json({ user });
  } catch (err) {
    console.error("/me error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----- Cleanup users endpoint -----
app.post("/admin/cleanup-users", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Example logic: keep the lowest user_id per email, mark others as duplicates.
    const [dups] = await connection.query(`
      SELECT email, COUNT(*) as cnt
      FROM users
      WHERE email IS NOT NULL AND TRIM(email) != ''
      GROUP BY email
      HAVING cnt > 1
    `);

    let affected = 0;

    for (const row of dups) {
      const email = row.email;
      const [users] = await connection.query(
        "SELECT user_id FROM users WHERE email = ? ORDER BY user_id ASC",
        [email]
      );
      if (users.length <= 1) continue;

      const keepId = users[0].user_id;
      const toRemove = users.slice(1).map((u) => u.user_id);

      if (toRemove.length === 0) continue;

      // Reassign performance / answers / scores to the kept user_id if needed.
      await connection.query(
        "UPDATE answers SET user_id = ? WHERE user_id IN (?)",
        [keepId, toRemove]
      );
      await connection.query(
        "UPDATE scores SET user_id = ? WHERE user_id IN (?)",
        [keepId, toRemove]
      );
      await connection.query(
        "UPDATE performance SET user_id = ? WHERE user_id IN (?)",
        [keepId, toRemove]
      );

      // Delete duplicate rows
      await connection.query("DELETE FROM users WHERE user_id IN (?)", [
        toRemove,
      ]);

      affected += toRemove.length;
    }

    await connection.commit();

    res.json({
      success: true,
      message: `Cleanup completed. Removed ${affected} duplicate user records.`,
      affected,
    });
  } catch (err) {
    await connection.rollback();
    console.error("/admin/cleanup-users error:", err);
    res.status(500).json({
      success: false,
      message: "Cleanup failed: " + err.message,
    });
  } finally {
    connection.release();
  }
});

// ==========================================
// ----- CROSSWORD GAME ENDPOINTS -----
// ==========================================

// GET: Fetch all crossword questions
app.get("/crossword/questions", async (req, res) => {
  try {
    const questions = await fetchCrosswordQuestions(100);
    res.json(questions);
  } catch (err) {
    console.error("Error fetching crossword questions:", err);
    res.status(500).json({ error: "Failed to fetch crossword questions" });
  }
});

// POST: Add a single crossword question
app.post("/crossword/questions", async (req, res) => {
  try {
    const { question, answer } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({ error: "Question and answer are required" });
    }

    const connection = await pool.getConnection();
    try {
      const [result] = await connection.query(
        "INSERT INTO crossword_questions (question, answer, difficulty) VALUES (?, ?, ?)",
        [question, answer, "Medium"]
      );

      res.json({
        id: result.insertId,
        question,
        answer,
        difficulty: "Medium"
      });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error adding crossword question:", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT: Update crossword question
app.put("/crossword/questions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: "Question and answer are required" });
    }

    const connection = await pool.getConnection();
    try {
      await connection.query(
        "UPDATE crossword_questions SET question = ?, answer = ? WHERE id = ?",
        [question, answer, id]
      );

      res.json({ success: true });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error updating crossword question:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove crossword question
app.delete("/crossword/questions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
      await connection.query("DELETE FROM crossword_questions WHERE id = ?", [id]);
      res.json({ success: true });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error deleting crossword question:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST: Upload crossword questions via CSV
app.post("/crossword/questions/upload", upload.single("file"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const results = [];
    let inserted = 0;

    await connection.beginTransaction();

    const processCSV = () => {
      return new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              for (const row of results) {
                const question = row.question || row.Question || row.q;
                const answer = row.answer || row.Answer || row.a;
                const difficulty = row.difficulty || row.Difficulty || "Medium";

                if (question && answer) {
                  await connection.query(
                    "INSERT INTO crossword_questions (question, answer, difficulty) VALUES (?, ?, ?)",
                    [question.trim(), answer.trim().toUpperCase(), difficulty.trim()]
                  );
                  inserted++;
                }
              }
              await connection.commit();
              resolve();
            } catch (err) {
              await connection.rollback();
              reject(err);
            }
          })
          .on("error", (error) => reject(error));
      });
    };

    await processCSV();
    
    // Clean up uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.warn("Failed to delete uploaded file:", err);
    });

    res.json({ success: true, inserted });
  } catch (err) {
    console.error("Error uploading crossword questions:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// POST: Start crossword game
app.post("/crossword/start-game", async (req, res) => {
  try {
    console.log("🎮 Starting crossword game...");

    const { game_code, questions: providedQuestions } = req.body;

    if (!Array.isArray(providedQuestions) || providedQuestions.length === 0) {
      console.log("❌ No questions provided");
      return res.status(400).json({
        success: false,
        error: "No crossword questions provided",
      });
    }

    // Generate crossword grid
    console.log(`📝 Generating crossword grid with ${providedQuestions.length} questions...`);
    const gridResult = generateCrosswordGrid(providedQuestions, 15);

    if (!gridResult.success) {
      return res.status(500).json({
        success: false,
        error: gridResult.error || "Failed to generate crossword grid",
      });
    }

    // Store crossword game state
    crosswordGameActive = true;
    crosswordGameSessionId = `crossword_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    crosswordGrid = gridResult.gameGrid;
    crosswordPlacedWords = gridResult.placedWords;
    currentCrosswordQuestions = providedQuestions;
    crosswordAnswers.clear();

    console.log(`✅ Crossword game started. Session: ${crosswordGameSessionId}`);
    console.log(`📊 Placed words: ${gridResult.placedWords.length}`);

    // Emit crossword grid to all connected clients
    io.emit("crosswordGameStarted", {
      sessionId: crosswordGameSessionId,
      grid: crosswordGrid,
      words: crosswordPlacedWords,
      totalWords: crosswordPlacedWords.length,
      gridSize: gridResult.gridSize,
    });

    res.json({
      success: true,
      message: "Crossword game started successfully",
      sessionId: crosswordGameSessionId,
      grid: crosswordGrid,
      words: crosswordPlacedWords,
      totalWords: crosswordPlacedWords.length,
      gridSize: gridResult.gridSize,
    });
  } catch (err) {
    console.error("Error starting crossword game:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// GET: Crossword game status
app.get("/crossword/game-status", (req, res) => {
  res.json({
    active: crosswordGameActive,
    sessionId: crosswordGameSessionId,
    gridSize: crosswordGrid ? crosswordGrid.length : 0,
    totalWords: crosswordPlacedWords ? crosswordPlacedWords.length : 0,
  });
});

// ==========================================
// ----- SOCKET.IO -----
// ==========================================

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.emit("gameStatus", {
    questionsLoaded: questions.length,
    currentIndex: currentIndex,
    acceptingAnswers: acceptingAnswers,
    gameSessionId: gameSessionId,
    isGameActive: isGameActive,
    currentQuestion:
      currentIndex >= 0 && currentIndex < questions.length
        ? questions[currentIndex]
        : null,
  });

  if (
    isGameActive &&
    currentIndex >= 0 &&
    currentIndex < questions.length &&
    questions[currentIndex] &&
    acceptingAnswers
  ) {
    const q = questions[currentIndex];
    const correctAnswerText = getCorrectAnswerText(q);

    console.log(
      "📤 Sending current question to new connection - CORRECT ANSWER:",
      correctAnswerText
    );

    socket.emit("newQuestion", {
      id: q.id,
      text: q.text,
      options: {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      },
      correct: q.correct,
      correctAnswer: correctAnswerText,
      difficulty: q.difficulty || "Medium",
      time: 30,
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
      gameSessionId: gameSessionId,
    });
  }

  socket.on("getGameStatus", () => {
    socket.emit("gameStatus", {
      questionsLoaded: questions.length,
      currentIndex: currentIndex,
      acceptingAnswers: acceptingAnswers,
      gameSessionId: gameSessionId,
      isGameActive: isGameActive,
      currentQuestion:
        currentIndex >= 0 && currentIndex < questions.length
          ? questions[currentIndex]
          : null,
    });
  });

  // Updated submitAnswer with game type check
  socket.on("submitAnswer", async ({ user_id, answer, email, display_name, game_name = "Wisdom Warfare" }) => {
    try {
      console.log("✅ User hasn't played, allowing answer");
      if (
        !acceptingAnswers ||
        currentIndex >= questions.length ||
        !questions[currentIndex]
      ) {
        socket.emit("answerResult", {
          error: "No active question",
          showNextButton: true,
        });
        return;
      }

      const questionKey = `${user_id}-${questions[currentIndex].id}-${gameSessionId}`;
      if (answeredUsers.has(questionKey)) {
        socket.emit("answerResult", {
          error: "You have already answered this question!",
          showNextButton: true,
        });
        return;
      }

      answeredUsers.set(questionKey, true);

      const currentQuestion = questions[currentIndex];
      const userAnswer = answer.toUpperCase().trim();
      const correctAnswerKey = currentQuestion.correct
        .toString()
        .toUpperCase()
        .trim();

      let isCorrect = false;

      if (
        (correctAnswerKey === "OPTION_A" || correctAnswerKey === "A") &&
        userAnswer === "A"
      )
        isCorrect = true;
      else if (
        (correctAnswerKey === "OPTION_B" || correctAnswerKey === "B") &&
        userAnswer === "B"
      )
        isCorrect = true;
      else if (
        (correctAnswerKey === "OPTION_C" || correctAnswerKey === "C") &&
        userAnswer === "C"
      )
        isCorrect = true;
      else if (
        (correctAnswerKey === "OPTION_D" || correctAnswerKey === "D") &&
        userAnswer === "D"
      )
        isCorrect = true;

      console.log("🎯 Answer submitted:", {
        user_id,
        userAnswer,
        correctAnswer: correctAnswerKey,
        isCorrect,
        questionId: currentQuestion.id,
        gameSessionId: gameSessionId,
      });

      let points = 10;
      const answerTime = Date.now() - currentQuestionStartTime;
      if (isCorrect && answerTime < 5000 && !firstAnswered) {
        points += 5;
        firstAnswered = true;
      }

      try {
        const response = await fetch(`${getServerBase()}/record-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: parseInt(user_id),
            question_id: currentQuestion.id,
            selected_answer: answer,
            is_correct: isCorrect,
            points: points,
            game_name: "Wisdom Warfare",
            game_session_id: gameSessionId,
          }),
        });

        const result = await response.json();

        if (result.ok) {
          const correctAnswerText = getCorrectAnswerText(currentQuestion);

          console.log(
            "✅ Sending answer result - CORRECT ANSWER TEXT:",
            correctAnswerText
          );

          if (isCorrect) {
            socket.emit("answerResult", {
              message: `✅ Correct! +${points} points`,
              correct: true,
              points: points,
              correctAnswer: correctAnswerText,
              showNextButton: true,
            });
          } else {
            socket.emit("answerResult", {
              message: `❌ Wrong answer! Correct was: ${correctAnswerText}`,
              correct: false,
              points: 0,
              correctAnswer: correctAnswerText,
              showNextButton: true,
            });
          }

          if (result.leaderboard) {
            io.emit("leaderboardUpdate", result.leaderboard);
          }
        } else {
          socket.emit("answerResult", {
            error: result.error,
            showNextButton: true,
          });
        }
      } catch (dbError) {
        console.error("Database record error:", dbError);
        socket.emit("answerResult", {
          error: "Error recording answer",
          showNextButton: true,
        });
      }
    } catch (err) {
      console.error("submitAnswer error:", err);
      socket.emit("answerResult", {
        error: "Server error processing answer",
        showNextButton: true,
      });
    }
  });

  socket.on("nextQuestion", () => {
    console.log("Next question requested by:", socket.id);
    if (acceptingAnswers || (currentIndex >= 0 && currentIndex < questions.length)) {
      if (gameTimer) {
        clearTimeout(gameTimer);
        gameTimer = null;
      }
      endCurrentQuestion();
    }
  });

  socket.on("adminStartGame", () => {
    console.log("Admin starting game via socket");
    if (questions.length > 0) {
      startNewGameSession();
    } else {
      socket.emit("gameError", { error: "No questions available" });
    }
  });

  // ==========================================
  // ----- CROSSWORD SOCKET EVENTS -----
  // ==========================================

  socket.on("getCrosswordGame", () => {
    if (crosswordGameActive && crosswordGrid && crosswordPlacedWords) {
      console.log(`📤 Sending crossword game to client: ${socket.id}`);
      socket.emit("crosswordGameStarted", {
        sessionId: crosswordGameSessionId,
        grid: crosswordGrid,
        words: crosswordPlacedWords,
        totalWords: crosswordPlacedWords.length,
        gridSize: crosswordGrid.length,
      });
    } else {
      socket.emit("noCrosswordGame", { message: "No active crossword game" });
    }
  });

  socket.on("submitCrosswordAnswer", async ({ user_id, email, display_name, answers }) => {
    try {
      console.log(`✅ Crossword answers submitted by ${email}`);

      if (!crosswordGameActive) {
        socket.emit("crosswordError", { error: "No active crossword game" });
        return;
      }

      // Store user's answers
      const userAnswers = crosswordAnswers.get(user_id) || { answers: {}, score: 0 };
      userAnswers.answers = answers;

      // Calculate score based on correct answers
      let correctCount = 0;
      for (const word of crosswordPlacedWords) {
        const wordAnswer = (answers[word.number] || "").toUpperCase().trim();
        const correctAnswer = word.word.toUpperCase().trim();
        
        if (wordAnswer === correctAnswer) {
          correctCount++;
        }
      }

      userAnswers.score = correctCount;
      crosswordAnswers.set(user_id, userAnswers);

      const accuracy = crosswordPlacedWords.length > 0 
        ? ((correctCount / crosswordPlacedWords.length) * 100).toFixed(1)
        : 0;

      console.log(`📊 ${email}: ${correctCount}/${crosswordPlacedWords.length} correct (${accuracy}%)`);

      // Send result to user
      socket.emit("crosswordResult", {
        success: true,
        correctAnswers: correctCount,
        totalAnswers: crosswordPlacedWords.length,
        accuracy: accuracy,
        score: userAnswers.score,
      });

      // Broadcast updated leaderboard
      const leaderboard = Array.from(crosswordAnswers.entries())
        .map(([uid, data]) => ({
          user_id: uid,
          score: data.score,
          total: crosswordPlacedWords.length,
          accuracy: crosswordPlacedWords.length > 0 
            ? ((data.score / crosswordPlacedWords.length) * 100).toFixed(1)
            : 0,
        }))
        .sort((a, b) => b.score - a.score);

      io.emit("crosswordLeaderboard", leaderboard);

      // Optionally record in database
      if (email && display_name) {
        const connection = await pool.getConnection();
        try {
          // Record crossword game result
          const [userRes] = await connection.query(
            "SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)",
            [email]
          );

          if (userRes.length > 0) {
            const userId = userRes[0].user_id;
            await connection.query(
              `INSERT INTO crossword_results (user_id, session_id, correct_answers, total_answers, accuracy)
               VALUES (?, ?, ?, ?, ?)`,
              [userId, crosswordGameSessionId, correctCount, crosswordPlacedWords.length, accuracy]
            );
          }
        } catch (dbErr) {
          console.warn("Could not record crossword result to DB:", dbErr.message);
        } finally {
          connection.release();
        }
      }

    } catch (err) {
      console.error("Crossword answer submission error:", err);
      socket.emit("crosswordError", { error: "Error processing crossword answers" });
    }
  });

  socket.on("endCrosswordGame", () => {
    console.log(`🏁 Crossword game ended`);
    
    crosswordGameActive = false;
    crosswordGrid = null;
    crosswordPlacedWords = null;
    currentCrosswordQuestions = [];
    
    io.emit("crosswordGameEnded", {
      finalLeaderboard: Array.from(crosswordAnswers.entries())
        .map(([uid, data]) => ({
          user_id: uid,
          score: data.score,
          total: crosswordPlacedWords ? crosswordPlacedWords.length : 0,
        }))
        .sort((a, b) => b.score - a.score),
    });
    
    crosswordAnswers.clear();
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// ==========================================
// ----- GAME LOOP HELPERS -----
// ==========================================

function endCurrentQuestion() {
  acceptingAnswers = false;

  if (currentIndex >= 0 && currentIndex < questions.length) {
    const q = questions[currentIndex];
    const correctAnswerText = getCorrectAnswerText(q);

    console.log(
      `📢 Ending question ${currentIndex + 1} - CORRECT ANSWER: ${correctAnswerText}`
    );

    io.emit("questionClosed", {
      correct: q.correct,
      correctAnswer: correctAnswerText,
      explanation: `Question completed! Correct answer was: ${correctAnswerText}`,
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
      showNextButton: false,
    });
  }

  setTimeout(() => {
    console.log(`Moving to next question...`);
    nextQuestion().catch((e) => console.error("Next question error:", e));
  }, 1000);
}

async function nextQuestion() {
  currentIndex++;

  answeredUsers.clear();
  firstAnswered = false;
  currentQuestionStartTime = Date.now();

  if (currentIndex >= questions.length) {
    console.log("🎉 Game completed - all questions answered");
    isGameActive = false;

    try {
      const [finalResults] = await pool.query(
        `
        SELECT 
          u.user_id, u.email, u.display_name,
          COALESCE(SUM(a.points_earned), 0) as session_score,
          COUNT(a.answer_id) as questions_answered,
          COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
          CASE 
            WHEN COUNT(a.answer_id) > 0 THEN 
              ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
            ELSE 0 
          END as accuracy
        FROM users u
        LEFT JOIN answers a ON u.user_id = a.user_id AND a.game_session_id = ?
        WHERE u.role = 'student'
        GROUP BY u.user_id, u.email, u.display_name
        HAVING questions_answered > 0
        ORDER BY session_score DESC, accuracy DESC
        LIMIT 20
      `,
        [gameSessionId]
      );

      io.emit("gameCompleted", {
        message: "🎉 Game Completed! All questions answered.",
        totalQuestions: questions.length,
        gameSessionId: gameSessionId,
        finalResults: { results: finalResults },
      });
    } catch (error) {
      console.error("Error getting final results:", error);
      io.emit("gameCompleted", {
        message: "🎉 Game Completed! All questions answered.",
        totalQuestions: questions.length,
        gameSessionId: gameSessionId,
        finalResults: { results: [] },
      });
    }

    return;
  }

  const q = questions[currentIndex];
  acceptingAnswers = true;
  isGameActive = true;

  const correctAnswerText = getCorrectAnswerText(q);

  console.log(
    `📝 Question ${currentIndex + 1}/${questions.length} [${q.difficulty}]: ${q.text.substring(
      0,
      50
    )}...`
  );
  console.log(`✅ Correct answer: ${q.correct} -> ${correctAnswerText}`);

  io.emit("newQuestion", {
    id: q.id,
    text: q.text,
    options: {
      A: q.option_a,
      B: q.option_b,
      C: q.option_c,
      D: q.option_d,
    },
    correct: q.correct,
    correctAnswer: correctAnswerText,
    difficulty: q.difficulty || "Medium",
    time: 30,
    questionNumber: currentIndex + 1,
    totalQuestions: questions.length,
    gameSessionId: gameSessionId,
    showNextButton: false,
  });

  if (gameTimer) clearTimeout(gameTimer);
  gameTimer = setTimeout(() => {
    if (acceptingAnswers) {
      console.log(`⏰ Time's up for question ${currentIndex + 1}`);
      endCurrentQuestion();
    }
  }, 30000);
}

function startNewGameSession() {
  gameSessionId = generateGameSessionId();
  currentIndex = -1;
  answeredUsers.clear();
  isGameActive = true;

  console.log(`🎮 Starting new game session: ${gameSessionId}`);
  io.emit("gameStarted", {
    sessionId: gameSessionId,
    totalQuestions: questions.length,
  });

  setTimeout(() => {
    nextQuestion().catch((e) => console.error("Game start error:", e));
  }, 3000);
}

// ==========================================
// ----- START SERVER -----
// ==========================================

function startServer(port) {
  server
    .listen(port, async () => {
      SERVER_PORT = server.address().port; // update actual port used

      console.log(`🚀 Server running on port ${SERVER_PORT}`);
      console.log(`📊 Admin panel: http://localhost:${SERVER_PORT}/admin`);
      console.log(`🔍 Health check: http://localhost:${SERVER_PORT}/`);

      setTimeout(async () => {
        const count = await loadQuestions();

        if (count === 0) {
          console.log(
            "❌ No questions found. Please use the admin panel to upload questions."
          );
        } else {
          console.log(`✅ ${count} questions loaded successfully`);
          console.log("⏳ Game is ready! Use the admin panel to start the game.");
        }
      }, 2000);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`❌ Port ${port} is busy, trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error("Server error:", err);
      }
    });
}

startServer(DEFAULT_PORT);