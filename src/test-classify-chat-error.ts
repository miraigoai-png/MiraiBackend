/**
 * classifyChatError の単体テスト（軽量、依存なし、tsx 実行）
 *
 * 使い方: npm run test:classify
 */

import { classifyChatError, ChatErrorClassification } from "./classify-chat-error";

interface TestCase {
  name: string;
  input: unknown;
  expected: {
    code: string;
    httpStatus: number;
  };
}

const cases: TestCase[] = [
  {
    name: "status 400 → invalid_request",
    input: { status: 400, message: "bad request" },
    expected: { code: "invalid_request", httpStatus: 400 },
  },
  {
    name: "message に invalid_request_error を含む → invalid_request",
    input: { message: "anthropic.BadRequestError: invalid_request_error: missing messages" },
    expected: { code: "invalid_request", httpStatus: 400 },
  },
  {
    name: "status 401 → auth_error",
    input: { status: 401, message: "unauthorized" },
    expected: { code: "auth_error", httpStatus: 503 },
  },
  {
    name: "status 403 → auth_error",
    input: { status: 403, message: "forbidden" },
    expected: { code: "auth_error", httpStatus: 503 },
  },
  {
    name: "status 429 → rate_limited",
    input: { status: 429, message: "too many requests" },
    expected: { code: "rate_limited", httpStatus: 429 },
  },
  {
    name: "status 500 → upstream_error",
    input: { status: 500, message: "server error" },
    expected: { code: "upstream_error", httpStatus: 502 },
  },
  {
    name: "status 503 → upstream_error",
    input: { status: 503, message: "service unavailable" },
    expected: { code: "upstream_error", httpStatus: 502 },
  },
  {
    name: "未知エラー（status なし）→ internal_error",
    input: { message: "something broke" },
    expected: { code: "internal_error", httpStatus: 500 },
  },
  {
    name: "undefined 入力 → internal_error",
    input: undefined,
    expected: { code: "internal_error", httpStatus: 500 },
  },
  {
    name: "status 400 は invalid_request_error 正規表現より優先される",
    input: { status: 400, message: "invalid_request_error" },
    expected: { code: "invalid_request", httpStatus: 400 },
  },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const c of cases) {
  const actual: ChatErrorClassification = classifyChatError(c.input);
  const ok = actual.code === c.expected.code && actual.httpStatus === c.expected.httpStatus;
  const hasUserMessage = typeof actual.userMessage === "string" && actual.userMessage.length > 0;

  if (ok && hasUserMessage) {
    pass++;
    console.log(`  ✓ PASS  ${c.name}`);
  } else {
    fail++;
    const detail = `expected code=${c.expected.code} httpStatus=${c.expected.httpStatus}, got code=${actual.code} httpStatus=${actual.httpStatus} userMessage="${actual.userMessage}"`;
    failures.push(`${c.name}: ${detail}`);
    console.log(`  ✗ FAIL  ${c.name}`);
    console.log(`    ${detail}`);
  }
}

console.log("");
console.log(`=== summary ===`);
console.log(`PASS: ${pass}   FAIL: ${fail}   TOTAL: ${cases.length}`);

if (fail > 0) {
  process.exit(1);
}
