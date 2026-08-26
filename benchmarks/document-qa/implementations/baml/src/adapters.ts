import type {
  BamlModelRequest,
  Document,
  ModelAdapter,
  ModelResult,
  Scenario,
  SearchAdapter,
  SearchResult,
} from "./types.js";

export class FixtureSearchAdapter implements SearchAdapter {
  readonly questions: string[] = [];

  constructor(
    readonly scenario: Scenario,
    readonly documents: ReadonlyMap<string, Document>,
  ) {}

  async search(question: string): Promise<SearchResult> {
    this.questions.push(question);

    if (this.scenario.search.behavior === "timeout") {
      return {
        status: "failed",
        code: "SEARCH_TIMEOUT",
        elapsed_ms: this.scenario.search.elapsed_ms,
      };
    }

    const results = this.scenario.search.document_ids.map((documentId) => {
      const document = this.documents.get(documentId);
      if (document === undefined) {
        throw new Error(`Fixture references unknown document: ${documentId}`);
      }
      return document;
    });

    return {
      status: "succeeded",
      documents: results,
      elapsed_ms: this.scenario.search.elapsed_ms,
    };
  }
}

export class FixtureBamlModelAdapter implements ModelAdapter {
  readonly requests: BamlModelRequest[] = [];

  constructor(readonly scenario: Scenario) {}

  async generate(request: BamlModelRequest): Promise<ModelResult> {
    this.requests.push({
      function_name: request.function_name,
      question: request.question,
      documents: [...request.documents],
    });

    if (this.scenario.model.behavior === "not_reached") {
      throw new Error(`Model must not be reached for scenario: ${this.scenario.id}`);
    }

    return {
      output: this.scenario.model.output,
      usage: { ...this.scenario.model.usage },
      elapsed_ms: this.scenario.model.elapsed_ms,
    };
  }
}
