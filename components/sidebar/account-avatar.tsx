'use client'

export function AccountAvatar({
  image,
  name,
  className = 'size-6',
}: {
  image?: string | null
  name: string
  className?: string
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image || '/placeholder.svg'}
        alt=""
        className={`${className} rounded-full object-cover shrink-0`}
      />
    )
  }
  return (
    <span
      className={`${className} rounded-full bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shrink-0`}
    >
      <span className="text-background text-[10px] font-semibold">
        {(name || 'A').charAt(0).toUpperCase()}
      </span>
    </span>
  )
}
