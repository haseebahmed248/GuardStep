import type { Document, ModelRequest, QuestionInput } from "./types.js";

export const documentQaInstructions = [
  "Answer the question using only the supplied documents.",
  "Return status 'answered' only when the documents support the answer.",
  "Return status 'insufficient_context' when the documents do not support an answer.",
  "For an answered result, copy every citation ID, title, and URL from a supplied document.",
  "Return a value that matches the supplied JSON Schema.",
].join("\n");

export const createModelRequest = (
  input: QuestionInput,
  documents: Document[],
  responseSchema: object,
): ModelRequest => ({
  instructions: documentQaInstructions,
  question: input.question,
  documents,
  response_schema: responseSchema,
});
