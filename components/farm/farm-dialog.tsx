'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getFarmModelsForUser } from '@/app/actions/farm'

type FarmModel = { id: string; name: string; v0ModelId: string; isDefault: boolean }
type Result = { chatId: string; files: string[]; webUrl: string }

/**
 * V0 Farm — генерация через пул v0-ключей.
 * Промпт уходит в официальный API v0 (api.v0.dev); при исчерпании баланса
 * ключ автоматически уходит в кулдаун (31 день), генерация продолжается на
 * следующем готовом ключе. Можно выбрать модель (настраивается в админке) и
 * продолжить работу в том же IDE-чате — файлы и превью обновляются на месте.
 */
export function FarmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [prompt, setPrompt] = useState('')
  const [models, setModels] = useState<FarmModel[]>([])
  const [modelId, setModelId] = useState('')
  const [continueChat, setContinueChat] = useState(false)
  const [lastChatId, setLastChatId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getFarmModelsForUser()
      .then((rows) => {
        if (cancelled) return
        setModels(rows)
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('farm_model_id') : null
        const remembered = saved && rows.some((m) => m.id === saved) ? saved : ''
        setModelId(remembered || rows.find((m) => m.isDefault)?.id || rows[0]?.id || '')
        const lastChat = typeof localStorage !== 'undefined' ? localStorage.getItem('farm_last_chat_id') : null
        setLastChatId(lastChat)
        setContinueChat(Boolean(lastChat))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  async function generate() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const chatIdIn = continueChat && lastChatId ? lastChatId : undefined
      const res = await fetch('/api/farm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, modelId: modelId || undefined, chatId: chatIdIn }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        const errors = Array.isArray(data?.errors) ? data.errors : [data?.error ?? 'Ошибка генерации']
        setError(errors.join('\n'))
        return
      }
      setResult({ chatId: data.chatId, files: data.files ?? [], webUrl: data.webUrl ?? '' })
      setPrompt('')
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('farm_last_chat_id', data.chatId)
        if (modelId) localStorage.setItem('farm_model_id', modelId)
      }
      setLastChatId(data.chatId)
    } catch {
      setError('Сетевая ошибка — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>V0 Farm — генерация</DialogTitle>
          <DialogDescription>
            Промпт уходит в v0 через пул ключей: при исчерпании баланса ключ переключается
            автоматически (кулдаун 31 день), сессия не прерывается. Результат — файлы в IDE-чате
            с превью.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">Модель:</label>
          <select
            className="h-9 flex-1 min-w-40 rounded-md border border-border bg-background px-2 text-sm"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {models.length === 0 && <option value="">v0-pro (по умолчанию)</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.isDefault ? ' (по умолчанию)' : ''}
              </option>
            ))}
          </select>
        </div>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Например: сделай landing для SaaS с тёмной темой (React + Tailwind)"
          rows={5}
        />

        <div className="flex items-center justify-between gap-2">
          {lastChatId ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={continueChat}
                onChange={(e) => setContinueChat(e.target.checked)}
              />
              продолжать в том же чате
            </label>
          ) : (
            <span className="text-xs text-muted-foreground">Результат попадёт в новый IDE-чат.</span>
          )}
          <div className="flex items-center gap-2">
            {busy && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> v0 генерирует (до 10 минут)…
              </span>
            )}
            <Button onClick={generate} disabled={busy || !prompt.trim()}>
              <Sparkles className="size-4" /> Сгенерировать
            </Button>
          </div>
        </div>

        {error && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </pre>
        )}

        {result && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Готово — {result.files.length} файлов</p>
            <ul className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">
              {result.files.map((f) => (
                <li key={f}>- {f}</li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  router.push(`/chat/${result.chatId}`)
                }}
              >
                Открыть чат с превью
              </Button>
              {result.webUrl && (
                <Button size="sm" variant="outline" onClick={() => window.open(result.webUrl, '_blank')}>
                  <ExternalLink className="size-3.5" /> В v0
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
