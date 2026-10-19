// 대화 히스토리 전략 — 이 프로젝트의 핵심 손잡이.
// 턴이 쌓일수록 입력 토큰이 선형 증가하는데, 그걸 누르는 세 가지 방법을 비교한다.
//   full    기준선. 전체 히스토리를 매번 보낸다.
//   window  최근 N턴만 보낸다. 토큰은 상수로 수렴하지만 맥락을 잃는다.
//   summary 오래된 턴을 요약으로 압축한다. 토큰은 줄지만 요약 호출 비용이 추가된다.
//
// 시스템 프롬프트는 여기서 다루지 않는다 (handler 가 캐시 프리픽스로 먼저 붙인다).

export const STRATEGIES = ['full', 'window', 'summary'];

export function buildMessages({ history, strategy, windowSize, summary }) {
  if (strategy === 'window') {
    return history.slice(-windowSize);
  }
  if (strategy === 'summary') {
    const out = [];
    if (summary) out.push({ role: 'system', content: `Conversation so far: ${summary}` });
    out.push(...history.slice(-windowSize));
    return out;
  }
  return history; // full
}

// 요약 압축이 필요한 시점인지 판단한다. summary 전략에서만 호출한다.
export function needsCompaction(history, windowSize) {
  return history.length > windowSize * 2;
}
