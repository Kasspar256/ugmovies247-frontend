import type { Metadata } from 'next';
import LegalDocumentPage, {
  LegalBulletList,
  LegalInlineLink,
  LegalNumberedList,
  LegalSection,
  LegalSubsection,
} from '@/components/legal/LegalDocumentPage';
import {
  BILLING_OPERATOR,
  CARD_PAYMENT_PROCESSOR,
  SERVICE_BRAND,
} from '@/lib/billingIdentity';

export const metadata: Metadata = {
  title: 'Terms & Conditions | UGMOVIES247',
  description:
    'Terms & Conditions for UGMOVIES247 covering accounts, subscriptions, billing, auto-renewal, mobile money, streaming limitations, user conduct, and legal rights.',
};

export default function TermsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Platform Rules"
      title="Terms & Conditions"
      lastUpdated="April 21, 2026"
      summary={
        <>
          These Terms &amp; Conditions govern your use of {SERVICE_BRAND}, including account
          registration, streaming access, subscription purchases, recurring card billing, Mobile
          Money transactions, content availability, and acceptable use. By visiting the platform,
          creating an account, clicking to subscribe, or continuing to use the service, you agree to
          these terms.
        </>
      }
    >
      <LegalSection title="1. Acceptance of These Terms">
        <p>
          By accessing or using {SERVICE_BRAND}, you agree to be bound by these Terms &amp;
          Conditions, our Privacy Policy, DMCA Policy, and any posted rules or checkout disclosures
          presented to you during the subscription process.
        </p>
        <p>
          If you do not agree to these terms, do not use the service, create an account, or attempt
          to purchase a subscription.
        </p>
      </LegalSection>

      <LegalSection title="2. Electronic Agreement and Consent">
        <p>
          Creating an account, selecting a plan, clicking a subscription or checkout button,
          authorizing a payment, or enabling auto-renewal constitutes your electronic acceptance of
          these Terms &amp; Conditions. Those actions have the same effect as a written signature to
          the extent permitted by applicable law.
        </p>
      </LegalSection>

      <LegalSection title="3. Eligibility, Age, and Account Registration">
        <LegalSubsection title="3.1 Age requirements">
          <p>
            You must be at least 13 years old, or any higher minimum age required by the laws of
            your location, to use the service. If you are below the age required to enter into a
            binding contract, a parent or legal guardian must supervise your use and accept these
            terms on your behalf.
          </p>
        </LegalSubsection>

        <LegalSubsection title="3.2 Registration obligations">
          <LegalBulletList>
            <li>You must provide accurate and current information when you create or update an account.</li>
            <li>You are responsible for maintaining the confidentiality of your password, session, and device access.</li>
            <li>You are responsible for all activity carried out through your account unless you report unauthorized use promptly.</li>
            <li>You may not impersonate another person or create accounts for fraudulent or abusive purposes.</li>
          </LegalBulletList>
        </LegalSubsection>
      </LegalSection>

      <LegalSection title="4. Nature of the Service and Streaming Availability">
        <p>
          {SERVICE_BRAND} is a digital streaming service that may provide access to movies, series,
          translated content, and related media experiences through browser-based playback and
          supported devices.
        </p>
        <p>
          Streaming quality, playback speed, subtitle or dubbing availability, and access continuity
          depend on your device, network, browser, source quality, content availability, platform
          maintenance, and third-party infrastructure. We do not guarantee uninterrupted playback,
          permanent availability of any title, or compatibility with every device or browser.
        </p>
      </LegalSection>

      <LegalSection title="5. Content Sources and Responsibility Disclaimer">
        <p>
          Content made available through the platform may be uploaded, linked, processed, or managed
          through administrator workflows, uploader workflows, partner workflows, or approved
          external source imports. We reserve the right to remove, disable, replace, or restrict any
          title, link, stream, or asset at any time.
        </p>
        <p>
          We do not knowingly host or continue distributing illegal or clearly unauthorized content
          after it has been identified through moderation, rights-holder review, legal notice, or
          internal compliance checks.
        </p>
        <p>
          You may not submit, upload, request, or distribute content through the service unless you
          have the necessary rights or authorization. We may investigate copyright complaints,
          remove questionable material, and suspend or terminate access where infringement, fraud, or
          abuse is suspected.
        </p>
      </LegalSection>

      <LegalSection title="6. Subscription Plans, Billing, and Checkout">
        <LegalSubsection title="6.1 Plan terms">
          <p>
            Subscription plan length, price, currency, and billing method are shown during the
            purchase flow. Access begins only after the relevant payment provider confirms a
            successful transaction.
          </p>
        </LegalSubsection>

        <LegalSubsection title="6.2 Card payments">
          <p>
            Card payments are processed by {CARD_PAYMENT_PROCESSOR}. The consumer-facing brand is{' '}
            {SERVICE_BRAND}, but billing may be handled by {BILLING_OPERATOR} as the service
            operator or merchant of record.
          </p>
          <p>
            Card checkout may be settled in ZAR or another processor-supported currency presented at
            the secure checkout page, even if plan comparisons elsewhere in the product display a
            local price reference or equivalent.
          </p>
        </LegalSubsection>

        <LegalSubsection title="6.3 Regional and Local Payment Methods">
          <p>
            Where supported, we may offer local payment methods or mobile wallet options during the
            checkout process. The availability of these methods depends on your geographic region,
            network support, and device compatibility. Transactions made through these methods may
            remain pending until confirmed by the relevant provider; a pending or unconfirmed
            transaction does not grant active subscription status.
          </p>
        </LegalSubsection>

        <LegalSubsection title="6.4 Manual and One-Off Payments">
          <p>
            Payments made via local wallets or regional vouchers are generally treated as one-off
            transactions. These do not support auto-renewal and require a new manual authorization
            for each subsequent billing period.
          </p>
        </LegalSubsection>

        <LegalSubsection title="6.5 Failed renewals and payment problems">
          <LegalBulletList>
            <li>We may retry a recurring charge after a failure where processor rules allow it.</li>
            <li>Access may be paused, downgraded, or terminated if a renewal is not completed successfully.</li>
            <li>We may cancel recurring billing if the stored token becomes invalid, revoked, expired, or unsupported.</li>
            <li>Bank charges, wallet fees, foreign exchange differences, or provider-side deductions are your responsibility unless the law says otherwise.</li>
          </LegalBulletList>
        </LegalSubsection>

        <LegalSubsection title="6.6 Pricing changes">
          <p>
            We may change pricing, plan structure, duration, or included features at any time. The
            updated price will apply to future purchases and, where permitted by law and the payment
            provider, to future renewals after appropriate notice.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection title="7. No Refunds Policy">
        <p>
          Except where required by law, subscription purchases are final and non-refundable once
          access has been granted, a stream has been made available, or a billing authorization has
          been successfully processed.
        </p>
        <p>We may review refund requests in limited cases such as:</p>
        <LegalBulletList>
          <li>Duplicate charges caused by a verified billing error.</li>
          <li>Unauthorized charges confirmed through a legitimate fraud review.</li>
          <li>A platform fault that prevented access entirely and is verified by our logs before substantial use occurred.</li>
          <li>Any other situation where a refund is required by non-waivable law.</li>
        </LegalBulletList>
        <p>
          Refund or billing questions should be sent to{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com">info@ugmovies247.com</LegalInlineLink>.
        </p>
      </LegalSection>

      <LegalSection title="8. Device Compatibility and Technical Requirements">
        <LegalBulletList>
          <li>You are responsible for maintaining a compatible device, browser, internet connection, and software environment.</li>
          <li>We may optimize, re-encode, replace, or remove streams to maintain compatibility, performance, or compliance.</li>
          <li>Playback quality may vary based on bandwidth, device capability, codec support, screen size, and content source quality.</li>
          <li>Downloads, offline access, casting, mini-player behavior, and other advanced playback features may differ by device or platform version.</li>
        </LegalBulletList>
      </LegalSection>

      <LegalSection title="9. User Conduct Rules">
        <LegalNumberedList>
          <li>Do not share accounts, resell subscriptions, or bypass payment or entitlement controls.</li>
          <li>Do not scrape, copy, mirror, frame, reverse engineer, or interfere with the platform or its protective mechanisms.</li>
          <li>Do not upload, link, or request material that infringes copyright, violates privacy, or breaks the law.</li>
          <li>Do not use bots, automation, credential stuffing, or bulk access scripts to misuse the service.</li>
          <li>Do not attempt to obtain unauthorized admin access, storage access, or backend processing privileges.</li>
        </LegalNumberedList>
      </LegalSection>

      <LegalSection title="10. Intellectual Property">
        <p>
          The platform interface, branding, design, code, original text, logos, and other proprietary
          materials belonging to {SERVICE_BRAND} or its licensors are protected by applicable
          intellectual property laws.
        </p>
        <p>
          If you submit content, upload links, or provide metadata through any authorized workflow,
          you represent that you have the necessary rights to do so and grant us the limited rights
          needed to host, process, cache, transmit, review, and display that material for service
          operation, legal review, and enforcement.
        </p>
      </LegalSection>

      <LegalSection title="11. External Services and Links">
        <p>
          Parts of the platform depend on third-party services, including payment processors, cloud
          storage, delivery networks, authentication providers, and source-link workflows. Those
          services may be subject to their own terms and privacy notices.
        </p>
        <p>
          We are not responsible for third-party websites, processors, telecom networks, wallet
          providers, or external source sites that are not controlled by us.
        </p>
        <p>
          Please note that specific feature availability—including available payment methods,
          content categories, and UI elements—is dynamic and may vary based on your geographic
          location, device type, application version, and current regional support status.
        </p>
      </LegalSection>

      <LegalSection title="12. Suspension, Termination, and Enforcement">
        <p>
          We may suspend, restrict, cancel, or terminate your account, subscription, uploads,
          recurring billing, or platform access at any time if we reasonably believe that you have
          violated these terms, failed to pay, engaged in fraud, abused the platform, created legal
          risk, or jeopardized rights-holder compliance.
        </p>
        <p>
          You may stop using the service at any time. Termination does not automatically erase
          outstanding payment obligations, chargeback liabilities, or claims that arose before the
          termination date.
        </p>
      </LegalSection>

      <LegalSection title="13. Disclaimers and Limitation of Liability">
        <p>
          To the maximum extent permitted by law, the service is provided on an &quot;as is&quot; and
          &quot;as available&quot; basis. We do not guarantee uninterrupted streaming, error-free
          playback, permanent title availability, or that every device or network will support every
          feature.
        </p>
        <p>
          To the extent permitted by law, {SERVICE_BRAND}, {BILLING_OPERATOR}, and related operators,
          affiliates, and service providers will not be liable for indirect, incidental, special,
          consequential, punitive, or lost-profit damages arising out of or connected with your use
          of the service.
        </p>
        <p>
          Where liability cannot be excluded entirely, our aggregate liability will be limited to the
          amounts you paid directly to us for the affected subscription period that gave rise to the
          claim.
        </p>
      </LegalSection>

      <LegalSection title="14. Governing Law and Jurisdiction">
        <p>
          These Terms &amp; Conditions are governed by the laws of Uganda, except to the extent that
          non-waivable consumer protection laws in your place of residence apply. You agree that any
          dispute relating to the service may be brought before the courts with competent jurisdiction
          in Uganda, subject to mandatory legal rights that apply to you.
        </p>
      </LegalSection>

      <LegalSection title="15. Changes to These Terms">
        <p>
          We may update these terms to reflect changes in the platform, payment systems, legal
          obligations, pricing models, device support, or content workflows. The updated version will
          take effect when posted unless a later effective date is stated.
        </p>
      </LegalSection>

      <LegalSection title="16. Contact">
        <p>
          Questions about these Terms &amp; Conditions, billing issues, legal notices, or compliance
          matters should be sent to{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com">info@ugmovies247.com</LegalInlineLink>.
        </p>
      </LegalSection>
    </LegalDocumentPage>
  );
}
