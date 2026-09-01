'use client'

/**
 * Прошивает Monaco нашим LspClient: регистрирует hover/definition/
 * completion/signatureHelp/documentSymbol провайдеры и переводит
 * server-side `publishDiagnostics` в Monaco markers.
 *
 * Работает ПОВЕРХ встроенного Monaco TS-worker'а (мы его отключаем для
 * TS/TSX/JS, чтобы диагностика не дублировалась) — это дороже, но зато
 * ответы приходят из настоящего tsserver, с точным пониманием
 * многофайловых типов, moduleResolution, JSX и т.д.
 */

import type { LspClient } from '@/lib/lsp-client'
import { pathToUri, uriToPath } from '@/lib/lsp-client'

const LSP_LANGS = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'] as const

export function bridgeMonacoToLsp(
  monaco: any,
  client: LspClient,
  opts: { languages?: readonly string[] } = {},
): () => void {
  const disposers: { dispose(): void }[] = []
  const langs = opts.languages ?? LSP_LANGS

  // Гасим встроенную диагностику TS/JS — иначе будет двойная подчёркивание.
  try {
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    })
    monaco.languages.javascript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    })
  } catch {
    /* Monaco старой версии — пропускаем */
  }

  // Diagnostics → markers.
  client.onNotification('textDocument/publishDiagnostics', (params: any) => {
    const uri = params?.uri as string | undefined
    if (!uri) return
    const filePath = uriToPath(uri)
    const model = monaco.editor.getModels().find((m: any) => (m.uri?.fsPath ?? '') === filePath)
    if (!model) return
    const markers = (params?.diagnostics ?? []).map((d: any) => ({
      startLineNumber: (d.range?.start?.line ?? 0) + 1,
      startColumn: (d.range?.start?.character ?? 0) + 1,
      endLineNumber: (d.range?.end?.line ?? 0) + 1,
      endColumn: (d.range?.end?.character ?? 0) + 1,
      message: String(d.message ?? ''),
      severity:
        d.severity === 1
          ? monaco.MarkerSeverity.Error
          : d.severity === 2
            ? monaco.MarkerSeverity.Warning
            : d.severity === 3
              ? monaco.MarkerSeverity.Info
              : monaco.MarkerSeverity.Hint,
      source: d.source ?? 'tsserver',
      code: d.code == null ? undefined : String(d.code),
    }))
    monaco.editor.setModelMarkers(model, 'lsp', markers)
  })

  // Синхронизация текстов: didOpen на создание модели, didChange на правку,
  // didClose при dispose.
  const modelSubs = new Map<any, { dispose(): void }[]>()
  const attachModel = (model: any) => {
    const langId = model.getLanguageId?.() ?? ''
    if (!langs.includes(langId as any)) return
    const path = model.uri?.fsPath ?? uriToPath(model.uri?.toString?.() ?? '')
    void client.didOpen(path, model.getValue(), langId)
    const sub = model.onDidChangeContent(() => {
      void client.didChange(path, model.getValue())
    })
    const disp = model.onWillDispose(() => {
      void client.didClose(path)
    })
    modelSubs.set(model, [sub, disp])
  }
  for (const m of monaco.editor.getModels()) attachModel(m)
  const modelSub = monaco.editor.onDidCreateModel((m: any) => attachModel(m))
  disposers.push(modelSub)

  // Hover provider — сервер отдаёт markdown, Monaco его понимает.
  for (const lang of langs) {
    disposers.push(
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model: any, position: any) => {
          const path = model.uri?.fsPath ?? ''
          if (!path) return null
          const res: any = await client
            .hover(path, position.lineNumber - 1, position.column - 1)
            .catch(() => null)
          if (!res?.contents) return null
          const contents = Array.isArray(res.contents) ? res.contents : [res.contents]
          return {
            contents: contents.map((c: any) => ({
              value: typeof c === 'string' ? c : c?.value ?? String(c?.contents ?? ''),
            })),
          }
        },
      }),
    )

    disposers.push(
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model: any, position: any) => {
          const path = model.uri?.fsPath ?? ''
          if (!path) return null
          const res: any = await client
            .definition(path, position.lineNumber - 1, position.column - 1)
            .catch(() => null)
          const list = Array.isArray(res) ? res : res ? [res] : []
          return list.map((loc: any) => ({
            uri: monaco.Uri.parse(loc.uri ?? loc.targetUri),
            range: rangeFromLsp(loc.range ?? loc.targetSelectionRange),
          }))
        },
      }),
    )

    disposers.push(
      monaco.languages.registerReferenceProvider(lang, {
        provideReferences: async (model: any, position: any) => {
          const path = model.uri?.fsPath ?? ''
          if (!path) return []
          const res: any = await client
            .references(path, position.lineNumber - 1, position.column - 1)
            .catch(() => [])
          return (res ?? []).map((loc: any) => ({
            uri: monaco.Uri.parse(loc.uri),
            range: rangeFromLsp(loc.range),
          }))
        },
      }),
    )

    disposers.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', '"', "'", '/', '@', '<', ':'],
        provideCompletionItems: async (model: any, position: any, context: any) => {
          const path = model.uri?.fsPath ?? ''
          if (!path) return { suggestions: [] }
          const res: any = await client
            .completion(
              path,
              position.lineNumber - 1,
              position.column - 1,
              context?.triggerCharacter,
            )
            .catch(() => null)
          if (!res) return { suggestions: [] }
          const items = Array.isArray(res) ? res : res.items ?? []
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          }
          return {
            incomplete: !!res.isIncomplete,
            suggestions: items.map((it: any) => ({
              label: it.label,
              kind: lspToMonacoKind(monaco, it.kind ?? 1),
              insertText: it.insertText ?? it.label,
              insertTextRules:
                it.insertTextFormat === 2
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : 0,
              detail: it.detail,
              documentation: it.documentation
                ? { value: typeof it.documentation === 'string' ? it.documentation : it.documentation.value }
                : undefined,
              sortText: it.sortText,
              filterText: it.filterText,
              range,
            })),
          }
        },
      }),
    )

    disposers.push(
      monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: async (model: any, position: any) => {
          const path = model.uri?.fsPath ?? ''
          if (!path) return null
          const res: any = await client
            .signatureHelp(path, position.lineNumber - 1, position.column - 1)
            .catch(() => null)
          if (!res?.signatures?.length) return null
          return {
            value: {
              signatures: res.signatures.map((s: any) => ({
                label: s.label,
                documentation: s.documentation
                  ? { value: typeof s.documentation === 'string' ? s.documentation : s.documentation.value }
                  : undefined,
                parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label })),
              })),
              activeSignature: res.activeSignature ?? 0,
              activeParameter: res.activeParameter ?? 0,
            },
            dispose: () => {},
          }
        },
      }),
    )
  }

  return () => {
    for (const d of disposers) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
    }
    for (const subs of modelSubs.values()) {
      for (const s of subs) {
        try {
          s.dispose()
        } catch {
          /* ignore */
        }
      }
    }
    // Уберём наши маркеры.
    try {
      for (const m of monaco.editor.getModels()) {
        monaco.editor.setModelMarkers(m, 'lsp', [])
      }
    } catch {
      /* ignore */
    }
  }
}

function rangeFromLsp(r: any) {
  return {
    startLineNumber: (r?.start?.line ?? 0) + 1,
    startColumn: (r?.start?.character ?? 0) + 1,
    endLineNumber: (r?.end?.line ?? 0) + 1,
    endColumn: (r?.end?.character ?? 0) + 1,
  }
}

function lspToMonacoKind(monaco: any, k: number) {
  const K = monaco.languages.CompletionItemKind
  const map: Record<number, number> = {
    1: K.Text,
    2: K.Method,
    3: K.Function,
    4: K.Constructor,
    5: K.Field,
    6: K.Variable,
    7: K.Class,
    8: K.Interface,
    9: K.Module,
    10: K.Property,
    11: K.Unit,
    12: K.Value,
    13: K.Enum,
    14: K.Keyword,
    15: K.Snippet,
    16: K.Color,
    17: K.File,
    18: K.Reference,
    19: K.Folder,
    20: K.EnumMember,
    21: K.Constant,
    22: K.Struct,
    23: K.Event,
    24: K.Operator,
    25: K.TypeParameter,
  }
  return map[k] ?? K.Text
}

export { LSP_LANGS }
