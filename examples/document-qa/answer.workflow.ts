// Embedded TypeScript syntax proposal. The @guardstep/sdk API does not exist yet.

import { gs } from "@guardstep/sdk";

const AnswerStatus = gs.enum(["answered", "insufficient_context"] as const);

const FailureCode = gs.enum([
  "CAPABILITY_DENIED",
  "SEARCH_TIMEOUT",
  "MODEL_OUTPUT_INVALID",
  "CITATION_REQUIRED",
  "CITATION_FORBIDDEN",
  "CITATION_UNKNOWN",
  "COST_LIMIT_EXCEEDED",
  "DURATION_LIMIT_EXCEEDED",
] as const);

const Question = gs.record({
  question: gs.string(),
});

const Citation = gs.record({
  document_id: gs.string(),
  title: gs.string(),
  url: gs.url(),
});

const Document = gs.record({
  id: gs.string(),
  title: gs.string(),
  url: gs.url(),
  content: gs.string(),
});

const Answer = gs.record({
  status: AnswerStatus,
  text: gs.string(),
  citations: gs.list(Citation),
});

const documentsSearch = gs.tool("documents.search", {
  input: gs.record({ question: gs.string() }),
  output: gs.list(Document),
});

const documentQaInstructions = `
Answer the question using only the supplied documents.
Return answered only when the documents support the answer.
Return insufficient_context when the documents do not support an answer.
For an answered result, copy every citation ID, title, and URL from a supplied document.
`.trim();

export const AnswerQuestion = gs.workflow({
  name: "AnswerQuestion",
  input: Question,
  output: Answer,
  failures: FailureCode,
  capabilities: [
    gs.grant(documentsSearch, { denied: "CAPABILITY_DENIED" }),
  ],
  limits: {
    toolCalls: 1,
    modelCalls: 1,
    duration: gs.seconds(20, "DURATION_LIMIT_EXCEEDED"),
    cost: gs.usd(0.05, "COST_LIMIT_EXCEEDED"),
  },
}).define(async ({ input, effect, require }) => {
  const documents = await effect.call(
    documentsSearch,
    { question: input.question },
    { timeout: "SEARCH_TIMEOUT" },
  );

  const answer = await effect.generate({
    output: Answer,
    model: gs.model("balanced"),
    instructions: documentQaInstructions,
    context: { question: input.question, documents },
    invalid: "MODEL_OUTPUT_INVALID",
  });

  require(
    answer.status !== "answered" || answer.citations.length > 0,
    "CITATION_REQUIRED",
  );

  require(
    answer.status !== "insufficient_context" || answer.citations.length === 0,
    "CITATION_FORBIDDEN",
  );

  require(
    answer.citations.every((citation) =>
      documents.some((document) =>
        document.id === citation.document_id &&
        document.title === citation.title &&
        document.url === citation.url
      )
    ),
    "CITATION_UNKNOWN",
  );

  return answer;
});
