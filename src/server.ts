import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getSession, deleteSession } from "./mirai-chat";

// shell環境変数（例: PORT=3011）を優先し、.envは未設定値のみ補完する
dotenv.config();

// アバターID定数
// 本番Miraiアバター「mirai.go.ai」（LiveAvatar承認済、2026-04-19 ACTIVE確認）
const PRODUCTION_AVATAR_ID = "5909689f-7a01-4027-8d33-1f5153d79b71";
// サンドボックスアバター（Wayne、テスト常時利用可）
const SANDBOX_AVATAR_ID_CONST = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

const DEFAULT_AVATAR_ID = process.env.DEFAULT_AVATAR_ID || PRODUCTION_AVATAR_ID;
const SANDBOX_AVATAR_ID = process.env.SANDBOX_AVATAR_ID || SANDBOX_AVATAR_ID_CONST;
const USE_SANDBOX_FALLBACK = ["1", "true", "yes", "on"].includes(
  String(process.env.USE_SANDBOX_FALLBACK || "true").toLowerCase()
);
const TRIAL_DURATION_SEC = Number.parseInt(process.env.TRIAL_DURATION_SEC || "0", 10) || 0;

// 構造化ログユーティリティ
function log(level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...data }));
}

// APIキーの存在確認
if (!process.env.ANTHROPIC_API_KEY) {
  log("error", "startup_error", { reason: "ANTHROPIC_API_KEY が設定されていません" });
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
// UTAGE会員サイトからのiframe埋め込みを許可
app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.removeHeader("X-Frame-Options");
  next();
});
app.use(express.static("public"));

function parseSandboxQuery(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1";
}

/**
 * ヘルスチェック（Claude API・LiveAvatar API の疎通確認を含む）
 */
app.get("/health", async (_req, res) => {
  const timestamp = new Date().toISOString();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const liveAvatarKey = process.env.LIVEAVATAR_API_KEY;

  // Claude API 疎通確認（軽量: APIキー存在 + エンドポイント到達確認）
  let claudeStatus = "unconfigured";
  if (anthropicKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      claudeStatus = r.ok ? "ok" : "error";
    } catch {
      claudeStatus = "unreachable";
    }
  }

  // LiveAvatar API 疎通確認（軽量: APIキー存在 + エンドポイント到達確認）
  let liveAvatarStatus = "unconfigured";
  if (liveAvatarKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch("https://api.liveavatar.com/v1/avatars", {
        headers: { "X-API-KEY": liveAvatarKey },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      liveAvatarStatus = r.ok ? "ok" : "error";
    } catch {
      liveAvatarStatus = "unreachable";
    }
  }

  const overall = claudeStatus === "ok" ? "ok" : "degraded";
  log("info", "health_check", { overall, claudeStatus, liveAvatarStatus });

  res.status(overall === "ok" ? 200 : 503).json({
    status: overall,
    service: "Mirai AI Consultant",
    timestamp,
    checks: {
      claude_api: { status: claudeStatus },
      liveavatar_api: { status: liveAvatarStatus },
    },
  });
});

/**
 * フロント向け設定値
 */
app.get("/api/config", (_req, res) => {
  res.json({
    defaultAvatarId: DEFAULT_AVATAR_ID,
    sandboxAvatarId: SANDBOX_AVATAR_ID,
    useSandboxFallback: USE_SANDBOX_FALLBACK,
    trialDurationSec: TRIAL_DURATION_SEC,
  });
});

/**
 * LiveAvatar疎通確認
 * GET /api/liveavatar/check?avatar_id=...&sandbox=true|1
 */
app.get("/api/liveavatar/check", async (req, res) => {
  const apiKey = process.env.LIVEAVATAR_API_KEY;
  const sandbox = parseSandboxQuery(req.query.sandbox);
  const avatarIdFromQuery = typeof req.query.avatar_id === "string" ? req.query.avatar_id : "";
  const avatarId = avatarIdFromQuery || DEFAULT_AVATAR_ID;

  if (!apiKey) {
    res.json({
      ok: false,
      status: 500,
      reason: "unconfigured",
      code: null,
      detail: "LIVEAVATAR_API_KEY が設定されていません",
    });
    return;
  }

  try {
    const endpoint = new URL("https://api.liveavatar.com/v1/avatars");
    endpoint.searchParams.set("avatar_id", avatarId);
    if (sandbox) {
      endpoint.searchParams.set("is_sandbox", "true");
    }

    const response = await fetch(endpoint.toString(), {
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
      },
    });

    const payload = await response.json().catch(() => null) as any;
    const detail = payload?.message || payload?.detail || payload;

    res.json({
      ok: response.ok,
      status: response.status,
      reason: response.ok ? "ok" : "http_error",
      code: payload?.code ?? null,
      detail,
    });
  } catch (error: any) {
    res.json({
      ok: false,
      status: 503,
      reason: "network_error",
      code: null,
      detail: error?.message || "LiveAvatar APIへの接続に失敗しました",
    });
  }
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

  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({
      error: "message is required",
      userMessage: "メッセージを入力してください",
    });
    return;
  }

  try {
    const session = getSession(sessionId);
    const reply = await session.chat(message);
    res.json({ reply, sessionId });
  } catch (error: any) {
    log("error", "chat_error", { sessionId, message: error.message });
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
    log("error", "heygen_token_error", { message: error.message });
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

  const { avatar_id, sandbox = false } = req.body || {};
  // デフォルト: 環境変数 or 本番Miraiアバター
  const avatarId = avatar_id || DEFAULT_AVATAR_ID;

  try {
    log("info", "liveavatar_token_start", { avatarId, sandbox });
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

    log("info", "liveavatar_token_success", { sessionId: tokenData.data.session_id });
    res.json({ session_token: tokenData.data.session_token });
  } catch (error: any) {
    log("error", "liveavatar_token_error", { message: error.message });
    res.status(500).json({
      error: "LiveAvatarトークン生成に失敗しました",
      detail: error.message,
    });
  }
});

app.listen(PORT, () => {
  log("info", "server_started", { port: PORT, model: "claude-sonnet-4-20250514" });
});
