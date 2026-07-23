/**
 * Content-area skeleton shown by Next.js App Router the moment a nav link is
 * clicked, before the server component finishes rendering.
 * Mirrors the layout of HomeContent (heading + prompt box) so the transition
 * feels continuous rather than blank.
 */
export default function AppLoading() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-6 px-6 animate-pulse"
      aria-hidden="true"
    >
      {/* Heading skeleton */}
      <div className="h-9 w-64 rounded-lg bg-muted" />
      {/* Prompt box skeleton */}
      <div className="w-full max-w-2xl flex flex-col gap-2">
        <div className="h-14 rounded-xl bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded-lg bg-muted" />
          <div className="h-8 w-28 rounded-lg bg-muted" />
          <div className="h-8 w-20 rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  )
}
