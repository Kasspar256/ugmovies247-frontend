import type { Metadata } from 'next';
import LegalDocumentPage, {
  LegalBulletList,
  LegalInlineLink,
  LegalNumberedList,
  LegalSection,
  LegalSubsection,
} from '@/components/legal/LegalDocumentPage';

export const metadata: Metadata = {
  title: 'DMCA Policy | UGMOVIES247',
  description:
    'DMCA Policy for UGMOVIES247 explaining how copyright complaints, counter-notices, repeat infringement handling, and anti-abuse enforcement work.',
};

export default function DmcaPage() {
  return (
    <LegalDocumentPage
      eyebrow="Copyright Compliance"
      title="DMCA Policy"
      lastUpdated="April 21, 2026"
      summary={
        <>
          UGMOVIES247 respects the intellectual property rights of copyright owners and expects
          users, uploaders, and source providers to do the same. This policy explains how copyright
          owners or their authorized agents can report allegedly infringing material and how we
          process those complaints.
        </>
      }
    >
      <LegalSection title="1. How to Report Alleged Infringement">
        <p>
          If you believe material available through UGMOVIES247 infringes your copyright, please
          send a written DMCA notice to our designated contact using the information below. Notices
          must be complete enough for us to identify the work, find the material, and verify that
          the complaint is being made in good faith.
        </p>
        <p>
          We review notices promptly, but incomplete or unclear submissions may delay action because
          we may need to request clarification before locating or disabling the reported material.
        </p>
      </LegalSection>

      <LegalSection title="2. Required Contents of a Valid DMCA Notice">
        <p>A proper notice should contain all of the following items:</p>

        <LegalSubsection title="A. Identification of the copyrighted work">
          <p>
            Describe the original copyrighted work that you claim has been infringed. If multiple
            works are covered by one notice, provide a representative list that is specific enough
            for us to evaluate the complaint.
          </p>
        </LegalSubsection>

        <LegalSubsection title="B. Identification of the allegedly infringing material">
          <p>
            Provide the exact title, page URL, playback URL, direct link, or other location details
            that will allow us to identify the material quickly. General statements without location
            data may not be actionable.
          </p>
        </LegalSubsection>

        <LegalSubsection title="C. Your contact information">
          <p>
            Include your full legal name, company or rights-holder identity where applicable, email
            address, mailing address, and phone number so we can contact you about the notice.
          </p>
        </LegalSubsection>

        <LegalSubsection title="D. Good-faith statement">
          <p>
            Include a statement that you have a good-faith belief that the disputed use is not
            authorized by the copyright owner, its agent, or the law.
          </p>
        </LegalSubsection>

        <LegalSubsection title="E. Accuracy and authority statement">
          <p>
            Include a statement that the information in your notice is accurate and, under penalty
            of perjury where applicable, that you are the copyright owner or are authorized to act
            on the owner's behalf.
          </p>
        </LegalSubsection>

        <LegalSubsection title="F. Physical or electronic signature">
          <p>
            Sign the notice physically or electronically. An unsigned notice may be rejected as
            incomplete.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection title="3. Where to Send DMCA Notices">
        <p>
          Send copyright complaints, takedown notices, and supporting materials to{' '}
          <LegalInlineLink href="mailto:info@ugmovies247.com">info@ugmovies247.com</LegalInlineLink>.
        </p>
        <p>
          Use a clear subject line such as <strong>DMCA Notice</strong> so the request can be routed
          quickly.
        </p>
      </LegalSection>

      <LegalSection title="4. What Happens After We Receive a Notice">
        <LegalNumberedList>
          <li>We review the notice to confirm whether it appears complete and credible.</li>
          <li>We may request clarification or additional evidence if the claim is incomplete or ambiguous.</li>
          <li>We may disable access to, remove, or restrict the reported material while we investigate.</li>
          <li>We may notify the uploader, source submitter, or account holder associated with the material.</li>
          <li>Where appropriate, we may preserve records needed for repeat-infringer review, legal defense, or law-enforcement cooperation.</li>
        </LegalNumberedList>
      </LegalSection>

      <LegalSection title="5. Counter-Notice Process">
        <p>
          If material was removed or disabled because of a DMCA notice and you believe the action
          was a mistake or misidentification, you may send a counter-notice. A valid counter-notice
          should include:
        </p>
        <LegalBulletList>
          <li>Your full contact information.</li>
          <li>Identification of the material that was removed or disabled and where it appeared before removal.</li>
          <li>A statement, under penalty of perjury where applicable, that you have a good-faith belief the material was removed by mistake or misidentification.</li>
          <li>A statement consenting to the jurisdiction required by applicable DMCA rules, where relevant.</li>
          <li>Your physical or electronic signature.</li>
        </LegalBulletList>
        <p>
          We may forward a compliant counter-notice to the original complaining party and may restore
          the material where permitted by law and platform policy if no further valid legal action is
          presented.
        </p>
      </LegalSection>

      <LegalSection title="6. Repeat Infringement Policy">
        <p>
          UGMOVIES247 may suspend, restrict, or terminate accounts, uploader workflows, source-link
          privileges, or related platform access for repeat infringers or for users who repeatedly
          submit material that appears unauthorized or unlawful.
        </p>
      </LegalSection>

      <LegalSection title="7. Anti-Abuse and Misrepresentation">
        <p>
          DMCA notices and counter-notices must be truthful and submitted in good faith. Knowingly
          false, abusive, automated, misleading, or bad-faith notices may create legal liability and
          may also result in platform enforcement, refusal to process future submissions, or
          disclosure where required by law.
        </p>
      </LegalSection>

      <LegalSection title="8. Fast Response and Cooperation">
        <p>
          We aim to respond to valid copyright complaints as quickly as reasonably possible.
          Response time may vary depending on the completeness of the notice, the clarity of the
          reported location, technical verification needs, and whether the complaint raises complex
          ownership or licensing questions.
        </p>
      </LegalSection>
    </LegalDocumentPage>
  );
}
