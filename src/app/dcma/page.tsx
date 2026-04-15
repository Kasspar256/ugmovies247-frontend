import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocumentPage from '@/components/legal/LegalDocumentPage';

export const metadata: Metadata = {
  title: 'DMCA Policy | UG Movies 247',
  description: 'DMCA policy for UG Movies 247 explaining how copyright owners or authorized agents may submit notices.',
};

export default function DMCAPage() {
  return (
    <LegalDocumentPage
      eyebrow="Legal"
      title="DMCA Policy"
      updatedLabel="April 15, 2026"
      summary={
        <>
          UG Movies 247 takes copyright infringement concerns seriously. Copyright owners or their
          authorized agents may submit a DMCA notice when they believe material on the platform
          infringes protected rights.
        </>
      }
      sections={[
        {
          title: 'Submitting a Notice',
          paragraphs: [
            'If you are a copyright owner or an authorized representative, you may send a notice identifying the allegedly infringing material and the rights claimed to be affected.',
            'Notices should be complete, accurate, and submitted in good faith. Incomplete notices may delay review or may not be actionable.',
          ],
        },
        {
          title: 'What a Valid DMCA Notice Should Include',
          items: [
            'A clear description of the copyrighted work you claim has been infringed.',
            'A clear description of the specific material you want us to review or remove, including enough information for us to identify it on the platform.',
            'Your full name and contact information, including an email address that can be used to reach you.',
            'A statement that you have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.',
            'A statement that the information in the notice is accurate and, under penalty of perjury where applicable, that you are authorized to act on behalf of the copyright owner.',
            'Your physical or electronic signature.',
          ],
        },
        {
          title: 'False or Misleading Claims',
          paragraphs: [
            'Submitting false, misleading, abusive, or knowingly inaccurate takedown notices may create legal consequences. Only send a notice when you are genuinely authorized and confident in the claim being made.',
          ],
        },
        {
          title: 'Incomplete Notices',
          paragraphs: [
            'A notice that lacks the required identifying details, authority statement, or contact information may not be effective. We may request clarification before taking action, or we may be unable to process the notice at all.',
          ],
        },
        {
          title: 'DMCA Contact',
          paragraphs: [
            <>
              Send DMCA notices and related copyright inquiries to{' '}
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
