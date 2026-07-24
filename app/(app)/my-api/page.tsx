/**
 * /my-api page — intentionally empty.
 *
 * The page content (MyApiContent) is rendered directly inside AppContentArea
 * in (app)/layout.tsx using an <Activity> shell, exactly like /settings.
 * Its data (grouped API keys) is pre-loaded in parallel with the sidebar on
 * every page load, so opening «Мои API» is an instant client-side visibility
 * toggle — no RSC round-trip, no extra DB queries, no skeleton flash.
 *
 * This file exists only so Next.js resolves the /my-api route.
 */
export default function MyApiPage() {
  return null
}
