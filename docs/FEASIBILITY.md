# Feasibility research

Project: `opencode-claude`. Distribution target: GitHub only until the owner requests npm publication.

Date: 2026-10-20. Runtime inspected locally: OpenCode CLI **2.0.32** on Windows.

## Conclusion

OpenChamber and OpenWork demonstrate that a separately distributed application can use OpenCode as its local agent backend. They do not establish that OpenCode can act as a drop-in model endpoint for Claude Desktop. That requires an additional protocol and tool-execution adapter.

No working Claude bridge has been implemented or validated. Free-model testing currently has a hosted-service network blocker. The project must keep these two uncertainties separate.

## Two Claude clients

The requested compatibility target includes terminal Claude Code (`claude`) and Claude Desktop, including its chat and Code surfaces. The installed terminal CLI reports **2.1.296**.

Anthropic documents gateway routing for the terminal through `ANTHROPIC_BASE_URL` plus a gateway credential. Desktop uses a separate third-party inference configuration. A single Messages gateway can therefore target both connection methods; this is an architectural inference, not a passing result for the proposed OpenCode adapter. The same documentation says that routing to non-Claude models is not supported by Anthropic.

Sources: [client connection setup](https://code.claude.com/docs/en/llm-gateway-connect), [gateway overview](https://code.claude.com/docs/en/llm-gateway), and [protocol compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol).

## What the applications actually do

### OpenChamber

Inspected commit: `ad73d11a6e7cafa0880e238f92ba7cf5cf2cb1fd`.

Its UI wrapper uses the official `@opencode/client`, manages directory context and request timeouts, selects the session model/agent, and sends messages through `session.prompt`. It consumes OpenCode session state rather than converting the provider into a generic model API.

Sources:

- [Client wrapper](https://github.com/openchamber/openchamber/blob/ad73d11a6e7cafa0880e238f92ba7cf5cf2cb1fd/packages/ui/src/lib/opencode/client.ts)
- [Runtime lifecycle](https://github.com/openchamber/openchamber/blob/ad73d11a6e7cafa0880e238f92ba7cf5cf2cb1fd/packages/web/server/lib/opencode/lifecycle.js)

### OpenWork

Inspected commit: `14a3876712fd5d6bfa54c137648bcb72d88f83fe`.

Its managed v2 integration starts `opencode serve`, controls the runtime lifecycle, uses a generated local password, and isolates managed configuration/state. Its UI has a v2 adapter for session behavior.

The file named `opencode-v2-inference-proxy.ts` handles OpenWork-managed organization provider connections. It is not a general-purpose adapter for OpenCode's free models. Its presence should not be used to claim that free model access is exportable as a raw inference API.

Sources:

- [Managed runtime](https://github.com/different-ai/openwork/blob/14a3876712fd5d6bfa54c137648bcb72d88f83fe/apps/server/src/managed-opencode-v2.ts)
- [Frontend adapter](https://github.com/different-ai/openwork/blob/14a3876712fd5d6bfa54c137648bcb72d88f83fe/apps/app/src/app/lib/opencode-v2-adapter.ts)
- [Organization provider proxy](https://github.com/different-ai/openwork/blob/14a3876712fd5d6bfa54c137648bcb72d88f83fe/apps/server/src/opencode-v2-inference-proxy.ts)

## Inspected OpenCode boundaries

Current upstream source inspected at `d8148796dc74a342c96c7b4febf03dc664e1058c`; this development commit is not assumed identical to the installed release. The installed runtime's own OpenAPI document was used to verify its HTTP schema.

| Operation | Observed interface | Implication |
| --- | --- | --- |
| `session.prompt` | A user text prompt and attachments admitted to an agent session | The runtime owns the agent loop; this is the integration used by alternate frontends. |
| `session.generate` | A prompt in session context; returns `{data: {text}}` | No complete native model/tool response is returned by this HTTP operation. |
| `experimental.generate.text` | Prompt plus optional model; returns text | Not a Messages-compatible endpoint. |
| Session plugin hooks | Context, generation, model request, HTTP response hooks | Possible extension points; they do not by themselves prove native tool compatibility. |
| Tool transforms | Register/update tools and tool execution hooks | Potential boundary to investigate under actual provider rules. |

In the inspected upstream request preparation, tool definitions invented only inside a session hook are dropped unless they correspond to registered tools. Simply inserting Claude tool schemas into a context hook is therefore not a proven implementation.

Sources:

- [Session generation](https://github.com/anomalyco/opencode/blob/d8148796dc74a342c96c7b4febf03dc664e1058c/packages/core/src/session/generate.ts)
- [Model request preparation](https://github.com/anomalyco/opencode/blob/d8148796dc74a342c96c7b4febf03dc664e1058c/packages/core/src/session/model-request.ts)
- [Public session plugin interface](https://github.com/anomalyco/opencode/blob/d8148796dc74a342c96c7b4febf03dc664e1058c/packages/plugin/src/promise/session.ts)
- [Public tool plugin interface](https://github.com/anomalyco/opencode/blob/d8148796dc74a342c96c7b4febf03dc664e1058c/packages/plugin/src/promise/tool.ts)

## Live probes

All prompts were short requests to reply `OK`. No user credentials were extracted. Disposable sessions were scoped to a dedicated probe directory. No tool execution was approved.

| Probe | Model | Result |
| --- | --- | --- |
| Direct unauthenticated inference request with honest project identity | `minimax-m3.1-flash-free` | HTTP 403, `FreeTierError`, saying the free tier is limited to OpenCode. |
| Official CLI `experimental.generate.text` | Same | Service error carrying the free-tier restriction. |
| Official CLI `session.generate`, all tools denied | Same | Service error carrying the free-tier restriction. |
| Official CLI `run` in that denied-tool session | Same | Provider HTTP 403 carrying the free-tier restriction. |
| Official CLI `run`, standard tools retained, every tool requires approval | Same | Provider HTTP 403 specifically stating that free models are blocked on the current network due to detected abusive traffic from the IP; the message says it is not account-related. |

Denying all tools is a confounding factor for the earlier session probes. Upstream reports also associate tool removal with free-tier errors. The standard-tool probe avoids that confound and exposes the more specific network rejection. This report does not conclude that session APIs always reject free access or that every free model was individually tested.

No attempt was made to defeat the block by changing IP addresses, impersonating another client, rewriting headers, or changing provider eligibility checks.

Relevant upstream issue reports, as observed on the research date:

- [Free model failures in the official v2.0.32 client](https://github.com/anomalyco/opencode/issues/56324)
- [Failures when read or shell permissions are denied](https://github.com/anomalyco/opencode/issues/51241)
- [Requests through a custom provider and modified request bodies](https://github.com/anomalyco/opencode/issues/56662)
- [Network abuse-detection block and provider review](https://github.com/anomalyco/opencode/issues/56853)

Issue comments are reports, not a stable API contract or authorization to bypass a hosted service restriction.

For a network abuse-detection block, an upstream support response directs affected users to the provider's support team for review. A bridge cannot lift that flag. Do not publish IP addresses, email addresses, credentials, or account details in the public project when seeking assistance.

## Compatibility milestone

The next experiment needs to show one real tool round trip through supported OpenCode interfaces: a Claude tool schema is presented, the model returns its actual call, Claude executes it once, and the result is consumed by the same logical conversation. The test must also show cancellation and conversation isolation. A mock provider can validate local protocol logic; it cannot establish free-tier eligibility.

If supported OpenCode integration necessarily requires OpenCode to execute its own agent tools, the honest alternative is an explicit delegated-agent integration. That alternative needs a scope decision because it changes how Claude coding workflows operate.

The current network rejection prevents the real free-model acceptance test. Until that test and native tool handling pass, this remains a researched design rather than a working public product.
