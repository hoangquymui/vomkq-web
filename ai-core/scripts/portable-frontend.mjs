// The shared source build needs no Rust/Node installation on the receiving PC.
import { createServer } from 'vite';
const server = await createServer({ server: { host:'127.0.0.1', port:3000, strictPort:true } });
await server.listen();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(0), 3000).unref();
  await server.close(); clearTimeout(deadline); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
const parent = Number(process.env.VECTOR_AI_LAUNCHER_PID);
if (Number.isSafeInteger(parent) && parent > 0) setInterval(() => {
  try { process.kill(parent, 0); } catch { stop(); }
}, 2000).unref();
console.log('VECTOR frontend ready on 127.0.0.1:3000');
