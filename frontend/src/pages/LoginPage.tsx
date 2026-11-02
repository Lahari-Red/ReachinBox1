import { GoogleLogin } from '@react-oauth/google';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onSuccess = async (credential?: string) => {
    if (!credential) return toast('Google did not return a credential', 'error');
    setBusy(true);
    try {
      await login(credential);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Sign-in failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-ink-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">R</span>
        <h1 className="mt-5 text-xl font-semibold">Welcome to ReachInbox</h1>
        <p className="mt-1 text-sm text-ink-500">Sign in to schedule and track your outreach.</p>

        <div className="mt-8 flex justify-center">
          {busy ? (
            <span className="flex items-center gap-2 text-sm text-ink-500">
              <Spinner size="sm" /> Signing you in…
            </span>
          ) : (
            <GoogleLogin
              onSuccess={(r) => void onSuccess(r.credential)}
              onError={() => toast('Google sign-in was cancelled or failed', 'error')}
              theme="outline"
              size="large"
              shape="pill"
              text="continue_with"
            />
          )}
        </div>
        <p className="mt-8 text-xs text-ink-500">We only use your name, email and avatar.</p>
      </div>
    </div>
  );
}
