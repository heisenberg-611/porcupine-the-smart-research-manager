import { describe, expect, it } from "vitest";

interface ProgressRow {
  screen_status: string;
  count: number;
}

interface ExtractionRow {
  id: string;
  status: string;
  project_work_id: string;
  submitted_at: string | null;
}

export function computePipelineCounts(
  progressRows: ProgressRow[],
  extractions: ExtractionRow[],
) {
  const countOf = (status: string) =>
    progressRows.find((r) => r.screen_status === status)?.count ?? 0;

  const completedExtractionWorks = new Set(
    extractions.filter((e) => e.status !== "DRAFT").map((e) => e.project_work_id),
  );
  const draftExtractionWorks = new Set(
    extractions
      .filter((e) => e.status === "DRAFT" && !completedExtractionWorks.has(e.project_work_id))
      .map((e) => e.project_work_id),
  );

  const rawExtracted = countOf("EXTRACTED");
  const rawReading = countOf("READING");
  const rawIncluded = countOf("INCLUDED");
  const rawSynthesized = countOf("SYNTHESIZED");
  const rawExcluded = countOf("EXCLUDED");
  const rawIdentified = countOf("IDENTIFIED");
  const rawScreening = countOf("SCREENING");

  const extractedCount = Math.max(rawExtracted, completedExtractionWorks.size);
  const readingCount = Math.max(rawReading, draftExtractionWorks.size);

  const deltaExtracted = extractedCount - rawExtracted;
  const deltaReading = readingCount - rawReading;
  const includedCount = Math.max(0, rawIncluded - deltaExtracted - deltaReading);

  return {
    IDENTIFIED: rawIdentified,
    SCREENING: rawScreening,
    INCLUDED: includedCount,
    EXCLUDED: rawExcluded,
    READING: readingCount,
    EXTRACTED: extractedCount,
    SYNTHESIZED: rawSynthesized,
    total:
      rawIdentified +
      rawScreening +
      includedCount +
      rawExcluded +
      readingCount +
      extractedCount +
      rawSynthesized,
  };
}

export function computeNextAction({
  questionCount,
  papers,
  unscreened,
  hasProtocol,
  awaiting,
  included,
  extracted,
}: {
  questionCount: number;
  papers: number;
  unscreened: number;
  hasProtocol: boolean;
  awaiting: number;
  included: number;
  extracted: number;
}) {
  if (questionCount === 0) return "questions";
  if (papers === 0) return "search";
  if (unscreened > 0) return "screen";
  if (!hasProtocol) return "protocol";
  if (awaiting > 0) return "reconcile";
  if (extracted < included) return "extract";
  return "evidence";
}

describe("Progress Pipeline & Extraction Count Computations", () => {
  it("computes all 7 statuses correctly when papers have extractions", () => {
    const progressRows: ProgressRow[] = [
      { screen_status: "IDENTIFIED", count: 10 },
      { screen_status: "SCREENING", count: 2 },
      { screen_status: "INCLUDED", count: 8 },
      { screen_status: "EXCLUDED", count: 20 },
    ];

    const extractions: ExtractionRow[] = [
      { id: "e1", status: "SUBMITTED", project_work_id: "w1", submitted_at: new Date().toISOString() },
      { id: "e2", status: "SUBMITTED", project_work_id: "w2", submitted_at: new Date().toISOString() },
      { id: "e3", status: "DRAFT", project_work_id: "w3", submitted_at: null },
    ];

    const result = computePipelineCounts(progressRows, extractions);

    expect(result.IDENTIFIED).toBe(10);
    expect(result.SCREENING).toBe(2);
    expect(result.EXCLUDED).toBe(20);
    expect(result.EXTRACTED).toBe(2);
    expect(result.READING).toBe(1);
    expect(result.INCLUDED).toBe(5); // 8 - 2 extracted - 1 reading
    expect(result.total).toBe(40);
  });

  it("handles dual extraction without double counting extracted papers", () => {
    const progressRows: ProgressRow[] = [
      { screen_status: "INCLUDED", count: 5 },
    ];

    // Same paper extracted by two different extractors
    const extractions: ExtractionRow[] = [
      { id: "e1", status: "SUBMITTED", project_work_id: "w1", submitted_at: new Date().toISOString() },
      { id: "e2", status: "SUBMITTED", project_work_id: "w1", submitted_at: new Date().toISOString() },
      { id: "e3", status: "SUBMITTED", project_work_id: "w2", submitted_at: new Date().toISOString() },
    ];

    const result = computePipelineCounts(progressRows, extractions);

    expect(result.EXTRACTED).toBe(2); // w1 and w2
    expect(result.INCLUDED).toBe(3); // 5 - 2
  });

  it("accurately advances next action when all papers are extracted", () => {
    // Stage 1: Questions missing
    expect(
      computeNextAction({
        questionCount: 0,
        papers: 10,
        unscreened: 0,
        hasProtocol: true,
        awaiting: 0,
        included: 5,
        extracted: 0,
      }),
    ).toBe("questions");

    // Stage 2: Library empty
    expect(
      computeNextAction({
        questionCount: 1,
        papers: 0,
        unscreened: 0,
        hasProtocol: true,
        awaiting: 0,
        included: 0,
        extracted: 0,
      }),
    ).toBe("search");

    // Stage 3: Screening in progress
    expect(
      computeNextAction({
        questionCount: 1,
        papers: 10,
        unscreened: 4,
        hasProtocol: true,
        awaiting: 0,
        included: 6,
        extracted: 0,
      }),
    ).toBe("screen");

    // Stage 4: Protocol missing
    expect(
      computeNextAction({
        questionCount: 1,
        papers: 10,
        unscreened: 0,
        hasProtocol: false,
        awaiting: 0,
        included: 6,
        extracted: 0,
      }),
    ).toBe("protocol");

    // Stage 5: Extraction in progress (extracted < included)
    expect(
      computeNextAction({
        questionCount: 1,
        papers: 10,
        unscreened: 0,
        hasProtocol: true,
        awaiting: 0,
        included: 6,
        extracted: 2,
      }),
    ).toBe("extract");

    // Stage 6: All included papers extracted (extracted >= included) -> Review Evidence!
    expect(
      computeNextAction({
        questionCount: 1,
        papers: 10,
        unscreened: 0,
        hasProtocol: true,
        awaiting: 0,
        included: 6,
        extracted: 6,
      }),
    ).toBe("evidence");
  });
});
