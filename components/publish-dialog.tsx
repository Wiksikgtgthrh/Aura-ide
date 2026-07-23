'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Rocket,
  Server,
} from 'lucide-react'
import { GithubLogo } from '@/components/icons/github-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLanguage } from '@/lib/language'
import {
  scaffoldProject,
  scaffoldStaticSite,
  sanitizeName,
  type ScaffoldOptions,
} from '@/lib/project-scaffold'
import { downloadZip } from '@/lib/zip'
import { publishToGithub } from '@/app/actions/publish'
import useSWR from 'swr'
import { getGithubTokenStatus } from '@/app/actions/integration-secrets'

type PublishTab = 'github' | 'ssh' | 'aura'

const LS = {
  token: 'aura-github-token',
  ssh: 'aura-ssh-target',
}

function readLS(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function PublishDialog({
  open,
  onOpenChange,
  files,
  projectName,
  variant = 'react',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Virtual FS of the current chat project. */
  files: Record<string, string>
  /** Suggested project/repo name (chat title). */
  projectName: string
  /** 'react' — IDE mode (Vite project); 'html' — single-page static site. */
  variant?: 'react' | 'html'
}) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<PublishTab>('github')
  const { data: ghStatus } = useSWR('github-token-status', getGithubTokenStatus, {
    revalidateOnFocus: false,
  })

  const buildProject = (opts: ScaffoldOptions) =>
    variant === 'html' ? scaffoldStaticSite(files, opts) : scaffoldProject(files, opts)

  // --- GitHub state ---
  const [token, setToken] = useState('')
  const [repoName, setRepoName] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)

  // --- SSH state ---
  const [sshHost, setSshHost] = useState('')
  const [sshUser, setSshUser] = useState('root')
  const [sshPort, setSshPort] = useState('22')
  const [sshPath, setSshPath] = useState('')
  const [copiedCmd, setCopiedCmd] = useState(false)

  useEffect(() => {
    if (!open) return
    setToken(readLS(LS.token))
    setRepoName((prev) => prev || sanitizeName(projectName))
    setSshPath((prev) => prev || `/opt/apps/${sanitizeName(projectName)}`)
    try {
      const saved = JSON.parse(readLS(LS.ssh) || '{}') as {
        host?: string
        user?: string
        port?: string
      }
      if (saved.host) setSshHost(saved.host)
      if (saved.user) setSshUser(saved.user)
      if (saved.port) setSshPort(saved.port)
    } catch {
      /* ignore */
    }
  }, [open, projectName])

  const fileCount = Object.keys(files).length

  const handleGithubPublish = async () => {
    setPublishError(null)
    setPublishedUrl(null)
    setPublishing(true)
    if (token.trim()) writeLS(LS.token, token)

    const project = buildProject({ name: repoName, docker: true })
    const result = await publishToGithub({
      token,
      repoName,
      isPrivate,
      files: project,
      description: `Built with Aura IDE — ${projectName}`.slice(0, 200),
    })

    setPublishing(false)
    if (result.ok) {
      setPublishedUrl(result.htmlUrl)
    } else {
      setPublishError(result.error)
    }
  }

  const handleSshDownload = () => {
    writeLS(LS.ssh, JSON.stringify({ host: sshHost, user: sshUser, port: sshPort }))
    const name = sanitizeName(projectName)
    const project = buildProject({
      name,
      docker: true,
      ssh: {
        host: sshHost || 'your-server.example.com',
        user: sshUser || 'root',
        port: sshPort || '22',
        path: sshPath || `/opt/apps/${name}`,
      },
    })
    downloadZip(project, `${name}-deploy`)
  }

  const handleDockerDownload = () => {
    const name = sanitizeName(projectName)
    const project = buildProject({ name, docker: true })
    downloadZip(project, `${name}-docker`)
  }

  const deployCmd = 'unzip *-deploy.zip -d app && cd app && chmod +x deploy.sh && ./deploy.sh'

  const copyDeployCmd = async () => {
    try {
      await navigator.clipboard.writeText(deployCmd)
      setCopiedCmd(true)
      setTimeout(() => setCopiedCmd(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const tabs: { key: PublishTab; icon: React.ReactNode; label: string }[] = [
    { key: 'github', icon: <GithubLogo className="size-3.5" />, label: t('publishGithubTab') },
    { key: 'ssh', icon: <Server className="size-3.5" />, label: t('publishSshTab') },
    { key: 'aura', icon: <Rocket className="size-3.5" />, label: t('publishAuraTab') },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('publishTitle')}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          {t('publishSubtitle')} · {fileCount} files
        </p>

        {/* Tab switcher */}
        <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5 text-xs">
          {tabs.map(({ key, icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${
                tab === key
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* ---------------- GitHub ---------------- */}
        {tab === 'github' && (
          <div className="flex flex-col gap-4 pt-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gh-token" className="text-sm">
                {t('ghToken')}
              </Label>
              <Input
                id="gh-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={ghStatus?.connected ? t('ghTokenSavedPlaceholder') : 'ghp_… / github_pat_…'}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {ghStatus?.connected ? t('ghTokenSavedHint') : t('ghTokenHelp')}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gh-repo" className="text-sm">
                {t('ghRepoName')}
              </Label>
              <Input
                id="gh-repo"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="my-app"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="gh-private" className="text-sm">
                {t('ghPrivate')}
              </Label>
              <Switch
                id="gh-private"
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
              />
            </div>

            {publishError && (
              <p className="text-sm text-destructive" role="alert">
                {publishError}
              </p>
            )}

            {publishedUrl ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm">
                <Check className="size-4 text-emerald-500 shrink-0" />
                <span className="flex-1 text-foreground">{t('ghSuccess')}</span>
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
                >
                  {t('ghOpenRepo')}
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            ) : (
              <Button
                onClick={handleGithubPublish}
                disabled={
                  publishing ||
                  (!token.trim() && !ghStatus?.connected) ||
                  !repoName.trim() ||
                  fileCount === 0
                }
                className="w-full"
              >
                {publishing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('ghPublishing')}
                  </>
                ) : (
                  <>
                    <GithubLogo className="size-4" />
                    {t('ghPublish')}
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {/* ---------------- SSH ---------------- */}
        {tab === 'ssh' && (
          <div className="flex flex-col gap-4 pt-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="ssh-host" className="text-sm">
                  {t('sshHost')}
                </Label>
                <Input
                  id="ssh-host"
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="203.0.113.10"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssh-port" className="text-sm">
                  {t('sshPort')}
                </Label>
                <Input
                  id="ssh-port"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  placeholder="22"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssh-user" className="text-sm">
                  {t('sshUser')}
                </Label>
                <Input
                  id="ssh-user"
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  placeholder="root"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssh-path" className="text-sm">
                  {t('sshPath')}
                </Label>
                <Input
                  id="ssh-path"
                  value={sshPath}
                  onChange={(e) => setSshPath(e.target.value)}
                  placeholder="/opt/apps/my-app"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-pretty">{t('sshHelp')}</p>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <code className="flex-1 truncate font-mono text-[11px] text-foreground">
                {deployCmd}
              </code>
              <button
                type="button"
                onClick={copyDeployCmd}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t('copy')}
              >
                {copiedCmd ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </div>

            <Button onClick={handleSshDownload} disabled={fileCount === 0} className="w-full">
              <Download className="size-4" />
              {t('sshDownload')}
            </Button>
          </div>
        )}

        {/* ---------------- Aura / Docker + VPS ---------------- */}
        {tab === 'aura' && (
          <div className="flex flex-col gap-4 pt-1">
            <p className="text-sm text-muted-foreground text-pretty">{t('auraHelp')}</p>

            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground">
              docker compose up -d --build
              <br />
              <span className="text-muted-foreground"># → http://your-vps:8080</span>
            </div>

            <p className="text-xs text-muted-foreground">{t('auraRequirements')}</p>

            <div className="flex gap-2">
              <Button onClick={handleDockerDownload} disabled={fileCount === 0} className="flex-1">
                <Download className="size-4" />
                {t('auraDownload')}
              </Button>
              <Button
                variant="outline"
                onClick={handleDockerDownload}
                disabled={fileCount === 0}
                className="flex-1"
              >
                {t('downloadZip')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
