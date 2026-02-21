import { useEffect, useRef } from 'react';
import { useGetSessionQuery } from '@/services/authApi';

export function usePendoInit() {
  const { data: session } = useGetSessionQuery();
  const initialized = useRef(false);

  useEffect(() => {
    // Skip if Pendo isn't loaded or user not logged in
    if (!window.pendo || !session?.user || initialized.current) return;

    window.pendo.initialize({
      visitor: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
      },
      account: {
        id: window.location.hostname,
        accountName: window.location.hostname,
      },
    });
    initialized.current = true;
  }, [session]);
}
