import type { ReactNode } from 'react';
import DesktopHeader from './DesktopHeader';

export default function AppChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <DesktopHeader />
      {children}
    </>
  );
}
