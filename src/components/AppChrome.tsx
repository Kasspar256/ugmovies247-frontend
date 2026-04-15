import type { ReactNode } from 'react';
import DesktopHeader from './DesktopHeader';
import SiteFooter from './SiteFooter';

export default function AppChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <DesktopHeader />
      {children}
      <SiteFooter />
    </>
  );
}
