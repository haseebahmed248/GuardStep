// @ts-check

import { createOpenAICompatibleModelAdapter } from "guardstep/providers";

import { searchDocuments } from "./documents.mjs";

const baseUrl = process.env.GUARDSTEP_MODEL_BASE_URL ?? "http://127.0.0.1:11434/v1";
const modelName = process.env.GUARDSTEP_MODEL ?? "qwen2.5:3b";

/** @satisfies {import("guardstep/runtime").WorkflowHost} */
const host = {
  schemaVersion: 1,
  workflow: "AnswerQuestion",
  grantedCapabilities: ["documents.search"],
  pricing: {
    currency: "USD",
    input_usd_per_million: 0,
    output_usd_per_million: 0,
    source: "local-ollama",
    effective_date: "2026-09-01",
  },
  tools: {
    async invoke({ tool, arguments: args }) {
      if (tool !== "documents.search" || typeof args.question !== "string") {
        return { status: "failed", kind: "error", code: "UNSUPPORTED_TOOL", elapsedMs: 0 };
      }
      return {
        status: "succeeded",
        value: searchDocuments(args.question),
        elapsedMs: 0,
      };
    },
  },
  model: createOpenAICompatibleModelAdapter({
    baseUrl,
    ...(process.env.GUARDSTEP_MODEL_API_KEY === undefined
      ? {}
      : { apiKey: process.env.GUARDSTEP_MODEL_API_KEY }),
    profiles: {
      balanced: {
        model: modelName,
        temperature: 0,
        includeSchemaInPrompt: true,
      },
    },
  }),
};

export default host;
