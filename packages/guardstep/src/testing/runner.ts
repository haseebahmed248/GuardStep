import { isDeepStrictEqual } from "node:util";

import type { WorkflowIrV1 } from "../ir/index.js";
import { executeWorkflow } from "../runtime/index.js";
import type { GuardTestCaseResult, GuardTestSuite } from "./contracts.js";

export const runTestSuite = async (
  ir: WorkflowIrV1,
  suite: GuardTestSuite,
): Promise<readonly GuardTestCaseResult[]> => {
  if (suite.schemaVersion !== 1) throw new Error(`Unsupported test suite version: ${suite.schemaVersion}`);
  if (!ir.workflows.some(({ name }) => name === suite.workflow)) {
    throw new Error(`Test suite references unknown workflow: ${suite.workflow}`);
  }
  const ids = suite.cases.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Test case IDs must be unique");

  const results: GuardTestCaseResult[] = [];
  for (const testCase of suite.cases) {
    const run = await executeWorkflow({
      ir,
      workflow: suite.workflow,
      runId: `${suite.workflow}/${testCase.id}`,
      input: testCase.input,
      grantedCapabilities: new Set(testCase.grantedCapabilities),
      pricing: testCase.pricing,
      tools: testCase.tools,
      model: testCase.model,
    });
    const failures: string[] = [];
    if (run.status !== testCase.expect.status) {
      failures.push(`expected status ${testCase.expect.status}, received ${run.status}`);
    } else if (run.status === "failed") {
      if (run.error_code !== testCase.expect.errorCode) {
        failures.push(`expected error ${testCase.expect.errorCode}, received ${run.error_code}`);
      }
    } else if (!isDeepStrictEqual(run.output, testCase.expect.output)) {
      failures.push("output differs from expected value");
    }
    const eventTypes = run.events.map(({ type }) => type);
    if (!isDeepStrictEqual(eventTypes, testCase.expect.eventTypes)) {
      failures.push(
        `event sequence differs: expected ${testCase.expect.eventTypes.join(", ")}; received ${eventTypes.join(", ")}`,
      );
    }
    if (testCase.verify !== undefined) failures.push(...await testCase.verify(run));
    results.push({ id: testCase.id, passed: failures.length === 0, failures, run });
  }
  return results;
};
