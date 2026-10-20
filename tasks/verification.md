# Verification record

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
