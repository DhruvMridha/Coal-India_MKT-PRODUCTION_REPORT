'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { db } from '@/lib/report-store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { User } from '@supabase/supabase-js';

export function OperatorAccess({ open, close, user }: { open: boolean; close: () => void; user: User | null }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return <Dialog open={open} onOpenChange={value => { if (!value) { setMessage(''); setShowPassword(false); close(); } }}>
    <DialogContent className="access-dialog">
      <DialogTitle>{user ? 'Workspace account' : 'Operator sign in'}</DialogTitle>
      <DialogDescription>{user ? `${user.email} · ${user.app_metadata.mtk_role ?? 'Operator access has not been assigned'}` : 'Use your assigned operator account to load, edit and save production reports.'}</DialogDescription>
      {user ? <Button disabled={busy} onClick={async () => {
        setBusy(true);
        const { error } = await db().auth.signOut();
        setBusy(false);
        if (error) setMessage('Sign out failed. Try again.');
        else close();
      }}>Sign out</Button> : <form className="accessform" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setMessage('');
        try {
          const { error } = await db().auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
          if (error) setMessage(error.status === 429 ? 'Too many attempts. Try again later.' : error.code === 'email_not_confirmed' ? 'Confirm your email before signing in.' : 'Unable to sign in. Check your credentials.');
          else close();
        } catch {
          setMessage('Connection failed. Try again.');
        } finally {
          setBusy(false);
        }
      }}>
        <label htmlFor="operator-email">Email
          <input id="operator-email" name="email" type="email" autoComplete="username" required />
        </label>
        <label htmlFor="operator-password">Password
          <span className="password-field">
            <input id="operator-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required />
            <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          </span>
        </label>
        <Button className="access-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>}
      {message && <p className="access-message" role="alert">{message}</p>}
    </DialogContent>
  </Dialog>;
}
