'use client'

import useSWR from 'swr'
import { getPreferences } from '@/app/actions/preferences'
import { useLanguage } from '@/lib/language'

const SUGGESTIONS_RU = [
  'Создай лендинг для SaaS-продукта',
  'Сделай дашборд с графиками продаж',
  'Напиши TODO-приложение на React',
  'Создай форму регистрации с валидацией',
  'Сделай страницу портфолио разработчика',
  'Создай калькулятор с историей вычислений',
]

const SUGGESTIONS_EN = [
  'Build a SaaS landing page',
  'Create a sales dashboard with charts',
  'Build a React TODO app',
  'Make a sign-up form with validation',
  'Create a developer portfolio page',
  'Build a calculator with history',
]

interface SuggestionChipsProps {
  onSelect: (text: string) => void
  disabled?: boolean
}

export function SuggestionChips({ onSelect, disabled }: SuggestionChipsProps) {
  const { language } = useLanguage()
  const { data: prefs } = useSWR('preferences', getPreferences, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  if (prefs?.suggestions === false) return null

  const suggestions = language === 'ru' ? SUGGESTIONS_RU : SUGGESTIONS_EN

  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2 max-w-2xl animate-in fade-in duration-300">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          disabled={disabled}
          className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-95 disabled:opacity-50"
        >
          {s}
        </button>
      ))}
    </div>
  )
}
