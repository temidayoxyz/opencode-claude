# opencode-claude

**Status: design and feasibility research. No working bridge or release yet.**

A proposed open-source, locally installed gateway between Claude Code or Claude Desktop and a user's own OpenCode runtime. The project is intended for public GitHub distribution and Windows, macOS, and Linux installation.

Each person runs their own copy and uses their own provider access. Publishing this repository would distribute the software, not a shared model service or shared API key.

## Intended experience

1. Install OpenCode and `opencode-claude` from GitHub.
2. Run setup to discover available models and check access.
3. Choose a model and set up Claude Code, Claude Desktop, or both.
4. Start the gateway and use the selected client, subject to verified feature compatibility.

The gateway must preserve native tool calls and tool results before it can claim compatibility with either client's coding workflows. A text-only demo does not meet that requirement.

The shared backend will have separate client setup paths: scoped gateway environment variables for the terminal `claude` command, and a third-party inference profile for Claude Desktop. Desktop chat and the Desktop Code tab will be tested separately from the terminal CLI. See [Anthropic's gateway setup documentation](https://code.claude.com/docs/en/llm-gateway-connect).

## What research established

- OpenChamber and OpenWork use OpenCode as an agent/session backend. Their integration is not evidence that OpenCode's free inference endpoint is a general-purpose public API.
- The installed OpenCode CLI is version **2.0.32**. Its API differs substantially from the older server examples found in public documentation.
- A direct free-model request was rejected. OpenCode's stateless and transient session generation APIs were also rejected.
- A normal OpenCode session with its standard tools retained returned a specific network restriction: the hosted service said it detected abusive traffic from the current IP. That is the service's reported reason; this project has not independently established the cause.
- Native Claude tool compatibility has not yet been demonstrated.

See [the research report](docs/FEASIBILITY.md) and [the proposed specification](SPEC.md).

## Limits

Model availability, free quotas, geographic availability, and network restrictions are controlled by providers. This project cannot guarantee free access, remove provider restrictions, or unlock subscription-controlled Claude features. Unsupported requests must produce a clear error rather than silently losing attachments or tool calls.

The development machine's existing Claude profiles and credentials have not been added to this project. Raw research downloads and local probes are excluded from future Git commits.

## Installation

GitHub is the only planned project distribution channel for now. No npm registry publication will happen unless the project owner explicitly requests it later. npm may still be used locally to install dependencies, build, or install directly from a GitHub checkout.

There is no installable package yet. Installation commands will be added when the compatibility milestone passes. Do not treat a proposed command in the specification as a released package.

## Approved command flow

The intended command interface below has been approved. It is not implemented yet:

```sh
opencode-claude setup
opencode-claude models
opencode-claude run claude --model opencode/minimax-m3.1-flash-free
opencode-claude run desktop --model opencode/deepseek-v4.1-flash-free

opencode-claude model set opencode/minimax-m3.1-flash-free
opencode-claude run claude
opencode-claude run desktop
```

Each `run` command starts the local gateway if needed. An explicit model applies to that launch; the saved default applies to later launches without `--model`. The two clients can have different active model mappings.
