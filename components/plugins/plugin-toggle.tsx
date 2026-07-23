'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { togglePlugin } from '@/app/actions/plugins'

export function PluginToggle({
  pluginId,
  enabled,
  onToggle,
}: {
  pluginId: string
  enabled: boolean
  onToggle?: (enabled: boolean) => void
}) {
  const [optimistic, setOptimistic] = useState(enabled)
  const [busy, setBusy] = useState(false)

  const handleChange = async (checked: boolean) => {
    setOptimistic(checked)
    setBusy(true)
    try {
      await togglePlugin(pluginId, checked)
      onToggle?.(checked)
    } catch {
      setOptimistic(!checked)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Switch
      checked={optimistic}
      onCheckedChange={handleChange}
      disabled={busy}
      aria-label={optimistic ? 'Выключить плагин' : 'Включить плагин'}
    />
  )
}
