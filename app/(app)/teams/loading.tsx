export default function TeamsLoading() {
  return (
    <div className="flex-1 min-w-0 overflow-y-auto animate-pulse">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-24 rounded-md bg-muted" />
          <div className="h-9 w-32 rounded-md bg-muted" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
