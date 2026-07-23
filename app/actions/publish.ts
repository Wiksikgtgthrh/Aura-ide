'use server'

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userSecrets } from '@/lib/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { getSession } from '@/lib/session'

/**
 * Publish the scaffolded project to the user's GitHub account.
 *
 * Uses the REST API with the user's Personal Access Token (scope: repo):
 *   1. resolve the authenticated login
 *   2. create the repository (auto_init) — or reuse it if it already exists
 *   3. build a git tree with every project file and commit it in ONE commit
 *   4. fast-forward the default branch to the new commit
 *
 * The token is passed per-request from the client (kept in localStorage on
 * the user's machine) and is never persisted server-side.
 */

const GH = 'https://api.github.com'

type PublishInput = {
  token: string
  repoName: string
  description?: string
  isPrivate: boolean
  files: Record<string, string>
  commitMessage?: string
}

export type PublishResult =
  | { ok: true; htmlUrl: string; commitUrl: string }
  | { ok: false; error: string }

async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aura-ide-publish',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { status: res.status, data }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function publishToGithub(input: PublishInput): Promise<PublishResult> {
  const session = await getSession()
  if (!session?.user) return { ok: false, error: 'Unauthorized' }

  // Explicit token from the dialog, else the encrypted one saved in
  // Settings → Integrations.
  let token = input.token?.trim()
  if (!token) {
    const [row] = await db
      .select({ secret: userSecrets.secret })
      .from(userSecrets)
      .where(
        and(eq(userSecrets.userId, session.user.id), eq(userSecrets.provider, 'github')),
      )
      .limit(1)
    if (row) token = decryptSecret(row.secret)
  }
  if (!token) return { ok: false, error: 'GitHub token is required — добавьте его в Настройки → Интеграции' }

  const repoName = input.repoName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  if (!repoName) return { ok: false, error: 'Repository name is required' }

  const fileEntries = Object.entries(input.files).filter(
    ([p, c]) => p && typeof c === 'string',
  )
  if (fileEntries.length === 0) return { ok: false, error: 'Project has no files yet' }
  // Git Data API accepts inline content; keep the payload sane (~3 MB).
  const totalSize = fileEntries.reduce((n, [, c]) => n + c.length, 0)
  if (totalSize > 3_000_000) {
    return { ok: false, error: 'Project is too large to publish (>3 MB)' }
  }

  try {
    // 1. Who am I?
    const me = await gh<{ login?: string; message?: string }>(token, 'GET', '/user')
    if (me.status === 401) return { ok: false, error: 'Invalid GitHub token (401)' }
    if (!me.data.login) {
      return { ok: false, error: `GitHub error: ${me.data.message ?? me.status}` }
    }
    const owner = me.data.login

    // 2. Create repo (or reuse existing).
    let defaultBranch = 'main'
    const created = await gh<{ default_branch?: string; message?: string; errors?: Array<{ message?: string }> }>(
      token,
      'POST',
      '/user/repos',
      {
        name: repoName,
        description: input.description?.slice(0, 250) || 'Built with Aura IDE',
        private: input.isPrivate,
        auto_init: true,
      },
    )

    if (created.status === 201) {
      defaultBranch = created.data.default_branch ?? 'main'
      // Give GitHub a moment to materialise the initial commit.
      await sleep(800)
    } else if (created.status === 422) {
      // Repo already exists — publish a new commit into it.
      const existing = await gh<{ default_branch?: string; message?: string }>(
        token,
        'GET',
        `/repos/${owner}/${repoName}`,
      )
      if (existing.status !== 200) {
        return {
          ok: false,
          error: `Repository name is taken and inaccessible: ${existing.data.message ?? existing.status}`,
        }
      }
      defaultBranch = existing.data.default_branch ?? 'main'
    } else if (created.status === 403) {
      return {
        ok: false,
        error: 'GitHub refused repo creation (403). The token needs the "repo" scope.',
      }
    } else {
      const detail =
        created.data.errors?.[0]?.message ?? created.data.message ?? String(created.status)
      return { ok: false, error: `Could not create repository: ${detail}` }
    }

    // 3. HEAD commit of the default branch (retry — fresh repos lag briefly).
    let headSha: string | null = null
    for (let attempt = 0; attempt < 5 && !headSha; attempt++) {
      const ref = await gh<{ object?: { sha?: string } }>(
        token,
        'GET',
        `/repos/${owner}/${repoName}/git/ref/heads/${defaultBranch}`,
      )
      headSha = ref.data.object?.sha ?? null
      if (!headSha) await sleep(700)
    }
    if (!headSha) {
      return { ok: false, error: 'Repository was created but its branch is not ready yet — retry in a few seconds' }
    }

    const headCommit = await gh<{ tree?: { sha?: string } }>(
      token,
      'GET',
      `/repos/${owner}/${repoName}/git/commits/${headSha}`,
    )
    const baseTree = headCommit.data.tree?.sha

    // 4. One tree with every file.
    const tree = await gh<{ sha?: string; message?: string }>(
      token,
      'POST',
      `/repos/${owner}/${repoName}/git/trees`,
      {
        base_tree: baseTree,
        tree: fileEntries.map(([path, content]) => ({
          path: path.replace(/^\/+/, ''),
          mode: path.endsWith('.sh') ? '100755' : '100644',
          type: 'blob',
          content,
        })),
      },
    )
    if (!tree.data.sha) {
      return { ok: false, error: `Failed to build git tree: ${tree.data.message ?? tree.status}` }
    }

    // 5. Commit + move the branch.
    const commit = await gh<{ sha?: string; message?: string }>(
      token,
      'POST',
      `/repos/${owner}/${repoName}/git/commits`,
      {
        message: input.commitMessage?.slice(0, 200) || 'Publish from Aura IDE',
        tree: tree.data.sha,
        parents: [headSha],
      },
    )
    if (!commit.data.sha) {
      return { ok: false, error: `Failed to create commit: ${commit.data.message ?? commit.status}` }
    }

    const refUpdate = await gh<{ message?: string }>(
      token,
      'PATCH',
      `/repos/${owner}/${repoName}/git/refs/heads/${defaultBranch}`,
      { sha: commit.data.sha, force: false },
    )
    if (refUpdate.status !== 200) {
      return { ok: false, error: `Failed to update branch: ${refUpdate.data.message ?? refUpdate.status}` }
    }

    return {
      ok: true,
      htmlUrl: `https://github.com/${owner}/${repoName}`,
      commitUrl: `https://github.com/${owner}/${repoName}/commit/${commit.data.sha}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Network error while talking to GitHub: ${msg}` }
  }
}
