import dotenv from "dotenv";
dotenv.config({ override: true });

import { MiraiChatSession } from "./mirai-chat";

/**
 * Mirai チャットのテスト
 * APIキーが正しく設定されていれば、Miraiとの対話をテストできる
 */
async function main() {
  console.log("🤖 Mirai AIコンサルタント テスト\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY が設定されていません");
    console.error("   .env ファイルに ANTHROPIC_API_KEY=sk-ant-... を追加してください");
    process.exit(1);
  }

  const session = new MiraiChatSession();

  // テスト1: 通常のビジネス質問
  console.log("--- テスト1: ビジネス質問 ---");
  console.log("👤 ユーザー: SNSでフォロワーを増やすコツを教えてください\n");

  const reply1 = await session.chat(
    "SNSでフォロワーを増やすコツを教えてください"
  );
  console.log(`🤖 Mirai: ${reply1}\n`);

  // テスト2: 禁止領域（法律相談）
  console.log("--- テスト2: 禁止領域テスト ---");
  console.log("👤 ユーザー: 契約書の内容について法的に有効か教えてください\n");

  const reply2 = await session.chat(
    "契約書の内容について法的に有効か教えてください"
  );
  console.log(`🤖 Mirai: ${reply2}\n`);

  // テスト3: 会話の連続性
  console.log("--- テスト3: 会話の連続性 ---");
  console.log("👤 ユーザー: 最初の質問の続きで、具体的にInstagramについて教えて\n");

  const reply3 = await session.chat(
    "最初の質問の続きで、具体的にInstagramについて教えて"
  );
  console.log(`🤖 Mirai: ${reply3}\n`);

  console.log("✅ テスト完了");
  console.log(`   会話ターン数: ${session.getHistory().length}`);
}

main().catch(console.error);
