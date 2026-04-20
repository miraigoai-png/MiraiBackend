# LiveAvatar 承認後 切替ランブック

本番 Mirai アバターの LiveAvatar 承認メールが到着したら、このランブックに沿って切替作業を行う。全手順の所要時間目安: 10〜15分。

## 確定情報（2026-04-19 時点）

- **新 avatar_id**: `5909689f-7a01-4027-8d33-1f5153d79b71`
- **name**: `mirai.go.ai`
- **status**: `ACTIVE`
- **type**: `IMAGE`
- **created_at**: 2026-04-18T13:32:26
- **updated_at**: 2026-04-19T09:58:56
- **トークン発行実動確認**: Railway `/api/liveavatar/token` で HTTP 200 + JWT 取得（2026-04-19）

下記 Step 1 は上記の値を使用して良い。

## 0. 事前条件

- LiveAvatar から「アバター作成完了」のメール通知が届いている
  - 送信元: `support@liveavatar.com` または LiveAvatar 管理画面の通知
  - 宛先: `mirai.go.ai@gmail.com`
- LiveAvatar 管理画面（`https://app.liveavatar.com/avatars`）で `mirai.go.ai` のステータスが待機→利用可能に遷移している

## 1. 新 avatar_id を取得

1. `https://app.liveavatar.com/avatars` を開く
2. カスタムアバター「mirai.go.ai」のカードをクリック
3. 詳細画面に表示される **avatar_id（UUID）** をコピー
   - もしくは `GET /v1/avatars` を API キーで叩いて取得:
     ```bash
     curl -sS -H "X-API-KEY: $LIVEAVATAR_API_KEY" \
       https://api.liveavatar.com/v1/avatars | jq '.data[] | select(.name=="mirai.go.ai") | .avatar_id'
     ```

## 2. ローカルで疎通確認（切替前テスト）

```bash
cd "~/Documents/Obsidian Vault/Mirai project/MiraiBackend"

# サーバを起動（既に起動中ならスキップ）
PORT=3011 npm run dev

# 別ターミナルで新 avatar_id が利用可能か確認
NEW_AVATAR_ID=<コピーしたUUID>
curl -sS "http://127.0.0.1:3011/api/liveavatar/check?avatar_id=$NEW_AVATAR_ID" | jq .
```

**期待値**: `{"ok":true, "status":"available", "code":1000}`

もし `status:"not_found"` が返る場合は LiveAvatar 側の同期遅延の可能性あり。15分待って再試行。3回連続で失敗したら `support@liveavatar.com` に問合せ。

## 3. 環境変数を更新

### ローカル（`.env`）

```
DEFAULT_AVATAR_ID=<新UUID>
```

### Railway（本番）

1. Railway ダッシュボード → MiraiBackend → Variables
2. `DEFAULT_AVATAR_ID` を新 UUID に更新（無ければ追加）
3. 自動的に再デプロイがトリガーされる（GitHubプッシュ不要）
4. デプロイログで `server_started` を確認

## 4. 本番で切替を確認

```bash
# 本番エンドポイントに対して受入チェックを実行
BASE_URL=https://miraibackend-production.up.railway.app \
  PROD_AVATAR_ID=<新UUID> \
  bash scripts/check_phase3.sh
```

**期待値**:
- `[3/5] /api/liveavatar/check 本番 status=available (ok=true)` **PASS**
- 最終行に `本番アバター承認状態: available → 切替Go（Task C実行可能）`

## 5. 実機で1往復会話を確認

1. ブラウザで `https://miraibackend-production.up.railway.app` を開く
2. 「無料体験を開始」をクリック → アバターが Mirai 本番キャラで表示される
3. 「新規事業のアイデアを相談したい」と送信 → アバターが音声で応答
4. タイマーが 5:00 からカウントダウン開始
5. 会話ログが画面に表示される
6. `Ctrl+C`（または終了ボタン）でセッション停止 → `ended` 状態へ遷移

## 6. ロールバック手順（切替後に問題発生時）

```bash
# 1. Railway の DEFAULT_AVATAR_ID をサンドボックスID or 未設定に戻す
#    dd73ea75-1218-4ef3-92ce-606d5f7fbc0a （Wayne）
# 2. USE_SANDBOX_FALLBACK=true を確認（デフォルト）
# 3. 再デプロイ完了後、本番で /api/liveavatar/check を再実行
```

フロントエンドは `avatar_not_found` 時にサンドボックスへ自動フォールバックするため、最悪でも UX は保たれる。

## 7. 切替完了チェックリスト

- [ ] `DEFAULT_AVATAR_ID` が本番 UUID（Railway）
- [ ] `scripts/check_phase3.sh` が 5/5 PASS
- [ ] 本番 `/api/liveavatar/check` が `available`
- [ ] 実機ブラウザで Mirai 本番アバターが表示
- [ ] 1往復会話で speaking → ended まで正常遷移
- [ ] HANDOFF_HERMES_TO_CLAUDE.md に切替結果を追記

## 8. 参考リンク

- LiveAvatar 管理画面: https://app.liveavatar.com/avatars
- Railway: https://railway.com/project/ （MiraiBackend プロジェクト）
- 本番エンドポイント: https://miraibackend-production.up.railway.app
- 承認監視ポーラー: `bash scripts/watch_avatar_approval.sh`
- 受入チェック: `bash scripts/check_phase3.sh`
- モバイル実機QA: `docs/PHASE3_MOBILE_QA_CHECKLIST.md`
