import { describe, expect, it } from "vitest";
import { calculateWorkflowPipeline } from "./workflow-pipeline";

describe("calculateWorkflowPipeline", () => {
  const projectId = "proj-123";

  it("calculates 0% progress on a brand new empty project", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 0,
      papers: 0,
      unscreened: 0,
      included: 0,
      excluded: 0,
      hasProtocol: false,
      extracted: 0,
      awaiting: 0,
    });

    expect(result.overallPercent).toBe(0);
    expect(result.completedStepsCount).toBe(0);
    expect(result.totalStepsCount).toBe(6);
    expect(result.nextAction.stepId).toBe("questions");
    expect(result.steps[0]?.status).toBe("current");
    expect(result.steps[1]?.status).toBe("upcoming");
  });

  it("advances to Step 2 (Search) after questions are added", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 2,
      papers: 0,
      unscreened: 0,
      included: 0,
      excluded: 0,
      hasProtocol: false,
      extracted: 0,
      awaiting: 0,
    });

    expect(result.completedStepsCount).toBe(1);
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[0]?.percent).toBe(100);
    expect(result.steps[1]?.status).toBe("current");
    expect(result.nextAction.stepId).toBe("search");
    // 100 / 6 = 16.67% -> 17%
    expect(result.overallPercent).toBe(17);
  });

  it("calculates fractional progress during screening (Step 3)", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 1,
      papers: 20,
      unscreened: 10,
      included: 7,
      excluded: 3,
      hasProtocol: false,
      extracted: 0,
      awaiting: 0,
    });

    // 10 screened out of 20 = 50% for step 3
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[1]?.status).toBe("completed");
    expect(result.steps[2]?.status).toBe("current");
    expect(result.steps[2]?.percent).toBe(50);
    expect(result.nextAction.stepId).toBe("screen");
    // (100 + 100 + 50 + 0 + 0 + 0) / 6 = 250 / 6 = 41.67% -> 42%
    expect(result.overallPercent).toBe(42);
  });

  it("requires protocol definition (Step 4) after screening is complete", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 1,
      papers: 20,
      unscreened: 0,
      included: 8,
      excluded: 12,
      hasProtocol: false,
      extracted: 0,
      awaiting: 0,
    });

    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[1]?.status).toBe("completed");
    expect(result.steps[2]?.status).toBe("completed");
    expect(result.steps[3]?.status).toBe("current");
    expect(result.nextAction.stepId).toBe("protocol");
    // (100 + 100 + 100 + 0 + 0 + 0) / 6 = 300 / 6 = 50%
    expect(result.overallPercent).toBe(50);
  });

  it("calculates fractional progress during extraction (Step 5)", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 1,
      papers: 20,
      unscreened: 0,
      included: 8,
      excluded: 12,
      hasProtocol: true,
      extracted: 4,
      awaiting: 0,
    });

    // 4 of 8 extracted = 50% for step 5
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[1]?.status).toBe("completed");
    expect(result.steps[2]?.status).toBe("completed");
    expect(result.steps[3]?.status).toBe("completed");
    expect(result.steps[4]?.status).toBe("current");
    expect(result.steps[4]?.percent).toBe(50);
    expect(result.nextAction.stepId).toBe("extract");
    // (100 + 100 + 100 + 100 + 50 + 0) / 6 = 450 / 6 = 75%
    expect(result.overallPercent).toBe(75);
  });

  it("handles dual extraction requiring reconciliation before Step 5 is complete", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 1,
      papers: 20,
      unscreened: 0,
      included: 8,
      excluded: 12,
      hasProtocol: true,
      extracted: 8,
      awaiting: 2,
      dualExtraction: true,
    });

    expect(result.steps[4]?.status).toBe("current");
    expect(result.nextAction.stepId).toBe("extract");
    expect(result.nextAction.label).toContain("Reconcile");
    expect(result.nextAction.href).toBe(`/projects/${projectId}/reconcile`);
  });

  it("marks 100% complete and points to Evidence (Step 6) when all extractions are finished", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 2,
      papers: 30,
      unscreened: 0,
      included: 10,
      excluded: 20,
      hasProtocol: true,
      extracted: 10,
      awaiting: 0,
    });

    expect(result.completedStepsCount).toBe(6);
    expect(result.overallPercent).toBe(100);
    expect(result.steps.every((s) => s.status === "completed")).toBe(true);
    expect(result.nextAction.stepId).toBe("evidence");
    expect(result.nextAction.label).toContain("Review the evidence");
  });

  it("handles edge case where all screened papers are excluded (0 included)", () => {
    const result = calculateWorkflowPipeline({
      projectId,
      questionCount: 1,
      papers: 10,
      unscreened: 0,
      included: 0,
      excluded: 10,
      hasProtocol: false,
      extracted: 0,
      awaiting: 0,
    });

    expect(result.steps[2]?.status).toBe("completed");
    expect(result.nextAction.stepId).toBe("search");
    expect(result.nextAction.why).toContain("All 10 papers were excluded");
  });
});
