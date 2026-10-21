// 응답 품질 자동 채점.
//
// 채점 항목은 src/prompt.js 의 안내문에 실제로 적힌 규칙에서 1:1로 가져왔다.
// 안내문 규칙을 고치면 여기도 같이 고쳐야 한다.
//
// 여기서 재는 건 "규칙을 지켰는가"이지 "영어가 자연스러운가"가 아니다.
// 자연스러움·대화 적절성은 판정 모델이 필요하고 비용이 들어서 범위 밖으로 뒀다.

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const EMOJI  = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const MARKDOWN = /(^|\n)\s*([-*+]\s|#{1,6}\s|\d+\.\s)|\*\*|__|```/;
const STAGE_DIRECTION = /\*[^*\n]{2,}\*|\[[^\]\n]{2,}\]/;
const AI_SELF_REF = /\b(as an ai|i am an ai|i'm an ai|language model|ai assistant|ai language|practice tool|as a chatbot)\b/i;
const CORRECTION = /\b(you should say|the correct (way|form|phrase)|grammatically|a better way to say|instead of saying|small correction)\b/i;

// 문장 수. 약어(Mr. / U.S. / 3.5)를 문장 끝으로 오인하지 않도록 보정한다.
export function countSentences(text) {
  const t = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e)\./gi, '$1<DOT>')
    .replace(/(\d)\.(\d)/g, '$1<DOT>$2');
  const parts = t.split(/[.!?]+(?=\s|$)/).map(s => s.trim()).filter(Boolean);
  return parts.length;
}

// 규칙별 채점. pass=true 면 통과.
// detail 에는 위반 근거를 남긴다 — 실패 사례 분류에 쓴다.
export function scoreRules(reply) {
  const text = (reply ?? '').trim();
  const sentences = countSentences(text);

  const checks = {
    englishOnly:   { pass: !HANGUL.test(text),            detail: HANGUL.test(text) ? '한글 포함' : null },
    sentenceLimit: { pass: sentences >= 1 && sentences <= 3, detail: `문장 ${sentences}개` },
    asksQuestion:  { pass: text.includes('?'),            detail: text.includes('?') ? null : '질문 없음' },
    noEmoji:       { pass: !EMOJI.test(text),             detail: EMOJI.test(text) ? '이모지 포함' : null },
    noMarkdown:    { pass: !MARKDOWN.test(text),          detail: MARKDOWN.test(text) ? '마크다운 포함' : null },
    noStageDirection: { pass: !STAGE_DIRECTION.test(text), detail: STAGE_DIRECTION.test(text) ? '지문 표기 포함' : null },
    staysInCharacter: { pass: !AI_SELF_REF.test(text),    detail: AI_SELF_REF.test(text) ? 'AI 자기언급' : null },
    noMidCorrection:  { pass: !CORRECTION.test(text),     detail: CORRECTION.test(text) ? '대화 중 교정' : null },
    notEmpty:      { pass: text.length > 0,               detail: text.length ? null : '빈 응답' },
  };

  const failed = Object.entries(checks).filter(([, v]) => !v.pass).map(([k]) => k);
  return {
    checks,
    sentences,
    failed,
    passRate: (Object.keys(checks).length - failed.length) / Object.keys(checks).length,
    allPass: failed.length === 0,
  };
}

// 바늘 테스트 채점.
//
// 앞 대화에 심어둔 사실을 기억하는지 본다. 판정은 네 가지다.
//   recalled   기대 표현이 있음 → 기억함
//   fabricated 같은 범주의 다른 값을 지어냄 → 모르면서 아는 척
//   askedBack  되물어옴 → 모른다고 인정
//   unclear    아무것도 해당 없음
//
// fabricated 를 따로 두는 이유: 실제로 돌려보니 모델이 "모르겠다"고 하지 않고
// 그럴듯한 값을 지어냈다. 되묻는 것보다 서비스에 훨씬 위험한 실패인데
// 기대 표현만 보면 unclear 로 묻힌다.
export function scoreProbe(reply, probe) {
  const raw = reply ?? '';
  const text = raw.toLowerCase();
  const hit = (list) => (list ?? []).filter(w => text.includes(w.toLowerCase()));

  const recalled = hit(probe.expected);
  const askedBack = hit(probe.forbidden);

  // 같은 범주의 값을 뽑아내서 기대값과 다르면 날조로 본다.
  let fabricated = [];
  if (probe.pattern) {
    const re = new RegExp(probe.pattern.source ?? probe.pattern, probe.patternFlags ?? 'gi');
    const found = [...raw.matchAll(re)].map(m => m[0].trim());
    fabricated = found.filter(f => !(probe.expected ?? []).some(e => f.toLowerCase().includes(e.toLowerCase())));
  }

  let verdict;
  if (recalled.length) verdict = 'recalled';
  else if (fabricated.length) verdict = 'fabricated';
  else if (askedBack.length) verdict = 'askedBack';
  else verdict = 'unclear';

  return { verdict, recalled, fabricated, askedBack };
}
