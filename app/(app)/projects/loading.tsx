export default function ProjectsLoading() {
  return (
    <div className="flex-1 min-w-0 overflow-y-auto animate-pulse">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 rounded-md bg-muted" />
          <div className="h-9 w-28 rounded-md bg-muted" />
        </div>
        <div className="h-10 w-full rounded-lg bg-muted" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
