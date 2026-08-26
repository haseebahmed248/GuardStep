import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkConformance, runScenario } from "../src/conformance.js";
import { loadCorpus, loadScenarios } from "../src/fixtures.js";

const corpus = loadCorpus();
const fixture = loadScenarios();

describe("BAML document Q&A implementation", () => {
  for (const scenario of fixture.scenarios) {
    test(scenario.id, async () => {
      const execution = await runScenario(scenario, corpus, fixture);
      assert.deepEqual(checkConformance(execution), []);
    });
  }
});
