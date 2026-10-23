import { t } from '@aira/ui';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

/** Rendered instead of a page when the session's role lacks the permission. */
export function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink p-6 text-fg">
      <div className="w-full max-w-sm border border-line bg-surface p-6">
        <ShieldAlert aria-hidden="true" size={18} className="text-status-error" />
        <h1 className="mt-3 text-sm font-bold uppercase tracking-label">{t('forbiddenTitle')}</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted">{t('forbiddenBody')}</p>
        <Link
          href="/"
          className="mt-4 inline-block border border-line bg-raised px-3 py-2 text-[10px] font-bold uppercase tracking-label text-fg transition-colors duration-fast hover:border-muted"
        >
          {t('backToConsole')}
        </Link>
      </div>
    </main>
  );
}
