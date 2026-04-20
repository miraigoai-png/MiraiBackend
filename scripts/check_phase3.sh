#!/usr/bin/env bash
# Phase 3 受け入れチェック
# 1コマンドで /health, /api/config, /api/liveavatar/check（本番/サンドボックス）, /api/chat空メッセージ をPASS/FAILで出力
#
# 使い方:
#   bash scripts/check_phase3.sh                       # http://127.0.0.1:3011 で実行
#   BASE_URL=http://127.0.0.1:3001 bash scripts/check_phase3.sh
#
# 終了コード: 0=全PASS, 1=1件以上FAIL

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3011}"
PROD_AVATAR_ID="${PROD_AVATAR_ID:-5909689f-7a01-4027-8d33-1f5153d79b71}"
SANDBOX_AVATAR_ID="${SANDBOX_AVATAR_ID:-dd73ea75-1218-4ef3-92ce-606d5f7fbc0a}"

PASS=0
FAIL=0
RESULTS=""

print_result() {
  local name="$1"
  local status="$2"
  local detail="$3"
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
    printf "  \033[32m✓ PASS\033[0m  %s\n" "$name"
  else
    FAIL=$((FAIL + 1))
    printf "  \033[31m✗ FAIL\033[0m  %s\n    detail: %s\n" "$name" "$detail"
  fi
  RESULTS="${RESULTS}${status}\t${name}\n"
}

# JSON値抽出（jq不要、シンプルなsedベース）
json_get() {
  local body="$1"
  local key="$2"
  echo "$body" | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

json_get_bool() {
  local body="$1"
  local key="$2"
  # BSD sed互換のため -E を使用
  echo "$body" | sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' | head -n1
}

http_get() {
  curl -sS -o /tmp/check_phase3_body.txt -w "%{http_code}" "$1"
}

http_post_json() {
  curl -sS -o /tmp/check_phase3_body.txt -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" -d "$2" "$1"
}

echo ""
echo "=== Phase 3 acceptance check ==="
echo "BASE_URL: $BASE_URL"
echo ""

# 0: サーバー疎通
if ! curl -sS --max-time 3 "$BASE_URL/health" >/dev/null 2>&1; then
  printf "\033[31mサーバーに接続できません: %s\033[0m\n" "$BASE_URL"
  printf "起動例: PORT=3011 npm run dev\n"
  exit 1
fi

# 1. /health
echo "[1/5] GET /health"
status=$(http_get "$BASE_URL/health")
body=$(cat /tmp/check_phase3_body.txt)
overall=$(json_get "$body" "status")
claude_status=$(json_get "$body" "status" | head -n1)
if [ "$status" = "200" ] && [ "$overall" = "ok" ]; then
  print_result "/health overall=ok HTTP 200" "PASS" ""
else
  print_result "/health overall=ok HTTP 200" "FAIL" "http=$status overall=$overall body=$body"
fi

# 2. /api/config
echo "[2/5] GET /api/config"
status=$(http_get "$BASE_URL/api/config")
body=$(cat /tmp/check_phase3_body.txt)
default_avatar=$(json_get "$body" "defaultAvatarId")
sandbox_avatar=$(json_get "$body" "sandboxAvatarId")
if [ "$status" = "200" ] && [ -n "$default_avatar" ] && [ -n "$sandbox_avatar" ]; then
  print_result "/api/config returns defaultAvatarId/sandboxAvatarId" "PASS" ""
else
  print_result "/api/config returns defaultAvatarId/sandboxAvatarId" "FAIL" "http=$status default=$default_avatar sandbox=$sandbox_avatar"
fi

# 3. /api/liveavatar/check 本番（期待: status=available|not_found、reason=avatar_not_found|token_rejected|internal_error）
echo "[3/5] GET /api/liveavatar/check (本番)"
status=$(http_get "$BASE_URL/api/liveavatar/check?avatar_id=$PROD_AVATAR_ID")
body=$(cat /tmp/check_phase3_body.txt)
ok_field=$(json_get_bool "$body" "ok")
status_field=$(json_get "$body" "status")
reason_field=$(json_get "$body" "reason")
if [ "$status" = "200" ] && { [ "$status_field" = "available" ] || [ "$status_field" = "not_found" ]; }; then
  print_result "/api/liveavatar/check 本番 status=$status_field reason=${reason_field:-none} (ok=$ok_field)" "PASS" ""
else
  print_result "/api/liveavatar/check 本番 想定外応答（status=available|not_found期待）" "FAIL" "http=$status status=$status_field reason=$reason_field body=$body"
fi
PROD_STATUS="$status_field"

# 4. /api/liveavatar/check サンドボックス（期待: status=available, ok=true）
echo "[4/5] GET /api/liveavatar/check (サンドボックス)"
status=$(http_get "$BASE_URL/api/liveavatar/check?avatar_id=$SANDBOX_AVATAR_ID&sandbox=true")
body=$(cat /tmp/check_phase3_body.txt)
ok_field=$(json_get_bool "$body" "ok")
status_field=$(json_get "$body" "status")
reason_field=$(json_get "$body" "reason")
if [ "$status" = "200" ] && [ "$status_field" = "available" ] && [ "$ok_field" = "true" ]; then
  print_result "/api/liveavatar/check sandbox status=available ok=true" "PASS" ""
else
  print_result "/api/liveavatar/check sandbox 想定外応答（status=available, ok=true期待）" "FAIL" "http=$status status=$status_field ok=$ok_field reason=$reason_field body=$body"
fi

# 5. /api/chat 空メッセージ → HTTP 400 + error=invalid_input + userMessage
echo "[5/5] POST /api/chat (空メッセージ)"
status=$(http_post_json "$BASE_URL/api/chat" '{"sessionId":"check_phase3","message":""}')
body=$(cat /tmp/check_phase3_body.txt)
err_field=$(json_get "$body" "error")
user_msg=$(json_get "$body" "userMessage")
if [ "$status" = "400" ] && [ "$err_field" = "invalid_input" ] && [ -n "$user_msg" ]; then
  print_result "/api/chat 空メッセージで HTTP400 + error=invalid_input + userMessage" "PASS" ""
else
  print_result "/api/chat 空メッセージで HTTP400 + error=invalid_input + userMessage" "FAIL" "http=$status error=$err_field userMessage=$user_msg"
fi

echo ""
echo "=== summary ==="
printf "PASS: %d   FAIL: %d\n" "$PASS" "$FAIL"
printf "本番アバター利用状態: %s " "$PROD_STATUS"
if [ "$PROD_STATUS" = "available" ]; then
  printf "→ \033[32m切替Go（Task C実行可能）\033[0m\n"
else
  printf "→ \033[33m継続監視（LiveAvatar承認/同期待ち）\033[0m\n"
fi
echo ""

rm -f /tmp/check_phase3_body.txt

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
