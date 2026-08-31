import { readFileSync } from "node:fs";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const fixture = loadJson("fixtures/runs.json");
const scenarioFixture = loadJson("fixtures/scenarios.json");

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const unique = (values) => new Set(values).size === values.length;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasExactKeys = (value, keys) => {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isValidInput = (input) =>
  hasExactKeys(input, ["request_id", "report_id", "site_id", "report_text"]) &&
  Object.values(input).every(isNonEmptyString);

const isValidFinding = (finding) =>
  hasExactKeys(finding, ["finding_id", "severity", "text"]) &&
  isNonEmptyString(finding.finding_id) &&
  ["low", "medium", "high"].includes(finding.severity) &&
  isNonEmptyString(finding.text);

const isValidAction = (action) =>
  hasExactKeys(action, ["action_id", "priority", "text"]) &&
  isNonEmptyString(action.action_id) &&
  ["immediate", "next", "monitor"].includes(action.priority) &&
  isNonEmptyString(action.text);

const isValidOutput = (output) =>
  hasExactKeys(output, ["status", "report_id", "summary", "findings", "actions"]) &&
  output.status === "completed" &&
  isNonEmptyString(output.report_id) &&
  isNonEmptyString(output.summary) &&
  Array.isArray(output.findings) && output.findings.every(isValidFinding) &&
  Array.isArray(output.actions) && output.actions.every(isValidAction) &&
  unique(output.findings.map(({ finding_id }) => finding_id)) &&
  unique(output.actions.map(({ action_id }) => action_id));

const isValidEventData = (type, data) => {
  if (type === "run.started") {
    return hasExactKeys(data, ["workflow", "report_id"]) &&
      data.workflow === "CreateFieldBriefing" && isNonEmptyString(data.report_id);
  }
  if (type === "briefing.summary_delta") {
    return hasExactKeys(data, ["text"]) && isNonEmptyString(data.text);
  }
  if (type === "briefing.finding") return isValidFinding(data);
  if (type === "briefing.action") return isValidAction(data);
  if (type === "run.succeeded") {
    return hasExactKeys(data, ["result"]) && isValidOutput(data.result);
  }
  if (type === "run.failed") {
    return hasExactKeys(data, ["error_code"]) && isNonEmptyString(data.error_code);
  }
  if (type === "run.cancelled") {
    return hasExactKeys(data, ["reason"]) && data.reason === "user_requested";
  }
  return false;
};

const allowedEventTypes = new Set([
  "run.started",
  "briefing.summary_delta",
  "briefing.finding",
  "briefing.action",
  "run.succeeded",
  "run.failed",
  "run.cancelled",
]);
const terminalTypes = new Set(["run.succeeded", "run.failed", "run.cancelled"]);
const failureCodes = new Set([
  "REQUEST_ID_CONFLICT",
  "UNSUPPORTED_STREAM_VERSION",
  "CURSOR_INVALID",
  "RUN_NOT_FOUND",
  "RUN_ALREADY_TERMINAL",
  "STREAM_EVENT_INVALID",
  "STREAM_PROJECTION_MISMATCH",
  "MODEL_FAILED",
]);

const isValidMessage = (message) =>
  hasExactKeys(message, [
    "protocol_version", "run_id", "sequence", "cursor", "type", "data",
  ]) &&
  message.protocol_version === 1 &&
  isNonEmptyString(message.run_id) &&
  isNonNegativeInteger(message.sequence) &&
  isNonEmptyString(message.cursor) &&
  allowedEventTypes.has(message.type) &&
  isValidEventData(message.type, message.data);

const project = (messages) => {
  const projection = { summary: "", findings: [], actions: [] };
  for (const message of messages) {
    if (message.type === "briefing.summary_delta") projection.summary += message.data.text;
    if (message.type === "briefing.finding") projection.findings.push(message.data);
    if (message.type === "briefing.action") projection.actions.push(message.data);
  }
  return projection;
};

const terminalStatus = (run) => {
  const terminal = run.messages.at(-1);
  if (terminal?.type === "run.succeeded") return "succeeded";
  if (terminal?.type === "run.failed") return "failed";
  if (terminal?.type === "run.cancelled") return "cancelled";
  return "running";
};

check(fixture.schema_version === 1, "runs: schema_version must be 1");
check(fixture.retention_ms === 86400000, "runs: retention_ms must be 86400000");
check(Array.isArray(fixture.runs), "runs: runs must be an array");
const runs = Array.isArray(fixture.runs) ? fixture.runs : [];
check(unique(runs.map(({ run_id }) => run_id)), "runs: run IDs must be unique");
check(unique(runs.map(({ input }) => input?.request_id)), "runs: request IDs must be unique");

for (const run of runs) {
  const label = `run ${JSON.stringify(run.run_id)}`;
  check(isNonEmptyString(run.run_id), `${label}: run_id is required`);
  check(isNonEmptyString(run.owner_id), `${label}: owner_id is required`);
  check(isValidInput(run.input), `${label}: input does not match input.schema.json`);
  check(run.model_calls === 1, `${label}: model_calls must be 1`);
  check(isObject(run.source) && isNonEmptyString(run.source.behavior), `${label}: source is invalid`);
  check(Array.isArray(run.messages) && run.messages.length >= 2, `${label}: messages are incomplete`);

  const messages = Array.isArray(run.messages) ? run.messages : [];
  for (const [index, message] of messages.entries()) {
    check(isValidMessage(message), `${label}: message ${index} does not match stream-event.schema.json`);
    check(message.run_id === run.run_id, `${label}: message ${index} changed run_id`);
    check(message.sequence === index, `${label}: message sequence must be dense and zero-based`);
  }
  check(unique(messages.map(({ cursor }) => cursor)), `${label}: cursors must be unique`);
  check(messages[0]?.type === "run.started", `${label}: first message must be run.started`);
  check(
    messages[0]?.data?.report_id === run.input?.report_id,
    `${label}: run.started report_id changed`,
  );
  const terminalIndexes = messages
    .map((message, index) => terminalTypes.has(message.type) ? index : -1)
    .filter((index) => index >= 0);
  check(terminalIndexes.length === 1, `${label}: run must have exactly one terminal message`);
  check(terminalIndexes[0] === messages.length - 1, `${label}: terminal message must be last`);
  check(
    !JSON.stringify(messages).includes(run.input?.report_text),
    `${label}: stream leaks report_text`,
  );

  const terminal = messages.at(-1);
  if (terminal?.type === "run.succeeded") {
    const result = terminal.data.result;
    const projection = project(messages);
    check(result.report_id === run.input.report_id, `${label}: result report_id changed`);
    check(result.summary === projection.summary, `${label}: summary does not match streamed deltas`);
    check(equal(result.findings, projection.findings), `${label}: findings do not match stream`);
    check(equal(result.actions, projection.actions), `${label}: actions do not match stream`);
    check(run.source.behavior === "success", `${label}: succeeded run must use success source`);
  }
  if (run.source.behavior === "invalid_stream_event") {
    const rejected = run.source.rejected_event;
    check(
      !isValidEventData(rejected?.type, rejected?.data),
      `${label}: rejected stream event is unexpectedly valid`,
    );
    check(terminal?.data?.error_code === "STREAM_EVENT_INVALID", `${label}: wrong stream error`);
    check(
      !messages.some((message) => equal(message.type, rejected?.type) && equal(message.data, rejected?.data)),
      `${label}: invalid source event reached the client log`,
    );
  }
  if (run.source.behavior === "projection_mismatch") {
    check(isValidOutput(run.source.rejected_result), `${label}: rejected result must be structurally valid`);
    const projection = project(messages);
    check(
      run.source.rejected_result.summary !== projection.summary ||
        !equal(run.source.rejected_result.findings, projection.findings) ||
        !equal(run.source.rejected_result.actions, projection.actions),
      `${label}: projection mismatch fixture unexpectedly matches`,
    );
    check(terminal?.data?.error_code === "STREAM_PROJECTION_MISMATCH", `${label}: wrong mismatch error`);
  }
  if (run.source.behavior === "model_failed") {
    check(terminal?.data?.error_code === "MODEL_FAILED", `${label}: wrong model failure`);
  }
  if (run.source.behavior === "cancelled") {
    check(terminal?.type === "run.cancelled", `${label}: cancelled source needs cancelled terminal`);
    check(isNonEmptyString(run.source.cancel_request_id), `${label}: cancel request ID is required`);
  }
}

const runById = new Map(runs.map((run) => [run.run_id, run]));
check(scenarioFixture.schema_version === 1, "scenarios: schema_version must be 1");
check(Array.isArray(scenarioFixture.scenarios), "scenarios: scenarios must be an array");
const scenarios = Array.isArray(scenarioFixture.scenarios) ? scenarioFixture.scenarios : [];
check(unique(scenarios.map(({ id }) => id)), "scenarios: IDs must be unique");

const validateSequenceArray = (values, label) => {
  check(Array.isArray(values), `${label} must be an array`);
  if (!Array.isArray(values)) return false;
  check(values.every(isNonNegativeInteger), `${label} must contain non-negative integers`);
  return values.every(isNonNegativeInteger);
};

for (const scenario of scenarios) {
  const label = `scenario ${JSON.stringify(scenario.id)}`;
  check(isNonEmptyString(scenario.id), `${label}: id is required`);
  check(["start", "consume", "reconnect", "disconnect", "cancel"].includes(scenario.operation), `${label}: invalid operation`);
  check(isNonEmptyString(scenario.owner_id), `${label}: owner_id is required`);

  if (scenario.operation === "start") {
    const run = runById.get(scenario.input_run_id);
    check(Boolean(run), `${label}: input_run_id is unknown`);
    check(isObject(scenario.input_overrides), `${label}: input_overrides must be an object`);
    const submitted = { ...run?.input, ...scenario.input_overrides };
    check(isValidInput(submitted), `${label}: submitted input is invalid`);
    check(Number.isInteger(scenario.protocol_version), `${label}: protocol_version must be an integer`);
    if (scenario.protocol_version !== 1) {
      check(scenario.expect?.status === "rejected", `${label}: unsupported protocol must be rejected`);
      check(scenario.expect?.error_code === "UNSUPPORTED_STREAM_VERSION", `${label}: wrong protocol error`);
      check(scenario.expect?.model_calls === 0, `${label}: unsupported protocol started a model`);
    } else if (scenario.existing_request_run_id !== null) {
      const existing = runById.get(scenario.existing_request_run_id);
      check(Boolean(existing), `${label}: existing request run is unknown`);
      if (equal(submitted, existing?.input)) {
        check(scenario.expect?.status === "accepted", `${label}: identical retry must be accepted`);
        check(scenario.expect?.existing === true, `${label}: retry must return existing run`);
        check(scenario.expect?.run_id === existing?.run_id, `${label}: retry returned wrong run`);
      } else {
        check(scenario.expect?.status === "rejected", `${label}: changed retry must be rejected`);
        check(scenario.expect?.error_code === "REQUEST_ID_CONFLICT", `${label}: wrong request conflict error`);
      }
      check(scenario.expect?.model_calls === existing?.model_calls, `${label}: retry repeated model work`);
    } else {
      check(scenario.expect?.status === "accepted", `${label}: new start must be accepted`);
      check(scenario.expect?.existing === false, `${label}: new start marked existing`);
      check(scenario.expect?.run_id === run?.run_id, `${label}: start returned wrong run`);
      check(scenario.expect?.model_calls === run?.model_calls, `${label}: wrong model call count`);
    }
    continue;
  }

  const run = runById.get(scenario.run_id);
  check(Boolean(run), `${label}: run_id is unknown`);

  if (scenario.operation === "cancel") {
    check(isNonEmptyString(scenario.request_id), `${label}: cancellation request_id is required`);
    check(scenario.reason === "user_requested", `${label}: cancellation reason is invalid`);
    check(isNonNegativeInteger(scenario.prior_cancellation_requests), `${label}: prior cancellation count is invalid`);
    if (terminalStatus(run) === "cancelled" && scenario.request_id === run?.source.cancel_request_id) {
      check(scenario.expect?.status === "accepted", `${label}: matching cancel must be accepted`);
      check(scenario.expect?.run_status === "cancelled", `${label}: cancel did not end cancelled`);
      check(scenario.expect?.cancellation_requests === 1, `${label}: cancellation was not idempotent`);
      check(
        scenario.expect?.new_terminal_events === (scenario.prior_cancellation_requests === 0 ? 1 : 0),
        `${label}: wrong number of new terminal events`,
      );
    } else if (terminalStatus(run) !== "running") {
      check(scenario.expect?.status === "rejected", `${label}: late cancel must be rejected`);
      check(scenario.expect?.error_code === "RUN_ALREADY_TERMINAL", `${label}: wrong late-cancel error`);
      check(scenario.expect?.new_terminal_events === 0, `${label}: late cancel added terminal event`);
      check(scenario.expect?.cancellation_requests === 0, `${label}: late cancel was recorded`);
    }
    continue;
  }

  validateSequenceArray(scenario.existing_sequences, `${label}: existing_sequences`);
  validateSequenceArray(scenario.delivered_sequences, `${label}: delivered_sequences`);
  validateSequenceArray(scenario.expect?.applied_sequences, `${label}: applied_sequences`);

  if (scenario.operation === "reconnect") {
    check(Number.isInteger(scenario.protocol_version), `${label}: reconnect protocol is invalid`);
    if (run && scenario.owner_id !== run.owner_id) {
      check(scenario.expect?.status === "rejected", `${label}: foreign run was not rejected`);
      check(scenario.expect?.error_code === "RUN_NOT_FOUND", `${label}: foreign run leaked existence`);
      check(scenario.delivered_sequences.length === 0, `${label}: foreign run delivered messages`);
      continue;
    }
    const cursorIndex = scenario.after_cursor === null
      ? -1
      : run?.messages.findIndex(({ cursor }) => cursor === scenario.after_cursor);
    if (scenario.after_cursor !== null && cursorIndex === -1) {
      check(scenario.expect?.status === "rejected", `${label}: invalid cursor was not rejected`);
      check(scenario.expect?.error_code === "CURSOR_INVALID", `${label}: wrong cursor error`);
      check(scenario.delivered_sequences.length === 0, `${label}: invalid cursor delivered messages`);
      continue;
    }
  }

  if (run && scenario.owner_id !== run.owner_id) {
    check(scenario.expect?.status === "rejected", `${label}: foreign run was not rejected`);
    check(scenario.expect?.error_code === "RUN_NOT_FOUND", `${label}: foreign run leaked existence`);
    continue;
  }

  const applied = [...scenario.existing_sequences];
  let duplicates = 0;
  let gap = false;
  for (const sequence of scenario.delivered_sequences) {
    check(sequence < (run?.messages.length ?? 0), `${label}: delivered sequence ${sequence} is unknown`);
    if (applied.includes(sequence)) {
      duplicates += 1;
      continue;
    }
    const expectedNext = applied.length;
    if (sequence !== expectedNext) {
      gap = true;
      break;
    }
    applied.push(sequence);
  }
  check(equal(applied, scenario.expect?.applied_sequences), `${label}: applied sequence projection is wrong`);

  if (gap) {
    check(scenario.expect?.status === "reconnect_required", `${label}: a delivery gap must reconnect`);
    const last = run?.messages[applied.at(-1)];
    check(scenario.expect?.after_cursor === last?.cursor, `${label}: reconnect cursor is wrong`);
    check(scenario.expect?.duplicates_ignored === duplicates, `${label}: duplicate count is wrong`);
    continue;
  }

  if (scenario.operation === "disconnect") {
    check(scenario.expect?.status === "disconnected", `${label}: disconnect status is wrong`);
    check(scenario.expect?.cancellation_requests === 0, `${label}: disconnect triggered cancellation`);
    check(scenario.expect?.run_status === terminalStatus(run), `${label}: disconnect changed run status`);
    check(scenario.expect?.model_calls === run?.model_calls, `${label}: disconnect repeated model work`);
    continue;
  }

  check(scenario.expect?.duplicates_ignored === duplicates, `${label}: duplicate count is wrong`);
  const appliedMessages = applied.map((sequence) => run?.messages[sequence]);
  const terminal = appliedMessages.at(-1);
  if (terminal?.type === "run.succeeded") {
    check(scenario.expect?.status === "completed", `${label}: success terminal did not complete`);
    check(scenario.expect?.result_run_id === run?.run_id, `${label}: result source is wrong`);
  } else if (terminal?.type === "run.failed") {
    check(scenario.expect?.status === "failed", `${label}: failure terminal did not fail`);
    check(scenario.expect?.error_code === terminal.data.error_code, `${label}: failure code changed`);
  } else if (terminal?.type === "run.cancelled") {
    check(scenario.expect?.status === "cancelled", `${label}: cancel terminal did not cancel`);
  }
  if (scenario.operation === "reconnect" && scenario.expect?.status === "completed") {
    check(scenario.expect?.model_calls === run?.model_calls, `${label}: reconnect repeated model work`);
  }
}

const requiredScenarioIds = [
  "start-new-run",
  "start-idempotent-retry",
  "start-request-id-conflict",
  "start-unsupported-protocol",
  "consume-uninterrupted",
  "reconnect-after-cursor",
  "duplicate-delivery",
  "duplicate-reconnect-boundary",
  "delivery-gap",
  "disconnect-does-not-cancel",
  "cancel-active-run",
  "cancel-idempotent-replay",
  "consume-cancelled-terminal",
  "cancel-after-success",
  "reconnect-invalid-cursor",
  "reconnect-wrong-owner",
  "invalid-stream-event-fails-run",
  "projection-mismatch-fails-run",
  "model-failure-reaches-client",
];
for (const id of requiredScenarioIds) {
  check(scenarios.some((scenario) => scenario.id === id), `scenarios: missing ${id}`);
}

for (const scenario of scenarios) {
  if (scenario.expect?.error_code) {
    check(failureCodes.has(scenario.expect.error_code), `scenario ${scenario.id}: unknown error code`);
  }
}

if (errors.length > 0) {
  console.error(`Fixture validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${runs.length} persisted runs and ${scenarios.length} mobile-streaming scenarios.`);
}
