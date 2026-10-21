# Contributing

Use Node 24 LTS. Install exact dependencies without lifecycle scripts:

```sh
npm ci --ignore-scripts
npm run lint
npm run check
npm run build
npm test
```

Native integration checks need OpenCode 2.0.32. They use local fixtures and disposable directories. The Claude check additionally needs Claude Code:

```sh
npm run test:runtime
npm run test:claude
```

Add regression coverage for protocol and action-safety changes. Include the affected client/runtime versions and distinguish automated tests from real UI checks. Do not replace outstanding acceptance gates with weaker claims.

Keep provider keys, prompts, state, generated archives and native downloads out of commits. Report secrets privately as described in SECURITY.md. Keep changes scoped to opencode-claude; no bundled client binaries or provider accounts.

Distribution uses source checkouts or locally built GitHub release archives. The package is private to prevent npm publication. Do not publish it to npm without the owner's explicit instruction.

To reproduce the original five-minute transport cutoff against a real isolated native agent while also testing the corrected observation loop:

```sh
node tests/native-wait-check.mjs --long
```

This opt-in check takes just over five minutes, uses a localhost provider fixture, and expects exactly one native write. The ordinary runtime suite uses the shorter variant.
