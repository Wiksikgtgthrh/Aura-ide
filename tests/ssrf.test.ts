import { describe, expect, it } from 'vitest'
import { isSafeFetchUrl, assertSafeFetchUrl } from '../lib/ssrf'

// Literal IPs / hostnames are classified WITHOUT DNS, so these are
// deterministic in the sandbox (public domains would need live DNS).
describe('SSRF guard', () => {
  it('блокирует loopback / метаданные / приватные / схемы / креды', async () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1/v1',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/v1',
      'http://192.168.1.10/v1',
      'http://172.16.4.4/v1',
      'http://100.100.0.1/v1', // CGNAT
      'http://[::1]/v1',
      'http://[fd00::1]/v1', // unique-local v6
      'file:///etc/passwd',
      'http://user:pass@8.8.8.8/v1', // creds
    ]) {
      expect(await isSafeFetchUrl(url), url).toBe(false)
    }
  })

  it('пропускает публичный литеральный IP', async () => {
    expect(await isSafeFetchUrl('https://8.8.8.8/v1')).toBe(true)
    expect(await isSafeFetchUrl('https://1.1.1.1/v1')).toBe(true)
  })

  it('assertSafeFetchUrl бросает на приватном', async () => {
    await expect(assertSafeFetchUrl('http://127.0.0.1')).rejects.toThrow()
  })
})
