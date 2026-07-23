'use client'

import { createAuthClient } from 'better-auth/react'
import {
  usernameClient,
  anonymousClient,
  multiSessionClient,
} from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [usernameClient(), anonymousClient(), multiSessionClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
