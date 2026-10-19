// 고정 입력 세트를 만든다. 시나리오 20개 × 턴 깊이 1/3/5/10 = 80건.
// 턴 수가 독립변수다 — 입력 토큰이 턴에 비례해 늘어나는 걸 재기 위한 설계.
// 한 번 생성하면 커밋하고, 이후 모든 측정은 같은 파일을 쓴다. 바꾸면 전후 비교가 깨진다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(readFileSync(join(here, 'dataset/scenarios.json'), 'utf8'));
const DEPTHS = [1, 3, 5, 10];

// 턴을 채우는 더미 사용자 발화. 실제 학습 내용보다 길이의 일관성이 중요하다.
const FILLER = [
  "Sorry, could you say that again a bit slower?",
  "I see. And how long does that usually take?",
  "That makes sense. What would you recommend?",
  "Hmm, I'm not sure I follow. Could you explain?",
  "Okay. Is there any other option I should consider?",
  "Right. And what about the cost?",
  "Got it. One more thing I wanted to ask.",
  "Thanks. Let me think about that for a second.",
  "Actually, I changed my mind about that.",
  "Alright, that works for me.",
];

const cases = [];
for (const s of scenarios) {
  for (const depth of DEPTHS) {
    const history = [{ role: 'assistant', content: s.opener }];
    for (let i = 0; i < depth - 1; i++) {
      history.push({ role: 'user', content: FILLER[i % FILLER.length] });
      history.push({ role: 'assistant', content: `Sure. ${s.opener}` });
    }
    cases.push({
      caseId: `${s.id}-d${depth}`,
      scenarioId: s.id,
      scenario: s.scenario,
      depth,
      history,
      message: FILLER[depth % FILLER.length],
    });
  }
}

const out = join(here, 'dataset/cases.json');
writeFileSync(out, JSON.stringify(cases, null, 2));
console.log(`${cases.length}건 생성 → ${out}`);
