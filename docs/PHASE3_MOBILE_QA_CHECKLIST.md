# Phase 3 モバイルUX 実機QAチェックリスト（iPhone中心）

> このドキュメントは Phase 3 Task B の **実機検証パス** で使用する。
> 静的監査結果は `HANDOFF_HERMES_TO_CLAUDE.md` の Phase 3 Task B セクションを参照。

## 検証対象URL
- ローカル開発: `http://<開発機LAN-IP>:3011/`（PORT=3011でnpm run dev起動済）
- Railway本番: `https://miraibackend-production.up.railway.app/`
- UTAGE埋め込み: 該当iframeページ

## 検証端末
- 必須: **iPhone Safari**（最新iOS）
- 推奨: iPhone Chrome、iPad Safari、Android Chrome（参考データ）

## 事前準備
1. 開発機: `cd MiraiBackend && PORT=3011 npm run dev`
2. 開発機のLAN IPを確認（`ipconfig getifaddr en0`）
3. iPhoneと開発機を同一Wi-Fiに接続
4. iPhoneのSafariで `http://<LAN-IP>:3011/` を開く
5. `bash scripts/check_phase3.sh` でAPI層が緑になっていることを確認

---

## B-1: CTA連打時の多重起動なし

### 手順
1. ページロード直後、`無料で5分間Miraiと相談する` を **0.2秒間隔で5回連打**
2. ネットワーク状態を「Slow 3G」相当に絞ってから（DevTools/Network Linkで再現可）再度5連打
3. 接続中に `アバターを起動` も併せて押下

### 期待
- LiveAvatarセッションは **1個のみ生成**（`POST /api/liveavatar/token` のリクエストはネットワークログで最大2回＝本番→サンドボックスフォールバック分まで）
- ステータスバッジが `接続中` から `待機中` に進む間、CTA・起動ボタン両方が `disabled` 表示
- chat-log に `LiveAvatarに接続しています...` のシステムメッセージは **1回のみ**

### 証跡記録テンプレ
```
日時: YYYY-MM-DD HH:MM
端末/OS: iPhone __ / iOS __
ブラウザ: Safari __
ネットワーク: Wi-Fi / 5G / Slow 3G
結果: PASS / FAIL
セッション生成数（推定）: __
スクリーンショット: ./qa_evidence/B1_<日時>.png
備考:
```

---

## B-2: キーボード表示時の入力欄/送信ボタン可視性

### 手順
1. アバターを起動 → `待機中` 状態にする
2. `テキストで質問する...` 入力欄をタップしてキーボードを出す
3. 入力欄＋送信ボタンが画面内に見えていることを確認
4. キーボードを閉じる → 元のレイアウトに戻ることを確認
5. 横向き（ランドスケープ）でも同様に確認

### 期待
- キーボード表示時、ヘッダ・注意書きが非表示になり chat-panel が拡張
- `chat-log` 直近メッセージ ＋ 入力欄 ＋ 送信ボタンが全て同時に視認可能
- 入力欄が `position: fixed` 等で隠れない
- キーボード閉鎖後にレイアウトが正常復帰

### 証跡記録テンプレ
```
日時:
端末/OS:
向き: portrait / landscape
キーボード種別: 標準 / フリック / 外部Bluetooth
入力欄可視: ○ / ×
送信ボタン可視: ○ / ×
復帰挙動: 正常 / 異常（詳細）
スクリーンショット: ./qa_evidence/B2_<日時>.png
```

---

## B-3: タイマー満了時の ended 導線（00:00固定 + 有料導線）

### 手順
**短縮テスト推奨**: 開発時のみ `state.trialDurationSec` を一時的に60秒に下げて検証する。
本番確認は5分待つ。

1. アバターを起動 → タイマー稼働開始
2. タイマー満了まで待機
3. 満了直後の挙動を観察
4. CTA `無料体験をもう一度開始` をタップして再起動可能か確認

### 期待
- タイマーが `00:00` で停止し、その表示が消えない
- ステータスバッジが `体験終了`（status-ready）に変わる
- chat-log に `無料体験5分が終了しました。続ける場合は有料登録をご案内します。` が出る
- セッションが切断されてもタイマー帯は残る（有料導線として）
- CTA ラベルが `無料体験をもう一度開始` に変わり、押下で再CONNECTING

### 証跡記録テンプレ
```
日時:
trialDurationSec設定: 300 / 60（短縮テスト）
タイマー00:00固定: ○ / ×
ステータス遷移: connected → ended ✓
有料導線表示維持: ○ / ×
再起動: 成功 / 失敗
スクリーンショット: ./qa_evidence/B3_<日時>.png
```

---

## B-4: エラー復帰（error → 再試行 → connected）

### 手順
1. ネットワークを一時的に切断するか、`/api/liveavatar/token` をモックで500応答に変える
2. アバターを起動 → ERROR遷移を確認
3. ネットワーク復旧後、`アバターを起動` または CTA で再試行
4. 正常にCONNECTEDまで復帰することを確認

### 期待
- ERROR時、ステータスバッジが `エラー`、`video-status-text` に詳細メッセージ
- chat-log にエラー文言が追加
- CTA・起動ボタンが押下可能（disabled解除）
- 再試行で CONNECTING → CONNECTED の正常経路

### 補足: avatar_not_found自動フォールバック確認
1. `DEFAULT_AVATAR_ID` を `1fdb012b-...`（未承認）のまま起動
2. CTA押下 → chat-logに `本番アバター未承認のため、テストアバターで接続します。` が出る
3. サンドボックスで CONNECTED に遷移

### 証跡記録テンプレ
```
日時:
エラー発生方法: ネットワーク切断 / モックトークン拒否 / その他
ERROR表示: ○ / ×
CTA再活性化: ○ / ×
復帰: 成功 / 失敗
avatar_not_foundフォールバック: 観測 / 未発生
スクリーンショット: ./qa_evidence/B4_<日時>.png
```

---

## QA総合サマリ記入欄

| 項目 | 結果 | 担当 | 日時 | 証跡 |
|------|------|------|------|------|
| B-1 CTA連打多重起動なし | | | | |
| B-2 キーボード可視性 | | | | |
| B-3 タイマー満了ended導線 | | | | |
| B-4 エラー復帰 | | | | |
| B-4補足 自動フォールバック | | | | |

総合判定: PASS / 一部FAIL / FAIL
申し送り:
