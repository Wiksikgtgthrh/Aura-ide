'use client'

import { useEffect, useState, useTransition } from 'react'
import { Waypoints, X, Plus, Trash2, Loader2, ChevronDown } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  getMcpServers,
  createMcpServer,
  toggleMcpServer,
  deleteMcpServer,
  type McpServer,
} from '@/app/actions/mcp'
import { useLanguage } from '@/lib/language'

export function McpDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [servers, setServers] = useState<McpServer[]>([])
  const [adding, setAdding] = useState(false)
  const [isPending, startTransition] = useTransition()

  // New server form state
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newAuthType, setNewAuthType] = useState('none')
  const [newToken, setNewToken] = useState('')

  useEffect(() => {
    if (!open) return
    startTransition(async () => {
      const list = await getMcpServers()
      setServers(list)
    })
  }, [open])

  const handleAdd = () => {
    if (!newName.trim() || !newUrl.trim()) return
    startTransition(async () => {
      const created = await createMcpServer({
        name: newName,
        url: newUrl,
        authType: newAuthType,
        token: newToken,
      })
      setServers((prev) => [...prev, created])
      setNewName('')
      setNewUrl('')
      setNewAuthType('none')
      setNewToken('')
      setAdding(false)
    })
  }

  const handleToggle = (id: string, enabled: boolean) => {
    startTransition(async () => {
      await toggleMcpServer(id, enabled)
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
      )
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteMcpServer(id)
      setServers((prev) => prev.filter((s) => s.id !== id))
    })
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label={t('mcps')}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover shadow-xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Waypoints className="size-4 text-muted-foreground" />
            {t('mcps')}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {/* Server list */}
          {servers.length === 0 && !adding && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t('mcpNoServers')}
            </div>
          )}

          {servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{server.name}</p>
                <p className="truncate text-xs text-muted-foreground">{server.url}</p>
              </div>
              <Switch
                checked={server.enabled}
                onCheckedChange={(v) => handleToggle(server.id, v)}
                aria-label={t('toggleImages')}
              />
              <button
                type="button"
                onClick={() => handleDelete(server.id)}
                disabled={isPending}
                className="rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                aria-label={t('deleteMcp')}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          {/* Add form */}
          {adding && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">{t('mcpServerName')}</label>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="My MCP"
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">URL</label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://..."
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">{t('mcpAuthType')}</label>
                <div className="relative">
                  <select
                    value={newAuthType}
                    onChange={(e) => setNewAuthType(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="none">{t('mcpAuthNone')}</option>
                    <option value="bearer">{t('mcpAuthBearer')}</option>
                    <option value="oauth">{t('mcpAuthOAuth')}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>

              {newAuthType !== 'none' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">{t('mcpToken')}</label>
                  <input
                    type="password"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    placeholder="Bearer token..."
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={isPending || !newName.trim() || !newUrl.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isPending && <Loader2 className="size-3.5 animate-spin" />}
                  {t('addServer')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={adding}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors"
          >
            <Plus className="size-3.5" />
            {t('addServer')}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {t('cancel')}
          </button>
        </div>
      </div>
    </>
  )
}
