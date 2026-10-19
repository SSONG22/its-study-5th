// 콜드/웜을 나눠 재고 CSV 로 남긴다.
// 사용법: node bench/measure.mjs --label w03-baseline [--warm 5] [--cold 5]
// 콜드는 Lambda 가 재사용 컨테이너를 쓰지 않도록 간격을 두고 때린다(완전 보장은 안 됨 —
// 응답의 coldStart 플래그로 사후 판정한다).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const LABEL = args.label ?? `run-${Date.now()}`;
const WARM = Number(args.warm ?? 5);
const SAMPLE = Number(args.sample ?? 20); // 80건 전부 돌리면 비용이 크다. 기본은 샘플.
const URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

const cases = JSON.parse(readFileSync(join(here, 'dataset/cases.json'), 'utf8')).slice(0, SAMPLE);
const rows = [];

for (const c of cases) {
  for (let i = 0; i < WARM; i++) {
    const t0 = Date.now();
    let status = 0, body = {};
    try {
      const res = await fetch(`${URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(c),
      });
      status = res.status;
      body = await res.json().catch(() => ({}));
    } catch (e) {
      body = { error: String(e.message) };
    }
    rows.push({
      label: LABEL, caseId: c.caseId, scenarioId: c.scenarioId, depth: c.depth,
      iteration: i, status, clientLatencyMs: Date.now() - t0, error: body.error ?? '',
    });
    process.stdout.write('.');
  }
}

mkdirSync(join(here, 'results'), { recursive: true });
const header = Object.keys(rows[0]).join(',');
const csv = [header, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
const out = join(here, `results/${LABEL}.csv`);
writeFileSync(out, csv);

const ok = rows.filter(r => r.status === 200).map(r => r.clientLatencyMs).sort((a, b) => a - b);
const p = q => ok.length ? ok[Math.min(ok.length - 1, Math.floor(ok.length * q))] : null;
console.log(`\n${LABEL}  n=${rows.length} ok=${ok.length}  p50=${p(0.5)}ms p95=${p(0.95)}ms → ${out}`);
console.log('토큰/캐시/서버측 지연은 CloudWatch 의 kind="bench" 로그를 함께 보세요.');
