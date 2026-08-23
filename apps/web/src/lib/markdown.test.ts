import { describe, expect, it } from "vitest";

import {
  isSafeUrl,
  parseInline,
  parseMarkdown,
  sanitizeHref,
} from "./markdown";

describe("URL safety and sanitization", () => {
  it("allows safe http, https, and mailto URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com/path?query=1#hash")).toBe(true);
    expect(isSafeUrl("mailto:alice@example.com")).toBe(true);
    expect(isSafeUrl("/projects/123")).toBe(true);
    expect(isSafeUrl("#section")).toBe(true);
  });

  it("normalizes www. prefixes to https://", () => {
    expect(sanitizeHref("www.example.com")).toBe("https://www.example.com");
  });

  it("blocks dangerous schemes (javascript:, data:, vbscript:)", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(sanitizeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(sanitizeHref("vbscript:msgbox(1)")).toBeNull();
  });
});

describe("Inline markdown parsing", () => {
  it("parses plain text", () => {
    expect(parseInline("Hello world")).toEqual([
      { type: "text", value: "Hello world" },
    ]);
  });

  it("parses bold text", () => {
    expect(parseInline("This is **bold** text")).toEqual([
      { type: "text", value: "This is " },
      { type: "bold", children: [{ type: "text", value: "bold" }] },
      { type: "text", value: " text" },
    ]);
  });

  it("parses italic text", () => {
    expect(parseInline("This is *italic* and _also italic_")).toEqual([
      { type: "text", value: "This is " },
      { type: "italic", children: [{ type: "text", value: "italic" }] },
      { type: "text", value: " and " },
      { type: "italic", children: [{ type: "text", value: "also italic" }] },
    ]);
  });

  it("parses bold-italic text", () => {
    expect(parseInline("***bold italic***")).toEqual([
      { type: "bold_italic", children: [{ type: "text", value: "bold italic" }] },
    ]);
  });

  it("parses strikethrough text", () => {
    expect(parseInline("~~deleted~~")).toEqual([
      { type: "strike", children: [{ type: "text", value: "deleted" }] },
    ]);
  });

  it("parses inline code without interpreting inner markdown", () => {
    expect(parseInline("Use `const x = **not bold**;` now")).toEqual([
      { type: "text", value: "Use " },
      { type: "code", value: "const x = **not bold**;" },
      { type: "text", value: " now" },
    ]);
  });

  it("parses markdown links and strips unsafe schemes", () => {
    expect(parseInline("Check [OSF](https://osf.io/xyz)")).toEqual([
      { type: "text", value: "Check " },
      {
        type: "link",
        href: "https://osf.io/xyz",
        children: [{ type: "text", value: "OSF" }],
      },
    ]);

    // Unsafe link is rendered as plain text rather than an active anchor
    expect(parseInline("Click [evil](javascript:alert(1))")).toEqual([
      { type: "text", value: "Click [evil](javascript:alert(1))" },
    ]);
  });

  it("parses autolinks with punctuation and parenthesis balancing", () => {
    const nodes = parseInline("See (https://example.com/test) and https://example.com/page.");
    expect(nodes).toEqual([
      { type: "text", value: "See (" },
      {
        type: "link",
        href: "https://example.com/test",
        children: [{ type: "text", value: "https://example.com/test" }],
      },
      { type: "text", value: ") and " },
      {
        type: "link",
        href: "https://example.com/page",
        children: [{ type: "text", value: "https://example.com/page" }],
      },
      { type: "text", value: "." },
    ]);
  });

  it("parses line breaks", () => {
    expect(parseInline("Line 1\nLine 2")).toEqual([
      { type: "text", value: "Line 1" },
      { type: "br" },
      { type: "text", value: "Line 2" },
    ]);
  });

  it("parses nested formatting (e.g. bold link, italic inside bold)", () => {
    const nodes = parseInline("**bold with *italic* inside** and [**bold link**](https://example.com)");
    expect(nodes[0]).toEqual({
      type: "bold",
      children: [
        { type: "text", value: "bold with " },
        { type: "italic", children: [{ type: "text", value: "italic" }] },
        { type: "text", value: " inside" },
      ],
    });

    expect(nodes[2]).toEqual({
      type: "link",
      href: "https://example.com",
      children: [
        { type: "bold", children: [{ type: "text", value: "bold link" }] },
      ],
    });
  });
});

describe("Block markdown parsing", () => {
  it("returns empty array for empty string", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });

  it("parses single and multiple paragraphs", () => {
    const md = "First paragraph line 1.\nFirst paragraph line 2.\n\nSecond paragraph.";
    const blocks = parseMarkdown(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(blocks[1]?.type).toBe("paragraph");
  });

  it("parses headings of levels 1 to 6", () => {
    const md = "# Heading 1\n## Heading 2\n### Heading 3";
    const blocks = parseMarkdown(md);
    expect(blocks).toEqual([
      {
        type: "heading",
        level: 1,
        content: "Heading 1",
        inline: [{ type: "text", value: "Heading 1" }],
      },
      {
        type: "heading",
        level: 2,
        content: "Heading 2",
        inline: [{ type: "text", value: "Heading 2" }],
      },
      {
        type: "heading",
        level: 3,
        content: "Heading 3",
        inline: [{ type: "text", value: "Heading 3" }],
      },
    ]);
  });

  it("parses unordered lists", () => {
    const md = "- Item 1\n* Item 2\n+ Item 3\n• Item 4";
    const blocks = parseMarkdown(md);
    expect(blocks).toEqual([
      {
        type: "ul",
        items: [
          { content: "Item 1", inline: [{ type: "text", value: "Item 1" }] },
          { content: "Item 2", inline: [{ type: "text", value: "Item 2" }] },
          { content: "Item 3", inline: [{ type: "text", value: "Item 3" }] },
          { content: "Item 4", inline: [{ type: "text", value: "Item 4" }] },
        ],
      },
    ]);
  });

  it("parses ordered lists", () => {
    const md = "1. Step one\n2. Step two\n3. Step three";
    const blocks = parseMarkdown(md);
    expect(blocks).toEqual([
      {
        type: "ol",
        items: [
          { content: "Step one", inline: [{ type: "text", value: "Step one" }] },
          { content: "Step two", inline: [{ type: "text", value: "Step two" }] },
          { content: "Step three", inline: [{ type: "text", value: "Step three" }] },
        ],
      },
    ]);
  });

  it("parses blockquotes", () => {
    const md = "> This is a quote.\n> Second line of quote.";
    const blocks = parseMarkdown(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe("blockquote");
  });

  it("parses fenced code blocks with language", () => {
    const md = "```typescript\nconst a = 1;\nconsole.log(a);\n```";
    const blocks = parseMarkdown(md);
    expect(blocks).toEqual([
      {
        type: "code_block",
        lang: "typescript",
        code: "const a = 1;\nconsole.log(a);",
      },
    ]);
  });

  it("parses horizontal rules", () => {
    const md = "Top\n\n---\n\nBottom";
    const blocks = parseMarkdown(md);
    expect(blocks.length).toBe(3);
    expect(blocks[1]?.type).toBe("hr");
  });

  it("parses GFM markdown tables with alignments and cell formatting", () => {
    const md = `| Metric | Value |
| :--- | :--- |
| AI Edge Performance | **60 TOPS** on NVIDIA Jetson AGX Orin |
| Digital Twin Validation | Modulus error: **4.8%** <br> Temp RMSE: **1.2 °C** |`;

    const blocks = parseMarkdown(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe("table");
    if (blocks[0]?.type === "table") {
      expect(blocks[0].headers).toHaveLength(2);
      expect(blocks[0].headers[0]?.content).toBe("Metric");
      expect(blocks[0].headers[1]?.content).toBe("Value");
      expect(blocks[0].rows).toHaveLength(2);
      expect(blocks[0].rows[0]?.[0]?.content).toBe("AI Edge Performance");
      expect(blocks[0].rows[1]?.[1]?.inline.some((n) => n.type === "br")).toBe(true);
    }
  });

  it("parses the user's exact extracted metrics and tables", () => {
    const text = `## 4. The Numbers: Metrics, Multipliers, and Hardware Limits

### 4.1 Hardware & Computing Limits

| Metric | Value |
| :--- | :--- |
| AI Edge Performance | **60 TOPS** on NVIDIA Jetson AGX Orin |
| Edge AI Parameters & Latency | 260,000 parameters, quantized to INT8, with **9 ms** inference latency |
| Compute Speedup | **850×** computational speedup via POD-reduced digital twin |
| Accuracy Retention | Maintains **99.8%** of the system's energy |
| Digital Twin Prediction Validation | Modulus prediction error: **4.8%** <br> Temperature RMSE: **1.2 °C** <br> Moisture RMSE: **0.8% RH** |

### 4.2 Sensing & Detection Metrics

| Metric | Value |
| :--- | :--- |
| Sensor Network | 8 Fiber Bragg Grating (FBG) sensors spaced at **5 cm** intervals |
| Interrogation Sampling Rate | **1000 Hz (1 kHz)** with a strain resolution of **±5 με** |
| Safety Overrides | Consistent anomaly for **3 consecutive windows (300 ms)** <br> Fade transition: 0.7–0.85 probability <br> Immediate override: >0.85 probability |
| End-to-End Response Time | **110 ms ± 25 ms** (from physical crack to visual override) |
| Crack Detection Performance | **96.7%** accuracy (detecting 29 out of 30 cracks from 0.1 mm to 0.3 mm width) |
| False Positive Mitigation | False positive rate reduced from **3.3%** to **0.8%** |
| FBG Sensor Degradation & Lifetime | Signal degradation: **0.05 dB/year** <br> Wavelength drift: **2.3 pm/year** <br> Projected functional lifetime: **>25 years** (at a 10:1 SNR threshold) |
| Operating Limits | Temperature compensation across **−20 °C to +60 °C**, maintaining crack detection accuracy within **±0.02 mm** |

### 4.3 Interactive Display Specs (LED Panel)

| Metric | Value |
| :--- | :--- |
| Resolution & Pitch | **800 × 60** pixels, **3.91 mm** pitch |
| Refresh, Color, & Brightness | **30 fps**, **16-bit** color, peak luminance of **4000 cd/m²** |
| Uptime | AI-driven light narration uptime validated at **99.7% ± 0.1%** |

### 4.4 30-Year Lifecycle Predictions

| Metric | Value |
| :--- | :--- |
| Bending Modulus Loss | Predicted to decay by **7.8% ± 1.2%** over 30 years |
| Optical Transmittance Decay | Predicted to drop by **4.6% ± 0.8%** over 30 years |
| Critical Crack Risk Probability | Expected to reach **5.2% ± 1.1%** at year 30 (triggering maintenance at **26.4 ± 1.8 years**) |`;

    const blocks = parseMarkdown(text);
    const tables = blocks.filter((b) => b.type === "table");
    const headings = blocks.filter((b) => b.type === "heading");

    expect(headings.length).toBe(5);
    expect(tables.length).toBe(4);
  });

  it("parses raw text with tables without markdown hashes", () => {
    const raw = `4. The Numbers: Metrics, Multipliers, and Hardware Limits
4.1 Hardware & Computing Limits
| Metric | Value |
| :--- | :--- |
| AI Edge Performance | 60 TOPS on NVIDIA Jetson AGX Orin |
| Edge AI Parameters & Latency | 260,000 parameters, quantized to INT8, with 9 ms inference latency |

4.2 Sensing & Detection Metrics
| Metric | Value |
| :--- | :--- |
| Sensor Network | 8 Fiber Bragg Grating (FBG) sensors spaced at 5 cm intervals |`;

    const blocks = parseMarkdown(raw);
    const tables = blocks.filter((b) => b.type === "table");
    expect(tables.length).toBe(2);
  });
});
