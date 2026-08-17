import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { 
  ShieldCheckIcon, 
  UsersIcon, 
  DocumentTextIcon, 
  ArrowsRightLeftIcon, 
  ChartBarIcon, 
  TableCellsIcon 
} from "@heroicons/react/24/outline";

export const metadata: Metadata = {
  title: "Features | Porcupine",
  description: "Discover the powerful features of Porcupine for your research and literature reviews.",
};

const features = [
  {
    name: "Systematic Literature Review",
    description:
      "Manage every stage of your literature review with built-in abstract and full-text screening, custom tags, and tracking of your inclusion/exclusion criteria.",
    icon: DocumentTextIcon,
  },
  {
    name: "Real-Time Collaboration",
    description:
      "Work simultaneously with your research team. See who is online, edit extraction forms together, and use live chat channels and DMs to coordinate your efforts.",
    icon: UsersIcon,
  },
  {
    name: "End-to-End Encryption",
    description:
      "Your most sensitive data is protected. All team messages and LaTeX documents are fully End-to-End Encrypted (E2EE) so only you and your team can read them.",
    icon: ShieldCheckIcon,
  },
  {
    name: "Google Workspace Integration",
    description:
      "Seamlessly export your evidence tables to Google Sheets or push your drafted claims and citations directly into Google Docs without leaving the app.",
    icon: ArrowsRightLeftIcon,
  },
  {
    name: "Dynamic Evidence Tables",
    description:
      "Extract custom data points from papers and instantly aggregate them into dynamic, sortable, and filterable evidence tables for your thesis or reports.",
    icon: TableCellsIcon,
  },
  {
    name: "Automated PRISMA Diagrams",
    description:
      "Automatically generate and update PRISMA flow diagrams based on your screening decisions, ensuring your methodology reporting is always accurate.",
    icon: ChartBarIcon,
  },
];

export default function FeaturesPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Features" 
        description="Everything you need to manage your research, collaborate with your team, and write your thesis."
        backHref="/"
        backLabel="Home"
      />
      
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 mt-8">
        {features.map((feature) => (
          <div key={feature.name} className="relative flex flex-col gap-4 p-6 rounded-2xl border border-rule bg-surface/50 transition-colors hover:bg-surface">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <feature.icon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink mb-2">
                {feature.name}
              </h3>
              <p className="text-muted leading-relaxed">
                {feature.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl bg-accent/5 p-8 text-center border border-accent/20">
        <h2 className="text-2xl font-bold text-ink mb-4">Ready to streamline your research?</h2>
        <p className="text-muted mb-8 max-w-xl mx-auto">
          Join Porcupine today and take control of your literature reviews with our powerful, secure, and collaborative toolset.
        </p>
        <a 
          href="/signup" 
          className="inline-flex items-center justify-center rounded-full bg-accent px-8 py-3 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-all"
        >
          Get Started for Free
        </a>
      </div>
    </main>
  );
}
