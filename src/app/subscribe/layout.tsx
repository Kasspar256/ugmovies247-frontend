import type { ReactNode } from 'react';
import { SubscribeFlowProvider } from '@/components/subscribe/SubscribeFlowProvider';

export default function SubscribeLayout({ children }: { children: ReactNode }) {
  return <SubscribeFlowProvider>{children}</SubscribeFlowProvider>;
}
