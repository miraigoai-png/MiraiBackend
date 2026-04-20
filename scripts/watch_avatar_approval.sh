#!/usr/bin/env bash
# 本番アバター承認監視ポーラー
# /api/liveavatar/check を一定間隔で叩き、承認検知（status=available）で終了通知する。
#
# 使い方:
#   bash scripts/watch_avatar_approval.sh
#   INTERVAL_SEC=600 bash scripts/watch_avatar_approval.sh      # 10分ごと
#   BASE_URL=https://miraibackend-production.up.railway.app bash scripts/watch_avatar_approval.sh
#   MAX_ITER=3 bash scripts/watch_avatar_approval.sh            # 3回だけチェックして終了（テスト向け）
#
# 環境変数:
#   BASE_URL        既定 http://127.0.0.1:3011
#   AVATAR_ID       既定 5909689f-7a01-4027-8d33-1f5153d79b71（本番Mirai）
#   INTERVAL_SEC    既定 1800（30分）
#   MAX_ITER        既定 0（無限）。テスト用に回数制限したい時に指定
#   LOG_FILE        既定 /tmp/mirai_avatar_watch.log
#
# 終了コード:
#   0 = 承認検知（status=available で終了）
#   1 = MAX_ITER 到達（未承認のままタイムアウト）
#   130 = Ctrl+C

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3011}"
AVATAR_ID="${AVATAR_ID:-5909689f-7a01-4027-8d33-1f5153d79b71}"
INTERVAL_SEC="${INTERVAL_SEC:-1800}"
MAX_ITER="${MAX_ITER:-0}"
LOG_FILE="${LOG_FILE:-/tmp/mirai_avatar_watch.log}"

iter=0

# JSON値抽出（jq不要）
json_get() {
  echo "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

echo ""
echo "=== LiveAvatar 承認監視ポーラー ==="
echo "BASE_URL:    $BASE_URL"
echo "AVATAR_ID:   $AVATAR_ID"
echo "INTERVAL:    ${INTERVAL_SEC}s"
echo "MAX_ITER:    $MAX_ITER (0=unlimited)"
echo "LOG_FILE:    $LOG_FILE"
echo ""
echo "承認が検知されたら終了します。Ctrl+C で中断可能。"
echo ""

while :; do
  iter=$((iter + 1))
  ts=$(date -u +%FT%TZ)

  body=$(curl -sS --max-time 10 "$BASE_URL/api/liveavatar/check?avatar_id=$AVATAR_ID" 2>/dev/null || echo '{"status":"unreachable"}')
  status_field=$(json_get "$body" "status")
  reason_field=$(json_get "$body" "reason")

  line="[$ts] iter=$iter status=${status_field:-unknown} reason=${reason_field:-none}"
  echo "$line"
  echo "$line" >> "$LOG_FILE"

  if [ "$status_field" = "available" ]; then
    printf "\n\033[32m✓ 承認検知！本番アバターが available になりました\033[0m\n"
    printf "  次アクション: docs/APPROVAL_SWITCHOVER_RUNBOOK.md の Step 2 以降を実行\n"
    # 端末ベル通知（鳴る環境でのみ）
    printf "\a\a\a"
    # macOS なら voice 通知（存在すれば）
    if command -v say >/dev/null 2>&1; then
      say -v Kyoko "Mirai avatar approved" >/dev/null 2>&1 &
    fi
    exit 0
  fi

  if [ "$MAX_ITER" -gt 0 ] && [ "$iter" -ge "$MAX_ITER" ]; then
    printf "\n\033[33mMAX_ITER=%d 到達。未承認のまま終了します。\033[0m\n" "$MAX_ITER"
    exit 1
  fi

  sleep "$INTERVAL_SEC"
done
