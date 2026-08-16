import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader, Banner } from "@/components/ui";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Extract papers" };

export default async function ExtractDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("title")
    .eq("id", id)
    .single();

  if (pErr || !project) notFound();

  // Fetch extractions
  const { data: extractions, error: extErr } = await supabase
    .from("extractions")
    .select(`
      id,
      status,
      extractor_id,
      project_work_id
    `)
    .eq("project_id", id);

  // Fetch project works
  const { data: projectWorks } = await supabase
    .from("project_works")
    .select(`
      id,
      assignee_id,
      works ( title, published_year )
    `)
    .eq("project_id", id)
    .in("screen_status", ["INCLUDED", "READING", "EXTRACTED", "SYNTHESIZED"]);

  // Fetch members
  const { data: members } = await supabase
    .from("project_members")
    .select(`
      user_id,
      users ( display_name )
    `)
    .eq("project_id", id);

  if (extErr) {
    return (
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
        <PageHeader backHref={`/projects/${id}`} backLabel={project.title} title="Extract papers" />
        <Banner tone="danger">Could not load extractions.</Banner>
      </main>
    );
  }

  // Organize papers by member
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberPapers = new Map<string, Array<{ pw: any; ext: any }>>();
  members?.forEach((m) => memberPapers.set(m.user_id, []));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unassignedWorks: any[] = [];

  for (const pw of projectWorks || []) {
    const exts = extractions?.filter((e) => e.project_work_id === pw.id) || [];
    
    // Everyone who has an extraction gets the paper in their accordion
    if (exts.length > 0) {
      for (const ext of exts) {
        const arr = memberPapers.get(ext.extractor_id) || [];
        if (!arr.some((a) => a.pw.id === pw.id)) {
          arr.push({ pw, ext });
        }
        memberPapers.set(ext.extractor_id, arr);
      }
    }
    
    // AND if it's assigned to someone, they should ALSO have it in their accordion
    // (unless they already have an extraction, which is handled above)
    if (pw.assignee_id) {
      const hasExtracted = exts.some(e => e.extractor_id === pw.assignee_id);
      if (!hasExtracted) {
        const arr = memberPapers.get(pw.assignee_id) || [];
        if (!arr.some((a) => a.pw.id === pw.id)) {
          arr.push({ pw, ext: null });
        }
        memberPapers.set(pw.assignee_id, arr);
      }
    } else if (exts.length === 0) {
      // Only completely unassigned and unextracted papers go to the queue
      unassignedWorks.push(pw);
    }
  }

  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Extraction Dashboard"
        description="Track how many papers each member has extracted. Click on a member to see the exact papers."
      />

      <div className="flex flex-col gap-6">
        {members?.map((member) => {
          const papers = memberPapers.get(member.user_id) || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const displayName = (member.users as any)?.display_name || "Unknown member";
          
          if (papers.length === 0) return null;

          return (
            <details key={member.user_id} className="group border border-border bg-surface rounded-xl shadow-sm transition-all open:ring-1 open:ring-border/50">
              <summary className="flex items-center justify-between p-5 cursor-pointer select-none hover:bg-canvas/50 transition-colors rounded-xl group-open:rounded-b-none group-open:bg-canvas/30">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-base ring-1 ring-accent/20">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-ink text-lg font-semibold">{displayName}</h2>
                    <p className="text-muted text-sm mt-0.5">Team Member</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-ink text-sm font-semibold bg-canvas shadow-sm border border-border/80 px-3 py-1.5 rounded-full flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    {papers.length} {papers.length === 1 ? "paper" : "papers"}
                  </span>
                  <svg className="w-5 h-5 text-muted transition-transform duration-300 group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              
              <div className="border-t border-border bg-canvas/30 px-5 py-5 rounded-b-xl">
                <ul className="flex flex-col gap-3">
                  {papers.map(({ pw, ext }) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const work = pw.works as any;
                    const title = work?.title || "Unknown paper";
                    const year = work?.published_year || "";
                    
                    return (
                      <li key={pw.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface border border-border/60 p-4 rounded-xl hover:border-accent/40 hover:shadow-sm transition-all duration-200">
                        <div className="flex-1 pr-4">
                          <p className="text-ink font-medium leading-snug text-pretty">
                            {title}
                          </p>
                          <div className="flex items-center gap-3 mt-2">
                            {year && <span className="bg-canvas border border-border/60 px-2 py-0.5 rounded font-mono text-xs text-muted">{year}</span>}
                            {ext ? (
                              <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md ${ext.status === 'SUBMITTED' ? 'bg-accent/10 text-accent border border-accent/20' : 'bg-surface border border-border text-ui'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${ext.status === 'SUBMITTED' ? 'bg-accent' : 'bg-muted/50'}`} />
                                {ext.status === 'SUBMITTED' ? 'Completed' : 'Drafting'}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-canvas border border-border text-muted">
                                <span className="w-1.5 h-1.5 rounded-full bg-muted/30" />
                                Assigned, Not Started
                              </span>
                            )}
                          </div>
                        </div>
                        {ext ? (
                          ext.status === 'SUBMITTED' ? (
                            <Link
                              href={`/projects/${id}/evidence?q=${encodeURIComponent(title)}`}
                              className="shrink-0 inline-flex items-center justify-center min-h-9 px-4 rounded-lg bg-surface border border-border text-ink text-sm font-medium hover:bg-canvas hover:-translate-y-0.5 transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none shadow-sm"
                            >
                              View in Evidence
                            </Link>
                          ) : (
                            <Link
                              href={`/projects/${id}/extract/${pw.id}`}
                              className="shrink-0 inline-flex items-center justify-center min-h-9 px-4 rounded-lg bg-surface border border-border text-ink text-sm font-medium hover:bg-canvas hover:-translate-y-0.5 transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none shadow-sm"
                            >
                              Continue Drafting
                            </Link>
                          )
                        ) : (
                          <Link
                            href={`/projects/${id}/extract/${pw.id}`}
                            className="shrink-0 inline-flex items-center justify-center min-h-9 px-4 rounded-lg bg-surface border border-border text-ink text-sm font-medium hover:bg-canvas hover:-translate-y-0.5 transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none shadow-sm"
                          >
                            Start Extraction
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          );
        })}

        {unassignedWorks.length > 0 && (
          <details className="group border border-border bg-surface rounded-xl shadow-sm transition-all open:ring-1 open:ring-border/50">
            <summary className="flex items-center justify-between p-5 cursor-pointer select-none hover:bg-canvas/50 transition-colors rounded-xl group-open:rounded-b-none group-open:bg-canvas/30">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-muted/10 text-muted flex items-center justify-center font-bold text-base ring-1 ring-muted/20">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-ink text-lg font-semibold">Unassigned Papers</h2>
                  <p className="text-muted text-sm mt-0.5">Available for extraction</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-muted text-sm font-semibold bg-canvas shadow-sm border border-border/80 px-3 py-1.5 rounded-full flex items-center gap-2">
                  {unassignedWorks.length} pending
                </span>
                <svg className="w-5 h-5 text-muted transition-transform duration-300 group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </summary>
            
            <div className="border-t border-border bg-canvas/30 px-5 py-5 rounded-b-xl">
              <ul className="flex flex-col gap-3">
                {unassignedWorks.map((pw) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const work = pw.works as any;
                  const title = work?.title || "Unknown paper";
                  const year = work?.published_year || "";
                  
                  return (
                    <li key={pw.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface border border-border/60 p-4 rounded-xl hover:border-accent/40 hover:shadow-sm transition-all duration-200">
                      <div className="flex-1 pr-4">
                        <p className="text-ink font-medium leading-snug text-pretty">
                          {title}
                        </p>
                        {year && (
                          <div className="mt-2">
                            <span className="bg-canvas border border-border/60 px-2 py-0.5 rounded font-mono text-xs text-muted">{year}</span>
                          </div>
                        )}
                      </div>
                      <Link
                        href={`/projects/${id}/extract/${pw.id}`}
                        className="shrink-0 inline-flex items-center justify-center min-h-9 px-4 rounded-lg bg-accent text-accent-ink text-sm font-medium hover:brightness-110 hover:-translate-y-0.5 shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none"
                      >
                        Start Extraction
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        )}
        
        {members?.every(m => (memberPapers.get(m.user_id) || []).length === 0) && unassignedWorks.length === 0 && (
          <div className="border-rule border-dashed border rounded-xl p-10 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-muted/10 text-muted flex items-center justify-center mb-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-ink text-lg font-semibold mb-2">No papers to extract yet</h2>
            <p className="text-muted text-ui max-w-sm">
              Papers will appear here once they have been screened and marked as "Included" in the screening phase.
            </p>
            <Link
              href={`/projects/${id}/screen`}
              className="mt-6 inline-flex items-center justify-center min-h-11 px-6 rounded-full bg-surface border border-border text-ink font-medium hover:bg-canvas transition-colors focus-visible:ring-2 focus-visible:ring-accent outline-none"
            >
              Go to Screening
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
