import { parseMarkdown, type MdInline } from '@/lib/markdown'

/**
 * Рендер markdown (lib/markdown.ts) React-элементами — безопасно, без
 * dangerouslySetInnerHTML. Используется в превью админ-редактора и на
 * странице плагина (Описание / Документация / changelog).
 */

function InlineNodes({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-foreground">
                {n.text}
              </strong>
            )
          case 'italic':
            return <em key={i}>{n.text}</em>
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
              >
                {n.text}
              </code>
            )
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                {n.text}
              </a>
            )
          default:
            return <span key={i}>{n.text}</span>
        }
      })}
    </>
  )
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) return null
  return (
    <div className={`flex flex-col gap-3 text-sm leading-relaxed text-foreground ${className}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            if (b.level === 1)
              return (
                <h2 key={i} className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  <InlineNodes nodes={b.inline} />
                </h2>
              )
            if (b.level === 2)
              return (
                <h3 key={i} className="mt-1.5 text-lg font-semibold text-foreground">
                  <InlineNodes nodes={b.inline} />
                </h3>
              )
            return (
              <h4 key={i} className="mt-1 text-base font-semibold text-foreground">
                <InlineNodes nodes={b.inline} />
              </h4>
            )
          }
          case 'paragraph':
            return (
              <p key={i} className="text-muted-foreground">
                <InlineNodes nodes={b.inline} />
              </p>
            )
          case 'list':
            return b.ordered ? (
              <ol key={i} className="ml-5 flex list-decimal flex-col gap-1 text-muted-foreground">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <InlineNodes nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="ml-5 flex list-disc flex-col gap-1 text-muted-foreground">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <InlineNodes nodes={item} />
                  </li>
                ))}
              </ul>
            )
          case 'code':
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs text-foreground"
              >
                <code>{b.code}</code>
              </pre>
            )
          case 'quote':
            return (
              <blockquote
                key={i}
                className="border-l-2 border-primary/50 pl-3 text-muted-foreground italic"
              >
                <InlineNodes nodes={b.inline} />
              </blockquote>
            )
          case 'hr':
            return <hr key={i} className="border-border" />
        }
      })}
    </div>
  )
}
