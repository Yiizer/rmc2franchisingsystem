import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './operations.css';
import './operations-tokens.css';

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
  icons: { icon: '/rmc2-logo.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={plex.variable}><body>{children}</body></html>;
}
