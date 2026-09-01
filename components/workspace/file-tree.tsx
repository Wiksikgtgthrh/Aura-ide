'use client'

/**
 * Файловое дерево с иконками, контекстным меню, drag&drop, inline-rename
 * и git-бейджами. Подписывается на watcher извне через `refreshKey`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus,
  FolderPlus,
  Pencil,
  Scissors,
  Trash2,
} from 'lucide-react'
import { iconForFile, iconForFolder } from '@/lib/file-icons'
import {
  fsCreateDir,
  fsCreateFile,
  fsDelete,
  fsRename,
  fsWrite,
  fsRead,
  type FsNode,
} from '@/lib/tauri'
import { ContextMenu, type CtxItem } from './context-menu'

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}
function dirOf(p: string): string {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join('/')
}
function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}
function relPath(root: string, path: string): string {
  const norm = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm.startsWith(r) ? norm.slice(r.length + 1) : norm
}

// Разбор git-status: возвращает буквенный маркер для файла.
export function gitBadge(
  path: string,
  root: string,
  git: Map<string, string>,
): { letter: string; cls: string } | null {
  const rel = relPath(root, path)
  const st = git.get(rel)
  if (!st) return null
  if (st.includes('?')) return { letter: 'U', cls: 'text-green-500' }
  if (st.includes('M')) return { letter: 'M', cls: 'text-amber-500' }
  if (st.includes('D')) return { letter: 'D', cls: 'text-red-500' }
  if (st.includes('A')) return { letter: 'A', cls: 'text-green-500' }
  return null
}

type Props = {
  tree: FsNode[]
  root: string
  git: Map<string, string>
  expanded: Set<string>
  active: string | null
  onToggle: (path: string) => void
  onOpen: (node: FsNode) => void
  onChanged: () => void
  /** Опционально: обновлять пути открытых табов после перемещения. */
  onMoved?: (from: string, to: string) => void
}

export function FileTree({
  tree,
  root,
  git,
  expanded,
  active,
  onToggle,
  onOpen,
  onChanged,
  onMoved,
}: Props) {
  const move = useCallback(
    async (from: string, toDir: string) => {
      const name = baseName(from)
      const to = joinPath(toDir, name)
      if (from === to) return
      try {
        await fsRename(from, to)
        onMoved?.(from, to)
        onChanged()
      } catch (e) {
        alert(`Не удалось переместить: ${(e as Error).message}`)
      }
    },
    [onChanged, onMoved],
  )

  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null)
  const [rename, setRename] = useState<{ path: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ parent: string; kind: 'file' | 'dir'; value: string } | null>(
    null,
  )
  const clipboard = useRef<{ path: string; op: 'copy' | 'cut' } | null>(null)

  const closeMenu = useCallback(() => setMenu(null), [])

  const openContext = useCallback(
    (e: React.MouseEvent, node: FsNode) => {
      e.preventDefault()
      e.stopPropagation()
      const parent = node.is_dir ? node.path : dirOf(node.path)
      const items: CtxItem[] = [
        {
          kind: 'item',
          label: 'Новый файл',
          icon: <FilePlus className="size-3.5" />,
          onClick: () => setCreating({ parent, kind: 'file', value: '' }),
        },
        {
          kind: 'item',
          label: 'Новая папка',
          icon: <FolderPlus className="size-3.5" />,
          onClick: () => setCreating({ parent, kind: 'dir', value: '' }),
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Переименовать',
          icon: <Pencil className="size-3.5" />,
          hint: 'F2',
          onClick: () => setRename({ path: node.path, value: baseName(node.path) }),
        },
        {
          kind: 'item',
          label: 'Копировать путь',
          icon: <Copy className="size-3.5" />,
          onClick: () => {
            void navigator.clipboard?.writeText(node.path).catch(() => {})
          },
        },
        {
          kind: 'item',
          label: 'Копировать относительный путь',
          icon: <Copy className="size-3.5" />,
          onClick: () => {
            void navigator.clipboard?.writeText(relPath(root, node.path)).catch(() => {})
          },
        },
        {
          kind: 'item',
          label: 'Вырезать',
          icon: <Scissors className="size-3.5" />,
          hint: 'Ctrl+X',
          onClick: () => {
            clipboard.current = { path: node.path, op: 'cut' }
          },
        },
        {
          kind: 'item',
          label: 'Копировать',
          icon: <Copy className="size-3.5" />,
          hint: 'Ctrl+C',
          onClick: () => {
            clipboard.current = { path: node.path, op: 'copy' }
          },
        },
      ]
      if (clipboard.current && node.is_dir) {
        items.push({
          kind: 'item',
          label: `Вставить в «${baseName(node.path)}»`,
          icon: <Copy className="size-3.5" />,
          hint: 'Ctrl+V',
          onClick: async () => {
            const src = clipboard.current!
            const dest = joinPath(node.path, baseName(src.path))
            if (src.op === 'cut') {
              await fsRename(src.path, dest).catch(() => {})
              clipboard.current = null
            } else {
              try {
                const content = await fsRead(src.path)
                await fsWrite(dest, content)
              } catch {
                /* попытка вставить директорию — не поддерживается однокомандно */
              }
            }
            onChanged()
          },
        })
      }
      items.push({ kind: 'separator' })
      items.push({
        kind: 'item',
        label: 'Удалить',
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        hint: 'Del',
        onClick: async () => {
          if (!confirm(`Удалить ${node.is_dir ? 'папку' : 'файл'} ${baseName(node.path)}?`)) return
          await fsDelete(node.path).catch(() => {})
          onChanged()
        },
      })
      setMenu({ x: e.clientX, y: e.clientY, items })
    },
    [onChanged, root],
  )

  // Клавиши F2/Delete на выбранном
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!active) return
      const inEditor = (e.target as HTMLElement)?.closest?.('.monaco-editor')
      if (inEditor) return
      if (e.key === 'F2') {
        e.preventDefault()
        setRename({ path: active, value: baseName(active) })
      } else if (e.key === 'Delete') {
        e.preventDefault()
        if (confirm(`Удалить ${baseName(active)}?`)) {
          void fsDelete(active).then(onChanged)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onChanged])

  const commitCreate = useCallback(async () => {
    if (!creating) return
    const name = creating.value.trim()
    if (!name) {
      setCreating(null)
      return
    }
    const path = joinPath(creating.parent, name)
    try {
      if (creating.kind === 'file') await fsCreateFile(path)
      else await fsCreateDir(path)
    } catch {
      /* игнор */
    }
    setCreating(null)
    onChanged()
  }, [creating, onChanged])

  const commitRename = useCallback(async () => {
    if (!rename) return
    const name = rename.value.trim()
    if (!name || name === baseName(rename.path)) {
      setRename(null)
      return
    }
    const to = joinPath(dirOf(rename.path), name)
    await fsRename(rename.path, to).catch(() => {})
    setRename(null)
    onChanged()
  }, [rename, onChanged])

  return (
    <div>
      {tree.map((n) => (
        <TreeNode
          key={n.path}
          node={n}
          depth={0}
          root={root}
          git={git}
          expanded={expanded}
          active={active}
          rename={rename}
          creating={creating}
          onToggle={onToggle}
          onOpen={onOpen}
          onContext={openContext}
          onRenameChange={(v) => rename && setRename({ ...rename, value: v })}
          onRenameCommit={commitRename}
          onRenameCancel={() => setRename(null)}
          onCreateChange={(v) => creating && setCreating({ ...creating, value: v })}
          onCreateCommit={commitCreate}
          onCreateCancel={() => setCreating(null)}
          onMove={move}
        />
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  )
}

function TreeNode(props: {
  node: FsNode
  depth: number
  root: string
  git: Map<string, string>
  expanded: Set<string>
  active: string | null
  rename: { path: string; value: string } | null
  creating: { parent: string; kind: 'file' | 'dir'; value: string } | null
  onToggle: (p: string) => void
  onOpen: (n: FsNode) => void
  onContext: (e: React.MouseEvent, n: FsNode) => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onCreateChange: (v: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
  onMove?: (from: string, toDir: string) => void
}) {
  const {
    node,
    depth,
    root,
    git,
    expanded,
    active,
    rename,
    creating,
    onToggle,
    onOpen,
    onContext,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onCreateChange,
    onCreateCommit,
    onCreateCancel,
  } = props

  const isOpen = expanded.has(node.path)
  const badge = gitBadge(node.path, root, git)
  const isRenaming = rename?.path === node.path
  const isCreatingHere = creating?.parent === node.path && node.is_dir && isOpen
  const [dragOver, setDragOver] = useState(false)

  let icon: { Icon: any; className: string }
  if (node.is_dir) icon = iconForFolder(isOpen)
  else icon = iconForFile(node.name)

  return (
    <div>
      <div
        role="button"
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-aura-path', node.path)
        }}
        onDragOver={(e) => {
          if (!node.is_dir) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!dragOver) setDragOver(true)
        }}
        onDragLeave={() => dragOver && setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          if (!node.is_dir) return
          e.preventDefault()
          const from = e.dataTransfer.getData('application/x-aura-path')
          if (from && from !== node.path && props.onMove) props.onMove(from, node.path)
        }}
        onContextMenu={(e) => onContext(e, node)}
        onClick={() => (node.is_dir ? onToggle(node.path) : onOpen(node))}
        className={`flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[13px] hover:bg-accent ${
          active === node.path ? 'bg-accent text-foreground' : 'text-muted-foreground'
        } ${dragOver ? 'ring-1 ring-primary' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {node.is_dir ? (
          isOpen ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <icon.Icon className={`size-3.5 shrink-0 ${icon.className}`} />
        {isRenaming ? (
          <input
            autoFocus
            value={rename.value}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameCommit}
            className="h-5 w-full rounded border border-primary bg-background px-1 text-xs outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
        {badge && (
          <span className={`ml-auto shrink-0 font-mono text-[10px] font-semibold ${badge.cls}`}>
            {badge.letter}
          </span>
        )}
      </div>
      {node.is_dir && isOpen && (
        <div>
          {isCreatingHere && (
            <div
              className="flex items-center gap-1 py-[3px]"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <span className="w-3.5 shrink-0" />
              <input
                autoFocus
                value={creating.value}
                onChange={(e) => onCreateChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateCommit()
                  if (e.key === 'Escape') onCreateCancel()
                }}
                onBlur={onCreateCommit}
                placeholder={creating.kind === 'file' ? 'имя файла…' : 'имя папки…'}
                className="h-5 w-full rounded border border-primary bg-background px-1 text-xs outline-none"
              />
            </div>
          )}
          {node.children.map((c) => (
            <TreeNode key={c.path} {...props} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
