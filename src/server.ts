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
app.use(express.static("public"));

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

/**
 * HeyGen アクセストークン生成（旧Streaming Avatar用、レガシー）
 * POST /api/heygen-token
 */
app.post("/api/heygen-token", async (_req, res) => {
  const heygenApiKey = process.env.HEYGEN_API_KEY;
  if (!heygenApiKey) {
    res.status(500).json({ error: "HEYGEN_API_KEY が設定されていません" });
    return;
  }

  try {
    const response = await fetch(
      "https://api.heygen.com/v1/streaming.create_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": heygenApiKey,
        },
      }
    );
    const data = await response.json() as { data?: { token?: string } };
    res.json({ token: data.data?.token });
  } catch (error: any) {
    console.error("HeyGen token error:", error.message);
    res.status(500).json({ error: "トークン生成に失敗しました" });
  }
});

/**
 * LiveAvatar セッショントークン生成
 * SDKがセッション開始・LiveKit接続を自動管理するため、トークン生成のみ行う
 *
 * POST /api/liveavatar/token
 * Body: { avatar_id?: string, sandbox?: boolean }
 * Response: { session_token }
 */
app.post("/api/liveavatar/token", async (req, res) => {
  const apiKey = process.env.LIVEAVATAR_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "LIVEAVATAR_API_KEY が設定されていません" });
    return;
  }

  const { avatar_id, sandbox = true } = req.body || {};
  // デフォルト: Wayne (サンドボックステスト用アバター)
  const avatarId = avatar_id || "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

  try {
    console.log(`LiveAvatar: トークン生成開始 (avatar: ${avatarId}, sandbox: ${sandbox})`);
    const tokenRes = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: avatarId,
        is_sandbox: sandbox,
        interactivity_type: "CONVERSATIONAL",
        avatar_persona: {
          language: "ja",
          voice_id: "f206785d-e75f-4e8e-8afa-0d223d894d1f", // ElevenLabs YUI（日本語音声）
        },
      }),
    });

    const tokenData = await tokenRes.json() as {
      code: number;
      data: { session_token: string; session_id: string };
    };

    if (tokenData.code !== 100 && tokenData.code !== 1000) {
      throw new Error(`Token creation failed: ${JSON.stringify(tokenData)}`);
    }

    console.log(`LiveAvatar: トークン生成成功 (session: ${tokenData.data.session_id})`);
    res.json({ session_token: tokenData.data.session_token });
  } catch (error: any) {
    console.error("LiveAvatar token error:", error.message);
    res.status(500).json({
      error: "LiveAvatarトークン生成に失敗しました",
      detail: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Mirai AI Consultant Backend`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Chat:   POST http://localhost:${PORT}/api/chat`);
  console.log(`   LiveAvatar: POST http://localhost:${PORT}/api/liveavatar/token`);
  console.log(`   Model:  Claude Sonnet 4`);
});
