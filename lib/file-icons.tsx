'use client'

/**
 * Иконки файлов по расширению — тонкий маппинг на цветные lucide-иконки.
 * Задача не «идеальная VS-Code раскраска», а «понятно, что за файл».
 * Ничего тяжёлого (никаких SVG-спрайтов) — только цветные lucide.
 */

import {
  Braces,
  Code2,
  Database,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileLock2,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType2,
  FileVideo,
  Palette,
  Settings,
  Sparkles,
  Type,
  FolderClosed,
  FolderOpen,
  Boxes,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

export type IconSpec = { Icon: ComponentType<SVGProps<SVGSVGElement>>; className: string }

const EXT: Record<string, IconSpec> = {
  ts: { Icon: FileType2, className: 'text-sky-500' },
  tsx: { Icon: FileType2, className: 'text-sky-500' },
  js: { Icon: FileCode2, className: 'text-amber-400' },
  jsx: { Icon: FileCode2, className: 'text-amber-400' },
  mjs: { Icon: FileCode2, className: 'text-amber-400' },
  cjs: { Icon: FileCode2, className: 'text-amber-400' },
  rs: { Icon: FileCode2, className: 'text-orange-500' },
  go: { Icon: FileCode2, className: 'text-cyan-400' },
  py: { Icon: FileCode2, className: 'text-yellow-400' },
  rb: { Icon: FileCode2, className: 'text-rose-500' },
  java: { Icon: FileCode2, className: 'text-orange-400' },
  kt: { Icon: FileCode2, className: 'text-purple-400' },
  swift: { Icon: FileCode2, className: 'text-orange-400' },
  cs: { Icon: FileCode2, className: 'text-emerald-500' },
  c: { Icon: FileCode2, className: 'text-blue-400' },
  h: { Icon: FileCode2, className: 'text-blue-400' },
  cpp: { Icon: FileCode2, className: 'text-blue-500' },
  hpp: { Icon: FileCode2, className: 'text-blue-500' },
  php: { Icon: FileCode2, className: 'text-indigo-400' },
  json: { Icon: FileJson, className: 'text-amber-500' },
  jsonc: { Icon: FileJson, className: 'text-amber-500' },
  toml: { Icon: Settings, className: 'text-orange-400' },
  yaml: { Icon: Settings, className: 'text-red-400' },
  yml: { Icon: Settings, className: 'text-red-400' },
  xml: { Icon: Code2, className: 'text-orange-400' },
  html: { Icon: Code2, className: 'text-orange-500' },
  htm: { Icon: Code2, className: 'text-orange-500' },
  svg: { Icon: FileImage, className: 'text-purple-400' },
  css: { Icon: Palette, className: 'text-blue-400' },
  scss: { Icon: Palette, className: 'text-pink-400' },
  sass: { Icon: Palette, className: 'text-pink-400' },
  less: { Icon: Palette, className: 'text-blue-400' },
  md: { Icon: FileText, className: 'text-sky-300' },
  mdx: { Icon: FileText, className: 'text-sky-300' },
  txt: { Icon: FileText, className: 'text-zinc-400' },
  log: { Icon: FileText, className: 'text-zinc-500' },
  sh: { Icon: FileTerminal, className: 'text-green-400' },
  bash: { Icon: FileTerminal, className: 'text-green-400' },
  zsh: { Icon: FileTerminal, className: 'text-green-400' },
  fish: { Icon: FileTerminal, className: 'text-green-400' },
  ps1: { Icon: FileTerminal, className: 'text-blue-400' },
  sql: { Icon: Database, className: 'text-indigo-400' },
  db: { Icon: Database, className: 'text-indigo-400' },
  sqlite: { Icon: Database, className: 'text-indigo-400' },
  env: { Icon: FileLock2, className: 'text-amber-400' },
  key: { Icon: FileLock2, className: 'text-amber-400' },
  pem: { Icon: FileLock2, className: 'text-amber-400' },
  csv: { Icon: FileSpreadsheet, className: 'text-emerald-400' },
  tsv: { Icon: FileSpreadsheet, className: 'text-emerald-400' },
  xlsx: { Icon: FileSpreadsheet, className: 'text-emerald-500' },
  png: { Icon: FileImage, className: 'text-purple-400' },
  jpg: { Icon: FileImage, className: 'text-purple-400' },
  jpeg: { Icon: FileImage, className: 'text-purple-400' },
  gif: { Icon: FileImage, className: 'text-purple-400' },
  webp: { Icon: FileImage, className: 'text-purple-400' },
  ico: { Icon: FileImage, className: 'text-purple-400' },
  mp3: { Icon: FileAudio, className: 'text-pink-400' },
  wav: { Icon: FileAudio, className: 'text-pink-400' },
  ogg: { Icon: FileAudio, className: 'text-pink-400' },
  flac: { Icon: FileAudio, className: 'text-pink-400' },
  mp4: { Icon: FileVideo, className: 'text-fuchsia-400' },
  mov: { Icon: FileVideo, className: 'text-fuchsia-400' },
  webm: { Icon: FileVideo, className: 'text-fuchsia-400' },
  mkv: { Icon: FileVideo, className: 'text-fuchsia-400' },
  zip: { Icon: FileArchive, className: 'text-yellow-500' },
  gz: { Icon: FileArchive, className: 'text-yellow-500' },
  tar: { Icon: FileArchive, className: 'text-yellow-500' },
  '7z': { Icon: FileArchive, className: 'text-yellow-500' },
  rar: { Icon: FileArchive, className: 'text-yellow-500' },
  vue: { Icon: FileCode2, className: 'text-emerald-400' },
  svelte: { Icon: FileCode2, className: 'text-orange-500' },
  astro: { Icon: FileCode2, className: 'text-orange-400' },
  lock: { Icon: FileLock2, className: 'text-zinc-500' },
  woff: { Icon: Type, className: 'text-purple-300' },
  woff2: { Icon: Type, className: 'text-purple-300' },
  ttf: { Icon: Type, className: 'text-purple-300' },
  otf: { Icon: Type, className: 'text-purple-300' },
}

// Точечные имена (по всему basename), а не только по расширению.
const NAME: Record<string, IconSpec> = {
  'package.json': { Icon: Boxes, className: 'text-red-400' },
  'pnpm-lock.yaml': { Icon: FileLock2, className: 'text-amber-500' },
  'yarn.lock': { Icon: FileLock2, className: 'text-blue-400' },
  'package-lock.json': { Icon: FileLock2, className: 'text-red-400' },
  'tsconfig.json': { Icon: Braces, className: 'text-sky-400' },
  'next.config.mjs': { Icon: Settings, className: 'text-zinc-300' },
  'next.config.js': { Icon: Settings, className: 'text-zinc-300' },
  'tailwind.config.js': { Icon: Palette, className: 'text-cyan-400' },
  'tailwind.config.ts': { Icon: Palette, className: 'text-cyan-400' },
  'dockerfile': { Icon: Boxes, className: 'text-blue-400' },
  'docker-compose.yml': { Icon: Boxes, className: 'text-blue-400' },
  '.gitignore': { Icon: Settings, className: 'text-orange-400' },
  '.env': { Icon: FileLock2, className: 'text-amber-400' },
  '.env.local': { Icon: FileLock2, className: 'text-amber-400' },
  'readme.md': { Icon: Sparkles, className: 'text-emerald-400' },
  'license': { Icon: FileText, className: 'text-yellow-400' },
  'cargo.toml': { Icon: Settings, className: 'text-orange-500' },
  'cargo.lock': { Icon: FileLock2, className: 'text-orange-500' },
}

const DEFAULT: IconSpec = { Icon: FileText, className: 'text-zinc-400' }

export function iconForFile(name: string): IconSpec {
  const lower = name.toLowerCase()
  const byName = NAME[lower]
  if (byName) return byName
  const ext = lower.slice(lower.lastIndexOf('.') + 1)
  return EXT[ext] ?? DEFAULT
}

export function iconForFolder(open: boolean): IconSpec {
  return open
    ? { Icon: FolderOpen, className: 'text-sky-400' }
    : { Icon: FolderClosed, className: 'text-sky-500' }
}
