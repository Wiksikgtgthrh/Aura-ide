import 'server-only'
import { lookup } from 'node:dns/promises'
import net from 'node:net'

/**
 * SSRF guard for user-supplied base URLs (custom API-key endpoints).
 *
 * Without this, a user could point an API key's baseUrl at an internal
 * address (cloud metadata 169.254.169.254, localhost, the DB, other services)
 * and the server would fetch it — and in /api/chat the response is streamed
 * back, turning it into an internal-network read primitive.
 *
 * We enforce: https/http scheme only, no credentials in URL, and — after DNS
 * resolution — the target must be a public IP (no loopback / private /
 * link-local / unique-local / reserved ranges).
 */

function ipIsBlocked(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map(Number)
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true
    const [a, b] = p
    if (a === 0) return true // 0.0.0.0/8
    if (a === 10) return true // private
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    if (a >= 224) return true // multicast / reserved
    return false
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase()
    if (ip6 === '::1' || ip6 === '::') return true // loopback / unspecified
    if (ip6.startsWith('fe80')) return true // link-local
    if (ip6.startsWith('fc') || ip6.startsWith('fd')) return true // unique-local
    // IPv4-mapped (::ffff:a.b.c.d) → validate the embedded v4
    const mapped = ip6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return ipIsBlocked(mapped[1])
    if (ip6.startsWith('::ffff:')) return true
    return false
  }
  return true // not a literal IP → caller resolves via DNS
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

/**
 * Validate a user base URL. Throws SsrfError when unsafe. Returns the
 * normalized origin+path (trailing slash stripped) when safe.
 */
export async function assertSafeFetchUrl(raw: string): Promise<string> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SsrfError('Invalid URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfError('Only http/https URLs are allowed')
  }
  if (url.username || url.password) {
    throw new SsrfError('Credentials in URL are not allowed')
  }

  const host = url.hostname
  // Literal IP → check directly.
  if (net.isIP(host)) {
    if (ipIsBlocked(host)) throw new SsrfError('Target address is not allowed')
    return raw.replace(/\/+$/, '')
  }

  // Obvious internal hostnames.
  const lower = host.toLowerCase()
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local')
  ) {
    throw new SsrfError('Internal hostnames are not allowed')
  }

  // Resolve every A/AAAA record — all must be public.
  let records: { address: string }[]
  try {
    records = await lookup(host, { all: true })
  } catch {
    throw new SsrfError('Could not resolve host')
  }
  if (records.length === 0) throw new SsrfError('Could not resolve host')
  for (const r of records) {
    if (ipIsBlocked(r.address)) {
      throw new SsrfError('Target resolves to a non-public address')
    }
  }

  return raw.replace(/\/+$/, '')
}

/** Boolean form for callers that just want to skip an unsafe target. */
export async function isSafeFetchUrl(raw: string): Promise<boolean> {
  try {
    await assertSafeFetchUrl(raw)
    return true
  } catch {
    return false
  }
}
