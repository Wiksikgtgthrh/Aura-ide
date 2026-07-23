'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Activity } from 'react'
import { useNavigation } from '@/lib/navigation-context'
import useSWR from 'swr'
import { authClient } from '@/lib/auth-client'
import {
  getChats,
  renameChat,
  deleteChat,
  toggleFavoriteChat,
} from '@/app/actions/chats'
import type { ChatListItem } from '@/lib/chat-store'
import { Button } from '@/components/ui/button'
import dynamic from 'next/dynamic'

const GithubIconImportDialog = dynamic(
  () => import('@/components/github-import-dialog').then((m) => m.GithubIconImportDialog),
  { ssr: false },
)
const SearchDialog = dynamic(
  () => import('@/components/search-dialog').then((m) => m.SearchDialog),
  { ssr: false },
)
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLanguage, LANGUAGES } from '@/lib/language'
import {
  Search,
  House,
  LayoutGrid,
  Users,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  Plus,
  User,
  UserRound,
  UserPlus,
  Settings,
  LogOut,
  Puzzle,
  Check,
  Loader2,
  KeyRound,
  Gift,
  Languages,
  Menu,
  X,
  ArrowLeft,
  SlidersHorizontal,
  Building2,
  BookMarked,
  Zap,
  Cable,
  CreditCard,
  Activity as ActivityIcon,
  KeyRound as KeyRoundSettings,
  Puzzle as PuzzleSettings,
  UserCircle,
} from 'lucide-react'
import { GithubLogo } from '@/components/icons/github-logo'
import { AccountAvatar } from '@/components/sidebar/account-avatar'
import { ChatRow } from '@/components/sidebar/chat-row'
import { useSettings, type Section } from '@/components/settings-context'
import { prefetchSettingsData } from '@/app/actions/prefetch'

type NavItem = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  active?: boolean
}

const navItems = [
  { key: 'home' as const, icon: House, href: '/' },
  { key: 'projects' as const, icon: LayoutGrid, href: '/projects' },
  { key: 'team' as const, icon: Users, href: '/teams' },
  { key: 'plugins' as const, icon: Puzzle, href: '/plugins' },
]

const resourceItems = [
  { key: 'myApi' as const, icon: KeyRound, href: '/my-api' },
  { key: 'freebies' as const, icon: Gift, href: '/free' },
]

// Settings sections — rendered in-sidebar when on /settings
type SettingsItem = {
  key: string
  icon: React.ComponentType<{ className?: string }>
  section: Section
  label: string
}

const settingsAccountItems: SettingsItem[] = [
  { key: 'profile', icon: UserCircle, section: 'profile', label: '' },
  { key: 'preferences', icon: SlidersHorizontal, section: 'preferences', label: '' },
]

const settingsWorkspaceItems: SettingsItem[] = [
  { key: 'general', icon: Building2, section: 'general', label: '' },
  { key: 'memories', icon: BookMarked, section: 'memories', label: '' },
  { key: 'skills', icon: Zap, section: 'skills', label: '' },
  { key: 'plugins', icon: PuzzleSettings, section: 'plugins', label: '' },
  { key: 'integrations', icon: Cable, section: 'integrations', label: '' },
  { key: 'billing', icon: CreditCard, section: 'billing', label: '' },
  { key: 'members', icon: Users, section: 'members', label: '' },
  { key: 'usage', icon: ActivityIcon, section: 'usage', label: '' },
  { key: 'apiKeys', icon: KeyRoundSettings, section: 'api-keys', label: '' },
]

function SettingsSidebarContent({
  userName,
  userImage,
  navigateTo,
  isAnonymous,
  userEmail,
  userTag,
}: {
  userName: string
  userImage?: string | null
  navigateTo: (href: string) => void
  isAnonymous?: boolean
  userEmail: string
  userTag?: string
}) {
  const { t } = useLanguage()
  const { section: activeSection, setSection } = useSettings()

  const settingsLabels: Record<string, string> = {
    profile: t('profile'),
    preferences: t('preferences'),
    general: t('general'),
    memories: t('memories'),
    skills: t('skillsNav'),
    plugins: t('pluginsNav'),
    integrations: t('integrations'),
    billing: t('billing'),
    members: t('members' as Parameters<typeof t>[0]),
    usage: t('usage' as Parameters<typeof t>[0]),
    apiKeys: t('apiKeys' as Parameters<typeof t>[0]),
  }

  const renderItem = (item: SettingsItem) => {
    const isActive = item.section === activeSection
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => setSection(item.section)}
        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all duration-150 active:scale-[0.98] text-left w-full ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
        }`}
      >
        <item.icon className="size-4 shrink-0" />
        {settingsLabels[item.key] ?? item.key}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="size-5 rounded-full bg-foreground flex items-center justify-center shrink-0">
            <span className="text-background text-[10px] font-semibold">A</span>
          </span>
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            Aura
          </span>
        </div>
      </div>

      {/* Back button */}
      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={() => navigateTo('/')}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-200 w-full"
        >
          <ArrowLeft className="size-4" />
          {t('settings')}
        </button>
      </div>

      {/* Nav */}
      <nav className="px-3 pt-4 flex flex-col gap-5 flex-1 overflow-y-auto" aria-label={t('settings')}>
        <div className="flex flex-col gap-0.5">
          <span className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {t('account')}
          </span>
          {settingsAccountItems.map(renderItem)}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {t('workspace')}
          </span>
          {settingsWorkspaceItems.map(renderItem)}
        </div>
      </nav>

      {/* Footer */}
      <div className="mt-auto px-3 pb-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2 py-1.5 min-w-0">
          <AccountAvatar image={userImage} name={userName} />
          <span className="truncate text-sm text-sidebar-foreground">{userName}</span>
        </div>
        <span className="px-2.5 py-1 rounded-md border border-border bg-background text-xs text-foreground shrink-0">
          {t('free')}
        </span>
      </div>
    </div>
  )
}

type DeviceSession = {
  session: { token: string }
  user: {
    id: string
    name: string
    email: string
    image?: string | null
    isAnonymous?: boolean | null
  }
}


export function AppSidebar({
  userId,
  userName,
  userEmail,
  userImage,
  userTag,
  isAnonymous,
  initialChats,
}: {
  userId: string
  userName: string
  userEmail: string
  userImage?: string | null
  userTag?: string
  isAnonymous?: boolean
  initialChats?: ChatListItem[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const isSettings = pathname.startsWith('/settings')
  const activeChatId = pathname.startsWith('/chat/') ? pathname.split('/')[2] : undefined
  const { language, setLanguage, t } = useLanguage()
  // Shared transition — isPending is consumed by NavigationContent to dim the
  // content area in sync with the active button highlight.
  const { navigate } = useNavigation()
  // Optimistic path — updated instantly on click so the active style appears
  // before the server round-trip completes.
  const [optimisticPath, setOptimisticPath] = useState(pathname)
  const activePath = optimisticPath

  const navigateTo = (href: string) => {
    setOptimisticPath(href)
    navigate(href)
  }

  const [signingOut, setSigningOut] = useState(false)
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [guestBusy, setGuestBusy] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [githubOpen, setGithubIconOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [recentOpen, setRecentOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)

  const { data: chatList, mutate: mutateChats } = useSWR('chats', () => getChats(), {
    fallbackData: initialChats,
    revalidateOnMount: false,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  // Keep optimistic path in sync when real pathname changes (back/forward nav)
  useEffect(() => {
    setOptimisticPath(pathname)
  }, [pathname])

  // Global Cmd/Ctrl+K opens the chat search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close the mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const handleRename = async (id: string) => {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return
    await renameChat(id, title)
    mutateChats()
  }

  const handleDelete = async (id: string) => {
    await deleteChat(id)
    mutateChats()
    if (activeChatId === id) router.push('/')
  }

  const handleToggleFavorite = async (chat: ChatListItem) => {
    await toggleFavoriteChat(chat.id, !chat.favorite)
    mutateChats()
  }

  const favoriteChats = chatList?.filter((c) => c.favorite) ?? []

  const loadSessions = async () => {
    setSessionsLoading(true)
    const { data } = await authClient.multiSession.listDeviceSessions()
    setSessions((data as DeviceSession[]) ?? [])
    setSessionsLoading(false)
  }

  const switchAccount = async (token: string) => {
    setSwitching(token)
    await authClient.multiSession.setActive({ sessionToken: token })
    setSwitching(null)
    router.refresh()
  }

  const addGuest = async () => {
    setGuestBusy(true)
    const { error } = await authClient.signIn.anonymous()
    setGuestBusy(false)
    if (!error) router.refresh()
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    await authClient.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  const otherSessions = sessions.filter((s) => s.user.id !== userId)
  const hasGuestSession = sessions.some((s) => s.user.isAnonymous)

  return (
    <>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label={t('openMenu')}
        className="md:hidden fixed top-3 left-3 z-40 size-9 flex items-center justify-center rounded-md border border-border bg-background text-foreground shadow-xs"
      >
        <Menu className="size-4" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label={t('closeMenu')}
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-foreground/30 animate-in fade-in duration-200"
        />
      )}

      <aside
        className={`w-64 shrink-0 h-svh flex flex-col bg-sidebar fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:static md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Mobile close */}
      <button
        type="button"
        onClick={() => setMobileOpen(false)}
        aria-label={t('closeMenu')}
        className="md:hidden absolute top-3 right-3 size-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors duration-200"
      >
        <X className="size-4" />
      </button>

      {/* Settings sidebar — shown on /settings, state preserved when hidden */}
      <div className={`flex flex-col flex-1 min-h-0 ${isSettings ? '' : 'hidden'}`}>
        <Activity mode={isSettings ? 'visible' : 'hidden'}>
          <SettingsSidebarContent
            userName={userName}
            userImage={userImage}
            navigateTo={navigateTo}
            isAnonymous={isAnonymous}
            userEmail={userEmail}
            userTag={userTag}
          />
        </Activity>
      </div>

      {/* Main nav — shown everywhere except /settings */}
      <div className={`flex flex-col flex-1 min-h-0 ${isSettings ? 'hidden' : ''}`}>
      <Activity mode={isSettings ? 'hidden' : 'visible'}>

      {/* Account switcher */}
      <div className="px-3 pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={loadSessions}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-200 min-w-0"
          >
            <AccountAvatar image={userImage} name={userName} className="size-5" />
            <span className="truncate font-medium">
              {userName}&apos;s Aura
            </span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground ml-auto shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="w-64 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            {/* Current account */}
            <div className="px-2 py-2 flex items-center gap-2.5">
              <AccountAvatar
                image={userImage}
                name={userName}
                className="size-8"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-foreground truncate">
                  {userName}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {isAnonymous
                    ? t('guest')
                    : userTag
                      ? `@${userTag}`
                      : userEmail}
                </span>
              </div>
              <Check className="size-4 text-foreground ml-auto shrink-0" />
            </div>
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2.5"
                render={<Link href="/profile" prefetch={true} />}
              >
                <User className="size-4" />
                {t('profile')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            {/* Other accounts */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('switchAccount')}
              </DropdownMenuLabel>
              {sessionsLoading ? (
                <div className="px-2 py-2 flex items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : otherSessions.length > 0 ? (
                otherSessions.map((s) => (
                  <DropdownMenuItem
                    key={s.session.token}
                    onClick={() => switchAccount(s.session.token)}
                    disabled={switching !== null}
                    className="gap-2.5"
                  >
                    <AccountAvatar
                      image={s.user.image}
                      name={s.user.name}
                      className="size-6"
                    />
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm truncate">{s.user.name}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {s.user.isAnonymous ? t('guest') : s.user.email}
                      </span>
                    </span>
                    {switching === s.session.token && (
                      <Loader2 className="size-3.5 animate-spin shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t('noOtherAccounts')}
                </p>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2.5"
                render={<Link href="/sign-in?add=1" />}
              >
                <UserPlus className="size-4" />
                {t('addAccount')}
              </DropdownMenuItem>
              {!isAnonymous && !hasGuestSession && (
                <DropdownMenuItem
                  onClick={addGuest}
                  disabled={guestBusy}
                  className="gap-2.5"
                >
                  {guestBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserRound className="size-4" />
                  )}
                  {t('continueAsGuest')}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* New Chat */}
      <div className="px-3 pt-3">
        <div className="flex rounded-md border border-border bg-background shadow-xs overflow-hidden">
          <Button
            variant="ghost"
            className="flex-1 h-9 rounded-none justify-center text-sm font-medium hover:bg-accent transition-colors duration-200"
            render={<Link href="/" />}
          >
            <Plus className="size-4" />
            {t('newChat')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('newChatOptions')}
              className="w-9 flex items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-200"
            >
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href="/" />} className="gap-2.5">
                  <Plus className="size-4" />
                  {t('blankChat')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2.5"
                  onClick={() => setGithubIconOpen(true)}
                >
                  <GithubLogo className="size-4" />
                  {t('importGithub')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-3 pt-4 flex flex-col gap-0.5" aria-label={t('home')}>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="group/search flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-200"
        >
          <Search className="size-4" />
          {t('search')}
          <kbd className="ml-auto hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground/70 group-hover/search:inline-flex md:inline-flex">
            ⌘K
          </kbd>
        </button>
        {navItems.map((item) => {
          const isActive =
            (item.key === 'home' && activePath === '/') ||
            (item.key === 'projects' && activePath === '/projects') ||
            (item.key === 'team' && activePath.startsWith('/teams')) ||
            (item.key === 'plugins' && activePath.startsWith('/plugins'))
          return (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => router.prefetch(item.href)}
              onClick={() => navigateTo(item.href)}
              className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all duration-150 active:scale-[0.98] text-left w-full ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
              }`}
            >
              <item.icon className="size-4" />
              {t(item.key)}
            </button>
          )
        })}

        <div className="my-1 h-px bg-sidebar-border" />

        {resourceItems.map((item) => {
          const isActive = activePath === item.href || activePath.startsWith(item.href + '/')
          return (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => router.prefetch(item.href)}
              onClick={() => navigateTo(item.href)}
              className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all duration-150 active:scale-[0.98] text-left w-full ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
              }`}
            >
              <item.icon className="size-4" />
              {t(item.key)}
            </button>
          )
        })}
      </nav>

      {/* Chat sections */}
      <div className="px-3 pt-6 flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        <button
          type="button"
          onClick={() => setFavoritesOpen((open) => !open)}
          aria-expanded={favoritesOpen}
          className="flex items-center justify-between px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          {t('favorites')}
          <ChevronRight className={`size-3.5 transition-transform duration-200 ${favoritesOpen ? 'rotate-90' : ''}`} />
        </button>
        {favoritesOpen && (
          <div className="flex flex-col gap-0.5 pb-2">
            {favoriteChats.map((chat) => (
              <ChatRow
                key={`favorite-${chat.id}`}
                chat={chat}
                isActive={activeChatId === chat.id}
                isRenaming={renamingId === chat.id}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                onRename={() => handleRename(chat.id)}
                onCancelRename={() => setRenamingId(null)}
                onStartRename={() => {
                  setRenameValue(chat.title)
                  setRenamingId(chat.id)
                }}
                onToggleFavorite={() => handleToggleFavorite(chat)}
                onDelete={() => handleDelete(chat.id)}
                t={t}
              />
            ))}
            {favoriteChats.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('noFavorites')}</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setRecentOpen((open) => !open)}
          aria-expanded={recentOpen}
          className="flex items-center justify-between px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          {t('recentChats')}
          <ChevronRight className={`size-3.5 transition-transform duration-200 ${recentOpen ? 'rotate-90' : ''}`} />
        </button>
        {recentOpen && (
          <div className="flex flex-col gap-0.5">
            {chatList?.map((chat) => (
              <ChatRow
                key={`recent-${chat.id}`}
                chat={chat}
                isActive={activeChatId === chat.id}
                isRenaming={renamingId === chat.id}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                onRename={() => handleRename(chat.id)}
                onCancelRename={() => setRenamingId(null)}
                onStartRename={() => {
                  setRenameValue(chat.title)
                  setRenamingId(chat.id)
                }}
                onToggleFavorite={() => handleToggleFavorite(chat)}
                onDelete={() => handleDelete(chat.id)}
                t={t}
              />
            ))}
            {chatList && chatList.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('noRecentChats')}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto px-3 pb-3 flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-200 min-w-0">
            <AccountAvatar image={userImage} name={userName} />
            <span className="truncate">{userName}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-64 animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <div className="px-2 py-1.5 flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {userName}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {isAnonymous ? t('guest') : userEmail}
                {userTag ? ` · @${userTag}` : ''}
              </span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2.5"
                render={<Link href="/profile" prefetch={true} />}
              >
                <User className="size-4" />
                {t('profile')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2.5"
                onClick={() => navigateTo('/settings')}
                onMouseEnter={() => {
                  router.prefetch('/settings')
                  prefetchSettingsData()
                }}
              >
                <Settings className="size-4" />
                {t('settings')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2.5">
                  <Languages className="size-4" />
                  {t('language')}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {LANGUAGES.find((item) => item.code === language)?.label}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuGroup>
                    {LANGUAGES.map((item) => (
                      <DropdownMenuItem
                        key={item.code}
                        closeOnClick={false}
                        onClick={() => setLanguage(item.code)}
                        className="gap-2.5"
                      >
                        {item.label}
                        {language === item.code && <Check className="ml-auto size-4" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              disabled={signingOut}
              className="gap-2.5"
            >
              <LogOut className="size-4" />
              {signingOut ? t('signingOut') : t('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="px-2.5 py-1 rounded-md border border-border bg-background text-xs text-foreground shrink-0">
          {t('free')}
        </span>
      </div>

      </Activity>
      </div>
    </aside>
    <GithubIconImportDialog open={githubOpen} onOpenChange={setGithubIconOpen} />
    <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} chats={chatList ?? []} />
    </>
  )
}
