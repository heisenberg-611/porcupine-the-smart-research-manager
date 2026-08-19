import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { must } from "@/lib/supabase/query";
import type { ReaderSection } from "@/lib/reader-document";

/**
 * The document a paper presents for reading and quoting.
 *
 * Shared by the reader and the extraction form, which must show the SAME
 * text: a quote captured against the extraction form's copy is resolved
 * against the reader's copy every time somebody follows an evidence cell back
 * to its source. If the two ever disagreed about what the paper says, every
 * such link would resolve as DRIFTED or BROKEN and the provenance chain — the
 * thing the whole design exists for — would quietly rot.
 *
 * So it is loaded once, here, by both.
 */
export interface PaperDocument {
  /** Pages of the attached PDF, or the abstract alone, or nothing. */
  sections: ReaderSection[];
  /** True when reading the paper itself rather than its abstract. */
  fullText: boolean;
  /** EXTRACTED, FAILED, PENDING — or null when no file is attached. */
  textStatus: string | null;
  file: {
    id: string;
    sizeBytes: number;
    createdAt: string;
    /** Where the bytes are, for the viewer to download with the reader's JWT. */
    storagePath: string;
  } | null;
}

export async function loadPaperDocument(
  supabase: SupabaseClient,
  projectId: string,
  workId: string,
  abstract: string | null,
): Promise<PaperDocument> {
  const file = (await must(
    supabase
      .from("file_objects")
      .select("id, size_bytes, created_at, text_status, storage_path")
      .eq("project_id", projectId)
      .eq("work_id", workId)
      // COMPLETE only. A PENDING row is an upload the app has lost track of;
      // showing it as attached would tell somebody their paper is available to
      // the team when it may not be.
      .eq("upload_state", "COMPLETE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "the attached file",
  )) as {
    id: string;
    size_bytes: number;
    created_at: string;
    text_status: string;
    storage_path: string;
  } | null;

  const pages =
    file && file.text_status === "EXTRACTED"
      ? (((await must(
          supabase
            .from("file_pages")
            .select("page_number, text")
            .eq("file_id", file.id)
            .order("page_number", { ascending: true }),
          "the paper's text",
        )) ?? []) as unknown as Array<{ page_number: number; text: string }>)
      : [];

  const sections: ReaderSection[] =
    pages.length > 0
      ? pages.map((row) => ({ page: row.page_number, text: row.text }))
      : abstract
        ? [{ page: null, text: abstract }]
        : [];

  return {
    sections,
    fullText: pages.length > 0,
    textStatus: file?.text_status ?? null,
    file: file
      ? {
          id: file.id,
          sizeBytes: file.size_bytes,
          createdAt: file.created_at,
          storagePath: file.storage_path,
        }
      : null,
  };
}
