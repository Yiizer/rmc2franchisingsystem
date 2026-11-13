// The server POSTs to a phone-notification subscription's endpoint, so only the browsers' own push services are accepted
// (security review 2026-11-13: any https URL let a signed-in user make the server call a host of their choice).
// Chrome/Edge/Android use FCM, Safari/iPhone Apple's push service, Firefox Mozilla's, and Edge on Windows WNS. Pure, no imports.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function pushHostAllowed(endpoint: string): boolean {
  try { const url = new URL(endpoint); return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some(host => host.test(url.hostname)); } catch { return false; }
}
