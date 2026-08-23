"use server";

import {
  FIELD_TYPE_VALUES,
  needsOptions,
  templateById,
  toFieldKey,
} from "@Porcupine/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../actions";

const FieldInput = z.object({
  label: z.string().trim().min(1, "Give the field a label.").max(120),
  type: z.enum(FIELD_TYPE_VALUES),
  required: z.boolean().default(false),
  requiresAnchor: z.boolean().default(false),
  helpText: z.string().trim().max(500).nullish(),
  options: z.array(z.string().trim().min(1)).max(50).nullish(),
});

/**
 * Translate a database integrity error into something a person can act on.
 *
 * Every rule these actions can trip is enforced by a trigger rather than by
 * the form — imports and bulk actions do not go through the form — so the
 * server's job is to say what happened in the user's language, not to
 * re-implement the check and risk the two disagreeing.
 */
function explain(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";

  // The trigger messages are already written for a person — "The field
  // \"Sample size\" has 12 recorded answer(s)" — so surface the sentence
  // rather than paraphrasing it and risking the two drifting apart.
  const isOurs = /cannot be renamed|recorded answer|needs at least one option/i.test(
    message,
  );
  if (!isOurs) return fallback;

  const sentence = /ERROR:\s*(.+?)(\n|$)/.exec(message)?.[1] ?? message.split("\n")[0];
  return sentence?.trim() || fallback;
}

const CreateProtocolInput = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "Give the protocol a name.").max(120),
  templateId: z.string().trim().max(60).optional(),
});

/**
 * Create a protocol, optionally from a starter template.
 *
 * The whole protocol and all its fields are one transaction. A protocol that
 * exists with half its fields is worse than none: extractors would start
 * answering it, and the missing fields would then arrive as holes in rows
 * already submitted.
 */
export async function createProtocol(
  input: z.input<typeof CreateProtocolInput>,
): Promise<ActionResult<{ protocolId: string }>> {
  const parsed = CreateProtocolInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid protocol." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, name, templateId } = parsed.data;
  const template = templateId ? templateById(templateId) : undefined;

  try {
    const protocolId = await withUserContext(claims, async (tx) => {
      const protocol = await tx.protocol.create({
        data: { projectId, name, version: 1 },
        select: { id: true },
      });

      if (template) {
        // Sequential rather than createMany: the options and anchor triggers
        // run per row, and a rejected field should name itself.
        for (const [index, field] of template.fields.entries()) {
          await tx.protocolField.create({
            data: {
              protocolId: protocol.id,
              key: toFieldKey(field.label),
              label: field.label,
              type: field.type,
              required: field.required ?? false,
              requiresAnchor: field.requiresAnchor ?? false,
              helpText: field.helpText ?? null,
              // Spread rather than `?? undefined`: exactOptionalPropertyTypes
              // treats "absent" and "explicitly undefined" as different, and
              // Prisma's Json input accepts only the former.
              ...(field.options ? { options: field.options } : {}),
              order: index,
            },
            select: { id: true },
          });
        }
      }

      return protocol.id;
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/protocol`);
    return { ok: true, data: { protocolId } };
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : "")) {
      return { ok: false, error: "A protocol with that name already exists." };
    }
    return {
      ok: false,
      error: explain(
        error,
        "Could not create the protocol. You may not have permission.",
      ),
    };
  }
}

const AddFieldInput = z.object({
  projectId: z.uuid(),
  protocolId: z.uuid(),
  field: FieldInput,
});

export async function addField(
  input: z.input<typeof AddFieldInput>,
): Promise<ActionResult<{ fieldId: string }>> {
  const parsed = AddFieldInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid field." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, protocolId, field } = parsed.data;

  if (needsOptions(field.type) && (field.options ?? []).length === 0) {
    return { ok: false, error: "A choice field needs at least one option." };
  }

  try {
    const fieldId = await withUserContext(claims, async (tx) => {
      const last = await tx.protocolField.findFirst({
        where: { protocolId },
        orderBy: { order: "desc" },
        select: { order: true },
      });

      // The key is derived once and then never changes — the database
      // refuses a rename after answers exist. A numeric suffix keeps it
      // unique when two labels collapse to the same key.
      const base = toFieldKey(field.label);
      const taken = await tx.protocolField.findMany({
        where: { protocolId, key: { startsWith: base } },
        select: { key: true },
      });
      const keys = new Set(taken.map((f) => f.key));
      let key = base;
      for (let n = 2; keys.has(key); n++) key = `${base}_${n}`;

      const created = await tx.protocolField.create({
        data: {
          protocolId,
          key,
          label: field.label,
          type: field.type,
          required: field.required,
          requiresAnchor: field.requiresAnchor,
          helpText: field.helpText ?? null,
          ...(needsOptions(field.type) ? { options: field.options ?? [] } : {}),
          order: (last?.order ?? -1) + 1,
        },
        select: { id: true },
      });

      return created.id;
    });

    revalidatePath(`/projects/${projectId}/protocol`);
    return { ok: true, data: { fieldId } };
  } catch (error) {
    return { ok: false, error: explain(error, "Could not add that field.") };
  }
}

const FieldRefInput = z.object({
  projectId: z.uuid(),
  fieldId: z.uuid(),
});

export async function deleteField(
  input: z.input<typeof FieldRefInput>,
): Promise<ActionResult> {
  const parsed = FieldRefInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, fieldId } = parsed.data;

  try {
    await withUserContext(claims, async (tx) =>
      tx.protocolField.delete({ where: { id: fieldId }, select: { id: true } }),
    );
    revalidatePath(`/projects/${projectId}/protocol`);
    return { ok: true };
  } catch (error) {
    // The common case is not permission — it is that the field has answers,
    // and the trigger says so by name and count.
    return { ok: false, error: explain(error, "Could not delete that field.") };
  }
}

const MoveFieldInput = z.object({
  projectId: z.uuid(),
  fieldId: z.uuid(),
  direction: z.enum(["up", "down"]),
});

/**
 * Reorder by swapping with the neighbour.
 *
 * Up and down buttons rather than drag-and-drop: dragging needs a pointer,
 * and a protocol is edited about once per review while being read by every
 * extractor on every paper. Keyboard-reachable beats impressive here.
 */
export async function moveField(
  input: z.input<typeof MoveFieldInput>,
): Promise<ActionResult> {
  const parsed = MoveFieldInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, fieldId, direction } = parsed.data;

  try {
    const moved = await withUserContext(claims, async (tx) => {
      const field = await tx.protocolField.findUnique({
        where: { id: fieldId },
        select: { id: true, protocolId: true, order: true },
      });
      if (!field) return false;

      const neighbour = await tx.protocolField.findFirst({
        where: {
          protocolId: field.protocolId,
          order: direction === "up" ? { lt: field.order } : { gt: field.order },
        },
        orderBy: { order: direction === "up" ? "desc" : "asc" },
        select: { id: true, order: true },
      });
      if (!neighbour) return false; // Already at the end; not an error.

      // Three writes, not two: `order` has no unique constraint, but going
      // through a value neither row holds keeps the sequence sane if one ever
      // gains it.
      await tx.protocolField.update({ where: { id: field.id }, data: { order: -1 } });
      await tx.protocolField.update({
        where: { id: neighbour.id },
        data: { order: field.order },
      });
      await tx.protocolField.update({
        where: { id: field.id },
        data: { order: neighbour.order },
      });
      return true;
    });

    if (!moved) return { ok: true };

    revalidatePath(`/projects/${projectId}/protocol`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reorder the fields." };
  }
}

const NewVersionInput = z.object({
  projectId: z.uuid(),
  protocolId: z.uuid(),
});

/**
 * Copy a protocol into a new version.
 *
 * This is the answer the database gives when a field cannot be renamed or
 * deleted: the old version stays exactly as the people who used it saw it,
 * and the new one is free to change. Extractions point at a protocol id, so
 * existing rows keep answering the questions they were actually asked.
 */
export async function createNewVersion(
  input: z.input<typeof NewVersionInput>,
): Promise<ActionResult<{ protocolId: string }>> {
  const parsed = NewVersionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, protocolId } = parsed.data;

  try {
    const newId = await withUserContext(claims, async (tx) => {
      const source = await tx.protocol.findUnique({
        where: { id: protocolId },
        select: {
          name: true,
          dualExtract: true,
          fields: {
            orderBy: { order: "asc" },
            select: {
              key: true,
              label: true,
              type: true,
              options: true,
              required: true,
              requiresAnchor: true,
              helpText: true,
              order: true,
              questionId: true,
            },
          },
        },
      });
      if (!source) return null;

      const highest = await tx.protocol.findFirst({
        where: { projectId, name: source.name },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const created = await tx.protocol.create({
        data: {
          projectId,
          name: source.name,
          version: (highest?.version ?? 0) + 1,
          dualExtract: source.dualExtract,
        },
        select: { id: true },
      });

      for (const field of source.fields) {
        await tx.protocolField.create({
          data: {
            protocolId: created.id,
            key: field.key,
            label: field.label,
            type: field.type,
            ...(field.options !== null ? { options: field.options } : {}),
            required: field.required,
            requiresAnchor: field.requiresAnchor,
            helpText: field.helpText,
            order: field.order,
            questionId: field.questionId,
          },
          select: { id: true },
        });
      }

      // The previous version stops being offered for new extractions but is
      // never deleted — the rows that used it still have to make sense.
      await tx.protocol.update({ where: { id: protocolId }, data: { isActive: false } });

      return created.id;
    });

    if (!newId) return { ok: false, error: "Protocol not found." };

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/protocol`);
    return { ok: true, data: { protocolId: newId } };
  } catch (error) {
    return { ok: false, error: explain(error, "Could not create a new version.") };
  }
}
