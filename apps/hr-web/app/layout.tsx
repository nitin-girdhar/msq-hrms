import type { Metadata } from 'next';
import { ServiceWorkerRegistrar, pwaViewport, pwaAppleWebApp, pwaIcons, pwaAppleCapableMeta, pwaManifest } from '@platform/ui-kit';
import { brandedMetadata, getEffectiveBranding } from '@platform/ui-kit/server';
import { BrandingProvider } from '@platform/ui-kit/branding';
import { ThemeStyle, themeHtmlProps } from '@platform/ui-kit/theme';
import './globals.css';

export const viewport = pwaViewport;

const baseMetadata: Metadata = {
  title: 'FitClass · People & Attendance',
  description: 'Leave and attendance for FitClass teams',
  appleWebApp: pwaAppleWebApp,
  icons: pwaIcons,
  manifest: pwaManifest,
  other: pwaAppleCapableMeta,
};

// Session tenant's tab title / favicon / app icon / manifest over the defaults.
export async function generateMetadata(): Promise<Metadata> {
  return brandedMetadata(baseMetadata, 'hr');
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tenant brand / user appearance → CSS variables (skills/react-typescript §6).
  // Dark mode stays off for this app until every screen is on theme tokens.
  const branding = await getEffectiveBranding();
  const theme = branding.theme;
  return (
    <html lang="en" suppressHydrationWarning {...themeHtmlProps(theme)}>
      <head>
        <ThemeStyle theme={theme} />
      </head>
      <body className="dashboard-shell bg-background font-sans text-on-surface" suppressHydrationWarning>
        <ServiceWorkerRegistrar />
        <BrandingProvider value={branding}>{children}</BrandingProvider>
      </body>
    </html>
  );
}
