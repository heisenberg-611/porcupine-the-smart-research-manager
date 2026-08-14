import { exclusionReasonLabel } from "@porcupine/shared";

export interface PrismaCounts {
  recordsIdentified: number;
  recordsRemovedBeforeScreening: number;
  recordsScreened: number;
  recordsExcluded: number;
  studiesIncluded: number;
  recordsPending: number;
}

export interface ExclusionRow {
  reason: string;
  count: number;
}

/**
 * The PRISMA 2020 flow diagram.
 *
 * Rendered as inline SVG on the server rather than with a charting library:
 * the output has to be downloadable and droppable into a manuscript, and a
 * canvas-based chart is a screenshot, not a figure. SVG scales to whatever
 * DPI a journal asks for.
 *
 * Every number here is counted from recorded rows. Nothing is estimated,
 * nothing is inferred, and where we do not track something the box says so
 * rather than showing a plausible figure — this ends up in a published paper,
 * and a reviewer who checks an invented number finds the authors cannot
 * reproduce their own count.
 *
 * Deliberately NOT drawn: "Reports sought for retrieval" and "Reports not
 * retrieved". PRISMA asks for them, and they describe full-text retrieval,
 * which needs the file pipeline that does not exist yet. Drawing those boxes
 * with zeros would assert that no report failed retrieval — a claim we cannot
 * support. They are named as untracked underneath instead.
 */
export function PrismaDiagram({
  counts,
  exclusions,
  projectTitle,
}: {
  counts: PrismaCounts;
  exclusions: ExclusionRow[];
  projectTitle: string;
}) {
  const boxW = 260;
  const gapX = 80;
  const leftX = 20;
  const rightX = leftX + boxW + gapX;

  const rows = [
    { y: 20, h: 64 },
    { y: 124, h: 64 },
    { y: 228, h: 64 },
  ];

  const exclusionLines = exclusions
    .slice(0, 8)
    .map((e) => `${exclusionReasonLabel(e.reason)} (n = ${e.count})`);
  const extraReasons = exclusions.length - exclusionLines.length;
  if (extraReasons > 0) exclusionLines.push(`+${extraReasons} more reasons`);

  const exclusionBoxHeight = Math.max(64, 26 + exclusionLines.length * 15);
  const height = rows[2]!.y + Math.max(rows[2]!.h, exclusionBoxHeight) + 30;
  const width = rightX + boxW + 20;

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
        {counts.recordsIdentified} records identified,{" "}
        {counts.recordsRemovedBeforeScreening} removed before screening,{" "}
        {counts.recordsScreened} screened, {counts.recordsExcluded} excluded,{" "}
        {counts.studiesIncluded} studies included.
      </desc>

      {/* Explicit white/dark-agnostic fills would fight the theme, so shapes
          use currentColor at low opacity and text inherits. */}
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
        <Box
          x={leftX}
          y={rows[0]!.y}
          w={boxW}
          h={rows[0]!.h}
          heading="Records identified"
          lines={[`n = ${counts.recordsIdentified}`, "from databases and imports"]}
        />
        <Box
          x={rightX}
          y={rows[0]!.y}
          w={boxW}
          h={rows[0]!.h}
          heading="Removed before screening"
          lines={[`Duplicates removed: n = ${counts.recordsRemovedBeforeScreening}`]}
        />
        <Arrow
          x1={leftX + boxW}
          y1={rows[0]!.y + rows[0]!.h / 2}
          x2={rightX}
          y2={rows[0]!.y + rows[0]!.h / 2}
        />

        <Box
          x={leftX}
          y={rows[1]!.y}
          w={boxW}
          h={rows[1]!.h}
          heading="Records screened"
          lines={[
            `n = ${counts.recordsScreened}`,
            counts.recordsPending > 0
              ? `${counts.recordsPending} still to screen`
              : "screening complete",
          ]}
        />
        <Box
          x={rightX}
          y={rows[1]!.y}
          w={boxW}
          h={exclusionBoxHeight}
          heading={`Records excluded (n = ${counts.recordsExcluded})`}
          lines={exclusionLines.length > 0 ? exclusionLines : ["none yet"]}
        />
        <Arrow
          x1={leftX + boxW}
          y1={rows[1]!.y + rows[1]!.h / 2}
          x2={rightX}
          y2={rows[1]!.y + rows[1]!.h / 2}
        />
        <Arrow
          x1={leftX + boxW / 2}
          y1={rows[0]!.y + rows[0]!.h}
          x2={leftX + boxW / 2}
          y2={rows[1]!.y}
        />

        <Box
          x={leftX}
          y={rows[2]!.y}
          w={boxW}
          h={rows[2]!.h}
          heading="Studies included"
          lines={[`n = ${counts.studiesIncluded}`]}
          emphasis
        />
        <Arrow
          x1={leftX + boxW / 2}
          y1={rows[1]!.y + rows[1]!.h}
          x2={leftX + boxW / 2}
          y2={rows[2]!.y}
        />
      </g>
    </svg>
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
        rx={6}
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
