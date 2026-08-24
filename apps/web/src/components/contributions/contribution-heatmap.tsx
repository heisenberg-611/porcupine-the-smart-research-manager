"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  buildContributionHeatmap,
  type ActivityActionType,
  type ContributionHeatmapData,
  type ProjectActivityEvent,
} from "@/lib/contributions";

const INTENSITY_CLASSES: Record<number, string> = {
  0: "bg-surface border border-border/40 text-transparent hover:border-border",
  1: "bg-accent/25 border border-accent/30 text-ink hover:border-accent/60",
  2: "bg-accent/50 border border-accent/55 text-white hover:border-accent/80",
  3: "bg-accent/75 border border-accent/80 text-white hover:border-accent",
  4: "bg-accent border border-accent text-white shadow-xs hover:brightness-110",
};

const ACTION_TYPE_COLORS: Record<ActivityActionType, string> = {
  SCREENING: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  EXTRACTION: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  COLLECTION: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  QUESTION: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PROTOCOL: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  ANNOTATION: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  RECONCILIATION: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  LOGIN: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
  LOGOUT: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
};

interface CalendarDay {
  date: string; // YYYY-MM-DD
  isToday: boolean;
  isFuture: boolean;
  dayOfWeek: number; // 0=Sun..6=Sat
  monthYear: string;
  fullDate: string; // "Monday, August 24, 2026"
  shortDate: string; // "Aug 24, 2026"
}

interface CalendarWeek {
  weekIndex: number;
  monthLabel: string;
  days: CalendarDay[];
}

export function ContributionHeatmap({
  events = [],
  members = [],
  initialHeatmap,
  onNavigateToAudit,
}: {
  events?: ProjectActivityEvent[];
  members?: Array<{ userId: string; name: string }>;
  initialHeatmap?: ContributionHeatmapData;
  onNavigateToAudit?: (searchDate?: string) => void;
}) {
  const [selectedMember, setSelectedMember] = useState<string>("ALL");
  const [weeksCount, setWeeksCount] = useState<number>(5); // 5 or 10 weeks
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Group events by YYYY-MM-DD (matches event.timestamp.slice(0, 10))
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ProjectActivityEvent[]>();
    for (const event of events) {
      if (selectedMember !== "ALL" && event.actorId !== selectedMember) continue;
      const dateStr = event.timestamp.slice(0, 10);
      const list = map.get(dateStr) ?? [];
      list.push(event);
      map.set(dateStr, list);
    }
    return map;
  }, [events, selectedMember]);

  // Compute heatmap data for streak & peak day stats
  const heatmap = useMemo(() => {
    if (selectedMember === "ALL" && weeksCount === 5 && initialHeatmap) {
      return initialHeatmap;
    }
    const filteredEvents = selectedMember === "ALL"
      ? events
      : events.filter((e) => e.actorId === selectedMember);

    return buildContributionHeatmap(filteredEvents, new Date(), weeksCount * 7);
  }, [events, selectedMember, weeksCount, initialHeatmap]);

  // Build calendar weeks aligned by UTC Sunday (Row 0) through Saturday (Row 6)
  const calendarWeeks = useMemo(() => {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const todayUtcMidnight = new Date(Date.UTC(utcYear, utcMonth, utcDate));
    const todayStr = todayUtcMidnight.toISOString().slice(0, 10);
    const dayOfWeek = todayUtcMidnight.getUTCDay(); // 0=Sun..6=Sat
    const startSunday = new Date(todayUtcMidnight.getTime() - ((weeksCount - 1) * 7 + dayOfWeek) * 86400000);

    const weeks: CalendarWeek[] = [];
    let prevMonth = "";

    for (let w = 0; w < weeksCount; w++) {
      const days: CalendarDay[] = [];

      for (let d = 0; d < 7; d++) {
        const curDate = new Date(startSunday.getTime() + (w * 7 + d) * 86400000);
        const dateStr = curDate.toISOString().slice(0, 10);
        const isToday = dateStr === todayStr;
        const isFuture = curDate.getTime() > todayUtcMidnight.getTime();
        const monthYear = curDate.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
        const fullDate = curDate.toLocaleDateString("en-US", {
          timeZone: "UTC",
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        const shortDate = curDate.toLocaleDateString("en-US", {
          timeZone: "UTC",
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        days.push({
          date: dateStr,
          isToday,
          isFuture,
          dayOfWeek: d,
          monthYear,
          fullDate,
          shortDate,
        });
      }

      const firstDay = days[0]!;
      let monthLabel = "";
      if (w === 0) {
        monthLabel = firstDay.monthYear;
        prevMonth = firstDay.monthYear;
      } else {
        const newMonthDay = days.find((d) => !d.isFuture && d.monthYear !== prevMonth);
        if (newMonthDay) {
          monthLabel = newMonthDay.monthYear;
          prevMonth = newMonthDay.monthYear;
        }
      }

      weeks.push({ weekIndex: w, monthLabel, days });
    }
    return weeks;
  }, [weeksCount]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return eventsByDate.get(selectedDate) ?? [];
  }, [selectedDate, eventsByDate]);

  // Selected date formatted with month, date, and year
  const formattedSelectedDate = useMemo(() => {
    if (!selectedDate) return "";
    const dateObj = new Date(selectedDate + "T00:00:00Z");
    return dateObj.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDate]);

  // Summary breakdown of selected day
  const selectedDayBreakdown = useMemo(() => {
    const counts: Partial<Record<ActivityActionType, number>> = {};
    for (const e of selectedDayEvents) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return counts;
  }, [selectedDayEvents]);

  // Peak day formatted with month, day, and year
  const formattedPeakDay = useMemo(() => {
    if (!heatmap.peakDay) return null;
    const dateObj = new Date(heatmap.peakDay.date + "T00:00:00Z");
    const label = dateObj.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${heatmap.peakDay.count} actions (${label})`;
  }, [heatmap.peakDay]);

  return (
    <div className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs">
      {/* Header & Interactive Filter Bar */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-ink text-heading font-semibold">
              Activity Heatmap & Daily Drilldown
            </h3>
            <span className="bg-accent/15 text-accent rounded-md px-2 py-0.5 font-mono text-[10px] font-bold">
              Interactive
            </span>
          </div>
          <p className="text-muted text-fine mt-0.5">
            Click any cell to inspect recorded micro-actions for that date.
          </p>
        </div>

        {/* Filters: Contributor & Range */}
        <div className="flex flex-wrap items-center gap-3">
          {members.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="heatmap-member" className="text-muted text-[11px] font-mono uppercase">
                Member
              </label>
              <select
                id="heatmap-member"
                value={selectedMember}
                onChange={(e) => {
                  setSelectedMember(e.target.value);
                  setSelectedDate(null);
                }}
                className="border-border/80 bg-surface text-ink focus-visible:ring-accent rounded-lg border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="ALL">Entire Team</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Range Selector */}
          <div className="border-border/70 bg-surface/80 flex items-center rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => {
                setWeeksCount(5);
                setSelectedDate(null);
              }}
              className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                weeksCount === 5
                  ? "bg-accent text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              5 Weeks (35d)
            </button>
            <button
              type="button"
              onClick={() => {
                setWeeksCount(10);
                setSelectedDate(null);
              }}
              className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                weeksCount === 10
                  ? "bg-accent text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              10 Weeks (70d)
            </button>
          </div>
        </div>
      </div>

      {/* Streak & Stats Summary */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block text-[10px] uppercase font-mono tracking-wider">
            Total Actions in Range
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            {heatmap.totalActions} actions
          </span>
        </div>

        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block text-[10px] uppercase font-mono tracking-wider">
            Current Streak
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            🔥 {heatmap.currentStreak} {heatmap.currentStreak === 1 ? "day" : "days"}
          </span>
        </div>

        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block text-[10px] uppercase font-mono tracking-wider">
            Longest Streak
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            ⚡ {heatmap.longestStreak} {heatmap.longestStreak === 1 ? "day" : "days"}
          </span>
        </div>

        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block text-[10px] uppercase font-mono tracking-wider">
            Peak Activity Day
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            {formattedPeakDay ?? "None yet"}
          </span>
        </div>
      </div>

      {/* Interactive Punchcard Grid with Month and Weekday Headers */}
      <div className="mt-6 overflow-x-auto pb-2 scrollbar-thin">
        <div className="min-w-max p-1">
          {/* Month & Year Headers across columns */}
          <div className="flex gap-1.5 pl-8 text-[11px] font-mono font-semibold text-muted">
            {calendarWeeks.map((week) => (
              <div
                key={`header-${week.weekIndex}`}
                className="w-7.5 text-left truncate"
                title={week.monthLabel || undefined}
              >
                {week.monthLabel || ""}
              </div>
            ))}
          </div>

          {/* Grid Rows with Weekdays on the left */}
          <div className="mt-1 flex gap-2">
            {/* Weekday Row Labels (Aligned 1-to-1 with 7 grid rows) */}
            <div className="grid grid-rows-7 gap-1.5 text-[10px] font-mono text-muted/70 w-6">
              <span className="h-7.5 flex items-center justify-end">Sun</span>
              <span className="h-7.5" />
              <span className="h-7.5 flex items-center justify-end">Tue</span>
              <span className="h-7.5" />
              <span className="h-7.5 flex items-center justify-end">Thu</span>
              <span className="h-7.5" />
              <span className="h-7.5 flex items-center justify-end">Sat</span>
            </div>

            {/* Week Columns Grid */}
            <div className="flex gap-1.5">
              {calendarWeeks.map((week) => (
                <div
                  key={`week-${week.weekIndex}`}
                  className="grid grid-rows-7 gap-1.5"
                >
                  {week.days.map((day) => {
                    const dayEvents = eventsByDate.get(day.date) ?? [];
                    const count = dayEvents.length;

                    let intensity: 0 | 1 | 2 | 3 | 4 = 0;
                    if (count > 0) {
                      if (count <= 2) intensity = 1;
                      else if (count <= 5) intensity = 2;
                      else if (count <= 10) intensity = 3;
                      else intensity = 4;
                    }

                    const intensityClass = INTENSITY_CLASSES[intensity] || INTENSITY_CLASSES[0];
                    const isSelected = selectedDate === day.date;

                    if (day.isFuture) {
                      return (
                        <div
                          key={day.date}
                          className="h-7.5 w-7.5 rounded-lg border border-border/20 bg-surface/30 opacity-25"
                          title={`${day.shortDate} (Future)`}
                        />
                      );
                    }

                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => {
                          setSelectedDate(isSelected ? null : day.date);
                        }}
                        title={`${day.fullDate}${day.isToday ? " (Today)" : ""}: ${count} ${count === 1 ? "action" : "actions"} (click to inspect)`}
                        aria-label={`${day.fullDate}: ${count} actions`}
                        className={`relative flex h-7.5 w-7.5 items-center justify-center rounded-lg font-mono text-[10px] font-semibold transition-all duration-150 cursor-pointer ${intensityClass} ${
                          isSelected
                            ? "ring-2 ring-accent ring-offset-2 ring-offset-raised scale-110 z-10 font-bold"
                            : "hover:scale-110"
                        } ${day.isToday ? "outline-dashed outline-1 outline-accent" : ""}`}
                      >
                        {count > 0 ? (count > 99 ? "99+" : count) : ""}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend & Hint */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-xs pt-2">
            <span className="text-muted text-[11px] italic">
              Tip: Click any colored square (including Today) to inspect detailed actions recorded on that date.
            </span>

            <div className="text-muted flex items-center gap-2 font-mono text-[11px]">
              <span>Less</span>
              <div className="flex items-center gap-1">
                <div className="bg-surface border-border/40 h-3 w-3 rounded border" />
                <div className="bg-accent/25 border-accent/30 h-3 w-3 rounded border" />
                <div className="bg-accent/50 border-accent/55 h-3 w-3 rounded border" />
                <div className="bg-accent/75 border-accent/80 h-3 w-3 rounded border" />
                <div className="bg-accent border-accent h-3 w-3 rounded border" />
              </div>
              <span>More</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Day Inspector Drawer / Card */}
      {selectedDate && (
        <div className="border-border/80 bg-surface/90 mt-6 rounded-xl border p-5 shadow-xs transition-all animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-ink font-semibold text-sm">
                  {formattedSelectedDate}
                </h4>
                <span className="inline-flex items-center rounded-full bg-accent/15 border border-accent/25 px-2.5 py-0.5 font-mono text-xs font-bold text-accent">
                  {selectedDayEvents.length} {selectedDayEvents.length === 1 ? "action" : "actions"}
                </span>
              </div>

              {/* Action Type breakdown tags */}
              {Object.keys(selectedDayBreakdown).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {Object.entries(selectedDayBreakdown).map(([type, count]) => {
                    const badgeColor =
                      ACTION_TYPE_COLORS[type as ActivityActionType] || "bg-raised text-ink border-border";
                    return (
                      <span
                        key={type}
                        className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${badgeColor}`}
                      >
                        {count} {type}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {onNavigateToAudit && (
                <button
                  type="button"
                  onClick={() => onNavigateToAudit(selectedDate)}
                  className="bg-accent text-white hover:bg-accent/90 focus-visible:ring-accent rounded-lg px-3 py-1.5 font-mono text-xs font-semibold shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  View in Audit Log →
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="border-border bg-surface text-muted hover:text-ink hover:bg-surface-hover rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* List of actions for selected day */}
          {selectedDayEvents.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted">
              No actions recorded on this date.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-border/30 max-h-[300px] overflow-y-auto scrollbar-thin">
              {selectedDayEvents.map((event) => {
                const badgeColor =
                  ACTION_TYPE_COLORS[event.type] || "bg-raised text-ink border-border";
                const timeStr = new Date(event.timestamp).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                });

                return (
                  <div
                    key={event.id}
                    className="hover:bg-raised/50 flex items-start justify-between gap-3 py-2.5 px-2 rounded-lg transition-colors text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{event.actorName}</span>
                        <span
                          className={`rounded-md border px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase ${badgeColor}`}
                        >
                          {event.type}
                        </span>
                        <span className="text-muted text-[11px]">{event.action}</span>
                      </div>

                      <div className="mt-0.5 truncate">
                        {event.targetHref ? (
                          <Link
                            href={event.targetHref}
                            className="text-ink hover:text-accent font-medium underline-offset-4 hover:underline"
                          >
                            {event.targetTitle}
                          </Link>
                        ) : (
                          <span className="text-ink font-medium">{event.targetTitle}</span>
                        )}
                      </div>

                      {event.details && (
                        <div className="text-muted text-[11px] mt-0.5 italic truncate">
                          {event.details}
                        </div>
                      )}
                    </div>

                    <span className="text-muted font-mono text-[11px] shrink-0 pt-0.5 tabular-nums">
                      {timeStr}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
