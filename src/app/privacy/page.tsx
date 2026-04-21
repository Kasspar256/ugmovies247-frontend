import type { Metadata } from 'next';
import LegalDocumentPage, {
  LegalBulletList,
  LegalInlineLink,
  LegalSection,
  LegalSubsection,
} from '@/components/legal/LegalDocumentPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | UGMOVIES247',
  description:
    'Privacy Policy for UGMOVIES247 covering data collection, streaming infrastructure, subscriptions, payments, deletion requests, and legal compliance.',
};

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      eyebrow="Privacy & Data Use"
      title="Privacy Policy"
      lastUpdated="April 21, 2026"
      summary={
        <>
          This Privacy Policy explains how UGMOVIES247 collects, uses, stores, shares, and protects
          personal information when you browse the platform, create an account, stream content, make
          a payment, contact support, or use connected services. It is written to reflect how the
          live product actually works today, including Firebase-based account systems, Cloudflare R2
          media delivery, and PayFast or Mobile Money subscription payments.
        </>
      }
    >
      <LegalSection title="1. Scope and Who This Policy Applies To">
        <p>
          This Privacy Policy applies to the UGMOVIES247 website, supported mobile experiences,
          subscription checkout flows, support channels, and related legal or compliance requests.
        </p>
        <p>
          It covers information processed when you sign in, manage your account, subscribe, stream
          content, submit a support request, or interact with media links, playback systems, or
          billing tools connected to the service.
        </p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">
        <LegalSubsection title="2.1 Account and identity information">
          <LegalBulletList>
            <li>Name, display name, email address, and account identifiers tied to login.</li>
            <li>Authentication and session data required to keep you signed in securely.</li>
            <li>Profile preferences, saved account settings, and subscription state snapshots.</li>
          </LegalBulletList>
        </LegalSubsection>

        <LegalSubsection title="2.2 Device, usage, and technical information">
          <LegalBulletList>
            <li>IP-related request data, browser type, operating system, device characteristics, and session timestamps.</li>
            <li>Playback and access diagnostics such as page requests, entitlement checks, streaming errors, and service performance logs.</li>
            <li>Cookies, session identifiers, and similar technical markers used to maintain login state, reduce abuse, and improve reliability.</li>
          </LegalBulletList>
        </LegalSubsection>

        <LegalSubsection title="2.3 Subscription and payment information">
          <LegalBulletList>
            <li>Selected plan, duration, amount, currency, payment provider, payment status, and transaction references.</li>
            <li>Recurring billing metadata for card subscriptions where auto-renew has been authorized.</li>
            <li>Provider responses, webhook records, reconciliation logs, and fraud-prevention notes needed to manage access and disputes.</li>
          </LegalBulletList>
        </LegalSubsection>

        <LegalSubsection title="2.4 Content, upload, and source workflow data">
          <p>
            Depending on the workflow being used, media made available through UGMOVIES247 may be
            user-uploaded, administrator-uploaded, partner-supplied, or imported from approved
            external source URLs. When those workflows are used, we may process source file names,
            source links, object keys, file sizes, encoding metadata, and technical job records.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection title="3. How We Use Personal Information">
        <LegalBulletList>
          <li>To create and maintain accounts, authenticate users, and secure access to protected content.</li>
          <li>To verify subscriptions, process payments, manage renewals, and apply the correct streaming entitlements.</li>
          <li>To deliver media through our infrastructure and associated storage or CDN layers.</li>
          <li>To prevent fraud, abuse, unauthorized access, scraping, payment misuse, or copyright violations.</li>
          <li>To investigate support requests, billing problems, technical failures, playback complaints, and legal notices.</li>
          <li>To improve platform stability, measure product performance, and maintain operational analytics or diagnostics.</li>
          <li>To comply with legal obligations, enforce our Terms &amp; Conditions, and protect rights holders, users, and the platform.</li>
        </LegalBulletList>
      </LegalSection>

      <LegalSection title="4. Third-Party Services and Infrastructure">
        <LegalSubsection title="4.1 Firebase services">
          <p>
            We use Firebase services for core product functions such as authentication, account
            state, database operations, and service diagnostics. Those services may process account,
            session, and technical usage data needed to operate the platform.
          </p>
        </LegalSubsection>

        <LegalSubsection title="4.2 Cloudflare R2 and media delivery">
          <p>
            Media files, direct uploads, or prepared streaming assets may be stored or delivered
            through Cloudflare R2 and related public delivery domains. This means streaming,
            download, and upload activity may involve Cloudflare-managed infrastructure as part of
            normal service delivery.
          </p>
        </LegalSubsection>

        <LegalSubsection title="4.3 Payment processors">
          <p>
            Card payments are processed through PayFast. Mobile Money payments are processed through
            PawaPay and supported wallet correspondents made available during checkout. We do not
            need your full card details to charge you directly through our own servers; payment
            credentials are handled by the relevant processor, while we store the payment metadata,
            provider references, and recurring authorization records needed to manage your
            subscription.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection title="5. Cookies, Sessions, and Service Diagnostics">
        <p>
          We use cookies and related session technologies to keep you signed in, remember secure
          session state, connect you to the correct account, and protect the platform from misuse.
        </p>
        <p>
          We also maintain service logs and product diagnostics to understand playback failures,
          subscription errors, abuse signals, broken links, and operational health. These records
          help us keep the service usable and secure.
        </p>
      </LegalSection>

      <LegalSection title="6. Content Sourcing, Illegal Content, and Copyright Compliance">
        <p>
          UGMOVIES247 is not intended to function as a repository for illegal or unauthorized
          content. Content shown on the service may be uploaded or imported through approved
          workflows, including administrator submissions, uploader workflows, or external source
          links, but we reserve the right to disable, remove, or restrict material that appears
          unlawful, infringing, abusive, or otherwise non-compliant.
        </p>
        <p>
          We do not knowingly host or continue distributing content once we believe it is illegal,
          infringing, or otherwise unlawful to make available through the platform.
        </p>
        <p>
          Where we receive a valid legal complaint, DMCA notice, court order, or platform
          compliance request, we may review associated account, upload, playback, and source data
          to investigate and respond appropriately.
        </p>
      </LegalSection>

      <LegalSection title="7. When We Share Information">
        <LegalBulletList>
          <li>With payment providers and financial processors to complete and reconcile subscriptions.</li>
          <li>With cloud, storage, delivery, and infrastructure providers that help us run the service.</li>
          <li>With professional advisers, auditors, legal authorities, or law enforcement where required by law or necessary to protect rights and safety.</li>
          <li>With rights holders or affected parties where needed to investigate infringement, fraud, or abuse allegations.</li>
          <li>As part of a merger, acquisition, restructuring, or asset transfer, subject to appropriate confidentiality safeguards.</li>
        </LegalBulletList>
      </LegalSection>

      <LegalSection title="8. Data Retention">
        <p>
          We keep account and subscription information for as long as your account remains active
          and for a reasonable period afterward where required for legal compliance, tax or
          accounting records, fraud prevention, audit trails, security investigations, or dispute
          handling.
        </p>
        <p>
          Media-processing logs, upload records, source URLs, and streaming diagnostics may also be
          retained for operational troubleshooting, rights-management review, or service integrity.
          Backup copies may remain for a limited period before being overwritten in the ordinary
          course of system maintenance.
        </p>
      </LegalSection>

      <LegalSection title="9. Data Deletion, Access, and Correction Requests">
        <p>
          You may request access to, correction of, or deletion of your personal information by
          contacting us. Before acting on a request, we may ask you to verify your identity and your
          relationship to the account or data in question.
        </p>
        <p>
          We may retain limited information even after a deletion request where retention is
          required for payment reconciliation, tax or accounting rules, fraud prevention, security
          investigations, repeat-infringer tracking, legal holds, or the defense of legal claims.
        </p>
        <p>
          To submit a privacy or deletion request, email{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com">info@ugmovies247.com</LegalInlineLink>.
        </p>
      </LegalSection>

      <LegalSection title="10. Security Practices">
        <p>
          We use reasonable administrative, technical, and organizational safeguards to protect
          personal information, including access controls, authenticated workflows, cloud-provider
          security features, and payment-provider separation for sensitive billing credentials.
        </p>
        <p>
          No internet service can promise absolute security. You are responsible for keeping your
          password and device access secure and for notifying us promptly if you suspect unauthorized
          access to your account.
        </p>
      </LegalSection>

      <LegalSection title="11. Children's Privacy">
        <p>
          UGMOVIES247 is not directed to children under 13, or any higher minimum age required by
          applicable local law for digital services without parental authorization. We do not
          knowingly collect personal information from children in violation of applicable law. If you
          believe a child has provided personal data improperly, contact us so we can review and act
          on the report.
        </p>
      </LegalSection>

      <LegalSection title="12. Policy Changes and Contact">
        <p>
          We may update this Privacy Policy to reflect product changes, new compliance obligations,
          payment-flow changes, infrastructure updates, or evolving legal requirements. When we do,
          we will post the revised version with a new effective date.
        </p>
        <p>
          Privacy questions, deletion requests, compliance concerns, and data-related notices should
          be sent to{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com">info@ugmovies247.com</LegalInlineLink>.
        </p>
      </LegalSection>
    </LegalDocumentPage>
  );
}
