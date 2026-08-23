import { capabilities, isProjectKind, type ProjectKind } from "@Porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { getProject } from "@/lib/project";
import {
  projectSections,
  SECTION_GROUPS,
  sectionHref,
  type SectionGroup,
} from "@/lib/project-sections";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { AccessForm } from "./access-form";
import { InviteMemberForm } from "./invite-member-form";
import { MemberRowActions } from "./member-row-actions";

export const metadata: Metadata = { title: "Overview" };

interface MemberRow {
  id: string;
  user_id: string;
  access_role: string;
  history_access: string;
  joined_at: string | null;
  users: { display_name: string; email: string } | null;
}

interface ProgressRow {
  screen_status: string;
  count: number;
}

/**
 * The project overview.
 *
 * What this replaced: nine identical outline buttons in one flat wrapping row
 * — Library, Find papers, Protocol, Evidence, Reconcile, PRISMA, Progress,
 * Screen, Import — in an order that was neither the workflow's nor
 * alphabetical, carrying no state whatsoever. Not the paper count, not whether
 * a protocol existed, not what was left to screen. Every number the app had
 * already computed was one click away and none of it was here, so the first
 * screen inside a project answered no question anyone arrives with.
 *
 * Two of those nine also led to a refusal: a THESIS showed Reconcile and
 * PRISMA, and clicking either cost a page load to be told the feature is for
 * systematic reviews. Sections now come from `projectSections(kind)`, so what
 * a project cannot do is not offered.
 *
 * Every count on this page links to the view it counts. A number you cannot
 * click is a dead end with extra steps.
 *
 * The grid of section cards is now `lg:hidden`. On a wide screen the sidebar
 * lists the same destinations, grouped the same way, permanently — so the grid
 * was a second copy of the menu sitting directly beneath the first. Below
 * `lg` there is no sidebar, and the cards are how you get anywhere, so they
 * stay. What the overview is FOR is the four counts and the next action;
 * neither belongs in a menu.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  // Already fetched and cached by the layout above; this costs nothing.
  const project = await getProject(id);

  if (!project) notFound();

  const kind: ProjectKind = isProjectKind(project.kind) ? project.kind : "GENERAL";
  const caps = capabilities(kind);
  const sections = projectSections(kind);

  // In parallel: independent reads, none of which needs another's result.
  const [
    memberData,
    progressData,
    protocolCount,
    reconcileCount,
    questionData,
    extractionsData,
  ] = await Promise.all([
    must(
      supabase
        .from("project_members")
        .select(
          // See the note in extract/page.tsx: two relationships now exist
          // between project_members and users, so the embed names which.
          "id, user_id, access_role, history_access, joined_at, " +
            "users!project_members_user_id_fkey(display_name, email)",
        )
        .eq("project_id", id)
        .is("removed_at", null)
        .order("joined_at", { ascending: true }),
      "project members",
    ),
    must(
      supabase
        .from("v_project_progress")
        .select("screen_status, count")
        .eq("project_id", id),
      "screening progress",
    ),
    supabase
      .from("protocols")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id),
    // Only asked for when the project has the feature: a THESIS querying a
    // reconciliation view it can never use is a round trip spent on nothing.
    caps.dualExtraction
      ? supabase
          .from("v_reconciliation_queue")
          .select("project_work_id", { count: "exact", head: true })
          .eq("project_id", id)
          .eq("reconciled", false)
      : Promise.resolve({ count: 0, error: null }),
    supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id),
    supabase
      .from("extractions")
      .select("project_work_id")
      .eq("project_id", id)
      .neq("status", "DRAFT"),
  ]);

  const members = (memberData ?? []) as unknown as MemberRow[];
  const me = members.find((m) => m.user_id === user.id);
  const canInvite = me?.access_role === "OWNER" || me?.access_role === "ADMIN";

  const { checkProjectAutomationState } = await import("../actions");
  const { isDisconnected } = await checkProjectAutomationState(id);

  const progress = (progressData ?? []) as unknown as ProgressRow[];
  const countOf = (...statuses: string[]) =>
    progress
      .filter((r) => statuses.includes(r.screen_status))
      .reduce((sum, r) => sum + r.count, 0);

  const papers = progress.reduce((sum, r) => sum + r.count, 0);
  const unscreened = countOf("IDENTIFIED", "SCREENING");
  const included = countOf("INCLUDED", "READING", "EXTRACTED", "SYNTHESIZED");
  const excluded = countOf("EXCLUDED");

  // Distinct completed/submitted extracted papers
  const extractedWorks = new Set(
    ((extractionsData?.data ?? []) as Array<{ project_work_id: string }>).map(
      (e) => e.project_work_id,
    ),
  );
  const dbExtracted = countOf("EXTRACTED", "SYNTHESIZED");
  const extracted = Math.max(extractedWorks.size, dbExtracted);

  const hasProtocol = (protocolCount.count ?? 0) > 0;
  const questionCount = questionData.count ?? 0;
  const awaiting = reconcileCount.count ?? 0;

  /**
   * What to do next.
   *
   * Deliberately one action rather than a checklist. A project in this state
   * has exactly one obvious next move, and naming it is the difference between
   * a dashboard and a tool. The order below is the order the work happens in,
   * so the first unmet condition wins.
   */
  const next =
    questionCount === 0
      ? {
          href: sectionHref(id, "questions"),
          label: "Add your research question",
          // Before finding papers, because it changes what finding papers
          // returns: with no questions the ranking has nothing to score
          // against and every result reports matching nothing.
          why: "Search is ranked against your research questions, and there are none yet.",
        }
      : papers === 0
        ? {
            href: sectionHref(id, "search"),
            // NOT "Find papers", which is what the nav link and the Collect
            // section card are both already called — three links to one
            // destination on one page, and Playwright's strict mode was right
            // to call it ambiguous. Every other next-action here names the
            // ACTION rather than the screen ("Continue screening", "Build the
            // protocol"); this one had drifted into naming the screen.
            label: "Find your first papers",
            why: "The library is empty.",
          }
        : unscreened > 0
          ? {
              href: sectionHref(id, "screen"),
              label: "Continue screening",
              why: `${unscreened} ${unscreened === 1 ? "paper is" : "papers are"} still unscreened.`,
            }
          : !hasProtocol
            ? {
                href: sectionHref(id, "protocol"),
                label: "Build the protocol",
                why: "Nothing can be extracted until there are questions to ask.",
              }
            : awaiting > 0
              ? {
                  href: sectionHref(id, "reconcile"),
                  label: "Reconcile disagreements",
                  why: `${awaiting} ${awaiting === 1 ? "paper has" : "papers have"} two extractions that disagree.`,
                }
              : extracted < included
                ? {
                    href: `${sectionHref(id, "library")}?status=INCLUDED`,
                    label: "Extract from included papers",
                    why: `${included - extracted} of ${included} included ${included - extracted === 1 ? "paper has" : "papers have"} no extraction yet.`,
                  }
                : {
                    href: sectionHref(id, "evidence"),
                    label: "Review the evidence",
                    why: "Everything included has been extracted.",
                  };

  const byGroup = new Map<SectionGroup, typeof sections>();
  for (const section of sections) {
    byGroup.set(section.group, [...(byGroup.get(section.group) ?? []), section]);
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
      <PageHeader
        backHref="/projects"
        backLabel="All projects"
        title={project.title}
        description={project.description ?? undefined}
      />

      <LiveRefresh projectId={id} kind={["screening", "extraction"]} />

      {/* ── Where the project is ─────────────────────────────────────────── */}
      <section aria-labelledby="state">
        <h2 id="state" className="sr-only">
          Current state
        </h2>

        {/* A list of links, not a `dl`. The first draft was a description
            list with an anchor wrapping each `dt`/`dd` pair, which axe caught
            as a serious WCAG 1.3.1 violation: a `dl` may only contain `dt`,
            `dd`, or a `div` grouping them, and an anchor in between breaks the
            association. These are four navigation targets that happen to carry
            numbers, so a list of links is what they actually are. */}
        <ul aria-label="Project totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Papers" value={papers} href={sectionHref(id, "library")} />
          <Stat
            label="Unscreened"
            value={unscreened}
            href={`${sectionHref(id, "library")}?status=IDENTIFIED`}
          />
          <Stat
            label="Included"
            value={included}
            href={`${sectionHref(id, "library")}?status=INCLUDED`}
          />
          <Stat
            label="Excluded"
            value={excluded}
            href={`${sectionHref(id, "library")}?status=EXCLUDED`}
          />
        </ul>

        <Card className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-muted text-fine">Next</p>
            <p className="text-ink text-ui mt-0.5">{next.why}</p>
          </div>
          <ButtonLink href={next.href} variant="primary">
            {next.label}
          </ButtonLink>
        </Card>
      </section>

      {/* ── Where to go, on a screen too narrow for the sidebar ──────────── */}
      <section aria-labelledby="sections" className="lg:hidden">
        <h2 id="sections" className="text-ink text-heading mb-4 font-medium">
          Workspace
        </h2>

        <div className="flex flex-col gap-6">
          {SECTION_GROUPS.map((group) => {
            const inGroup = byGroup.get(group);
            if (!inGroup || inGroup.length === 0) return null;

            return (
              <div key={group}>
                <h3 className="text-muted text-fine mb-2 font-mono tracking-wide uppercase">
                  {group}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {inGroup.map((section) => (
                    <li key={section.slug}>
                      <Link
                        href={sectionHref(id, section.slug)}
                        className="border-rule hover:border-border hover:bg-surface focus-visible:ring-accent block rounded-[--radius-card] border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span className="text-ink text-ui font-medium">
                          {section.label}
                        </span>
                        <span className="text-muted text-fine mt-0.5 block text-pretty">
                          {section.blurb}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-muted text-fine">
        {/* The kind is the reason half the sections exist or do not, so it
            belongs on the overview as an explanation rather than as a label in
            a corner. It is also irreversible, which people should learn now
            rather than when they go looking for the setting. */}
        This is a {kind.replace(/_/g, " ").toLowerCase()} project, which is why{" "}
        {caps.dualExtraction
          ? "reconciliation and PRISMA are available"
          : "there is no reconciliation or PRISMA diagram"}
        . A project&rsquo;s kind is fixed when it is created.
      </p>

      {/* ── Who is on it ─────────────────────────────────────────────────── */}
      <section aria-labelledby="members">
        <h2 id="members" className="text-ink text-heading mb-3 font-medium">
          Members <span className="text-muted font-normal">({members.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.id}>
              <Card className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <div>
                  <p className="text-ink text-ui font-medium">
                    {member.users?.display_name ?? "Unknown"}
                    {member.user_id === user.id && (
                      <span className="text-muted font-normal"> — you</span>
                    )}
                  </p>
                  <p className="text-muted text-fine">{member.users?.email}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-muted text-fine font-mono tracking-wide uppercase">
                    {member.access_role}
                    {member.history_access === "FROM_JOIN" && " · from join"}
                  </p>
                  {canInvite && member.user_id !== user.id && (
                    <MemberRowActions
                      projectId={id}
                      userId={member.user_id}
                      currentRole={member.access_role}
                    />
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {canInvite && (
        <section className="border-border border-t pt-8">
          <h2 className="text-ink text-heading mb-1 font-medium">
            When a paper will not open
          </h2>
          <p className="text-muted text-ui mb-4 text-pretty">
            {/* The problem is universal and the answer is local, which is why
                this is a per-project setting rather than something shipped
                with a default. */}
            Paywalls are part of this work. Point members at your library&rsquo;s link
            resolver, proxy, or interlibrary-loan form and every paper in this project
            will offer it — next to the free open-access copy, when one exists.
          </p>
          <AccessForm
            projectId={project.id}
            url={project.access_help_url}
            label={project.access_help_label}
          />
        </section>
      )}

      {canInvite && (
        <section className="border-border border-t pt-8">
          <h2 className="text-ink text-heading mb-1 font-medium">Add a member</h2>
          <p className="text-muted text-ui mb-4">
            {/* Was: "Email invitations arrive in Phase 1." Phase 1 shipped;
                the sentence did not. Copy that names a phase goes stale the
                moment the phase does, so this says what is true instead. */}
            They need a Porcupine account already — sign them up first, or the invitation
            is refused.
          </p>
          <InviteMemberForm projectId={project.id} isDisconnected={isDisconnected} />
        </section>
      )}
    </main>
  );
}

/**
 * A count that goes somewhere.
 *
 * Every number on this page is a link to the thing it counts. A dashboard
 * figure you cannot click is a dead end that made you read it first.
 */
function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <li>
      <Link
        href={href}
        // The count comes first in the accessible name because "24 unscreened"
        // is what the link does; "Unscreened 24" reads as a table cell.
        aria-label={`${value} ${label.toLowerCase()}`}
        className="border-rule hover:border-border hover:bg-surface focus-visible:ring-accent block rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-muted text-fine block">{label}</span>
        <span className="text-ink text-title mt-1 block font-semibold tabular-nums">
          {value}
        </span>
      </Link>
    </li>
  );
}
