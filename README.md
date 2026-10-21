# opencode-claude

Use Claude as the interface to a genuine OpenCode agent session. OpenCode runs the selected model and executes its tools under your OpenCode configuration and permissions.

**Experimental 0.2.0-dev.4.** On Windows, real Claude Code **2.1.296** passed text and a native file task using **`opencode/deepseek-v4.1-flash-free`** through OpenCode **2.0.32**. Desktop profile setup is implemented; Desktop chat and Code UI verification is pending. Other models and platforms require their own checks.

## Install from GitHub

Requires Node 24 LTS, OpenCode 2.0.32 and your chosen Claude client. Connect providers in OpenCode first:

```sh
git clone https://github.com/temidayoxyz/opencode-claude.git
cd opencode-claude
npm ci --ignore-scripts
npm run build
npm test
npm install --global . --ignore-scripts
opencode-claude setup
```

GitHub is the distribution channel. npm builds and installs local files; registry publication is disabled. A built `.tgz` can also be installed from a GitHub release. See [installation and updates](docs/install.md).

## Choose a model and launch

Run from the project directory you want OpenCode to work in:

```sh
opencode-claude models --free
opencode-claude smoke --model opencode/deepseek-v4.1-flash-free
opencode-claude run claude --model opencode/deepseek-v4.1-flash-free
opencode-claude run desktop --model opencode/deepseek-v4.1-flash-free
```

Or save a default:

```sh
opencode-claude model set opencode/deepseek-v4.1-flash-free
opencode-claude run claude
opencode-claude run desktop
```

`models --free` means OpenCode lists zero input/output prices. It does not promise access. Every user supplies their own eligible OpenCode account, connections and quotas. No model fallback is selected by this gateway.

## Tools and permissions

Claude's terminal tools are disabled for this launch. OpenCode receives your user prompts and owns the model instructions, history, agents and tools. Configure tools, permissions and generation limits in **OpenCode**.

When OpenCode requests permission, the response shows the action and resources. Reply with the displayed code:

```text
approve A1B2C3D4E5F6
```

Or `reject A1B2C3D4E5F6`. Approval applies once to that pending request. Native questions use `answer CODE {"field":"value"}` as shown in the response. Codes are handled locally and are never sent to the model as approval instructions.

Progress uses readable phases such as "Opening a page..." and "Updating files...". Consecutive operations are grouped and summarized; counts describe operations, not files changed or successful outcomes. Native permission details retain the exact action identifier. The workspace is the host directory from which you launched the command. Desktop Code's VM workspace is not automatically mapped to it.

## What has been tested

- Real Claude Code with free DeepSeek: text and a native file task passed.
- Local native OpenCode tests: permission relay, one file write, tool-result consumption, multiple turns and retry replay passed.
- Windows Desktop 2.42304.2.0 / 3.1623.0.0: dedicated profile, backup and restore are implemented and tested as file operations. Chat and Code UI checks remain pending.
- Text and Messages streaming are supported. Images, documents, frontend thinking blocks, server tools and structured output are outside the current subset. Desktop thinking preferences are accepted; OpenCode controls actual reasoning.

Completed conversations survive gateway restarts in the same running client, with the same credential and unchanged history. Start a new conversation after relaunching a client, editing an older branch or compacting its history. Conversations created before 0.2.0-dev.2 need a new frontend conversation once. Native conversations remain saved in OpenCode. Unknown histories are rejected. See [compatibility](docs/compatibility.md).

## How it works

```text
Claude Code / Claude Desktop
        | local authenticated Messages API
opencode-claude on 127.0.0.1
        | official @opencode/client SDK
normal OpenCode 2.0.32 service
        | session.prompt -> agent -> native tools -> model
selected eligible provider/model
```

The gateway attaches to the normal OpenCode service. If absent, it starts OpenCode's ordinary service command. It does not replace or reconfigure an existing service. `stop` stops this gateway and interrupts its own active sessions; the OpenCode service and saved conversations remain.

Saved Claude settings are preserved. The terminal launcher uses private temporary routing settings. Desktop gets a dedicated reversible profile. Credentials and scope records live outside the checkout. OpenCode stores session history under its own configuration; this is not stateless inference.

```sh
opencode-claude doctor
opencode-claude stop
```

`doctor`, `models` and `setup` do not make hosted inference requests. `smoke` explicitly makes a text request. Claude Code uses the actual provider/model ID. Desktop requires a Claude-shaped route ID; its display label names the actual model. That compatibility route and the `sonnet` family setting describe Desktop configuration, not model identity, benchmark quality or subscription tier. Provider restrictions and subscription entitlements are unchanged.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm run test:runtime
npm run test:claude
```

Runtime checks use local fixtures and pinned OpenCode; the last also needs Claude Code. Older model-only experiments remain under `test:legacy` for comparison and are not used by normal commands.

See the [specification](SPEC.md), [current evidence](docs/compatibility.md) and [changelog](CHANGELOG.md). OpenChamber and OpenWork informed this approach; their code is not bundled. Independent, MIT licensed. Distributed through this GitHub repository. No npm registry package is published.