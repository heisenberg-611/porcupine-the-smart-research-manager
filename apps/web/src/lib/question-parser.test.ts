import { describe, expect, it } from "vitest";

import { parseQuestionsInput, splitKeywords } from "./question-parser";

describe("splitKeywords", () => {
  it("splits comma and newline separated keywords", () => {
    expect(splitKeywords("alpha, beta, gamma")).toEqual(["alpha", "beta", "gamma"]);
    expect(splitKeywords("alpha\nbeta\ngamma")).toEqual(["alpha", "beta", "gamma"]);
    expect(splitKeywords(' "spaced repetition", \'active recall\' ')).toEqual([
      "spaced repetition",
      "active recall",
    ]);
  });
});

describe("parseQuestionsInput", () => {
  it("parses standard .env style RQ1=value", () => {
    const raw = `
# Review research questions
RQ1="Does spaced repetition improve retention in medical education?"
RQ2='What is the comparative efficacy of digital flashcards?'
export RQ3=How does feedback frequency affect clinical reasoning? # trailing comment
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention in medical education?",
        keywords: [],
      },
      {
        text: "What is the comparative efficacy of digital flashcards?",
        keywords: [],
      },
      {
        text: "How does feedback frequency affect clinical reasoning?",
        keywords: [],
      },
    ]);
  });

  it("parses Question = keywords format", () => {
    const raw = `
Does spaced repetition improve retention in medical education? = spaced repetition, retention, medical education
What is the comparative efficacy of digital flashcards? = flashcards, digital learning, efficacy
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention in medical education?",
        keywords: ["spaced repetition", "retention", "medical education"],
      },
      {
        text: "What is the comparative efficacy of digital flashcards?",
        keywords: ["flashcards", "digital learning", "efficacy"],
      },
    ]);
  });

  it("parses pipe-delimited question | keywords format", () => {
    const raw = `
1. Does spaced repetition improve retention? | spaced repetition, retention
2. What are the adverse effects of intervention X? | adverse effects, safety, toxicity
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention?",
        keywords: ["spaced repetition", "retention"],
      },
      {
        text: "What are the adverse effects of intervention X?",
        keywords: ["adverse effects", "safety", "toxicity"],
      },
    ]);
  });

  it("parses paragraph block format with Keywords: line", () => {
    const raw = `
Does spaced repetition improve retention in medical education?
Keywords: spaced repetition, retention, medical education

What is the comparative efficacy of digital flashcards?
Keywords: flashcards, digital learning, efficacy
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention in medical education?",
        keywords: ["spaced repetition", "retention", "medical education"],
      },
      {
        text: "What is the comparative efficacy of digital flashcards?",
        keywords: ["flashcards", "digital learning", "efficacy"],
      },
    ]);
  });

  it("parses numbered list of questions", () => {
    const raw = `
1. Does spaced repetition improve retention in medical education?
2) What is the comparative efficacy of digital flashcards?
- How does retrieval latency correlate with knowledge consolidation?
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention in medical education?",
        keywords: [],
      },
      {
        text: "What is the comparative efficacy of digital flashcards?",
        keywords: [],
      },
      {
        text: "How does retrieval latency correlate with knowledge consolidation?",
        keywords: [],
      },
    ]);
  });

  it("parses JSON array format", () => {
    const raw = JSON.stringify([
      {
        text: "Does spaced repetition improve retention?",
        keywords: ["spaced repetition", "retention"],
      },
      {
        question: "What is the efficacy of digital flashcards?",
        keywords: "flashcards, efficacy",
      },
    ]);
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention?",
        keywords: ["spaced repetition", "retention"],
      },
      {
        text: "What is the efficacy of digital flashcards?",
        keywords: ["flashcards", "efficacy"],
      },
    ]);
  });

  it("parses colon-delimited question : keywords format", () => {
    const raw = `
Does spaced repetition improve retention in medical education?: spaced repetition, retention, education
What are the adverse effects of intervention X?: adverse effects, safety
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed).toEqual([
      {
        text: "Does spaced repetition improve retention in medical education?",
        keywords: ["spaced repetition", "retention", "education"],
      },
      {
        text: "What are the adverse effects of intervention X?",
        keywords: ["adverse effects", "safety"],
      },
    ]);
  });

  it("parses full Markdown tables with headers, bolding, and backtick tags", () => {
    const raw = `
| Research question                                                                                                                                     | Related tags / keywords                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **1. How does the human need for social belonging influence the desire for social acceptance and validation?**                                        | \`need to belong\`, \`social belonging\`, \`social acceptance\`, \`social validation\`, \`affiliation\`                     |
| **2. How does perceived acceptance or rejection from one's social group affect self-esteem and self-worth?**                                          | \`social acceptance\`, \`social rejection\`, \`self-esteem\`, \`self-worth\`, \`rejection\`                                 |
| **3. What psychological mechanisms link social approval from others to an individual's sense of self-worth?**                                         | \`social approval\`, \`self-worth\`, \`self-esteem\`, \`self-evaluation\`, \`sociometer theory\`                            |
| **4. How does social exclusion influence people's motivation to regain acceptance from their group?**                                                 | \`social exclusion\`, \`ostracism\`, \`belonging\`, \`acceptance\`, \`affiliation motivation\`, \`reconnection\`              |
| **5. How does fear of social rejection influence validation-seeking behavior?**                                                                       | \`rejection sensitivity\`, \`fear of rejection\`, \`social anxiety\`, \`validation seeking\`, \`interpersonal sensitivity\` |
| **6. How does social comparison influence people's need for approval and recognition from others?**                                                   | \`social comparison\`, \`self-evaluation\`, \`social approval\`, \`recognition\`, \`self-esteem\`                           |
| **7. How does group membership influence the importance individuals place on approval from in-group members?**                                        | \`social identity\`, \`group membership\`, \`in-group\`, \`in-group acceptance\`, \`social identity theory\`                |
| **8. Why does criticism or rejection from an individual's own social group produce stronger psychological responses than evaluation from outsiders?** | \`in-group\`, \`out-group\`, \`social rejection\`, \`social evaluation\`, \`ingroup bias\`, \`social identity\`               |
| **9. How does perceived social status influence the motivation to obtain approval and recognition from others?**                                      | \`social status\`, \`status seeking\`, \`social approval\`, \`recognition\`, \`social hierarchy\`, \`prestige\`               |
| **10. How does interpersonal feedback contribute to the regulation of self-esteem?**                                                                  | \`interpersonal feedback\`, \`self-esteem\`, \`self-esteem regulation\`, \`social evaluation\`, \`self-worth\`              |
`;

    const parsed = parseQuestionsInput(raw);
    expect(parsed.length).toBe(10);
    expect(parsed[0]).toEqual({
      text: "How does the human need for social belonging influence the desire for social acceptance and validation?",
      keywords: [
        "need to belong",
        "social belonging",
        "social acceptance",
        "social validation",
        "affiliation",
      ],
    });
    expect(parsed[9]).toEqual({
      text: "How does interpersonal feedback contribute to the regulation of self-esteem?",
      keywords: [
        "interpersonal feedback",
        "self-esteem",
        "self-esteem regulation",
        "social evaluation",
        "self-worth",
      ],
    });
  });

  it("handles empty and whitespace input gracefully", () => {
    expect(parseQuestionsInput("")).toEqual([]);
    expect(parseQuestionsInput("   \n\n   \t  ")).toEqual([]);
    expect(parseQuestionsInput("# only comments\n// another comment")).toEqual([]);
  });

  it("deduplicates identical questions", () => {
    const raw = `
RQ1=Does spaced repetition improve retention?
RQ2=Does spaced repetition improve retention?
`;
    const parsed = parseQuestionsInput(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.text).toBe("Does spaced repetition improve retention?");
  });
});
