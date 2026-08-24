/**
 * Contributor Types and Styles
 * For instructions on adding new contributors, see docs/CONTRIBUTORS_GUIDE.md
 */
import rawContributors from "@/data/contributors.json";

export type ContributionCategory =
  | "Feedback"
  | "Feature Suggestion"
  | "Code"
  | "Design"
  | "Research"
  | "Documentation";

export interface Contributor {
  id: string;
  name: string;
  role: string;
  avatar?: string | undefined;
  link?: string | undefined;
  type: ContributionCategory;
  badge: string;
  contribution: string;
  date: string;
}

export const BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "🌟 Core Advisor": {
    bg: "bg-amber-500/10 dark:bg-amber-400/10",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-500/25",
  },
  "💡 Feature Architect": {
    bg: "bg-indigo-500/10 dark:bg-indigo-400/10",
    text: "text-indigo-700 dark:text-indigo-300",
    border: "border-indigo-500/25",
  },
  "🔍 UX & Usability Hero": {
    bg: "bg-teal-500/10 dark:bg-teal-400/10",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-500/25",
  },
  "⚡ Performance Champion": {
    bg: "bg-orange-500/10 dark:bg-orange-400/10",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-500/25",
  },
  "🛡️ Security & Privacy Guard": {
    bg: "bg-emerald-500/10 dark:bg-emerald-400/10",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-500/25",
  },
  "🧪 Bug Hunter & QA": {
    bg: "bg-rose-500/10 dark:bg-rose-400/10",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-500/25",
  },
  "📚 Review Methodology Pioneer": {
    bg: "bg-blue-500/10 dark:bg-blue-400/10",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-500/25",
  },
  "🚀 Early Adopter": {
    bg: "bg-purple-500/10 dark:bg-purple-400/10",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-500/25",
  },
  "🤝 Community Champion": {
    bg: "bg-pink-500/10 dark:bg-pink-400/10",
    text: "text-pink-700 dark:text-pink-300",
    border: "border-pink-500/25",
  },
  "📝 Docs & Guides Contributor": {
    bg: "bg-slate-500/10 dark:bg-slate-400/10",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-500/25",
  },
};

export const CATEGORY_COLORS: Record<ContributionCategory, string> = {
  Feedback: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20",
  "Feature Suggestion": "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  Code: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20",
  Design: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20",
  Research: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  Documentation: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
};

/**
 * Loads all contributors from the contributors.json data file.
 */
export function getContributors(): Contributor[] {
  return rawContributors as unknown as Contributor[];
}
