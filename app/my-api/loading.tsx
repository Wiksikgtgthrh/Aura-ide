export default function MyApiLoading() {
  return (
    <main
      className="min-h-svh bg-background flex justify-center animate-pulse"
      aria-hidden="true"
    >
      <div className="max-w-2xl w-full px-6 py-10">
        {/* Header */}
        <div className="h-7 w-32 rounded bg-muted mb-2" />
        <div className="h-4 w-64 rounded bg-muted mb-8" />

        {/* Card skeleton */}
        <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
          <div className="h-5 w-28 rounded bg-muted" />
          <div className="h-10 rounded-md bg-muted" />
          <div className="h-10 w-32 rounded-md bg-muted" />
        </div>

        {/* Keys list skeleton */}
        <div className="mt-8 flex flex-col gap-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4 flex items-center gap-4"
            >
              <div className="size-4 rounded bg-muted shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="h-4 w-36 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
              <div className="h-8 w-16 rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
