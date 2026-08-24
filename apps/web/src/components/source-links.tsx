/**
 * The paper itself, one click away, wherever the paper appears.
 *
 * Until this existed, only search results linked out. The library selected
 * `doi` and `oa_pdf_url` and rendered the open-access status as the plain text
 * " · open access" — the URL was fetched and thrown away. Screening rendered no
 * link at all, and when a record had no abstract it advised the reader to "open
 * the paper first", an action that screen provided no means to take.
 *
 * That is the wrong place to lose the link. The moment someone needs the actual
 * paper is the moment they are deciding about it.
 *
 * Order is preference, not availability: DOI first because it resolves to the
 * publisher's canonical record, then arXiv, then a direct open-access PDF. A
 * record with none of them says so rather than rendering nothing, because an
 * absent link and an absent identifier look identical otherwise and only one of
 * them is worth reporting.
 */

/**
 * `| undefined` explicitly, not just `?`. Under `exactOptionalPropertyTypes`
 * an optional property may be ABSENT but not present-and-undefined, and every
 * caller here reads through `row.works?.doi`, which is exactly that.
 */
export interface WorkIdentifiers {
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  pmid?: string | null | undefined;
  oaPdfUrl?: string | null | undefined;
}

interface Target {
  href: string;
  label: string;
  /** Whether this is the full text rather than a landing page. */
  full?: boolean;
}

export function sourceTargets(work: WorkIdentifiers): Target[] {
  const targets: Target[] = [];
  const seenHrefs = new Set<string>();

  const add = (target: Target) => {
    const trimmed = target.href.trim();
    if (!trimmed || seenHrefs.has(trimmed)) return;
    seenHrefs.add(trimmed);
    targets.push({ ...target, href: trimmed });
  };

  if (work.doi) add({ href: `https://doi.org/${work.doi.trim()}`, label: "DOI" });
  if (work.arxivId) {
    add({ href: `https://arxiv.org/abs/${work.arxivId.trim()}`, label: "arXiv" });
  }
  if (work.pmid) {
    add({
      href: `https://pubmed.ncbi.nlm.nih.gov/${work.pmid.trim()}/`,
      label: "PubMed",
    });
  }
  if (work.oaPdfUrl) add({ href: work.oaPdfUrl.trim(), label: "PDF", full: true });

  return targets;
}

export function SourceLinks({
  work,
  title,
  className = "",
}: {
  work: WorkIdentifiers;
  /**
   * The paper's title, for the accessible name. Without it every link on a
   * fifty-row page announces itself as "DOI", and a screen-reader user tabbing
   * the list hears the same word fifty times.
   */
  title: string;
  className?: string;
}) {
  const targets = sourceTargets(work);

  if (targets.length === 0) {
    return <span className={`text-muted text-fine ${className}`}>No link on record</span>;
  }

  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {targets.map((target, idx) => (
        <a
          key={`${target.label}-${target.href}-${idx}`}
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${target.label} for ${title} (opens in a new tab)`}
          className={`text-fine focus-visible:ring-accent rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none ${
            target.full ? "text-accent" : "text-muted hover:text-ink"
          }`}
        >
          {target.label}
          {/* An outbound marker, once per link. Users get no browser hint that
              a new tab is coming, and losing your place in a 300-row screening
              queue to a surprise tab is worse than the small visual noise. */}
          <span aria-hidden> ↗</span>
        </a>
      ))}
    </span>
  );
}
