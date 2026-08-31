'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { usePathname } from 'next/navigation'

export type Section =
  | 'profile'
  | 'preferences'
  | 'general'
  | 'memories'
  | 'plugins'
  | 'skills'
  | 'integrations'
  | 'billing'
  | 'api-keys'
  | 'usage'
  | 'members'

const VALID_SECTIONS = new Set<Section>([
  'profile', 'preferences', 'general', 'memories', 'plugins',
  'skills', 'integrations', 'billing', 'api-keys', 'usage', 'members',
])

function getSectionFromUrl(): Section {
  if (typeof window === 'undefined') return 'preferences'
  const param = new URLSearchParams(window.location.search).get('section')
  if (param && VALID_SECTIONS.has(param as Section)) return param as Section
  return 'preferences'
}

type SettingsContextValue = {
  section: Section
  setSection: (s: Section) => void
}

const SettingsContext = createContext<SettingsContextValue>({
  section: 'preferences',
  setSection: () => {},
})

export function SettingsProvider({
  children,
  initialSection,
}: {
  children: React.ReactNode
  initialSection: string
}) {
  const [section, setSection] = useState<Section>(
    (initialSection as Section) ?? 'preferences',
  )
  const pathname = usePathname()

  // When navigating to /settings (including direct URL with ?section=…),
  // sync the active section from the URL so deep-links work correctly.
  useEffect(() => {
    if (pathname.startsWith('/settings')) {
      setSection(getSectionFromUrl())
    }
  }, [pathname])

  const handleSetSection = useCallback((s: Section) => {
    setSection(s)
    // Update the URL bar without triggering any Next.js re-render or server round-trip
    window.history.pushState(null, '', `/settings?section=${s}`)
  }, [])

  return (
    <SettingsContext.Provider value={{ section, setSection: handleSetSection }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
