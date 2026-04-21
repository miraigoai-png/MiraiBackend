/**
 * Claude API 生エラーを、HTTPステータス・エラーコード・ユーザー向け文言に分類する純粋関数。
 * server.ts から共有し、単体テストで回帰検証する。
 */

export interface ChatErrorClassification {
  code: string;
  userMessage: string;
  httpStatus: number;
}

export function classifyChatError(error: unknown): ChatErrorClassification {
  const anyErr = error as { status?: number; name?: string; message?: string } | undefined;
  const status = anyErr?.status;
  const message = anyErr?.message || "";

  // Anthropic が 400 で返す「クレジット残高不足」は課金ブロッカーであり
  // ユーザー起因のリクエスト不正ではない。UI向け文言と httpStatus を独立させる。
  if (/credit balance is too low|billing|plans & billing/i.test(message)) {
    return {
      code: "billing_error",
      userMessage: "AIサービスが一時的に停止しています。運営にお問い合わせください。",
      httpStatus: 503,
    };
  }
  // 存在しない/廃止されたモデルIDを Anthropic が 400 で拒否するケース
  if (/model:.*not.*found|invalid.*model|unknown model|not.*a valid model/i.test(message)) {
    return {
      code: "model_unavailable",
      userMessage: "AIモデル設定に問題があります。運営にお問い合わせください。",
      httpStatus: 503,
    };
  }
  if (status === 400 || /invalid_request_error/i.test(message)) {
    return {
      code: "invalid_request",
      userMessage: "リクエスト内容に問題がありました。質問を短く書き直して再送信してください。",
      httpStatus: 400,
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: "auth_error",
      userMessage: "認証エラーが発生しました。管理者に連絡してください。",
      httpStatus: 503,
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      userMessage: "アクセスが集中しています。1分ほど待ってから再試行してください。",
      httpStatus: 429,
    };
  }
  if (typeof status === "number" && status >= 500) {
    return {
      code: "upstream_error",
      userMessage: "AIサービスが一時的に応答できません。しばらく待ってから再試行してください。",
      httpStatus: 502,
    };
  }
  return {
    code: "internal_error",
    userMessage: "応答の生成に失敗しました。再度お試しください。",
    httpStatus: 500,
  };
}
