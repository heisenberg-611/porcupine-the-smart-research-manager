import { describe, expect, it } from "vitest";
import {
  aggregateProjectContributions,
  buildContributionHeatmap,
  type AggregateInputs,
  type ProjectActivityEvent,
} from "./contributions";

describe("contributions engine", () => {
  const projectId = "proj-123";

  const mockInputs: AggregateInputs = {
    projectId,
    members: [
      {
        id: "pm-1",
        user_id: "usr-alice",
        access_role: "OWNER",
        joined_at: "2026-08-01T00:00:00Z",
        users: { display_name: "Alice Smith", email: "alice@example.com" },
      },
      {
        id: "pm-2",
        user_id: "usr-bob",
        access_role: "MEMBER",
        joined_at: "2026-08-02T00:00:00Z",
        users: { display_name: "Bob Jones", email: "bob@example.com" },
      },
    ],
    screeningDecisions: [
      {
        id: "sd-1",
        project_work_id: "pw-1",
        decided_by: "usr-alice",
        to_status: "INCLUDED",
        note: "Meets criteria",
        created_at: "2026-08-20T10:00:00Z",
        works: { title: "Paper 1" },
      },
      {
        id: "sd-2",
        project_work_id: "pw-2",
        decided_by: "usr-alice",
        to_status: "EXCLUDED",
        note: null,
        created_at: "2026-08-20T11:00:00Z",
        works: { title: "Paper 2" },
      },
      {
        id: "sd-3",
        project_work_id: "pw-3",
        decided_by: "usr-bob",
        to_status: "INCLUDED",
        note: "Good sample size",
        created_at: "2026-08-21T09:00:00Z",
        works: { title: "Paper 3" },
      },
    ],
    extractions: [
      {
        id: "ext-1",
        project_work_id: "pw-1",
        extractor_id: "usr-bob",
        status: "SUBMITTED",
        created_at: "2026-08-22T14:00:00Z",
        updated_at: "2026-08-22T15:00:00Z",
        submitted_at: "2026-08-22T15:00:00Z",
        works: { title: "Paper 1" },
        field_count: 5,
      },
    ],
    extractionValuesCountByExtractor: {
      "usr-bob": 5,
    },
    projectWorks: [
      {
        id: "pw-1",
        added_by: "usr-alice",
        created_at: "2026-08-10T08:00:00Z",
        screen_status: "INCLUDED",
        works: { title: "Paper 1" },
      },
      {
        id: "pw-2",
        added_by: "usr-alice",
        created_at: "2026-08-10T08:30:00Z",
        screen_status: "EXCLUDED",
        works: { title: "Paper 2" },
      },
    ],
    questions: [
      {
        id: "q-1",
        title: "What is the effect of X on Y?",
        created_by: "usr-alice",
        created_at: "2026-08-05T12:00:00Z",
      },
    ],
    protocols: [
      {
        id: "proto-1",
        name: "Trial Protocol",
        version: 1,
        created_by: "usr-alice",
        created_at: "2026-08-08T10:00:00Z",
      },
    ],
    annotations: [
      {
        id: "anno-1",
        project_work_id: "pw-1",
        created_by: "usr-bob",
        created_at: "2026-08-22T14:30:00Z",
        comment: "Key statistic on page 4",
        works: { title: "Paper 1" },
      },
    ],
    reconciliations: [],
    authSessions: [
      {
        userId: "usr-alice",
        type: "LOGIN",
        action: "Signed in to Porcupine",
        label: "Web Session",
        timestamp: "2026-08-23T08:00:00Z",
      },
      // Near-duplicate event within 15 minutes
      {
        userId: "usr-alice",
        type: "LOGIN",
        action: "Account signed up / authenticated",
        label: "Web Session",
        timestamp: "2026-08-23T08:02:00Z",
      },
      {
        userId: "usr-bob",
        type: "LOGOUT",
        action: "Signed out of Porcupine",
        label: "Web Session",
        timestamp: "2026-08-23T09:00:00Z",
      },
    ],
  };

  it("accurately aggregates per-member contribution stats and percentages", () => {
    const result = aggregateProjectContributions(mockInputs);

    expect(result.members.length).toBe(2);
    expect(result.activeContributorsCount).toBe(2);

    const alice = result.members.find((m) => m.userId === "usr-alice")!;
    const bob = result.members.find((m) => m.userId === "usr-bob")!;

    // Alice: 2 screened (4 pts) + 2 imported (2 pts) + 1 question (5 pts) + 1 protocol (10 pts) = 21 pts
    expect(alice.screenedTotal).toBe(2);
    expect(alice.screenedIncluded).toBe(1);
    expect(alice.screenedExcluded).toBe(1);
    expect(alice.papersImported).toBe(2);
    expect(alice.questionsCreated).toBe(1);
    expect(alice.protocolsCreated).toBe(1);
    expect(alice.contributionScore).toBe(21);

    // Bob: 1 screened (2 pts) + 1 extraction (5 pts) + 5 fields (5 pts) + 1 annotation (2 pts) = 14 pts
    expect(bob.screenedTotal).toBe(1);
    expect(bob.extractedPapers).toBe(1);
    expect(bob.extractedFields).toBe(5);
    expect(bob.annotationsCount).toBe(1);
    expect(bob.contributionScore).toBe(14);

    // Total points = 21 + 14 = 35
    // Alice % = 21/35 = 60%
    // Bob % = 14/35 = 40%
    expect(alice.percentageShare).toBe(60);
    expect(bob.percentageShare).toBe(40);
  });

  it("generates a unified chronological audit event feed with all login and logout events", () => {
    const result = aggregateProjectContributions(mockInputs);

    // 9 research events + 2 login events + 1 logout = 12 total events
    expect(result.events.length).toBe(12);

    const aliceLogins = result.events.filter((e) => e.actorId === "usr-alice" && e.type === "LOGIN");
    // Both login events are preserved as distinct audit records
    expect(aliceLogins.length).toBe(2);
    expect(aliceLogins[0]?.actorName).toBe("Alice Smith");

    const logoutEvent = result.events.find((e) => e.type === "LOGOUT");
    expect(logoutEvent).toBeDefined();
    expect(logoutEvent?.actorName).toBe("Bob Jones");
    expect(logoutEvent?.action).toBe("Signed out of Porcupine");
  });

  it("computes contribution heatmap days and activity streaks", () => {
    const testEvents: ProjectActivityEvent[] = [
      {
        id: "e1",
        type: "SCREENING",
        actorId: "usr-1",
        actorName: "Alice",
        actorEmail: "alice@example.com",
        action: "Screened",
        targetTitle: "Paper 1",
        timestamp: "2026-08-24T12:00:00Z",
      },
      {
        id: "e2",
        type: "EXTRACTION",
        actorId: "usr-1",
        actorName: "Alice",
        actorEmail: "alice@example.com",
        action: "Extracted",
        targetTitle: "Paper 1",
        timestamp: "2026-08-23T12:00:00Z",
      },
    ];

    const heatmap = buildContributionHeatmap(testEvents, new Date("2026-08-24T12:00:00Z"));

    expect(heatmap.days.length).toBe(371);
    expect(heatmap.totalActions).toBe(2);
    expect(heatmap.currentStreak).toBe(2);
    expect(heatmap.longestStreak).toBe(2);
    expect(heatmap.peakDay?.count).toBe(1);
    expect(heatmap.streakStatus).toBe("ACTIVE_TODAY");

    // Test Cooldown Period: Active yesterday (Aug 24) but 0 actions on current day (Aug 25)
    const cooldownHeatmap = buildContributionHeatmap(testEvents, new Date("2026-08-25T10:00:00Z"));
    expect(cooldownHeatmap.currentStreak).toBe(2);
    expect(cooldownHeatmap.streakStatus).toBe("IN_COOLDOWN");
    expect(cooldownHeatmap.cooldownHoursRemaining).toBe(14); // 24 - 10

    // Test Inactive / Broken Streak: No actions on Aug 25 or Aug 26
    const brokenHeatmap = buildContributionHeatmap(testEvents, new Date("2026-08-26T12:00:00Z"));
    expect(brokenHeatmap.currentStreak).toBe(0);
    expect(brokenHeatmap.streakStatus).toBe("INACTIVE");

    const customHeatmap = buildContributionHeatmap(testEvents, new Date("2026-08-24T12:00:00Z"), 35);
    expect(customHeatmap.days.length).toBe(35);
    expect(customHeatmap.totalActions).toBe(2);
  });
});
