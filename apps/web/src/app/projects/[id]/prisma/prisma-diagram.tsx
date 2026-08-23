import { exclusionReasonLabel } from "@Porcupine/shared";

export interface PrismaCounts {
  recordsIdentified: number;
  recordsRemovedBeforeScreening: number;
  recordsScreened: number;
  recordsExcluded: number;
  studiesIncluded: number;
  recordsPending: number;
}

/**
 * The figures nobody can count for us, as last entered by a person.
 *
 * Null throughout means unstated, and renders as an em dash rather than a
 * zero. That distinction is the reason this type exists separately from
 * `PrismaCounts`: every number in the other one is derived from a row that
 * exists, and every number in this one is somebody's word.
 */
export interface PrismaManualCounts {
  registersIdentified: number | null;
  automationIneligible: number | null;
  otherRemovedBefore: number | null;
  reportsSought: number | null;
  reportsNotRetrieved: number | null;
  otherWebsites: number | null;
  otherOrganisations: number | null;
  otherCitationSearching: number | null;
  otherReportsSought: number | null;
  otherReportsNotRetrieved: number | null;
  otherReportsAssessed: number | null;
  otherReportsExcluded: number | null;
  otherStudiesIncluded: number | null;
  reportsOfIncludedStudies: number | null;
}

export interface ExclusionRow {
  reason: string;
  count: number;
}

/** `n = 12`, or `n = —` when nobody has said. */
function n(value: number | null): string {
  return value === null ? "n = —" : `n = ${value}`;
}

/** Whether the right-hand column has anything in it at all. */
export function hasOtherMethods(manual: PrismaManualCounts): boolean {
  return (
    manual.otherWebsites !== null ||
    manual.otherOrganisations !== null ||
    manual.otherCitationSearching !== null ||
    manual.otherReportsSought !== null ||
    manual.otherReportsAssessed !== null ||
    manual.otherStudiesIncluded !== null
  );
}

/**
 * The PRISMA 2020 flow diagram, complete.
 *
 * Rendered as inline SVG on the server rather than with a charting library:
 * the output has to be downloadable and droppable into a manuscript, and a
 * canvas-based chart is a screenshot, not a figure. SVG scales to whatever DPI
 * a journal asks for.
 *
 * ─ Two kinds of number, and the page says which ───────────────────────────
 *
 * The boxes on the left are COUNTED — every one comes from rows in this
 * database, and a reviewer who asks "where does 412 come from" can be shown
 * the papers. The retrieval boxes, the register split and the whole
 * other-methods column are ENTERED, because they describe things that happen
 * outside this application: a librarian's document-supply queue, a hand search
 * of a trial register, an afternoon of chasing reference lists.
 *
 * The previous version of this component drew only the derivable half and said
 * so underneath. That was honest but it was not a PRISMA 2020 diagram, and a
 * journal will not take it. Drawing the missing boxes with zeros would have
 * been worse: "0 reports not retrieved" is a claim, and it would have been one
 * nobody had checked.
 *
 * So the missing boxes are drawn, fed by numbers a named person typed, and any
 * box still unstated shows an em dash. A dash in a submitted figure is a
 * question for the author; a zero is an assertion. Only one of those is
 * recoverable.
 *
 * ─ The right-hand column ──────────────────────────────────────────────────
 *
 * PRISMA 2020 offers the diagram with and without "identified via other
 * methods". It is drawn only when the team has entered something into it —
 * an empty second column on a review that only searched databases is three
 * inches of blank paper implying an omission.
 */
export function PrismaDiagram({
  counts,
  manual,
  exclusions,
  projectTitle,
}: {
  counts: PrismaCounts;
  manual: PrismaManualCounts;
  exclusions: ExclusionRow[];
  projectTitle: string;
}) {
  const showOther = hasOtherMethods(manual);

  const boxW = 236;
  const gapX = 54;
  const leftX = 16;
  const rightX = leftX + boxW + gapX;
  // The other-methods column sits to the right of the excluded boxes, with a
  // wider gutter so the two halves of the figure read as two halves.
  const otherX = rightX + boxW + 72;

  const exclusionLines = exclusions
    .slice(0, 6)
    .map((e) => `${exclusionReasonLabel(e.reason)}: ${e.count}`);
  const extraReasons = exclusions.length - exclusionLines.length;
  if (extraReasons > 0) exclusionLines.push(`+${extraReasons} more reasons`);

  const excludedH = Math.max(72, 30 + exclusionLines.length * 14);

  // Five rows: identification, removed, screening, retrieval, eligibility,
  // included. Laid out top-down with a fixed rhythm so the arrows are straight.
  const y = {
    identified: 16,
    removed: 16,
    screened: 132,
    sought: 248,
    assessed: 364,
    included: 480,
  };
  const h = 88;

  const height = y.included + h + 24;
  const width = (showOther ? otherX + boxW : rightX + boxW) + 16;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-labelledby="prisma-title prisma-desc"
      xmlns="http://www.w3.org/2000/svg"
      className="max-w-full"
    >
      <title id="prisma-title">PRISMA 2020 flow diagram for {projectTitle}</title>
      {/* The full figure in prose. A screen reader cannot follow arrows, and
          the table below the diagram repeats it in a navigable form. */}
      <desc id="prisma-desc">
        {counts.recordsIdentified} records identified from databases and imports,{" "}
        {counts.recordsRemovedBeforeScreening} duplicates removed before screening,{" "}
        {counts.recordsScreened} screened, {counts.recordsExcluded} excluded,{" "}
        {counts.studiesIncluded} studies included.
        {showOther
          ? ` A further ${manual.otherStudiesIncluded ?? 0} studies were included via other methods.`
          : ""}
      </desc>

      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>

      <g className="text-ink" fill="currentColor" stroke="currentColor">
        {showOther && (
          <>
            <Stage
              x={leftX}
              width={rightX + boxW - leftX}
              y={4}
              label="Databases and registers"
            />
            <Stage x={otherX} width={boxW} y={4} label="Other methods" />
          </>
        )}

        {/* ── Identification ───────────────────────────────────────────── */}
        <Box
          x={leftX}
          y={y.identified}
          w={boxW}
          h={h}
          heading="Records identified"
          lines={[
            `Databases and imports: ${counts.recordsIdentified}`,
            `Registers: ${manual.registersIdentified ?? "—"}`,
          ]}
        />
        <Box
          x={rightX}
          y={y.removed}
          w={boxW}
          h={h}
          heading="Records removed before screening"
          lines={[
            `Duplicates: ${counts.recordsRemovedBeforeScreening}`,
            `Marked ineligible by automation: ${manual.automationIneligible ?? "—"}`,
            `Removed for other reasons: ${manual.otherRemovedBefore ?? "—"}`,
          ]}
        />
        <Arrow
          x1={leftX + boxW}
          y1={y.identified + h / 2}
          x2={rightX}
          y2={y.removed + h / 2}
        />

        {/* ── Screening ────────────────────────────────────────────────── */}
        <Box
          x={leftX}
          y={y.screened}
          w={boxW}
          h={h}
          heading="Records screened"
          lines={[
            n(counts.recordsScreened),
            counts.recordsPending > 0
              ? `${counts.recordsPending} still to screen`
              : "screening complete",
          ]}
        />
        <Box
          x={rightX}
          y={y.screened}
          w={boxW}
          h={excludedH}
          heading={`Records excluded (n = ${counts.recordsExcluded})`}
          lines={exclusionLines.length > 0 ? exclusionLines : ["none yet"]}
        />
        <Arrow
          x1={leftX + boxW}
          y1={y.screened + h / 2}
          x2={rightX}
          y2={y.screened + h / 2}
        />
        <Arrow
          x1={leftX + boxW / 2}
          y1={y.identified + h}
          x2={leftX + boxW / 2}
          y2={y.screened}
        />

        {/* ── Retrieval ────────────────────────────────────────────────── */}
        <Box
          x={leftX}
          y={y.sought}
          w={boxW}
          h={h}
          heading="Reports sought for retrieval"
          lines={[n(manual.reportsSought), "entered — no file store yet"]}
        />
        <Box
          x={rightX}
          y={y.sought}
          w={boxW}
          h={h}
          heading="Reports not retrieved"
          lines={[n(manual.reportsNotRetrieved)]}
        />
        <Arrow
          x1={leftX + boxW}
          y1={y.sought + h / 2}
          x2={rightX}
          y2={y.sought + h / 2}
        />
        <Arrow
          x1={leftX + boxW / 2}
          y1={y.screened + h}
          x2={leftX + boxW / 2}
          y2={y.sought}
        />

        {/* ── Eligibility ──────────────────────────────────────────────── */}
        <Box
          x={leftX}
          y={y.assessed}
          w={boxW}
          h={h}
          heading="Reports assessed for eligibility"
          lines={[
            n(
              manual.reportsSought === null || manual.reportsNotRetrieved === null
                ? null
                : manual.reportsSought - manual.reportsNotRetrieved,
            ),
            "sought minus not retrieved",
          ]}
        />
        <Box
          x={rightX}
          y={y.assessed}
          w={boxW}
          h={h}
          heading="Reports excluded"
          lines={["with reasons, as listed above"]}
        />
        <Arrow
          x1={leftX + boxW}
          y1={y.assessed + h / 2}
          x2={rightX}
          y2={y.assessed + h / 2}
        />
        <Arrow
          x1={leftX + boxW / 2}
          y1={y.sought + h}
          x2={leftX + boxW / 2}
          y2={y.assessed}
        />

        {/* ── Included ─────────────────────────────────────────────────── */}
        <Box
          x={leftX}
          y={y.included}
          w={boxW}
          h={h}
          heading="Studies included in review"
          lines={[
            `n = ${counts.studiesIncluded}${
              showOther && manual.otherStudiesIncluded !== null
                ? ` + ${manual.otherStudiesIncluded} via other methods`
                : ""
            }`,
            `Reports of included studies: ${manual.reportsOfIncludedStudies ?? "—"}`,
          ]}
          emphasis
        />
        <Arrow
          x1={leftX + boxW / 2}
          y1={y.assessed + h}
          x2={leftX + boxW / 2}
          y2={y.included}
        />

        {/* ── Other methods, only when there is something in it ─────────── */}
        {showOther && (
          <>
            <Box
              x={otherX}
              y={y.identified}
              w={boxW}
              h={h}
              heading="Records identified from"
              lines={[
                `Websites: ${manual.otherWebsites ?? "—"}`,
                `Organisations: ${manual.otherOrganisations ?? "—"}`,
                `Citation searching: ${manual.otherCitationSearching ?? "—"}`,
              ]}
            />
            <Box
              x={otherX}
              y={y.sought}
              w={boxW}
              h={h}
              heading="Reports sought for retrieval"
              lines={[
                n(manual.otherReportsSought),
                `Not retrieved: ${manual.otherReportsNotRetrieved ?? "—"}`,
              ]}
            />
            <Box
              x={otherX}
              y={y.assessed}
              w={boxW}
              h={h}
              heading="Reports assessed for eligibility"
              lines={[
                n(manual.otherReportsAssessed),
                `Excluded: ${manual.otherReportsExcluded ?? "—"}`,
              ]}
            />
            <Arrow
              x1={otherX + boxW / 2}
              y1={y.identified + h}
              x2={otherX + boxW / 2}
              y2={y.sought}
            />
            <Arrow
              x1={otherX + boxW / 2}
              y1={y.sought + h}
              x2={otherX + boxW / 2}
              y2={y.assessed}
            />
            {/* Into the included box, which both columns feed. */}
            <Arrow
              x1={otherX}
              y1={y.assessed + h / 2}
              x2={leftX + boxW + 8}
              y2={y.included + h / 2}
            />
          </>
        )}
      </g>
    </svg>
  );
}

/** The stage label above a column, when there are two columns to tell apart. */
function Stage({
  x,
  width,
  y,
  label,
}: {
  x: number;
  width: number;
  y: number;
  label: string;
}) {
  return (
    <text
      x={x + width / 2}
      y={y}
      fontSize={11}
      fontWeight={600}
      fillOpacity={0.55}
      textAnchor="middle"
      stroke="none"
    >
      {label}
    </text>
  );
}

function Box({
  x,
  y,
  w,
  h,
  heading,
  lines,
  emphasis = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  heading: string;
  lines: string[];
  emphasis?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill="currentColor"
        fillOpacity={emphasis ? 0.12 : 0.04}
        strokeWidth={1}
        strokeOpacity={0.35}
      />
      <text x={x + 12} y={y + 20} fontSize={12} fontWeight={600} stroke="none">
        {heading}
      </text>
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + 12}
          y={y + 38 + i * 15}
          fontSize={11}
          fillOpacity={0.75}
          stroke="none"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeWidth={1.5}
      strokeOpacity={0.5}
      markerEnd="url(#arrow)"
    />
  );
}
