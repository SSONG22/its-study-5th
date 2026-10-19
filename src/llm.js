import OpenAI from 'openai';

// 지연 생성. 모듈 로드 시점에 만들면 키가 없을 때 서버가 기동조차 못 한다.
// 키가 없어도 UI 와 /api/scenarios 는 떠야 한다.
//
// OPENAI_BASE_URL 을 바꾸면 OpenAI 호환 엔드포인트를 그대로 쓸 수 있다.
// Groq, Gemini, Ollama, OpenRouter 가 모두 OpenAI 스펙을 따른다.
// 공급자마다 usage 보고 범위가 달라서, 캐싱 실험은 공급자를 가린다 (아래 cachedOf 참고).
let _client;
function client() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다');
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return _client;
}

// 어느 공급자인지 레코드에 남긴다. 나중에 공급자별 비교를 할 때 기준이 된다.
export function provider() {
  const u = process.env.OPENAI_BASE_URL;
  if (!u) return 'openai';
  if (u.includes('groq.com')) return 'groq';
  if (u.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('localhost') || u.includes('127.0.0.1')) return 'local';
  return u;
}

// 캐시 토큰 판독.
//   숫자  공급자가 보고함 (0 이면 보고했는데 미적중)
//   null  공급자가 아예 보고하지 않음 (= 캐싱 측정 불가)
// 이 둘을 0 으로 뭉뚱그리면 "캐시가 안 걸렸다" 와 "잴 수 없다" 를 구분 못 한다.
function cachedOf(usage) {
  const d = usage?.prompt_tokens_details;
  if (!d) return null;
  return d.cached_tokens ?? 0;
}

export const MODELS = {
  // 주력. 캐시 할인 90%
  light: process.env.OPENAI_MODEL ?? 'gpt-6-luna',
  // 라우팅 실험용 상위 모델
  heavy: process.env.OPENAI_MODEL_HEAVY ?? 'gpt-6-sol',
  // 캐시 할인율 비교축. 같은 캐싱이라도 이 모델은 75% 만 할인된다
  legacy: process.env.OPENAI_MODEL_LEGACY ?? 'gpt-4.1-mini',
};

// 논스트리밍. 전체 지연과 토큰 사용량을 잰다.
export async function chat({ messages, model, maxTokens = 300 }) {
  const t0 = performance.now();
  const res = await client().chat.completions.create({ model, messages, max_tokens: maxTokens });
  const u = res.usage ?? {};
  return {
    text: res.choices[0]?.message?.content ?? '',
    model: res.model,
    stream: false,
    ttftMs: null,
    llmLatencyMs: Math.round(performance.now() - t0),
    inputTokens: u.prompt_tokens ?? null,
    cachedTokens: cachedOf(u),
    outputTokens: u.completion_tokens ?? null,
  };
}

// 스트리밍. TTFT(첫 토큰까지)를 잰다.
// 체감 지연과 실제 지연의 차이를 보여주는 것이 7주차 실험의 핵심이다.
// onDelta 로 조각을 흘려보내면서 동시에 전체 텍스트를 모은다.
export async function chatStream({ messages, model, maxTokens = 300, onDelta }) {
  const t0 = performance.now();
  let ttftMs = null;
  let text = '';

  const stream = await client().chat.completions.create({
    model, messages, max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true }, // 마지막 청크에 usage 가 실린다
  });

  let usage = {};
  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (!delta) continue;
    if (ttftMs === null) ttftMs = Math.round(performance.now() - t0);
    text += delta;
    onDelta?.(delta);
  }

  return {
    text,
    model,
    stream: true,
    ttftMs,
    llmLatencyMs: Math.round(performance.now() - t0),
    inputTokens: usage.prompt_tokens ?? null,
    cachedTokens: cachedOf(usage),
    outputTokens: usage.completion_tokens ?? null,
  };
}
