import 'server-only'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { loadProjectFiles, syncProjectFiles } from '@/lib/chat-store'

/**
 * Project terminal backends (глобальная обнова, фаза 1-3, первый срез).
 *
 * - Виртуальная ФС проекта материализуется в .aura/projects/<chatId>/
 * - Предпочтительный backend — Docker: ОДИН базовый образ (node:20-alpine),
 *   КОНТЕЙНЕР на проект (aura-term-<chatId>) с bind-mount папки проекта,
 *   ленивый старт, команды через `docker exec`.
 * - Fallback — host-шелл (как терминал VS Code): без изоляции, только для
 *   локального использования владельцем.
 *
 * Дальше по плану: обратный синк изменённых файлов в БД, PTY (ConPTY) +
 * xterm.js, live-превью через dev-сервер в контейнере, запуск команд ИИ
 * с подтверждением.
 */

const BASE_IMAGE = 'node:20-alpine'
/** Никогда не материализуем/не принимаем такие пути. */
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|\.next)(\/|$)/

export function projectDir(chatId: string): string {
  // chatId приходит только после проверки владения; всё равно чистим на
  // всякий случай, чтобы имя папки не могло выйти за пределы .aura/projects.
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, '')
  return resolve(process.cwd(), '.aura', 'projects', safe)
}

/** Экспорт виртуальной ФС (Postgres) на диск перед запуском команды. */
export async function materializeProject(chatId: string): Promise<string> {
  const dir = projectDir(chatId)
  mkdirSync(dir, { recursive: true })
  const files = await loadProjectFiles(chatId)
  for (const [path, content] of Object.entries(files)) {
    if (SKIP_DIRS.test(path) || path.includes('..')) continue
    const full = join(dir, path)
    if (!full.startsWith(dir)) continue
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
  return dir
}

function containerName(chatId: string): string {
  return `aura-term-${chatId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/** Docker CLI доступен и демон отвечает? */
export function dockerAvailable(): boolean {
  try {
    const res = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeout: 5000,
      encoding: 'utf8',
    })
    return res.status === 0 && !!res.stdout?.trim()
  } catch {
    return false
  }
}

/**
 * Контейнер проекта запущен? Если нет — поднимаем (lazy). Возвращает имя.
 * Долгая первая загрузка образа идёт в вывод команды, не сюда.
 */
export function ensureContainer(chatId: string, dir: string): string {
  const name = containerName(chatId)
  const running = spawnSync(
    'docker',
    ['ps', '-q', '--filter', `name=^/${name}$`],
    { timeout: 8000, encoding: 'utf8' },
  )
  if (running.status === 0 && running.stdout.trim()) return name
  // Существует, но остановлен → start; иначе run.
  const exists = spawnSync(
    'docker',
    ['ps', '-aq', '--filter', `name=^/${name}$`],
    { timeout: 8000, encoding: 'utf8' },
  )
  if (exists.status === 0 && exists.stdout.trim()) {
    spawnSync('docker', ['start', name], { timeout: 20000 })
    return name
  }
  spawnSync(
    'docker',
    [
      'run', '-d', '--name', name,
      '-v', `${dir}:/workspace`,
      '-w', '/workspace',
      '--memory', '1g',
      '--cpus', '1',
      BASE_IMAGE,
      'sleep', 'infinity',
    ],
    // Первый запуск может тянуть образ — даём время.
    { timeout: 300_000 },
  )
  return name
}

export type TerminalRun = {
  child: ReturnType<typeof spawn>
  backend: 'docker' | 'host'
}

/**
 * Запуск команды в проекте. Docker при наличии, иначе host-шелл
 * (cmd.exe на Windows, sh на Unix — spawn c shell:true). FORCE_COLOR даёт
 * цветной вывод даже без TTY (npm/vite/eslint это уважают).
 */
export function runInProject(chatId: string, dir: string, command: string): TerminalRun {
  if (dockerAvailable()) {
    const name = ensureContainer(chatId, dir)
    const child = spawn(
      'docker',
      ['exec', '-e', 'FORCE_COLOR=1', '-e', 'CI=1', name, 'sh', '-lc', command],
      { windowsHide: true },
    )
    return { child, backend: 'docker' }
  }
  const child = spawn(command, {
    cwd: dir,
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  return { child, backend: 'host' }
}

// ---- Обратный синк: диск → БД/редактор -------------------------------------

/** Каталоги, которые НИКОГДА не тянем обратно (тяжёлые/производные). */
const SYNC_SKIP =
  /(^|[/\\])(node_modules|\.git|dist|\.next|\.turbo|coverage|\.cache|build|out)([/\\]|$)/
const MAX_SYNC_FILES = 400
const MAX_FILE_BYTES = 200_000

function walk(dir: string, base: string, acc: Record<string, string>) {
  if (Object.keys(acc).length >= MAX_SYNC_FILES) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    const rel = relative(base, full).split(sep).join('/')
    if (SYNC_SKIP.test(rel) || rel.includes('..')) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, base, acc)
    } else if (st.isFile() && st.size <= MAX_FILE_BYTES) {
      try {
        acc[rel] = readFileSync(full, 'utf8')
      } catch {
        /* бинарный/нечитаемый — пропускаем */
      }
    }
    if (Object.keys(acc).length >= MAX_SYNC_FILES) return
  }
}

/**
 * Импорт изменений с диска обратно в постоянную ФС (БД). Возвращает актуальную
 * карту исходников проекта (без node_modules и пр.) — клиент обновляет ею
 * редактор после команды вроде `npm install` / генерации файлов.
 */
export async function importProjectFromDisk(
  chatId: string,
): Promise<Record<string, string>> {
  const dir = projectDir(chatId)
  const files: Record<string, string> = {}
  walk(dir, dir, files)
  if (Object.keys(files).length > 0) {
    await syncProjectFiles(chatId, files)
  }
  return files
}

// ---- Live-превью: dev-сервер проекта ---------------------------------------

type DevServer = {
  child: ChildProcess
  port: number
  backend: 'docker' | 'host'
  startedAt: number
}
// Живёт на уровне модуля — для локального (single-process) dev-сервера Next
// этого достаточно; в serverless-проде состояние не сохраняется (там и не
// применимо — терминал/превью локальный инструмент).
const devServers = new Map<string, DevServer>()

/** Детерминированный порт хоста для проекта: 42000–42999. */
export function devPortFor(chatId: string): number {
  const h = createHash('sha1').update(chatId).digest()
  return 42000 + (h.readUInt16BE(0) % 1000)
}

export function getDevServer(chatId: string): { url: string } | null {
  const s = devServers.get(chatId)
  if (!s) return null
  return { url: `http://localhost:${s.port}` }
}

/**
 * Поднять dev-сервер проекта (Vite/Next и т.п.). В Docker контейнер
 * пересоздаётся С ПУБЛИКАЦИЕЙ порта (running-контейнеру порт не добавить),
 * в host — просто npm-скрипт с прокинутым PORT. Идемпотентно.
 */
export async function startDevServer(
  chatId: string,
  script = 'dev',
): Promise<{ url: string }> {
  const existing = devServers.get(chatId)
  if (existing) return { url: `http://localhost:${existing.port}` }

  const dir = await materializeProject(chatId)
  const port = devPortFor(chatId)
  let child: ChildProcess
  let backend: 'docker' | 'host'

  if (dockerAvailable()) {
    backend = 'docker'
    const name = containerName(chatId)
    // Порт публикуется при создании — пересоздаём одноразовый dev-контейнер.
    spawnSync('docker', ['rm', '-f', `${name}-dev`], { timeout: 20000 })
    child = spawn(
      'docker',
      [
        'run', '--rm', '--name', `${name}-dev`,
        '-v', `${dir}:/workspace`, '-w', '/workspace',
        '-p', `${port}:${port}`,
        '-e', `PORT=${port}`, '-e', 'HOST=0.0.0.0', '-e', 'FORCE_COLOR=1',
        '--memory', '1536m', '--cpus', '1.5',
        BASE_IMAGE,
        'sh', '-lc',
        // Vite слушает 0.0.0.0 и заданный порт, чтобы проброс работал.
        `npm run ${script} -- --host 0.0.0.0 --port ${port} 2>&1 || npm run ${script} 2>&1`,
      ],
      { windowsHide: true },
    )
  } else {
    backend = 'host'
    child = spawn(`npm run ${script}`, {
      cwd: dir,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PORT: String(port), FORCE_COLOR: '1' },
    })
  }

  const server: DevServer = { child, port, backend, startedAt: Date.now() }
  devServers.set(chatId, server)
  child.on('exit', () => {
    if (devServers.get(chatId) === server) devServers.delete(chatId)
  })
  return { url: `http://localhost:${port}` }
}

export function stopDevServer(chatId: string): void {
  const s = devServers.get(chatId)
  if (!s) return
  devServers.delete(chatId)
  try {
    s.child.kill()
  } catch {}
  if (s.backend === 'docker') {
    spawnSync('docker', ['rm', '-f', `${containerName(chatId)}-dev`], { timeout: 20000 })
  }
}

/** Attach a dev-server's stdout/stderr to a sink (for the live log). */
export function pipeDevServer(chatId: string, onData: (s: string) => void): (() => void) | null {
  const s = devServers.get(chatId)
  if (!s) return null
  const listener = (d: Buffer) => onData(d.toString('utf8'))
  s.child.stdout?.on('data', listener)
  s.child.stderr?.on('data', listener)
  return () => {
    s.child.stdout?.off('data', listener)
    s.child.stderr?.off('data', listener)
  }
}

// ---- Idle-остановка контейнеров + очистка ----------------------------------

const lastUse = new Map<string, number>()
export function touchProject(chatId: string): void {
  lastUse.set(chatId, Date.now())
}

/** Остановить рабочий контейнер проекта (не dev-сервер). */
export function stopContainer(chatId: string): void {
  if (!dockerAvailable()) return
  spawnSync('docker', ['rm', '-f', containerName(chatId)], { timeout: 20000 })
}

let sweeper: ReturnType<typeof setInterval> | null = null
/** Фоновая метёлка: контейнеры/сессии, простаивающие >15 мин, гасятся. */
export function ensureIdleSweeper(): void {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    const IDLE = 15 * 60_000
    for (const [chatId, ts] of lastUse) {
      if (now - ts > IDLE) {
        stopContainer(chatId)
        stopDevServer(chatId)
        lastUse.delete(chatId)
      }
    }
  }, 5 * 60_000)
  // Не держим процесс из-за таймера.
  ;(sweeper as unknown as { unref?: () => void }).unref?.()
}
