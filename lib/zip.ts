/**
 * Minimal ZIP builder (STORE method, no compression) — zero dependencies.
 * Good enough for project exports of text files; produces a standards-
 * compliant archive that unzip / Finder / Explorer / tar all accept.
 * Shell scripts get the executable bit via unix external attributes.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getSeconds() >> 1) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f)
  return { time, date }
}

class ByteWriter {
  private chunks: Uint8Array[] = []
  private len = 0

  get length() {
    return this.len
  }

  bytes(b: Uint8Array) {
    this.chunks.push(b)
    this.len += b.length
  }

  u16(v: number) {
    const b = new Uint8Array(2)
    b[0] = v & 0xff
    b[1] = (v >>> 8) & 0xff
    this.bytes(b)
  }

  u32(v: number) {
    const b = new Uint8Array(4)
    b[0] = v & 0xff
    b[1] = (v >>> 8) & 0xff
    b[2] = (v >>> 16) & 0xff
    b[3] = (v >>> 24) & 0xff
    this.bytes(b)
  }

  toBlob(): Blob {
    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' })
  }
}

export function buildZip(files: Record<string, string>): Blob {
  const encoder = new TextEncoder()
  const now = dosDateTime(new Date())
  const writer = new ByteWriter()

  type Entry = {
    nameBytes: Uint8Array
    crc: number
    size: number
    offset: number
    executable: boolean
  }
  const entries: Entry[] = []

  for (const [rawPath, content] of Object.entries(files)) {
    const path = rawPath.replace(/^\/+/, '')
    if (!path) continue
    const nameBytes = encoder.encode(path)
    const data = encoder.encode(content)
    const crc = crc32(data)
    const offset = writer.length
    const executable = path.endsWith('.sh')

    // Local file header
    writer.u32(0x04034b50)
    writer.u16(20) // version needed
    writer.u16(0x0800) // UTF-8 names
    writer.u16(0) // method: store
    writer.u16(now.time)
    writer.u16(now.date)
    writer.u32(crc)
    writer.u32(data.length)
    writer.u32(data.length)
    writer.u16(nameBytes.length)
    writer.u16(0) // extra len
    writer.bytes(nameBytes)
    writer.bytes(data)

    entries.push({ nameBytes, crc, size: data.length, offset, executable })
  }

  const cdStart = writer.length

  for (const e of entries) {
    writer.u32(0x02014b50)
    writer.u16(0x031e) // made by: unix, zip 3.0
    writer.u16(20)
    writer.u16(0x0800)
    writer.u16(0)
    writer.u16(now.time)
    writer.u16(now.date)
    writer.u32(e.crc)
    writer.u32(e.size)
    writer.u32(e.size)
    writer.u16(e.nameBytes.length)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0) // disk
    writer.u16(0) // internal attrs
    writer.u32(((e.executable ? 0o100755 : 0o100644) << 16) >>> 0)
    writer.u32(e.offset)
    writer.bytes(e.nameBytes)
  }

  const cdSize = writer.length - cdStart

  // End of central directory
  writer.u32(0x06054b50)
  writer.u16(0)
  writer.u16(0)
  writer.u16(entries.length)
  writer.u16(entries.length)
  writer.u32(cdSize)
  writer.u32(cdStart)
  writer.u16(0)

  return writer.toBlob()
}

/** Trigger a browser download of the given files as a ZIP archive. */
export function downloadZip(files: Record<string, string>, zipName: string) {
  const blob = buildZip(files)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}
