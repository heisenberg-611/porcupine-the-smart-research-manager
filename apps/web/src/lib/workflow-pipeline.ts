export type WorkflowStepId =
  | "questions"
  | "search"
  | "screen"
  | "protocol"
  | "extract"
  | "evidence";

export type WorkflowStepStatus = "completed" | "current" | "upcoming";

export interface WorkflowStep {
  id: WorkflowStepId;
  stepNumber: number;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  status: WorkflowStepStatus;
  percent: number;
  metric: string;
  isActionable: boolean;
}

export interface NextAction {
  stepId: WorkflowStepId;
  href: string;
  label: string;
  why: string;
}

export interface WorkflowPipelineResult {
  steps: WorkflowStep[];
  overallPercent: number;
  completedStepsCount: number;
  totalStepsCount: number;
  nextAction: NextAction;
}

export interface PipelineInputs {
  projectId: string;
  questionCount: number;
  papers: number;
  unscreened: number;
  included: number;
  excluded: number;
  hasProtocol: boolean;
  extracted: number;
  awaiting: number;
  dualExtraction?: boolean;
}

/**
 * Calculates the status, percentage, and live metrics for each of the 6 core research
 * workflow steps, plus the weighted overall completion percentage.
 */
export function calculateWorkflowPipeline(inputs: PipelineInputs): WorkflowPipelineResult {
  const {
    projectId,
    questionCount,
    papers,
    unscreened,
    included,
    excluded,
    hasProtocol,
    extracted,
    awaiting,
    dualExtraction = false,
  } = inputs;

  const screened = Math.max(0, papers - unscreened);

  // ── Step 1: Research Questions ──────────────────────────────────────────
  const step1Done = questionCount > 0;
  const step1Percent = step1Done ? 100 : 0;
  const step1Metric = step1Done
    ? `${questionCount} question${questionCount === 1 ? "" : "s"} defined`
    : "No questions added yet";

  // ── Step 2: Find & Import Papers ────────────────────────────────────────
  const step2Done = papers > 0;
  const step2Percent = step2Done ? 100 : 0;
  const step2Metric = step2Done
    ? `${papers} paper${papers === 1 ? "" : "s"} in library`
    : "Library is empty";

  // ── Step 3: Screening ───────────────────────────────────────────────────
  const step3Done = papers > 0 && unscreened === 0;
  const step3Percent =
    papers > 0 ? Math.min(100, Math.round((screened / papers) * 100)) : 0;
  const step3Metric =
    papers === 0
      ? "Awaiting papers"
      : step3Done
        ? `All ${papers} screened · ${included} included, ${excluded} excluded`
        : `${unscreened} left to screen · ${screened}/${papers} (${step3Percent}%)`;

  // ── Step 4: Extraction Protocol ─────────────────────────────────────────
  const step4Done = hasProtocol;
  const step4Percent = step4Done ? 100 : 0;
  const step4Metric = step4Done ? "Protocol active" : "No protocol defined";

  // ── Step 5: Data Extraction ─────────────────────────────────────────────
  const extractionFinished =
    included > 0 && hasProtocol && extracted >= included && (dualExtraction ? awaiting === 0 : true);
  const extractionPercent =
    included > 0
      ? Math.min(100, Math.round((Math.min(extracted, included) / included) * 100))
      : 0;
  const step5Done = extractionFinished;
  const step5Percent = step5Done ? 100 : extractionPercent;
  const step5Metric =
    included === 0
      ? papers > 0 && unscreened === 0
        ? "0 papers included"
        : "Awaiting screening"
      : step5Done
        ? `All ${included} extracted${dualExtraction ? " & reconciled" : ""}`
        : `${extracted} of ${included} extracted (${step5Percent}%)${
            awaiting > 0 ? ` · ${awaiting} awaiting reconciliation` : ""
          }`;

  // ── Step 6: Evidence & Synthesis ────────────────────────────────────────
  const step6Done = included > 0 && step5Done;
  const step6Percent = step6Done ? 100 : 0;
  const step6Metric =
    included === 0
      ? papers > 0 && unscreened === 0
        ? "No included papers"
        : "Awaiting extractions"
      : step6Done
        ? `Evidence ready · ${extracted} papers synthesized`
        : "Awaiting extraction completion";

  // ── Determine Current Active Step & Next Action ──────────────────────────
  let nextAction: NextAction;

  if (!step1Done) {
    nextAction = {
      stepId: "questions",
      href: `/projects/${projectId}/questions`,
      label: "Add your research questions",
      why: "Search is ranked against your research questions, and there are none yet.",
    };
  } else if (!step2Done) {
    nextAction = {
      stepId: "search",
      href: `/projects/${projectId}/search`,
      label: "Find your first papers",
      why: "The library is empty. Search five sources or import references.",
    };
  } else if (!step3Done) {
    nextAction = {
      stepId: "screen",
      href: `/projects/${projectId}/screen`,
      label: "Continue screening",
      why: `${unscreened} ${unscreened === 1 ? "paper is" : "papers are"} still unscreened.`,
    };
  } else if (included === 0) {
    nextAction = {
      stepId: "search",
      href: `/projects/${projectId}/search`,
      label: "Find more papers",
      why: `All ${papers} papers were excluded during screening. Add more papers to continue.`,
    };
  } else if (!step4Done) {
    nextAction = {
      stepId: "protocol",
      href: `/projects/${projectId}/protocol`,
      label: "Build the protocol",
      why: "Nothing can be extracted until there are questions to ask.",
    };
  } else if (dualExtraction && awaiting > 0) {
    nextAction = {
      stepId: "extract",
      href: `/projects/${projectId}/reconcile`,
      label: "Reconcile disagreements",
      why: `${awaiting} ${awaiting === 1 ? "paper has" : "papers have"} dual extractions that disagree.`,
    };
  } else if (extracted < included) {
    nextAction = {
      stepId: "extract",
      href: `/projects/${projectId}/extract`,
      label: "Extract from included papers",
      why: `${included - extracted} of ${included} included ${
        included - extracted === 1 ? "paper has" : "papers have"
      } no extraction yet.`,
    };
  } else {
    nextAction = {
      stepId: "evidence",
      href: `/projects/${projectId}/evidence`,
      label: "Review the evidence matrix",
      why: "All included papers have been extracted. Evidence is ready for synthesis and export.",
    };
  }

  // ── Step Statuses ───────────────────────────────────────────────────────
  const getStatus = (
    isDone: boolean,
    stepId: WorkflowStepId,
  ): WorkflowStepStatus => {
    if (isDone) return "completed";
    if (nextAction.stepId === stepId) return "current";
    return "upcoming";
  };

  const steps: WorkflowStep[] = [
    {
      id: "questions",
      stepNumber: 1,
      label: "Research Questions",
      shortLabel: "Questions",
      description: "Define core questions and keywords to rank search results.",
      href: `/projects/${projectId}/questions`,
      status: getStatus(step1Done, "questions"),
      percent: step1Percent,
      metric: step1Metric,
      isActionable: true,
    },
    {
      id: "search",
      stepNumber: 2,
      label: "Find & Import",
      shortLabel: "Search",
      description: "Search 5 bibliographic sources or import BibTeX/RIS files.",
      href: `/projects/${projectId}/search`,
      status: getStatus(step2Done, "search"),
      percent: step2Percent,
      metric: step2Metric,
      isActionable: true,
    },
    {
      id: "screen",
      stepNumber: 3,
      label: "Screen Papers",
      shortLabel: "Screening",
      description: "Decide which papers meet inclusion criteria, one by one.",
      href: `/projects/${projectId}/screen`,
      status: getStatus(step3Done, "screen"),
      percent: step3Percent,
      metric: step3Metric,
      isActionable: papers > 0,
    },
    {
      id: "protocol",
      stepNumber: 4,
      label: "Define Protocol",
      shortLabel: "Protocol",
      description: "Set up the standardized questions to extract from each paper.",
      href: `/projects/${projectId}/protocol`,
      status: getStatus(step4Done, "protocol"),
      percent: step4Percent,
      metric: step4Metric,
      isActionable: true,
    },
    {
      id: "extract",
      stepNumber: 5,
      label: "Extract Data",
      shortLabel: "Extraction",
      description: "Extract answers and quoted anchors from included papers.",
      href: dualExtraction && awaiting > 0 ? `/projects/${projectId}/reconcile` : `/projects/${projectId}/extract`,
      status: getStatus(step5Done, "extract"),
      percent: step5Percent,
      metric: step5Metric,
      isActionable: hasProtocol && included > 0,
    },
    {
      id: "evidence",
      stepNumber: 6,
      label: "Synthesise Evidence",
      shortLabel: "Evidence",
      description: "Review synthesized matrix, compare findings, and export.",
      href: `/projects/${projectId}/evidence`,
      status: getStatus(step6Done, "evidence"),
      percent: step6Percent,
      metric: step6Metric,
      isActionable: true,
    },
  ];

  const completedStepsCount = steps.filter((s) => s.status === "completed").length;

  // Weight each step equally (1/6 each = ~16.67%), computing fractional percentage
  const totalScore =
    (step1Percent +
      step2Percent +
      step3Percent +
      step4Percent +
      step5Percent +
      step6Percent) /
    6;

  const overallPercent = Math.min(100, Math.max(0, Math.round(totalScore)));

  return {
    steps,
    overallPercent,
    completedStepsCount,
    totalStepsCount: steps.length,
    nextAction,
  };
}
