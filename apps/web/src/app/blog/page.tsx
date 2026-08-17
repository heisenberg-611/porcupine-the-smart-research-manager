import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Blog | Porcupine",
  description: "Blog page for Porcupine.",
};

export default function BlogPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader 
        title="Blog" 
        description="Learn more about blog."
        backHref="/"
        backLabel="Home"
      />
      
      <div className="prose max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl prose-h2:font-bold prose-h2:text-accent prose-h2:border-b prose-h2:border-rule prose-h2:pb-2 prose-h2:mt-12 prose-h2:mb-6">
        <p className="text-lg font-medium text-ink">
          Read the latest thoughts, case studies, and news from the Porcupine team.
        </p>
        <p>
          We are currently working on expanding this section. Check back soon for more detailed information and comprehensive resources!
        </p>
      </div>
    </main>
  );
}
