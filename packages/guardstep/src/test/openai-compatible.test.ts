import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAICompatibleModelAdapter,
  OpenAICompatibleModelAdapter,
} from "../providers/index.js";
import type { ModelInvocation } from "../runtime/index.js";

const invocation: ModelInvocation = {
  runId: "run-1",
  stepId: "answer:model",
  profile: "balanced",
  instructions: "Answer only from the supplied context.",
  context: { question: "What is GuardStep?", privateHostState: undefined },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
};

const completionResponse = (
  content: unknown = JSON.stringify({ answer: "A guarded workflow language." }),
): Response => new Response(JSON.stringify({
  id: "chatcmpl-local",
  choices: [{ message: { role: "assistant", content } }],
  usage: { prompt_tokens: 17, completion_tokens: 8, total_tokens: 25 },
}), {
  status: 200,
  headers: { "content-type": "application/json" },
});

test("sends an OpenAI-compatible structured Chat Completions request", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const adapter = createOpenAICompatibleModelAdapter({
    baseUrl: "http://127.0.0.1:11434/v1/",
    apiKey: "ollama",
    profiles: {
      balanced: {
        model: "qwen3.5:4b",
        temperature: 0,
        maxTokens: 500,
        includeSchemaInPrompt: true,
      },
    },
    fetch: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return completionResponse();
    },
  });

  const result = await adapter.generate(invocation);

  assert.equal(capturedUrl, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer ollama");
  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    model: "qwen3.5:4b",
    messages: [
      { role: "system", content: invocation.instructions },
      {
        role: "user",
        content: JSON.stringify({
          context: invocation.context,
          output_schema: invocation.outputSchema,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "guardstep_answer_model",
        strict: true,
        schema: invocation.outputSchema,
      },
    },
    stream: false,
    temperature: 0,
    max_tokens: 500,
  });
  assert.deepEqual(result.status === "succeeded" ? result.value : undefined, {
    answer: "A guarded workflow language.",
  });
  assert.deepEqual(result.status === "succeeded" ? result.usage : undefined, {
    input_tokens: 17,
    output_tokens: 8,
  });
});

test("does not invent an authorization header when no API key is configured", async () => {
  let authorization: string | null | undefined;
  const adapter = new OpenAICompatibleModelAdapter({
    baseUrl: "http://localhost:11434/v1",
    profiles: { balanced: { model: "local-model" } },
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return completionResponse();
    },
  });

  const result = await adapter.generate(invocation);

  assert.equal(result.status, "succeeded");
  assert.equal(authorization, null);
});

test("fails closed for an undeclared model profile without making a request", async () => {
  let calls = 0;
  const adapter = new OpenAICompatibleModelAdapter({
    baseUrl: "http://localhost:11434/v1",
    profiles: { fast: { model: "local-model" } },
    fetch: async () => {
      calls += 1;
      return completionResponse();
    },
  });

  const result = await adapter.generate(invocation);

  assert.deepEqual(
    result.status === "failed" ? result.code : undefined,
    "PROVIDER_PROFILE_NOT_FOUND",
  );
  assert.equal(calls, 0);
});

test("returns invalid assistant JSON as a value for runtime schema validation", async () => {
  const adapter = new OpenAICompatibleModelAdapter({
    baseUrl: "http://localhost:11434/v1",
    profiles: { balanced: { model: "local-model" } },
    fetch: async () => completionResponse("not json"),
  });

  const result = await adapter.generate(invocation);

  assert.equal(result.status, "succeeded");
  assert.equal(result.status === "succeeded" ? result.value : undefined, "not json");
});

test("does not expose provider error bodies through adapter results", async () => {
  const adapter = new OpenAICompatibleModelAdapter({
    baseUrl: "https://models.example.com/v1",
    apiKey: "secret-key",
    profiles: { balanced: { model: "remote-model" } },
    fetch: async () => new Response("account secret and provider internals", { status: 401 }),
  });

  const result = await adapter.generate(invocation);

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.code : undefined, "PROVIDER_HTTP_ERROR");
  assert.doesNotMatch(JSON.stringify(result), /account secret|provider internals|secret-key/);
});

test("rejects malformed and oversized successful responses", async (context) => {
  await context.test("malformed response", async () => {
    const adapter = new OpenAICompatibleModelAdapter({
      baseUrl: "http://localhost:11434/v1",
      profiles: { balanced: { model: "local-model" } },
      fetch: async () => new Response("not json", { status: 200 }),
    });
    const result = await adapter.generate(invocation);
    assert.equal(result.status === "failed" ? result.code : undefined, "PROVIDER_INVALID_RESPONSE");
  });

  await context.test("missing usage", async () => {
    const adapter = new OpenAICompatibleModelAdapter({
      baseUrl: "http://localhost:11434/v1",
      profiles: { balanced: { model: "local-model" } },
      fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "{}" } }],
      })),
    });
    const result = await adapter.generate(invocation);
    assert.equal(result.status === "failed" ? result.code : undefined, "PROVIDER_INVALID_RESPONSE");
  });

  await context.test("oversized response", async () => {
    const adapter = new OpenAICompatibleModelAdapter({
      baseUrl: "http://localhost:11434/v1",
      profiles: { balanced: { model: "local-model" } },
      maxResponseBytes: 10,
      fetch: async () => completionResponse(),
    });
    const result = await adapter.generate(invocation);
    assert.equal(result.status === "failed" ? result.code : undefined, "PROVIDER_RESPONSE_TOO_LARGE");
  });
});

test("aborts provider requests at the configured timeout", async () => {
  const adapter = new OpenAICompatibleModelAdapter({
    baseUrl: "http://localhost:11434/v1",
    profiles: { balanced: { model: "local-model" } },
    timeoutMs: 1,
    fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  const result = await adapter.generate(invocation);

  assert.equal(result.status === "failed" ? result.code : undefined, "PROVIDER_TIMEOUT");
});

test("validates provider configuration before any workflow can run", () => {
  assert.throws(
    () => new OpenAICompatibleModelAdapter({
      baseUrl: "http://models.example.com/v1",
      profiles: { balanced: { model: "remote-model" } },
    }),
    /must use HTTPS/,
  );
  assert.throws(
    () => new OpenAICompatibleModelAdapter({
      baseUrl: "https://user:password@models.example.com/v1",
      profiles: { balanced: { model: "remote-model" } },
    }),
    /must not contain credentials/,
  );
  assert.throws(
    () => new OpenAICompatibleModelAdapter({
      baseUrl: "http://localhost:11434/v1",
      profiles: {},
    }),
    /At least one/,
  );
});
