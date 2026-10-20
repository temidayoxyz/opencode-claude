# Compatibility and evidence

Recorded 2026-10-20. This is an experimental local integration, not an officially supported Anthropic integration for third-party models.

| Capability | Evidence |
| --- | --- |
| Node/TypeScript build | Passed on Windows, Node 24.22.0, TypeScript 6.0.3 |
| OpenCode backend | Real native **2.0.32**, exact upstream contract pinned; other versions refused |
| Messages text and SSE | Passing deterministic contract tests |
| Tools and results | Original IDs/arguments/error results retained; parallel argument fragments validated |
| Terminal Claude Code | **2.1.296** passed the actual `run claude` launcher against real OpenCode and a local fixture: one Claude `Write`, one consumed result, final `READY`, no OpenCode tool execution |
| Cancellation/isolation | Real OpenCode concurrent requests passed; cancelling one terminated its provider request while the other completed |
| CLI lifecycle | Concurrent starts reused one authenticated worker; setup/default/export and repeated stop passed in disposable state |
| Desktop profile | Existing profile preservation, metadata backup and restore passed in disposable directories; schema inspected in Windows Desktop **2.42304.2.0** |
| Desktop chat | **UI verification pending**; profile support is not a passing chat result |
| Desktop Code tab | **UI verification pending**, independently of terminal Claude Code |
| Real hosted free models | **Blocked/unverified** on this development network; an ordinary official OpenCode session reported a network abuse-detection restriction |
| macOS/Linux | Portable code and unit-test CI configured; no passing native client or Desktop result recorded yet |

## Supported subset

Text/system conversations, custom client tool definitions, tool use/results including errors, automatic tool selection, temperature/top-p, stop sequences, and nonstreaming/streaming Messages responses. Output effort is forwarded as OpenCode's generic `reasoningEffort`; actual interpretation depends on the provider. Prompt cache hints and metadata are not forwarded. Native Claude thinking budgets/blocks are not implemented.

The response hook currently requires **OpenAI Chat Completions SSE**. Catalog filtering permits the OpenCode openai-compatible, DeepSeek, and OpenRouter provider packages when enabled with tool support. That checks protocol suitability, not successful model access. Anthropic-native and Responses API provider formats are not translated in this version.

Model text is forwarded as it arrives from the provider. Tool arguments are buffered, parsed and checked before emitting ordered native tool blocks; interleaved OpenAI parallel calls are not exposed as malformed native SSE. Usage reports provider counts when present; zero means unavailable before the provider reports it, not an independently measured token count. Exact token counting is not implemented.

Images, PDFs/documents, video/audio, thinking blocks, structured output schemas, forced tool choice, deferred tool loading/tool references, server tools, context editing and native compaction payloads are explicitly rejected. Desktop features that depend on these are outside the tested subset. No promise is made about every agent, MCP server, plugin, or subscription feature.

## Runtime and privacy

The gateway binds only to `127.0.0.1`, authenticates with a random per-user local key, rejects browser origins, bounds request/response sizes, and caps concurrent generations at eight. The native location/plugin cache is recycled between requests after 32 completed generations. A busy recycling boundary produces an explicit failure; it never interrupts another generation or chooses a fallback model.

The native runtime uses its own database, empty workspaces, generated local password, project configuration disabled, and ordinary existing global OpenCode provider configuration/authentication. Arbitrary shell environment variables are not passed to the runtime. Providers that require environment-only credentials should be connected using OpenCode's credential store first. Trusted user-global OpenCode configuration/plugins still belong to the user's trust boundary.

Full caller context is supplied through the plugin rather than written as session history; only a fixed marker goes to the transient-generation API. The adapter registers caller tools but never executes them. Claude executes them under its normal permissions. There is no adapter retry or completed-action replay mechanism; a native client's retry policy remains its own.

Application logs do not record prompts, response bodies or provider credentials. The native OpenCode runtime may maintain its own operational logs according to its configuration. Graceful shutdown deletes only the proven-owned adapter directory after its child exits. A crash may leave private runtime files for review; no broad cleanup of other OpenCode state is performed. Secrets/settings/backups live outside the checkout with restrictive POSIX modes or the Windows user profile's inherited ACLs; they are not DPAPI encrypted. Other processes running as the same user can access them.

The normal user-managed OpenCode service is never stopped or reconfigured. `stop` requires the private local credential and matching gateway instance identity; it does not terminate arbitrary PIDs.

## Free access and names

Final installed-package check: `opencode/minimax-m3.1-flash-free` was absent from the refreshed catalog, so no inference was attempted for it. One explicit `opencode/deepseek-v4.1-flash-free` smoke request failed without a supported answer. Its gateway error did not establish a more specific cause; the earlier ordinary-OpenCode network refusal remains separate historical evidence. A later local 403 fixture verifies that provider HTTP status is preserved without disclosing bodies. No additional hosted retry was made. Setup clears unavailable saved defaults; doctor reports a missing/unavailable selection.

OpenChamber and OpenWork demonstrate using a genuine OpenCode backend, not a guarantee that hosted free endpoints accept every external workflow. This implementation uses supported versioned OpenCode session/plugin interfaces. It does not impersonate a different client, rotate networks, or defeat provider checks. The free-tier/network refusal and tool-shape eligibility concerns are described in [the research report](FEASIBILITY.md).

The neutral `claude-sonnet-4-6-oc-...` identifier is a Desktop/client compatibility alias, derived from the exact provider/model key. It does not mean the underlying model is Sonnet or has Sonnet performance. Desktop displays its actual model name. No Claude subscription entitlement is unlocked.

Before claiming full free-model compatibility, record an eligible live model test, then a real terminal tool task and separate Desktop chat/Code tests on that provider. A fixture pass cannot establish those results.
