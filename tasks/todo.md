# Proposed tasks: opencode-claude

Status: **experimental implementation and local installation complete on 2026-10-20. Tasks 01–09 pass locally; Desktop UI and eligible live free-model acceptance remain validation gates. No public publication performed.**
Plan: [plan.md](plan.md). Specification: [SPEC.md](../SPEC.md).

The following is the approved acceptance checklist, retained without weakening its outstanding gates. Implementation was split into separate protocol, configuration/lifecycle, launcher, and distribution commits. See [verification evidence](verification.md). A live provider rejection is not a passing integration result.

## Task 01: Reproducible build and CLI identity

- [x] Resolve exact pinned development dependencies and verify the source/API version for the installed OpenCode runtime before choosing an SDK.
- [x] A Node 24 development environment can build strict TypeScript; the initial CLI provides truthful name/version/help output without pretending other commands work.
- [x] A checked-in lockfile supports script-disabled dependency installation; registry publication is disabled in package metadata.

**Verify:** `npm ci --ignore-scripts`, `npm run check`, `npm run build`, and `npm test`. Initial tests cover observable CLI identity/help and unsupported-command failure.

**Depends on:** reviewed plan/tasks.
**Expected files (5):** `package.json`, `package-lock.json`, `tsconfig.json`, `src/cli.ts`, `tests/cli.test.ts`.

**Evidence (2026-10-20):** Node 24.22.0 / npm 11.19.1; TypeScript 6.0.3 / Node types 24.10.0. Three CLI tests passed after the recorded missing-implementation failures; type check, build, frozen script-disabled install, and dependency audit passed. All three dependency registry signatures verified; one attestation verified. Tests use native `.mjs` files so the test harness does not need a transpiler. OpenCode source tag `v2.0.32` resolves to commit `843a6c514e606b436a7fe713422ace0a93ad3d61`; matching official client/plugin packages exist, but neither is required by the initial CLI. Script policy and line-ending configuration are a separate tooling increment.

## Task 02: Isolated OpenCode tool-boundary experiment

- [x] A disposable OpenCode runtime uses a deterministic local fixture model and supported extension APIs, without modifying the user's service or exposing provider credentials.
- [x] The external harness receives an actual model tool call, executes a harmless counter tool once, returns its result, and receives the corresponding final answer; OpenCode performs no duplicate action.
- [x] Record supported interfaces and pass/fail/blocked evidence, including cleanup and cancellation. If the requirement cannot be met, stop native integration and document why.

**Verify:** `node experiments/native-tools/verify.mjs`; inspect the recorded operation count, tool IDs, final response, cancellation result, and owned-process cleanup. This is a fixture test, not a live free-model test.

**Depends on:** 01.
**Expected files (5):** `experiments/native-tools/verify.mjs`, `experiments/native-tools/fixture-model.mjs`, `experiments/native-tools/plugin.mjs`, `experiments/native-tools/runtime.mjs`, `docs/tool-compatibility.md`.

**Evidence:** [tool-compatibility.md](../docs/tool-compatibility.md). The verifier also passes transient-generation response capture with zero tool executions. This selects a simpler candidate adapter based on `session.generate` plus the official response hook; no suspended agent loop is required for that path. Claude-client and live provider acceptance remain separate pending checks.

### Checkpoint A — after 01–02

- [x] Build and checks pass.
- [x] Tool-boundary result is recorded honestly and independently from provider eligibility.
- [x] Review the evidence before promoting the experimental adapter; a failed boundary blocks tasks 03 onward until scope is resolved.

## Task 03: Authenticated native text request

Implementation is split into smaller increments to keep each change reviewable: 03a request/conversation validation (four passing test groups); 03b typed owned runtime and plugin adapter (real-runtime tool/result check passed with zero tool executions); 03c authenticated HTTP path. Stream framing also has three passing test groups for Unicode/line boundaries, bounded/truncated input, and cancellation. Task 03 remains incomplete until the actual endpoint passes its integration checks.

- [x] A loopback-only gateway authenticates local credentials and validates Messages input before forwarding through the proven OpenCode adapter.
- [x] A fixture-backed text/multi-turn request returns a valid native Messages response; wrong credentials, oversized input, and unsupported content fail explicitly.
- [x] Only sanitized operation diagnostics are logged; prompts, credentials, and response bodies stay out of logs.

**Verify:** `npm test -- --test-name-pattern=messages-text` and `npm run check`; contract tests assert valid responses, rejected requests, origin policy, and log redaction.

**Depends on:** successful 02.
**Expected files (5):** `src/gateway/server.ts`, `src/gateway/messages.ts`, `src/opencode/adapter.ts`, `tests/messages-text.test.ts`, `tests/helpers/runtime-fixture.ts`.

## Task 04: Stream responses correctly

- [x] Messages SSE uses valid ordering, UTF-8 boundaries, stop reasons, and structured errors.
- [x] Backpressure and client disconnects terminate or cancel work cleanly.
- [x] The implementation reports actual streaming behavior; buffered output is not described as live token streaming.

**Verify:** `npm test -- --test-name-pattern=messages-stream` and `npm run check`; stream tests include fragmented multibyte text and midstream errors.

**Depends on:** 03.
**Expected files (4):** `src/gateway/stream.ts`, `src/gateway/server.ts`, `src/opencode/adapter.ts`, `tests/messages-stream.test.ts`.

## Task 05: Native Claude tool/result round trip

- [x] Tool IDs, arguments, tool results, errors, and parallel calls retain their meaning through the proven adapter.
- [x] Claude is the sole executor of its requested actions; no OpenCode tool executes a duplicate action.
- [x] The installed terminal `claude` client completes a controlled fixture-backed tool task in a disposable workspace.

**Verify:** `npm test -- --test-name-pattern=messages-tools`, `node scripts/smoke-claude.mjs --fixture`, and `npm run check`. Assert the action count and final result rather than only model text.

**Depends on:** 04.
**Expected files (5):** `src/gateway/tools.ts`, `src/gateway/messages.ts`, `src/opencode/adapter.ts`, `tests/messages-tools.test.ts`, `scripts/smoke-claude.mjs`.

## Task 06: Cancel and isolate conversations

- [x] Simultaneous requests cannot exchange model mappings, histories, tool results, or attachment data.
- [x] Cancelling one request settles its tool waiters and runtime operation without interrupting another request.
- [x] Retries do not duplicate a known-completed tool action; uncertain outcomes are explicit instead of silently replayed.

**Verify:** `npm test -- --test-name-pattern=conversation-isolation` and `npm run check`; run interleaved calls and cancellation with deterministic barriers.

**Depends on:** 05.
**Expected files (4):** `src/opencode/conversations.ts`, `src/opencode/adapter.ts`, `src/gateway/server.ts`, `tests/conversation-isolation.test.ts`.

### Checkpoint B — after 03–06

- [x] Text, SSE, native terminal tools, and isolation checks pass.
- [x] Unsupported features are explicit; the adapter has not silently become a delegated-agent workflow.
- [x] Review the native-client evidence before adding user-facing launch automation.

## Task 07: Catalog, setup, and saved model default

- [x] `setup` creates application-local configuration without copying provider secrets or overwriting unrelated settings.
- [x] `models` lists the OpenCode catalog with honest capability/pricing/access status; `model set` validates and persists a default atomically.
- [x] Invocation model overrides do not change the saved default or reroute running conversations.

**Verify:** `npm test -- --test-name-pattern=model-selection`, `npm run check`, and a fixture-backed setup/catalog/default command sequence.

**Depends on:** 06.
**Expected files (5):** `src/config/store.ts`, `src/config/models.ts`, `src/cli.ts`, `src/commands/setup.ts`, `tests/model-selection.test.ts`.

## Task 08: Owned gateway lifecycle

- [x] `start` and auto-start acquire an authenticated local gateway without a race; `stop` affects only this application's proven-owned process.
- [x] Local secret/state permissions are restrictive; port collisions, stale state, and failed startup produce actionable errors.
- [x] Repeated start/stop leaves unrelated OpenCode processes untouched and no orphaned owned child process.

**Verify:** `npm test -- --test-name-pattern=gateway-lifecycle` and `npm run check`; exercise concurrent starts, stale state, a port collision, and unrelated-process protection.

**Depends on:** 07.
**Expected files (5):** `src/process/gateway.ts`, `src/config/local-secret.ts`, `src/cli.ts`, `tests/gateway-lifecycle.test.ts`, `tests/helpers/process-fixture.mjs`.

## Task 09: Launch terminal Claude Code

- [x] `run claude --model <provider/model>` and a saved-default launch start the gateway as needed and invoke the installed `claude` command with scoped gateway configuration.
- [x] Arguments, terminal I/O, exit status, cancellation, and the caller's unrelated environment survive correctly on supported platforms.
- [x] The launcher preserves saved login/global settings and rejects conflicting forwarded model selection.

**Verify:** `npm test -- --test-name-pattern=launch-claude`, `node scripts/smoke-claude.mjs --fixture`, and `npm run check`.

**Depends on:** 08.
**Expected files (4):** `src/claude-code/launch.ts`, `src/cli.ts`, `tests/launch-claude.test.ts`, `scripts/smoke-claude.mjs`.

## Task 10: Launch Claude Desktop with a dedicated profile

- [x] `run desktop --model <provider/model>` prepares a dedicated version-checked configuration and opens Desktop, with backup/rollback for an explicit configuration change.
- [x] Existing profiles stay intact; an unsupported schema gets a clear export/manual setup path; active work is not silently terminated for a restart.
- [ ] Desktop chat and Desktop Code tool behavior have separate recorded results, and terminal/Desktop model choices can coexist.

**Verify:** `npm test -- --test-name-pattern=desktop-profile`, `npm run check`, and manual Desktop chat/Code checks against the fixture-backed gateway. Record tested client version and platform.

**Depends on:** 09.
**Expected files (5):** `src/claude-desktop/profile.ts`, `src/claude-desktop/launch.ts`, `src/cli.ts`, `tests/desktop-profile.test.ts`, `docs/compatibility.md`.

### Checkpoint C — after 07–10

- [ ] The approved command flow works with deterministic fixtures.
- [ ] Terminal CLI, Desktop chat, and Desktop Code evidence is recorded separately.
- [ ] Confirm configuration backup/rollback and simultaneous model selection before live provider checks.

## Task 11: Live access checks and provider errors

- [x] `doctor` distinguishes missing prerequisites, incompatible versions, catalog presence, previously verified access, and provider restrictions.
- [x] A short opt-in `smoke --model <provider/model>` test records real success or the sanitized provider failure without repeated denied calls or paid fallback.
- [ ] At least one eligible real OpenCode free-model workflow passes end-to-end before that free path is advertised as working; the current network block remains a blocked result until legitimately resolved.

**Verify:** `npm test -- --test-name-pattern=provider-errors`, `node dist/cli.js doctor`, and an explicitly selected opt-in live smoke test when an eligible environment exists.

**Depends on:** 10.
**Expected files (5):** `src/commands/doctor.ts`, `src/commands/smoke.ts`, `src/cli.ts`, `tests/provider-errors.test.ts`, `docs/compatibility.md`.

## Task 12: GitHub installation and release verification

- [x] A clean GitHub checkout can build and install the `opencode-claude` command; direct GitHub installation is documented only after it is verified.
- [ ] Automated Windows/macOS/Linux checks run without provider secrets; public source includes reviewed license/attribution and a truthful compatibility matrix.
- [x] Release staging excludes local state, credentials, raw research, and private prompts; no npm registry publication or publishing workflow exists.

**Verify:** `npm ci --ignore-scripts`, `npm run check`, `npm test`, `npm run build`, clean local/GitHub installation, and package-content inspection. Review dependency audit results before release staging. Do not publish as part of these checks.

**Depends on:** 11; installation work may be prepared after 10 while a real provider test is blocked, but the live free-model claim remains gated.
**Expected files (5):** `.github/workflows/check.yml`, `README.md`, `LICENSE`, `docs/install.md`, `package.json`.

### Final checkpoint

- [ ] Approved command flow works on verified targets and limitations are visible.
- [x] All required local checks pass; provider-blocked checks are identified explicitly.
- [x] A complete local diff and release contents are reviewed before any public GitHub publication.
- [x] No npm publication occurs unless the user explicitly requests it later.
