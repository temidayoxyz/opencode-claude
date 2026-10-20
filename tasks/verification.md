# Verification record

## Current: 0.2.0-dev.0, genuine sessions (2026-10-20)

- The user's direction explicitly supersedes the earlier tool-execution design: OpenCode runs the agent/tools, Claude provides the interface. Default commands now use official SDK 2.0.32 attached to the normal service, with no system/tool/permission rewrites.
- Strict TypeScript build and unused-code/fallthrough lint pass on Windows / Node 24.22.0. **28 unit/contract tests pass**, including native continuity, retry protection, branch isolation and concurrency reservation before asynchronous session creation.
- Genuine OpenCode local fixture passes native write approval, no file before permission, one file write/result, multiple turns, completed retry replay, native question/form answers and Messages streaming.
- Genuine native cancellation reaches the provider, leaves an independent conversation intact, and rejects a retry of the interrupted task without rerunning it. The OpenCode service remains healthy.
- Actual Claude Code 2.1.296 launcher passes with Claude tools disabled and conflicting saved routing/auth settings loaded: OpenCode executes one native write, consumes the result and returns READY.
- **Live free DeepSeek passes:** ordinary official SDK session returned READY; production `smoke --model opencode/deepseek-v4.1-flash-free` passed; actual production Claude terminal task created a disposable proof file containing exactly `READY_NATIVE_FREE` and returned READY. No paid fallback, provider header spoofing, network change or permission override was used.
- Dependency audit reports **0 vulnerabilities** after adding the exact official SDK and its locked dependencies. All **8 registry signatures** and **3 available attestations** verify.
- A fresh local clone of committed source installed cached dependencies with scripts disabled, passed lint/build and all 28 tests, and produced a 23-file compiled package (34,697 compressed bytes). Both package and source ZIP contain no runtime/cache/dependency directories or matches for the checked credential patterns. The package installed into the user's existing npm command prefix with scripts disabled; registry publication was not used.
- The installed package's genuine-session smoke check also passes with free DeepSeek. That tested model is saved as default, and a scoped Desktop profile was exported without replacing the user's active existing profile.
- Desktop profile file/schema tests remain passing. Desktop chat/Code UI and macOS/Linux native clients are independently unverified. GitHub publication has not occurred, and npm registry publication remains disabled.

The earlier record below is historical and describes the superseded model-only design; its free-access failure is not the current result.

## Earlier: 0.1 model-only adapter

Date: 2026-10-20. Version: 0.1.0-dev.1, experimental. Platform exercised: Windows.

## Passing evidence

- Strict TypeScript check, unused-code/fallthrough lint and production build pass with Node 24.22.0 / npm 11.19.1.
- **26 unit/contract tests pass**, including native event order, parallel tool arguments, malformed/truncated generations, tool errors, body limits, authentication/origin policy, disconnect isolation, secret-creation races, profile preservation/restore, model selection, ownership, explicit smoke result recording, precise denial categories and early HTTP 403 propagation.
- The clean local Git clone built with `npm ci --ignore-scripts`, lint and build, and the final checkout passed all 24 tests before packaging.
- Real OpenCode 2.0.32: typed runtime, complete conversation/tool-result adapter and bounded-cache recycle checked. The adapter check crosses 32 completed generations and successfully generates again after recycling.
- Real OpenCode cancellation: one waiting provider call is actually cancelled while a separate concurrent generation completes. This is distinct from the HTTP-only disconnect test.
- Real CLI lifecycle: three concurrent starts reuse one authenticated worker; stale state is replaced without terminating its recorded PID; setup/default/export and repeated owned shutdown pass. Wrong-instance protection and occupied-port errors have independent unit coverage.
- Real terminal Claude Code **2.1.296**: the actual `run claude` launcher sends a model-requested `Write` through the gateway/OpenCode fixture, Claude creates the disposable proof file once, the tool result is consumed once, and the final response is `READY`. OpenCode executes no tool.
- Local package built from clean tracked source: 19 files, approximately 27 KiB compressed, zero runtime dependencies. Installed from the `.tgz` into the user's npm prefix with scripts disabled. The normal `opencode-claude` PATH command identifies the version; installed setup/doctor start the packaged adapter successfully and discover the real catalog without hosted inference.
- Dependency audit: **0 vulnerabilities**, **3 verified registry signatures**, **1 verified attestation**. No dependency install scripts ran.
- Final live check through the installed package: MiniMax's free entry had disappeared from the catalog and was rejected locally before inference. One explicit listed-free DeepSeek smoke request failed with a generic runtime/unsupported-response result. No live success or precise new network diagnosis is claimed. No hosted retry or paid fallback followed. A subsequent local 403 fixture passed HTTP-status preservation and confirms no retry of that fixture denial. Setup/doctor now handle an unavailable saved default explicitly.
- Desktop package/executable discovery and schema were checked against Windows Desktop **2.42304.2.0**. Dedicated profile backup/preservation/restore tests pass in disposable directories. The user's active existing Desktop provider selection was not replaced during verification.

## Open gates

**Follow-up diagnosis:** the user's native OpenCode session works. The current converted request was classified as a hosted free-tier client restriction after one controlled diagnostic attempt, so the earlier network refusal is not an explanation for this specific failure. The independent saved-settings override defect was reproduced and fixed; the real native tool fixture passes with conflicting saved routing/auth settings loaded. The fix uses a private session settings file and bearer-only gateway authentication, without modifying user files. It does not make the hosted free endpoint accept the converted request.

- Desktop chat UI and Desktop Code tab remain independently unverified. Native UI control is unavailable in this environment. Configuration support is not reported as a passing Desktop workflow.
- No eligible hosted free-model end-to-end pass exists. Earlier ordinary official OpenCode sessions reported a network abuse-detection refusal; no attempt was made to defeat it, and no repeated denied inference or paid fallback was used during these checks. Provider tool-shape eligibility is also not guaranteed by local fixture success.
- macOS/Linux native integration and GitHub-hosted CI have not run here. The cross-platform build/unit workflow is configured but is not described as a passing remote run.
- GitHub publication has not been performed; no remote repository is configured. npm registry publication remains disabled.

## Review

The implementation was reviewed for protocol correctness, action ownership, unsupported-input behavior, local authentication, bounded resources, process ownership, cleanup paths and release contents. Tool arguments are validated before executable blocks are completed. No model/provider fallback or automatic action replay is implemented. Graceful cleanup resolves and verifies directory identity below the owned state root before recursive removal. Known limits, including native-runtime logging and same-user secret access, are documented in `docs/compatibility.md`.

Outstanding gates from the approved checklist remain unchecked; they were not replaced with weaker acceptance conditions. This is a publishable experimental implementation, not a claim that every requested live client/provider combination is proven.
