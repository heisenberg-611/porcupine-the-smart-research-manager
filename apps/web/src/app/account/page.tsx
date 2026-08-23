import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Banner, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

import { DELETION_GRACE_DAYS } from "./deletion";
import { CancelDeletionButton, DeleteAccountForm } from "./delete-account-form";
import { getDeletionState } from "./actions";

export const metadata: Metadata = { title: "Your account" };

/**
 * Your details, and the one irreversible control in the product.
 *
 * A page rather than a section of the dashboard, because the danger zone needs
 * room to explain itself and nothing on a dashboard should be able to end an
 * account by being clicked on the way to something else.
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const state = await getDeletionState();

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <PageHeader
        backHref="/dashboard"
        backLabel="Dashboard"
        title="Your account"
        description="What this instance knows about you, and how to leave."
      />

      {!state.ok && <Banner tone="danger">{state.error}</Banner>}

      <section aria-labelledby="details" className="flex flex-col gap-3">
        <h2 id="details" className="text-ink text-title font-serif">
          Details
        </h2>
        <dl className="border-border/70 divide-border/60 bg-raised/70 divide-y rounded-2xl border overflow-hidden shadow-xs">
          <div className="flex flex-wrap justify-between gap-2 p-5">
            <dt className="text-muted text-ui font-medium">Email</dt>
            <dd className="text-ink text-ui font-mono">{user.email}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 p-5">
            <dt className="text-muted text-ui font-medium">Sign-in</dt>
            <dd className="text-ink text-ui">
              A six-digit code, emailed. There is no password to change.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="export" className="flex flex-col gap-3">
        <h2 id="export" className="text-ink text-title font-serif">
          Take your work with you
        </h2>
        <p className="text-ink-soft measure text-ui text-pretty">
          Every project&rsquo;s evidence table exports to CSV and Excel from its own
          Evidence screen, with protocol question keys as column headers so a script keeps
          working. Do that <strong>before</strong> deleting anything: the export is per
          project, and a deleted account is no longer a member of any of them.
        </p>
        <p>
          <Link href="/projects" className="text-accent underline underline-offset-4 font-medium">
            Your projects
          </Link>
        </p>
      </section>

      <section
        aria-labelledby="danger"
        className="border-danger/30 bg-danger-soft/40 flex flex-col gap-5 rounded-2xl border p-6 shadow-xs"
      >
        <h2 id="danger" className="text-ink text-title font-serif">
          Delete your account
        </h2>

        {state.ok && state.data.scheduledFor ? (
          <ScheduledNotice scheduledFor={state.data.scheduledFor} />
        ) : (
          <>
            <div className="text-ink-soft text-ui measure flex flex-col gap-3 text-pretty">
              <p>
                Your email address, display name and encryption keys are erased. Your
                devices and your copies of every project key are deleted, and you are
                removed from every project you are in.
              </p>
              <p>
                {/*
                  Said plainly, and first, because it is the part people are most
                  likely to feel misled about later. The alternative is deleting
                  the decisions, which would take a colleague's PRISMA diagram
                  with them.
                */}
                <strong>
                  Your screening decisions, extractions and annotations stay.
                </strong>{" "}
                They are attributed to &ldquo;Former member&rdquo; rather than to you. A
                review has to be able to answer &ldquo;who excluded these forty
                papers&rdquo; a year later, and that answer cannot be deleted by one of
                the people who made it.
              </p>
              <p>
                Messages you have written stay too, and stay encrypted. Nobody — including
                you — can read them again once your keys are gone.
              </p>
              <p>
                {/*
                  The window is real and the code says so; see getKeyState, which
                  computes `rotationNeeded` rather than rotating. Promising more
                  than the server can do is the thing this codebase keeps deleting.
                */}
                Each project you leave is flagged for key rotation, which happens when one
                of its admins next unlocks it in a browser. Until then, somebody who kept
                a copy of a project key could still read new messages in it. The server
                cannot rotate a key it does not hold.
              </p>
            </div>

            {state.ok && state.data.blockers.length > 0 && (
              <div className="border-danger/30 bg-raised rounded-xl border p-4 shadow-xs">
                <p className="text-ink text-ui font-medium">
                  {state.data.blockers.length === 1
                    ? "One project would be left without an owner."
                    : `${state.data.blockers.length} projects would be left without an owner.`}
                </p>
                <p className="text-muted text-fine mt-1 text-pretty">
                  Make somebody else an owner first. Deleting your account will be refused
                  until you have.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {state.data.blockers.map((blocker) => (
                    <li key={blocker.id} className="text-ui">
                      <Link
                        href={`/projects/${blocker.id}`}
                        className="text-accent underline underline-offset-4"
                      >
                        {blocker.title}
                      </Link>
                      <span className="text-muted">
                        {" "}
                        · {blocker.otherMembers}{" "}
                        {blocker.otherMembers === 1 ? "other member" : "other members"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DeleteAccountForm
              email={user.email ?? ""}
              graceDays={DELETION_GRACE_DAYS}
              blocked={state.ok && state.data.blockers.length > 0}
            />
          </>
        )}
      </section>
    </main>
  );
}

/**
 * The waiting period, with the date spelled out.
 *
 * In UTC, and labelled as such. A deletion date rendered in the reader's zone
 * would shift by a day for half the world against the moment the purge job
 * actually uses, and a date that is wrong by a day is exactly the kind of
 * detail somebody points at afterwards.
 */
function ScheduledNotice({ scheduledFor }: { scheduledFor: string }) {
  const when = new Date(scheduledFor).toLocaleDateString(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink text-body text-pretty">
        This account is scheduled for deletion on <strong>{when}</strong> (UTC).
      </p>
      <p className="text-ink-soft measure text-ui text-pretty">
        Nothing has happened yet. You are still a member of your projects and everything
        still works — cancelling costs you nothing, which is the entire reason the wait
        exists.
      </p>
      <CancelDeletionButton />
    </div>
  );
}
