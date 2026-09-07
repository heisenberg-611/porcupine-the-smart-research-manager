"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui";
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
  EXTRACTION:
    "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  COLLECTION:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  QUESTION: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PROTOCOL: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  ANNOTATION: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  RECONCILIATION:
    "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  LOGIN: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
  LOGOUT: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
};

interface CalendarDay {
  date: string; // YYYY-MM-DD
  isToday: boolean;
  isFuture: boolean;
  dayOfWeek: number; // 0=Sun..6=Sat
  monthShort: string; // "Aug"
  monthYear: string;
  fullDate: string; // "Monday, August 24, 2026"
  shortDate: string; // "Aug 24, 2026"
}

interface CalendarWeek {
  weekIndex: number;
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
  const [selectedYear, setSelectedYear] = useState<string>("LAST_12_MONTHS");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Extract available years from events
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getUTCFullYear();
    years.add(currentYear);
    for (const event of events) {
      const year = parseInt(event.timestamp.slice(0, 4), 10);
      if (!isNaN(year)) {
        years.add(year);
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [events]);

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

  // Compute heatmap data for streak & peak day stats across the selected yearly view
  const heatmap = useMemo(() => {
    const filteredEvents =
      selectedMember === "ALL"
        ? events
        : events.filter((e) => e.actorId === selectedMember);

    if (selectedYear === "LAST_12_MONTHS") {
      if (selectedMember === "ALL" && initialHeatmap) {
        return initialHeatmap;
      }
      return buildContributionHeatmap(filteredEvents, new Date(), 371);
    }

    // Specific calendar year (e.g. 2026, 2025)
    const yearNum = parseInt(selectedYear, 10);
    const now = new Date();
    const isCurrentYear = now.getUTCFullYear() === yearNum;
    const refDate = isCurrentYear ? now : new Date(Date.UTC(yearNum, 11, 31));

    const jan1 = new Date(Date.UTC(yearNum, 0, 1));
    const daysInSpan = Math.ceil((refDate.getTime() - jan1.getTime()) / 86400000) + 1;

    return buildContributionHeatmap(filteredEvents, refDate, Math.max(daysInSpan, 365));
  }, [events, selectedMember, selectedYear, initialHeatmap]);

  // Build GitHub-style 53 calendar weeks (Sunday=0 through Saturday=6)
  const calendarWeeks = useMemo(() => {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const todayUtcMidnight = new Date(Date.UTC(utcYear, utcMonth, utcDate));
    const todayStr = todayUtcMidnight.toISOString().slice(0, 10);

    let startSunday: Date;
    let maxUtcTime = todayUtcMidnight.getTime();

    if (selectedYear === "LAST_12_MONTHS") {
      // Trailing 53 weeks ending on the current week's Saturday
      const dayOfWeek = todayUtcMidnight.getUTCDay(); // 0=Sun..6=Sat
      const endWeekSunday = new Date(todayUtcMidnight.getTime() - dayOfWeek * 86400000);
      startSunday = new Date(endWeekSunday.getTime() - 52 * 7 * 86400000);
    } else {
      // Specific calendar year
      const yearNum = parseInt(selectedYear, 10);
      const jan1 = new Date(Date.UTC(yearNum, 0, 1));
      const jan1DayOfWeek = jan1.getUTCDay();
      startSunday = new Date(jan1.getTime() - jan1DayOfWeek * 86400000);

      const endOfYear = new Date(Date.UTC(yearNum, 11, 31, 23, 59, 59));
      maxUtcTime = Math.min(todayUtcMidnight.getTime(), endOfYear.getTime());
    }

    const weeks: CalendarWeek[] = [];
    const totalWeeks = 53;

    for (let w = 0; w < totalWeeks; w++) {
      const days: CalendarDay[] = [];

      for (let d = 0; d < 7; d++) {
        const curDate = new Date(startSunday.getTime() + (w * 7 + d) * 86400000);
        const dateStr = curDate.toISOString().slice(0, 10);
        const isToday = dateStr === todayStr;
        const isFuture = curDate.getTime() > maxUtcTime;
        const monthShort = curDate.toLocaleDateString("en-US", {
          timeZone: "UTC",
          month: "short",
        });
        const monthYear = curDate.toLocaleDateString("en-US", {
          timeZone: "UTC",
          month: "short",
          year: "numeric",
        });
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
          monthShort,
          monthYear,
          fullDate,
          shortDate,
        });
      }

      weeks.push({ weekIndex: w, days });
    }

    return weeks;
  }, [selectedYear]);

  // Compute non-colliding month header labels aligned with week columns
  const monthHeaders = useMemo(() => {
    const headers: Array<{ weekIndex: number; label: string }> = [];
    let lastLabeledWeek = -10;

    for (let w = 0; w < calendarWeeks.length; w++) {
      const week = calendarWeeks[w];
      if (!week) continue;

      const firstDayOfMonth = week.days.find(
        (d) => d.date.endsWith("-01") && !d.isFuture,
      );
      const firstDayOfWeek = week.days[0]!;

      if (w === 0) {
        // Show month of the first column if next month start is at least 3 weeks away
        const nextMonthStartWeek = calendarWeeks.findIndex(
          (cw, idx) => idx > 0 && cw.days.some((d) => d.date.endsWith("-01")),
        );
        if (nextMonthStartWeek === -1 || nextMonthStartWeek >= 3) {
          headers.push({ weekIndex: 0, label: firstDayOfWeek.monthShort });
          lastLabeledWeek = 0;
        }
      } else if (firstDayOfMonth) {
        // A new month begins in this week column
        if (w - lastLabeledWeek >= 2 && w <= calendarWeeks.length - 2) {
          headers.push({ weekIndex: w, label: firstDayOfMonth.monthShort });
          lastLabeledWeek = w;
        }
      } else {
        // Month changed across weeks
        const prevWeek = calendarWeeks[w - 1];
        if (prevWeek && prevWeek.days[0]?.monthShort !== firstDayOfWeek.monthShort) {
          if (w - lastLabeledWeek >= 2 && w <= calendarWeeks.length - 2) {
            headers.push({ weekIndex: w, label: firstDayOfWeek.monthShort });
            lastLabeledWeek = w;
          }
        }
      }
    }

    return headers;
  }, [calendarWeeks]);

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
              Yearly View
            </span>
          </div>
          <p className="text-muted text-fine mt-0.5">
            53-week contribution graph. Click any square to inspect recorded micro-actions
            for that date.
          </p>
        </div>

        {/* Filters: Contributor & Year Selector */}
        <div className="flex flex-wrap items-center gap-3">
          {members.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="heatmap-member"
                className="text-muted font-mono text-[11px] uppercase"
              >
                Member
              </label>
              <Select
                compact
                id="heatmap-member"
                value={selectedMember}
                onChange={(e) => {
                  setSelectedMember(e.target.value);
                  setSelectedDate(null);
                }}
                className="border-border/80 bg-surface text-ink text-xs"
              >
                <option value="ALL">Entire Team</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Year Range Selector */}
          <div className="border-border/70 bg-surface/80 flex items-center rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => {
                setSelectedYear("LAST_12_MONTHS");
                setSelectedDate(null);
              }}
              className={`cursor-pointer rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                selectedYear === "LAST_12_MONTHS"
                  ? "bg-accent text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              Past 12 Months
            </button>
            {availableYears.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => {
                  setSelectedYear(String(year));
                  setSelectedDate(null);
                }}
                className={`cursor-pointer rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                  selectedYear === String(year)
                    ? "bg-accent text-white shadow-xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Streak & Stats Summary */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block font-mono text-[10px] tracking-wider uppercase">
            Total Actions (
            {selectedYear === "LAST_12_MONTHS" ? "Past Year" : selectedYear})
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            {heatmap.totalActions} actions
          </span>
        </div>

        <div className="bg-surface/80 border-border/60 flex flex-col justify-between rounded-xl border p-3">
          <div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-muted block font-mono text-[10px] tracking-wider uppercase">
                Current Streak
              </span>
              {heatmap.streakStatus === "IN_COOLDOWN" && (
                <span className="py-0.2 rounded border border-amber-500/30 bg-amber-500/15 px-1.5 font-mono text-[9px] font-bold text-amber-700 dark:text-amber-300">
                  ⏳ Cooldown
                </span>
              )}
              {heatmap.streakStatus === "ACTIVE_TODAY" && (
                <span className="bg-accent/15 border-accent/25 text-accent py-0.2 rounded border px-1.5 font-mono text-[9px] font-bold">
                  ✅ Active
                </span>
              )}
            </div>
            <span className="text-ink mt-0.5 block text-sm font-bold tabular-nums">
              🔥 {heatmap.currentStreak} {heatmap.currentStreak === 1 ? "day" : "days"}
            </span>
          </div>
          {heatmap.streakStatus === "IN_COOLDOWN" && (
            <span className="mt-1 block truncate font-mono text-[10px] text-amber-600 dark:text-amber-400">
              ⏳ {heatmap.cooldownHoursRemaining}h left today to extend
            </span>
          )}
          {heatmap.streakStatus === "ACTIVE_TODAY" && (
            <span className="text-accent mt-1 block truncate font-mono text-[10px]">
              Extended today!
            </span>
          )}
        </div>

        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block font-mono text-[10px] tracking-wider uppercase">
            Longest Streak
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            ⚡ {heatmap.longestStreak} {heatmap.longestStreak === 1 ? "day" : "days"}
          </span>
        </div>

        <div className="bg-surface/80 border-border/60 rounded-xl border p-3">
          <span className="text-muted block font-mono text-[10px] tracking-wider uppercase">
            Peak Activity Day
          </span>
          <span className="text-ink text-sm font-bold tabular-nums">
            {formattedPeakDay ?? "None yet"}
          </span>
        </div>
      </div>

      {/* GitHub-Style 53-Week Heatmap Grid */}
      <div className="mt-6 scrollbar-thin overflow-x-auto pb-2">
        <div className="min-w-max p-1">
          {/* Month Headers positioned precisely above week columns */}
          <div className="relative mb-1 h-5 select-none">
            {monthHeaders.map((header) => (
              <span
                key={`${header.label}-${header.weekIndex}`}
                className="text-muted/90 absolute overflow-visible font-mono text-[10px] leading-none font-semibold whitespace-nowrap"
                style={{ left: `${36 + header.weekIndex * 15}px` }}
              >
                {header.label}
              </span>
            ))}
          </div>

          {/* Grid Rows with Weekdays on the left */}
          <div className="flex items-start gap-2">
            {/* Weekday Row Labels (Aligned with 7 rows of 12px height + 3px gap) */}
            <div className="text-muted/70 grid w-7 grid-rows-7 gap-[3px] font-mono text-[9px] select-none">
              <span className="flex h-3 items-center justify-end" />
              <span className="flex h-3 items-center justify-end pr-1 leading-none">
                Mon
              </span>
              <span className="flex h-3 items-center justify-end" />
              <span className="flex h-3 items-center justify-end pr-1 leading-none">
                Wed
              </span>
              <span className="flex h-3 items-center justify-end" />
              <span className="flex h-3 items-center justify-end pr-1 leading-none">
                Fri
              </span>
              <span className="flex h-3 items-center justify-end" />
            </div>

            {/* 53 Week Columns Grid */}
            <div className="flex gap-[3px]">
              {calendarWeeks.map((week) => (
                <div
                  key={`week-${week.weekIndex}`}
                  className="grid grid-rows-7 gap-[3px]"
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

                    const intensityClass =
                      INTENSITY_CLASSES[intensity] || INTENSITY_CLASSES[0];
                    const isSelected = selectedDate === day.date;

                    if (day.isFuture) {
                      return (
                        <div
                          key={day.date}
                          className="pointer-events-none h-3 w-3 rounded-[2px] opacity-0"
                          aria-hidden="true"
                        />
                      );
                    }

                    const actionLabel = count === 1 ? "action" : "actions";
                    const tooltipText =
                      count === 0
                        ? `No actions on ${day.shortDate}`
                        : `${count} ${actionLabel} on ${day.shortDate}`;

                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => {
                          setSelectedDate(isSelected ? null : day.date);
                        }}
                        title={`${tooltipText}${day.isToday ? " (Today)" : ""} (click to inspect)`}
                        aria-label={`${tooltipText}`}
                        className={`relative h-3 w-3 cursor-pointer rounded-[2px] transition-transform duration-100 ${intensityClass} ${
                          isSelected
                            ? "ring-accent ring-offset-raised z-20 scale-125 ring-2 ring-offset-1"
                            : "hover:z-10 hover:scale-125"
                        } ${day.isToday ? "ring-accent ring-1" : ""}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend & Hint */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 pt-2 text-xs">
            <span className="text-muted text-[11px] italic">
              Tip: Click any square to inspect detailed actions recorded on that date.
            </span>

            <div className="text-muted flex items-center gap-2 font-mono text-[11px]">
              <span>Less</span>
              <div className="flex items-center gap-1">
                <div className="bg-surface border-border/40 h-3 w-3 rounded-[2px] border" />
                <div className="bg-accent/25 border-accent/30 h-3 w-3 rounded-[2px] border" />
                <div className="bg-accent/50 border-accent/55 h-3 w-3 rounded-[2px] border" />
                <div className="bg-accent/75 border-accent/80 h-3 w-3 rounded-[2px] border" />
                <div className="bg-accent border-accent h-3 w-3 rounded-[2px] border" />
              </div>
              <span>More</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Day Inspector Drawer / Card */}
      {selectedDate && (
        <div className="border-border/80 bg-surface/90 animate-in fade-in slide-in-from-top-2 mt-6 rounded-xl border p-5 shadow-xs transition-all duration-200">
          <div className="border-border/50 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-ink text-sm font-semibold">
                  {formattedSelectedDate}
                </h4>
                <span className="bg-accent/15 border-accent/25 text-accent inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold">
                  {selectedDayEvents.length}{" "}
                  {selectedDayEvents.length === 1 ? "action" : "actions"}
                </span>
              </div>

              {/* Action Type breakdown tags */}
              {Object.keys(selectedDayBreakdown).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {Object.entries(selectedDayBreakdown).map(([type, count]) => {
                    const badgeColor =
                      ACTION_TYPE_COLORS[type as ActivityActionType] ||
                      "bg-raised text-ink border-border";
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
                  className="bg-accent hover:bg-accent/90 focus-visible:ring-accent cursor-pointer rounded-lg px-3 py-1.5 font-mono text-xs font-semibold text-white shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  View in Audit Log →
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="border-border bg-surface text-muted hover:text-ink hover:bg-surface-hover cursor-pointer rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* List of actions for selected day */}
          {selectedDayEvents.length === 0 ? (
            <div className="text-muted py-6 text-center text-xs">
              No actions recorded on this date.
            </div>
          ) : (
            <div className="divide-border/30 mt-3 max-h-[300px] scrollbar-thin divide-y overflow-y-auto">
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
                    className="hover:bg-raised/50 flex items-start justify-between gap-3 rounded-lg px-2 py-2.5 text-xs transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink font-semibold">{event.actorName}</span>
                        <span
                          className={`py-0.2 rounded-md border px-1.5 font-mono text-[9px] font-bold uppercase ${badgeColor}`}
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
                          <span className="text-ink font-medium">
                            {event.targetTitle}
                          </span>
                        )}
                      </div>

                      {event.details && (
                        <div className="text-muted mt-0.5 truncate text-[11px] italic">
                          {event.details}
                        </div>
                      )}
                    </div>

                    <span className="text-muted shrink-0 pt-0.5 font-mono text-[11px] tabular-nums">
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
