// 스윕 결과 집계. 비용과 품질을 한 표에 놓고 비교한다.
//
// 사용법: node bench/analyze.mjs --label w04-probes
//
// 단가는 모델마다 다르므로 환경변수로 덮어쓸 수 있게 뒀다 (1M 토큰당 달러).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const LABEL = args.label;
if (!LABEL) { console.error('--label 이 필요합니다'); process.exit(1); }

const PRICE = {
  in:     Number(process.env.PRICE_IN     ?? 0.10),
  cached: Number(process.env.PRICE_CACHED ?? 0.01),
  out:    Number(process.env.PRICE_OUT    ?? 0.50),
};

const rows = JSON.parse(readFileSync(join(here, `results/${LABEL}.json`), 'utf8'))
  .filter(r => r.status === 200);

// 요청 한 건의 비용. 요약 호출 비용을 반드시 더한다 —
// 빼먹으면 summary 가 제일 싸다는 잘못된 결론이 나온다.
function cost(r) {
  const fresh = (r.inputTokens ?? 0) - (r.cachedTokens ?? 0);
  return (
    fresh * PRICE.in +
    (r.cachedTokens ?? 0) * PRICE.cached +
    (r.outputTokens ?? 0) * PRICE.out +
    (r.compactionInputTokens ?? 0) * PRICE.in +
    (r.compactionOutputTokens ?? 0) * PRICE.out
  ) / 1e6;
}

const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
const fmt = (v, d = 0) => v == null ? '-' : Number(v).toFixed(d);

function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function summarize(rs) {
  const compCost = avg(rs.map(r => ((r.compactionInputTokens ?? 0) * PRICE.in + (r.compactionOutputTokens ?? 0) * PRICE.out) / 1e6));
  return {
    n: rs.length,
    inTok: avg(rs.map(r => r.inputTokens ?? 0)),
    outTok: avg(rs.map(r => r.outputTokens ?? 0)),
    compTok: avg(rs.map(r => (r.compactionInputTokens ?? 0) + (r.compactionOutputTokens ?? 0))),
    latency: avg(rs.map(r => r.llmLatencyMs ?? 0)),
    cost: avg(rs.map(cost)),
    compCost,
    rulePass: pct(rs.filter(r => r.ruleAllPass).length, rs.length),
    recalled: pct(rs.filter(r => r.probeVerdict === 'recalled').length, rs.length),
    fabricated: pct(rs.filter(r => r.probeVerdict === 'fabricated').length, rs.length),
    askedBack: pct(rs.filter(r => r.probeVerdict === 'askedBack').length, rs.length),
    unclear: pct(rs.filter(r => r.probeVerdict === 'unclear').length, rs.length),
  };
}

const hasProbe = rows.some(r => r.probeVerdict);

console.log(`\n=== ${LABEL} · ${rows.length}건 ===`);
console.log(`단가(1M 토큰당): 입력 $${PRICE.in} / 재사용 $${PRICE.cached} / 출력 $${PRICE.out}\n`);

// 전략별
console.log('전략별');
const head = hasProbe
  ? ['전략', 'n', '입력', '출력', '요약', '지연ms', '요청당 비용', '규칙통과', '기억', '날조', '되물음', '애매']
  : ['전략', 'n', '입력', '출력', '요약', '지연ms', '요청당 비용', '규칙통과'];
console.log('  ' + head.map((h, i) => h.padEnd([10,5,7,6,6,8,14,9,7,7,8,6][i])).join(''));
console.log('  ' + '-'.repeat(hasProbe ? 97 : 73));

const byStrategy = group(rows, r => r.strategy);
const baseline = byStrategy.has('full') ? summarize(byStrategy.get('full')) : null;

for (const [strategy, rs] of byStrategy) {
  const s = summarize(rs);
  const cells = [
    strategy, String(s.n), fmt(s.inTok), fmt(s.outTok), fmt(s.compTok),
    fmt(s.latency), '$' + s.cost.toFixed(6), s.rulePass + '%',
  ];
  if (hasProbe) cells.push(s.recalled + '%', s.fabricated + '%', s.askedBack + '%', s.unclear + '%');
  console.log('  ' + cells.map((c, i) => c.padEnd([10,5,7,6,6,8,14,9,7,7,8,6][i])).join(''));
}

// 기준선 대비
if (baseline) {
  console.log('\nfull 대비');
  for (const [strategy, rs] of byStrategy) {
    if (strategy === 'full') continue;
    const s = summarize(rs);
    const dTok = pct(s.inTok - baseline.inTok, baseline.inTok);
    const dCost = pct(s.cost - baseline.cost, baseline.cost);
    const line = `  ${strategy.padEnd(10)} 입력토큰 ${dTok > 0 ? '+' : ''}${dTok}%   비용 ${dCost > 0 ? '+' : ''}${dCost}%`;
    console.log(hasProbe ? `${line}   기억률 ${baseline.recalled}% → ${s.recalled}%` : line);
  }
}

// 깊이별
if (rows.some(r => r.depth != null)) {
  console.log('\n깊이 × 전략');
  const depths = [...new Set(rows.map(r => r.depth))].sort((a, b) => a - b);
  console.log('  ' + '깊이'.padEnd(6) + [...byStrategy.keys()].map(s => s.padEnd(hasProbe ? 22 : 16)).join(''));
  for (const d of depths) {
    const cells = [...byStrategy.keys()].map(st => {
      const rs = rows.filter(r => r.depth === d && r.strategy === st);
      if (!rs.length) return '-'.padEnd(hasProbe ? 22 : 16);
      const s = summarize(rs);
      const txt = hasProbe ? `in ${fmt(s.inTok)} / 기억 ${s.recalled}%` : `in ${fmt(s.inTok)} / 규칙 ${s.rulePass}%`;
      return txt.padEnd(hasProbe ? 22 : 16);
    });
    console.log('  ' + String(d).padEnd(6) + cells.join(''));
  }
}

// 규칙 위반 분포
const fails = rows.flatMap(r => r.ruleFailed ?? []);
if (fails.length) {
  console.log('\n규칙 위반 분포');
  const counts = [...group(fails, f => f)].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of counts) console.log(`  ${k.padEnd(20)} ${n}건 (${pct(n, rows.length)}%)`);
} else {
  console.log('\n규칙 위반 없음');
}

// CSV 로도 남긴다
const csvRows = [...byStrategy].map(([strategy, rs]) => ({ strategy, ...summarize(rs) }));
const csv = [Object.keys(csvRows[0]).join(','), ...csvRows.map(r => Object.values(r).join(','))].join('\n');
const csvPath = join(here, `results/${LABEL}-summary.csv`);
writeFileSync(csvPath, csv);
console.log(`\n요약 CSV → ${csvPath}\n`);
