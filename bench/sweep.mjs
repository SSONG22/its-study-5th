// 전략별 스윕. 같은 입력을 전략만 바꿔가며 돌리고 비용과 품질을 함께 기록한다.
//
// 사용법:
//   node bench/sweep.mjs --label w04-probes --set probes --strategies full,window,summary
//   node bench/sweep.mjs --label w04-rules  --set cases  --sample 20
//
// 한 번에 전략 하나만 비교 대상으로 두는 게 원칙이지만,
// 여기서는 같은 입력·같은 모델에 전략만 다르므로 한 번에 돌려도 비교가 성립한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreRules, scoreProbe } from '../src/score.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);

const LABEL = args.label ?? `sweep-${Date.now()}`;
const SET = args.set ?? 'probes';                       // probes | cases
const STRATEGIES = (args.strategies ?? 'full,window,summary').split(',');
const REPEAT = Number(args.repeat ?? 1);                 // 비결정성 대응. 2 이상이면 통계가 안정된다
const SAMPLE = args.sample ? Number(args.sample) : null;
const URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

let cases = JSON.parse(readFileSync(join(here, `dataset/${SET}.json`), 'utf8'));
if (SAMPLE) cases = cases.slice(0, SAMPLE);

const rows = [];
const total = STRATEGIES.length * cases.length * REPEAT;
let done = 0;

for (const strategy of STRATEGIES) {
  for (const c of cases) {
    for (let r = 0; r < REPEAT; r++) {
      const t0 = Date.now();
      let body = {}, status = 0;
      try {
        const res = await fetch(`${URL}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...c, strategy }),
        });
        status = res.status;
        body = await res.json().catch(() => ({}));
      } catch (e) {
        body = { error: String(e.message) };
      }

      const reply = body.reply ?? '';
      const m = body.metrics ?? {};
      const rules = reply ? scoreRules(reply) : null;
      const probe = (SET === 'probes' && reply) ? scoreProbe(reply, c) : null;

      rows.push({
        label: LABEL, strategy, repeat: r,
        caseId: c.caseId, probeId: c.probeId ?? null, depth: c.depth ?? null,
        status, error: body.error ?? null,
        clientLatencyMs: Date.now() - t0,
        // 비용 축
        inputTokens: m.inputTokens ?? null,
        cachedTokens: m.cachedTokens ?? null,
        outputTokens: m.outputTokens ?? null,
        reasoningTokens: m.reasoningTokens ?? null,
        truncated: m.truncated ?? null,
        compactionInputTokens: m.compactionInputTokens ?? null,
        compactionOutputTokens: m.compactionOutputTokens ?? null,
        compactionReasoningTokens: m.compactionReasoningTokens ?? null,
        compactionEmpty: m.compactionEmpty ?? null,
        compactionMs: m.compactionMs ?? null,
        droppedTurns: m.droppedTurns ?? null,
        llmLatencyMs: m.llmLatencyMs ?? null,
        // 품질 축
        rulePassRate: rules?.passRate ?? null,
        ruleAllPass: rules?.allPass ?? null,
        ruleFailed: rules?.failed ?? null,
        sentences: rules?.sentences ?? null,
        probeVerdict: probe?.verdict ?? null,
        reply,
      });

      done++;
      if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
    }
  }
}

mkdirSync(join(here, 'results'), { recursive: true });
const out = join(here, `results/${LABEL}.json`);
writeFileSync(out, JSON.stringify(rows, null, 2));

const ok = rows.filter(r => r.status === 200);
console.log(`\n\n총 ${rows.length}건, 성공 ${ok.length}건 → ${out}`);
if (ok.length < rows.length) {
  const firstErr = rows.find(r => r.status !== 200);
  console.log(`실패 첫 건: status=${firstErr.status} ${firstErr.error ?? ''}`);
}
console.log(`집계: node bench/analyze.mjs --label ${LABEL}`);
