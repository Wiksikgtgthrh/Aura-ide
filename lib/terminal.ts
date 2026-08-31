import 'server-only'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { loadProjectFiles, syncProjectFiles } from '@/lib/chat-store'
import { scaffoldProject } from '@/lib/project-scaffold'
import { getLimits, DEFAULT_LIMITS, type PlatformLimits } from '@/lib/platform-settings'

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

/**
 * Экспорт виртуальной ФС (Postgres) на диск перед запуском команды.
 *
 * По умолчанию проект достраивается до настоящего Vite-проекта (scaffold:
 * package.json, vite.config, index.html, main.tsx, tailwind…), если этих
 * файлов ещё нет. Без этого `npm install` / `npm run dev` не запустятся — у
 * чат-проектов есть только src/*.tsx. Достроенные файлы затем вернутся в
 * редактор обратным синком (получается настоящий проект).
 */
export async function materializeProject(
  chatId: string,
  scaffold = true,
): Promise<string> {
  const dir = projectDir(chatId)
  mkdirSync(dir, { recursive: true })
  const raw = await loadProjectFiles(chatId)
  const files = scaffold
    ? scaffoldProject(raw, { name: `aura-${chatId.slice(0, 8)}` })
    : raw
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

export type DockerStatus = 'ready' | 'daemon-down' | 'absent'

// Детект Docker дорогой (запуск subprocess) — кэшируем на 20с, чтобы не гонять
// его на каждую команду. Отрицательный результат тоже кэшируется ненадолго,
// поэтому после старта Docker Desktop движок подхватится максимум через 20с.
let dockerCache: { status: DockerStatus; at: number } | null = null

export function dockerStatus(): DockerStatus {
  if (dockerCache && Date.now() - dockerCache.at < 20_000) return dockerCache.status
  let status: DockerStatus = 'absent'
  try {
    // Клиент установлен? (`docker --version` не требует демона).
    const client = spawnSync('docker', ['--version'], { timeout: 5000, encoding: 'utf8' })
    if (client.status === 0 && /docker/i.test(client.stdout || '')) {
      // Демон отвечает? `docker info` обращается к движку.
      const server = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
        timeout: 10_000,
        encoding: 'utf8',
      })
      status = server.status === 0 && !!server.stdout?.trim() ? 'ready' : 'daemon-down'
    }
  } catch {
    status = 'absent'
  }
  dockerCache = { status, at: Date.now() }
  return status
}

/** Docker CLI доступен И демон отвечает? */
export function dockerAvailable(): boolean {
  return dockerStatus() === 'ready'
}

/**
 * Контейнер проекта запущен? Если нет — поднимаем (lazy). Возвращает имя.
 * Долгая первая загрузка образа идёт в вывод команды, не сюда.
 */
export function ensureContainer(
  chatId: string,
  dir: string,
  limits: PlatformLimits = DEFAULT_LIMITS,
): string {
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
      // Resource caps from the admin Limits tab (per-user container).
      '--memory', `${limits.dockerMemoryMb}m`,
      '--cpus', String(limits.dockerCpus),
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
export function runInProject(
  chatId: string,
  dir: string,
  command: string,
  limits: PlatformLimits = DEFAULT_LIMITS,
): TerminalRun {
  if (dockerAvailable()) {
    const name = ensureContainer(chatId, dir, limits)
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
  const limits = await getLimits()
  const port = devPortFor(chatId)
  let child: ChildProcess
  let backend: 'docker' | 'host'

  if (dockerAvailable()) {
    backend = 'docker'
    const name = containerName(chatId)
    // Порт публикуется при создании — пересоздаём одноразовый dev-контейнер.
    spawnSync('docker', ['rm', '-f', `${name}-dev`], { timeout: 20000 })
    // Dev-серверу нужно чуть больше памяти под сборку, чем терминалу.
    const devMemMb = Math.max(limits.dockerMemoryMb, 1024) + 512
    child = spawn(
      'docker',
      [
        'run', '--rm', '--name', `${name}-dev`,
        '-v', `${dir}:/workspace`, '-w', '/workspace',
        '-p', `${port}:${port}`,
        '-e', `PORT=${port}`, '-e', 'HOST=0.0.0.0', '-e', 'FORCE_COLOR=1',
        '--memory', `${devMemMb}m`, '--cpus', String(Math.max(limits.dockerCpus, 1)),
        BASE_IMAGE,
        'sh', '-lc',
        // Ставим зависимости (если нет node_modules), затем запускаем dev на
        // 0.0.0.0:PORT, чтобы проброс порта работал.
        `[ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error; ` +
          `npm run ${script} -- --host 0.0.0.0 --port ${port}`,
      ],
      { windowsHide: true },
    )
  } else {
    backend = 'host'
    child = spawn(
      `npm install --no-audit --no-fund --loglevel=error && npm run ${script} -- --host 0.0.0.0 --port ${port}`,
      {
        cwd: dir,
        shell: true,
        windowsHide: true,
        env: { ...process.env, PORT: String(port), FORCE_COLOR: '1' },
      },
    )
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

// ---- Admin: live container stats -------------------------------------------

export type ContainerStat = {
  name: string
  chatId: string | null
  cpuPerc: string
  memUsage: string
  memPerc: string
}

/** `docker stats --no-stream` for all aura-* containers (admin overview). */
export function dockerContainerStats(): ContainerStat[] {
  if (!dockerAvailable()) return []
  try {
    const res = spawnSync(
      'docker',
      [
        'stats', '--no-stream', '--format',
        '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}',
      ],
      { timeout: 12_000, encoding: 'utf8' },
    )
    if (res.status !== 0 || !res.stdout) return []
    return res.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('\t'))
      .filter((p) => p[0]?.startsWith('aura-term-'))
      .map(([name, cpuPerc, memUsage, memPerc]) => {
        const m = name.match(/^aura-term-([a-zA-Z0-9_-]+?)(?:-dev)?$/)
        return {
          name,
          chatId: m?.[1] ?? null,
          cpuPerc: cpuPerc ?? '0%',
          memUsage: memUsage ?? '—',
          memPerc: memPerc ?? '0%',
        }
      })
  } catch {
    return []
  }
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
