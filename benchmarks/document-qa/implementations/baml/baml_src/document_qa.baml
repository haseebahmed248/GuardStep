class Document {
  id string
  title string
  url string
  content string
}

class Citation {
  document_id string
  title string
  url string
}

class Answer {
  status "answered" | "insufficient_context"
  text string
  citations Citation[]
}

function AnswerQuestion(question: string, documents: Document[]) -> Answer {
  client "openai-responses/gpt-5-mini"
  prompt #"
    Answer the question using only the supplied documents.
    Return status 'answered' only when the documents support the answer.
    Return status 'insufficient_context' when the documents do not support an answer.
    For an answered result, copy every citation ID, title, and URL from a supplied document.

    Question:
    {{ question }}

    Documents:
    {{ documents }}

    {{ ctx.output_format }}
  "#
}
