"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkerRequest, WorkerResponse } from "./protocol";

export interface CompileOutcome {
  status: string;
  pdfUrl: string | null;
  diagnostics: { severity: string; message: string; line?: number | null }[];
  unsupported: string[];
  passesRun: number;
  message: string | null;
}

/**
 * One compile worker for the life of the page.
 *
 * The worker keeps the wasm module, the unpacked TeX distribution and any
 * installed packs in memory, so the first compile pays for all of it and every
 * one after that is just typesetting. Tearing the worker down between compiles
 * would throw that away, which is what the first version did implicitly by
 * doing everything inline.
 */
export function useCompiler() {
  const worker = useRef<Worker | null>(null);
  const nextId = useRef(0);
  /** The run whose reply we still want. Later ids supersede earlier ones. */
  const activeId = useRef<number | null>(null);
  const objectUrl = useRef<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CompileOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const instance = new Worker(new URL("./compile.worker.ts", import.meta.url), {
      type: "module",
    });

    instance.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      // A reply from a superseded run. Dropping it is what stops an older,
      // slower compile from overwriting the newer PDF.
      if (data.id !== activeId.current) return;

      if (data.kind === "progress") {
        setStep(data.step);
        return;
      }

      setBusy(false);
      setStep(null);

      if (data.kind === "failed") {
        setError(data.message);
        return;
      }

      setError(null);

      // Revoke the previous one. Every compile used to mint a blob URL and
      // never release it, so a long editing session retained a PDF per
      // compile — tens of megabytes by lunchtime.
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = data.pdf
        ? URL.createObjectURL(new Blob([data.pdf], { type: "application/pdf" }))
        : null;

      setOutcome({
        status: data.status,
        pdfUrl: objectUrl.current,
        diagnostics: data.diagnostics as CompileOutcome["diagnostics"],
        unsupported: data.unsupported,
        passesRun: data.passesRun,
        message: data.message,
      });
    });

    instance.addEventListener("error", (event) => {
      setBusy(false);
      setStep(null);
      setError(event.message || "The compiler worker stopped.");
    });

    worker.current = instance;

    return () => {
      instance.terminate();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const compile = useCallback((files: Record<string, string>, entry: string) => {
    if (!worker.current) return;

    const id = ++nextId.current;
    activeId.current = id;
    setBusy(true);
    setError(null);
    setStep("Preparing");

    const request: WorkerRequest = { kind: "compile", id, files, entry };
    worker.current.postMessage(request);
  }, []);

  return { compile, busy, step, outcome, error };
}
