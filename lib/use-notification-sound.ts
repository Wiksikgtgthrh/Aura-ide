'use client'

import { useCallback } from 'react'

/**
 * Returns a `play` function that emits a short two-tone chime using the
 * Web Audio API — no external file required.
 */
export function useNotificationSound(enabled: boolean) {
  const play = useCallback(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    // Only play when the tab/window is not focused
    if (document.visibilityState === 'visible') return

    try {
      const ctx = new AudioContext()

      const tones = [
        { freq: 880, start: 0,    duration: 0.12 },
        { freq: 1320, start: 0.13, duration: 0.14 },
      ]

      for (const tone of tones) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.type = 'sine'
        osc.frequency.value = tone.freq

        const t0 = ctx.currentTime + tone.start
        gain.gain.setValueAtTime(0, t0)
        gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + tone.duration)

        osc.start(t0)
        osc.stop(t0 + tone.duration)
      }

      // Close the context shortly after so we don't leak resources
      setTimeout(() => ctx.close(), 600)
    } catch {
      // AudioContext not supported or blocked — silently ignore
    }
  }, [enabled])

  return play
}
