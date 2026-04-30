import type { Metadata } from 'next';
import LegalDocumentPage, {
  LegalBulletList,
  LegalInlineLink,
  LegalSection,
} from '@/components/legal/LegalDocumentPage';

export const metadata: Metadata = {
  title: 'Account Deletion | UGMOVIES247',
  description:
    'Request deletion of your UGMOVIES247 account and associated user data from the app or web.',
};

export default function AccountDeletionPage() {
  return (
    <LegalDocumentPage
      eyebrow="Privacy Control"
      title="Account Deletion"
      lastUpdated="April 30, 2026"
      summary={
        <>
          UGMOVIES247 lets users delete their app account and request deletion of associated user
          data. You can start deletion inside the app or use this web page if you no longer have
          access to the app.
        </>
      }
    >
      <LegalSection title="1. Delete Your Account Inside the App">
        <p>
          If you can sign in, open Profile, go to Security, type DELETE in the confirmation box, and
          select Delete My Account. The in-app deletion flow removes the account from active systems
          and signs you out.
        </p>
      </LegalSection>

      <LegalSection title="2. Request Deletion From the Web">
        <p>
          If you cannot access the app, email{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com?subject=UGMOVIES247%20Account%20Deletion%20Request">
            info@ugmovies247.com
          </LegalInlineLink>{' '}
          with the subject "UGMOVIES247 Account Deletion Request".
        </p>
        <LegalBulletList>
          <li>Include the email address or phone number connected to your account.</li>
          <li>Write that you want your UGMOVIES247 account deleted.</li>
          <li>Do not send your password or payment credentials.</li>
          <li>We may ask for reasonable verification before deleting account data.</li>
        </LegalBulletList>
      </LegalSection>

      <LegalSection title="3. Data Removed">
        <p>
          Account deletion removes supported user-owned records from active systems, including the
          account profile, login sessions, saved titles, likes, watchlist records, notification
          preferences, and related account state.
        </p>
      </LegalSection>

      <LegalSection title="4. Limited Data We May Retain">
        <p>
          We may retain limited records where required for security, fraud prevention, legal
          compliance, dispute handling, accounting, abuse prevention, or backup integrity. Backup
          copies may remain for a limited time before being overwritten through normal system
          maintenance.
        </p>
      </LegalSection>

      <LegalSection title="5. Processing Time and Support">
        <p>
          We aim to process verified deletion requests within a reasonable time. Questions about
          account deletion, privacy, or data retention can be sent to{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com">info@ugmovies247.com</LegalInlineLink>.
        </p>
      </LegalSection>
    </LegalDocumentPage>
  );
}
