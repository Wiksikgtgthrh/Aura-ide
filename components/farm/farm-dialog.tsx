'use client'

import { useState } from 'react'
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

type Result = { chatId: string; files: string[]; webUrl: string }

/**
 * V0 Farm — генерация через пул v0-ключей.
 * Промпт уходит в официальный API v0 (api.v0.dev); при исчерпании баланса
 * ключ автоматически уходит в кулдаун (31 день), генерация продолжается на
 * следующем готовом ключе. Файлы сохраняются в IDE-чат — превью и редактор
 * подхватывают их сразу.
 */
export function FarmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function generate() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/farm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        const errors = Array.isArray(data?.errors) ? data.errors : [data?.error ?? 'Ошибка генерации']
        setError(errors.join('\n'))
        return
      }
      setResult({ chatId: data.chatId, files: data.files ?? [], webUrl: data.webUrl ?? '' })
      setPrompt('')
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
            автоматически (кулдаун 31 день), сессия не прерывается. Результат — файлы в новом
            IDE-чате с превью.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Например: сделай landing для SaaS с тёмной темой (React + Tailwind)"
          rows={5}
        />

        <div className="flex items-center justify-end gap-2">
          {busy && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> v0 генерирует (до 10 минут)…
            </span>
          )}
          <Button onClick={generate} disabled={busy || !prompt.trim()}>
            <Sparkles className="size-4" /> Сгенерировать
          </Button>
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
