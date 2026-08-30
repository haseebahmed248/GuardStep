import { readFileSync } from "node:fs";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const corpus = loadJson("fixtures/documents.json");
const fixture = loadJson("fixtures/scenarios.json");
const eventSchema = loadJson("../../schemas/execution-event.v1.schema.json");

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const unique = (values) => new Set(values).size === values.length;
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) =>
  typeof value === "string" && value.length > 0;
const isNonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0;

const hasExactKeys = (value, expectedKeys) => {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
};

const isUri = (value) => {
  if (!isNonEmptyString(value)) return false;
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
};

const isValidCitation = (citation) =>
  hasExactKeys(citation, ["document_id", "title", "url"]) &&
  isNonEmptyString(citation.document_id) &&
  isNonEmptyString(citation.title) &&
  isUri(citation.url);

const isStructurallyValidAnswer = (answer) =>
  hasExactKeys(answer, ["status", "text", "citations"]) &&
  ["answered", "insufficient_context"].includes(answer.status) &&
  isNonEmptyString(answer.text) &&
  Array.isArray(answer.citations) &&
  answer.citations.every(isValidCitation);

check(corpus.schema_version === 1, "documents: schema_version must be 1");
check(Array.isArray(corpus.documents), "documents: documents must be an array");

const documents = Array.isArray(corpus.documents) ? corpus.documents : [];
const documentIds = documents.map((document) => document.id);
check(unique(documentIds), "documents: document IDs must be unique");

for (const document of documents) {
  const label = `document ${JSON.stringify(document.id)}`;
  check(
    hasExactKeys(document, ["id", "title", "url", "content"]),
    `${label}: fields must be id, title, url, and content`,
  );
  check(isNonEmptyString(document.id), `${label}: id must be a non-empty string`);
  check(isNonEmptyString(document.title), `${label}: title must be a non-empty string`);
  check(isUri(document.url), `${label}: url must be an absolute URI`);
  check(isNonEmptyString(document.content), `${label}: content must be a non-empty string`);
}

const documentById = new Map(documents.map((document) => [document.id, document]));
const allowedEvents = new Set(eventSchema.$defs.envelope.properties.type.enum);

check(fixture.schema_version === 1, "scenarios: schema_version must be 1");
check(Array.isArray(fixture.scenarios), "scenarios: scenarios must be an array");
check(fixture.budgets?.tool_calls === 1, "budgets: tool_calls must be 1");
check(fixture.budgets?.model_calls === 1, "budgets: model_calls must be 1");
check(
  isNonNegativeInteger(fixture.budgets?.duration_ms),
  "budgets: duration_ms must be a non-negative integer",
);
check(fixture.budgets?.cost?.currency === "USD", "budgets: currency must be USD");
check(
  typeof fixture.budgets?.cost?.maximum === "number" && fixture.budgets.cost.maximum > 0,
  "budgets: cost maximum must be positive",
);

const scenarios = Array.isArray(fixture.scenarios) ? fixture.scenarios : [];
const scenarioIds = scenarios.map((scenario) => scenario.id);
check(unique(scenarioIds), "scenarios: scenario IDs must be unique");

for (const scenario of scenarios) {
  const label = `scenario ${JSON.stringify(scenario.id)}`;
  check(isNonEmptyString(scenario.id), `${label}: id must be a non-empty string`);
  check(
    hasExactKeys(scenario.input, ["question"]) && isNonEmptyString(scenario.input.question),
    `${label}: input must contain one non-empty question`,
  );
  check(
    Array.isArray(scenario.granted_capabilities) && unique(scenario.granted_capabilities),
    `${label}: granted capabilities must be a unique array`,
  );

  const searchReturns = scenario.search?.behavior === "return";
  const searchTimesOut = scenario.search?.behavior === "timeout";
  check(searchReturns || searchTimesOut, `${label}: unsupported search behavior`);
  check(
    isNonNegativeInteger(scenario.search?.elapsed_ms),
    `${label}: search elapsed_ms must be a non-negative integer`,
  );

  const retrievedIds = searchReturns && Array.isArray(scenario.search.document_ids)
    ? scenario.search.document_ids
    : [];
  if (searchReturns) {
    check(
      Array.isArray(scenario.search.document_ids),
      `${label}: returning search must list document_ids`,
    );
    check(unique(retrievedIds), `${label}: retrieved document IDs must be unique`);
    for (const documentId of retrievedIds) {
      check(documentById.has(documentId), `${label}: unknown search document ${documentId}`);
    }
  }

  const modelReturns = scenario.model?.behavior === "return";
  const modelNotReached = scenario.model?.behavior === "not_reached";
  check(modelReturns || modelNotReached, `${label}: unsupported model behavior`);

  let answerIsValid = false;
  if (modelReturns) {
    check(
      isNonNegativeInteger(scenario.model.elapsed_ms),
      `${label}: model elapsed_ms must be a non-negative integer`,
    );
    check(
      isNonNegativeInteger(scenario.model.usage?.input_tokens),
      `${label}: input token usage must be a non-negative integer`,
    );
    check(
      isNonNegativeInteger(scenario.model.usage?.output_tokens),
      `${label}: output token usage must be a non-negative integer`,
    );
    answerIsValid = isStructurallyValidAnswer(scenario.model.output);
    if (scenario.expect?.error_code === "MODEL_OUTPUT_INVALID") {
      check(!answerIsValid, `${label}: MODEL_OUTPUT_INVALID needs invalid model output`);
    } else {
      check(answerIsValid, `${label}: model output must match the public structure`);
    }
  }

  const events = scenario.expect?.required_events;
  check(Array.isArray(events) && events.length >= 2, `${label}: required_events is incomplete`);
  if (Array.isArray(events) && events.length > 0) {
    check(events[0] === "run.started", `${label}: first event must be run.started`);
    check(
      ["run.succeeded", "run.failed"].includes(events.at(-1)),
      `${label}: final event must terminate the run`,
    );
    for (const event of events) {
      check(
        allowedEvents.has(event),
        `${label}: event ${event} is not in execution-event.v1.schema.json`,
      );
    }
    check(
      !(modelNotReached && events.includes("model.started")),
      `${label}: a not-reached model cannot emit model.started`,
    );
  }

  const expectedStatus = scenario.expect?.status;
  check(["succeeded", "failed"].includes(expectedStatus), `${label}: invalid expected status`);
  if (expectedStatus === "succeeded") {
    check(!("error_code" in scenario.expect), `${label}: successful scenario has an error code`);
    check(answerIsValid, `${label}: successful scenario needs valid model output`);
    if (answerIsValid) {
      const citations = scenario.model.output.citations;
      check(
        scenario.model.output.status !== "answered" || citations.length > 0,
        `${label}: answered output needs a citation`,
      );
      check(
        scenario.model.output.status !== "insufficient_context" || citations.length === 0,
        `${label}: insufficient-context output cannot have citations`,
      );
      for (const citation of citations) {
        const document = documentById.get(citation.document_id);
        check(
          retrievedIds.includes(citation.document_id) &&
            document?.title === citation.title &&
            document?.url === citation.url,
          `${label}: successful output has an unknown or mismatched citation`,
        );
      }
    }
  } else {
    check(isNonEmptyString(scenario.expect?.error_code), `${label}: failed scenario needs an error code`);
  }

  if (scenario.expect?.error_code === "CITATION_REQUIRED") {
    check(
      answerIsValid &&
        scenario.model.output.status === "answered" &&
        scenario.model.output.citations.length === 0,
      `${label}: CITATION_REQUIRED fixture does not violate citation presence`,
    );
  }

  if (scenario.expect?.error_code === "CITATION_FORBIDDEN") {
    check(
      answerIsValid &&
        scenario.model.output.status === "insufficient_context" &&
        scenario.model.output.citations.length > 0,
      `${label}: CITATION_FORBIDDEN fixture does not contain a forbidden citation`,
    );
  }

  if (scenario.expect?.error_code === "CITATION_UNKNOWN") {
    const hasUnknownCitation =
      answerIsValid &&
      scenario.model.output.citations.some((citation) => {
        const document = documentById.get(citation.document_id);
        return !retrievedIds.includes(citation.document_id) ||
          document?.title !== citation.title ||
          document?.url !== citation.url;
      });
    check(hasUnknownCitation, `${label}: CITATION_UNKNOWN fixture has no unknown citation`);
  }

  const modelElapsed = modelReturns ? scenario.model.elapsed_ms : 0;
  const totalElapsed = (scenario.search?.elapsed_ms ?? 0) + modelElapsed;
  if (scenario.expect?.error_code === "DURATION_LIMIT_EXCEEDED") {
    check(
      totalElapsed > fixture.budgets.duration_ms,
      `${label}: elapsed time does not exceed the duration budget`,
    );
  }

  if (scenario.expect?.error_code === "COST_LIMIT_EXCEEDED") {
    const usage = scenario.model.usage;
    const cost =
      (usage.input_tokens * fixture.pricing.input_usd_per_million) / 1_000_000 +
      (usage.output_tokens * fixture.pricing.output_usd_per_million) / 1_000_000;
    check(cost > fixture.budgets.cost.maximum, `${label}: usage does not exceed the cost budget`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  console.error(`Fixture validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Validated ${documents.length} documents and ${scenarios.length} scenarios.`);
