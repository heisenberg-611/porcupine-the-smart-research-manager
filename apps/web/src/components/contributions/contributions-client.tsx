"use client";

import { useState } from "react";
import {
  CONTRIBUTION_POINT_SYSTEM,
  type ProjectContributionsData,
} from "@/lib/contributions";
import { ActivityAuditFeed } from "./activity-audit-feed";
import { ContributionHeatmap } from "./contribution-heatmap";
import { MemberBreakdownTable } from "./member-breakdown-table";

export function ContributionsClient({ data }: { data: ProjectContributionsData }) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "breakdown" | "audit" | "heatmap"
  >("overview");
  const [showGuide, setShowGuide] = useState<boolean>(false);

  const topContributors = data.members.slice(0, 3);
  const memberList = data.members.map((m) => ({ userId: m.userId, name: m.name }));

  const handleNavigateToAudit = (_searchDate?: string) => {
    setActiveTab("audit");
  };

  const streakBadge =
    data.heatmap.streakStatus === "IN_COOLDOWN"
      ? `⏳ ${data.heatmap.currentStreak}d (in cooldown)`
      : data.heatmap.streakStatus === "ACTIVE_TODAY"
        ? `🔥 ${data.heatmap.currentStreak}d streak`
        : `${data.heatmap.currentStreak}d streak`;

  const streakCardHint =
    data.heatmap.streakStatus === "IN_COOLDOWN"
      ? `⏳ In cooldown: ${data.heatmap.cooldownHoursRemaining}h left today to extend streak`
      : data.heatmap.streakStatus === "ACTIVE_TODAY"
        ? "🔥 Active today · streak extended!"
        : "Complete an action today to start a streak";

  return (
    <div className="flex flex-col gap-6">
      {/* Tab Navigation & Guide Trigger */}
      <div className="border-border/60 flex flex-col justify-between gap-3 border-b pb-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
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
            badge={streakBadge}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
            showGuide
              ? "bg-accent border-accent text-white shadow-xs"
              : "border-border/70 bg-surface text-ink hover:bg-raised hover:border-border"
          }`}
        >
          <span>📖</span>
          <span>{showGuide ? "Hide Scoring Guide" : "How Points & Streaks Work"}</span>
        </button>
      </div>

      {/* Expandable Contribution Points & Streak Cooldown Guide */}
      <ContributionPointGuide isOpen={showGuide} onClose={() => setShowGuide(false)} />

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
              value={`${data.heatmap.currentStreak} ${data.heatmap.currentStreak === 1 ? "day" : "days"}`}
              badge={
                data.heatmap.streakStatus === "IN_COOLDOWN"
                  ? "⏳ In Cooldown"
                  : data.heatmap.streakStatus === "ACTIVE_TODAY"
                    ? "✅ Active Today"
                    : undefined
              }
              badgeTone={
                data.heatmap.streakStatus === "IN_COOLDOWN" ? "warning" : "success"
              }
              hint={streakCardHint}
            />
            <StatCard
              label="Audit Log Entries"
              value={data.events.length}
              hint="recorded micro-events"
            />
          </div>

          {/* Quick Notice Banner on Points & Streaks (when guide is closed) */}
          {!showGuide && (
            <div className="border-border/60 bg-surface/80 flex flex-col justify-between gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <span className="bg-accent/15 text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-bold">
                  💡
                </span>
                <div>
                  <div className="text-ink text-xs font-semibold">
                    How do members earn contribution points and streaks?
                  </div>
                  <div className="text-muted mt-0.5 text-[11px]">
                    Protocols (+10), Questions (+5), Extractions (+5), Reconciliations
                    (+4), Screenings (+2), Quotes (+2), and Library imports (+1).
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(true)}
                className="text-accent hover:text-ink shrink-0 cursor-pointer text-left font-mono text-xs font-semibold hover:underline sm:text-right"
              >
                View Full Point Matrix & Cooldown Rules →
              </button>
            </div>
          )}

          {/* Top Contributors Spotlight */}
          {topContributors.length > 0 && (
            <div className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-ink text-heading font-semibold">
                    Contribution Leaderboard
                  </h3>
                  <p className="text-muted text-fine mt-0.5">
                    Top contributors ranked by total verified points from screening,
                    extraction, questions, and protocol formulation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="text-muted hover:text-ink hidden cursor-pointer font-mono text-xs underline-offset-2 hover:underline sm:block"
                >
                  Scoring breakdown ℹ️
                </button>
              </div>

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
                        <span className="bg-accent/15 border-accent/25 text-accent inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums">
                          <span>{member.contributionScore}</span>
                          <span className="text-[10px] font-semibold uppercase">pts</span>
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-muted font-mono text-[11px]">
                          {member.screenedTotal} screened · {member.extractedPapers}{" "}
                          extracted
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
      {activeTab === "breakdown" && <MemberBreakdownTable members={data.members} />}

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

export function ContributionPointGuide({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="border-border/80 bg-raised/95 animate-in fade-in slide-in-from-top-2 rounded-2xl border p-6 shadow-sm transition-all duration-200">
      <div className="border-border/50 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏆</span>
            <h3 className="text-ink text-heading font-semibold">
              How Contribution Points & Activity Streaks Work
            </h3>
            <span className="bg-accent/15 text-accent rounded-md px-2 py-0.5 font-mono text-[10px] font-bold">
              Provenance-Verified
            </span>
          </div>
          <p className="text-muted text-fine mt-1">
            Points and streaks in porcupineResearch are derived directly from verified
            review actions in the database.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="border-border bg-surface text-muted hover:text-ink hover:bg-surface-hover cursor-pointer rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors"
        >
          ✕ Dismiss Guide
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Point System Table (7 cols) */}
        <div className="flex flex-col gap-3 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h4 className="text-ink text-ui flex items-center gap-1.5 font-semibold">
              <span>🎖️</span>
              <span>Point Value Breakdown</span>
            </h4>
            <span className="text-muted font-mono text-[11px]">
              8 Weighted Action Types
            </span>
          </div>

          <div className="border-border/60 bg-surface/70 divide-border/40 divide-y overflow-hidden rounded-xl border">
            {CONTRIBUTION_POINT_SYSTEM.map((rule) => (
              <div
                key={rule.action}
                className="hover:bg-raised/40 flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 text-base">{rule.icon}</span>
                  <div className="min-w-0">
                    <div className="text-ink truncate font-semibold">{rule.action}</div>
                    <div className="text-muted truncate text-[11px]">
                      {rule.description}
                    </div>
                  </div>
                </div>

                <span className="bg-accent/15 text-accent border-accent/25 shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-bold tabular-nums">
                  +{rule.points} pts
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Streaks & Cooldown Rules (5 cols) */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          <div className="bg-surface/70 border-border/60 flex flex-col gap-2.5 rounded-xl border p-4">
            <h4 className="text-ink text-ui flex items-center gap-1.5 font-semibold">
              <span>🔥</span>
              <span>Activity Streaks</span>
            </h4>
            <p className="text-muted text-xs leading-relaxed">
              Performing <strong>at least 1 verified micro-action</strong> (screening a
              paper, extracting data, annotating PDF, or creating questions) on any day
              increments your daily streak by 1.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs dark:bg-amber-500/5">
            <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
              <span>⏳</span>
              <span>Daily Grace Cooldown Rule</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
              If you performed actions <strong>yesterday</strong>, your streak is
              protected in <strong>Cooldown</strong> throughout today until{" "}
              <strong>23:59 UTC</strong>.
            </p>
            <p className="text-[11px] leading-relaxed font-medium text-amber-900/80 dark:text-amber-200/80">
              Complete any micro-action before midnight to extend your streak to the next
              day without losing progress!
            </p>
          </div>

          <div className="bg-surface/50 border-border/50 rounded-xl border p-3.5 text-xs">
            <div className="text-ink flex items-center gap-2 font-semibold">
              <span>🛡️</span>
              <span>Anti-Gaming Integrity</span>
            </div>
            <p className="text-muted mt-1 text-[11px] leading-relaxed">
              Repeated empty clicks or rapid spamming are rejected. Points are awarded
              solely for immutable schema operations recorded in the cryptographic audit
              feed.
            </p>
          </div>
        </div>
      </div>
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
  badge?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-visible:ring-accent inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:outline-none ${
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
  badge,
  badgeTone = "normal",
}: {
  label: string;
  value: string | number;
  hint?: string | undefined;
  badge?: string | undefined;
  badgeTone?: "normal" | "warning" | "success" | undefined;
}) {
  const badgeClasses =
    badgeTone === "warning"
      ? "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300"
      : badgeTone === "success"
        ? "bg-accent/15 border-accent/25 text-accent"
        : "bg-surface border-border text-muted";

  return (
    <div className="border-border/70 bg-raised/70 flex flex-col justify-between rounded-2xl border p-4 shadow-xs">
      <div>
        <div className="flex items-center justify-between gap-1">
          <div className="text-muted text-fine font-medium">{label}</div>
          {badge && (
            <span
              className={`py-0.2 rounded border px-1.5 font-mono text-[9px] font-bold ${badgeClasses}`}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="text-title text-ink mt-1 font-bold tabular-nums">{value}</div>
      </div>
      {hint && <div className="text-muted mt-2 text-[11px]">{hint}</div>}
    </div>
  );
}
