// 동시성을 1 → 5 → 10 → 20 으로 올리며 첫 실패 지점을 찾는다.
// 6주차용. 비용이 가장 많이 나가는 스크립트이므로 예산 알림을 먼저 확인할 것.
// 사용법: node bench/load.mjs --label w06-concurrency [--levels 1,5,10,20] [--per 10]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const LABEL = args.label ?? `load-${Date.now()}`;
const LEVELS = (args.levels ?? '1,5,10,20').split(',').map(Number);
const PER = Number(args.per ?? 10); // 레벨당 총 요청 수
const URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

const cases = JSON.parse(readFileSync(join(here, 'dataset/cases.json'), 'utf8'));
const rows = [];

async function once(c, level) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(c),
    });
    const text = await res.text();
    return { level, caseId: c.caseId, status: res.status, latencyMs: Date.now() - t0,
             error: res.ok ? '' : text.slice(0, 120) };
  } catch (e) {
    return { level, caseId: c.caseId, status: 0, latencyMs: Date.now() - t0, error: String(e.message).slice(0, 120) };
  }
}

for (const level of LEVELS) {
  console.log(`\n동시성 ${level} — ${PER}건`);
  const queue = Array.from({ length: PER }, (_, i) => cases[i % cases.length]);
  const results = [];
  for (let i = 0; i < queue.length; i += level) {
    const batch = queue.slice(i, i + level);
    results.push(...await Promise.all(batch.map(c => once(c, level))));
    process.stdout.write('.');
  }
  rows.push(...results);
  const fail = results.filter(r => r.status !== 200);
  const lat = results.filter(r => r.status === 200).map(r => r.latencyMs).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)] : null;
  console.log(` 실패 ${fail.length}/${results.length}  p95=${p95}ms`);
  if (fail.length) console.log(` 첫 실패: status=${fail[0].status} ${fail[0].error}`);
}

mkdirSync(join(here, 'results'), { recursive: true });
const header = Object.keys(rows[0]).join(',');
const csv = [header, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
const out = join(here, `results/${LABEL}.csv`);
writeFileSync(out, csv);
console.log(`\n→ ${out}`);
