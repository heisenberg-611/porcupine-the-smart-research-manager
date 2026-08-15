"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Diagnostic } from "glyphtex-engine";

import type { WorkerRequest, WorkerResponse } from "./protocol";

/**
 * How long a compile may say nothing before it is assumed hung.
 *
 * Generous: a first run fetches and unpacks 24 MB before it typesets, and the
 * timer is reset by every progress message, so this is the budget for one
 * silent stage rather than for the whole compile.
 */
const STALL_SECONDS = 180;
import { WORKER_VERSION } from "./worker-version";

export interface CompileOutcome {
  status: string;
  pdfUrl: string | null;
  diagnostics: Diagnostic[];
  unsupported: string[];
  /** Missing packages found by scanning the source, before TeX ran. */
  preflight: string[];
  /** The raw TeX log. The compiler panel shows it verbatim. */
  log: string | null;
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
  /** The request in flight, so a replaced worker can be handed it again. */
  const lastRequest = useRef<WorkerRequest | null>(null);
  /** Ids already retried once. One rebuild is a fix; two is a loop. */
  const retried = useRef(new Set<number>());
  /** Set by the effect below, so `compile` and the retry share one spawner. */
  const spawn = useRef<() => void>(() => {});
  /** Fires if a compile goes quiet for too long. See `arm`. */
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set by the effect, so `compile` can start the timer it owns. */
  const armWatchdog = useRef<() => void>(() => {});

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CompileOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /*
     * A static file, not a bundler-resolved module URL.
     *
     * `new Worker(new URL("./compile.worker.ts", import.meta.url))` is the
     * webpack idiom and it does not work here: Turbopack treats
     * `new URL(..., import.meta.url)` as an ASSET reference, so the build
     * emitted the raw TypeScript — triple-slash directive, `import type`, bare
     * specifiers and all — to `.next/static/media/compile.worker.<hash>.ts`.
     * The browser could not parse it, the worker never started, and the only
     * symptom was that nothing ever compiled.
     *
     * `scripts/build-latex-worker.mjs` bundles it instead, into the same
     * directory as the TeX assets it loads.
     *
     * The `?v=` is its content hash, and it is load-bearing. An early version
     * of the header rules handed this file `immutable, max-age=31536000` by
     * mistake; a browser will not revalidate an immutable entry, so anyone who
     * loaded the studio during that window kept that worker for a year and no
     * corrected header could reach them. A hash in the URL can.
     */
    /*
     * A stall timer, not a total one.
     *
     * TeX has no notion of giving up: a runaway `\loop` or a pathological
     * macro spins inside the wasm module forever, and because the module is
     * synchronous there is nothing to interrupt it — the worker simply never
     * answers again, and the only remaining escape is reloading the page.
     * Proven the hard way: a two-line document with an unbounded loop hung a
     * headless browser until it was killed.
     *
     * Reset on every progress message rather than counting the whole compile,
     * because a first run legitimately spends a minute fetching and unpacking
     * the TeX distribution. What is being detected is silence.
     */
    const disarm = () => {
      if (watchdog.current) clearTimeout(watchdog.current);
      watchdog.current = null;
    };

    const arm = () => {
      disarm();
      watchdog.current = setTimeout(() => {
        worker.current?.terminate();
        create();
        setBusy(false);
        setStep(null);
        setError(
          `The compile went quiet for ${STALL_SECONDS} seconds and was stopped. ` +
            "That usually means a loop TeX cannot get out of — an unbounded " +
            "\\loop, or a macro that expands into itself. The engine has been " +
            "restarted, so the next compile starts clean.",
        );
      }, STALL_SECONDS * 1000);
    };

    const create = () => {
      const instance = new Worker(`/latex/compile.worker.js?v=${WORKER_VERSION}`, {
        type: "module",
      });
      attach(instance);
      worker.current = instance;
    };

    /**
     * Replace the worker outright, and try the same compile once more.
     *
     * A trap inside the wasm module leaves its session permanently borrowed —
     * every later compile fails identically — and the module's memory cannot
     * be reclaimed from inside, which is exactly the state a large document
     * that ran out of memory leaves behind. Discarding the engine object was
     * not enough: the next instance was built beside the wreckage of the last
     * one. Terminating the worker is what actually frees it.
     *
     * Once. If a fresh engine fails the same way, the document is asking for
     * more than the browser can give and saying so is more use than a third
     * attempt.
     */
    const replaceAndRetry = (request: WorkerRequest) => {
      worker.current?.terminate();
      create();

      retried.current.add(request.id);
      setBusy(true);
      setStep("Restarting the TeX engine");
      arm();
      worker.current?.postMessage(request);
    };

    function attach(instance: Worker) {
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
          const request = lastRequest.current;

          if (data.poisoned && request && !retried.current.has(request.id)) {
            replaceAndRetry(request);
            return;
          }

          setError(
            data.poisoned
              ? `${data.message} A fresh engine was tried and failed the same way — ` +
                  "this document may be larger than the in-browser engine can manage. " +
                  "Splitting it, or cutting the figures down, is the usual fix."
              : data.message,
          );
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
          diagnostics: data.diagnostics,
          unsupported: data.unsupported,
          preflight: data.preflight,
          log: data.log,
          passesRun: data.passesRun,
          message: data.message,
        });
      });

      instance.addEventListener("error", (event) => {
        setBusy(false);
        setStep(null);
        setError(event.message || "The compiler worker stopped.");
      });
    }

    create();
    armWatchdog.current = arm;
    spawn.current = () => {
      worker.current?.terminate();
      create();
    };

    return () => {
      disarm();
      worker.current?.terminate();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const compile = useCallback(
    (
      files: Record<string, string | Uint8Array>,
      entry: string,
      packagesToken: string,
    ) => {
      if (!worker.current) return;

      const id = ++nextId.current;
      activeId.current = id;
      setBusy(true);
      setError(null);
      setStep("Preparing");

      const request: WorkerRequest = {
        kind: "compile",
        id,
        files,
        entry,
        packagesToken,
      };
      lastRequest.current = request;
      armWatchdog.current();
      worker.current.postMessage(request);
    },
    [],
  );

  /**
   * Throw the engine away and start again, on request.
   *
   * The automatic replacement above handles the case the worker notices. This
   * is for the one it does not — an engine that has become slow or stuck
   * rather than crashed — because "it stopped working, restart it" is a thing
   * people reasonably want to do without reloading and losing their place.
   */
  const restart = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    spawn.current();
    retried.current.clear();
    setBusy(false);
    setStep(null);
    setError(null);
  }, []);

  return { compile, busy, step, outcome, error, restart };
}
