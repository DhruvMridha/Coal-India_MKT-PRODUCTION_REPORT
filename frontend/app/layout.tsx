import type { Metadata, Viewport } from 'next';
import './globals.css';
import './report.css';

export const metadata: Metadata = {
  title: 'MTK Operations | Daily Production',
  description: 'Mining operations workspace for shiftwise production, historical reporting, rainfall, and pump records.',
};
export const viewport: Viewport = { themeColor: '#EBEBED', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
