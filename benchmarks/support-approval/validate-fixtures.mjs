import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const accountsFixture = loadJson("fixtures/accounts.json");
const fixture = loadJson("fixtures/scenarios.json");
const eventSchema = loadJson("../../schemas/execution-event.v1.schema.json");

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const unique = (values) => new Set(values).size === values.length;
const hasExactKeys = (value, keys) => {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const digestPlan = ({ workspace_id, target_user_id }) => {
  const canonical = JSON.stringify({
    action: "disable_mfa",
    target_user_id,
    workspace_id,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
};

const isValidInput = (input) =>
  hasExactKeys(input, ["ticket_id", "workspace_id", "target_user_id", "request_text"]) &&
  Object.values(input).every(isNonEmptyString);

const isValidActionPlan = (plan) =>
  hasExactKeys(plan, ["action", "reason", "message"]) &&
  ["respond_only", "disable_mfa"].includes(plan.action) &&
  isNonEmptyString(plan.reason) &&
  isNonEmptyString(plan.message);

const isValidOutput = (output) => {
  if (!hasExactKeys(output, ["status", "ticket_id", "action", "message", "operation_id"])) {
    return false;
  }
  if (!isNonEmptyString(output.ticket_id) || !isNonEmptyString(output.message)) return false;
  if (output.status === "responded") {
    return output.action === "none" && output.operation_id === null;
  }
  if (output.status === "executed") {
    return output.action === "disable_mfa" && isNonEmptyString(output.operation_id);
  }
  if (output.status === "declined") {
    return output.action === "disable_mfa" && output.operation_id === null;
  }
  return false;
};

const isValidResumeSignal = (signal) =>
  hasExactKeys(signal, [
    "run_id", "approval_id", "step_id", "plan_digest", "outcome", "approver",
  ]) &&
  isNonEmptyString(signal.run_id) &&
  isNonEmptyString(signal.approval_id) &&
  signal.step_id === "approval:disable-mfa" &&
  /^sha256:[0-9a-f]{64}$/.test(signal.plan_digest) &&
  ["approved", "denied"].includes(signal.outcome) &&
  hasExactKeys(signal.approver, ["user_id", "roles"]) &&
  isNonEmptyString(signal.approver.user_id) &&
  Array.isArray(signal.approver.roles) &&
  signal.approver.roles.every(isNonEmptyString) &&
  unique(signal.approver.roles) &&
  signal.approver.roles.includes("workspace_owner");

const isValidSuspension = (suspension) => {
  const approval = suspension?.approval;
  return hasExactKeys(suspension, ["status", "run_id", "approval"]) &&
    suspension.status === "suspended" &&
    isNonEmptyString(suspension.run_id) &&
    hasExactKeys(approval, [
      "approval_id", "step_id", "action", "workspace_id", "target_user_id",
      "requested_role", "summary", "plan_digest", "expires_after_ms",
    ]) &&
    isNonEmptyString(approval.approval_id) &&
    approval.step_id === "approval:disable-mfa" &&
    approval.action === "disable_mfa" &&
    isNonEmptyString(approval.workspace_id) &&
    isNonEmptyString(approval.target_user_id) &&
    approval.requested_role === "workspace_owner" &&
    isNonEmptyString(approval.summary) &&
    /^sha256:[0-9a-f]{64}$/.test(approval.plan_digest) &&
    Number.isInteger(approval.expires_after_ms) && approval.expires_after_ms > 0;
};

const canonicalEvents = new Set(eventSchema.$defs.envelope.properties.type.enum);
const candidateApprovalEvents = new Set([
  "approval.requested", "run.suspended", "run.resumed", "approval.resolved",
]);
const allowedEvents = new Set([...canonicalEvents, ...candidateApprovalEvents]);
const failureCodes = new Set([
  "CAPABILITY_DENIED",
  "ACCOUNT_LOOKUP_TIMEOUT",
  "ACCOUNT_CONTEXT_MISMATCH",
  "MODEL_OUTPUT_INVALID",
  "APPROVAL_EXPIRED",
  "APPROVAL_SIGNAL_INVALID",
  "MUTATION_TIMEOUT",
  "MUTATION_RESULT_MISMATCH",
  "COST_LIMIT_EXCEEDED",
  "DURATION_LIMIT_EXCEEDED",
]);

const validateEvents = (events, label, terminalStatus, allowEmpty = false) => {
  check(Array.isArray(events), `${label}: required_events must be an array`);
  if (!Array.isArray(events)) return;
  if (allowEmpty && events.length === 0) return;
  check(events.length >= 2, `${label}: required_events is incomplete`);
  check(events[0] === "run.started", `${label}: first event must be run.started`);
  const expectedLast = {
    succeeded: "run.succeeded",
    failed: "run.failed",
    suspended: "run.suspended",
  }[terminalStatus];
  check(events.at(-1) === expectedLast, `${label}: final event must be ${expectedLast}`);
  for (const event of events) {
    check(allowedEvents.has(event), `${label}: unknown event ${JSON.stringify(event)}`);
  }
};

check(accountsFixture.schema_version === 1, "accounts: schema_version must be 1");
check(Array.isArray(accountsFixture.accounts), "accounts: accounts must be an array");
const accounts = Array.isArray(accountsFixture.accounts) ? accountsFixture.accounts : [];
const accountKeys = accounts.map(({ workspace_id, target_user_id }) =>
  `${workspace_id}/${target_user_id}`);
check(unique(accountKeys), "accounts: workspace/user keys must be unique");

for (const account of accounts) {
  const label = `account ${JSON.stringify(`${account.workspace_id}/${account.target_user_id}`)}`;
  check(
    hasExactKeys(account, [
      "workspace_id", "target_user_id", "display_name", "account_state", "mfa_enabled",
    ]),
    `${label}: unexpected account fields`,
  );
  check(isNonEmptyString(account.workspace_id), `${label}: workspace_id is required`);
  check(isNonEmptyString(account.target_user_id), `${label}: target_user_id is required`);
  check(isNonEmptyString(account.display_name), `${label}: display_name is required`);
  check(["active", "suspended"].includes(account.account_state), `${label}: invalid account_state`);
  check(typeof account.mfa_enabled === "boolean", `${label}: mfa_enabled must be boolean`);
}

const accountByKey = new Map(accounts.map((account) => [
  `${account.workspace_id}/${account.target_user_id}`,
  account,
]));

check(fixture.schema_version === 1, "scenarios: schema_version must be 1");
check(fixture.budgets?.tool_calls === 2, "budgets: tool_calls must be 2");
check(fixture.budgets?.model_calls === 1, "budgets: model_calls must be 1");
check(fixture.budgets?.active_duration_ms === 20000, "budgets: active_duration_ms must be 20000");
check(
  fixture.budgets?.approval_expires_after_ms === 86400000,
  "budgets: approval_expires_after_ms must be 86400000",
);
check(fixture.budgets?.cost?.currency === "USD", "budgets: currency must be USD");
check(fixture.budgets?.cost?.maximum === 0.05, "budgets: maximum cost must be 0.05");
check(
  typeof fixture.pricing?.input_usd_per_million === "number" &&
    fixture.pricing.input_usd_per_million >= 0,
  "pricing: input price must be non-negative",
);
check(
  typeof fixture.pricing?.output_usd_per_million === "number" &&
    fixture.pricing.output_usd_per_million >= 0,
  "pricing: output price must be non-negative",
);
check(Array.isArray(fixture.scenarios), "scenarios: scenarios must be an array");

for (const event of candidateApprovalEvents) {
  check(
    !canonicalEvents.has(event),
    `events: ${event} unexpectedly appears in v1; update the benchmark's versioning note`,
  );
}

const scenarios = Array.isArray(fixture.scenarios) ? fixture.scenarios : [];
check(unique(scenarios.map(({ id }) => id)), "scenarios: IDs must be unique");

for (const scenario of scenarios) {
  const label = `scenario ${JSON.stringify(scenario.id)}`;
  check(isNonEmptyString(scenario.id), `${label}: id must be a non-empty string`);
  check(isValidInput(scenario.input), `${label}: input does not match input.schema.json`);
  check(
    Array.isArray(scenario.initial_granted_capabilities) &&
      scenario.initial_granted_capabilities.every(isNonEmptyString) &&
      unique(scenario.initial_granted_capabilities),
    `${label}: initial capabilities must be a unique string array`,
  );
  check(
    Array.isArray(scenario.resume_granted_capabilities) &&
      scenario.resume_granted_capabilities.every(isNonEmptyString) &&
      unique(scenario.resume_granted_capabilities),
    `${label}: resume capabilities must be a unique string array`,
  );

  const inputKey = `${scenario.input?.workspace_id}/${scenario.input?.target_user_id}`;
  check(accountByKey.has(inputKey), `${label}: input references an unknown account`);

  const lookupBehavior = scenario.lookup?.behavior;
  check(["return", "timeout", "not_reached"].includes(lookupBehavior), `${label}: invalid lookup behavior`);
  if (["return", "timeout"].includes(lookupBehavior)) {
    check(isNonNegativeInteger(scenario.lookup.elapsed_ms), `${label}: lookup elapsed_ms is invalid`);
  }
  if (lookupBehavior === "return") {
    check(accountByKey.has(scenario.lookup.account_key), `${label}: lookup returned an unknown account`);
  }

  const modelBehavior = scenario.model?.behavior;
  check(["return", "not_reached"].includes(modelBehavior), `${label}: invalid model behavior`);
  let planIsValid = false;
  if (modelBehavior === "return") {
    check(isNonNegativeInteger(scenario.model.elapsed_ms), `${label}: model elapsed_ms is invalid`);
    check(
      isNonNegativeInteger(scenario.model.usage?.input_tokens),
      `${label}: model input_tokens is invalid`,
    );
    check(
      isNonNegativeInteger(scenario.model.usage?.output_tokens),
      `${label}: model output_tokens is invalid`,
    );
    planIsValid = isValidActionPlan(scenario.model.output);
    if (scenario.expect?.initial?.error_code === "MODEL_OUTPUT_INVALID") {
      check(!planIsValid, `${label}: MODEL_OUTPUT_INVALID needs an invalid action plan`);
    } else {
      check(planIsValid, `${label}: model output must be a valid action plan`);
    }
  }

  const approvalBehavior = scenario.approval?.behavior;
  check(["pending", "not_reached"].includes(approvalBehavior), `${label}: invalid approval behavior`);
  const expectedDigest = digestPlan(scenario.input ?? {});
  if (approvalBehavior === "pending") {
    check(isNonEmptyString(scenario.approval.approval_id), `${label}: approval_id is required`);
    check(scenario.approval.plan_digest === expectedDigest, `${label}: approval plan digest is incorrect`);
    check(
      planIsValid && scenario.model.output.action === "disable_mfa",
      `${label}: approval may only follow a valid disable_mfa plan`,
    );
    const resume = scenario.approval.resume;
    check(
      resume === null || resume?.kind === "expired" || resume?.kind === "signal",
      `${label}: invalid resume fixture`,
    );
    if (resume?.kind === "signal") {
      check(isValidResumeSignal(resume.value), `${label}: resume signal is structurally invalid`);
    }
  }

  const mutationBehavior = scenario.mutation?.behavior;
  check(
    ["return", "timeout", "not_reached"].includes(mutationBehavior),
    `${label}: invalid mutation behavior`,
  );
  if (["return", "timeout"].includes(mutationBehavior)) {
    check(isNonNegativeInteger(scenario.mutation.elapsed_ms), `${label}: mutation elapsed_ms is invalid`);
  }
  if (mutationBehavior === "return") {
    check(
      hasExactKeys(scenario.mutation.result, ["workspace_id", "target_user_id", "operation_id"]),
      `${label}: mutation result has unexpected fields`,
    );
    check(isNonEmptyString(scenario.mutation.result?.operation_id), `${label}: operation_id is required`);
  }

  const initial = scenario.expect?.initial;
  check(["succeeded", "failed", "suspended"].includes(initial?.status), `${label}: invalid initial status`);
  validateEvents(initial?.required_events, `${label} initial`, initial?.status);
  if (initial?.status === "succeeded") {
    check(isValidOutput(initial.output), `${label}: initial output does not match output.schema.json`);
    check(initial.output?.ticket_id === scenario.input.ticket_id, `${label}: output ticket_id changed`);
    check(!("error_code" in initial), `${label}: successful initial result has an error code`);
  } else if (initial?.status === "failed") {
    check(failureCodes.has(initial.error_code), `${label}: unknown initial error code`);
    check(!("output" in initial), `${label}: failed initial result has an output`);
  } else if (initial?.status === "suspended") {
    check(isValidSuspension(initial.suspension), `${label}: suspension does not match suspension.schema.json`);
    if (isValidSuspension(initial.suspension)) {
      const { approval } = initial.suspension;
      check(approval.approval_id === scenario.approval.approval_id, `${label}: suspension approval_id changed`);
      check(approval.workspace_id === scenario.input.workspace_id, `${label}: suspension workspace changed`);
      check(approval.target_user_id === scenario.input.target_user_id, `${label}: suspension user changed`);
      check(approval.plan_digest === expectedDigest, `${label}: suspension digest changed`);
      check(
        approval.expires_after_ms === fixture.budgets.approval_expires_after_ms,
        `${label}: suspension expiry changed`,
      );
      const serialized = JSON.stringify(initial.suspension);
      check(!serialized.includes(scenario.input.request_text), `${label}: suspension leaks request_text`);
      const account = accountByKey.get(inputKey);
      check(!serialized.includes(account.display_name), `${label}: suspension leaks account display_name`);
      check(!("reason" in approval), `${label}: suspension leaks model reasoning`);
    }
  }

  const resumeExpected = scenario.expect?.resume;
  const resumeFixture = scenario.approval?.resume;
  check(
    (resumeFixture === null || resumeFixture === undefined) === (resumeExpected === null),
    `${label}: resume fixture and expectation disagree`,
  );
  if (resumeExpected !== null) {
    check(
      ["succeeded", "failed", "rejected"].includes(resumeExpected?.status),
      `${label}: invalid resume status`,
    );
    validateEvents(
      resumeExpected?.required_events,
      `${label} resume`,
      resumeExpected?.status,
      resumeExpected?.status === "rejected",
    );
    if (resumeExpected?.status === "succeeded") {
      check(isValidOutput(resumeExpected.output), `${label}: resume output is invalid`);
      check(resumeExpected.output?.ticket_id === scenario.input.ticket_id, `${label}: resume ticket_id changed`);
    } else {
      check(failureCodes.has(resumeExpected?.error_code), `${label}: unknown resume error code`);
    }
    if (resumeExpected?.status === "rejected") {
      check(resumeExpected.run_status === "suspended", `${label}: rejected signal must leave run suspended`);
      check(resumeExpected.error_code === "APPROVAL_SIGNAL_INVALID", `${label}: wrong rejection code`);
      check(resumeExpected.required_events?.length === 0, `${label}: rejected signal must emit no workflow events`);
    }
  }

  const signal = resumeFixture?.kind === "signal" ? resumeFixture.value : null;
  if (signal) {
    const suspension = initial?.suspension;
    const bindingMatches =
      signal.run_id === suspension?.run_id &&
      signal.approval_id === suspension?.approval?.approval_id &&
      signal.step_id === suspension?.approval?.step_id &&
      signal.plan_digest === suspension?.approval?.plan_digest;
    if (resumeExpected?.status === "rejected") {
      check(!bindingMatches, `${label}: rejected signal unexpectedly matches its suspension`);
    } else {
      check(bindingMatches, `${label}: accepted signal does not match its suspension`);
    }
  }

  if (resumeFixture?.kind === "expired") {
    check(resumeExpected?.error_code === "APPROVAL_EXPIRED", `${label}: expired approval has wrong result`);
  }
  if (signal?.outcome === "denied") {
    check(resumeExpected?.output?.status === "declined", `${label}: denial must be a declined success`);
    check(mutationBehavior === "not_reached", `${label}: denial reached the mutation`);
  }
  if (signal?.outcome === "approved" && resumeExpected?.status !== "rejected") {
    const mutationGranted = scenario.resume_granted_capabilities.includes("support.account.disable_mfa");
    if (!mutationGranted) {
      check(resumeExpected?.error_code === "CAPABILITY_DENIED", `${label}: missing mutation grant has wrong result`);
      check(mutationBehavior === "not_reached", `${label}: denied mutation capability reached the tool`);
    } else {
      check(mutationBehavior !== "not_reached", `${label}: approved and granted action never reached mutation`);
    }
  }
  if (resumeExpected?.error_code === "MUTATION_RESULT_MISMATCH") {
    check(
      scenario.mutation.result?.workspace_id !== scenario.input.workspace_id ||
        scenario.mutation.result?.target_user_id !== scenario.input.target_user_id,
      `${label}: mutation mismatch fixture returned the requested target`,
    );
  }

  const expectedLookupCalls = lookupBehavior === "not_reached" ? 0 : 1;
  const expectedModelCalls = modelBehavior === "not_reached" ? 0 : 1;
  const expectedMutationCalls = mutationBehavior === "not_reached" ? 0 : 1;
  check(scenario.expect?.lookup_calls === expectedLookupCalls, `${label}: wrong lookup call count`);
  check(scenario.expect?.model_calls === expectedModelCalls, `${label}: wrong model call count`);
  check(scenario.expect?.mutation_calls === expectedMutationCalls, `${label}: wrong mutation call count`);

  const activeElapsed =
    (scenario.lookup?.elapsed_ms ?? 0) +
    (scenario.model?.elapsed_ms ?? 0) +
    (scenario.mutation?.elapsed_ms ?? 0);
  if (initial?.error_code === "DURATION_LIMIT_EXCEEDED") {
    check(activeElapsed > fixture.budgets.active_duration_ms, `${label}: duration does not exceed budget`);
  }
  if (initial?.error_code === "COST_LIMIT_EXCEEDED") {
    const usage = scenario.model?.usage ?? {};
    const cost =
      (usage.input_tokens * fixture.pricing.input_usd_per_million / 1_000_000) +
      (usage.output_tokens * fixture.pricing.output_usd_per_million / 1_000_000);
    check(cost > fixture.budgets.cost.maximum, `${label}: model cost does not exceed budget`);
  }

  const replay = scenario.expect?.replay;
  if (replay !== null) {
    check(resumeExpected?.status === "succeeded", `${label}: replay needs a successful first resume`);
    check(replay?.status === "succeeded", `${label}: replay must return success`);
    check(replay?.returns_stored_output === true, `${label}: replay must return stored output`);
    check(Array.isArray(replay?.new_events) && replay.new_events.length === 0, `${label}: replay must emit no new events`);
    check(replay?.additional_mutation_calls === 0, `${label}: replay must not repeat mutation`);
    check(scenario.expect.mutation_calls === 1, `${label}: replay case must mutate exactly once`);
  }
}

const requiredScenarioIds = [
  "respond-only",
  "disable-mfa-pending",
  "disable-mfa-approved",
  "disable-mfa-denied",
  "approval-expired",
  "read-capability-denied",
  "lookup-timeout",
  "account-context-mismatch",
  "model-output-invalid",
  "mutation-capability-denied",
  "mutation-timeout",
  "mutation-result-mismatch",
  "cost-limit-exceeded",
  "duration-limit-exceeded",
  "resume-binding-mismatch",
];
for (const id of requiredScenarioIds) {
  check(scenarios.some((scenario) => scenario.id === id), `scenarios: missing ${id}`);
}

if (errors.length > 0) {
  console.error(`Fixture validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${accounts.length} accounts and ${scenarios.length} support-approval scenarios.`);
}
