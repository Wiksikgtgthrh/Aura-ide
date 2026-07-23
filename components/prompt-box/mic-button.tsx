'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Mic } from 'lucide-react'
import { useLanguage } from '@/lib/language'

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
}

type SpeechRecognition = EventTarget & {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}
type SpeechRecognitionEvent = { results: SpeechRecognitionResultList }
type SpeechRecognitionResultList = {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
type SpeechRecognitionResult = { isFinal: boolean; [index: number]: { transcript: string } }

export function MicButton({
  onTranscript,
  disabled,
  onListeningChange,
}: {
  onTranscript: (text: string) => void
  disabled?: boolean
  onListeningChange?: (listening: boolean) => void
}) {
  const [listening, setListeningState] = useState(false)
  const setListening = useCallback(
    (v: boolean) => {
      setListeningState(v)
      onListeningChange?.(v)
    },
    [onListeningChange],
  )
  const [supported, setSupported] = useState(true)
  const [micError, setMicError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const { language } = useLanguage()

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) setSupported(false)
  }, [])

  const start = useCallback(async () => {
    setMicError(null)
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) { setMicError('Браузер не поддерживает распознавание речи'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      setMicError('Нет доступа к микрофону. Разрешите доступ или откройте сайт в отдельной вкладке.')
      return
    }
    const rec = new SR()
    rec.lang = language === 'ru' ? 'ru-RU' : 'en-US'
    rec.interimResults = true
    rec.continuous = false
    let interim = ''
    rec.onresult = (event) => {
      let final = ''
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim = r[0].transcript
      }
      if (final) { onTranscript(final.trim()); interim = '' }
      else if (interim) { onTranscript(interim) }
    }
    rec.onend = () => { setListening(false); recognitionRef.current = null }
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicError('Доступ к микрофону заблокирован. Откройте сайт в отдельной вкладке.')
      } else if (event.error === 'no-speech') {
        setMicError('Речь не распознана, попробуйте ещё раз')
      } else if (event.error === 'network') {
        setMicError('Ошибка сети сервиса распознавания')
      } else if (event.error) {
        setMicError(`Ошибка: ${event.error}`)
      }
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    try { rec.start(); setListening(true) } catch { setMicError('Не удалось запустить распознавание'); recognitionRef.current = null }
  }, [language, onTranscript, setListening])

  const stop = useCallback(() => { recognitionRef.current?.stop(); setListening(false) }, [setListening])

  if (!supported) return null

  return (
    <div className="relative">
      {micError && (
        <div role="alert" className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md z-50">
          {micError}
          <button type="button" aria-label="Закрыть" onClick={() => setMicError(null)} className="absolute top-1 right-1.5 text-muted-foreground hover:text-foreground">×</button>
        </div>
      )}
      <button
        type="button"
        aria-label={listening ? 'Stop recording' : 'Voice input'}
        onClick={listening ? stop : start}
        disabled={disabled}
        className={`size-8 flex items-center justify-center rounded-lg transition-all duration-300 active:scale-95 relative overflow-visible ${
          listening
            ? 'bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30'
            : 'bg-foreground text-background hover:opacity-90 hover:scale-105'
        }`}
      >
        {listening ? (
          <>
            {/* Soft breathing rings */}
            <span className="mic-breathe absolute inset-0 rounded-lg bg-destructive/40 pointer-events-none" />
            <span
              className="mic-breathe absolute inset-0 rounded-lg bg-destructive/25 pointer-events-none"
              style={{ animationDelay: '0.8s' }}
            />
            {/* Live equalizer bars */}
            <span className="relative z-10 flex items-end gap-[2px] h-3.5" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="mic-eq-bar w-[2px] h-full rounded-full bg-current"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          </>
        ) : (
          <Mic className="size-4 relative z-10" />
        )}
      </button>
    </div>
  )
}
