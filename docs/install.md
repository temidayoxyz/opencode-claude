# Install from GitHub

Use Node.js 24 LTS with npm, Git, and **OpenCode 2.0.32**. OpenCode is a separate prerequisite; install it from its official distribution and connect your providers in OpenCode. Install Claude Code and/or a Claude Desktop build that supports third-party inference.

The source checkout is the supported GitHub installation route. Replace `YOUR-ACCOUNT` with the repository owner after publication:

```sh
git clone https://github.com/YOUR-ACCOUNT/opencode-claude.git
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
npm install --global ./opencode-claude-0.1.0-dev.1.tgz --ignore-scripts
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

Terminal I/O and Claude's normal tool permissions are preserved. The launcher configures only its child process, using bearer-token authentication and a private session settings file so saved `env` values cannot silently reroute the request. The file is deleted after the client exits; saved user/project files remain unchanged. `--settings` is reserved by the launcher, while normal saved settings still load and managed policy still applies. Compatibility settings omit native thinking parameters and load tools upfront. Restart an existing Claude conversation through this command to change its launch selection; changing the saved default affects future launches.

## Desktop

`run desktop` writes a dedicated **OpenCode** third-party inference profile on the verified Windows Desktop version, selects it, and opens Desktop. It never terminates an open app. Save your work and quit/reopen Desktop if it was already running. Disable extended thinking for this adapter. Text chat and ordinary client tools are the intended subset; the Desktop UI still needs separate validation as described in [compatibility](compatibility.md).

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
```

After changes to OpenCode providers/models, use `stop` then `start` to refresh the catalog. If Desktop was configured before a gateway restart, run `run desktop` again to refresh its local address. No login startup task is installed.

To uninstall, restore the Desktop profile first, stop the gateway, then run `npm uninstall --global opencode-claude`. State is retained in `%LOCALAPPDATA%\opencode-claude` on Windows or `$XDG_STATE_HOME/opencode-claude` (default `~/.local/state/opencode-claude`) elsewhere. `OPENCODE_CLAUDE_HOME` can override it. Do not commit this directory.

Set `OPENCODE_CLAUDE_BIN` to OpenCode's **native executable**, and `CLAUDE_BIN` to Claude Code's executable, if discovery fails. Shell `.cmd` wrappers are not used as native executables on Windows. No administrator access is required when your Node/npm global prefix is user-writable.
