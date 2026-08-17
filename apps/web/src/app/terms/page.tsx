import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Porcupine",
  description: "Terms of Service and usage guidelines for Porcupine.",
};

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Terms of Service" 
        description={`Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
        backHref="/"
        backLabel="Home"
      />
      
      <div className="prose max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl prose-h2:font-bold prose-h2:text-accent prose-h2:border-b prose-h2:border-rule prose-h2:pb-2 prose-h2:mt-12 prose-h2:mb-6 prose-li:text-lg prose-li:my-4 prose-strong:text-ink">
        <p className="text-lg font-medium text-ink">
          Welcome to Porcupine, a service developed and maintained by Dhrubojyoti. These Terms of Service ("Terms") govern your access to and use of the Porcupine website, software, and services (collectively, the "Service"). 
        </p>
        <p>
          By accessing or using the Service, you agree to be bound by these Terms. If you disagree with any part of the terms, you do not have permission to access the Service.
        </p>

        <h2>1. Description of Service</h2>
        <p>
          Porcupine is a literature review management platform designed to assist researchers, students, and collaborative teams in organizing, screening, extracting, and reporting data for systematic literature reviews. The Service deeply integrates with third-party productivity tools (such as Google Workspace) to facilitate collaborative drafting and data export.
        </p>

        <h2>2. Accounts and Responsibilities</h2>
        <p>
          When you create an account with us, you must provide information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.
        </p>
        <p>
          You are responsible for safeguarding the password and authentication methods that you use to access the Service and for any activities or actions under your account. You agree not to disclose your password to any third party. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.
        </p>

        <h2>3. User Content and Intellectual Property</h2>
        <p>
          <strong>Your Content:</strong> You retain all rights and ownership to the research data, papers, annotations, and metadata you submit or upload to the Service ("User Content"). By uploading User Content, you grant Porcupine a limited, worldwide, non-exclusive license to host, store, and process this content solely for the purpose of providing and operating the Service to you.
        </p>
        <p>
          <strong>Our Content:</strong> The Service and its original content (excluding User Content), features, and functionality are and will remain the exclusive property of Porcupine and its licensors. The Service is protected by copyright, trademark, and other laws of both the United States and foreign countries.
        </p>

        <h2>4. Acceptable Use Policy</h2>
        <p>
          You agree not to use the Service:
        </p>
        <ul>
          <li>In any way that violates any applicable national or international law or regulation.</li>
          <li>For the purpose of exploiting, harming, or attempting to exploit or harm minors in any way by exposing them to inappropriate content or otherwise.</li>
          <li>To transmit, or procure the sending of, any advertising or promotional material, including any "junk mail," "chain letter," "spam," or any other similar solicitation.</li>
          <li>To impersonate or attempt to impersonate Porcupine, a Porcupine employee, another user, or any other person or entity.</li>
          <li>In any way that infringes upon the rights of others, or in any way is illegal, threatening, fraudulent, or harmful.</li>
        </ul>

        <h2>5. Integration with Google Workspace</h2>
        <p>
          Our Service offers features that integrate directly with your Google Workspace account (e.g., creating Google Drive folders, Google Docs, and Google Sheets). By utilizing these features, you must also comply with Google's Terms of Service and Acceptable Use Policies. Porcupine explicitly adheres to the <Link href="/privacy" className="text-accent hover:underline">Google API Services User Data Policy</Link> regarding the strict limited use of your data.
        </p>

        <h2>6. Limitation of Liability</h2>
        <p>
          In no event shall Porcupine, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from:
        </p>
        <ul>
          <li>Your access to or use of or inability to access or use the Service.</li>
          <li>Any conduct or content of any third party on the Service.</li>
          <li>Any content obtained from the Service.</li>
          <li>Unauthorized access, use, or alteration of your transmissions or content.</li>
        </ul>

        <h2>7. Termination</h2>
        <p>
          We may terminate or suspend your account and bar access to the Service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever and without limitation, including but not limited to a breach of the Terms.
        </p>
        <p>
          If you wish to terminate your account, you may simply discontinue using the Service or request account deletion via your settings.
        </p>

        <h2>8. Changes to Terms</h2>
        <p>
          We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion. By continuing to access or use our Service after any revisions become effective, you agree to be bound by the revised terms.
        </p>

        <h2>9. Contact Us</h2>
        <p>
          If you have any questions about these Terms, please <Link href="mailto:support@porcupineresearch.me" className="text-accent hover:underline">contact us</Link>.
        </p>
      </div>
    </main>
  );
}
