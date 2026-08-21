import { runConformanceSuite } from "./conformance.js";
import { loadCorpus, loadScenarios } from "./fixtures.js";

const corpus = loadCorpus();
const fixture = loadScenarios();
const results = await runConformanceSuite(corpus, fixture);

let failed = 0;
for (const result of results) {
  const id = result.execution.scenario.id;
  if (result.failures.length === 0) {
    console.log(`PASS ${id}`);
    continue;
  }

  failed += 1;
  console.error(`FAIL ${id}`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
}

console.log(`\n${results.length - failed}/${results.length} scenarios passed.`);
if (failed > 0) process.exitCode = 1;
