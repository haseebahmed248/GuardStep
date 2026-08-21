# GuardStep syntax sketch

Status: syntax proposal 0. This file records questions for the first parser prototype. It is not a specification.

## First example

The canonical draft example is [`examples/document-qa/answer.guard`](../examples/document-qa/answer.guard). It describes a document-backed question-answering workflow with typed contracts, one allowed tool, two runtime limits, structured model output, and a postcondition.

```guardstep
record Question {
  text: String
}

record Citation {
  title: String
  url: String
}

record Document {
  title: String
  url: String
  content: String
}

record Answer {
  text: String
  citations: List<Citation>
}

tool documents.search(query: String) -> List<Document>

workflow AnswerQuestion(input: Question) -> Answer {
  allow tools [documents.search]
  limit cost <= 0.05 USD
  limit duration <= 20s

  context = call documents.search(query: input.text)

  answer = generate Answer using model("balanced") {
    "Answer using only the supplied context: {context}"
  }

  require answer.citations.length > 0
  return answer
}
```

## Proposed meaning

- `record` declares a serializable data contract.
- `tool` declares an effectful external capability with typed inputs and output.
- `workflow` declares a callable, typed execution boundary.
- `allow tools` is a static capability declaration, not merely documentation.
- `limit` requests a runtime-enforced budget. Currency limits depend on a deployment price table; their exact accounting semantics are still open.
- `call` marks an external tool effect.
- `generate` marks a nondeterministic model effect. The runtime must validate the result against the requested type before assignment.
- `model("balanced")` selects a deployer-configured profile rather than a provider-specific model ID.
- `require` declares a postcondition that fails the workflow when false.
- `return` produces the workflow's declared result.

## Intended checks

For this example, a future `guardstep check` should reject:

- a call to a tool absent from `allow tools`;
- tool arguments that do not match the declaration;
- a generated or returned value that does not match `Answer`;
- unsupported budget units, missing price data, or negative limits;
- references to missing records, fields, tools, or variables; and
- a workflow path that does not return an `Answer`.

## Proposed commands

```bash
guardstep check examples/document-qa/answer.guard
guardstep run examples/document-qa/answer.guard
guardstep inspect examples/document-qa/answer.guard
guardstep test examples/document-qa/answer.guard
```

These commands describe the intended CLI and are not implemented yet.

## Open questions

- Whether declarations need explicit visibility modifiers
- Whether capability grants belong inside a workflow or in a separate policy block
- How prompts should represent interpolation and reusable templates
- Whether budgets compose across called workflows
- Whether duration means wall-clock time, active execution time, or both
- How a deployment pins provider prices for currency budgets
- How failures, retries, streaming events, and approvals appear in surface syntax
- Whether namespaced tool declarations should use `tool documents.search` or an enclosing module
