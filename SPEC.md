# Specification: opencode-claude

Updated 2026-10-20 under the user's explicit direction: **OpenCode executes the agent and tools; Claude provides the interface.** This supersedes the earlier Claude-executes-tools design and its approval gate. No further architecture approval is required for this direction.

## Objective and distribution

Build an original, reusable project named `opencode-claude` for Claude Code terminal and Claude Desktop, using a person's own OpenCode installation and eligible models, including free models. Each user supplies their own provider access. GitHub is the current distribution channel. Do not publish to npm until explicitly requested; npm is permitted for local build/install.

## Architecture

```text
Claude Code / Claude Desktop
  -> authenticated loopback Messages gateway
  -> official OpenCode SDK
  -> normal OpenCode agent session
  -> selected eligible model and OpenCode native tools
```

OpenCode owns instructions, model settings, provider requests, history and tools. Do not replace these with Claude's system prompt or tool registry. Return text/progress to Claude, never duplicate executable tool calls. Disable terminal Claude tools. All normal commands use this backend; earlier model-only experiments are historical test material.

Use supported service discovery/authentication. Start the ordinary service command if missing. Never replace, stop or reconfigure an existing user service. OpenCode/SDK 2.0.32 is the verified contract; verify other versions before claiming support.

## Commands and client scopes

```sh
opencode-claude setup
opencode-claude models --free
opencode-claude model set <provider/model>
opencode-claude smoke --model <provider/model>
opencode-claude run claude [--model <provider/model>] [-- <claude arguments>]
opencode-claude run desktop [--model <provider/model>]
opencode-claude desktop export [--model <provider/model>]
opencode-claude desktop restore
opencode-claude start
opencode-claude stop
opencode-claude doctor
```

Bind each client to its host working directory and selected model. Defaults affect future launches. Concurrent clients may select different models. Catalog capability/pricing is distinct from successful access. Claude-shaped aliases are routing identifiers, not Sonnet/Opus quality claims.

## Permissions and history

Inherit genuine OpenCode configuration and permissions. Relay native pending actions/resources with unpredictable session-bound codes. Explicit user approval invokes the supported permission API once; rejection denies it. Never send codes to the model or silently persist allow rules. Native forms require explicit answers/rejection.

Preserve native continuity within a client credential scope, including completed turns across gateway restarts. Persist retry reservations before native prompts, retain the loopback endpoint, and block recovery of incomplete tasks. Deduplicate exact requests to avoid repeating actions. Reject ambiguous, failed, compacted, branched or unknown histories clearly rather than silently restarting an action. Keep saved native conversations after gateway shutdown.

## Client setup

Preserve saved settings and other profiles. Terminal routing is session-local through a scoped bearer credential and temporary settings file. Reject conflicting Claude tool/agent/permission flags because OpenCode executes the tools. Keep provider keys outside Claude settings.

Desktop gets a dedicated reversible profile. Automatic file setup is verified against Windows Desktop 2.42304.2.0; export on unverified platforms/versions. Never forcibly terminate Desktop or discard work. Verify chat and Code independently. Host paths are not automatically Desktop VM paths.

## Boundaries and verification

Use authenticated loopback scopes and bounded requests, responses, concurrency and runtime. Frontend tokens cannot manage the gateway or change their model/workspace. Do not log private prompts, bodies, keys or environments. Keep private state outside the repository. OpenCode stores actual session history under its normal policy.

Interrupt only owned sessions. No paid fallback, identity spoofing, fabricated eligibility tools, network rotation, quota bypass, binary patches or subscription-unlock claims. Publish under the user's GitHub identity only with explicit instructions. Npm publication remains out of scope.

Verify strict build/lint and contract tests; genuine native-tool permissions/results/continuity/retry/cancellation/isolation; actual Claude Code with conflicting saved routing settings; opt-in live chosen-model requests; separate Desktop profile/chat/Code evidence; and a clean checkout/install with reviewed dependencies and secret-free artifacts. Fixture results alone do not establish free access. Untested platforms/features remain experimental. Record observations in [compatibility](docs/compatibility.md).