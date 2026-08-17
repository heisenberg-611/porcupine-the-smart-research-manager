import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Porcupine",
  description: "Privacy Policy for Porcupine research management platform.",
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
      <div className="prose max-w-none prose-p:leading-relaxed prose-p:mb-6 prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl [&_h2]:text-2xl prose-h2:font-bold [&_h2]:font-bold prose-h2:text-accent [&_h2]:text-accent prose-h2:border-b [&_h2]:border-b prose-h2:border-rule [&_h2]:border-rule prose-h2:pb-2 [&_h2]:pb-2 prose-h2:mt-12 [&_h2]:mt-12 prose-h2:mb-6 [&_h2]:mb-6 prose-li:text-lg prose-li:my-4 prose-strong:text-lg prose-strong:font-bold prose-strong:text-ink [&_strong]:font-bold">

        <h2>Overview</h2>
        <p>
          <strong>Your Data is Yours:</strong> Porcupine is a project committed to providing the best tool for managing your research, literature reviews, and thesis writing. Our philosophy is that what you put into Porcupine is yours, and one of our founding principles is to make sure you remain in control of your data and can share it how you like — or choose not to share it at all.
        </p>
        <p>
          <strong>No Financial Interest in Your Data:</strong> We have no financial interest in your private information. We do not sell your data. We fund further development through subscriptions for additional features and storage space, not by selling data.
        </p>

        <h2>Data We Collect</h2>
        <p>
          Some of Porcupine’s advanced features require you to supply us with information:
        </p>
        <ul>
          <li><strong>Account Information:</strong> We collect the information you voluntarily provide (e.g., your name and email address) when you create a Porcupine account.</li>
          <li><strong>Library Data:</strong> We collect the library data, extractions, and screening decisions you upload to synchronize your research with our servers.</li>
          <li><strong>Attachments:</strong> We collect the attachment files (like PDFs) you upload when managing your research library.</li>
          <li><strong>Access Logs:</strong> We log visits to our website, including IP address and browser, in order to prevent abuse and to diagnose technical issues. We retain these access logs for 90 days.</li>
        </ul>

        <h2>Security and Encryption of Stored Data</h2>
        <p>
          Porcupine employs a tiered encryption approach to ensure your data remains secure:
        </p>
        <ul>
          <li><strong>End-to-End Encrypted (E2EE):</strong> Messages (channels and DMs) and LaTeX sources are fully end-to-end encrypted using XChaCha20-Poly1305. The server stores only ciphertext, meaning we cannot read this data, nor can we recover it for you if you lose access.</li>
          <li><strong>Server-Confidential:</strong> Membership, roles, screening status, annotations, extraction values, and activity logs are encrypted at rest on our servers. This allows us to provide powerful server-side search, sorting, and aggregation features for your evidence tables.</li>
          <li><strong>Public:</strong> Basic scholarly metadata (like paper titles, DOIs) and your display name are stored plainly.</li>
        </ul>

        <h2>Permissions Warnings and Integrations</h2>
        <p>
          When using third-party platforms, we request the most restrictive permissions available that still allow Porcupine to perform its advertised functions.
        </p>

        <h3>Google Workspace Integration</h3>
        <p>
          <strong>Restrictive Permissions:</strong> To provide seamless collaboration and identity verification, Porcupine integrates with Google Workspace and Google Authentication. When you connect your Google account, you grant Porcupine the following scopes: <strong><code>https://www.googleapis.com/auth/drive.file</code></strong>, <strong><code>email</code></strong>, and <strong><code>profile</code></strong>. The <code>drive.file</code> scope is a highly restrictive permission that only allows Porcupine to see, edit, create, and delete Google Docs and Sheets that the app <em>specifically created</em> or that you explicitly selected via the Google Picker. The <code>email</code> and <code>profile</code> scopes are used exclusively to securely identify you and create your account.
        </p>
        <p>
          <strong>Limited Use Policy:</strong> Porcupine <strong>cannot</strong> read your previous browsing history, nor can it access other files in your Google Drive. We push formatted claims, citations, and generated bibliographies into your documents to streamline your writing process. Porcupine’s use and transfer of information received from Google APIs to any other app will adhere to the <Link href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" className="text-accent hover:underline">Google API Services User Data Policy</Link>, including the Limited Use requirements.
        </p>

        <h2>Third-Party Services Used</h2>
        <p>
          <strong>Cloud Infrastructure:</strong> Porcupine server data is stored securely using cloud infrastructure provided by Vercel, Supabase, and Cloudflare.
        </p>
        <p>
          <strong>Metadata Retrieval:</strong> Certain operations you perform in Porcupine may trigger requests to public third-party services such as OpenAlex, Crossref, arXiv, or Semantic Scholar for metadata retrieval. These third parties may log your IP address and search terms (e.g., DOI) according to their privacy policies, but no other identifying personal information is provided.
        </p>

        <h2>Support Interactions</h2>
        <p>
          <strong>Communication Data:</strong> If you email us or submit an error report, we collect your email address and any other information you provide. We don’t store any personal information that links automated error reports to you, and they are generally only viewed in aggregate.
        </p>

        <h2>Deleting Your Data</h2>
        <p>
          <strong>Right to Erasure:</strong> You may delete your Porcupine account at any time to remove the information you voluntarily provided when you registered and to remove the library data you synchronized with our servers.
        </p>

        <h2>Changes</h2>
        <p>
          <strong>Policy Updates:</strong> We may update our privacy policies over time. Up-to-date information, including details of new features and how they handle data, will always be available from this page.
        </p>

        <h2>Questions</h2>
        <p>
          <strong>Contact Us:</strong> If you have any questions or concerns regarding Porcupine’s privacy policies, please email <Link href="mailto:dhrubojyoti.saha@g.bracu.ac.bd" className="text-accent hover:underline">dhrubojyoti.saha@g.bracu.ac.bd</Link>.
        </p>
      </div>
    </main>
  );
}
