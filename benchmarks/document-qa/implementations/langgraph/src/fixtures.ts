import { readFileSync } from "node:fs";
import { join } from "node:path";

import { benchmarkRoot } from "./paths.js";
import type { CorpusFixture, ScenarioFixture } from "./types.js";

const loadJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export const loadCorpus = (): CorpusFixture =>
  loadJson(join(benchmarkRoot, "fixtures", "documents.json")) as CorpusFixture;

export const loadScenarios = (): ScenarioFixture =>
  loadJson(join(benchmarkRoot, "fixtures", "scenarios.json")) as ScenarioFixture;
