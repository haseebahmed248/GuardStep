import type { BamlModelRequest, Document, QuestionInput } from "./types.js";

export const createBamlModelRequest = (
  input: QuestionInput,
  documents: Document[],
): BamlModelRequest => ({
  function_name: "AnswerQuestion",
  question: input.question,
  documents,
});
