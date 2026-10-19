import { newRecord } from './record.js';
import { buildMessages } from './conversation.js';
import { chat, chatStream, MODELS, provider } from './llm.js';
import { SYSTEM_PROMPT, scenarioMessage } from './prompt.js';

// 메시지 조립.
// SYSTEM_PROMPT 가 항상 첫 블록이고 모든 요청에서 동일하다 -> 캐시 프리픽스.
// 시나리오는 그 뒤에 별도 메시지로 둔다.
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
      summary = null,
      stream = false,
      model = MODELS.light,
    } = body;

    if (!message) {
      rec.finish({ error: 'message required' });
      return { status: 400, body: { error: 'message required' } };
    }

    const windowSize = Number(process.env.HISTORY_WINDOW ?? 6);
    const turns = [...history, { role: 'user', content: message }];
    const messages = assemble({ scenario, history: turns, strategy, windowSize, summary });

    const fn = stream ? chatStream : chat;
    const out = await fn({ messages, model, onDelta });

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
      ttftMs: out.ttftMs,
      llmLatencyMs: out.llmLatencyMs,
    });

    return {
      status: 200,
      body: {
        reply: out.text,
        history: [...turns, { role: 'assistant', content: out.text }],
        metrics: {
          provider: provider(),
          model: out.model,
          inputTokens: out.inputTokens,
          cachedTokens: out.cachedTokens,
          outputTokens: out.outputTokens,
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
