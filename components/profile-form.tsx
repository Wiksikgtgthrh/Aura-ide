'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateName,
  updateBio,
  updateTag,
  updateAvatar,
  type Profile,
} from '@/app/actions/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { useLanguage } from '@/lib/language'
import {
  Loader2,
  Check,
  Camera,
  Lock,
  AtSign,
  TriangleAlert,
  ShieldCheck,
  MailWarning,
  KeyRound,
  Trash2,
} from 'lucide-react'
import { authClient } from '@/lib/auth-client'

function resizeImage(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Canvas not supported'))
        return
      }
      // Cover-crop to square
      const min = Math.min(img.width, img.height)
      const sx = (img.width - min) / 2
      const sy = (img.height - min) / 2
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load image'))
    }
    img.src = url
  })
}

function SaveButton({
  saving,
  saved,
  label,
}: {
  saving: boolean
  saved: boolean
  label: string
}) {
  const { t } = useLanguage()
  return (
    <Button
      type="submit"
      size="sm"
      disabled={saving || saved}
      className="min-w-20 transition-all duration-300 active:scale-[0.97]"
    >
      {saved ? (
        <span className="flex items-center gap-1.5 animate-in zoom-in duration-300">
          <Check className="size-3.5" aria-hidden="true" />
          {t('saved')}
        </span>
      ) : saving ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        label
      )}
    </Button>
  )
}

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const { t } = useLanguage()

  const [image, setImage] = useState(initial.image)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const [name, setName] = useState(initial.name)
  const [nameBusy, setNameBusy] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const [tag, setTag] = useState(initial.tag)
  const [tagBusy, setTagBusy] = useState(false)
  const [tagSaved, setTagSaved] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)
  const [tagLocked, setTagLocked] = useState(initial.tagChanged)

  const [bio, setBio] = useState(initial.bio)
  const [bioBusy, setBioBusy] = useState(false)
  const [bioSaved, setBioSaved] = useState(false)
  const [bioError, setBioError] = useState<string | null>(null)

  const flash = (setter: (v: boolean) => void) => {
    setter(true)
    setTimeout(() => setter(false), 1600)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAvatarError(t('chooseImage'))
      return
    }
    setAvatarError(null)
    setAvatarBusy(true)
    try {
      const dataUrl = await resizeImage(file)
      const res = await updateAvatar(dataUrl)
      if (res.error) {
        setAvatarError(res.error)
      } else {
        setImage(dataUrl)
        router.refresh()
      }
    } catch {
      setAvatarError(t('processImageError'))
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleName = async (e: React.FormEvent) => {
    e.preventDefault()
    setNameError(null)
    setNameBusy(true)
    const res = await updateName(name)
    setNameBusy(false)
    if (res.error) {
      setNameError(res.error)
      return
    }
    flash(setNameSaved)
    router.refresh()
  }

  const handleTag = async (e: React.FormEvent) => {
    e.preventDefault()
    setTagError(null)
    setTagBusy(true)
    const res = await updateTag(tag)
    setTagBusy(false)
    if (res.error) {
      setTagError(res.error)
      return
    }
    setTagLocked(true)
    flash(setTagSaved)
    router.refresh()
  }

  const handleBio = async (e: React.FormEvent) => {
    e.preventDefault()
    setBioError(null)
    setBioBusy(true)
    const res = await updateBio(bio)
    setBioBusy(false)
    if (res.error) {
      setBioError(res.error)
      return
    }
    flash(setBioSaved)
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Avatar */}
      <section className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={avatarBusy}
          aria-label={t('changeAvatar')}
          className="group relative size-20 rounded-full overflow-hidden shrink-0 ring-1 ring-border transition-shadow duration-300 hover:ring-2 hover:ring-foreground/40"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image || '/placeholder.svg'}
              alt={t('yourAvatar')}
              className="size-full object-cover"
            />
          ) : (
            <span className="size-full bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center text-background text-2xl font-semibold">
              {(name || 'A').charAt(0).toUpperCase()}
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {avatarBusy ? (
              <Loader2 className="size-5 text-background animate-spin" />
            ) : (
              <Camera className="size-5 text-background" />
            )}
          </span>
        </button>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{t('avatar')}</span>
          <span className="text-xs text-muted-foreground">
            {t('avatarHelp')}
          </span>
          {avatarError && (
            <span className="text-xs text-destructive" role="alert">
              {avatarError}
            </span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFile}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
      </section>

      <Separator />

      {/* Name */}
      <form onSubmit={handleName} className="flex flex-col gap-2">
        <Label htmlFor="profile-name" className="text-sm text-foreground">
          {t('name')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('nameHelp')}
        </p>
        <div className="flex gap-2 mt-1">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={50}
            className="h-9 flex-1"
          />
          <SaveButton saving={nameBusy} saved={nameSaved} label={t('save')} />
        </div>
        {nameError && (
          <p className="text-xs text-destructive" role="alert">
            {nameError}
          </p>
        )}
      </form>

      {/* Tag */}
      <form onSubmit={handleTag} className="flex flex-col gap-2">
        <Label htmlFor="profile-tag" className="text-sm text-foreground">
          {t('uniqueTag')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {tagLocked ? t('tagPermanent') : t('tagFromLogin')}
        </p>
        <div className="flex gap-2 mt-1">
          <div className="relative flex-1">
            <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              id="profile-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={tagLocked}
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_.\-]+"
              title={t('lettersOnly')}
              className="h-9 pl-8"
            />
            {tagLocked && (
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            )}
          </div>
          {!tagLocked && (
            <SaveButton saving={tagBusy} saved={tagSaved} label={t('change')} />
          )}
        </div>
        {!tagLocked && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {t('tagWarning')}
          </p>
        )}
        {tagError && (
          <p className="text-xs text-destructive" role="alert">
            {tagError}
          </p>
        )}
      </form>

      {/* Bio */}
      <form onSubmit={handleBio} className="flex flex-col gap-2">
        <Label htmlFor="profile-bio" className="text-sm text-foreground">
          {t('about')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('bioHelp')}
        </p>
        <Textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder={t('bioPlaceholder')}
          className="mt-1 resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {bio.length}/500
          </span>
          <SaveButton saving={bioBusy} saved={bioSaved} label={t('save')} />
        </div>
        {bioError && (
          <p className="text-xs text-destructive" role="alert">
            {bioError}
          </p>
        )}
      </form>

      {!initial.isAnonymous && (
        <>
          <Separator />
          <SecuritySection emailVerified={initial.emailVerified} email={initial.email} />
          <Separator />
          <DangerZone />
        </>
      )}

    </div>
  )
}

// ---- Security: email verification + change password -------------------------

function SecuritySection({
  emailVerified,
  email,
}: {
  emailVerified: boolean
  email: string
}) {
  const { t } = useLanguage()
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResend = async () => {
    setResending(true)
    try {
      await authClient.sendVerificationEmail({ email, callbackURL: '/' })
      setResent(true)
    } catch {
      /* ignore */
    } finally {
      setResending(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (changing) return
    setError(null)
    setChanging(true)
    try {
      const { error: err } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (err) {
        setError(err.message ?? t('genericError'))
        return
      }
      setChanged(true)
      setCurrentPassword('')
      setNewPassword('')
      setTimeout(() => setChanged(false), 2500)
    } catch {
      setError(t('genericError'))
    } finally {
      setChanging(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-sm font-medium text-foreground">{t('securityTitle')}</h2>

      {/* Email verification status */}
      <div
        className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
          emailVerified
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-amber-500/30 bg-amber-500/10'
        }`}
      >
        {emailVerified ? (
          <>
            <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
            <span className="text-foreground">{t('emailVerified')}</span>
          </>
        ) : (
          <>
            <MailWarning className="size-4 shrink-0 text-amber-500" />
            <span className="flex-1 text-foreground">{t('emailNotVerified')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleResend}
              disabled={resending || resent}
            >
              {resending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : resent ? (
                <>
                  <Check className="size-3.5" />
                  {t('verificationSent')}
                </>
              ) : (
                t('resendVerification')
              )}
            </Button>
          </>
        )}
      </div>

      {/* Change password */}
      <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
        <Label className="flex items-center gap-1.5 text-sm text-foreground">
          <KeyRound className="size-3.5" />
          {t('changePassword')}
        </Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('currentPassword')}
            autoComplete="current-password"
            required
            minLength={8}
          />
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('newPassword')}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={changing || currentPassword.length < 8 || newPassword.length < 8}
          >
            {changing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : changed ? (
              <>
                <Check className="size-3.5" />
                {t('passwordUpdated')}
              </>
            ) : (
              t('updatePassword')
            )}
          </Button>
        </div>
      </form>
    </section>
  )
}

// ---- Danger zone: delete account --------------------------------------------

function DangerZone() {
  const { t } = useLanguage()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (deleting) return
    setError(null)
    setDeleting(true)
    try {
      const { error: err } = await authClient.deleteUser()
      if (err) {
        setError(err.message ?? t('genericError'))
        setDeleting(false)
        return
      }
      router.push('/sign-in')
    } catch {
      setError(t('genericError'))
      setDeleting(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-destructive">{t('dangerZone')}</h2>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-foreground">{t('deleteAccount')}</p>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          {t('deleteAccountHelp')}
        </p>
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          {confirming ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="size-3.5" />
                    {t('deleteAccountConfirm')}
                  </>
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                {t('cancel')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" />
              {t('deleteAccount')}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
