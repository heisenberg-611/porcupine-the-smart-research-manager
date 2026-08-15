/**
 * Protocol field types and the starter templates.
 *
 * A protocol is the set of questions asked of every paper in a review. Getting
 * it right is the hardest part of setting one up, and getting it wrong is
 * expensive: a field added after fifty extractions leaves fifty holes, and one
 * removed silently deletes fifty answers.
 *
 * The templates exist because of that. Nobody should design a PICO protocol
 * from an empty screen when the structure has been standard for thirty years.
 */

export const FIELD_TYPES = [
  {
    type: "TEXT",
    label: "Short text",
    hint: "One line. Study design, country, setting.",
  },
  {
    type: "LONG_TEXT",
    label: "Long text",
    hint: "A paragraph. Notes, caveats, a description of the method.",
  },
  {
    type: "NUMBER",
    label: "Number",
    hint: "Sortable and averageable. Sample size, duration, effect size.",
  },
  {
    type: "BOOLEAN",
    label: "Yes / no",
    hint: "Blinded? Pre-registered? Randomised?",
  },
  {
    type: "ENUM",
    label: "One of several",
    hint: "A fixed list. Study design, risk-of-bias rating.",
  },
  {
    type: "MULTI_ENUM",
    label: "Several of a list",
    hint: "Outcomes measured, populations included.",
  },
  { type: "DATE", label: "Date", hint: "When the study ran, not when it was published." },
  {
    type: "QUOTE",
    label: "Quoted passage",
    hint: "Captures the exact sentence from the paper, with its location.",
  },
  { type: "CITATION", label: "Citation", hint: "A reference to another work." },
  { type: "URL", label: "Link", hint: "A trial registration, a dataset, a repository." },
] as const;

export type FieldType = (typeof FIELD_TYPES)[number]["type"];

export const FIELD_TYPE_VALUES = FIELD_TYPES.map((f) => f.type);

export function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((f) => f.type === type)?.label ?? type;
}

/** Choice fields are the only ones that need an options list. */
export function needsOptions(type: string): boolean {
  return type === "ENUM" || type === "MULTI_ENUM";
}

/**
 * Turn a human label into a stable machine key.
 *
 * The key is what a CSV column is called and what a statistician joins on, so
 * it is generated once from the label and then left alone — renaming it after
 * answers exist is refused by the database, because two exports of the same
 * review would otherwise disagree about what a column is called with nothing
 * in either file saying so.
 */
export function toFieldKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field"
  );
}

export interface TemplateField {
  label: string;
  type: FieldType;
  required?: boolean;
  requiresAnchor?: boolean;
  helpText?: string;
  options?: string[];
}

export interface ProtocolTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
}

/**
 * Starter templates.
 *
 * Deliberately short. A forty-field template looks thorough and gets
 * abandoned at paper three; these cover the reporting requirements and leave
 * the discipline-specific fields to the person who knows the discipline.
 *
 * The `requiresAnchor` fields are the ones a reviewer will challenge — an
 * effect size or a primary outcome without a quoted source is the finding
 * nobody can defend.
 */
export const PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  {
    id: "pico-rct",
    name: "PICO / randomised trials",
    description:
      "Population, intervention, comparator, outcome — the structure clinical reviews are reported against.",
    fields: [
      { label: "Population", type: "TEXT", required: true, helpText: "Who was studied?" },
      { label: "Intervention", type: "TEXT", required: true },
      { label: "Comparator", type: "TEXT" },
      {
        label: "Primary outcome",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Quote the paper's own statement of its primary outcome.",
      },
      { label: "Sample size", type: "NUMBER", required: true },
      {
        label: "Study design",
        type: "ENUM",
        required: true,
        options: [
          "RCT",
          "Cluster RCT",
          "Quasi-experimental",
          "Cohort",
          "Case-control",
          "Other",
        ],
      },
      { label: "Randomised", type: "BOOLEAN" },
      { label: "Blinded", type: "BOOLEAN" },
      {
        label: "Effect size",
        type: "QUOTE",
        requiresAnchor: true,
        helpText: "The reported effect, quoted rather than paraphrased.",
      },
      {
        label: "Risk of bias",
        type: "ENUM",
        options: ["Low", "Some concerns", "High", "Not assessed"],
      },
      { label: "Trial registration", type: "URL" },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "qualitative",
    name: "Qualitative studies",
    description: "Method, participants, themes — for interview and ethnographic work.",
    fields: [
      { label: "Participants", type: "TEXT", required: true },
      {
        label: "Method",
        type: "ENUM",
        required: true,
        options: [
          "Interviews",
          "Focus groups",
          "Ethnography",
          "Case study",
          "Document analysis",
          "Mixed",
        ],
      },
      { label: "Setting", type: "TEXT" },
      { label: "Sampling", type: "TEXT" },
      {
        label: "Key theme",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Quote the paper stating the theme, not your summary of it.",
      },
      { label: "Analytic approach", type: "TEXT" },
      { label: "Reflexivity reported", type: "BOOLEAN" },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "ml-benchmark",
    name: "Machine learning benchmarks",
    description: "Dataset, model, metric, compute — for comparing reported results.",
    fields: [
      { label: "Task", type: "TEXT", required: true },
      { label: "Dataset", type: "TEXT", required: true },
      { label: "Model", type: "TEXT", required: true },
      { label: "Parameters (millions)", type: "NUMBER" },
      {
        label: "Headline metric",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Quote the reported number, so a disputed result has a source.",
      },
      {
        label: "Metric name",
        type: "ENUM",
        required: true,
        options: ["Accuracy", "F1", "BLEU", "ROUGE", "AUC", "Perplexity", "Other"],
      },
      { label: "Compute reported", type: "BOOLEAN" },
      { label: "Code available", type: "URL" },
      { label: "Baseline compared against", type: "TEXT" },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "engineering",
    name: "Engineering systems",
    description: "System, evaluation, constraints — for systems and design papers.",
    fields: [
      { label: "System or technique", type: "TEXT", required: true },
      { label: "Problem addressed", type: "TEXT", required: true },
      {
        label: "Evaluation method",
        type: "ENUM",
        required: true,
        options: [
          "Simulation",
          "Prototype",
          "Field deployment",
          "Analytical",
          "Survey",
          "Other",
        ],
      },
      {
        label: "Reported result",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
      },
      { label: "Constraints or assumptions", type: "LONG_TEXT" },
      { label: "Reproducible", type: "BOOLEAN" },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "literature-review",
    name: "Literature review / Thesis",
    description:
      "Research question, methodology, findings, and relevance — for scoping a topic.",
    fields: [
      {
        label: "Research objective",
        type: "TEXT",
        required: true,
        helpText: "What is the main goal or question of the paper?",
      },
      {
        label: "Methodology",
        type: "TEXT",
        required: true,
        helpText: "How did they conduct the research?",
      },
      {
        label: "Key finding",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Quote the paper's main conclusion or finding.",
      },
      {
        label: "Limitations",
        type: "TEXT",
        helpText: "What are the weaknesses or gaps identified by the authors?",
      },
      {
        label: "Relevance to thesis",
        type: "LONG_TEXT",
        required: true,
        helpText: "How does this paper contribute to your own research?",
      },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "blank",
    name: "Start from nothing",
    description: "An empty protocol. Add the fields your review actually needs.",
    fields: [],
  },
];

export function templateById(id: string): ProtocolTemplate | undefined {
  return PROTOCOL_TEMPLATES.find((t) => t.id === id);
}
