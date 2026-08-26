import assert from "node:assert/strict";
import { test } from "node:test";

import { b } from "../baml_client/index.js";
import { loadCorpus } from "../src/fixtures.js";

test("BAML renders the grounded AnswerQuestion contract", async () => {
  const document = loadCorpus().documents[0];
  assert.ok(document);

  const request = await b.request.AnswerQuestion("What is the retention period?", [document], {
    env: { OPENAI_API_KEY: "fixture-only" },
  });
  const body = request.body.text();

  assert.match(body, /using only the supplied documents/i);
  assert.match(body, /insufficient_context/);
  assert.match(body, /document_id/);
  assert.match(body, /What is the retention period\?/);
  assert.match(body, new RegExp(document.id));
});
