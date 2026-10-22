/**
 * Harness kiểm chứng runtime cho `src/services/vectorAiClient.ts` bằng một HTTP server giả
 * đóng đúng hợp đồng của backend VECTOR AI (POST /api/v1/runs + SSE /api/v1/runs/{id}/events).
 *
 * Chạy:
 *   npx esbuild docs/verify-vector-ai-client.ts --bundle --platform=node --format=esm \
 *     --define:import.meta.env='{"VITE_VECTOR_AI_URL":"http://127.0.0.1:8765"}' \
 *     --outfile=docs/.verify-ai-client.mjs && node docs/.verify-ai-client.mjs
 */
import { createServer } from 'node:http';
import {
  checkVectorAiHealth,
  listVectorAiModels,
  askVectorAi,
} from '../src/services/vectorAiClient';

let failures = 0;
const runPayloads: Array<{ strict_sources?: unknown }> = [];
function check(name: string, condition: boolean, detail: unknown) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${name} ::`, JSON.stringify(detail));
}

/** Kịch bản SSE được chọn qua query của URL sự kiện */
function sseBody(scenario: string): string {
  const ev = (type: string, data: unknown) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  if (scenario === 'deltas-then-final') {
    return (
      ev('started', { type: 'started', run_id: 'r1' }) +
      ev('delta', { type: 'delta', data: { content: 'Xin ' } }) +
      ev('delta', { type: 'delta', data: { content: 'chào ' } }) +
      ev('delta', { type: 'delta', data: { content: 'ngắn' } }) +
      // final_content dài hơn phần delta đã ghép -> client phải ưu tiên bản chuẩn này
      ev('completed', { type: 'completed', data: { final_content: 'Xin chào thế giới' } })
    );
  }
  if (scenario === 'deltas-only') {
    return (
      ev('delta', { type: 'delta', data: { content: '{"summary":' } }) +
      ev('delta', { type: 'delta', data: { content: '"ok","suggestions":[],"route":[]}' } }) +
      ev('completed', { type: 'completed', data: { final_content: '' } })
    );
  }
  if (scenario === 'stream-error') {
    return (
      ev('delta', { type: 'delta', data: { content: 'một phần' } }) +
      ev('error', { type: 'error', message: 'model lỗi giữa luồng' })
    );
  }
  if (scenario === 'eof') return ev('delta', { type: 'delta', data: { content: 'dang dở' } });
  if (scenario === 'truncated') return ev('completed', { type: 'completed', data: { final_content: 'bị cắt', truncated: true } });
  if (scenario === 'metadata') return ev('sources', { type: 'sources', data: { sources: [{ id: 'source-1' }] } })
    + ev('usage', { type: 'usage', data: { total_tokens: 12 } })
    + ev('completed', { type: 'completed', data: { final_content: 'có nguồn' } });
  return ev('completed', { type: 'completed', data: { final_content: '' } });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:8765');

  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready', address: '127.0.0.1:8765' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'qwen-test:latest' }, { model: 'llama-test:latest' }] }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/runs') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let scenario = 'deltas-then-final';
      try {
        const parsed = JSON.parse(body) as { mode?: string; scope?: unknown; strict_sources?: unknown };
        runPayloads.push(parsed);
        // Nhét kịch bản qua chính nội dung user message để test gọn
        const messages = (JSON.parse(body) as { messages?: Array<{ content?: string }> }).messages;
        const marker = messages?.[0]?.content ?? '';
        if (marker.includes('SCENARIO=deltas-only')) scenario = 'deltas-only';
        if (marker.includes('SCENARIO=stream-error')) scenario = 'stream-error';
        if (marker.includes('SCENARIO=eof')) scenario = 'eof';
        if (marker.includes('SCENARIO=truncated')) scenario = 'truncated';
        if (marker.includes('SCENARIO=metadata')) scenario = 'metadata';
        void parsed;
      } catch {
        // ignore
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ run_id: `run-${scenario}` }));
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/v1/runs/')) {
    const parts = url.pathname.split('/');
    const runId = parts[parts.length - 2] ?? '';
    const scenario = runId.replace(/^run-/, '');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    // Gửi từng khối, ngắt quãng nhẹ để mô phỏng stream thật
    const blocks = sseBody(scenario).split('\n\n').filter((b) => b.length > 0);
    let i = 0;
    const timer = setInterval(() => {
      if (i >= blocks.length) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(blocks[i] + '\n\n');
      i++;
    }, 5);
    return;
  }

  res.writeHead(404);
  res.end();
});

await new Promise<void>((resolve) => server.listen(8765, '127.0.0.1', resolve));

try {
  // 1. health + models (đường dẫn thành công)
  const health = await checkVectorAiHealth();
  check('health OK', health.ok && health.value.status === 'ready', health.ok ? health.value.status : health.error);

  const models = await listVectorAiModels();
  check(
    'models OK (đọc cả name lẫn model)',
    models.ok && models.value.length === 2 && models.value[0] === 'qwen-test:latest' && models.value[1] === 'llama-test:latest',
    models.ok ? models.value : models.error
  );

  // 2. SSE: ưu tiên final_content
  const first = await askVectorAi({
    model: 'qwen-test:latest',
    messages: [{ role: 'user', content: 'SCENARIO=deltas-then-final' }],
  });
  check('SSE hợp nhất final_content', first.ok && first.value.text === 'Xin chào thế giới', first.ok ? first.value : first.error);
  check('SSE trả run_id', first.ok && first.value.runId === 'run-deltas-then-final', first.ok ? first.value.runId : null);
  check('Document requests default to strict_sources=true', runPayloads[0]?.strict_sources === true, runPayloads[0]);

  const groundedCandidates = await askVectorAi({
    model: 'qwen-test:latest',
    messages: [{ role: 'user', content: 'SCENARIO=deltas-then-final' }],
    strictSources: false,
  });
  check('GIS ranking opts into strict_sources=false per request',
    groundedCandidates.ok && runPayloads[1]?.strict_sources === false, runPayloads[1]);

  // 3. SSE: chỉ có delta (final_content rỗng) -> ghép delta
  const second = await askVectorAi({
    model: 'qwen-test:latest',
    messages: [{ role: 'user', content: 'SCENARIO=deltas-only' }],
  });
  check(
    'SSE ghép delta khi final_content rỗng',
    second.ok && second.value.text === '{"summary":"ok","suggestions":[],"route":[]}',
    second.ok ? second.value.text : second.error
  );

  // 4. SSE: event error -> lỗi có kiểu 'stream'
  const third = await askVectorAi({
    model: 'qwen-test:latest',
    messages: [{ role: 'user', content: 'SCENARIO=stream-error' }],
  });
  check('event error -> kind=stream', !third.ok && third.error.kind === 'stream', third.ok ? 'unexpected ok' : third.error);
  const eof = await askVectorAi({ model: 'test', messages: [{ role: 'user', content: 'SCENARIO=eof' }] });
  check('EOF without completed is never success', !eof.ok && eof.error.kind === 'stream', eof);
  const truncated = await askVectorAi({ model: 'test', messages: [{ role: 'user', content: 'SCENARIO=truncated' }] });
  check('Truncation flag survives transport', truncated.ok && truncated.value.truncated === true, truncated);
  const metadata = await askVectorAi({ model: 'test', messages: [{ role: 'user', content: 'SCENARIO=metadata' }] });
  check('Sources and usage survive transport', metadata.ok && metadata.value.sources?.length === 1 && metadata.value.usage?.total_tokens === 12, metadata);

  // 5. Model rỗng -> lỗi 'parse', không ném
  const noModel = await askVectorAi({ model: '', messages: [{ role: 'user', content: 'x' }] });
  check('thiếu model -> kind=parse', !noModel.ok && noModel.error.kind === 'parse', noModel.ok ? 'unexpected ok' : noModel.error);

  // 6. Backend không tồn tại (cổng đóng) -> lỗi 'offline' có kiểu, KHÔNG ném
  const offlineHealth = await fetch('http://127.0.0.1:8799/api/v1/health').catch((e) => e);
  check('fetch tới cổng đóng sẽ ném (đối chứng) -> client phải bắt', offlineHealth instanceof Error, String(offlineHealth));
} finally {
  server.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
