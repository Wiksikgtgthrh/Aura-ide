import 'server-only'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadProjectFiles } from '@/lib/chat-store'

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
 * (cmd.exe на Windows, sh на Unix — spawn c shell:true).
 */
export function runInProject(chatId: string, dir: string, command: string): TerminalRun {
  if (dockerAvailable()) {
    const name = ensureContainer(chatId, dir)
    const child = spawn('docker', ['exec', name, 'sh', '-lc', command], {
      windowsHide: true,
    })
    return { child, backend: 'docker' }
  }
  const child = spawn(command, {
    cwd: dir,
    shell: true,
    windowsHide: true,
  })
  return { child, backend: 'host' }
}
