import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSignOutMutation } from '@/services/authApi';
import { validateRedirectUrl } from '@/lib/validateRedirectUrl';

export function LogoutPage() {
  const [searchParams] = useSearchParams();
  const [signOut] = useSignOutMutation();
  const logoutAttemptedRef = useRef(false);

  const redirectTo = validateRedirectUrl(searchParams.get('redirect'));

  useEffect(() => {
    if (logoutAttemptedRef.current) return;
    logoutAttemptedRef.current = true;

    signOut()
      .unwrap()
      .finally(() => {
        window.location.href = redirectTo;
      });
  }, [signOut, redirectTo]);

  return null;
}