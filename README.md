# opencode-claude

Use your own OpenCode models through a local gateway for Claude Code and Claude Desktop.

**Experimental version 0.1.0-dev.1.** The real Claude Code tool round trip passes with OpenCode and a deterministic local fixture. Desktop profile setup is implemented; Desktop chat and Code UI checks are pending. The hosted free service currently **rejects this model-only adapter request**, even though the same model can work inside OpenCode. Fixture success does not establish hosted free-tier compatibility.

## Install from GitHub

Requires **Node 24 LTS**, **OpenCode 2.0.32**, and your chosen Claude client. Connect providers in OpenCode first. After this repository is published, replace `YOUR-ACCOUNT` below:

```sh
git clone https://github.com/YOUR-ACCOUNT/opencode-claude.git
cd opencode-claude
npm ci --ignore-scripts
npm run build
npm test
npm install --global . --ignore-scripts
opencode-claude setup
```

Distribution is GitHub only. npm is used as a local build/installation tool; no npm registry publication is configured. A compiled `.tgz` can also be installed from a GitHub release. See [installation, updates and uninstall](docs/install.md).

## Choose a model and launch

```sh
opencode-claude models --free
opencode-claude run claude --model opencode/deepseek-v4.1-flash-free
opencode-claude run desktop --model opencode/glm-5.3-flash-free
```

Or save a default:

```sh
opencode-claude model set opencode/deepseek-v4.1-flash-free
opencode-claude run claude
opencode-claude run desktop
```

The examples use catalog model names, not guaranteed free access. `models --free` reports listed zero input/output prices. Each person runs their own gateway with their own OpenCode provider credentials and quotas.

Each launch starts the gateway if needed. Terminal and Desktop can use different selections simultaneously. A launch override leaves the saved default unchanged. Neutral Claude-shaped aliases are compatibility identifiers; they do not claim the selected model is Sonnet or Opus.

```sh
opencode-claude doctor
opencode-claude smoke --model opencode/deepseek-v4.1-flash-free
opencode-claude stop
```

`doctor` does not call a hosted model. `smoke` makes an explicit inference request and records a text-only result; provider billing/access rules apply. There is no gateway-selected fallback to another model. `protocol OK` in `models` only describes the implemented wire format, not provider acceptance.

## What works and what is limited

- **Claude Code 2.1.296:** the actual launcher passed a fixture-backed file-write/tool-result task through real OpenCode, with Claude executing the action once and OpenCode executing no tool.
- **Desktop:** dedicated profile, backup, restore and version checks are implemented for Windows Desktop 2.42304.2.0. Other platforms/versions export a private profile for manual setup. Existing profiles are preserved, and an open app is never terminated. Desktop chat and Code still require separate UI verification.
- **Protocol:** text, custom client tools, tool results and Chat Completions SSE. Images/documents, native thinking, server tools, structured-output schemas and other unsupported payloads fail explicitly. Disable Desktop extended thinking. See the full [compatibility matrix](docs/compatibility.md).
- **Free models:** provider eligibility, quotas and network restrictions remain in force. No live free-model workflow is advertised as passing until an eligible end-to-end check succeeds.

## How it works

```text
Claude Code / Claude Desktop
        | native Messages API, local credential
opencode-claude (127.0.0.1)
        | genuine OpenCode session + supported plugin hooks
owned OpenCode 2.0.32 runtime
        | existing user provider connection
selected model
```

The plugin supplies the caller's full conversation and actual tools to transient generation. The gateway translates actual model responses into native Messages events; Claude keeps responsibility for executing tools under its own permissions. There is no nested OpenCode agent executing duplicate actions.

The user-managed OpenCode service is preserved. Application state is outside the checkout. The gateway does not log prompts or provider keys and does not copy provider credentials into source. The local gateway key and exported Desktop profile are private files; do not share them.

OpenCode's versioned API is pinned because its v2 interfaces differ from older SDK examples. This project does not unlock Claude subscription entitlements, impersonate clients, or bypass hosted-service access checks. Anthropic documents [gateway connection methods](https://code.claude.com/docs/en/llm-gateway-connect), but does not officially support non-Claude model routing.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm run test:runtime
npm run test:claude
```

The last two commands require the pinned native OpenCode binary; the last also requires Claude Code. They use local fixture models, not hosted inference. GitHub unit/build checks are configured for Windows, macOS and Linux. Actual native-client evidence currently comes from Windows.

Research and design: [feasibility](docs/FEASIBILITY.md), [tool evidence](docs/tool-compatibility.md), [specification](SPEC.md). OpenChamber and OpenWork informed the managed-runtime research; this implementation is original and does not bundle their code. OpenCode and Claude are third-party products, not sponsors of this project.

MIT licensed. No public GitHub repository or npm release has been published by this local build.
