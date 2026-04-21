import Anthropic from "@anthropic-ai/sdk";
import {
  MIRAI_SYSTEM_PROMPT,
  MAX_CONVERSATION_HISTORY,
  CLAUDE_MODEL,
  MAX_TOKENS,
} from "./mirai-prompt";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * Mirai チャットセッション
 * ユーザーごとの会話履歴を管理し、Claude APIと通信する
 */
export class MiraiChatSession {
  private client: Anthropic;
  private history: Message[] = [];

  constructor() {
    this.client = new Anthropic();
  }

  /**
   * ユーザーメッセージを送信し、Miraiの応答を取得
   */
  async chat(userMessage: string): Promise<string> {
    // 会話履歴にユーザーメッセージを追加
    this.history.push({ role: "user", content: userMessage });

    // 履歴が長くなりすぎたら古いものを削除
    if (this.history.length > MAX_CONVERSATION_HISTORY) {
      this.history = this.history.slice(-MAX_CONVERSATION_HISTORY);
    }

    const fallbackModel = process.env.CLAUDE_MODEL_FALLBACK || "claude-3-5-sonnet-20241022";
    const modelsToTry = [CLAUDE_MODEL, fallbackModel].filter(
      (model, index, self) => model && self.indexOf(model) === index
    );

    let lastError: unknown;
    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: MIRAI_SYSTEM_PROMPT,
          messages: this.history,
        });

        // テキスト応答を抽出
        const assistantMessage = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");

        // 会話履歴にアシスタント応答を追加
        this.history.push({ role: "assistant", content: assistantMessage });

        return assistantMessage;
      } catch (error) {
        lastError = error;
        const anyErr = error as { status?: number; message?: string } | undefined;
        const message = anyErr?.message || "";
        const canRetryWithFallback =
          i < modelsToTry.length - 1 &&
          anyErr?.status === 400 &&
          /(invalid_request|model|not found|unsupported)/i.test(message);

        if (!canRetryWithFallback) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * 会話履歴をリセット
   */
  reset(): void {
    this.history = [];
  }

  /**
   * 現在の会話履歴を取得
   */
  getHistory(): Message[] {
    return [...this.history];
  }
}

/**
 * セッション管理マップ
 * sessionId → MiraiChatSession
 */
const sessions = new Map<string, MiraiChatSession>();

/**
 * セッションを取得または新規作成
 */
export function getSession(sessionId: string): MiraiChatSession {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new MiraiChatSession());
  }
  return sessions.get(sessionId)!;
}

/**
 * セッションを削除
 */
export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}
