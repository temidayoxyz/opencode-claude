# Specification: opencode-claude

Status: **scope, command flow, and implementation plan approved on 2026-10-20; compatibility milestone in progress**.
Prepared: 2026-10-20.

## Objective

Build a public GitHub project named `opencode-claude` that lets an individual connect both Claude Code (the terminal `claude` command) and Claude Desktop to that individual's OpenCode installation and eligible models. A new user must be able to install the project on another supported machine without copying the original developer's credentials, absolute paths, or private configuration.

This is one capability: a locally operated OpenCode inference adapter shared by Claude Code and Claude Desktop. Packaging, client setup, diagnostics, and compatibility checks support that capability.

The first milestone is a compatibility proof. The product must not be described as a working native Claude model replacement until actual tool calls and results work through the genuine OpenCode runtime. If the runtime only supports delegating an entire task to OpenCode's agent, that is a different behavior and must be reviewed explicitly before changing scope.

## Assumptions for review

1. This is downloadable open-source software that each person runs locally, rather than a hosted service operated by the repository owner.
2. Windows, macOS, and Linux are the target platforms. A platform is listed as tested only after its release checks run there.
3. Each person installs OpenCode and authenticates with providers through supported local workflows.
4. A command-line setup and launcher are sufficient for the first release. A desktop settings window can follow after compatibility is established.
5. Free models are a primary use case, but the bridge respects provider eligibility and quotas and never falls back to a paid model without explicit selection.
6. Existing Claude and OpenCode settings remain intact. A generated Claude profile is separate and reversible.
7. GitHub is the distribution channel for this phase. Do not publish the project to the npm registry unless the user explicitly requests that later. Using npm as a local installer/build tool is allowed and does not mean publishing a registry package.

## Client compatibility targets

| Client | Connection | Required verification |
| --- | --- | --- |
| Claude Code terminal CLI (`claude`) | Gateway base URL and a generated local gateway credential supplied to the child process | Interactive/noninteractive text, streaming, tools, tool results, cancellation, and conversation isolation |
| Claude Desktop chat | Separate third-party inference gateway configuration | Text, streaming, model labels, and supported attachments/tools |
| Claude Desktop Code tab | Desktop third-party inference configuration | Coding tool round trips and workspace behavior, independently of terminal CLI tests |

One local gateway should serve both applications concurrently. Client-specific limitations must remain visible rather than advertising identical feature availability. Targeting Linux for the CLI does not imply that a Linux Claude Desktop client is supported; check client availability when preparing the platform matrix.

For terminal setup, `opencode-claude run claude` starts the installed `claude` executable with scoped `ANTHROPIC_BASE_URL` and gateway credentials, preserving the caller's environment and passing through arguments/exit status. Do not overwrite the system `claude` command or persist global credentials without a configuration choice. The normal `claude` command can use explicitly configured environment/settings if the user prefers.

Claude Desktop uses its own third-party inference configuration, not the terminal environment variables. Sources: [gateway connection documentation](https://code.claude.com/docs/en/llm-gateway-connect) and [gateway compatibility requirements](https://code.claude.com/docs/en/llm-gateway-protocol). Routing to non-Claude models is outside Anthropic's supported configuration, so this project's model compatibility is experimental until tested.

## User-facing behavior

- `doctor` reports the OpenCode version, runtime connectivity, client compatibility, available models, and the difference between a model appearing in the catalog and a model that passed a live request.
- Setup lists provider/model identifiers, reported capabilities, and known pricing status. Unknown price information stays unknown; a model is not assumed free from its name alone.
- The user chooses an explicit model mapping. Human-readable labels identify the real model; Claude-family aliases are routing identifiers, not claims about benchmark quality.
- A loopback-only authenticated gateway exposes the Anthropic Messages operations needed by the verified Claude client.
- Streaming, cancellation, tool calls, tool results, and supported attachments retain their meaning across the adapter.
- Model changes affect new requests. An existing conversation is not silently moved to another provider.
- Provider authentication errors, rate limits, unavailable models, and network restrictions are distinguishable and actionable.
- No silent fallback to another model or provider occurs.

## Architecture constraints

Intended boundary:

```text
Claude Code CLI --+
                  +-> authenticated local Messages gateway
Claude Desktop ---+   -> supported OpenCode session/plugin interfaces
                      -> the user's eligible provider/model
```

OpenCode must remain the actual backend. Do not replace it with requests to the hosted free endpoint carrying fabricated client identity. Do not strip or replace the OpenCode agent request merely to defeat hosted free-tier eligibility checks.

The exact model/tool adapter remains an experiment. The current session API is an agent interface, and its text-generation operations return text rather than a complete model response. A supported method of preserving Claude's external tool execution has not been proven.

For native compatibility, Claude remains the executor of its own tools. OpenCode must not independently execute file, shell, browser, or computer actions when the request expects a tool call returned to Claude. If that separation is impossible with supported interfaces, stop the native-compatibility milestone and document the result rather than substitute a nested agent silently.

A managed runtime, if needed, uses separate local state and a generated secret. It must not stop, reconfigure, or reuse the user's unrelated service without an explicit configuration choice.

## Proposed technical stack

- Node.js, using a maintained LTS release at implementation time.
- TypeScript, strict mode; Node built-in HTTP, crypto, process, and test utilities where practical.
- OpenCode native runtime; **2.0.32 is the inspected installation, not a claim that compatibility is complete**.
- Official OpenCode v2 interfaces selected against a verified runtime version, with exact dependencies pinned in a lockfile.
- Original project source with an MIT license proposed for public distribution. Any upstream code reuse requires its own license and notices review.

Versions will be resolved and pinned in the implementation plan. No unverified SDK package/version is prescribed here.

## Approved command flow

These commands describe the approved interface. They are not implemented yet.

```sh
opencode-claude setup
opencode-claude models
opencode-claude run claude --model opencode/minimax-m3.1-flash-free
opencode-claude run desktop --model opencode/deepseek-v4.1-flash-free

opencode-claude model set opencode/minimax-m3.1-flash-free
opencode-claude run claude
opencode-claude run desktop
```

Command behavior:

- `setup`: check prerequisites and create this application's local configuration. Provider login stays in supported OpenCode workflows; do not collect or copy provider keys into the public project.
- `models`: list OpenCode's available catalog and reported capabilities/pricing. Listing a model is not a live-access check.
- `model set <provider/model>`: save a default for future launches. Validate the selection; do not change an active request or silently move running clients to it.
- `run claude [--model <provider/model>] [-- <claude arguments...>]`: start the owned local gateway if needed, resolve a model mapping, then launch terminal Claude Code. Client credentials are local gateway credentials, not copied provider credentials.
- `run desktop [--model <provider/model>]`: start the gateway if needed, prepare/select a dedicated Desktop configuration, and open the app. If an existing app instance requires restarting, explain that state and require an explicit restart choice rather than terminating active work silently.
- `--model` applies to that invocation and overrides the saved default without replacing it. Both clients can use different model mappings concurrently.
- If no default or override exists, explain how to choose one. Never select a potentially paid fallback automatically.
- Pass-through Claude arguments cannot silently contradict the selected gateway model. Reject conflicting model overrides with a clear explanation.

The example model names came from the inspected catalog. They are examples, not a claim that those models currently pass access checks.

## Development and diagnostic commands

These are the intended repository interface, not currently implemented scripts:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node dist/cli.js doctor
node dist/cli.js setup
node dist/cli.js start
node dist/cli.js stop
node dist/cli.js smoke --model <provider/model>
node dist/cli.js run claude --model <provider/model>
node dist/cli.js run desktop --model <provider/model>
```

Setup must explain any dependency lifecycle script that is required before it is enabled. Cross-platform scripts must not depend on a user's PowerShell profile or shell-specific syntax.

The public command name is `opencode-claude`. GitHub installation must work without an npm registry release: document clone/build/local installation first, and verify direct GitHub installation before advertising it. A later npm registry release is explicitly out of scope until requested by the user.

## Proposed project structure

```text
src/cli.ts                  Commands and user-facing diagnostics
src/gateway/                Messages validation, authentication, SSE, cancellation
src/opencode/               Versioned runtime adapter and process ownership
src/config/                 Model mapping and platform-local paths
src/claude-code/            Scoped terminal launcher and CLI diagnostics
src/claude-desktop/         Profile generation and reversible setup
tests/                      Protocol, security, process, and isolation tests
fixtures/                   Synthetic protocol data, never captured private prompts
docs/                       Setup, compatibility matrix, architecture, research
.github/workflows/          Public build and test matrix when implemented
```

## Code style

Use named types at boundaries, explicit errors, and no shell evaluation of user-supplied values. Example intended style:

```ts
type ModelTarget = Readonly<{ providerID: string; modelID: string }>;

function requireLoopback(host: string): void {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("The gateway must listen on a loopback address.");
  }
}
```

Avoid logging prompts, response bodies, provider keys, authorization headers, or child-process environments by default. Logs identify operations, model IDs, durations, and sanitized error categories.

## Testing and evidence

1. **Compatibility proof:** genuine OpenCode runtime produces a tool request, Claude executes it once, and the model consumes the tool result. Assert that OpenCode did not execute a duplicate action. A provider-model live test is distinct from a local mock test.
2. **Messages protocol:** text; multi-turn histories; multiple and parallel tool calls; tool errors; tool results; tool-choice behavior; model mapping; supported generation parameters; and explicit rejection of unsupported blocks.
3. **Streaming:** valid event ordering, partial JSON tool arguments, UTF-8 chunk boundaries, completion reasons, midstream errors, backpressure, and client disconnects. Buffered output must not be advertised as live token streaming.
4. **Isolation:** concurrent conversations cannot exchange prompts, tool results, attachments, or cancellation signals.
5. **Security:** missing/wrong local credentials; untrusted browser origins; invalid bodies; body-size limits; timeouts; secret redaction; no open proxy behavior; and no shell injection through paths or model names.
6. **Lifecycle:** stop only a process owned by this bridge; preserve unrelated OpenCode processes and configurations; handle stale state and port collisions.
7. **Live checks:** an opt-in short test against an explicitly selected model. Never run paid model tests in public CI. Provider-blocked tests must be reported as blocked, not passed.
8. **Release evidence:** Windows/macOS/Linux build checks and clean-install instructions from GitHub. Test Claude Code terminal, Claude Desktop chat, and Claude Desktop Code workflows separately on supported client platforms. A platform or feature stays experimental until tested. The inspected terminal installation is Claude Code **2.1.296**, which is discovery evidence rather than a passing compatibility result.

Use Node's test runner unless a concrete requirement justifies another dependency. Tests verify externally observable behavior, not source-code layout.

## Boundaries

Always:

- Keep credentials and runtime state outside the repository in platform-local storage, with restrictive permissions where supported.
- Bind both gateway and managed runtime to loopback and authenticate requests.
- Validate protocol input before forwarding it.
- Use the provider's actual eligible model access and preserve error reasons.
- Review dependencies and upstream licenses before distribution.
- Keep existing settings backed up before any opt-in profile change.

Ask before:

- Publishing the GitHub repository or a GitHub release under the user's identity.
- Replacing an active Claude profile or changing an existing OpenCode service.
- Adding hosted infrastructure, telemetry, shared credentials, automatic paid fallback, or changing native tool execution to OpenCode task delegation.

Never:

- Commit credentials, local session databases, private prompts, or downloaded research trees.
- Claim that a mock test establishes live free-model access.
- Circumvent provider quotas, network restrictions, or client eligibility controls.
- Claim Claude subscription features are unlocked by changing an inference endpoint.
- Patch Claude application binaries or silently execute OpenCode tools in place of returning Claude tool calls.
- Publish an npm registry package or enable an npm publishing workflow without a later explicit request from the user.

## Release success criteria

- A clean checkout can build and test using documented commands with pinned dependencies.
- A new user can set up their own eligible OpenCode model without copying the original machine's private data.
- Native text, streaming, and tool-call round trips have passed end-to-end with the supported runtime/client versions.
- Supported/experimental/unsupported features and platform evidence are visible in a compatibility matrix.
- At least one real OpenCode free model has passed the complete workflow from an eligible environment before free-model compatibility is advertised.
- A blocked free provider returns a useful error and causes no identity spoofing, quota bypass, or paid fallback.
- Generated profile setup can be reversed and does not damage existing profiles.
- Both supported clients can use the shared gateway, with separate passing evidence for terminal Claude Code, Desktop chat, and Desktop Code features that are advertised as supported.
- GitHub checkout installation is documented and reproducible; no npm registry publication is needed.
- Public release files contain only intended source, documentation, synthetic fixtures, and reviewed dependencies.

## Current unresolved evidence

- The current network is denied free-model access by the hosted OpenCode service, even for a standard OpenCode session. This prevents validating the primary free-model workflow here at present.
- The supported mechanism for returning Claude-native tool calls through OpenCode v2 has not been established. OpenChamber/OpenWork operate at the agent layer; their existence does not resolve this boundary.
- Cross-platform Claude Desktop gateway configuration and the full Code-tab workflow have not been validated for this new adapter.
- Claude Code **2.1.296** is installed and supports gateway configuration; this new OpenCode adapter has not yet passed a terminal-client end-to-end test.

These are requirements to investigate, not features marked complete.
