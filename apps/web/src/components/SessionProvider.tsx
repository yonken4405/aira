'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import type { Viewer } from '../lib/auth/types';

/**
 * The signed-in principal as seen by the browser.
 *
 * Never carries a token: the session lives in an HttpOnly cookie the client code
 * cannot read (SECURITY.md §4.3). The hook is null-safe so presentational
 * components can render in tests without a provider.
 */
const SessionContext = createContext<Viewer | null>(null);

export function SessionProvider({
  viewer,
  children,
}: {
  readonly viewer: Viewer;
  readonly children: ReactNode;
}): ReactElement {
  return <SessionContext.Provider value={viewer}>{children}</SessionContext.Provider>;
}

export function useSession(): Viewer | null {
  return useContext(SessionContext);
}
