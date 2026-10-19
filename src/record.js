// 측정 레코드. 요청 한 건당 runs/{label}.jsonl 에 JSON 한 줄.
// AWS 를 쓰지 않으므로 CloudWatch 대신 파일로 직접 남긴다.
// 스키마를 바꾸면 이전 측정과 비교가 깨진다. 기준선 측정 이후에는 추가만 할 것.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNS_DIR = new URL('../runs/', import.meta.url).pathname;
mkdirSync(RUNS_DIR, { recursive: true });

let seq = 0;

export function newRecord({ label = process.env.RUN_LABEL ?? 'dev' } = {}) {
  const t0 = performance.now();
  return {
    label,
    requestId: `${Date.now()}-${++seq}`,
    ts: new Date().toISOString(),

    // 입력 조건
    scenarioId: null,
    turnIndex: null,
    historyStrategy: null,
    historyTurns: null,
    provider: null,
    model: null,
    stream: null,

    // 토큰
    inputTokens: null,
    cachedTokens: null,
    outputTokens: null,

    // 지연
    ttftMs: null,        // 첫 토큰까지. 스트리밍일 때만 의미 있음
    llmLatencyMs: null,  // LLM 호출 전체
    totalLatencyMs: null,// 서버 처리 전체

    error: null,

    finish(extra = {}) {
      Object.assign(this, extra);
      this.totalLatencyMs = Math.round(performance.now() - t0);
      const { finish, ...plain } = this;
      try {
        appendFileSync(join(RUNS_DIR, `${this.label}.jsonl`), JSON.stringify(plain) + '\n');
      } catch (e) {
        console.error('레코드 기록 실패:', e.message);
      }
      return plain;
    },
  };
}
