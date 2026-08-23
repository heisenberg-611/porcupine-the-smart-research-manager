import { describe, expect, it } from "vitest";

import { toEvidenceMarkdown, type EvidenceRowData } from "./evidence-markdown";

describe("toEvidenceMarkdown", () => {
  const fields = [
    { key: "sample_size", label: "Sample Size", order: 1 },
    { key: "intervention", label: "Intervention Details", order: 2 },
    { key: "findings", label: "Key Findings", order: 3 },
  ];

  const rows: EvidenceRowData[] = [
    {
      extraction_id: "ext-1",
      project_work_id: "pw-1",
      work_title: "Deep Learning for Structural Health",
      published_year: 2026,
      status: "DONE",
      extractor_id: "usr-1",
      group_label: null,
      answered: 3,
      field_total: 3,
      total_rows: 2,
      cells: {
        sample_size: {
          value: 412,
          text: "412",
          anchorId: null,
          type: "NUMBER",
          label: "Sample Size",
          answered: true,
        },
        intervention: {
          value: "Fiber Bragg Grating sensors",
          text: "Fiber Bragg Grating sensors",
          anchorId: null,
          type: "TEXT",
          label: "Intervention Details",
          answered: true,
        },
        findings: {
          value: "| Metric | Value |\n| :--- | :--- |\n| Accuracy | **99.8%** |",
          text: "| Metric | Value |\n| :--- | :--- |\n| Accuracy | **99.8%** |",
          anchorId: null,
          type: "LONG_TEXT",
          label: "Key Findings",
          answered: true,
        },
      },
    },
    {
      extraction_id: "ext-2",
      project_work_id: "pw-2",
      work_title: "Smart Concrete Sensors Review",
      published_year: 2025,
      status: "DRAFT",
      extractor_id: "usr-1",
      group_label: null,
      answered: 1,
      field_total: 3,
      total_rows: 2,
      cells: {
        sample_size: {
          value: 120,
          text: "120",
          anchorId: null,
          type: "NUMBER",
          label: "Sample Size",
          answered: true,
        },
        intervention: {
          value: null,
          text: null,
          anchorId: null,
          type: "TEXT",
          label: "Intervention Details",
          answered: false,
        },
        findings: {
          value: null,
          text: null,
          anchorId: null,
          type: "LONG_TEXT",
          label: "Key Findings",
          answered: false,
        },
      },
    },
  ];

  it("generates markdown with AI instructions, protocol overview, summary table, and detailed extractions", () => {
    const md = toEvidenceMarkdown({
      protocolName: "Data Extraction Protocol",
      protocolVersion: 1,
      fields,
      rows,
      generatedAt: new Date("2026-08-24T12:00:00Z"),
    });

    expect(md).toContain("# Evidence Synthesis: Data Extraction Protocol (v1)");
    expect(md).toContain("AI INSTRUCTIONS FOR SYSTEMATIC REVIEW");
    expect(md).toContain("## Protocol & Synthesis Overview");
    expect(md).toContain("- **Total Included Papers**: 2");
    expect(md).toContain("## Evidence Matrix Table");
    expect(md).toContain("| Deep Learning for Structural Health |");
    expect(md).toContain("## Detailed Extractions by Paper");
    expect(md).toContain("### 1. Deep Learning for Structural Health (2026)");
    expect(md).toContain("#### Key Findings (`findings`)");
    expect(md).toContain("| Metric | Value |");
    expect(md).toContain("### 2. Smart Concrete Sensors Review (2025)");
    expect(md).toContain("*Not answered*");
  });

  it("handles empty extraction rows gracefully", () => {
    const md = toEvidenceMarkdown({
      protocolName: "Empty Protocol",
      protocolVersion: 2,
      fields,
      rows: [],
      generatedAt: new Date("2026-08-24T12:00:00Z"),
    });

    expect(md).toContain("# Evidence Synthesis: Empty Protocol (v2)");
    expect(md).toContain("*No extractions found for this protocol.*");
  });
});
