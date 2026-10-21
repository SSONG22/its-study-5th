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
    reasoningTokens: null,   // 추론 모델이 내부적으로 쓴 토큰. 과금되지만 응답에 안 보인다
    truncated: null,         // max_tokens 에 걸려 잘렸는지

    // summary 전략의 압축 비용. full/window 에서는 null.
    compactionCalls: 0,
    compactionMs: null,
    compactionInputTokens: null,
    compactionOutputTokens: null,
    compactionReasoningTokens: null,
    compactionEmpty: null,   // 요약이 비면 summary 가 window 와 동일하게 동작한다

    // 맥락 손실 프록시. window/summary 에서 원문으로 안 들어간 턴 수.
    droppedTurns: null,

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
