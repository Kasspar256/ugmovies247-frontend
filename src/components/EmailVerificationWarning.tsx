'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { resendVerificationEmail } from '@/lib/auth/client';

type EmailVerificationWarningProps = {
  emailVerified?: boolean;
  className?: string;
};

export default function EmailVerificationWarning({
  emailVerified,
  className = '',
}: EmailVerificationWarningProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (emailVerified) {
    return null;
  }

  const handleVerify = async () => {
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const result = await resendVerificationEmail() as { message?: string };
      setMessage(result.message || 'Verification email sent. Check your inbox and spam folder.');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Verification email could not be sent.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className={`rounded-[24px] border border-amber-400/25 bg-amber-400/10 p-4 text-amber-50 shadow-[0_16px_34px_rgba(0,0,0,0.22)] ${className}`}
    >
      <div className="text-sm font-bold">⚠️ Your email is not verified.</div>
      <p className="mt-2 text-sm leading-6 text-amber-50/82">
        Verify to receive payment receipts, subscription updates, and account recovery support.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          Verify Now
        </button>
        {(message || error) && (
          <span className={`text-sm ${error ? 'text-red-100' : 'text-emerald-100'}`}>
            {error || message}
          </span>
        )}
      </div>
    </section>
  );
}

