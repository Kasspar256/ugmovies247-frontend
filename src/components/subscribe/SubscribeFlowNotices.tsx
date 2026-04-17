'use client';

type PaymentState = {
  id: string;
  status: string;
  providerStatus: string;
  providerMessage: string;
  paymentProvider: 'pawapay' | 'payfast';
};

type SubscribeFlowNoticesProps = {
  error?: string;
  message?: string;
  activePayment?: PaymentState | null;
  tone?: 'dark' | 'light';
};

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ').toUpperCase();
}

export default function SubscribeFlowNotices({
  error,
  message,
  activePayment,
  tone = 'dark',
}: SubscribeFlowNoticesProps) {
  const isLight = tone === 'light';

  return (
    <>
      {error ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            isLight
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-red-500/30 bg-red-500/10 text-red-100'
          }`}
        >
          {error}
        </div>
      ) : null}

      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            isLight
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {message}
        </div>
      ) : null}

      {activePayment ? (
        <div
          className={`rounded-[24px] border p-5 ${
            isLight
              ? 'border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'
              : 'border-[#D90429]/20 bg-[#D90429]/10'
          }`}
        >
          <div className={`text-[11px] font-black uppercase tracking-[0.24em] ${isLight ? 'text-slate-500' : 'text-[#FFB3C1]'}`}>
            Latest payment attempt
          </div>
          <div className={`mt-3 space-y-2 text-sm ${isLight ? 'text-slate-700' : 'text-white/80'}`}>
            <p>
              Status:{' '}
              <span className={isLight ? 'font-bold text-slate-950' : 'font-bold text-white'}>
                {formatStatusLabel(activePayment.status)}
              </span>
            </p>
            <p>
              Provider:{' '}
              <span className={isLight ? 'font-bold text-slate-950' : 'font-bold text-white'}>
                {activePayment.providerStatus || 'Awaiting update'}
              </span>
            </p>
            <p>
              Method:{' '}
              <span className={isLight ? 'font-bold text-slate-950' : 'font-bold text-white'}>
                {activePayment.paymentProvider === 'payfast' ? 'CARD' : 'MOBILE MONEY'}
              </span>
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
