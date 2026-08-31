'use client'

import { useState, useTransition } from 'react'
import { savePreferences, type Preferences } from '@/app/actions/preferences'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLanguage } from '@/lib/language'

function Row({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-5">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-sm text-muted-foreground text-pretty">{description}</span>
      </div>
      {children}
    </div>
  )
}

export function GeneralForm({ initial }: { initial: Preferences }) {
  const { t } = useLanguage()
  const [prefs, setPrefs] = useState(initial)
  const [, startTransition] = useTransition()

  const update = (partial: Partial<Preferences>) => {
    setPrefs((p) => ({ ...p, ...partial }))
    startTransition(async () => {
      await savePreferences(partial)
    })
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Every chat is an IDE project now — the old HTML/IDE mode selector
          was removed (legacy html chats still open in their preview mode). */}

      {/* Editor */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          {t('generalEditorSection')}
        </h2>
        <div className="rounded-xl border border-border bg-card px-5 divide-y divide-border">
          <Row title={t('editorFontSize')} description={t('editorFontSizeHelp')}>
            <Select
              value={String(prefs.editorFontSize)}
              onValueChange={(v) => update({ editorFontSize: Number(v) })}
            >
              <SelectTrigger className="w-24" aria-label={t('editorFontSize')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[12, 13, 14, 16, 18].map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row title={t('editorTabSize')} description={t('editorTabSizeHelp')}>
            <Select
              value={String(prefs.editorTabSize)}
              onValueChange={(v) => update({ editorTabSize: Number(v) })}
            >
              <SelectTrigger className="w-24" aria-label={t('editorTabSize')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="4">4</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row title={t('editorWordWrap')} description={t('editorWordWrapHelp')}>
            <Switch
              checked={prefs.editorWordWrap}
              onCheckedChange={(v) => update({ editorWordWrap: v })}
              aria-label={t('editorWordWrap')}
            />
          </Row>
          <Row title={t('autoPreview')} description={t('autoPreviewHelp')}>
            <Switch
              checked={prefs.autoPreview}
              onCheckedChange={(v) => update({ autoPreview: v })}
              aria-label={t('autoPreview')}
            />
          </Row>
        </div>
      </section>
    </div>
  )
}
