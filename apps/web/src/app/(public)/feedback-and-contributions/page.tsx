import type { Metadata } from "next";
import { getContributors } from "@/lib/contributors";
import { ContributorsView } from "./contributors-view";

export const metadata: Metadata = {
  title: "Feedback & Community Contributions — porcupineResearch",
  description:
    "Recognizing the researchers, developers, beta testers, and advisors who have given feedback and contributed to upgrading porcupineResearch.",
};

export default function FeedbackAndContributionsPage() {
  const contributors = getContributors();

  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      {/* Header */}
      <header className="border-rule border-b pb-12">
        <p className="text-accent text-fine font-mono tracking-widest uppercase">
          Community & Acknowledgements
        </p>
        <h1 className="text-ink mt-3 font-serif text-4xl leading-tight tracking-tight sm:text-5xl font-bold">
          Feedback & Project Contributors
        </h1>
        <p className="text-ink-soft text-body mt-4 max-w-2xl text-pretty leading-relaxed">
          porcupineResearch is continuously upgraded and refined thanks to feedback, suggestions, and contributions from researchers, students, and engineers around the world.
        </p>
      </header>

      {/* Main Contributor Directory */}
      <div className="mt-10">
        <ContributorsView contributors={contributors} />
      </div>
    </main>
  );
}
