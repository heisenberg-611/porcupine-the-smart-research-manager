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

/**
 * Which shelf a template sits on.
 *
 * Added when the list went from six to seventeen. Six radio buttons is a
 * choice; seventeen is a wall, and the wall is worse than it looks here —
 * "PICO / randomised trials" and "RoB 2" are not alternatives, they answer
 * different questions, and a flat list invites somebody to pick one INSTEAD of
 * the other when most reviews want both.
 */
export type TemplateGroup = "starter" | "appraisal" | "reporting";

export const TEMPLATE_GROUPS: ReadonlyArray<{
  id: TemplateGroup;
  label: string;
  hint: string;
}> = [
  {
    id: "starter",
    label: "What you are extracting",
    hint: "The study's own content — population, method, results. Most protocols start here.",
  },
  {
    id: "appraisal",
    label: "How good it is",
    hint: "Published risk-of-bias and appraisal instruments. Judged per outcome as often as per paper — check each one's own guidance.",
  },
  {
    id: "reporting",
    label: "How completely it was reported",
    hint: "Reporting checklists. These record what a paper FAILED to say, which is the point of them.",
  },
];

export interface ProtocolTemplate {
  id: string;
  name: string;
  description: string;
  /** Absent means "starter" — the templates that predate the grouping. */
  group?: TemplateGroup;
  fields: TemplateField[];
}

/** Templates on one shelf, in declaration order. */
export function templatesInGroup(group: TemplateGroup): ProtocolTemplate[] {
  return PROTOCOL_TEMPLATES.filter((t) => (t.group ?? "starter") === group);
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
/**
 * Judgement scales, reproduced exactly.
 *
 * These are not labels to be tidied up. "Some concerns" is a defined RoB 2
 * verdict sitting between low and high, and ROBINS-I's "Critical" means the
 * study is too problematic to include in any synthesis — collapsing either
 * into a neater three-point scale would change what a summary table asserts.
 * "No information" is likewise a real answer and not a missing one.
 */
const ROB2_JUDGEMENTS = ["Low risk", "Some concerns", "High risk"];

const ROBINS_JUDGEMENTS = ["Low", "Moderate", "Serious", "Critical", "No information"];

const QUADAS_RISK = ["Low", "High", "Unclear"];
const QUADAS_APPLICABILITY = ["Low concern", "High concern", "Unclear"];

/** MMAT answers each criterion on three values and discourages a total score. */
const MMAT_JUDGEMENTS = ["Yes", "No", "Cannot tell"];

/**
 * GRADE downgrades by one or two levels per domain, so "serious" and "very
 * serious" are the words that carry the arithmetic and cannot be merged.
 */
const GRADE_DOWNGRADE = ["Not serious", "Serious (−1)", "Very serious (−2)"];

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
  // ── Published instruments ─────────────────────────────────────────────────
  //
  // The templates above were written for this app. The ones below are not:
  // each reproduces the DOMAIN STRUCTURE of a published tool, so that a review
  // required to report against one does not have to retype it from the paper.
  //
  // What is reproduced is the list of domains or items and a short hint in our
  // own words. The instruments' own guidance — the signalling questions, the
  // decision rules that turn answers into a judgement — is not, and could not
  // usefully be: it runs to pages, it is the copyrighted part, and using a
  // risk-of-bias tool without reading its manual is how two reviewers produce
  // two different answers from the same paper. Every description below names
  // the source so it can be looked up.
  //
  // The judgement scales ARE reproduced exactly, because a RoB 2 answer of
  // "Some concerns" means a specific thing and an approximation of it is worse
  // than useless in a summary table.
  {
    id: "rob2",
    name: "Risk of bias 2 (RoB 2)",
    description:
      "Cochrane's tool for randomised trials: five domains and an overall judgement. Sterne et al., BMJ 2019.",
    group: "appraisal",
    fields: [
      {
        label: "Randomisation process",
        type: "ENUM",
        required: true,
        options: ROB2_JUDGEMENTS,
        helpText: "Allocation sequence, concealment, and baseline imbalances.",
      },
      {
        label: "Deviations from intended interventions",
        type: "ENUM",
        required: true,
        options: ROB2_JUDGEMENTS,
        helpText:
          "Effect of assignment, or of adhering to it, depending on your question.",
      },
      {
        label: "Missing outcome data",
        type: "ENUM",
        required: true,
        options: ROB2_JUDGEMENTS,
      },
      {
        label: "Measurement of the outcome",
        type: "ENUM",
        required: true,
        options: ROB2_JUDGEMENTS,
      },
      {
        label: "Selection of the reported result",
        type: "ENUM",
        required: true,
        options: ROB2_JUDGEMENTS,
        helpText: "Judged against a pre-specified analysis plan, where one exists.",
      },
      {
        label: "Overall risk of bias",
        type: "ENUM",
        required: true,
        options: ROB2_JUDGEMENTS,
      },
      {
        label: "Outcome assessed",
        type: "TEXT",
        required: true,
        helpText:
          "RoB 2 is judged PER OUTCOME, not per study. Name which one this row is about.",
      },
      {
        label: "Support for judgement",
        type: "QUOTE",
        requiresAnchor: true,
        helpText: "Quote the sentence the judgement rests on.",
      },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "robins-i",
    name: "ROBINS-I (non-randomised studies)",
    description:
      "Seven bias domains for non-randomised studies of interventions, judged against a hypothetical target trial. Sterne et al., BMJ 2016.",
    group: "appraisal",
    fields: [
      {
        label: "Bias due to confounding",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Bias in selection of participants",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Bias in classification of interventions",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Bias due to deviations from intended interventions",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Bias due to missing data",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Bias in measurement of outcomes",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Bias in selection of the reported result",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Overall risk of bias",
        type: "ENUM",
        required: true,
        options: ROBINS_JUDGEMENTS,
      },
      {
        label: "Confounders considered",
        type: "LONG_TEXT",
        helpText:
          "List them. The confounding domain cannot be judged without saying which were expected.",
      },
      {
        label: "Support for judgement",
        type: "QUOTE",
        requiresAnchor: true,
        helpText: "Quote the sentence the most serious domain judgement rests on.",
      },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "quadas-2",
    name: "QUADAS-2 (diagnostic accuracy)",
    description:
      "Four domains, each judged for risk of bias, and the first three also for applicability. Whiting et al., Ann Intern Med 2011.",
    group: "appraisal",
    fields: [
      {
        label: "Patient selection — risk of bias",
        type: "ENUM",
        required: true,
        options: QUADAS_RISK,
      },
      {
        label: "Patient selection — applicability",
        type: "ENUM",
        required: true,
        options: QUADAS_APPLICABILITY,
      },
      {
        label: "Index test — risk of bias",
        type: "ENUM",
        required: true,
        options: QUADAS_RISK,
      },
      {
        label: "Index test — applicability",
        type: "ENUM",
        required: true,
        options: QUADAS_APPLICABILITY,
      },
      {
        label: "Reference standard — risk of bias",
        type: "ENUM",
        required: true,
        options: QUADAS_RISK,
      },
      {
        label: "Reference standard — applicability",
        type: "ENUM",
        required: true,
        options: QUADAS_APPLICABILITY,
      },
      {
        label: "Flow and timing — risk of bias",
        type: "ENUM",
        required: true,
        options: QUADAS_RISK,
        helpText: "No applicability judgement for this domain, by design.",
      },
      { label: "Index test", type: "TEXT", required: true },
      { label: "Reference standard", type: "TEXT", required: true },
      {
        label: "2×2 counts",
        type: "QUOTE",
        requiresAnchor: true,
        helpText: "True/false positives and negatives, quoted from the paper.",
      },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "tidier",
    name: "TIDieR (describing an intervention)",
    description:
      "The twelve items an intervention must be described against to be replicable. Hoffmann et al., BMJ 2014.",
    group: "reporting",
    fields: [
      { label: "Brief name", type: "TEXT", required: true },
      {
        label: "Why — rationale or theory",
        type: "LONG_TEXT",
        required: true,
        helpText: "The goal, the theory, or the mechanism the intervention rests on.",
      },
      { label: "What — materials", type: "LONG_TEXT" },
      { label: "What — procedures", type: "LONG_TEXT", required: true },
      {
        label: "Who provided",
        type: "TEXT",
        helpText: "Expertise, background, and any specific training given.",
      },
      {
        label: "How — mode of delivery",
        type: "ENUM",
        options: [
          "Face to face, individual",
          "Face to face, group",
          "Telephone",
          "Digital or online",
          "Printed materials",
          "Mixed",
          "Other",
        ],
      },
      { label: "Where — setting", type: "TEXT" },
      {
        label: "When and how much",
        type: "TEXT",
        required: true,
        helpText: "Number of sessions, schedule, duration, intensity, dose.",
      },
      {
        label: "Tailoring",
        type: "LONG_TEXT",
        helpText: "If it was personalised or adapted, what decided that and how.",
      },
      { label: "Modifications during the study", type: "LONG_TEXT" },
      { label: "How well — planned adherence", type: "LONG_TEXT" },
      { label: "How well — actual adherence", type: "LONG_TEXT" },
      {
        label: "Description as published",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText:
          "The paper's own account of the intervention. TIDieR is an audit of what was written, so paraphrasing it destroys the thing being audited.",
      },
      {
        label: "Items not reported",
        type: "MULTI_ENUM",
        options: [
          "Materials",
          "Procedures",
          "Provider",
          "Mode",
          "Setting",
          "Dose",
          "Tailoring",
          "Modifications",
          "Adherence",
        ],
        helpText:
          "The point of TIDieR is finding what is MISSING. Record the gaps rather than leaving fields blank.",
      },
    ],
  },
  {
    id: "mmat",
    name: "MMAT (mixed methods appraisal)",
    description:
      "Two screening questions, then five criteria for whichever of the five study categories applies. Hong et al., 2018 version.",
    group: "appraisal",
    fields: [
      {
        label: "S1 — Are there clear research questions?",
        type: "ENUM",
        required: true,
        options: MMAT_JUDGEMENTS,
      },
      {
        label: "S2 — Do the collected data address the questions?",
        type: "ENUM",
        required: true,
        options: MMAT_JUDGEMENTS,
        helpText:
          "If either screening answer is No or Cannot tell, MMAT says appraisal may not be worth continuing.",
      },
      {
        label: "Study category",
        type: "ENUM",
        required: true,
        options: [
          "Qualitative",
          "Randomised controlled trial",
          "Non-randomised",
          "Quantitative descriptive",
          "Mixed methods",
        ],
        helpText: "Which of the five sets of five criteria applies.",
      },
      { label: "Criterion 1", type: "ENUM", required: true, options: MMAT_JUDGEMENTS },
      { label: "Criterion 2", type: "ENUM", required: true, options: MMAT_JUDGEMENTS },
      { label: "Criterion 3", type: "ENUM", required: true, options: MMAT_JUDGEMENTS },
      { label: "Criterion 4", type: "ENUM", required: true, options: MMAT_JUDGEMENTS },
      { label: "Criterion 5", type: "ENUM", required: true, options: MMAT_JUDGEMENTS },
      {
        label: "Rationale for each judgement",
        type: "LONG_TEXT",
        required: true,
        helpText:
          "MMAT explicitly discourages an overall score. The reasoning is the output, not a number.",
      },
      {
        label: "Methods text relied on",
        type: "QUOTE",
        requiresAnchor: true,
        helpText: "Quote the passage the criteria were judged from.",
      },
    ],
  },
  {
    id: "grade",
    name: "GRADE (certainty of evidence)",
    description:
      "Certainty per outcome, rated down for five reasons and up for three. Guyatt et al., J Clin Epidemiol 2011. Judged across studies, not within one.",
    group: "appraisal",
    fields: [
      {
        label: "Outcome",
        type: "TEXT",
        required: true,
        helpText: "GRADE is rated PER OUTCOME. One row per outcome, not per paper.",
      },
      {
        label: "Starting certainty",
        type: "ENUM",
        required: true,
        options: ["High (randomised)", "Low (observational)"],
      },
      {
        label: "Risk of bias",
        type: "ENUM",
        required: true,
        options: GRADE_DOWNGRADE,
      },
      { label: "Inconsistency", type: "ENUM", required: true, options: GRADE_DOWNGRADE },
      { label: "Indirectness", type: "ENUM", required: true, options: GRADE_DOWNGRADE },
      { label: "Imprecision", type: "ENUM", required: true, options: GRADE_DOWNGRADE },
      {
        label: "Publication bias",
        type: "ENUM",
        required: true,
        options: ["Undetected", "Strongly suspected"],
      },
      {
        label: "Reasons to rate up",
        type: "MULTI_ENUM",
        options: [
          "Large effect",
          "Dose-response gradient",
          "Plausible confounding would reduce the effect",
        ],
        helpText:
          "Observational evidence only, and only when no reason to downgrade applies.",
      },
      {
        label: "Overall certainty",
        type: "ENUM",
        required: true,
        options: ["High", "Moderate", "Low", "Very low"],
      },
      {
        label: "Result this study contributes",
        type: "QUOTE",
        requiresAnchor: true,
        helpText:
          "GRADE is rated across studies; this is the one estimate THIS paper brings to the outcome, quoted.",
      },
      {
        label: "Explanation",
        type: "LONG_TEXT",
        required: true,
        helpText: "A summary-of-findings footnote has to say why, not just what.",
      },
    ],
  },
  {
    id: "spider",
    name: "SPIDER (qualitative and mixed methods)",
    description:
      "Sample, Phenomenon of Interest, Design, Evaluation, Research type — PICO's counterpart for questions about experience. Cooke et al., Qual Health Res 2012.",
    group: "starter",
    fields: [
      {
        label: "Sample",
        type: "TEXT",
        required: true,
        helpText:
          "Who took part. SPIDER says sample rather than population on purpose — qualitative work does not claim to generalise from one.",
      },
      {
        label: "Phenomenon of interest",
        type: "TEXT",
        required: true,
        helpText:
          "The behaviour, experience or decision being studied, not the intervention given.",
      },
      {
        label: "Design",
        type: "ENUM",
        required: true,
        options: [
          "Interviews",
          "Focus groups",
          "Observation",
          "Survey",
          "Case study",
          "Questionnaire",
          "Mixed",
          "Other",
        ],
      },
      {
        label: "Evaluation",
        type: "TEXT",
        required: true,
        helpText:
          "What the study measured or reported — views, attitudes, experiences, barriers.",
      },
      {
        label: "Research type",
        type: "ENUM",
        required: true,
        options: ["Qualitative", "Quantitative", "Mixed methods"],
      },
      {
        label: "Key finding",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Quote the paper stating it, not your summary of it.",
      },
      { label: "Theoretical framework", type: "TEXT" },
      { label: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "scoping-review",
    name: "Scoping review charting",
    description:
      "The charting fields a scoping review maps its literature onto, following the JBI approach and reported against PRISMA-ScR. Tricco et al., Ann Intern Med 2018.",
    group: "starter",
    fields: [
      { label: "Author and year", type: "TEXT", required: true },
      { label: "Country", type: "TEXT", required: true },
      {
        label: "Aim or purpose",
        type: "LONG_TEXT",
        required: true,
        helpText: "In the paper's own terms.",
      },
      { label: "Population and sample size", type: "TEXT", required: true },
      {
        label: "Methodology",
        type: "ENUM",
        required: true,
        options: [
          "Quantitative",
          "Qualitative",
          "Mixed methods",
          "Review",
          "Theoretical or conceptual",
          "Grey literature",
          "Other",
        ],
      },
      { label: "Concept or intervention", type: "TEXT", required: true },
      { label: "Context", type: "TEXT" },
      {
        label: "Key findings relevant to the review question",
        type: "LONG_TEXT",
        required: true,
        helpText:
          "A scoping review charts and maps rather than appraising. There is deliberately no risk-of-bias field here.",
      },
      {
        label: "Authors' own statement of the finding",
        type: "QUOTE",
        requiresAnchor: true,
        helpText:
          "Charting compresses a paper into a row. This is the sentence the row was compressed from.",
      },
      {
        label: "Evidence gaps named by the authors",
        type: "LONG_TEXT",
        helpText: "Usually the most reusable thing in a scoping review.",
      },
    ],
  },
  {
    id: "charms",
    name: "CHARMS (prediction model reviews)",
    description:
      "The eleven domains for reviewing prognostic or diagnostic prediction model studies. Moons et al., PLoS Med 2014.",
    group: "starter",
    fields: [
      {
        label: "Source of data",
        type: "ENUM",
        required: true,
        options: [
          "Cohort",
          "Case-control",
          "Randomised trial data",
          "Registry",
          "Routinely collected",
          "Other",
        ],
      },
      { label: "Participants", type: "TEXT", required: true },
      {
        label: "Outcome to be predicted",
        type: "TEXT",
        required: true,
        helpText:
          "Including how and when it was measured, and whether blind to predictors.",
      },
      {
        label: "Candidate predictors",
        type: "LONG_TEXT",
        required: true,
        helpText: "How many were considered, and how they were measured.",
      },
      { label: "Sample size", type: "NUMBER", required: true },
      {
        label: "Events per variable",
        type: "NUMBER",
        helpText: "The number that decides whether the model was overfitted.",
      },
      {
        label: "Missing data handling",
        type: "ENUM",
        options: [
          "Complete case",
          "Single imputation",
          "Multiple imputation",
          "Not reported",
          "Other",
        ],
      },
      {
        label: "Model development",
        type: "LONG_TEXT",
        required: true,
        helpText: "Modelling method, predictor selection, and any shrinkage.",
      },
      {
        label: "Model performance",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Discrimination and calibration, quoted with their numbers.",
      },
      {
        label: "Model evaluation",
        type: "ENUM",
        required: true,
        options: [
          "Development only",
          "Internal validation",
          "External validation",
          "Development and external validation",
        ],
      },
      { label: "Interpretation and limitations", type: "LONG_TEXT" },
    ],
  },
  {
    id: "strobe",
    name: "STROBE items (observational studies)",
    description:
      "The extraction-relevant items from the 22-item STROBE checklist, for cohort, case-control and cross-sectional studies. von Elm et al., BMJ 2007.",
    group: "reporting",
    fields: [
      {
        label: "Study design",
        type: "ENUM",
        required: true,
        options: ["Cohort", "Case-control", "Cross-sectional"],
      },
      { label: "Setting and dates", type: "TEXT", required: true },
      {
        label: "Eligibility criteria",
        type: "LONG_TEXT",
        required: true,
        helpText: "Including how participants were selected and followed.",
      },
      { label: "Participants analysed", type: "NUMBER", required: true },
      { label: "Outcomes and exposures", type: "TEXT", required: true },
      {
        label: "Confounders adjusted for",
        type: "LONG_TEXT",
        required: true,
        helpText:
          "STROBE's most-skipped item, and the one that decides whether a result means anything.",
      },
      {
        label: "Statistical methods",
        type: "TEXT",
        required: true,
      },
      {
        label: "Missing data addressed",
        type: "BOOLEAN",
        helpText: "Whether the paper says what it did about them at all.",
      },
      {
        label: "Main result",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "With its confidence interval, quoted rather than rounded.",
      },
      { label: "Limitations stated by the authors", type: "LONG_TEXT" },
      { label: "Funding and conflicts", type: "TEXT" },
    ],
  },
  {
    id: "cheers",
    name: "CHEERS items (economic evaluations)",
    description:
      "The extraction-relevant items from the 28-item CHEERS 2022 checklist, for health-economic evaluations. Husereau et al., BMJ 2022.",
    group: "reporting",
    fields: [
      {
        label: "Type of evaluation",
        type: "ENUM",
        required: true,
        options: [
          "Cost-effectiveness",
          "Cost-utility",
          "Cost-benefit",
          "Cost-minimisation",
          "Cost-consequence",
          "Other",
        ],
      },
      { label: "Population and setting", type: "TEXT", required: true },
      { label: "Comparators", type: "TEXT", required: true },
      {
        label: "Perspective",
        type: "ENUM",
        required: true,
        options: ["Healthcare payer", "Health system", "Societal", "Patient", "Other"],
        helpText: "The single item that most changes a reported ratio.",
      },
      { label: "Time horizon", type: "TEXT", required: true },
      {
        label: "Discount rate",
        type: "TEXT",
        required: true,
        helpText: "For costs and outcomes. Say if none was applied.",
      },
      {
        label: "Currency and price year",
        type: "TEXT",
        required: true,
        helpText: "Without the year, a cost cannot be compared with anything.",
      },
      {
        label: "Outcome measure",
        type: "ENUM",
        options: ["QALY", "DALY", "Life years", "Natural units", "Monetary", "Other"],
      },
      {
        label: "Incremental cost-effectiveness ratio",
        type: "QUOTE",
        required: true,
        requiresAnchor: true,
        helpText: "Quoted with its units and comparator.",
      },
      {
        label: "Uncertainty analysis",
        type: "MULTI_ENUM",
        options: [
          "One-way sensitivity",
          "Probabilistic",
          "Scenario",
          "Threshold",
          "None reported",
        ],
      },
      { label: "Funding and conflicts", type: "TEXT" },
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
