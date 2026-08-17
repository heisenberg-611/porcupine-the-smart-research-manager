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
      <div className="prose max-w-none prose-p:leading-relaxed prose-p:mb-6 prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl [&_h2]:text-2xl prose-h2:font-bold [&_h2]:font-bold prose-h2:text-accent [&_h2]:text-accent prose-h2:border-b [&_h2]:border-b prose-h2:border-rule [&_h2]:border-rule prose-h2:pb-2 [&_h2]:pb-2 prose-h2:mt-12 [&_h2]:mt-12 prose-h2:mb-6 [&_h2]:mb-6 prose-li:text-lg prose-li:my-4 prose-strong:text-lg prose-strong:font-bold prose-strong:text-ink [&_strong]:font-bold">
        
        <h2>Welcome</h2>
        <p>
          <strong>Introduction:</strong> Welcome to Porcupine. Porcupine is a collection of services, including a research management platform and storage subscription services (the “Services”), integrated with the Porcupine web application. Your access to and use of the Services are subject to these Terms of Service (“Terms of Service”) and all applicable laws. 
        </p>
        <p>
          <strong>Acceptance of Terms:</strong> By accessing and/or using the Services, you acknowledge that you have read, understood and agree to be bound by these Terms of Service and to comply with all applicable laws.
        </p>

        <h2>1. Your Account/Registration</h2>
        <p>
          <strong>Age Requirement:</strong> Registration is required to subscribe to the Services. You must be 13 years or older to subscribe to the Services. By registering, you represent and warrant that all information provided by you during the registration process is truthful, accurate and complete, and you will not use the Services for any purpose that is unlawful.
        </p>
        <p>
          <strong>Account Security:</strong> You are responsible for maintaining the security of your account. You agree to notify us immediately of any unauthorized use of your account. We cannot and will not be liable for any loss or damage in the event of an unauthorized use by a third party of your account.
        </p>

        <h2>2. Your Submissions and Other Data</h2>
        <p>
          <strong>Ownership Retained:</strong> We do not claim ownership of any data or other content you transmit, upload or store on or through the Services (“Submissions”). You retain your rights to the Submissions you transmit, upload or store on or through the Services. You are solely responsible for all your Submissions and all activity that occurs under your account.
        </p>
        <p>
          <strong>Limited License to Process:</strong> By using the Services, you automatically grant to Porcupine and its service providers a limited, royalty-free license and right to store, display, process, modify, and retransmit your Submissions solely to provide the Services to you. Notably, your End-to-End Encrypted data (like messages and LaTeX documents) cannot be read or processed by us in plaintext.
        </p>

        <h2>3. Fees and Payment</h2>
        <p>
          <strong>Storage Charges:</strong> The Services are offered under free and/or paid subscriptions. The fees for paid subscriptions are not license fees, but charges due for storage and related services.
        </p>
        <p>
          <strong>Billing Information:</strong> You agree to provide complete and accurate billing information in connection with your paid subscription(s). All fees and charges, when paid, are nonrefundable and accrue on the first day of the initial subscription term. We reserve the right to change the fees with prior notice.
        </p>

        <h2>4. Acceptable Use and Conduct</h2>
        <p>
          <strong>Prohibited Activities:</strong> As a condition of your access and use of the Services, you agree that you will not: (a) impersonate any individual or entity; (b) use the Services in any manner with the intent to interrupt, damage, disable, overburden or impair the Services; (c) use the Services in violation of any applicable laws; or (d) attempt to circumvent, reverse engineer, decrypt or otherwise alter or interfere with the Services.
        </p>

        <h2>5. Third-Party Services and Integrations</h2>
        <p>
          <strong>Google Services (Auth, Docs, Drive, Sheets):</strong> Our Service integrates with Google for authentication (Google Auth) and offers features that connect directly with your Google Workspace account (e.g., creating and accessing Google Drive folders, Google Docs, and Google Sheets). By utilizing these features, you must also comply with Google's Terms of Service and Acceptable Use Policies. Porcupine explicitly adheres to the Google API Services User Data Policy regarding the strict limited use of your data.
        </p>
        <p>
          <strong>Supabase (Database and Authentication):</strong> We use Supabase as our backend database and authentication provider. By using our Services, you acknowledge that your data may be stored and processed by Supabase in accordance with their privacy policies and terms of service.
        </p>
        <p>
          <strong>Vercel (Hosting):</strong> Our web application is hosted and deployed using Vercel. Vercel acts as a sub-processor and may process limited connection data in accordance with their policies to provide hosting and infrastructure services.
        </p>

        <h2>6. Changes to and Termination of the Services</h2>
        <p>
          <strong>Service Modifications:</strong> We aim to continually improve the delivery and content of the Services and, as a result, we will make changes to the Services from time to time. New features may be added, but we also may modify or discontinue any element of the Services. We will notify you if there are any material changes.
        </p>
        <p>
          <strong>Right to Terminate:</strong> We reserve the right, at any time, to disable the Services temporarily for security or maintenance reasons, or to terminate your access if you violate these Terms.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          <strong>Damages Disclaimer:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, PORCUPINE AND ITS SERVICE PROVIDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION, LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR ACCESS TO OR USE OF OR INABILITY TO ACCESS OR USE THE SERVICES.
        </p>

        <h2>8. Disclaimer of Warranties</h2>
        <p>
          <strong>Service Provided "As Is":</strong> YOUR ACCESS TO AND USE OF THE SERVICES IS AT YOUR OWN RISK. YOU UNDERSTAND AND AGREE THAT THE SERVICES ARE PROVIDED TO YOU ON AN “AS IS” BASIS WITHOUT ANY WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
        </p>

        <h2>9. General</h2>
        <p>
          <strong>Entire Agreement:</strong> These Terms of Service constitute the entire agreement between you and Porcupine with respect to the use of the Site. Any changes to these Terms of Service will be effective when posted. If the changes are material, we will notify you via an email to the email associated with your account.
        </p>
        <p>
          <strong>Contact Us:</strong> If you have any questions about these Terms, please contact us at <Link href="mailto:dhrubojyoti.saha@g.bracu.ac.bd" className="text-accent hover:underline">dhrubojyoti.saha@g.bracu.ac.bd</Link>.
        </p>
      </div>
    </main>
  );
}
