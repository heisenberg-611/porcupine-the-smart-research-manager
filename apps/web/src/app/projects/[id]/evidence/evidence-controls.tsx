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

        <Field label="Contains" id="q">
          <Input id="q" name="q" type="search" defaultValue={filterText ?? ""} />
        </Field>

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

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={exportHref("csv")}>Export CSV</ButtonLink>
        <ButtonLink href={exportHref("xlsx")}>Export Excel</ButtonLink>
        <form action={`/projects/${projectId}/evidence/export-sheets`} method="post">
          <Hidden name="search" value={exportParams.toString()} />
          <Button type="submit" variant="ghost">
            Export to Sheets
          </Button>
        </form>
      </div>
    </div>
  );
}
