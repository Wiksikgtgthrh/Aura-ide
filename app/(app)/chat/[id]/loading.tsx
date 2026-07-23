export default function ChatLoading() {
  return (
    <div className="flex flex-1 flex-col h-full animate-pulse">
      {/* Messages area */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pt-6">
        <div className="flex gap-3">
          <div className="size-8 shrink-0 rounded-full bg-muted" />
          <div className="flex flex-col gap-2 flex-1 max-w-lg">
            <div className="h-4 w-3/4 rounded-md bg-muted" />
            <div className="h-4 w-1/2 rounded-md bg-muted" />
          </div>
        </div>
        <div className="flex gap-3 self-end flex-row-reverse">
          <div className="size-8 shrink-0 rounded-full bg-muted" />
          <div className="flex flex-col gap-2 items-end max-w-lg">
            <div className="h-4 w-56 rounded-md bg-muted" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="size-8 shrink-0 rounded-full bg-muted" />
          <div className="flex flex-col gap-2 flex-1 max-w-xl">
            <div className="h-4 w-full rounded-md bg-muted" />
            <div className="h-4 w-4/5 rounded-md bg-muted" />
            <div className="h-4 w-2/3 rounded-md bg-muted" />
          </div>
        </div>
      </div>
      {/* Input */}
      <div className="px-4 pb-4 pt-2">
        <div className="h-12 w-full rounded-xl bg-muted" />
      </div>
    </div>
  )
}
