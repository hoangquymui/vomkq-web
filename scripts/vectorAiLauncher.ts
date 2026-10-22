import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Connect, Plugin } from 'vite'

// Local service startup only: no model download, inference, or arbitrary shell commands.
const START_PATH = '/__vector-ai/start'
// Allow cold Python/Ollama startup for up to 60 s per service; probes take at most 2 s.
const START_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 2_000
const POLL_INTERVAL_MS = 500
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

interface Service {
  name: string
  port: number
  healthPath: string
  ready: (body: Record<string, unknown>) => boolean
  command: () => { executable: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }
}

async function isReady(service: Service): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${service.port}${service.healthPath}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const body: unknown = await response.json()
    return response.ok && body !== null && typeof body === 'object'
      && service.ready(body as Record<string, unknown>)
  } catch {
    return false
  }
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (open: boolean) => { socket.destroy(); done(open) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false))
  })
}

function isLocalRequest(request: IncomingMessage): boolean {
  if (!LOCAL_ADDRESSES.has(request.socket.remoteAddress ?? '')) return false
  if (request.headers['x-vector-ai-start'] !== '1') return false
  try {
    const destination = new URL(`http://${request.headers.host}`)
    if (!LOCAL_HOSTS.has(destination.hostname)) return false
    const origin = request.headers.origin
    return !origin || origin === destination.origin
  } catch {
    return false
  }
}

/** Used by both `npm run dev` and `npm run preview` on this Windows workstation. */
export function vectorAiLauncher(): Plugin {
  let projectRoot = ''
  let pending: Promise<void> | undefined
  const children = new Map<string, { child: ChildProcess; error?: Error; logPath: string }>()

  async function ensureService(service: Service): Promise<void> {
    if (await isReady(service)) return
    let owned = children.get(service.name)
    const alive = owned && !owned.error && owned.child.exitCode === null && owned.child.signalCode === null
    // An occupied port may belong to another app or a service still starting. Never replace it.
    if (!alive && !(await portIsOpen(service.port))) {
      const { executable, args, cwd, env } = service.command()
      const logDir = join(projectRoot, 'node_modules', '.cache', 'vector-ai-launcher')
      mkdirSync(logDir, { recursive: true })
      const logPath = join(logDir, `${service.name}.log`)
      const log = openSync(logPath, 'a')
      try {
        const child = spawn(executable, args, {
          cwd, env: { ...process.env, ...env }, shell: false,
          // `detached: true` ở đây là NGUYÊN NHÂN cửa sổ cmd hiện lên.
          //
          // Cơ chế Windows: `child_process.spawn` dịh `detached` thành cờ
          // DETACHED_PROCESS, còn `windowsHide` thành CREATE_NO_WINDOW. Tài liệu
          // CreateProcess nói rõ CREATE_NO_WINDOW BỊ BỎ QUA khi dùng chung với
          // DETACHED_PROCESS — cờ trước thắng. Vậy `detached: true` khiến
          // `windowsHide: true` trở thành vô nghĩa, và mọi tiến trình con đều mở
          // cửa sổ console thật.
          //
          // Vì sao vẫn cần `detached` về mặt kỹ thuật: nó tạo process group
          // riêng. Ta thay bằng `windowsHide: true` + không `unref()`; Node giữ
          // handle tới để không bị rò rỉ, còn tiến trình vẫn sống độc lập nhờ
          // `stdio` trỏ thẳng ra file log.
          windowsHide: true,
          stdio: ['ignore', log, log],
        })
        owned = { child, logPath }
        children.set(service.name, owned)
        const record = owned
        child.once('error', (error) => { record.error = error })
        child.once('exit', (code, signal) => {
          console.warn(`[VECTOR AI launcher] ${service.name} đã dừng: code=${code}, signal=${signal}. Log: ${logPath}`)
        })
      } finally {
        closeSync(log)
      }
    }

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await isReady(service)) return
      if (owned?.error || (owned && (owned.child.exitCode !== null || owned.child.signalCode !== null))) {
        throw new Error(`Không khởi động được ${service.name}. ${owned.error?.message ?? `Tiến trình đã dừng (mã ${owned.child.exitCode}).`} Xem log: ${owned.logPath}`)
      }
      await delay(POLL_INTERVAL_MS)
    }
    throw new Error(`${service.name} chưa sẵn sàng sau 60 giây. Kiểm tra cổng ${service.port}${owned ? ` và log ${owned.logPath}` : ' đang được tiến trình khác sử dụng'}.`)
  }

  function ensureStarted(): Promise<void> {
    if (pending) return pending
    // VECTOR AI now ships inside this repository as `ai-core/`, so the app is
    // self-contained: no sibling `VECTOR AI` folder and no %LOCALAPPDATA% state
    // are required to run the local assistant.
    const vectorRoot = join(projectRoot, 'ai-core')
    const backendRoot = join(vectorRoot, 'backend')
    const dataRoot = join(vectorRoot, 'data')
    const services: Service[] = [
      {
        name: 'Ollama', port: 11434, healthPath: '/api/tags',
        ready: (body) => Array.isArray(body.models),
        command: () => {
          const installed = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe')
          // A prepared portable bundle inside ai-core/runtime keeps the assistant
          // working on machines that never installed Ollama Desktop.
          let executable = existsSync(installed) ? installed : ''
          if (!executable) {
            try {
              const active = JSON.parse(readFileSync(join(vectorRoot, 'runtime', 'active.json'), 'utf8')) as { bundle: string }
              const bundled = join(vectorRoot, 'runtime', active.bundle, 'ollama', 'ollama.exe')
              if (existsSync(bundled)) executable = bundled
            } catch { /* The error below covers a missing Ollama runtime. */ }
          }
          if (!executable) throw new Error(`Không tìm thấy Ollama. Cài Ollama Desktop hoặc chuẩn bị runtime trong ${vectorRoot}.`)
          return {
            executable, args: ['serve'], cwd: vectorRoot,
            env: { OLLAMA_HOST: '127.0.0.1:11434' },
          }
        },
      },
      {
        name: 'VECTOR-AI', port: 8000, healthPath: '/api/v1/health',
        ready: (body) => body.status === 'ready' && body.address === '127.0.0.1:8000',
        command: () => {
          let executable = join(backendRoot, '.venv', 'Scripts', 'python.exe')
          // A prepared portable project may have its Python environment in runtime/ instead.
          if (!existsSync(executable)) {
            try {
              const active = JSON.parse(readFileSync(join(vectorRoot, 'runtime', 'active.json'), 'utf8')) as { bundle: string }
              executable = join(vectorRoot, 'runtime', active.bundle, 'python', 'python.exe')
            } catch { /* The explicit missing-runtime error below covers this case. */ }
          }
          if (!existsSync(executable)) {
            throw new Error(`Không tìm thấy Python của VECTOR AI trong ${backendRoot}. Hãy chuẩn bị môi trường backend trước.`)
          }
          return {
            executable, args: ['-m', 'vector_ai_backend'], cwd: backendRoot,
            env: {
              PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1',
              VECTOR_AI_HOST: '127.0.0.1', VECTOR_AI_PORT: '8000',
              // Point every path the backend writes (sqlite state, knowledge
              // documents, workflow checkpoints, backups) at `ai-core/data` so
              // the whole assistant state travels with this folder.
              VECTOR_AI_PROJECT_DIR: vectorRoot,
              VECTOR_AI_DATA_DIR: dataRoot,
              // This backend runs independently, not under a Tauri parent watchdog.
              VECTOR_AI_INSTANCE_TOKEN: '', VECTOR_AI_PARENT_PID: '',
            },
          }
        },
      },
    ]
    pending = Promise.allSettled(services.map(ensureService)).then((results) => {
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }).finally(() => { pending = undefined })
    return pending
  }

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== START_PATH) return next()
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'POST') {
      response.statusCode = 405
      response.setHeader('Allow', 'POST')
      response.end(JSON.stringify({ message: 'Chỉ hỗ trợ POST.' }))
      return
    }
    if (!isLocalRequest(request)) {
      response.statusCode = 403
      response.end(JSON.stringify({ message: 'Chỉ khởi động VECTOR AI từ ứng dụng trên máy này.' }))
      return
    }
    void ensureStarted().then(() => {
      response.end(JSON.stringify({ status: 'ready' }))
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[VECTOR AI launcher]', message)
      response.statusCode = 503
      response.end(JSON.stringify({ message }))
    })
  }

  /**
   * Dừng các tiến trình mà launcher thực sự đã khởi chạy.
   *
   * VÌ SAO CẦN SAU KHI BỎ `detached`: trước đó ta gọi `child.unref()` để Node
   * không chờ, nên `npm run dev` thoát ngay. Bỏ `unref()` thì Node giữ handle tới
   * Ollama/Python và sẽ treo — Ctrl+C không ăn. Ở đây ta dọn ở `closeBundle`
   * (build) và `closeWatcher` (dev/preview) để vòng đời vẫn kết thúc đúng.
   *
   * Tiến trình đã chạy sẵn từ trước (Vite lần trước bật, hoặc người dùng tự mở)
   * KHÔNG nằm trong `children` nên không bị kill — đó là chủ ý, không phải sự cố.
   */
  function stopOwnedChildren(): void {
    for (const [name, record] of children) {
      if (record.child.exitCode !== null || record.child.signalCode !== null) continue
      try {
        // Ollama tự tắt server; Python cần tín hiệu kết thúc để dọn tài nguyên.
        if (name === 'Ollama') record.child.kill()
        else record.child.kill('SIGTERM')
      } catch (error) {
        console.warn(`[VECTOR AI launcher] Không dừng được ${name}:`, error)
      }
    }
    children.clear()
  }

  return {
    name: 'vector-ai-local-launcher',
    configResolved(config) { projectRoot = config.root },
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
    closeBundle() { stopOwnedChildren() },
    closeWatcher() { stopOwnedChildren() },
  }
}
