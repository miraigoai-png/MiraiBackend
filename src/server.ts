import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getSession, deleteSession } from "./mirai-chat";

dotenv.config({ override: true });

// APIキーの存在確認
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("エラー: ANTHROPIC_API_KEY が設定されていません。");
  console.error(".env ファイルに ANTHROPIC_API_KEY=sk-ant-... を設定してください。");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/**
 * ヘルスチェック
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "Mirai AI Consultant" });
});

/**
 * チャットエンドポイント
 * HeyGen Interactive Avatar から呼び出される
 *
 * POST /api/chat
 * Body: { sessionId: string, message: string }
 * Response: { reply: string }
 */
app.post("/api/chat", async (req, res) => {
  const { sessionId = "default", message } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message は必須です" });
    return;
  }

  try {
    const session = getSession(sessionId);
    const reply = await session.chat(message);
    res.json({ reply, sessionId });
  } catch (error: any) {
    console.error("Chat error:", error.message);
    res.status(500).json({
      error: "応答の生成に失敗しました",
      detail: error.message,
    });
  }
});

/**
 * セッションリセット
 * POST /api/reset
 * Body: { sessionId: string }
 */
app.post("/api/reset", (req, res) => {
  const { sessionId = "default" } = req.body;
  const session = getSession(sessionId);
  session.reset();
  res.json({ message: "会話履歴をリセットしました", sessionId });
});

/**
 * セッション削除
 * DELETE /api/session/:sessionId
 */
app.delete("/api/session/:sessionId", (req, res) => {
  const deleted = deleteSession(req.params.sessionId);
  res.json({ deleted, sessionId: req.params.sessionId });
});

/**
 * 会話履歴取得
 * GET /api/history/:sessionId
 */
app.get("/api/history/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  res.json({ history: session.getHistory(), sessionId: req.params.sessionId });
});

app.listen(PORT, () => {
  console.log(`🤖 Mirai AI Consultant Backend`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Chat:   POST http://localhost:${PORT}/api/chat`);
  console.log(`   Model:  Claude Sonnet 4`);
});
