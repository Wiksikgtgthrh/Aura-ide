'use client'

import { useState, useTransition } from 'react'
import { savePreferences, type Preferences } from '@/app/actions/preferences'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Monitor, Sun, Moon, Check, Loader2 } from 'lucide-react'
import { useLanguage, LANGUAGES } from '@/lib/language'

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
        <span className="text-sm text-muted-foreground text-pretty">
          {description}
        </span>
      </div>
      {children}
    </div>
  )
}

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const { t, language, setLanguage } = useLanguage()
  const [prefs, setPrefs] = useState(initial)
  const [instructions, setInstructions] = useState(initial.customInstructions)
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const applyTheme = (t: string) => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    if (t === 'light' || t === 'dark') root.classList.add(t)
  }

  const update = (partial: Partial<Preferences>) => {
    const next = { ...prefs, ...partial }
    setPrefs(next)
    if (partial.theme) applyTheme(partial.theme)
    startTransition(async () => {
      await savePreferences(partial)
    })
  }

  const saveInstructions = () => {
    setPrefs({ ...prefs, customInstructions: instructions })
    startTransition(async () => {
      await savePreferences({ customInstructions: instructions })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const themeOptions = [
    { value: 'system', icon: Monitor, label: t('systemTheme') },
    { value: 'light', icon: Sun, label: t('lightTheme') },
    { value: 'dark', icon: Moon, label: t('darkTheme') },
  ] as const

  return (
    <div className="flex flex-col gap-10">
      {/* General */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          {t('general')}
        </h2>
        <div className="rounded-xl border border-border bg-card px-5 divide-y divide-border">
          <Row title={t('language')} description={t('languageHelp')}>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as typeof language)}
            >
              <SelectTrigger className="w-32" aria-label={t('language')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((item) => (
                  <SelectItem key={item.code} value={item.code}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row
            title={t('suggestions')}
            description={t('suggestionsHelp')}
          >
            <Switch
              checked={prefs.suggestions}
              onCheckedChange={(v) => update({ suggestions: v })}
              aria-label={t('suggestions')}
            />
          </Row>
          <Row
            title={t('soundNotifications')}
            description={t('soundHelp')}
          >
            <Switch
              checked={prefs.soundNotifications}
              onCheckedChange={(v) => update({ soundNotifications: v })}
              aria-label={t('soundNotifications')}
            />
          </Row>
          <Row
            title={t('chatPosition')}
            description={t('chatPositionHelp')}
          >
            <Select
              value={prefs.chatPosition}
              onValueChange={(v) => update({ chatPosition: v ?? 'left' })}
            >
              <SelectTrigger className="w-28" aria-label={t('chatPosition')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{t('left')}</SelectItem>
                <SelectItem value="right">{t('right')}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row
            title={t('autoPermissions')}
            description={t('soundHelp').replace('звук', 'разрешение')}
          >
            <Select
              value={prefs.autoPermissions}
              onValueChange={(v) => update({ autoPermissions: v ?? 'ask' })}
            >
              <SelectTrigger className="w-40" aria-label={t('autoPermissions')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">{t('askEveryTime')}</SelectItem>
                <SelectItem value="allow-all">{t('allowAll')}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row
            title={t('language')}
            description={language === 'ru' ? 'Язык интерфейса Aura.' : 'The display language for Aura.'}
          >
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as 'ru' | 'en')}
            >
              <SelectTrigger className="w-32" aria-label={t('language')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <div className="py-5 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                {t('customInstructions')}
              </span>
              <span className="text-sm text-muted-foreground text-pretty">
                {t('customInstructionsHelp')}
              </span>
            </div>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value.slice(0, 2000))}
              placeholder={t('instructionsPlaceholder')}
              rows={5}
              className="resize-y transition-shadow duration-200 focus-visible:shadow-sm"
              aria-label={t('customInstructions')}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {instructions.length} / 2000
              </span>
              <Button
                onClick={saveInstructions}
                disabled={pending}
                variant="outline"
                size="sm"
                className="transition-all duration-200 active:scale-[0.97] bg-transparent"
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : saved ? (
                  <>
                    <Check className="size-3.5" />
                    {t('saved')}
                  </>
                ) : (
                  t('save')
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Interface and Theme */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          {t('interfaceTheme')}
        </h2>
        <div className="rounded-xl border border-border bg-card px-5">
          <Row
            title={t('theme')}
            description={t('themeHelp')}
          >
            <div className="flex items-center rounded-lg border border-border p-0.5 gap-0.5">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-label={opt.label}
                  aria-pressed={prefs.theme === opt.value}
                  onClick={() => update({ theme: opt.value })}
                  className={`size-7 flex items-center justify-center rounded-md transition-all duration-200 ${
                    prefs.theme === opt.value
                      ? 'bg-accent text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <opt.icon className="size-3.5" />
                </button>
              ))}
            </div>
          </Row>
        </div>
      </section>
    </div>
  )
}
