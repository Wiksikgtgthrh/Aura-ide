'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { MarketplacePlugin, PluginManifest } from '@/app/actions/plugins'
import type { PluginVersionEntry } from '@/lib/plugin-types'
import { videoEmbedUrl } from '@/lib/plugin-types'
import type { LanguageCode } from '@/lib/language'
import { PluginBadge } from './plugin-badge'
import { PluginToggle } from './plugin-toggle'
import { PluginIcon, PriceChip } from './plugin-card'
import { installPlugin, uninstallPlugin } from '@/app/actions/plugins'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  Check,
  Copy,
  HandCoins,
  Loader2,
  Play,
  X,
} from 'lucide-react'

type Tab = 'about' | 'docs' | 'changelog' | 'authors'

const TAB_LABELS: Record<Tab, { ru: string; en: string }> = {
  about: { ru: 'Описание', en: 'About' },
  docs: { ru: 'Документация', en: 'Docs' },
  changelog: { ru: 'Обновления', en: 'Changelog' },
  authors: { ru: 'Авторы', en: 'Authors' },
}

// ---- Медиа-галерея -------------------------------------------------------------

function MediaGallery({ plugin }: { plugin: MarketplacePlugin }) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  if (plugin.media.length === 0) return null

  return (
    <>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
        {plugin.media.map((m, i) => {
          const embed = m.type === 'video' ? videoEmbedUrl(m.url) : null
          return (
            <figure
              key={i}
              className="w-[420px] max-w-[85vw] shrink-0 snap-start animate-in fade-in slide-in-from-bottom-1 duration-300"
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: 'backwards' }}
            >
              <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
                {m.type === 'image' ? (
                  <button
                    type="button"
                    onClick={() => setLightbox(m.url)}
                    className="block h-56 w-full cursor-zoom-in"
                    title={m.caption || 'Открыть'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.caption || 'Скриншот плагина'} className="h-56 w-full object-cover transition-transform duration-300 hover:scale-[1.02]" loading="lazy" />
                  </button>
                ) : embed ? (
                  <iframe
                    src={embed}
                    title={m.caption || 'Видео плагина'}
                    className="h-56 w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video src={m.url} controls className="h-56 w-full bg-black object-contain" preload="metadata" />
                )}
              </div>
              {m.caption && (
                <figcaption className="mt-1.5 flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
                  {m.type === 'video' && <Play className="size-3" />}
                  {m.caption}
                </figcaption>
              )}
            </figure>
          )
        })}
      </div>

      {/* Лайтбокс */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-6 animate-in fade-in duration-200"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Закрыть"
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-[88vh] max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

// ---- Авторы + донат --------------------------------------------------------------

function AuthorCard({ nick, requisites, lang }: { nick: string; requisites: string; lang: LanguageCode }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requisites)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {nick.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{nick}</p>
          <p className="text-xs text-muted-foreground">{lang === 'ru' ? 'Автор плагина' : 'Plugin author'}</p>
        </div>
        {requisites && (
          <Button size="sm" onClick={() => setOpen((v) => !v)} className="gap-1.5">
            <HandCoins className="size-3.5" />
            {lang === 'ru' ? 'Задонатить' : 'Donate'}
          </Button>
        )}
      </div>
      {open && requisites && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{requisites}</code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={lang === 'ru' ? 'Скопировать' : 'Copy'}
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          </button>
        </div>
      )}
    </div>
  )
}

// ---- Страница-лендинг ---------------------------------------------------------------

export function PluginDetailTabs({
  plugin,
  allPlugins,
  versions = [],
  lang = 'ru',
}: {
  plugin: MarketplacePlugin
  allPlugins: MarketplacePlugin[]
  versions?: PluginVersionEntry[]
  lang?: LanguageCode
}) {
  const [activeTab, setActiveTab] = useState<Tab>('about')
  const [installed, setInstalled] = useState(plugin.isInstalled)
  const [enabled, setEnabled] = useState(plugin.enabled)
  const [busy, setBusy] = useState(false)

  const manifest = plugin.manifest as PluginManifest

  const handleInstall = async () => {
    setBusy(true)
    try {
      await installPlugin(plugin.id)
      setInstalled(true)
      setEnabled(true)
    } finally {
      setBusy(false)
    }
  }

  const handleUninstall = async () => {
    setBusy(true)
    try {
      await uninstallPlugin(plugin.id)
      setInstalled(false)
      setEnabled(false)
    } finally {
      setBusy(false)
    }
  }

  const recommendedPlugins = allPlugins.filter((p) => manifest.recommendations?.includes(p.slug))

  // Обновления: приоритет — таблица plugin_versions; fallback — manifest.changelog.
  const changelogEntries: { version: string; date: string; notes: string }[] =
    versions.length > 0
      ? versions.map((v) => ({
          version: v.version,
          date: new Date(v.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
          notes: v.changelog,
        }))
      : (manifest.changelog ?? [])

  const docsText = plugin.docs || manifest.docs || ''
  const updatedLabel = new Date(plugin.updatedAt).toLocaleDateString(
    lang === 'ru' ? 'ru-RU' : 'en-US',
    { day: 'numeric', month: 'long', year: 'numeric' },
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Back */}
      <Link
        href="/plugins"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {lang === 'ru' ? 'Все плагины' : 'All plugins'}
      </Link>

      {/* Герой-блок */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.08] via-card to-card p-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 shadow-sm">
            <PluginIcon name={plugin.icon} className="size-8 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">{plugin.name}</h1>
              <PluginBadge scope={plugin.scope} lang={lang} />
              <PriceChip priceRub={plugin.priceRub} lang={lang} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {plugin.author} · v{plugin.version} · {lang === 'ru' ? 'обновлён' : 'updated'} {updatedLabel}
            </p>
            <p className="mt-2.5 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
              {plugin.description}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {installed ? (
                <>
                  <PluginToggle pluginId={plugin.id} enabled={enabled} onToggle={setEnabled} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUninstall}
                    disabled={busy}
                    className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    {lang === 'ru' ? 'Удалить' : 'Uninstall'}
                  </Button>
                </>
              ) : (
                <Button onClick={handleInstall} disabled={busy} className="gap-1.5 px-4">
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {plugin.priceRub > 0
                    ? lang === 'ru'
                      ? `Установить · ${plugin.priceRub.toLocaleString('ru-RU')} ₽`
                      : `Install · ${plugin.priceRub.toLocaleString('ru-RU')} ₽`
                    : lang === 'ru'
                      ? 'Установить бесплатно'
                      : 'Install for free'}
                </Button>
              )}
              {changelogEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('changelog')}
                  className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  {lang === 'ru' ? `${changelogEntries.length} обновл.` : `${changelogEntries.length} updates`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Галерея */}
      <MediaGallery plugin={plugin} />

      {/* Вкладки */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {TAB_LABELS[tab][lang]}
            {tab === 'changelog' && changelogEntries.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {changelogEntries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Контент вкладок */}
      <div key={activeTab} className="text-sm leading-relaxed text-foreground animate-in fade-in slide-in-from-bottom-1 duration-200">
        {activeTab === 'about' && (
          <div className="flex flex-col gap-5">
            {plugin.longDescription ? (
              <Markdown source={plugin.longDescription} />
            ) : (
              <p className="text-muted-foreground">{plugin.description}</p>
            )}
            {manifest.whereItAppears && (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {lang === 'ru' ? 'Где появится после установки' : 'Where it appears after install'}
                </p>
                <p className="text-sm text-foreground">{manifest.whereItAppears}</p>
              </div>
            )}
            {recommendedPlugins.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {lang === 'ru' ? 'Сочетается с' : 'Works well with'}
                </p>
                {recommendedPlugins.map((rp) => (
                  <Link
                    key={rp.id}
                    href={`/plugins/${rp.slug}`}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors duration-200 hover:bg-muted/40"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <PluginIcon name={rp.icon} className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{rp.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{rp.description}</p>
                    </div>
                    <PluginBadge scope={rp.scope} lang={lang} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="flex flex-col gap-4">
            {docsText ? (
              <Markdown source={docsText} />
            ) : (
              <p className="text-muted-foreground">
                {lang === 'ru' ? 'Документации пока нет' : 'No documentation yet'}
              </p>
            )}
            {manifest.rules && manifest.rules.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {lang === 'ru' ? 'Правила плагина' : 'Plugin rules'}
                </p>
                <div className="flex flex-col gap-1.5">
                  {manifest.rules.map((rule, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-foreground"
                    >
                      {rule}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'changelog' && (
          <div className="flex flex-col gap-0">
            {changelogEntries.length > 0 ? (
              changelogEntries.map((entry, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex shrink-0 flex-col items-center">
                    <div className={`mt-1.5 size-2.5 rounded-full ${i === 0 ? 'bg-primary ring-4 ring-primary/15' : 'bg-border'}`} />
                    {i < changelogEntries.length - 1 && <div className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 pb-6">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
                        v{entry.version}
                      </span>
                      {i === 0 && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          {lang === 'ru' ? 'актуальная' : 'latest'}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{entry.date}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {entry.notes ? <Markdown source={entry.notes} /> : '—'}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                {lang === 'ru' ? 'История изменений пуста' : 'No changelog entries'}
              </p>
            )}
          </div>
        )}

        {activeTab === 'authors' && (
          <div className="flex flex-col gap-3">
            {plugin.donateAuthors.length > 0 ? (
              plugin.donateAuthors.map((a, i) => (
                <AuthorCard key={i} nick={a.nick} requisites={a.requisites} lang={lang} />
              ))
            ) : (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {plugin.author.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{plugin.author}</p>
                    <p className="text-xs text-muted-foreground">
                      {lang === 'ru' ? 'Автор плагина' : 'Plugin author'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
