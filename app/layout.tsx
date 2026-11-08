import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './operations.css';
import './operations-tokens.css';
import { themeScript } from './theme-script';

const plex = localFont({
  src: [
    { path: './fonts/IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/IBMPlexSans-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RMC2 | Franchising Operations',
  description: 'Shared insurance inquiry, proposal preparation and supervisor approval workspace.',
  icons: { icon: '/rmc2-logo.png', apple: '/apple-touch-icon.png' },
  // iPhone: installable from Safari (Add to Home Screen), which is required for phone notifications.
  appleWebApp: { capable: true, title: 'RMC2', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#172e50' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The theme script sets data-theme on <html> before React loads, hence suppressHydrationWarning on that element only.
  return <html lang="en" className={plex.variable} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}</body></html>;
}
