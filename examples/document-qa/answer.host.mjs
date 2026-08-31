// @ts-check

import { readFileSync } from "node:fs";

/** @typedef {import("./answer.generated.js").Document} Document */

/** @type {{ readonly schema_version: 1; readonly documents: readonly Document[] }} */
const corpus = JSON.parse(
  readFileSync(new URL("../../benchmarks/document-qa/fixtures/documents.json", import.meta.url), "utf8"),
);

const ignoredWords = new Set(["and", "are", "does", "is", "the", "what", "which"]);
/**
 * @param {string} value
 * @returns {string[]}
 */
const words = (value) =>
  value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !ignoredWords.has(word)) ?? [];

/** @satisfies {import("./answer.generated.js").GuardStepHost} */
const host = {
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
      const topScore = ranked[0]?.score;
      const documents = topScore === undefined
        ? []
        : ranked.filter(({ score }) => score === topScore).map(({ document }) => document);
      return { status: "succeeded", value: documents, elapsedMs: 0 };
    },
  },
  model: {
    async generate({ context }) {
      const documents = /** @type {readonly Document[]} */ (context.documents);
      /** @type {import("./answer.generated.js").Answer} */
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

export default host;
