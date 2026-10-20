# Implementation plan: opencode-claude

Status: **approved by the user on 2026-10-20; compatibility milestone in progress**.
Scope and command flow approved: 2026-10-20.
Specification: [SPEC.md](../SPEC.md).
Task list: [todo.md](todo.md).

## Outcome

Distribute `opencode-claude` through GitHub. It gives people the approved `setup`, `models`, `model set`, and `run claude|desktop` flow using their own eligible OpenCode models. One authenticated local gateway supports terminal Claude Code and Claude Desktop, with feature evidence tracked separately.

The primary uncertainty is not installing a CLI: it is preserving model tool calls through OpenCode while keeping Claude as the executor. That proof comes before the full gateway and launchers.

## Dependency order

```text
Reproducible local harness
          |
          v
OpenCode model/tool boundary proof -- failure -> record limitation; review scope
          |
          v
Authenticated text path -> streaming -> native tool round trips
          |
          v
Cancellation and conversation isolation
          |
          v
Model catalog/defaults/setup -> terminal launcher -> Desktop integration
          |
          v
Eligible-model live checks -> GitHub installation and release checks
```

The existing hosted free-model network denial does not prevent synthetic transport tests. It does prevent calling the free-model acceptance criterion passed. Do not repeatedly retry the blocked free endpoint or substitute a paid model silently.

## Architecture decisions

1. **One gateway, two client setup paths.** Terminal launches receive scoped gateway environment values. Desktop uses its own dedicated third-party inference configuration. The system `claude` command and saved Anthropic login remain intact.
2. **OpenCode stays the backend.** Use supported runtime/session/plugin interfaces. Do not export an anonymous free endpoint with fabricated client headers. Match inspected source and SDK contracts to the tested runtime version before implementation relies on them.
3. **A bounded tool experiment decides the adapter.** The first experiment passed both an external tool relay and a simpler transient-generation path. The selected candidate now uses `session.generate` plus the official HTTP-response hook to observe the model's actual response while OpenCode executes no tool. Registered tool definitions are still required; context hooks that invent unregistered tools are insufficient. The next slice must prove full Messages conversion and forwarding to a real Claude client. Evidence: [tool compatibility](../docs/tool-compatibility.md).
4. **Avoid a hidden agent substitution.** If the only supported integration lets OpenCode perform an entire agent task itself, report that result and request a scope decision. Do not relabel a text-only or nested-agent demo as native Claude tool support.
5. **Keep model mappings stable per launch.** A provider/model selection resolves to a stable client-compatible alias and a display label identifying the real model. Another client's default change must not reroute existing requests.
6. **Keep runtime state local.** Generated gateway credentials, process ownership records, sessions, and configuration live outside the checkout. Provider secrets remain managed by OpenCode. Logs omit prompts, authorization values, response bodies, and child-process environments.
7. **Ship from GitHub only.** First verify clone/build/local installation; then verify direct GitHub installation. No npm publishing command, registry release, or registry publishing workflow is part of this plan. npm can install dependencies and the GitHub project locally.

## Toolchain and interfaces

- Target **Node.js 24 LTS** for CI and reproducible development. The machine's existing Node 25 installation is not the release test baseline. Use a project-local supported runtime if needed rather than replacing the machine's global installation. Source: [Node release schedule](https://nodejs.org/en/about/previous-releases).
- Use TypeScript strict mode and Node's built-in test runner. Start with Node built-ins for HTTP, crypto, child processes, and configuration; add a runtime dependency only if the compatibility experiment needs it.
- Resolve and pin exact development dependencies and any official OpenCode SDK/plugin package against verified registry metadata before installation. Initial dependency installation disables lifecycle scripts; review any script that proves necessary.
- Initial inspected versions are OpenCode **2.0.32** and Claude Code **2.1.296**. A matching official release source/API must be checked; current upstream development files are research evidence, not a substitute for a version match.
- Implement the Anthropic Messages interface needed by the verified client, including authentication and correct streaming. Token counting is optional in the [Claude gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol); do not fabricate exact token counts if the backend cannot provide them. Unsupported capabilities must be explicit.

## Milestones

### 1. Prove the model/tool boundary — tasks 01–02

Create the minimum build/test harness and an isolated OpenCode experiment with a deterministic local fixture provider. Demonstrate that an external caller can receive a real tool request from the runtime, execute it once, and return its result to the same conversation. Confirm that OpenCode did not execute a duplicate action. Record the actual supported extension contract.

**Checkpoint:** pass, fail, or blocked, with evidence. Fixture success establishes runtime semantics only. It does not establish hosted free-tier eligibility or a completed Claude integration. If the interface cannot meet the requirement, stop the native adapter here and present the concrete limitation.

### 2. Make the native Messages path work — tasks 03–06

Deliver authenticated text, streaming, tool/result round trips, and then cancellation/isolation. Reject unsupported input instead of dropping content silently. Validate the path with a deterministic fixture first, then run the installed terminal Claude Code client against the gateway in a disposable workspace.

**Checkpoint:** native terminal client completes a controlled coding/tool task exactly once; concurrent requests and cancellation do not leak state or leave tool waiters unresolved.

### 3. Deliver the approved command flow — tasks 07–10

Implement catalog/defaults/setup, owned gateway lifecycle, the terminal launcher, and Desktop integration. `run` starts the gateway when needed and uses an invocation-specific model mapping. Existing application configuration is preserved and backed up before an explicit change.

**Checkpoint:** the approved terminal and Desktop launch commands work on this machine with verified capability reporting. An unsupported Desktop profile version gets an export/manual setup path rather than a guessed write.

### 4. Establish live and distribution evidence — tasks 11–12

Run opt-in short tests with an explicitly selected eligible model. Record real provider failures distinctly. A successful full free-model test is required before advertising that free-model path as working. Verify clean GitHub installation and automated Windows/macOS/Linux build/test jobs, with Desktop tested only where the actual client is available.

**Checkpoint:** clean-install evidence and a truthful feature matrix. A provider-blocked free-model test remains blocked. Public repository/release publication still requires the user's instruction; npm publication remains excluded until explicitly requested later.

## Risks and responses

| Risk | Effect | Response |
| --- | --- | --- |
| Public OpenCode interfaces cannot expose the required native tool boundary | Native Claude replacement may be infeasible | Prove it in milestone 1 and stop rather than build misleading launchers. |
| Hosted service denies the current network or a model changes eligibility | Live free-model acceptance cannot pass | Preserve the provider's error and keep access status separate from catalog presence. No evasion or paid fallback. |
| OpenCode runtime/SDK version changes | Plugin/API behavior may differ | Pin the tested adapter range, check versions in `doctor`, and fail clearly outside verified compatibility. |
| Claude adds unsupported request blocks or headers | A feature may fail or be silently lost | Contract tests plus an explicit feature matrix; reject unsupported meaning-changing input. |
| Desktop configuration differs by platform or release | Generated profiles may be rejected | Validate schema and version, back up before writes, and provide export/manual setup fallback. |
| Two clients select different models or cancel independently | Cross-conversation state could be corrupted | Stable per-launch mappings, request/session isolation, bounded waiters, and concurrency tests. |
| GitHub installation depends on a build hook or missing tool | New machines cannot install | Document prerequisites and test clone/build plus direct GitHub installation from a clean environment. |

## Review request

Review this plan and its proposed task checklist together. The first implementation authorization is for the bounded compatibility milestone, followed by the ordered product slices only if the tool boundary passes. No publishing or active application reconfiguration is included in that authorization.
