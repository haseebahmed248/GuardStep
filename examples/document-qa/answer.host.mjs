// @ts-check

import { searchDocuments } from "./documents.mjs";

/** @typedef {import("./answer.generated.js").Document} Document */

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
      return {
        status: "succeeded",
        value: searchDocuments(args.question),
        elapsedMs: 0,
      };
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
