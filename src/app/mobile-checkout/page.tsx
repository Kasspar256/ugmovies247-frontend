'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

type ExternalCheckoutResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  paymentId?: string;
  status?: string;
  providerStatus?: string;
  paymentProvider?: 'pawapay' | 'payfast';
  redirect?: {
    action: string;
    method: 'POST';
    fields: Record<string, string>;
  };
  checkout?: {
    status: string;
    paymentMethod: 'mobile_money' | 'card';
    paymentId: string;
    expiresAt: string;
  };
  payment?: {
    id?: string;
    status?: string;
    providerMessage?: string;
    paymentProvider?: 'pawapay' | 'payfast';
  } | null;
};

async function readJsonResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as ExternalCheckoutResponse;

  if (!response.ok) {
    throw new Error(payload.error || 'Checkout failed. Please return to the app and try again.');
  }

  return payload;
}

function submitHostedPaymentForm(redirect: NonNullable<ExternalCheckoutResponse['redirect']>) {
  const form = document.createElement('form');
  form.method = redirect.method;
  form.action = redirect.action;
  form.style.display = 'none';

  Object.entries(redirect.fields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
}

export default function MobileCheckoutPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const returnedPaymentId = searchParams.get('paymentId') || '';
  const cancelled = searchParams.get('cancelled') === '1';
  const rawReturnTo = searchParams.get('returnTo') || '/profile/payments';
  const returnTo = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : '/profile/payments';
  const [paymentId, setPaymentId] = useState(returnedPaymentId);
  const [status, setStatus] = useState(cancelled ? 'cancelled' : 'loading');
  const [message, setMessage] = useState(
    cancelled
      ? 'Payment was cancelled. You can close this tab and return to UG Movies 247.'
      : 'Preparing secure checkout...'
  );
  const [error, setError] = useState('');
  const [redirectCountdown, setRedirectCountdown] = useState(6);
  const submittedFormRef = useRef(false);

  useEffect(() => {
    if (!token || cancelled) {
      if (!token) {
        setStatus('failed');
        setError('Missing checkout token.');
      }

      return;
    }

    let active = true;

    const startCheckout = async () => {
      try {
        const endpoint = `/api/subscriptions/external-checkout/${encodeURIComponent(token)}`;
        const response = await fetch(endpoint, {
          method: returnedPaymentId ? 'GET' : 'POST',
          cache: 'no-store',
        });
        const payload = await readJsonResponse(response);
        const nextPaymentId = payload.checkout?.paymentId || payload.paymentId || returnedPaymentId;

        if (!active) {
          return;
        }

        if (nextPaymentId) {
          setPaymentId(nextPaymentId);
        }

        if (payload.redirect && !submittedFormRef.current) {
          submittedFormRef.current = true;
          setStatus('redirecting');
          setMessage('Opening secure PayFast checkout...');
          submitHostedPaymentForm(payload.redirect);
          return;
        }

        const paymentStatus = payload.payment?.status || payload.status || payload.checkout?.status || 'pending';
        setStatus(paymentStatus);

        if (paymentStatus === 'completed') {
          setMessage('Payment successful. Return to UG Movies 247 app.');
          return;
        }

        if (paymentStatus === 'failed' || paymentStatus === 'cancelled' || paymentStatus === 'not_found') {
          setError(payload.payment?.providerMessage || payload.message || 'Payment was not completed.');
          return;
        }

        setMessage(
          payload.paymentProvider === 'pawapay' || payload.checkout?.paymentMethod === 'mobile_money'
            ? 'Approve the payment on your phone, then keep this tab open until it confirms.'
            : 'Waiting for payment confirmation...'
        );
      } catch (checkoutError) {
        if (!active) {
          return;
        }

        setStatus('failed');
        setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout failed.');
      }
    };

    void startCheckout();

    return () => {
      active = false;
    };
  }, [cancelled, returnedPaymentId, token]);

  useEffect(() => {
    if (!token || !paymentId || ['completed', 'failed', 'cancelled', 'not_found'].includes(status)) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/subscriptions/external-checkout/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const payload = await readJsonResponse(response);
        const paymentStatus = payload.payment?.status || payload.checkout?.status || 'pending';

        setStatus(paymentStatus);

        if (paymentStatus === 'completed') {
          setMessage('Payment successful. Return to UG Movies 247 app.');
          setError('');
        } else if (paymentStatus === 'failed' || paymentStatus === 'cancelled' || paymentStatus === 'not_found') {
          setError(payload.payment?.providerMessage || 'Payment was not completed.');
        }
      } catch {
        // Keep polling; temporary provider/network issues are expected during payment.
      }
    }, 6000);

    return () => window.clearInterval(interval);
  }, [paymentId, status, token]);

  const isSuccess = status === 'completed';
  const isFailure = Boolean(error) || status === 'failed' || status === 'cancelled' || status === 'not_found';
  const shouldAutoReturn = isSuccess || isFailure;

  useEffect(() => {
    if (!shouldAutoReturn) {
      setRedirectCountdown(6);
      return;
    }

    setRedirectCountdown(6);

    const interval = window.setInterval(() => {
      setRedirectCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          window.location.replace(returnTo);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [returnTo, shouldAutoReturn]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0C10] px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-[30px] border border-white/10 bg-[#11141C] p-6 text-center shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5">
          {isSuccess ? (
            <CheckCircle2 size={34} className="text-emerald-300" />
          ) : isFailure ? (
            <XCircle size={34} className="text-[#FFB3C1]" />
          ) : (
            <Loader2 size={30} className="animate-spin text-[#FFB3C1]" />
          )}
        </div>

        <div className="mt-5 text-[11px] font-black uppercase tracking-[0.26em] text-[#FFB3C1]">
          UG Movies 247 Checkout
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.05em]">
          {isSuccess ? 'Payment Successful' : isFailure ? 'Payment Not Completed' : 'Secure Payment'}
        </h1>
        <p className="mt-4 text-sm leading-7 text-white/70">
          {error || message}
        </p>

        {paymentId ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/24 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/48">
            Payment ID: {paymentId.slice(0, 8)}...
          </div>
        ) : null}

        {shouldAutoReturn ? (
          <div className="mt-5 rounded-2xl border border-[#D90429]/25 bg-[#D90429]/10 px-4 py-3 text-xs font-bold leading-6 text-[#FFB3C1]">
            Redirecting back to UG Movies 247 in {redirectCountdown} second{redirectCountdown === 1 ? '' : 's'}...
          </div>
        ) : (
          <p className="mt-5 text-xs leading-6 text-white/46">
            Keep this page open while we confirm your payment. You will be returned automatically when it finishes.
          </p>
        )}
      </section>
    </main>
  );
}
