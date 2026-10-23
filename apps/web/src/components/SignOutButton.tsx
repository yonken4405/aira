'use client';

import { t } from '@aira/ui';
import { Button, useToast } from '@aira/ui/web';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Ends the session server-side and returns to the sign-in screen. */
export function SignOutButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      router.replace('/login');
      router.refresh();
    } catch {
      toast({
        tone: 'error',
        title: t('sessionExpiredTitle'),
        description: t('sessionExpiredBody'),
      });
      setPending(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
      <LogOut aria-hidden="true" size={12} />
      {t('signOut')}
    </Button>
  );
}
