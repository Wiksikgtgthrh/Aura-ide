import { describe, expect, it } from 'vitest'
import { buildZip } from '../lib/zip'

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('buildZip — валидный ZIP без зависимостей', () => {
  it('содержит сигнатуры local header и EOCD, имена и контент', async () => {
    const b = await bytes(
      buildZip({ 'a.txt': 'hello', 'dir/b.sh': '#!/bin/sh\necho ok' }),
    )
    // local file header signature PK\x03\x04
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const s = Buffer.from(b).toString('latin1')
    expect(s).toContain('a.txt')
    expect(s).toContain('dir/b.sh')
    expect(s).toContain('hello')
    // EOCD signature PK\x05\x06 with entry count 2
    const eocd = s.lastIndexOf('PK\x05\x06')
    expect(eocd).toBeGreaterThan(0)
    expect(b[eocd + 10]).toBe(2) // total entries (LE u16 low byte)
  })

  it('deploy.sh получает исполняемый бит в central directory', async () => {
    const b = Buffer.from(await bytes(buildZip({ 'deploy.sh': 'echo hi' })))
    const cd = b.indexOf(Buffer.from('PK\x01\x02', 'latin1'))
    expect(cd).toBeGreaterThan(0)
    // external attrs at offset 38..41 of central header; unix mode in high 16 bits
    const externalAttrs = b.readUInt32LE(cd + 38)
    const mode = externalAttrs >>> 16
    expect(mode & 0o111).toBeGreaterThan(0) // any exec bit
  })
})
