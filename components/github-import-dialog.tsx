'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { GithubLogo } from '@/components/icons/github-logo'
import { createChat } from '@/app/actions/chats'
import { useLanguage } from '@/lib/language'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function parseRepoUrl(url: string): string | null {
  const trimmed = url.trim()
  const match = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
  )
  if (!match) return null
  return `${match[1]}/${match[2]}`
}

export function GithubIconImportDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, clicking Import inserts the repo slug into the prompt instead of navigating. */
  onInsert?: (repoSlug: string) => void
}) {
  const { t } = useLanguage()
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [connectMessage, setConnectMessage] = useState(false)

  const handleImport = async () => {
    const repo = parseRepoUrl(url)
    if (!repo) {
      setError(t('invalidRepoUrl'))
      return
    }
    setError(null)

    if (onInsert) {
      onInsert(`https://github.com/${repo}`)
      onOpenChange(false)
      setUrl('')
      return
    }

    setImporting(true)
    try {
      const chatId = await createChat(repo)
      if (chatId) {
        onOpenChange(false)
        setUrl('')
        router.push(`/chat/${chatId}`)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setUrl('')
          setError(null)
          setConnectMessage(false)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('importGithub')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            {t('importFromUrl')}
          </span>
          <div className="flex rounded-md border border-border overflow-hidden shadow-xs">
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') handleImport()
              }}
              placeholder="https://github.com/myorg/myrepo"
              aria-label={t('importFromUrl')}
              className="h-10 flex-1 min-w-0 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="px-4 bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 flex items-center gap-1.5"
            >
              {importing && <Loader2 className="size-3.5 animate-spin" />}
              {t('importAction')}
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            {t('selectRepository')}
          </span>
          <div className="h-56 rounded-md border border-border bg-muted/30 flex flex-col items-center justify-center gap-2">
            <Button
              variant="outline"
              className="bg-background"
              onClick={() => setConnectMessage(true)}
            >
              <GithubLogo className="size-4" />
              {t('connectGithub')}
            </Button>
            {connectMessage && (
              <p className="text-xs text-muted-foreground text-pretty px-4 text-center">
                {t('githubComingSoon')}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
