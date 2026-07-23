'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { BookOpen, Check, Loader2, X } from 'lucide-react'
import { getPreferences, savePreferences } from '@/app/actions/preferences'
import { useLanguage } from '@/lib/language'

export function InstructionsPopover({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    startTransition(async () => {
      const prefs = await getPreferences()
      setValue(prefs.customInstructions ?? '')
    })
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [open])

  const handleSave = () => {
    startTransition(async () => {
      await savePreferences({ customInstructions: value })
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        onClose()
      }, 800)
    })
  }

  const handleReset = () => {
    startTransition(async () => {
      await savePreferences({ customInstructions: '' })
      setValue('')
      setSaved(true)
      setTimeout(() => setSaved(false), 800)
    })
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-label={t('instructions')}
        className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-80 rounded-xl border border-border bg-popover shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 max-h-[min(480px,calc(100vh-100px))] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <BookOpen className="size-4 text-muted-foreground" />
            {t('instructions')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('cancel')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('instructionsPlaceholder')}
            rows={6}
            className="w-full resize-none rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('customInstructionsHelp')}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('resetDefault')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : saved ? (
              <Check className="size-3.5" />
            ) : null}
            {saved ? t('saved') : t('save')}
          </button>
        </div>
      </div>
    </>
  )
}
