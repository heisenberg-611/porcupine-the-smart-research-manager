import {
  resolveAnchor,
  type AnchorSelector,
  type Resolution,
} from "@Porcupine/anchoring";

/**
 * One readable, annotatable piece of a paper.
 *
 * Before the file pipeline a paper was a single blob of text — its abstract —
 * and an anchor resolved against that one string. A PDF is pages, and the
 * anchoring engine has always carried a page number for exactly this. So the
 * reader now takes a list, and an abstract is simply the list of length one.
 */
export interface ReaderSection {
  /** 1-based page, or null for the abstract, which is not a page of anything. */
  page: number | null;
  text: string;
}

export interface PlacedResolution {
  /** Index into the sections array, or null when the passage is nowhere. */
  sectionIndex: number | null;
  resolution: Resolution;
}

/**
 * Find where a stored anchor lives in the document as it is NOW.
 *
 * Three passes, in decreasing order of trust, and the order is the point.
 *
 * 1. The page the anchor recorded. Almost always right, and checking it first
 *    means the common case costs one resolution rather than one per page.
 *
 * 2. An exact match anywhere. This is what makes attaching a PDF to a paper
 *    that already has annotations survivable: every one of those anchors was
 *    captured against the abstract and has no page at all, and an abstract is
 *    normally reproduced on the paper's first page. Without this pass, the act
 *    of uploading a PDF would turn a colleague's highlights into a wall of
 *    "lost in this document" — which would be a lie, since nothing was lost.
 *
 * 3. A drifted match anywhere. Weakest, so it is only accepted once no exact
 *    match exists anywhere in the document; otherwise a fuzzy hit on page 30
 *    could outrank the real passage on page 2.
 *
 * BROKEN is the honest answer when all three fail, and it is reported rather
 * than smoothed over — the reason the engine returns a status instead of an
 * offset.
 */
export function resolveInSections(
  selector: AnchorSelector,
  sections: ReaderSection[],
): PlacedResolution {
  if (sections.length === 0) {
    return {
      sectionIndex: null,
      resolution: { status: "BROKEN", reason: "the document is empty" },
    };
  }

  // `!== undefined` rather than `!= null`: AnchorSelector types `page` as
  // `number | undefined`, and every caller normalises the database's NULL to
  // undefined on the way in, so there is nothing else to catch.
  if (selector.page !== undefined) {
    const index = sections.findIndex((section) => section.page === selector.page);
    if (index >= 0) {
      const resolution = resolveAnchor(selector, sections[index]!.text);
      if (resolution.status !== "BROKEN") return { sectionIndex: index, resolution };
    }
  }

  // Resolved once and kept: pass 3 needs the same answers pass 2 computed, and
  // resolving every section twice over a 300-page document is the difference
  // between a reader that opens and one that hangs.
  const attempts = sections.map((section) => resolveAnchor(selector, section.text));

  const exact = attempts.findIndex((r) => r.status === "OK");
  if (exact >= 0) return { sectionIndex: exact, resolution: attempts[exact]! };

  const drifted = attempts.findIndex((r) => r.status === "DRIFTED");
  if (drifted >= 0) return { sectionIndex: drifted, resolution: attempts[drifted]! };

  return {
    sectionIndex: null,
    resolution: attempts[0] ?? { status: "BROKEN", reason: "the passage is gone" },
  };
}

/**
 * What the reader should say about this paper, in exactly one sentence.
 *
 * Not three independent conditions, which is what this replaced and why it
 * contradicted itself: the "no text we could read" banner asserted that the
 * abstract was shown below, the empty state asserted that no PDF was attached,
 * and a paper with a scanned PDF and no abstract triggered both — each of them
 * wrong in a different direction. A fourth case, an upload whose extraction
 * never ran, produced no message at all.
 *
 * Deriving one notice from the whole situation makes those combinations
 * impossible to write rather than merely fixed today.
 */
export type ReadingNotice = {
  tone: "info" | "danger";
  /** Bold lead-in, when the situation needs naming. */
  headline: string | null;
  body: string;
};

export function describeReading(input: {
  hasFile: boolean;
  /** EXTRACTED | FAILED | PENDING | NOT_APPLICABLE, or null with no file. */
  textStatus: string | null;
  /** Pages of extracted text actually available. */
  pageCount: number;
  hasAbstract: boolean;
}): ReadingNotice {
  const { hasFile, textStatus, pageCount, hasAbstract } = input;

  if (hasFile && textStatus === "EXTRACTED" && pageCount > 0) {
    return {
      tone: "info",
      headline: null,
      body: `Reading the full text — ${pageCount} ${pageCount === 1 ? "page" : "pages"} from the attached PDF.`,
    };
  }

  if (hasFile && textStatus === "FAILED") {
    return {
      tone: "danger",
      headline: "This PDF has no text we could read.",
      body: hasAbstract
        ? "That usually means it is a scan rather than a digital document. The file is attached and can be downloaded, and the abstract below can still be annotated."
        : "That usually means it is a scan rather than a digital document. The file is attached and can be downloaded, but this record has no abstract either — so there is nothing to annotate here yet. Remove the PDF and attach a text-based copy if you have one.",
    };
  }

  if (hasFile) {
    /*
     * Attached, but its text never arrived.
     *
     * The upload completed and the extraction did not — usually a tab closed
     * while it was still running. Nothing revisits it: the reconciler settles
     * uploads, not text. Saying so and pointing at the remedy is the whole
     * remedy, because re-attaching does work.
     */
    return {
      tone: "danger",
      headline: "This PDF's text was never extracted.",
      body: hasAbstract
        ? "The upload finished but reading the pages did not — usually a tab closed too early. Remove the file and attach it again to read the whole paper. The abstract below is shown in the meantime."
        : "The upload finished but reading the pages did not — usually a tab closed too early. Remove the file and attach it again to read it here.",
    };
  }

  if (hasAbstract) {
    return {
      tone: "info",
      headline: null,
      body: "Reading the abstract. Attach the PDF to read and annotate the whole paper.",
    };
  }

  return {
    tone: "info",
    headline: "Nothing to read here yet.",
    body: "This record has no abstract and no attached PDF. Attach the paper above and its pages appear here.",
  };
}
