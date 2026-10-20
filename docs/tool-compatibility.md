# Native tool compatibility experiment

Status: **PASS for the bounded local runtime experiment. The production gateway now also passes a real Claude Code tool task; hosted free-model access remains blocked/unverified.**
Date: 2026-10-20.

## Environment

- OpenCode CLI 2.0.32, official source tag `v2.0.32`, commit `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Windows; Node 24.22.0 / npm 11.19.1.
- An original deterministic OpenAI-compatible model fixture bound to an authenticated ephemeral loopback port.
- A disposable OpenCode process, separate database/configuration/workspace, and a plain Promise plugin. No SDK runtime dependency was needed.

## Verified behavior

1. **External execution through a session:** the fixture model sends an actual `external_counter` tool call through OpenCode. The plugin relays the call and waits. The external test harness increments its own counter exactly once and returns `{ "value": 1 }`. OpenCode consumes that tool result, and the fixture returns `EXTERNAL_COUNTER=1`. A duplicate result is rejected with HTTP 409.
2. **Cancellation:** a second session reaches a pending tool call. OpenCode's interrupt operation aborts the Promise tool's signal, closes its broker request, and performs no external action.
3. **Transient model response without tool execution:** `session.generate` invokes the model with the registered tool schema. The official generation hook supplies a multi-turn conversation, which the fixture confirms it receives. The official `session.http.response` hook observes a clone of the provider response and captures its actual tool call. Neither the registered relay nor an external action is executed for that generation.
4. **Cleanup:** the harness closes its fixture connections and stops only the child runtime it created. Its stop operation fails if that child remains alive.

The transient-generation path is particularly useful for a Messages adapter: Claude can receive the actual model tool call and return its result in a later request, while OpenCode performs no tool action. The fixture showed that the provider response is streamed even though the public generation API ultimately returns only text. The original experiment aggregates that stream for its assertion. The production gateway now forwards provider text events live and validates/buffers parallel tool arguments before emitting native tool blocks.

## Reproduce

Prerequisites: Node 24 and the native OpenCode 2.0.32 executable. On Windows the harness locates the inspected npm-installed native executable; on other platforms it uses `opencode` from PATH. An explicit native binary can be supplied through `OPENCODE_CLAUDE_BIN`. These other-platform paths are not yet tested.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
node experiments/native-tools/verify.mjs
```

Expected final evidence includes:

```json
{
  "result": "PASS",
  "runtimeVersion": "2.0.32",
  "model": "deterministic loopback fixture",
  "externalExecutionCount": 1,
  "resultConsumed": true,
  "cancellationForwarded": true,
  "duplicateResultRejected": true,
  "transientToolResponseCaptured": true,
  "transientToolExecutions": 0,
  "customConversationPreserved": true,
  "claudeClientTested": false,
  "liveFreeModelTested": false
}
```

The initial verifier failed before the fixture/runtime implementation existed. An additional transient-response assertion failed before capture support was added. The observed stream format then required SSE aggregation instead of attempting to parse the response as one JSON object. The final verifier passes those assertions.

## Boundaries and remaining work

- The original experiment proves only its stated deterministic tool boundary. Subsequent production checks pass the full terminal `run claude` command with Claude Code 2.1.296: one actual Claude `Write`, one tool result consumed through real OpenCode, final `READY`, zero OpenCode tool executions. Parallel calls, conversation conversion, native SSE and malformed responses have contract tests. Images and other wire protocols remain unsupported; Desktop UI and live free-model access remain unverified. See [current evidence](compatibility.md).
- The fixture plugin removes built-in tools solely to keep this isolated test from executing file, shell, or browser actions. This is not a method for establishing or bypassing a hosted provider's free-tier eligibility.
- No provider API key was collected or copied, no hosted model was called, and no client-identity headers were fabricated.
- Provider restrictions remain unchanged. The previously observed network block still prevents real OpenCode free-model acceptance testing here.
- `.runtime/` contains ignored, disposable test configuration/database files. Its credentials are generated for the temporary localhost processes; it is not release content. `.tools/` is also excluded from Git and package contents.

## Source contracts

- [Promise plugin entry point](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/plugin.ts)
- [Tool registration and AbortSignal](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/tool.ts)
- [Session generation and HTTP response hooks](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin/src/promise/session.ts)
- [Transient session generation implementation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/generate.ts)
- [Provider request preparation](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session/model-request.ts)
