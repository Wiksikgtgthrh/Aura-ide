import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { LanguageProvider } from '@/lib/language'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Aura — ИИ-среда разработки',
  description: 'Расширяемая среда разработки с ИИ и поддержкой плагинов',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className="bg-background">
      <head>
        {/*
          Reads the aura-theme cookie synchronously before first paint to
          prevent theme flash (FOUC). No server round-trip needed — the cookie
          is written by ThemeProvider on the client and savePreferences() on
          every save. Runs as an inline blocking script so it executes before
          any CSS or React hydration.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=document.cookie.match(/aura-theme=([^;]+)/);if(t){var v=t[1];if(v==='light'||v==='dark')document.documentElement.classList.add(v);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
