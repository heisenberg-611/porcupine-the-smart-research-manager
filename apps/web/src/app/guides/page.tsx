import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Guides | Porcupine",
  description: "Guides page for Porcupine.",
};

export default function GuidesPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Guides" 
        description="Learn more about guides."
        backHref="/"
        backLabel="Home"
      />
      
      <div className="prose max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl prose-h2:font-bold prose-h2:text-accent prose-h2:border-b prose-h2:border-rule prose-h2:pb-2 prose-h2:mt-12 prose-h2:mb-6">
        <p className="text-lg font-medium text-ink">
          Step-by-step guides and tutorials for getting the most out of your systematic literature reviews.
        </p>
        <p>
          We are currently working on expanding this section. Check back soon for more detailed information and comprehensive resources!
        </p>
      </div>
    </main>
  );
}
