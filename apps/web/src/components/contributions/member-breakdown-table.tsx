"use client";

import { useState } from "react";
import type { MemberContributionStats } from "@/lib/contributions";

export function MemberBreakdownTable({
  members,
}: {
  members: MemberContributionStats[];
}) {
  const [sortKey, setSortKey] = useState<keyof MemberContributionStats>("contributionScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: keyof MemberContributionStats) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedMembers = [...members].sort((a, b) => {
    const valA = a[sortKey];
    const valB = b[sortKey];

    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    if (typeof valA === "number" && typeof valB === "number") {
      return sortDir === "asc" ? valA - valB : valB - valA;
    }

    return sortDir === "asc"
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA));
  });

  return (
    <div className="border-border/70 bg-raised/70 overflow-hidden rounded-2xl border shadow-xs">
      <div className="border-border/50 border-b px-6 py-4">
        <h3 className="text-ink text-heading font-semibold">
          Member Contribution Breakdown
        </h3>
        <p className="text-muted text-fine mt-1">
          Detailed metrics across screening decisions, data extractions, imports, questions, and annotations.
        </p>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="min-w-[920px] w-full text-left text-xs">
          <thead className="bg-surface/80 text-muted border-border/50 border-b font-mono font-medium tracking-wider uppercase">
            <tr>
              <th
                scope="col"
                className="cursor-pointer px-4 py-3 hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("name")}
              >
                Member {sortKey === "name" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-4 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("contributionScore")}
              >
                Score {sortKey === "contributionScore" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th scope="col" className="px-4 py-3 text-center whitespace-nowrap">
                Workload Share
              </th>
              <th
                scope="col"
                className="cursor-pointer px-3 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("screenedTotal")}
              >
                Screened {sortKey === "screenedTotal" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-3 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("extractedPapers")}
              >
                Extracted {sortKey === "extractedPapers" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-3 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("extractedFields")}
              >
                Fields {sortKey === "extractedFields" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-3 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("papersImported")}
              >
                Imported {sortKey === "papersImported" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-3 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("questionsCreated")}
              >
                Questions {sortKey === "questionsCreated" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-3 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("annotationsCount")}
              >
                Annotations {sortKey === "annotationsCount" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                scope="col"
                className="cursor-pointer px-4 py-3 text-right hover:text-ink whitespace-nowrap"
                onClick={() => handleSort("lastActiveAt")}
              >
                Last Active {sortKey === "lastActiveAt" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border/40 divide-y">
            {sortedMembers.map((member) => {
              const initials = member.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "U";

              const relativeLastActive = member.lastActiveAt
                ? formatRelativeTime(new Date(member.lastActiveAt))
                : "Never";

              return (
                <tr
                  key={member.userId}
                  className="hover:bg-surface/50 transition-colors"
                >
                  {/* Member Name & Email */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="bg-accent/15 text-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-ink truncate font-semibold">
                          {member.name}
                        </div>
                        <div className="text-muted truncate text-[11px]">
                          {member.email}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Contribution Score */}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 border border-accent/25 px-2.5 py-0.5 font-mono text-xs font-bold text-ink dark:text-white tabular-nums">
                      <span>{member.contributionScore}</span>
                      <span className="text-[10px] font-semibold text-accent uppercase">pts</span>
                    </span>
                  </td>

                  {/* Percentage Share Bar */}
                  <td className="w-32 px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="bg-surface border-border/40 h-2 flex-1 overflow-hidden rounded-full border min-w-[50px]">
                        <div
                          className="bg-accent h-full rounded-full transition-all duration-500"
                          style={{ width: `${member.percentageShare}%` }}
                        />
                      </div>
                      <span className="text-muted w-8 text-right font-mono text-[11px] font-semibold tabular-nums">
                        {member.percentageShare}%
                      </span>
                    </div>
                  </td>

                  {/* Screened Papers */}
                  <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                    <span className="text-ink font-semibold text-xs">{member.screenedTotal}</span>
                    {member.screenedTotal > 0 && (
                      <span className="text-muted block text-[10px]">
                        {member.screenedIncluded} in · {member.screenedExcluded} out
                      </span>
                    )}
                  </td>

                  {/* Extracted Papers */}
                  <td className="text-ink px-3 py-3 text-right font-mono font-semibold text-xs tabular-nums whitespace-nowrap">
                    {member.extractedPapers}
                  </td>

                  {/* Fields Answered */}
                  <td className="text-ink px-3 py-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                    {member.extractedFields}
                  </td>

                  {/* Imported Papers */}
                  <td className="text-ink px-3 py-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                    {member.papersImported}
                  </td>

                  {/* Questions */}
                  <td className="text-ink px-3 py-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                    {member.questionsCreated}
                  </td>

                  {/* Annotations */}
                  <td className="text-ink px-3 py-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                    {member.annotationsCount}
                  </td>

                  {/* Last Active */}
                  <td className="text-muted px-4 py-3 text-right text-[11px] whitespace-nowrap">
                    {relativeLastActive}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toISOString().slice(0, 10);
}
