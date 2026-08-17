import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy Policy | Porcupine",
  description: "Privacy policy for Porcupine Research Manager.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Privacy Policy" 
        description={`Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
        backHref="/"
        backLabel="Home"
      />
      
      <div className="prose prose-zinc dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink">
        <p>
          At Porcupine, we take your privacy and the security of your research data seriously. This Privacy Policy outlines how we collect, use, and protect your information when you use the Porcupine Research Manager.
        </p>

        <h2>Information We Collect</h2>
        <p>
          When you use Porcupine, we collect information that you provide directly to us, such as when you create an account, create a project, or communicate with us. This includes your name, email address, and authentication information.
        </p>

        <h2>Research Data and Encryption</h2>
        <p>
          Your research data, including your notes, annotations, and messages, are an essential part of your work. We use encryption to protect this data. By design, certain sensitive data is encrypted in your browser before it reaches our servers, meaning we cannot read it and cannot recover it for you if you lose access.
        </p>

        <h2>Third-Party Services & Google Workspace</h2>
        <p>
          Porcupine integrates with third-party services like Google Workspace and various academic databases to provide you with a seamless research experience. When you connect these services, we only request the permissions necessary for the integration to function.
        </p>
        <p className="mt-4 border-l-4 border-primary pl-4 italic">
          Porcupine's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Google API Services User Data Policy</a>, including the Limited Use requirements.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. If we make significant changes, we will notify you by revising the date at the top of the policy and, in some cases, we may provide you with additional notice (such as adding a statement to our homepage or sending you a notification).
        </p>
      </div>
    </main>
  );
}
