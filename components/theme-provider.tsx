'use client'

import { useEffect } from 'react'

function readThemeCookie(): string {
  if (typeof document === 'undefined') return 'system'
  const m = document.cookie.match(/aura-theme=([^;]+)/)
  return m ? m[1] : 'system'
}

/**
 * Applies and persists the user theme preference.
 *
 * The theme is read from the aura-theme cookie on the client (set by
 * savePreferences on the server). An inline <script> in the root layout
 * applies the class before first paint to prevent FOUC, and this component
 * keeps it reactive to preference changes via the custom `theme-change` event.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement

    const apply = (t: string) => {
      root.classList.remove('light', 'dark')
      if (t === 'light' || t === 'dark') root.classList.add(t)
      // 'system' — no class, CSS prefers-color-scheme handles it
    }

    // Apply current cookie value on mount
    apply(readThemeCookie())

    // Listen for explicit theme-change events dispatched by savePreferences
    const handleChange = (e: Event) => {
      const t = (e as CustomEvent<string>).detail
      document.cookie = `aura-theme=${t}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
      apply(t)
    }
    window.addEventListener('theme-change', handleChange)

    // System media query listener (active when theme === 'system')
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMedia = () => { if (readThemeCookie() === 'system') apply('system') }
    mq.addEventListener('change', handleMedia)

    return () => {
      window.removeEventListener('theme-change', handleChange)
      mq.removeEventListener('change', handleMedia)
    }
  }, [])

  return <>{children}</>
}
