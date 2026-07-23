'use client'

import { useState, useTransition } from 'react'
import {
  addMemory,
  updateMemory,
  deleteMemory,
  clearAllMemories,
  type Memory,
  type MemoryType,
} from '@/app/actions/memories'
import { savePreferences, type Preferences } from '@/app/actions/preferences'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Plus, Trash2, Pencil, Check, X, Download } from 'lucide-react'
import { useLanguage } from '@/lib/language'

const MEMORY_TYPES: MemoryType[] = ['fact', 'coding-style', 'project-context', 'preference']

function MemoryTypeBadge({ type }: { type: MemoryType }) {
  const colors: Record<MemoryType, string> = {
    'fact': 'bg-blue-500/10 text-blue-500',
    'coding-style': 'bg-purple-500/10 text-purple-500',
    'project-context': 'bg-orange-500/10 text-orange-500',
    'preference': 'bg-green-500/10 text-green-500',
  }
  const { t } = useLanguage()
  const labels: Record<MemoryType, string> = {
    'fact': t('memoryTypeFact'),
    'coding-style': t('memoryTypeCodingStyle'),
    'project-context': t('memoryTypeProjectContext'),
    'preference': t('memoryTypePreference'),
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${colors[type]}`}>
      {labels[type]}
    </span>
  )
}

function MemoryCard({
  memory,
  onToggle,
  onDelete,
  onEdit,
}: {
  memory: Memory
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  onEdit: (memory: Memory) => void
}) {
  const { t } = useLanguage()

  return (
    <div className={`flex items-start gap-3 py-4 transition-opacity ${memory.enabled ? '' : 'opacity-50'}`}>
      <Switch
        checked={memory.enabled}
        onCheckedChange={(v) => onToggle(memory.id, v)}
        aria-label={t('memoryToggle')}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <MemoryTypeBadge type={memory.type} />
          {memory.source === 'auto-extracted' && (
            <span className="text-xs text-muted-foreground">{t('memorySourceAuto')}</span>
          )}
        </div>
        <p className="text-sm text-foreground leading-relaxed">{memory.content}</p>
        <p className="text-xs text-muted-foreground mt-1.5">
          {new Date(memory.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(memory)}
          aria-label={t('memoryEdit')}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(memory.id)}
          aria-label={t('memoryDelete')}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AddMemoryForm({ onAdd }: { onAdd: (m: Memory) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [type, setType] = useState<MemoryType>('fact')
  const [pending, startTransition] = useTransition()

  const handleAdd = () => {
    if (!content.trim()) return
    startTransition(async () => {
      const m = await addMemory({ type, content: content.trim() })
      onAdd(m)
      setContent('')
      setType('fact')
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 bg-transparent"
      >
        <Plus className="size-3.5" />
        {t('memoryAdd')}
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
          <SelectTrigger className="w-44" aria-label={t('memoryType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMORY_TYPES.map((mt) => (
              <SelectItem key={mt} value={mt}>
                {mt === 'fact' ? t('memoryTypeFact')
                  : mt === 'coding-style' ? t('memoryTypeCodingStyle')
                  : mt === 'project-context' ? t('memoryTypeProjectContext')
                  : t('memoryTypePreference')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value.slice(0, 300))}
        placeholder={t('memoryContentPlaceholder')}
        rows={3}
        autoFocus
        className="resize-none"
        aria-label={t('memoryContent')}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{content.length} / 300</span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setOpen(false); setContent('') }}
            disabled={pending}
          >
            <X className="size-3.5" />
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!content.trim() || pending}
          >
            <Check className="size-3.5" />
            {t('memoryAdd')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function EditMemoryModal({
  memory,
  onClose,
  onSave,
}: {
  memory: Memory
  onClose: () => void
  onSave: (updated: Memory) => void
}) {
  const { t } = useLanguage()
  const [content, setContent] = useState(memory.content)
  const [type, setType] = useState<MemoryType>(memory.type)
  const [pending, startTransition] = useTransition()

  const handleSave = () => {
    if (!content.trim()) return
    startTransition(async () => {
      await updateMemory(memory.id, { type, content: content.trim() })
      onSave({ ...memory, type, content: content.trim() })
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 flex flex-col gap-4">
        <h3 className="text-base font-semibold text-foreground">{t('memoryEdit')}</h3>
        <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
          <SelectTrigger aria-label={t('memoryType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMORY_TYPES.map((mt) => (
              <SelectItem key={mt} value={mt}>
                {mt === 'fact' ? t('memoryTypeFact')
                  : mt === 'coding-style' ? t('memoryTypeCodingStyle')
                  : mt === 'project-context' ? t('memoryTypeProjectContext')
                  : t('memoryTypePreference')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 300))}
          rows={4}
          className="resize-none"
          autoFocus
          aria-label={t('memoryContent')}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{content.length} / 300</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!content.trim() || pending}>
              {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

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

export function MemoriesForm({
  initialMemories,
  initialPrefs,
}: {
  initialMemories: Memory[]
  initialPrefs: Preferences
}) {
  const { t } = useLanguage()
  const [items, setItems] = useState<Memory[]>(initialMemories)
  const [prefs, setPrefs] = useState(initialPrefs)
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null)
  const [, startTransition] = useTransition()

  const updatePref = (partial: Partial<Preferences>) => {
    setPrefs((p) => ({ ...p, ...partial }))
    startTransition(async () => {
      await savePreferences(partial)
    })
  }

  const handleToggle = (id: string, enabled: boolean) => {
    setItems((prev) => prev.map((m) => m.id === id ? { ...m, enabled } : m))
    startTransition(async () => {
      await updateMemory(id, { enabled })
    })
  }

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((m) => m.id !== id))
    startTransition(async () => {
      await deleteMemory(id)
    })
  }

  const handleClearAll = () => {
    setItems([])
    startTransition(async () => {
      await clearAllMemories()
    })
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'aura-memories.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeCount = items.filter((m) => m.enabled).length

  return (
    <div className="flex flex-col gap-10">
      {/* Settings */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          {t('memoriesSettingsSection')}
        </h2>
        <div className="rounded-xl border border-border bg-card px-5 divide-y divide-border">
          <Row title={t('memoriesEnabled')} description={t('memoriesEnabledHelp')}>
            <Switch
              checked={prefs.memoriesEnabled}
              onCheckedChange={(v) => updatePref({ memoriesEnabled: v })}
              aria-label={t('memoriesEnabled')}
            />
          </Row>
          <Row title={t('memoriesAutoExtract')} description={t('memoriesAutoExtractHelp')}>
            <Switch
              checked={prefs.memoriesAutoExtract}
              onCheckedChange={(v) => updatePref({ memoriesAutoExtract: v })}
              aria-label={t('memoriesAutoExtract')}
            />
          </Row>
          <Row title={t('memoriesMaxCount')} description={t('memoriesMaxCountHelp')}>
            <Select
              value={String(prefs.memoriesMaxCount)}
              onValueChange={(v) => updatePref({ memoriesMaxCount: Number(v) })}
            >
              <SelectTrigger className="w-24" aria-label={t('memoriesMaxCount')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </div>
      </section>

      {/* Memory list */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t('memoriesListSection')} {items.length > 0 && (
              <span className="ml-1 text-xs text-muted-foreground font-normal">
                {activeCount} / {items.length} {t('memoriesActive')}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExport}
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Download className="size-3.5" />
                  {t('memoryExport')}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      {t('memoryClearAll')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('memoryClearAllConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('memoryClearAllConfirmDesc')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleClearAll}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {t('memoryClearAll')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card px-5 flex flex-col">
          {items.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-center">
              <p className="text-sm font-medium text-foreground">{t('memoriesEmpty')}</p>
              <p className="text-sm text-muted-foreground text-pretty max-w-xs">
                {t('memoriesEmptyHelp')}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={setEditingMemory}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <AddMemoryForm onAdd={(m) => setItems((prev) => [...prev, m])} />
        </div>
      </section>

      {editingMemory && (
        <EditMemoryModal
          memory={editingMemory}
          onClose={() => setEditingMemory(null)}
          onSave={(updated) => {
            setItems((prev) => prev.map((m) => m.id === updated.id ? updated : m))
          }}
        />
      )}
    </div>
  )
}
