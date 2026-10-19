// 로컬 HTTP 서버. 외부 의존 없이 Node 22 내장 모듈만 쓴다.
//   GET  /              채팅 UI
//   GET  /api/scenarios 시나리오 목록
//   POST /api/chat      대화 (stream:true 면 SSE)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleChat } from './handler.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = new URL('../public/', import.meta.url);
const DATASET = new URL('../bench/dataset/scenarios.json', import.meta.url);

const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const readBody = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(new URL('index.html', PUBLIC));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && req.url === '/api/scenarios') {
      const raw = await readFile(DATASET, 'utf8');
      return json(res, 200, JSON.parse(raw));
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await readBody(req);

      if (!body.stream) {
        const out = await handleChat(body);
        return json(res, out.status, out.body);
      }

      // SSE. 첫 토큰이 도착하는 순간부터 흘려보낸다.
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const out = await handleChat(body, { onDelta: d => send('delta', { d }) });
      send(out.status === 200 ? 'done' : 'error', out.body);
      return res.end();
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`English Roleplay  http://localhost:${PORT}`);
  console.log(`모델: ${process.env.OPENAI_MODEL ?? 'gpt-6-luna'}  |  히스토리 전략: ${process.env.HISTORY_STRATEGY ?? 'full'}`);
  console.log(`레코드: runs/${process.env.RUN_LABEL ?? 'dev'}.jsonl`);
  if (!process.env.OPENAI_API_KEY) console.warn('경고: OPENAI_API_KEY 가 설정되지 않았습니다');
});
