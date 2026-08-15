/**
 * The messages between the page and the compile worker.
 *
 * Kept in its own module so both sides import the same declarations and a
 * change to one is a type error in the other.
 */

import type { Diagnostic } from "glyphtex-engine";

export type CompileRequestMessage = {
  kind: "compile";
  /** Echoed back, so a stale reply from a superseded run can be dropped. */
  id: number;
  /** Every file in the project, not only the entry point. */
  files: Record<string, string>;
  entry: string;
};

export type WorkerRequest = CompileRequestMessage;

/** Progress, so a fifteen-second first run is not a frozen button. */
export type ProgressMessage = {
  kind: "progress";
  id: number;
  step: string;
};

export type CompiledMessage = {
  kind: "compiled";
  id: number;
  status: string;
  /** Transferred, not copied — a PDF is megabytes. */
  pdf: ArrayBuffer | null;
  diagnostics: Diagnostic[];
  /**
   * Files no installed pack provides, after every round of installing.
   *
   * NOT the same as "things that broke the document". TeX probes for optional
   * files constantly — `lstmisc0.sty` and friends — and carries on without
   * them, so this list is raw material for the UI rather than a list of
   * errors. The compiler panel decides which of these TeX actually complained
   * about by cross-referencing the diagnostics.
   */
  unsupported: string[];
  /** The raw `<jobname>.log`. The thing a LaTeX user actually reads. */
  log: string | null;
  passesRun: number;
  message: string | null;
};

export type FailedMessage = {
  kind: "failed";
  id: number;
  message: string;
};

export type WorkerResponse = ProgressMessage | CompiledMessage | FailedMessage;
