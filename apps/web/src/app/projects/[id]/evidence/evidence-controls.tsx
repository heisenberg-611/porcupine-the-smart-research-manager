import Link from "next/link";

import { MarkdownViewerDialog } from "@/components/markdown-viewer-dialog";
import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Hidden,
  Input,
  Select,
} from "@/components/ui";

/**
 * Filter, group and export controls.
 *
 * A plain GET form, with no client JavaScript at all. Submitting navigates to
 * a URL carrying the whole query, which is what makes a filtered evidence
 * table something you can send to your supervisor. It also means the controls
 * work before hydration and on a bad connection, which matters more here than
 * live filtering would: this page is used for hours at a time.
 *
 * Sorting is NOT here — each column header is its own sort link, which is
 * where people reach for it.
 */
export function EvidenceControls({
  projectId,
  fields,
  sort,
  dir,
  filterKey,
  filterText,
  groupKey,
  onlyIncomplete,
  columns,
  protocols,
  protocolId,
  children,
}: {
  projectId: string;
  fields: Array<{ key: string; label: string }>;
  sort: string;
  dir: string;
  filterKey: string | null;
  filterText: string | null;
  groupKey: string | null;
  onlyIncomplete: boolean;
  columns: string[] | null;
  /** Every protocol in this project, with how much has been extracted against it. */
  protocols: Array<{
    id: string;
    name: string;
    version: number;
    isActive: boolean;
    extractions: number;
  }>;
  /** The one being shown. */
  protocolId: string;
  /**
   * The column chooser, rendered beside the export buttons.
   *
   * Passed in rather than imported here because it is a client component with
   * its own popover, and this file is deliberately server-rendered with no
   * JavaScript. A slot keeps that true while letting the two of them share a
   * row — they were stacked, and the filters, the exports and the chooser
   * between them pushed the first row of actual data 610px down a 1000px
   * screen. More than half the page was chrome.
   */
  children?: React.ReactNode;
}) {
  // The current sort rides along as hidden inputs, or filtering would silently
  // throw away the column someone had just sorted by.
  const exportParams = new URLSearchParams();
  // The export is the table. If it resolved a different protocol it would hand
  // back different columns for the same URL.
  exportParams.set("protocol", protocolId);
  if (sort !== "title") exportParams.set("sort", sort);
  if (dir !== "asc") exportParams.set("dir", dir);
  if (filterKey) exportParams.set("fk", filterKey);
  if (filterText) exportParams.set("q", filterText);
  if (groupKey) exportParams.set("group", groupKey);
  if (onlyIncomplete) exportParams.set("incomplete", "1");
  // The column selection too. Without this, narrowing the table to five fields
  // and clicking Export CSV silently hands back all twenty — the export
  // disagreeing with the screen it came from, which is the exact failure
  // sharing the read path was meant to prevent.
  if (columns) exportParams.set("cols", columns.join(","));

  const exportHref = (format: string) => {
    const params = new URLSearchParams(exportParams);
    params.set("format", format);
    return `/projects/${projectId}/evidence/export?${params.toString()}`;
  };

  /*
   * Switching protocol drops every field-keyed parameter.
   *
   * `cols`, `fk`, `group` and a `field:` sort all name protocol FIELD KEYS, and
   * the keys of one protocol mean nothing in another — at best they are
   * dropped and the table looks arbitrarily narrowed, at worst two protocols
   * share a key and the column silently shows a different question's answers.
   * Sort direction, paging and the incomplete filter carry over, because those
   * are about rows rather than columns.
   */
  const protocolHref = (id: string) => {
    const params = new URLSearchParams();
    params.set("protocol", id);
    if (dir !== "asc") params.set("dir", dir);
    if (onlyIncomplete) params.set("incomplete", "1");
    return `/projects/${projectId}/evidence?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <form
        action={`/projects/${projectId}/evidence`}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <Hidden name="sort" value={sort} />
        <Hidden name="dir" value={dir} />
        {/* Filtering must not silently move you back to the default protocol. */}
        <Hidden name="protocol" value={protocolId} />

        {/* `flex-1 basis-44` on each field, so the three of them are the same
            width instead of sizing to their own contents — "Contains" was
            visibly narrower than the two selects beside it, which reads as an
            alignment bug rather than a choice. */}
        <div className="flex-1 basis-44">
          <Field label="Filter column" id="fk">
            <Select id="fk" name="fk" defaultValue={filterKey ?? ""}>
              <option value="">Any column</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex-1 basis-44">
          <Field label="Contains" id="q">
            <Input id="q" name="q" type="search" defaultValue={filterText ?? ""} />
          </Field>
        </div>

        <div className="flex-1 basis-44">
          <Field label="Group by" id="group">
            <Select id="group" name="group" defaultValue={groupKey ?? ""}>
              <option value="">Nothing</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="text-ui text-ink-soft flex min-h-11 items-center gap-2">
          <Checkbox name="incomplete" value="1" defaultChecked={onlyIncomplete} />
          Incomplete only
        </label>

        <Button type="submit">Apply</Button>

        {(filterText || groupKey || onlyIncomplete) && (
          <Link
            href={`/projects/${projectId}/evidence`}
            className="text-ui text-muted hover:text-ink inline-flex min-h-11 items-center underline-offset-2 hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      {/*
        CSV and Excel, and no "Export to Sheets".
        
        That button existed and did not work. It POSTed to a route that reads
        `session.provider_token`, which Supabase populates only in the moments
        after a Google OAuth sign-in and never persists — so for anybody who
        signed in with an emailed code, which is the default and the documented
        path, it returned a plain-text 403 with no styling and no way back.
        A button that fails for most people is worse than an absent one.
      */}
      {/*
        Only when there is more than one. A picker offering a single option is
        a control that answers a question nobody has, and it would appear on
        every project in the product.
      */}
      {protocols.length > 1 && (
        <fieldset className="basis-full">
          <legend className="text-muted text-fine">Protocol</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {protocols.map((p) => {
              const current = p.id === protocolId;
              return (
                <Link
                  key={p.id}
                  href={protocolHref(p.id)}
                  aria-current={current ? "true" : undefined}
                  className={`text-ui focus-visible:ring-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none ${
                    current
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-border text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  <span>
                    {p.name} v{p.version}
                  </span>
                  {/*
                    The count needs a word attached to it. Visually the gap
                    between the spans says "137 of them"; to a screen reader
                    the two run together as "Data extraction form v1137",
                    which reads as a version number nobody has.
                  */}
                  <span className="text-fine text-muted font-mono">
                    {p.extractions}
                    <span className="sr-only"> extractions</span>
                  </span>
                  {!p.isActive && <span className="text-fine text-muted">retired</span>}
                </Link>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <MarkdownViewerDialog
          fetchUrl={exportHref("md")}
          title="Evidence Markdown Preview"
          filename={`evidence-protocol-v${protocols.find((p) => p.id === protocolId)?.version ?? 1}`}
          triggerLabel="Preview Markdown"
          triggerVariant="ghost"
        />
        <ButtonLink href={exportHref("csv")}>Export CSV</ButtonLink>
        <ButtonLink href={exportHref("xlsx")}>Export Excel</ButtonLink>
        <ButtonLink href={exportHref("md")}>Download .md</ButtonLink>
        {children}
      </div>
    </div>
  );
}
