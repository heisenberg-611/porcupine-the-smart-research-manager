import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Porcupine",
  description: "Comprehensive privacy policy and data protection guidelines for Porcupine.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Privacy Policy" 
        description={`Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
        backHref="/"
        backLabel="Home"
      />
      
      <div className="prose max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl prose-h2:font-bold prose-h2:text-accent prose-h2:border-b prose-h2:border-rule prose-h2:pb-2 prose-h2:mt-12 prose-h2:mb-6 prose-li:text-lg prose-li:my-4 prose-strong:text-ink">
        <p className="text-lg font-medium text-ink">
          At Porcupine (developed and maintained by Dhrubojyoti), we are deeply committed to protecting your privacy and the security of your research data. This Privacy Policy governs the manner in which Porcupine collects, uses, maintains, and discloses information collected from users.
        </p>

        <h2>1. Information We Collect</h2>
        <p>
          We only collect information about you if we have a reason to do so—for example, to provide our Services, to communicate with you, or to make our Services better. We collect information in the following ways:
        </p>
        <ul>
          <li><strong>Account Information:</strong> When you sign up for an account, we collect basic information such as your name, email address, and authentication credentials.</li>
          <li><strong>Research Data:</strong> We store the metadata, literature review data, annotations, and project settings you actively upload or create within the platform.</li>
          <li><strong>Google Workspace Data:</strong> When you connect your Google account, we access certain Google Drive, Docs, and Sheets information exclusively to enable core platform features (see Section 3).</li>
        </ul>

        <h2>2. Data Security and Encryption</h2>
        <p>
          Your research data, including your notes, annotations, and messages, are an essential part of your work. We use industry-standard encryption in transit (HTTPS/TLS) and at rest to protect this data. By design, certain highly sensitive project data may be encrypted in your browser before it reaches our servers, meaning we cannot read it and cannot recover it for you if you lose access.
        </p>

        <h2>3. Third-Party Services & Google Workspace Integration</h2>
        <p>
          Porcupine integrates deeply with third-party services like Google Workspace to provide you with a seamless research experience. When you connect these services, we only request the specific OAuth scopes and permissions strictly necessary for the integration to function.
        </p>
        <p>
          Specifically, to accurately represent our identity and intent regarding Google user data:
        </p>
        <ul>
          <li><strong>Who is requesting data:</strong> Porcupine, developed by Dhrubojyoti.</li>
          <li><strong>What data we request:</strong> We request the restricted <code>drive.file</code> scope. This allows us to see, edit, create, and delete <strong>only</strong> the specific Google Drive files and folders that you open or create with Porcupine. We cannot access your other Drive files.</li>
          <li><strong>Why we request this data:</strong> We request this access solely to automatically provision shared research folders, create collaborative Google Docs for drafting thesis chapters, and export your literature extraction data directly into Google Sheets for analysis.</li>
        </ul>
        <div className="my-6 border-l-4 border-accent bg-accent/5 p-6 rounded-r-lg">
          <h3 className="mt-0 text-accent">Google API Limited Use Disclosure</h3>
          <p className="mb-0 text-sm md:text-base">
            Porcupine's use and transfer to any other app of information received from Google APIs will strictly adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">Google API Services User Data Policy</a>, including the <strong>Limited Use</strong> requirements. We will never use your Google Workspace data for targeted advertising, and we will never sell your data to third-party data brokers.
          </p>
        </div>

        <h2>4. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, operate, and maintain the Porcupine platform.</li>
          <li>Facilitate the synchronization of your literature reviews with your Google Drive.</li>
          <li>Improve, personalize, and expand our Services.</li>
          <li>Communicate with you regarding updates, security alerts, and support messages.</li>
        </ul>

        <h2>5. Data Retention and Deletion</h2>
        <p>
          We retain your personal information and research data only for as long as your account is active or as needed to provide you with our Services. You can request the complete deletion of your account and associated data at any time by contacting our support team or navigating to your account settings.
        </p>

        <h2>6. Information Sharing and Disclosure</h2>
        <p>
          We do not sell, trade, or rent your personal identification information to others. We may share generic aggregated demographic information not linked to any personal identification information regarding visitors and users with our business partners and trusted affiliates. We may disclose your information if required to do so by law or in response to valid requests by public authorities.
        </p>

        <h2>7. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. If we make significant material changes, we will notify you by revising the date at the top of the policy and providing a prominent notice on our platform.
        </p>

        <h2>8. Contact Us</h2>
        <p>
          If you have any questions, concerns, or requests regarding this Privacy Policy or the practices of this site, please <Link href="mailto:support@porcupineresearch.me" className="text-accent hover:underline">contact us</Link>.
        </p>
      </div>
    </main>
  );
}
