import assert from "node:assert/strict";
import { test } from "node:test";

import { documentQaGraph } from "../src/workflow.js";

test("compiled graph exposes the intended workflow nodes", () => {
  const graph = documentQaGraph.getGraph();
  const nodeIds = Object.keys(graph.nodes).sort();

  assert.deepEqual(nodeIds, [
    "__end__",
    "__start__",
    "check_capability",
    "generate_answer",
    "search_documents",
    "start_run",
  ]);
});
