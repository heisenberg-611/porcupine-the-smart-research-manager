import Link from "next/link";

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

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <form
        action={`/projects/${projectId}/evidence`}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <Hidden name="sort" value={sort} />
        <Hidden name="dir" value={dir} />

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
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={exportHref("csv")}>Export CSV</ButtonLink>
        <ButtonLink href={exportHref("xlsx")}>Export Excel</ButtonLink>
        {children}
      </div>
    </div>
  );
}
