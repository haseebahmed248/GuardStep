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

/**
 * @param {string} question
 * @returns {readonly Document[]}
 */
export const searchDocuments = (question) => {
  const queryWords = words(question);
  const ranked = corpus.documents
    .map((document) => ({
      document,
      score: queryWords.filter((word) => words(`${document.title} ${document.content}`).includes(word)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  const topScore = ranked[0]?.score;
  return topScore === undefined
    ? []
    : ranked.filter(({ score }) => score === topScore).map(({ document }) => document);
};
