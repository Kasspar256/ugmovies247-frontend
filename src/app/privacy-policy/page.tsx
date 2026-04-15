import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocumentPage from '@/components/legal/LegalDocumentPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | UG Movies 247',
  description: 'Privacy Policy for UG Movies 247 explaining account data, technical data, notifications, and deletion requests.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      eyebrow="Legal"
      title="Privacy Policy"
      updatedLabel="April 15, 2026"
      summary={
        <>
          This Privacy Policy explains how UG Movies 247 collects, uses, and protects personal and
          technical information when you use our platform. It also explains how you can request
          account data changes or deletion.
        </>
      }
      sections={[
        {
          title: 'Information We Collect',
          items: [
            'Account information such as your name, email address, profile preferences, and subscription state.',
            'Payment-related records tied to subscription access, including plan choice, payment status, provider references, and billing operator details needed to manage entitlement and support.',
            'Technical and usage information such as session activity, device/browser details, IP-related request data, and platform logs used for reliability and security.',
          ],
        },
        {
          title: 'How We Use Information',
          items: [
            'To authenticate your account, provide access to protected content, and maintain your subscription status.',
            'To process payments, respond to support issues, investigate abuse, and improve reliability, security, and service quality.',
            'To communicate important account, service, or legal notices related to your use of UG Movies 247.',
          ],
        },
        {
          title: 'Notifications and Communications',
          paragraphs: [
            'Where notification preferences are supported, UG Movies 247 may use your stored settings to decide whether to send certain account or platform communications.',
            'Some operational or security notices may still be sent when necessary to protect accounts, explain service changes, or complete support and billing workflows.',
          ],
        },
        {
          title: 'Cookies and Technical Data',
          paragraphs: [
            'We use cookies and similar technical mechanisms to maintain secure sessions, remember account state, support login flow, and improve platform performance.',
            'We may also collect request metadata and technical logs that help detect misuse, support troubleshooting, and maintain a stable streaming experience.',
          ],
        },
        {
          title: 'Data Deletion Requests',
          paragraphs: [
            'If you want to request deletion of your account data, contact us using the support email below. We may need to retain limited information where required for legal compliance, fraud prevention, payment reconciliation, or legitimate business records.',
            <>
              To request account data deletion or a privacy review, email{' '}
              <Link href="mailto:info@ugmovies247.com" className="text-[#FFB3C1] underline decoration-white/20 underline-offset-4">
                info@ugmovies247.com
              </Link>
              .
            </>,
          ],
        },
        {
          title: 'Children',
          paragraphs: [
            'UG Movies 247 is not intended for children who are below the age permitted by applicable law to use the service without appropriate consent. We do not knowingly seek to collect personal information from children in violation of applicable legal requirements.',
          ],
        },
        {
          title: 'Policy Updates',
          paragraphs: [
            'We may update this Privacy Policy from time to time to reflect changes in the platform, legal requirements, or operational practices. The latest posted version will apply from the stated effective date.',
          ],
        },
        {
          title: 'Contact',
          paragraphs: [
            <>
              Privacy questions and data-related requests can be sent to{' '}
              <Link href="mailto:info@ugmovies247.com" className="text-[#FFB3C1] underline decoration-white/20 underline-offset-4">
                info@ugmovies247.com
              </Link>
              .
            </>,
          ],
        },
      ]}
    />
  );
}
