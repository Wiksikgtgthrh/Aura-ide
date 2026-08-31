'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { MoreHorizontal, Star, Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ChatListItem } from '@/lib/chat-store'
import type { useLanguage } from '@/lib/language'

export function ChatRow({
  chat,
  isActive,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRename,
  onCancelRename,
  onStartRename,
  onToggleFavorite,
  onDelete,
  t,
}: {
  chat: ChatListItem
  isActive: boolean
  isRenaming: boolean
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRename: () => void
  onCancelRename: () => void
  onStartRename: () => void
  onToggleFavorite: () => void
  onDelete: () => void
  t: ReturnType<typeof useLanguage>['t']
}) {
  const router = useRouter()
  const prefetch = useCallback(() => {
    router.prefetch(`/chat/${chat.id}`)
  }, [router, chat.id])

  return (
    <div className="group/chat relative flex items-center" onMouseEnter={prefetch} onFocus={prefetch}>
      {isRenaming ? (
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onBlur={onRename}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter') onRename()
            else if (event.key === 'Escape') onCancelRename()
          }}
          className="flex-1 h-7 px-2 rounded-md bg-background border border-border text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <>
          <Link
            href={`/chat/${chat.id}`}
            className={`flex-1 truncate pl-2 pr-8 py-1.5 rounded-md text-sm transition-colors duration-200 ${
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
          >
            {chat.title}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('chatOptions')}
              className="absolute right-1 size-6 flex items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-200 group-hover/chat:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 hover:bg-sidebar-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuItem className="gap-2.5" onClick={onToggleFavorite}>
                  <Star className={chat.favorite ? 'size-4 fill-current' : 'size-4'} />
                  {chat.favorite ? t('removeFromFavorites') : t('addToFavorites')}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2.5" onClick={onStartRename}>
                  <Pencil className="size-4" />
                  {t('renameChatLabel')}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2.5 text-destructive" onClick={onDelete}>
                  <Trash2 className="size-4" />
                  {t('deleteChatLabel')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}
