import { newRecord } from './record.js';
import { buildMessages, needsCompaction, splitForCompaction, droppedTurns } from './conversation.js';
import { chat, chatStream, summarize, MODELS, provider } from './llm.js';
import { SYSTEM_PROMPT, scenarioMessage } from './prompt.js';

// 메시지 조립.
// SYSTEM_PROMPT 가 항상 첫 블록이고 모든 요청에서 동일하다 -> 캐시 프리픽스.
// 시나리오는 그 뒤에 별도 메시지로 둔다 (블록 안에 넣으면 시나리오마다 프리픽스가 달라진다).
function assemble({ scenario, history, strategy, windowSize, summary }) {
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (scenario) msgs.push({ role: 'system', content: scenarioMessage(scenario) });
  msgs.push(...buildMessages({ history, strategy, windowSize, summary }));
  return msgs;
}

export async function handleChat(body, { onDelta } = {}) {
  const rec = newRecord();
  try {
    const {
      scenarioId, scenario, history = [], message,
      strategy = process.env.HISTORY_STRATEGY ?? 'full',
      summary: incomingSummary = null,
      stream = false,
      model = MODELS.light,
    } = body;

    if (!message) {
      rec.finish({ error: 'message required' });
      return { status: 400, body: { error: 'message required' } };
    }

    const windowSize = Number(process.env.HISTORY_WINDOW ?? 6);
    const turns = [...history, { role: 'user', content: message }];

    // summary 전략이면 윈도우 밖으로 밀려나는 앞부분을 요약으로 접는다.
    // 이 호출 자체가 토큰과 지연을 쓰므로 따로 잰다.
    let summary = incomingSummary;
    let comp = null;
    if (strategy === 'summary' && needsCompaction(turns, windowSize)) {
      const { old } = splitForCompaction(turns, windowSize);
      comp = await summarize({
        turns: old, previousSummary: incomingSummary, model: MODELS.light,
      });
      summary = comp.summary;
    }

    const messages = assemble({ scenario, history: turns, strategy, windowSize, summary });
    const fn = stream ? chatStream : chat;
    const out = await fn({ messages, model, onDelta });

    const dropped = strategy === 'full' ? 0 : droppedTurns(turns, windowSize);

    rec.finish({
      scenarioId: scenarioId ?? null,
      turnIndex: turns.length,
      historyStrategy: strategy,
      historyTurns: turns.length,
      provider: provider(),
      model: out.model,
      stream: out.stream,
      inputTokens: out.inputTokens,
      cachedTokens: out.cachedTokens,
      outputTokens: out.outputTokens,
      reasoningTokens: out.reasoningTokens,
      truncated: out.truncated,
      compactionCalls: comp ? 1 : 0,
      compactionMs: comp?.compactionMs ?? null,
      compactionInputTokens: comp?.compactionInputTokens ?? null,
      compactionOutputTokens: comp?.compactionOutputTokens ?? null,
      compactionReasoningTokens: comp?.compactionReasoningTokens ?? null,
      compactionEmpty: comp ? comp.compactionEmpty : null,
      droppedTurns: dropped,
      ttftMs: out.ttftMs,
      llmLatencyMs: out.llmLatencyMs,
    });

    return {
      status: 200,
      body: {
        reply: out.text,
        history: [...turns, { role: 'assistant', content: out.text }],
        summary,                      // 클라이언트가 다음 요청에 되돌려준다 (서버 무상태 유지)
        metrics: {
          provider: provider(),
          model: out.model,
          strategy,
          inputTokens: out.inputTokens,
          cachedTokens: out.cachedTokens,
          outputTokens: out.outputTokens,
          compactionInputTokens: comp?.compactionInputTokens ?? null,
          compactionOutputTokens: comp?.compactionOutputTokens ?? null,
          compactionMs: comp?.compactionMs ?? null,
          compactionReasoningTokens: comp?.compactionReasoningTokens ?? null,
          compactionEmpty: comp ? comp.compactionEmpty : null,
          reasoningTokens: out.reasoningTokens,
          truncated: out.truncated,
          droppedTurns: dropped,
          ttftMs: out.ttftMs,
          llmLatencyMs: out.llmLatencyMs,
        },
      },
    };
  } catch (err) {
    rec.finish({ error: String(err?.message ?? err) });
    console.error(err);
    return { status: 500, body: { error: 'internal error' } };
  }
}
