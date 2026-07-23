export default function PluginsLoading() {
  return (
    <div className="flex-1 min-w-0 overflow-y-auto animate-pulse">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div className="h-7 w-24 rounded-md bg-muted" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-20 rounded-full bg-muted" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
