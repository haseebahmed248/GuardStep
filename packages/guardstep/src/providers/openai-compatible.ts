import type {
  ModelAdapter,
  ModelInvocation,
  ModelResult,
  TokenUsage,
} from "../runtime/index.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export interface OpenAICompatibleProfile {
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly includeSchemaInPrompt?: boolean;
}

export interface OpenAICompatibleAdapterOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly profiles: Readonly<Record<string, OpenAICompatibleProfile>>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
  readonly fetch?: typeof globalThis.fetch;
}

interface NormalizedOptions {
  readonly endpoint: URL;
  readonly apiKey?: string;
  readonly profiles: ReadonlyMap<string, OpenAICompatibleProfile>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly fetch: typeof globalThis.fetch;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const validateBaseUrl = (value: string, allowInsecureHttp: boolean): URL => {
  let baseUrl: URL;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new TypeError("OpenAI-compatible baseUrl must be a valid absolute URL");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new TypeError("OpenAI-compatible baseUrl must use HTTP or HTTPS");
  }
  if (baseUrl.username !== "" || baseUrl.password !== "") {
    throw new TypeError("OpenAI-compatible baseUrl must not contain credentials");
  }
  if (baseUrl.search !== "" || baseUrl.hash !== "") {
    throw new TypeError("OpenAI-compatible baseUrl must not contain a query or fragment");
  }
  if (baseUrl.protocol === "http:" && !isLoopback(baseUrl.hostname) && !allowInsecureHttp) {
    throw new TypeError(
      "Remote OpenAI-compatible endpoints must use HTTPS; set allowInsecureHttp only for a trusted private network",
    );
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
  return new URL("chat/completions", baseUrl);
};

const validateProfile = (name: string, profile: OpenAICompatibleProfile): OpenAICompatibleProfile => {
  if (name.trim() === "") throw new TypeError("OpenAI-compatible profile names must not be empty");
  if (profile.model.trim() === "") {
    throw new TypeError(`OpenAI-compatible profile ${name} must specify a model`);
  }
  if (
    profile.temperature !== undefined &&
    (!Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2)
  ) {
    throw new TypeError(`OpenAI-compatible profile ${name} temperature must be between 0 and 2`);
  }
  if (profile.maxTokens !== undefined && !isPositiveInteger(profile.maxTokens)) {
    throw new TypeError(`OpenAI-compatible profile ${name} maxTokens must be a positive integer`);
  }
  if (
    profile.includeSchemaInPrompt !== undefined &&
    typeof profile.includeSchemaInPrompt !== "boolean"
  ) {
    throw new TypeError(`OpenAI-compatible profile ${name} includeSchemaInPrompt must be boolean`);
  }
  return Object.freeze({ ...profile });
};

const normalizeOptions = (options: OpenAICompatibleAdapterOptions): NormalizedOptions => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!isPositiveInteger(timeoutMs)) throw new TypeError("timeoutMs must be a positive integer");
  if (!isPositiveInteger(maxResponseBytes)) {
    throw new TypeError("maxResponseBytes must be a positive integer");
  }
  if (options.apiKey !== undefined && options.apiKey.trim() === "") {
    throw new TypeError("apiKey must not be blank when provided");
  }

  const profiles = new Map(
    Object.entries(options.profiles).map(([name, profile]) => [name, validateProfile(name, profile)]),
  );
  if (profiles.size === 0) throw new TypeError("At least one OpenAI-compatible profile is required");

  return {
    endpoint: validateBaseUrl(options.baseUrl, options.allowInsecureHttp ?? false),
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    profiles,
    timeoutMs,
    maxResponseBytes,
    fetch: options.fetch ?? globalThis.fetch,
  };
};

const elapsedSince = (startedAt: number): number => Math.max(0, performance.now() - startedAt);

const failed = (code: string, startedAt: number): ModelResult => ({
  status: "failed",
  code,
  elapsedMs: elapsedSince(startedAt),
});

const schemaName = (stepId: string): string => {
  const normalized = stepId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  return `guardstep_${normalized || "output"}`;
};

const parseUsage = (value: unknown): TokenUsage | undefined => {
  if (!isRecord(value)) return undefined;
  if (!isNonNegativeInteger(value.prompt_tokens) || !isNonNegativeInteger(value.completion_tokens)) {
    return undefined;
  }
  return {
    input_tokens: value.prompt_tokens,
    output_tokens: value.completion_tokens,
  };
};

const parseCompletion = (
  value: unknown,
): { readonly value: unknown; readonly usage: TokenUsage } | undefined => {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    return undefined;
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || !("content" in choice.message)) {
    return undefined;
  }
  const usage = parseUsage(value.usage);
  if (usage === undefined) return undefined;

  const content = choice.message.content;
  if (typeof content !== "string") return { value: content, usage };
  try {
    return { value: JSON.parse(content) as unknown, usage };
  } catch {
    // The runtime owns schema validation and maps invalid model values to the
    // workflow's declared `on invalid` failure.
    return { value: content, usage };
  }
};

const responseIsTooLarge = (response: Response, maxResponseBytes: number): boolean => {
  const header = response.headers.get("content-length");
  if (header === null) return false;
  const declaredLength = Number(header);
  return Number.isFinite(declaredLength) && declaredLength > maxResponseBytes;
};

const readResponseText = async (
  response: Response,
  maxResponseBytes: number,
): Promise<{ readonly status: "succeeded"; readonly text: string } | { readonly status: "too_large" }> => {
  if (responseIsTooLarge(response, maxResponseBytes)) {
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup must not replace the known size failure with a network error.
    }
    return { status: "too_large" };
  }
  if (response.body === null) return { status: "succeeded", text: "" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxResponseBytes) {
        await reader.cancel();
        return { status: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return { status: "succeeded", text: text + decoder.decode() };
  } finally {
    reader.releaseLock();
  }
};

export class OpenAICompatibleModelAdapter implements ModelAdapter {
  readonly #options: NormalizedOptions;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.#options = normalizeOptions(options);
  }

  async generate(request: ModelInvocation): Promise<ModelResult> {
    const startedAt = performance.now();
    const profile = this.#options.profiles.get(request.profile);
    if (profile === undefined) return failed("PROVIDER_PROFILE_NOT_FOUND", startedAt);

    const controller = new AbortController();
    let abortSource: "provider_timeout" | "runtime" | undefined;
    const abortFromRuntime = (): void => {
      abortSource ??= "runtime";
      controller.abort(request.signal.reason);
    };
    if (request.signal.aborted) abortFromRuntime();
    else request.signal.addEventListener("abort", abortFromRuntime, { once: true });
    const timeout = setTimeout(() => {
      abortSource ??= "provider_timeout";
      controller.abort();
    }, this.#options.timeoutMs);
    try {
      const userContent = profile.includeSchemaInPrompt === true
        ? JSON.stringify({ context: request.context, output_schema: request.outputSchema })
        : JSON.stringify(request.context);
      const response = await this.#options.fetch(this.#options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#options.apiKey === undefined
            ? {}
            : { authorization: `Bearer ${this.#options.apiKey}` }),
        },
        body: JSON.stringify({
          model: profile.model,
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName(request.stepId),
              strict: true,
              schema: request.outputSchema,
            },
          },
          stream: false,
          ...(profile.temperature === undefined ? {} : { temperature: profile.temperature }),
          ...(profile.maxTokens === undefined ? {} : { max_tokens: profile.maxTokens }),
        }),
        signal: controller.signal,
      });

      const responseBody = await readResponseText(response, this.#options.maxResponseBytes);
      if (responseBody.status === "too_large") {
        return failed("PROVIDER_RESPONSE_TOO_LARGE", startedAt);
      }
      if (!response.ok) return failed("PROVIDER_HTTP_ERROR", startedAt);

      let responseValue: unknown;
      try {
        responseValue = JSON.parse(responseBody.text) as unknown;
      } catch {
        return failed("PROVIDER_INVALID_RESPONSE", startedAt);
      }
      const completion = parseCompletion(responseValue);
      if (completion === undefined) return failed("PROVIDER_INVALID_RESPONSE", startedAt);
      return {
        status: "succeeded",
        value: completion.value,
        usage: completion.usage,
        elapsedMs: elapsedSince(startedAt),
      };
    } catch {
      const code = abortSource === "provider_timeout"
        ? "PROVIDER_TIMEOUT"
        : abortSource === "runtime"
          ? "PROVIDER_ABORTED"
          : "PROVIDER_NETWORK_ERROR";
      return failed(code, startedAt);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromRuntime);
    }
  }
}

export const createOpenAICompatibleModelAdapter = (
  options: OpenAICompatibleAdapterOptions,
): ModelAdapter => new OpenAICompatibleModelAdapter(options);
