import type { MetadataRoute } from 'next';

// Installable app (Add to Home Screen). Needed on iPhone for phone notifications.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RMC2 Franchising Operations',
    short_name: 'RMC2',
    description: 'Franchising inquiries, proposals, approvals and client protection.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#172e50',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
