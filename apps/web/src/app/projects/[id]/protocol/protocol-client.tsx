"use client";

import {
  FIELD_TYPES,
  fieldTypeLabel,
  needsOptions,
  PROTOCOL_TEMPLATES,
  type FieldType,
} from "@Porcupine/shared";
import { useState, useTransition } from "react";

import { Button, Checkbox, Field, Input, Radio, Select, Textarea } from "@/components/ui";

import {
  addField,
  createNewVersion,
  createProtocol,
  deleteField,
  moveField,
} from "./actions";

export interface ProtocolField {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  requiresAnchor: boolean;
  helpText: string | null;
  options: string[];
  answerCount: number;
}

export interface Protocol {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
  fields: ProtocolField[];
  extractionCount: number;
}

/**
 * The protocol builder.
 *
 * A protocol is the set of FIELDS recorded for every paper, so the cost of
 * getting it wrong is paid once per paper. The editor's job is to make the
 * consequences visible before they are paid — which is why every field shows
 * how many answers it already has, and why a field with answers cannot be
 * quietly deleted.
 */
export function ProtocolClient({
  projectId,
  protocols,
  canEdit,
}: {
  projectId: string;
  protocols: Protocol[];
  canEdit: boolean;
}) {
  const active = protocols.find((p) => p.isActive) ?? protocols[0];

  if (!active) {
    return canEdit ? (
      <NewProtocol projectId={projectId} />
    ) : (
      <p className="text-muted text-ui">
        No protocol yet. An owner or admin sets up the questions recorded for every paper.
      </p>
    );
  }

  return (
    <ProtocolEditor
      projectId={projectId}
      protocol={active}
      olderVersions={protocols.filter((p) => p.id !== active.id)}
      canEdit={canEdit}
    />
  );
}

function NewProtocol({ projectId }: { projectId: string }) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("pico-rct");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const template = PROTOCOL_TEMPLATES.find((t) => t.id === templateId);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const response = await createProtocol({ projectId, name, templateId });
      if (!response.ok) setError(response.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        label="Protocol name"
        id="name"
        hint="What this set of questions is called — a reader of your methods section will see it."
      >
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Data extraction"
          required
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-ink text-ui font-medium">Start from</legend>
        {/* Radio buttons rather than a select: there are five choices and the
            description matters as much as the name, so hiding four of them
            behind a closed dropdown costs more than the space it saves. */}
        {PROTOCOL_TEMPLATES.map((t) => (
          <label
            key={t.id}
            className="border-border hover:bg-surface flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <Radio
              name="template"
              value={t.id}
              checked={templateId === t.id}
              onChange={() => setTemplateId(t.id)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="text-ink text-ui block font-medium">{t.name}</span>
              <span className="text-muted text-fine block text-pretty">
                {t.description}
              </span>
              <span className="text-muted text-fine mt-1 block">
                {t.fields.length === 0
                  ? "No questions — you add them"
                  : `${t.fields.length} questions`}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {template && template.fields.length > 0 && (
        <details className="border-border rounded-lg border p-3">
          <summary className="text-ink text-ui cursor-pointer font-medium">
            What {template.name} records
          </summary>
          <ul className="text-muted text-fine mt-2 space-y-1">
            {template.fields.map((f) => (
              <li key={f.label}>
                {f.label} — {fieldTypeLabel(f.type)}
                {f.required && " · required"}
                {f.requiresAnchor && " · needs a quoted source"}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Button type="submit" disabled={pending || !name.trim()}>
        {pending ? "Creating…" : "Create protocol"}
      </Button>

      {error && (
        <p role="alert" className="text-danger text-ui">
          {error}
        </p>
      )}
    </form>
  );
}

function ProtocolEditor({
  projectId,
  protocol,
  olderVersions,
  canEdit,
}: {
  projectId: string;
  protocol: Protocol;
  olderVersions: Protocol[];
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const response = await fn();
      if (response.ok) setStatus(done ?? null);
      else setError(response.error ?? "Something went wrong.");
    });
  }

  const locked = protocol.extractionCount > 0;

  return (
    <div className="space-y-6">
      <div className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-ink text-ui font-medium">
            {protocol.name}{" "}
            <span className="text-muted font-normal">v{protocol.version}</span>
          </p>
          <p className="text-muted text-fine">
            {protocol.fields.length}{" "}
            {protocol.fields.length === 1 ? "question" : "questions"}
            {protocol.extractionCount > 0 &&
              ` · ${protocol.extractionCount} ${protocol.extractionCount === 1 ? "extraction" : "extractions"} recorded`}
          </p>
        </div>

        {canEdit && locked && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(
                () => createNewVersion({ projectId, protocolId: protocol.id }),
                "New version created. The previous one is kept as it was.",
              )
            }
          >
            Start version {protocol.version + 1}
          </Button>
        )}
      </div>

      {locked && canEdit && (
        <p className="border-border text-muted text-ui rounded-lg border border-dashed p-3 text-pretty">
          {/* Said before they try, not after it fails. */}
          This protocol has answers recorded against it. Questions that have been answered
          can no longer be renamed or removed — a new version copies the questions and
          leaves the existing rows answering the ones they were actually asked.
        </p>
      )}

      {/* Named for the same reason the import preview is: "the first list on
          the page" stopped being this one when the project nav arrived. */}
      <ol aria-label="Protocol questions" className="space-y-2">
        {protocol.fields.map((field, index) => (
          <li key={field.id} className="border-border rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink text-ui font-medium">
                  {field.label}
                  {field.required && <span className="text-muted"> · required</span>}
                </p>
                <p className="text-muted text-fine mt-0.5">
                  {fieldTypeLabel(field.type)}
                  {" · "}
                  <code>{field.key}</code>
                  {field.requiresAnchor && " · needs a quoted source"}
                  {field.answerCount > 0 &&
                    ` · ${field.answerCount} ${field.answerCount === 1 ? "answer" : "answers"}`}
                </p>
                {field.helpText && (
                  <p className="text-muted text-fine mt-1 text-pretty">
                    {field.helpText}
                  </p>
                )}
                {field.options.length > 0 && (
                  <p className="text-muted text-fine mt-1">{field.options.join(" · ")}</p>
                )}
              </div>

              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    aria-label={`Move ${field.label} up`}
                    disabled={pending || index === 0}
                    onClick={() =>
                      run(() =>
                        moveField({ projectId, fieldId: field.id, direction: "up" }),
                      )
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Move ${field.label} down`}
                    disabled={pending || index === protocol.fields.length - 1}
                    onClick={() =>
                      run(() =>
                        moveField({ projectId, fieldId: field.id, direction: "down" }),
                      )
                    }
                  >
                    ↓
                  </Button>

                  {/* Two-step inline confirm rather than a modal dialog. A
                      modal needs a focus trap and escape handling to be
                      correct, and this is both simpler and harder to trigger
                      by accident than a dialog whose default button is OK. */}
                  {confirming === field.id ? (
                    <>
                      <Button
                        variant="danger"
                        disabled={pending}
                        onClick={() => {
                          setConfirming(null);
                          run(
                            () => deleteField({ projectId, fieldId: field.id }),
                            `Removed "${field.label}".`,
                          );
                        }}
                      >
                        Confirm
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${field.label}`}
                      disabled={pending}
                      onClick={() => setConfirming(field.id)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {protocol.fields.length === 0 && (
        <p className="text-muted text-ui">
          No questions yet. Add the first question this review asks of every paper.
        </p>
      )}

      {canEdit &&
        (adding ? (
          <AddField
            projectId={projectId}
            protocolId={protocol.id}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button onClick={() => setAdding(true)}>Add a question</Button>
        ))}

      <div aria-live="polite">
        {status && <p className="text-muted text-ui">{status}</p>}
        {error && (
          <p role="alert" className="text-danger text-ui">
            {error}
          </p>
        )}
      </div>

      {olderVersions.length > 0 && (
        <details className="border-border rounded-lg border p-3">
          <summary className="text-ink text-ui cursor-pointer font-medium">
            Earlier versions ({olderVersions.length})
          </summary>
          <ul className="text-muted text-fine mt-2 space-y-1">
            {olderVersions.map((p) => (
              <li key={p.id}>
                v{p.version} — {p.fields.length} questions, {p.extractionCount}{" "}
                extractions. Kept so those rows still answer the questions they were
                asked.
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AddField({
  projectId,
  protocolId,
  onDone,
}: {
  projectId: string;
  protocolId: string;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [required, setRequired] = useState(false);
  const [requiresAnchor, setRequiresAnchor] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = FIELD_TYPES.find((f) => f.type === type);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const options = optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);

    startTransition(async () => {
      const response = await addField({
        projectId,
        protocolId,
        field: {
          label,
          type,
          required,
          requiresAnchor,
          helpText: helpText.trim() || null,
          options: needsOptions(type) ? options : null,
        },
      });

      if (response.ok) onDone();
      else setError(response.error);
    });
  }

  return (
    <form onSubmit={submit} className="border-accent/40 space-y-4 rounded-lg border p-4">
      <Field
        label="Label"
        id="field-label"
        hint="The question, as an extractor will read it."
      >
        <Input
          id="field-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
      </Field>

      <Field label="Type" id="field-type" hint={selected?.hint}>
        <Select
          id="field-type"
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
        >
          {FIELD_TYPES.map((f) => (
            <option key={f.type} value={f.type}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>

      {needsOptions(type) && (
        <Field label="Options" id="field-options" hint="One per line.">
          <Textarea
            id="field-options"
            rows={4}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            required
          />
        </Field>
      )}

      <Field label="Help text" id="field-help" hint="Optional. Shown beside the field.">
        <Input
          id="field-help"
          value={helpText}
          onChange={(e) => setHelpText(e.target.value)}
        />
      </Field>

      <label className="text-ink text-ui flex items-center gap-2">
        <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required
      </label>

      <label className="text-ink text-ui flex items-start gap-2">
        <Checkbox
          className="mt-1"
          checked={requiresAnchor}
          onChange={(e) => setRequiresAnchor(e.target.checked)}
        />
        <span>
          Needs a quoted source
          <span className="text-muted text-fine block text-pretty">
            The answer cannot be saved without a passage from the paper. Use it for
            anything a reviewer would challenge — an effect size, a primary outcome.
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !label.trim()}>
          {pending ? "Adding…" : "Add question"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-danger text-ui">
          {error}
        </p>
      )}
    </form>
  );
}
