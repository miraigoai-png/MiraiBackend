import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getSession, deleteSession } from "./mirai-chat";
import { classifyChatError } from "./classify-chat-error";

// shell環境変数（例: PORT=3011）を優先し、.envは未設定値のみ補完する
dotenv.config();

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

// アバターID定数
// 本番Miraiアバター「mirai.go.ai」（LiveAvatar承認済、2026-04-19 ACTIVE確認）
// 旧ID 1fdb012b-def9-435c-a297-fb8717556d02 は HeyGen承認時代の幽霊ID、LiveAvatar未同期で廃止
const PRODUCTION_AVATAR_ID = "5909689f-7a01-4027-8d33-1f5153d79b71";
// サンドボックスアバター（Wayne、テスト常時利用可）
const SANDBOX_AVATAR_ID_FALLBACK = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

const DEFAULT_AVATAR_ID = process.env.DEFAULT_AVATAR_ID || PRODUCTION_AVATAR_ID;
const SANDBOX_AVATAR_ID = process.env.SANDBOX_AVATAR_ID || SANDBOX_AVATAR_ID_FALLBACK;
const USE_SANDBOX_FALLBACK = ["1", "true", "yes", "on"].includes(
  String(process.env.USE_SANDBOX_FALLBACK || "true").toLowerCase()
);
const TRIAL_DURATION_SEC = Number.parseInt(process.env.TRIAL_DURATION_SEC || "300", 10) || 300;

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
 * フロントエンド設定取得
 * ハードコードを避け、アバターIDやフォールバック設定を配信する
 * GET /api/config
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
      error: "invalid_input",
      userMessage: "メッセージが空です。質問内容を入力してください。",
    });
    return;
  }

  try {
    const session = getSession(sessionId);
    const reply = await session.chat(message);
    res.json({ reply, sessionId });
  } catch (error: unknown) {
    const classified = classifyChatError(error);
    const anyErr = error as { status?: number; message?: string } | undefined;
    log("error", "chat_error", {
      sessionId,
      errorCode: classified.code,
      upstreamStatus: anyErr?.status,
      detail: anyErr?.message,
    });
    res.status(classified.httpStatus).json({
      error: classified.code,
      userMessage: classified.userMessage,
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
      message?: string;
      data?: { session_token: string; session_id: string };
    };

    if (tokenData.code !== 100 && tokenData.code !== 1000) {
      const message = tokenData.message || "";
      const isAvatarNotFound = /avatar not found/i.test(message);
      log("warn", "liveavatar_token_rejected", {
        code: tokenData.code,
        avatarId,
        sandbox,
        message,
      });
      res.status(502).json({
        error: "LiveAvatarトークン生成に失敗しました",
        reason: isAvatarNotFound ? "avatar_not_found" : "token_rejected",
        code: tokenData.code,
        detail: message || "LiveAvatar APIがトークンを発行しませんでした",
      });
      return;
    }

    log("info", "liveavatar_token_success", { sessionId: tokenData.data?.session_id, avatarId, sandbox });
    res.json({ session_token: tokenData.data?.session_token });
  } catch (error: any) {
    log("error", "liveavatar_token_error", { message: error.message });
    res.status(500).json({
      error: "LiveAvatarトークン生成に失敗しました",
      reason: "internal_error",
      detail: error.message,
    });
  }
});

/**
 * LiveAvatar 本番アバター状態チェック
 *
 * GET /api/liveavatar/check?avatar_id=<uuid>&sandbox=false
 * - avatar_id未指定時は defaultAvatarId を使用
 * - sandbox未指定時は false
 */
app.get("/api/liveavatar/check", async (req, res) => {
  const apiKey = process.env.LIVEAVATAR_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      ok: false,
      error: "LIVEAVATAR_API_KEY が設定されていません",
      reason: "internal_error",
    });
    return;
  }

  const avatarIdQuery = req.query.avatar_id;
  const avatarId = (Array.isArray(avatarIdQuery) ? avatarIdQuery[0] : avatarIdQuery) || DEFAULT_AVATAR_ID;
  const sandbox = parseSandboxQuery(req.query.sandbox);

  try {
    log("info", "liveavatar_check_start", { avatarId, sandbox });

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
          voice_id: "f206785d-e75f-4e8e-8afa-0d223d894d1f",
        },
      }),
    });

    const tokenData = await tokenRes.json() as {
      code: number;
      message?: string;
      data?: { session_id?: string };
    };

    if (tokenData.code === 100 || tokenData.code === 1000) {
      res.json({
        ok: true,
        status: "available",
        avatarId,
        sandbox,
        code: tokenData.code,
        detail: "LiveAvatarでこのアバターIDは利用可能です。",
      });
      return;
    }

    const message = tokenData.message || "";
    const isAvatarNotFound = /avatar not found/i.test(message);

    // status は available/not_found の二値に正規化。
    // 利用不能理由は reason（avatar_not_found / token_rejected / internal_error）で伝える。
    res.status(200).json({
      ok: false,
      status: "not_found",
      avatarId,
      sandbox,
      reason: isAvatarNotFound ? "avatar_not_found" : "token_rejected",
      code: tokenData.code,
      detail: message || "LiveAvatar APIがトークンを発行しませんでした",
      hint: isAvatarNotFound
        ? "LiveAvatar側で未承認/未同期/別アカウントの可能性があります。"
        : "APIキー権限・入力値・アバター状態を確認してください。",
    });
  } catch (error: any) {
    log("error", "liveavatar_check_error", { message: error.message, avatarId, sandbox });
    res.status(200).json({
      ok: false,
      status: "not_found",
      avatarId,
      sandbox,
      reason: "internal_error",
      detail: error.message,
    });
  }
});

app.listen(PORT, () => {
  log("info", "server_started", { port: PORT, model: "claude-sonnet-4-20250514" });
});
