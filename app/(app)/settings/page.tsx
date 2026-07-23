/**
 * /settings page — intentionally empty.
 *
 * The settings UI (SettingsContent) is rendered directly inside AppContentArea
 * in (app)/layout.tsx using an <Activity> shell. This means the settings data
 * is pre-loaded in parallel with the sidebar on every page load, making the
 * transition to /settings instant — no Suspense, no extra DB round-trips.
 *
 * This page exists only so Next.js resolves the /settings route. The layout's
 * AppContentArea hides the regular {children} slot and shows the pre-loaded
 * SettingsContent instead when pathname starts with /settings.
 */
export default function SettingsPage() {
  return null
}
