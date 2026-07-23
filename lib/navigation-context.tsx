'use client'

import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

/**
 * Routes whose content is pre-mounted in <Activity> shells inside
 * AppContentArea (see components/app-content-area.tsx). Navigating between
 * them only needs a URL change — the content is already on the client, so a
 * server RSC round-trip would add pure latency for nothing.
 *
 * For these we use window.history.pushState (officially supported by the
 * App Router: usePathname()/useSearchParams() sync automatically), making
 * the transition instant even on a cold or slow server.
 */
const SHALLOW_ROUTES = new Set(['/', '/projects', '/teams', '/plugins', '/settings'])

function isShallow(href: string): boolean {
  const path = href.split('?')[0]
  return SHALLOW_ROUTES.has(path)
}

/**
 * True when the current location renders inside the (app) shell layout.
 * pushState-navigation to a shallow route is only safe from these paths —
 * everything here shares the same layout, and AppContentArea resolves what
 * to show purely from usePathname(). Routes with their own layouts
 * (/profile, /my-api, /free, /sign-in, /teams/invite/…) need a real push.
 */
function inAppShell(path: string): boolean {
  if (SHALLOW_ROUTES.has(path)) return true
  if (path.startsWith('/chat/')) return true
  if (path.startsWith('/plugins/')) return true
  if (path.startsWith('/settings')) return true
  if (path.startsWith('/teams/')) return !path.startsWith('/teams/invite')
  return false
}

interface NavigationCtx {
  /** True while a router.push() transition is in-flight. */
  isPending: boolean
  /** Navigate to href — instant shallow pushState for Activity-backed routes. */
  navigate: (href: string) => void
}

const NavigationContext = createContext<NavigationCtx>({
  isPending: false,
  navigate: () => {},
})

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const navigate = useCallback(
    (href: string) => {
      if (
        typeof window !== 'undefined' &&
        isShallow(href) &&
        inAppShell(window.location.pathname)
      ) {
        // Pure client-side toggle between pre-mounted Activity shells:
        // zero network, zero RSC — the pathname change flips visibility.
        window.history.pushState(null, '', href)
        return
      }
      // Dynamic routes (/chat/[id], /teams/[id], …) still need real navigation.
      startTransition(() => router.push(href))
    },
    [router],
  )

  return (
    <NavigationContext.Provider value={{ isPending, navigate }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  return useContext(NavigationContext)
}
