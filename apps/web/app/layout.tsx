import { ToastProvider } from '@aira/ui/web';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'AIRA Responder Console',
  description:
    'AIRA responder dashboard: live incident queue, map and routing. Structured emergency payloads only. No chat or voice.',
};

// Pre-paint theme script (R2.6): resolves the persisted Theme_Preference to a
// concrete theme and sets `data-theme` on <html> synchronously, before first
// paint, so there is no flash of the non-selected theme. Must stay dependency-
// free and inline in <head>. The ThemeProvider (task 5.2) later adopts whatever
// attribute this script sets; do NOT hardcode data-theme on the server <html>.
const PRE_PAINT_THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('aira-theme')||'system';var sys=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',p==='system'?sys:p);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The pre-paint script (below) sets `data-theme` on <html> before hydration,
    // so the server markup intentionally omits it. suppressHydrationWarning scopes
    // the expected attribute mismatch to <html> only (not its subtree), silencing
    // the no-FOUC hydration warning without masking real mismatches elsewhere.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint to apply the persisted theme (R2.6, no FOUC). */}
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_THEME_SCRIPT }} />
      </head>
      <body>
        {/* One toast surface for the whole console (DESIGN.md §6). */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
