"use client";

import { useState } from "react";
import type { ProjectContributionsData } from "@/lib/contributions";
import { ActivityAuditFeed } from "./activity-audit-feed";
import { ContributionHeatmap } from "./contribution-heatmap";
import { MemberBreakdownTable } from "./member-breakdown-table";

export function ContributionsClient({
  data,
}: {
  data: ProjectContributionsData;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "breakdown" | "audit" | "heatmap">("overview");

  const topContributors = data.members.slice(0, 3);
  const memberList = data.members.map((m) => ({ userId: m.userId, name: m.name }));

  const handleNavigateToAudit = (_searchDate?: string) => {
    setActiveTab("audit");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Tab Navigation */}
      <div className="border-border/60 flex flex-wrap items-center gap-2 border-b pb-3">
        <TabButton
          active={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
          label="Overview & Leaderboard"
          badge={`${data.activeContributorsCount} active`}
        />
        <TabButton
          active={activeTab === "breakdown"}
          onClick={() => setActiveTab("breakdown")}
          label="Member Matrix"
          badge={`${data.members.length} members`}
        />
        <TabButton
          active={activeTab === "audit"}
          onClick={() => setActiveTab("audit")}
          label="Granular Audit Log"
          badge={`${data.events.length} actions`}
        />
        <TabButton
          active={activeTab === "heatmap"}
          onClick={() => setActiveTab("heatmap")}
          label="Activity Heatmap"
          badge={`🔥 ${data.heatmap.currentStreak}d streak`}
        />
      </div>

      {/* Tab Content: Overview */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-8">
          {/* Key Metric Highlights */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Total Micro-Actions"
              value={data.totalProjectActions}
              hint="across research & session events"
            />
            <StatCard
              label="Active Contributors"
              value={data.activeContributorsCount}
              hint={`of ${data.members.length} project members`}
            />
            <StatCard
              label="Current Streak"
              value={`${data.heatmap.currentStreak} days`}
              hint="consecutive active days"
            />
            <StatCard
              label="Audit Log Entries"
              value={data.events.length}
              hint="recorded micro-events"
            />
          </div>

          {/* Top Contributors Spotlight */}
          {topContributors.length > 0 && (
            <div className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs">
              <h3 className="text-ink text-heading font-semibold">
                Contribution Leaderboard
              </h3>
              <p className="text-muted text-fine mt-0.5">
                Top contributors based on verified screening decisions, data extractions, and library imports.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {topContributors.map((member, index) => {
                  const rankMedal = index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉";
                  return (
                    <div
                      key={member.userId}
                      className="bg-surface/80 border-border/60 flex flex-col justify-between rounded-xl border p-4 shadow-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{rankMedal}</span>
                          <span className="text-ink truncate font-semibold">
                            {member.name}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/25 px-2.5 py-0.5 font-mono text-xs font-bold text-accent tabular-nums">
                          <span>{member.contributionScore}</span>
                          <span className="text-[10px] uppercase font-semibold">pts</span>
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-muted font-mono text-[11px]">
                          {member.screenedTotal} screened · {member.extractedPapers} extracted
                        </span>
                        <span className="text-ink font-bold tabular-nums">
                          {member.percentageShare}%
                        </span>
                      </div>

                      <div className="bg-surface border-border/40 mt-2 h-1.5 w-full overflow-hidden rounded-full border">
                        <div
                          className="bg-accent h-full rounded-full"
                          style={{ width: `${member.percentageShare}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Interactive Heatmap */}
          <ContributionHeatmap
            events={data.events}
            members={memberList}
            initialHeatmap={data.heatmap}
            onNavigateToAudit={handleNavigateToAudit}
          />

          {/* Quick Member Breakdown Preview */}
          <MemberBreakdownTable members={data.members} />
        </div>
      )}

      {/* Tab Content: Detailed Breakdown Matrix */}
      {activeTab === "breakdown" && (
        <MemberBreakdownTable members={data.members} />
      )}

      {/* Tab Content: Granular Audit Feed */}
      {activeTab === "audit" && (
        <ActivityAuditFeed events={data.events} members={memberList} />
      )}

      {/* Tab Content: Heatmap & Streaks */}
      {activeTab === "heatmap" && (
        <ContributionHeatmap
          events={data.events}
          members={memberList}
          initialHeatmap={data.heatmap}
          onNavigateToAudit={handleNavigateToAudit}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-visible:ring-accent inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:outline-none ${
        active
          ? "bg-accent text-white shadow-xs"
          : "bg-surface text-muted hover:text-ink hover:bg-surface/80"
      }`}
    >
      <span>{label}</span>
      {badge && (
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
            active ? "bg-white/20 text-white" : "bg-raised text-muted"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="border-border/70 bg-raised/70 rounded-2xl border p-4 shadow-xs">
      <div className="text-muted text-fine font-medium">{label}</div>
      <div className="text-title text-ink mt-1 font-bold tabular-nums">
        {value}
      </div>
      {hint && <div className="text-muted mt-1 text-[11px]">{hint}</div>}
    </div>
  );
}
