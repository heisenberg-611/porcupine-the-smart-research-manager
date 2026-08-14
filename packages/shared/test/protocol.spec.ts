import { describe, expect, it } from "vitest";

import {
  FIELD_TYPE_VALUES,
  needsOptions,
  PROTOCOL_TEMPLATES,
  templateById,
  toFieldKey,
} from "../src/protocol";

describe("toFieldKey", () => {
  it("makes a stable machine key from a label", () => {
    expect(toFieldKey("Sample size")).toBe("sample_size");
    expect(toFieldKey("Primary outcome (30 days)")).toBe("primary_outcome_30_days");
  });

  it("strips diacritics rather than encoding them", () => {
    // A key ends up as a CSV column header and a join key; "résumé" must not
    // become a column nobody can type.
    expect(toFieldKey("Résumé")).toBe("resume");
  });

  it("never produces an empty or edge-padded key", () => {
    expect(toFieldKey("!!!")).toBe("field");
    expect(toFieldKey("  spaced  ")).toBe("spaced");
    expect(toFieldKey("---x---")).toBe("x");
  });

  it("is deterministic and bounded", () => {
    const long = "a".repeat(200);
    expect(toFieldKey(long)).toBe(toFieldKey(long));
    expect(toFieldKey(long).length).toBeLessThanOrEqual(48);
  });
});

describe("needsOptions", () => {
  it("is true only for choice fields", () => {
    expect(needsOptions("ENUM")).toBe(true);
    expect(needsOptions("MULTI_ENUM")).toBe(true);
    expect(needsOptions("TEXT")).toBe(false);
    expect(needsOptions("NUMBER")).toBe(false);
  });
});

describe("templates", () => {
  it("every template is internally valid", () => {
    for (const template of PROTOCOL_TEMPLATES) {
      for (const field of template.fields) {
        expect(FIELD_TYPE_VALUES).toContain(field.type);

        // The database refuses a choice field with no options, so a template
        // that shipped one would fail at the moment someone tried to use it.
        if (needsOptions(field.type)) {
          expect(field.options, `${template.id}/${field.label}`).toBeDefined();
          expect(field.options!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("produces unique keys within each template", () => {
    // Two fields whose labels collapse to the same key would violate the
    // (protocol, key) unique index halfway through creating the protocol.
    for (const template of PROTOCOL_TEMPLATES) {
      const keys = template.fields.map((f) => toFieldKey(f.label));
      expect(new Set(keys).size, `${template.id} has duplicate keys`).toBe(keys.length);
    }
  });

  it("asks for provenance on the fields a reviewer would challenge", () => {
    // An effect size or primary outcome with no quoted source is the finding
    // nobody can defend. Every non-blank template must demand at least one.
    for (const template of PROTOCOL_TEMPLATES.filter((t) => t.fields.length > 0)) {
      expect(
        template.fields.some((f) => f.requiresAnchor),
        `${template.id} demands no provenance anywhere`,
      ).toBe(true);
    }
  });

  it("stays short enough to finish", () => {
    // A forty-field template looks thorough and gets abandoned at paper three.
    for (const template of PROTOCOL_TEMPLATES) {
      expect(template.fields.length, template.id).toBeLessThanOrEqual(15);
    }
  });

  it("looks up by id and returns undefined for anything else", () => {
    expect(templateById("pico-rct")?.name).toMatch(/PICO/);
    expect(templateById("nonsense")).toBeUndefined();
  });
});
