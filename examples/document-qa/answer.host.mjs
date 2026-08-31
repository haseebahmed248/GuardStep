import { readFileSync } from "node:fs";

const corpus = JSON.parse(
  readFileSync(new URL("../../benchmarks/document-qa/fixtures/documents.json", import.meta.url), "utf8"),
);

const ignoredWords = new Set(["and", "are", "does", "is", "the", "what", "which"]);
const words = (value) =>
  value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !ignoredWords.has(word)) ?? [];

export default {
  schemaVersion: 1,
  workflow: "AnswerQuestion",
  grantedCapabilities: ["documents.search"],
  pricing: {
    currency: "USD",
    input_usd_per_million: 0,
    output_usd_per_million: 0,
    source: "local-demo",
    effective_date: "2026-08-31",
  },
  tools: {
    async invoke({ arguments: args }) {
      const queryWords = words(String(args.question));
      const ranked = corpus.documents
        .map((document) => ({
          document,
          score: queryWords.filter((word) => words(`${document.title} ${document.content}`).includes(word)).length,
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score);
      const documents = ranked.length === 0 ? [] : ranked.filter(({ score }) => score === ranked[0].score).map(({ document }) => document);
      return { status: "succeeded", value: documents, elapsedMs: 0 };
    },
  },
  model: {
    async generate({ context }) {
      const documents = context.documents;
      const value = documents.length === 0
        ? { status: "insufficient_context", text: "No supporting context was found.", citations: [] }
        : {
            status: "answered",
            text: documents.map(({ content }) => content).join("\n"),
            citations: documents.map(({ id, title, url }) => ({ document_id: id, title, url })),
          };
      return {
        status: "succeeded",
        value,
        usage: { input_tokens: 0, output_tokens: 0 },
        elapsedMs: 0,
      };
    },
  },
};
