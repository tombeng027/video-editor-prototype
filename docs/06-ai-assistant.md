# 6. AI Assistant

[Back to index](./README.md)

## Principles

- **Suggestive first:** the default is conversational guidance. The assistant cannot change the project on its own.
- **Proposals, not mutations:** the model proposes a typed action. The engine validates it. The user confirms. Only then is it executed through the command layer.
- **Small, explicit action set:** only quick actions that are defined and validated exist. The prototype has one.

## Modes

| Mode | Behaviour |
|------|-----------|
| Conversational | Streaming chat for editing tips and technique questions. No project changes. |
| Quick action | The assistant returns an action proposal, shown as an action card. The user confirms or discards. |

The assistant can be asked to run in conversational-only mode (a toggle in the panel disables action proposals).

## Ollama integration

- The engine calls the Ollama HTTP API and streams tokens to the client.
- **Default model: `qwen3:8b`**, fallback `llama3.1:8b`. Confirm both are available in the Ollama library before pulling. The model name is a setting.
  - Reliable tool calling and JSON output, and Ollama can constrain output to a JSON schema, which the action proposals depend on.
  - 8B fits a typical 16 GB RAM machine or a GPU with about 8 GB VRAM, leaving room for CLIP and FFmpeg.
  - Good enough for general editing Q&A, the other half of the assistant's job.
  - Qwen3's "thinking" mode is disabled for chat and proposals to keep latency low.
  - Llama 3.1 8B is the fallback and a second model to compare against in the evaluation set.
- The model is given **one tool**, `propose_jump_cut`, through Ollama's tool-calling support. Plain answers stream as normal text, and a tool call becomes an action card. This avoids forcing every reply into a JSON schema, which would break token streaming. M4 verifies that the chosen model streams text and emits tool calls reliably; if not, fall back to a non-streamed structured-output classification step.
- Setup checks that the configured model is installed and supports tools.
- The system prompt describes the assistant's role, the available action, and the rules for when to propose it.
- Project context given to the model is minimal: asset list (ids, names, durations) and the current selection. No full timeline dump.

## Action schema (versioned)

```json
{
  "schemaVersion": 1,
  "action": "jump_cut_sequence",
  "assetId": "asset_123",
  "range": { "start": "0:10", "end": "0:20" },
  "targetAction": "attaching a keycap to a mechanical keyboard",
  "negativePrompt": "an idle keyboard with no hands",
  "clipDurationSec": 0.5
}
```

- `range` accepts `m:ss` or `h:mm:ss`. It is a time in the source asset, converted to project frames by the engine.
- `negativePrompt` is optional. It is used as the contrast baseline in the vision step. If missing, a generic baseline is used.
- `clipDurationSec` defaults to 0.5 and is limited to a configured range (for example 0.2 to 2.0).

## Proposal flow

1. The user sends a message.
2. The model returns either plain text or an action payload (structured output).
3. The engine parses the payload with the Zod schema.
4. The engine validates against project state: asset exists and is video, range is within duration and `start < end`, clip duration is in the allowed range.
5. Valid: the client shows an action card with the parameters. Invalid: the assistant response includes a readable explanation and the user can correct the request.
6. On confirm, the engine starts the analysis job (see [Jump-Cut Pipeline](./07-jump-cut-pipeline.md)).
7. The result is a candidate. The user then chooses Insert, Edit or Discard.

Two confirmations exist deliberately: one to run the analysis, and one to insert the result.

## Safety and reliability

- Free-form model output is never executed directly.
- Malformed output triggers one automatic retry, then falls back to a plain-text reply.
- The assistant never receives or returns file paths, only asset IDs.
- All AI-applied edits appear in the undo history labelled as AI.

## Evaluation

Keep a small set of sample prompts (valid, ambiguous, invalid) with expected outcomes to check that the proposal behaviour stays reliable when the model or prompt changes.
