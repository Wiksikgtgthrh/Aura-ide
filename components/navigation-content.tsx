'use client'

import type { ReactNode } from 'react'

/**
 * Client wrapper for the main content area.
 * The active nav button highlights instantly via optimisticPath in AppSidebar,
 * so no opacity dimming is needed — the sidebar already gives instant feedback.
 */
export function NavigationContent({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {children}
    </div>
  )
}
