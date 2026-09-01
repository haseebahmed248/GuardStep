# Model providers

GuardStep workflows name model profiles such as `balanced`; they do not name vendors. A trusted host maps those profiles to a deployment-owned model adapter.

## Ollama: local and no API key

The document Q&A example includes an Ollama host using the OpenAI-compatible Chat Completions endpoint. Ollama runs the model locally, so this path has no per-request API charge and does not require an OpenAI key.

Install Ollama, start it, and pull the example model once:

```bash
ollama serve
ollama pull qwen2.5:3b
```

Then, from the repository root:

```bash
npm run demo:ollama
```

The command builds GuardStep and runs `examples/document-qa/answer.guard` with the neighboring input fixture and the Ollama host. Change the question in `examples/document-qa/answer.input.json` and run it again.

The defaults can be changed without editing source:

```bash
GUARDSTEP_MODEL=another-model \
GUARDSTEP_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
npm run demo:ollama
```

Ollama implements a compatible subset of the OpenAI API; it is not the same service or model quality as OpenAI. Hardware, model choice, response quality, and latency remain local concerns.

## Other OpenAI-compatible endpoints

The adapter is exported from `guardstep/providers` and uses the standard non-streaming `/chat/completions` request shape:

```ts
import { createOpenAICompatibleModelAdapter } from "guardstep/providers";

const model = createOpenAICompatibleModelAdapter({
  baseUrl: "https://models.example.com/v1",
  apiKey: process.env.MODEL_API_KEY,
  profiles: {
    balanced: {
      model: "provider-model-name",
      temperature: 0,
      maxTokens: 1000,
    },
  },
});
```

For each model step, the adapter sends:

- the workflow instructions as the system message;
- only the context declared by that model step as the user message;
- the compiled output JSON Schema through `response_format`; and
- the model selected by the host's named profile.

Set `includeSchemaInPrompt: true` for smaller local models that need extra schema grounding. The Ollama example enables it following Ollama's structured-output guidance; hosted providers can leave it off to avoid repeating schema tokens.

It maps `prompt_tokens` and `completion_tokens` back to GuardStep usage so the runtime can enforce cost budgets. Missing usage, malformed responses, network failures, HTTP failures, oversized bodies, and timeouts fail closed. Invalid assistant JSON is passed to the runtime's schema validator and becomes the workflow's declared `on invalid` failure.

Remote endpoints require HTTPS by default. Plain HTTP is accepted automatically only for loopback Ollama URLs. `allowInsecureHttp` exists for an explicitly trusted private network. API keys are sent only in the Authorization header and provider response bodies are not copied into workflow events.
