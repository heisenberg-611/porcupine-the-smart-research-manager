import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "API Reference | Porcupine",
  description: "API Reference page for Porcupine.",
};

export default function ApiPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 animate-in fade-in duration-500">
      <PageHeader
        title="API Reference"
        description="Learn more about api reference."
        backHref="/"
        backLabel="Home"
      />

      <div className="prose max-w-none prose-p:leading-relaxed prose-p:text-muted prose-headings:text-ink prose-h2:text-2xl prose-h2:font-bold prose-h2:text-accent prose-h2:border-b prose-h2:border-rule prose-h2:pb-2 prose-h2:mt-12 prose-h2:mb-6">
        <p className="text-lg font-medium text-ink">
          Integrate Porcupine with your own tools. Explore our API endpoints and developer resources.
        </p>
        <p>
          We are currently working on expanding this section. Check back soon for more detailed information and comprehensive resources!
        </p>
      </div>
    </main>
  );
}
