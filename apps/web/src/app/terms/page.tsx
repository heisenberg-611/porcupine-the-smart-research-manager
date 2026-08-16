import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Terms of Service | Porcupine",
  description: "Terms of Service for Porcupine Research Manager.",
};

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Terms of Service" 
        description={`Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
        backHref="/"
        backLabel="Home"
      />
      
      <div className="prose prose-zinc dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink">
        <p>
          Welcome to Porcupine. By accessing or using our platform, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
        </p>

        <h2>Use of Service</h2>
        <p>
          Porcupine is designed to assist researchers, students, and teams in organizing and conducting systematic literature reviews. You agree to use the service only for its intended purposes and in compliance with all applicable laws and regulations.
        </p>

        <h2>Account Responsibilities</h2>
        <p>
          You are responsible for safeguarding the password that you use to access the service and for any activities or actions under your password. You agree not to disclose your password to any third party and to notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.
        </p>

        <h2>Intellectual Property</h2>
        <p>
          The platform, including its original content, features, and functionality, are owned by Porcupine and are protected by international copyright, trademark, patent, trade secret, and other intellectual property or proprietary rights laws. Your research data and imported content remain yours.
        </p>

        <h2>Limitation of Liability</h2>
        <p>
          In no event shall Porcupine, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the service.
        </p>

        <h2>Modifications</h2>
        <p>
          We reserve the right, at our sole discretion, to modify or replace these Terms at any time. What constitutes a material change will be determined at our sole discretion. We will try to provide at least 30 days notice prior to any new terms taking effect.
        </p>
      </div>
    </main>
  );
}
