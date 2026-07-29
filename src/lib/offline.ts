/**
 * Offline state, from the one signal that is actually reliable.
 *
 * `navigator.onLine` reports whether there is *a* network, not whether Pack
 * Smart can reach its own server — hotel wifi that requires a captive portal
 * login reads as online. So the app trusts what its own requests report: the
 * service worker marks a response it served from cache, and that is what drives
 * the banner.
 */

export const OFFLINE_EVENT = 'pack-smart:offline'
export const ONLINE_EVENT = 'pack-smart:online'

/*
 * Latched, not only broadcast.
 *
 * The first failing request is the session check, and it happens while the app
 * is still deciding whether to show the shell at all — before the banner exists
 * to hear the event. Keeping the state here means a listener that subscribes
 * afterwards still starts in the right place.
 */
let requestsFailing = false

/**
 * Two signals, because each is unreliable in the opposite direction.
 *
 * `navigator.onLine` is trustworthy when it says NO — airplane mode really does
 * mean no requests will succeed. It is not trustworthy when it says yes: hotel
 * wifi behind a captive portal reports a perfectly good connection that reaches
 * nothing. So the OS answers the first case and Pack Smart's own failed
 * requests answer the second.
 */
export function isOffline(): boolean {
  const navigatorOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  return navigatorOffline || requestsFailing
}

export function announceCached(): void {
  requestsFailing = true
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT))
}

export function announceLive(): void {
  requestsFailing = false
  window.dispatchEvent(new CustomEvent(ONLINE_EVENT))
}

/**
 * Registers the service worker.
 *
 * Deliberately after load: registering during startup competes with the first
 * render for bandwidth on exactly the slow connection this is meant to help.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline reads are a resilience feature. Losing them must never stop the
      // app from working online.
    })
  })
}
