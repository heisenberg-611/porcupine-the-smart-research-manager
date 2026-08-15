/**
 * How to reach a paper the DOI will not open.
 *
 * Paywalls are the everyday reality of this work, and the honest answers are
 * institutional: your library's link resolver, its proxy, an interlibrary-loan
 * form, or writing to the author. Every university has at least one of these
 * and almost nobody remembers the URL, so the project carries it and every
 * paper offers it.
 *
 * Deliberately NOT a built-in shortcut to a shadow library. Routing a whole
 * product's users to unauthorised copies is not a default anyone should ship
 * on another institution's behalf, and a review that cannot say where its
 * papers came from is a review with a hole in its methods section.
 *
 * The open-access copy comes first when there is one, because it is free,
 * legal and immediate — and because the metadata to find it is already in the
 * record.
 */

export interface AccessRoute {
  /** The project's configured resolver, proxy or ILL form. */
  url: string | null;
  label: string | null;
}

export function AccessHelp({
  route,
  doi,
  title,
  oaPdfUrl,
  className = "",
}: {
  route: AccessRoute;
  doi?: string | null | undefined;
  title: string;
  oaPdfUrl?: string | null | undefined;
  className?: string;
}) {
  // Nothing useful to offer, and a disclosure that opens onto nothing is
  // worse than an absent one.
  if (!oaPdfUrl && !route.url) return null;

  return (
    <details className={`text-fine ${className}`}>
      <summary className="text-muted hover:text-ink focus-visible:ring-accent cursor-pointer rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none">
        Can&rsquo;t open this paper?
      </summary>

      <ul className="text-muted mt-2 flex flex-col gap-1.5 pl-1">
        {oaPdfUrl && (
          <li>
            <a
              href={oaPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-4"
            >
              Free open-access copy
            </a>{" "}
            — legally posted by the author or publisher.
          </li>
        )}

        {route.url && (
          <li>
            <a
              href={resolve(route.url, doi)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${route.label ?? "Your institution's access route"} for ${title}`}
              className="text-accent underline underline-offset-4"
            >
              {route.label ?? "Your institution's access route"}
            </a>
            {doi && " — the DOI is passed through."}
          </li>
        )}

        <li>
          {/* The oldest route, and still the one with the best hit rate. */}
          Or write to the corresponding author. Most will send a copy.
        </li>
      </ul>
    </details>
  );
}

/**
 * Append the DOI when the project's URL is a template or a query.
 *
 * Three shapes cover nearly every institution: a literal `{doi}` placeholder,
 * an OpenURL-style query the DOI is appended to, and a proxy prefix the whole
 * doi.org address goes on the end of. Anything else is left exactly as given —
 * a link that goes to the library's front page is still better than nothing,
 * and mangling an unfamiliar URL to look clever would break it.
 */
export function resolve(url: string, doi?: string | null): string {
  if (!doi) return url;
  if (url.includes("{doi}")) {
    // DOIs contain slashes (e.g. 10.1038/nature123). When used in a path segment,
    // the slash must remain unencoded so the resolver routes it correctly.
    const encoded = encodeURIComponent(doi).replace(/%2F/g, "/");
    return url.replace("{doi}", encoded);
  }
  if (url.endsWith("=") || url.endsWith("?") || url.endsWith("&")) {
    return `${url}${encodeURIComponent(doi)}`;
  }
  if (url.endsWith("/")) return `${url}https://doi.org/${doi}`;
  return url;
}

/**
 * Only http(s), and only absolute.
 *
 * The field is typed in by a project admin and rendered as a link for every
 * member, which makes it a stored input someone else clicks — `javascript:`
 * and `data:` are the reason this check exists rather than trusting the form.
 */
export function isSafeAccessUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
