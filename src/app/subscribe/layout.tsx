import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SubscribeFlowProvider } from '@/components/subscribe/SubscribeFlowProvider';
import { APP_REVIEW_HOME_PATH, isAppInReview } from '@/lib/appReview';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
    },
  },
};

export default function SubscribeLayout({ children }: { children: ReactNode }) {
  if (isAppInReview) {
    redirect(APP_REVIEW_HOME_PATH);
  }

  return <SubscribeFlowProvider>{children}</SubscribeFlowProvider>;
}
