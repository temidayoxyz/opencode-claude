# Compatibility and evidence

Recorded 2026-10-20 for **0.2.0-dev.2**. The default backend is a genuine OpenCode agent session using official SDK **2.0.32**. The earlier model-only adapter is superseded.

| Capability | Evidence |
| --- | --- |
| Windows runtime | Node 24.22.0, TypeScript 6.0.3, OpenCode 2.0.32 |
| Official SDK connection | Attached to the existing service without changing configuration, permissions, tools or provider headers |
| Live free text | `opencode/deepseek-v4.1-flash-free` returned READY through a normal SDK session and the production smoke command |
| Real Claude Code + free model | Claude Code 2.1.296 used the production launcher with its own tools disabled; OpenCode/DeepSeek created a proof file with exact requested content and returned READY |
| Native tools and permissions | Local fixture: permission shown, no file before approval, one native write after approval, result consumed, next turn continued the same session |
| Retry safety | Completed requests replay; in-progress or failed requests are rejected without silently running actions again |
| Cancellation/isolation | Genuine OpenCode provider disconnect verified; another conversation completes and the normal service remains healthy |
| Installed 0.2.0-dev.2 + live free DeepSeek | Selected Desktop profile route accepted a 131,072-token frontend budget and adaptive thinking; completed retry made no inference call; next turn continued the same native session after gateway restart |
| Restart recovery | Completed replies and continuations reload, credentials remain isolated, incomplete tasks stay blocked, corrupt journals fail closed, and endpoint reuse passes |
| Gateway lifecycle | Concurrent starts reuse one authenticated worker; setup/catalog/default/export and owned shutdown pass without hosted inference |
| Desktop profile | Preservation, backup and restore tested in disposable directories; Windows Desktop 2.42304.2.0 schema inspected |
| Desktop chat / Code | **UI verification pending** separately for both tabs |
| Other models | Catalog capability checks until a live test passes |
| macOS / Linux | Portable source and unit/build CI configured; native-client verification pending |

## Session behavior

OpenCode owns system instructions, provider protocol, agent configuration, tools and history. New user text goes through `session.prompt`. The gateway does not rewrite OpenCode's request or register Claude tools. Claude terminal tools are disabled. Desktop tools are not invoked by this backend.

Enabled, nondeprecated OpenCode models with agent tool support may use any provider protocol OpenCode supports. Listed free prices do not guarantee eligibility. Alias names do not make performance claims.

Native text deltas become Messages events. Native tool names appear as progress text. Reasoning traces and tool outputs are not exposed as fabricated Claude tool calls. Completed context reconciles missed text. Usage comes from OpenCode's reported model-step counts, including cached input; local progress/permission text is not independently token-counted.

OpenCode generation settings govern the agent. Frontend system prompts, tool definitions, temperature, stop sequences and max-token settings are not imposed on the native request. Frontend thinking preferences and tool advertisements are accepted as client metadata. OpenCode keeps its own reasoning and tool configuration. Images, documents, frontend thinking content blocks, Anthropic server-tool execution, structured output, Claude-native tools and automatic Desktop VM path mapping are unsupported.

The workspace is bound to a scoped credential at launch. Run from the desired host project directory. Desktop Code may still initialize its own workspace; OpenCode operates in the bound host directory.

## Permissions and questions

OpenCode permissions are inherited unchanged. Pending requests show the actual action/resources and a random response code. Exact replies `approve CODE` or `reject CODE` call the supported permission API with `once` or `reject`. No persistent allow rule is created. Native forms use explicit JSON answers or rejection. Codes belong to the pending session and are not forwarded to the model.

Configure permissions in OpenCode. Claude's flags cannot govern tools executed by OpenCode, so conflicting tool, agent and permission flags are rejected by the launcher.

## History, retries and cancellation

Canonical frontend histories identify continuations within a client credential scope. Client/model scopes and frontend user IDs isolate conversations. Exact completed requests replay without duplicating actions. A failed or cancelled task that may have performed actions stays protected and returns a conflict/inspection message. An interrupted initial request can retry only after OpenCode is verified idle with no tool, shell or compaction activity. Provider denials retain their original status.

Completed continuation mappings and reply caches persist atomically outside the checkout. The gateway retains its loopback port. The same running client can continue a completed turn after restart while its credential remains valid and its history is unchanged. In-flight reservations reach disk before native prompts; recovered incomplete sessions remain blocked. Start a new frontend conversation after client relaunch, history compaction or editing an older branch. Pre-0.2.0-dev.2 mappings were memory-only and cannot be restored. Unknown histories return HTTP 409. Native conversations remain in OpenCode with title `opencode-claude`.

Limits: eight concurrent sessions, 256 conversations and 2,048 request records per state directory, bounded reply cache and bodies, 30 minutes per turn. Full caches return explicit errors. Terminal/smoke credentials expire after seven days; Desktop credentials after one year. Relaunch/export to renew them.

Cancellation interrupts only the matching owned session. Shutdown interrupts owned active/waiting sessions, never stops the normal OpenCode service and never kills unrelated process IDs.

## Privacy and setup

Loopback HTTP is authenticated and browser origins are rejected. Each frontend has a model/workspace-scoped token that cannot call management endpoints. Stored scopes contain token hashes and context, not provider keys. The master management key stays outside frontend settings.

OpenCode stores actual prompts, tool activity and conversations in its normal database. Its plugins and project/global instructions remain part of the user's trust boundary. This supersedes the earlier stateless/private-runtime description. The gateway does not log prompts, provider bodies or keys. Its private journal saves reply text, native session/message IDs, continuation/request hashes and pending permission/form data. Protect this state as conversation data. Files use restrictive POSIX modes or inherited Windows user ACLs; they are not DPAPI encrypted.

Terminal routing uses a local bearer token and an empty API-key value. Private session settings override conflicting saved routing values without modifying saved files; managed policy remains authoritative. Desktop's separate profile contains its scoped local credential. Do not share it.

## Historical diagnosis

Version 0.1 replaced the system context and tool definitions for transient generation. Fixtures passed, but the free endpoint rejected that converted request. The user correctly requested the native-session design used by OpenCode frontends. Version 0.2 preserves genuine native behavior, and live free DeepSeek text and file checks now pass here. This is evidence for this model and environment, not a promise about every provider's access policy.

## Desktop model routes

Windows Desktop requires an Anthropic-shaped inference route. Profiles therefore use `claude-sonnet-4-6-oc-<hash>` and label it with the selected OpenCode model name. The gateway resolves that route to the exact provider/model selected at launch. The family setting is a client configuration hint; it does not mean the backend is Sonnet or imply Opus-level benchmark performance. Claude Code uses the actual provider/model ID.

Desktop UI verification remains pending. The profile and request-shape regressions are covered by automated tests; that evidence does not establish that every Chat or Code interaction works.
