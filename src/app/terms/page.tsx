import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocumentPage from '@/components/legal/LegalDocumentPage';
import {
  BILLING_OPERATOR,
  CARD_PAYMENT_PROCESSOR,
  SERVICE_BRAND,
} from '@/lib/billingIdentity';

export const metadata: Metadata = {
  title: 'Terms of Service | UG Movies 247',
  description:
    'Terms of Service for UG Movies 247 covering accounts, subscriptions, billing, acceptable use, and platform access.',
};

export default function TermsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Legal"
      title="Terms of Service"
      updatedLabel="April 15, 2026"
      summary={
        <>
          These Terms of Service govern access to UG Movies 247, including our website, streaming
          experience, account features, and subscription services. By creating an account, browsing
          the platform, or purchasing access, you agree to follow these terms.
        </>
      }
      sections={[
        {
          title: 'Acceptance of Terms',
          paragraphs: [
            'By using UG Movies 247, you agree to these Terms of Service and any policies referenced within them. If you do not agree, do not access or use the platform.',
            'You are responsible for making sure your use of the service is lawful in your location and consistent with any payment, communications, and content rules that apply to you.',
          ],
        },
        {
          title: 'Accounts',
          paragraphs: [
            'You must provide accurate information when creating or maintaining an account. You are responsible for protecting your login credentials and for all activity that happens under your account.',
            'You may not impersonate another person, share access in a way that misuses the service, or attempt to bypass account, payment, or content restrictions.',
          ],
        },
        {
          title: 'Subscriptions and Access',
          paragraphs: [
            'Some content or features may require an active paid subscription. Subscription access is granted only after a payment is successfully confirmed through the supported billing flow.',
            'Subscription duration, plan pricing, and access windows are presented at checkout. Access may expire automatically when the purchased period ends unless renewed through a valid payment.',
          ],
        },
        {
          title: 'Billing and Payments',
          paragraphs: [
            `${SERVICE_BRAND} is the consumer-facing service brand. Subscription billing may be processed by ${BILLING_OPERATOR}, the registered operator and merchant of record behind the service.`,
            `Card payments are processed securely through ${CARD_PAYMENT_PROCESSOR}. Mobile Money payments are handled through the supported wallet providers made available in checkout. Payment availability may depend on region, provider support, or technical availability.`,
            'Failed, cancelled, or unconfirmed transactions do not create paid entitlement, and access is activated only after the payment provider confirms the transaction successfully.',
          ],
        },
        {
          title: 'Refunds',
          paragraphs: [
            'Refund decisions are handled case by case. A refund is not automatically guaranteed simply because a plan was purchased.',
            <>
              Where required by law or where a payment issue is clearly attributable to the platform
              or processor, we may review and resolve the matter through support. Contact us at{' '}
              <Link
                href="mailto:info@ugmovies247.com"
                className="text-[#FFB3C1] underline decoration-white/20 underline-offset-4"
              >
                info@ugmovies247.com
              </Link>
              .
            </>,
          ],
        },
        {
          title: 'Acceptable Use',
          items: [
            'Do not misuse the platform, interfere with its operation, scrape protected data, or attempt to access systems or features you are not authorized to use.',
            'Do not upload, transmit, or request content in a way that infringes intellectual property, privacy, or other legal rights.',
            'Do not use automation, credential sharing, account resale, or technical workarounds to evade pricing, subscription rules, or platform safeguards.',
          ],
        },
        {
          title: 'Intellectual Property',
          paragraphs: [
            'UG Movies 247, its branding, interface, original design elements, and platform materials are protected by applicable intellectual property laws.',
            'Nothing in these terms transfers ownership of the platform or grants broader rights beyond the limited right to use the service as provided.',
          ],
        },
        {
          title: 'Termination and Suspension',
          paragraphs: [
            'We may suspend or terminate access where necessary to address misuse, fraud, legal risk, non-payment, security concerns, or violations of these terms.',
            "You may stop using the service at any time. Termination does not automatically erase payment obligations or remove rights holders' claims that arose before termination.",
          ],
        },
        {
          title: 'Changes to These Terms',
          paragraphs: [
            'We may update these terms from time to time to reflect legal, operational, or service changes. Updated terms become effective when posted unless a different effective date is stated.',
          ],
        },
        {
          title: 'Contact',
          paragraphs: [
            <>
              Questions about these terms can be sent to{' '}
              <Link
                href="mailto:info@ugmovies247.com"
                className="text-[#FFB3C1] underline decoration-white/20 underline-offset-4"
              >
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
