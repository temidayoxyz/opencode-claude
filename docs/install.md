# Install from GitHub

Use Node.js 24 LTS with npm, Git, and **OpenCode 2.0.32**. OpenCode is a separate prerequisite; install it from its official distribution and connect your providers in OpenCode. Install Claude Code and/or a Claude Desktop build that supports third-party inference.

The source checkout is the supported GitHub installation route. Clone the public repository:

```sh
git clone https://github.com/temidayoxyz/opencode-claude.git
cd opencode-claude
npm ci --ignore-scripts
npm run build
npm test
npm install --global . --ignore-scripts
opencode-claude setup
opencode-claude models --free
```

These npm commands build and install local files. They do not publish anything to the npm registry. `private: true` prevents accidental registry publication. No install lifecycle scripts are required. Direct `npm install -g github:...` is not supported because the source repository intentionally excludes compiled files and disables automatic build scripts.

Keep the checkout in place: npm may link global commands to a local directory. A built `.tgz` release asset is an alternative:

```sh
npm pack --ignore-scripts
npm install --global ./opencode-claude-0.2.0-dev.3.tgz --ignore-scripts
```

A maintainer can attach that file to a GitHub release. No registry account or publication is needed. Each user supplies their own OpenCode installation and provider access; no keys belong in the repository or release.

## Use

```sh
opencode-claude model set opencode/deepseek-v4.1-flash-free
opencode-claude run claude
opencode-claude run desktop --model opencode/glm-5.3-flash-free
```

The model names above are examples from the 2026-10-20 catalog, not a promise of access. `models --free` means the catalog lists zero input/output prices. A provider can still refuse the request or apply evaluation quotas. `setup`, `models`, and `doctor` make no hosted inference calls.

An explicit access check makes one gateway generation request (the provider/runtime may have its own retry behavior) and may consume provider credits:

```sh
opencode-claude smoke --model opencode/deepseek-v4.1-flash-free
```

Do not keep retrying a denied network/free-tier request. Resolve it with the provider, or explicitly select another legitimate provider. The gateway never selects another model as a fallback.

Forward Claude arguments after `--`:

```sh
opencode-claude run claude --model opencode/deepseek-v4.1-flash-free -- -p "Explain this repository"
```

Terminal I/O is preserved. **OpenCode executes tools under its own permissions; Claude terminal tools are disabled.** Run from the desired host project directory. Routing uses a scoped bearer token and private session settings; saved user/project files remain unchanged. `--settings` and Claude tool, agent and permission flags are reserved. Managed policy still applies. Completed turns can continue in the same running client after a gateway restart. Start a new conversation after relaunching the client or compacting history. Configure generation limits in OpenCode.

## Desktop

`run desktop` writes a dedicated **OpenCode** inference profile on the verified Windows Desktop version, selects it, and opens Desktop. It never terminates an open app. Save work and quit/reopen Desktop if needed. OpenCode controls actual reasoning. Run from the host directory OpenCode should use; Desktop VM paths are not automatically mapped. OpenCode executes the tools. Both tabs need separate UI verification as described in [compatibility](compatibility.md).

Existing provider profile files are preserved. The metadata backup path is printed. Restore the previous selection with:

```sh
opencode-claude desktop restore
```

Other Desktop versions/platforms export a private `desktop-profile.json` in the state directory instead of changing unverified configuration files. `desktop export --model <provider/model>` always exports without selecting a profile. Import it using a compatible Desktop third-party inference setup. This file contains a local gateway credential; do not share it.

## Stop, update, uninstall

```sh
opencode-claude stop
git pull --ff-only
npm ci --ignore-scripts
npm run build
npm test
npm install --global . --ignore-scripts
```

After provider/model changes, use `stop` then `start` to refresh the catalog. Relaunch Desktop to refresh its address and credential. The first upgrade from a version older than 0.2.0-dev.2 requires a new frontend conversation; native conversations remain in OpenCode. No login startup task is installed. The normal OpenCode service stays running when this gateway stops.

To uninstall, restore the Desktop profile first, stop the gateway, then run `npm uninstall --global opencode-claude`. State is retained in `%LOCALAPPDATA%\opencode-claude` on Windows or `$XDG_STATE_HOME/opencode-claude` (default `~/.local/state/opencode-claude`) elsewhere. `OPENCODE_CLAUDE_HOME` can override it. Do not commit this directory.

Set `OPENCODE_CLAUDE_BIN` to OpenCode's **native executable**, and `CLAUDE_BIN` to Claude Code's executable, if discovery fails. Shell `.cmd` wrappers are not used as native executables on Windows. No administrator access is required when your Node/npm global prefix is user-writable.

## Troubleshooting

- **max_tokens / 65536:** update to 0.2.0-dev.2 or later. Session mode accepts larger positive integer frontend budgets; OpenCode still controls generation limits.
- **Desktop removed a non-Anthropic model:** rerun `opencode-claude run desktop` after updating, then quit/reopen Desktop after saving work. The profile uses a compatibility route with the real model's display name.
- **Unknown history:** start a new frontend chat after upgrading from older builds, relaunching, editing an earlier turn or compaction. Earlier native history remains in OpenCode.
- **Interrupted session:** inspect its native OpenCode history before starting new work. The gateway deliberately blocks automatic action replay.
- **Restart cannot bind the saved port:** quit the gateway and resolve the port conflict. Do not terminate an unrelated process blindly. To choose a new endpoint, move `endpoint.json` aside while the gateway is stopped, then relaunch clients.

The private `sessions.json` journal contains reply text, native IDs, history hashes and pending permission details. Keep it private. It does not store frontend prompts or provider keys. Corrupt journals fail closed. Back up state before repair; deleting a journal loses retry protection and frontend continuation mappings. Cache limits persist across restarts. For a fresh isolated state directory, use `OPENCODE_CLAUDE_HOME` and start new frontend conversations; never replay an uncertain task without inspecting it in OpenCode first.

## Longer agent tasks

Version 0.2.0-dev.3 renews the read-only native wait request every 60 seconds. A single headerless request otherwise hits Node fetch's five-minute transport timeout, which interrupted the agent and caused protected HTTP 409 retries. Renewing a wait never resends a prompt, approves a tool, or repeats an action. Client cancellation and the 30-minute turn deadline still interrupt the matching native task.

OpenCode permission codes belong to OpenCode, so Claude's `/permissions` dialog cannot answer them. Reply with the exact displayed `approve CODE` or `reject CODE` in the same chat while the native request is still pending. An expired request is reported before sending the reply; inspect that native session and existing files before starting new work. Protected failures include a native session ID for inspection. The gateway does not clear failed requests automatically.
