import { betterAuth } from 'better-auth'
import { username, anonymous, multiSession } from 'better-auth/plugins'
import { pool } from '@/lib/db'
import { sendEmail, emailLayout } from '@/lib/email'
import { migrateGuestData } from '@/lib/migrate-guest'

export const auth = betterAuth({
  database: pool,
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
    }),
    anonymous({
      // A guest who signs up keeps EVERYTHING: chats, project files, own API
      // keys, memories, preferences, plugins, teams. Without this hook the
      // plugin deletes the anonymous user and the cascades wipe their data.
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await migrateGuestData(anonymousUser.user.id, newUser.user.id)
      },
    }),
    multiSession({ maximumSessions: 5 }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (userData) => {
          // Guests get a unique auto-generated tag
          const u = userData as Record<string, unknown>
          if (u.isAnonymous && !u.username) {
            const tag = `guest_${Math.random().toString(36).slice(2, 8)}`
            return {
              data: { ...userData, username: tag, displayUsername: tag },
            }
          }
        },
      },
    },
  },
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Aura — сброс пароля',
        html: emailLayout(
          'Сброс пароля',
          'Вы запросили сброс пароля для аккаунта Aura. Нажмите на кнопку ниже, чтобы задать новый пароль. Ссылка действует 1 час.',
          { label: 'Сбросить пароль', url },
        ),
        text: `Сброс пароля Aura: ${url}`,
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Aura — подтвердите email',
        html: emailLayout(
          'Подтвердите email',
          'Добро пожаловать в Aura! Подтвердите свой email, нажав на кнопку ниже.',
          { label: 'Подтвердить email', url },
        ),
        text: `Подтверждение email Aura: ${url}`,
      })
    },
  },
  trustedOrigins: [
    'http://localhost:3000',
    'https://*.vusercontent.net',
    ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
      : []),
  ],
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  // Abuse protection: without this a script could create unlimited guest
  // accounts, spam password-reset emails and brute-force sign-in. Limits are
  // per client IP over a sliding window (in-memory by default).
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 60, // default: 60 auth requests / minute / IP
    customRules: {
      '/sign-up/email': { window: 3600, max: 10 }, // 10 new accounts / hour / IP
      '/sign-in/email': { window: 60, max: 10 }, // brute-force guard
      '/sign-in/anonymous': { window: 3600, max: 15 }, // guest-spam guard
      '/request-password-reset': { window: 3600, max: 5 }, // reset-email spam
      '/forget-password': { window: 3600, max: 5 },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  advanced: {
    // v0 preview runs inside an iframe on a different origin, so cookies
    // must be SameSite=None; Secure there. On a regular deployment (own
    // server/VPS, localhost) SameSite=None+Secure cookies are REJECTED over
    // plain http — the session silently fails to persist and sign-in/guest
    // login look broken. Only force cross-site attributes in the v0 runtime.
    defaultCookieAttributes: process.env.V0_RUNTIME_URL
      ? {
          sameSite: 'none' as const,
          secure: true,
        }
      : {
          sameSite: 'lax' as const,
        },
  },
})
