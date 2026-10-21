# Changelog

## 0.2.0-dev.4 - 2026-10-21

### Changed

- Replace raw internal tool names with readable progress phases for browsing, file work, commands, guidance and web lookups.
- Group consecutive operations and emit count summaries at phase/text/turn boundaries. Long groups refresh their count when activity arrives after 30 seconds.
- Preserve operation ordering, cached retry replies, native tool ownership and explicit permission details.
- Document why generic native tool cards require a separate client integration rather than fabricated executable calls.


## 0.2.0-dev.3 - 2026-10-21

### Fixed

- Keep agent tasks running past Node's five-minute header timeout by renewing only the read-only SDK wait request.
- Preserve prompt deduplication, native tool ownership, cancellation and the existing 30-minute turn deadline.
- Identify expired native approval/form requests before sending a stale response. Include native session IDs in protected-failure diagnostics.
- Mark HTTP 409 conflicts non-retryable for clients that honor the standard retry header.
- Recognize Windows Desktop 3.1623.0.0 after checking its installed inference configuration schema.

Failed or interrupted conversations remain protected. Inspect their native history and existing files; this update does not replay them or grant approvals.


## 0.2.0-dev.2 - 2026-10-20

- Accept Desktop frontend token budgets above 65,536 in native session mode. OpenCode controls actual generation limits.
- Use Desktop-compatible route IDs with real OpenCode model display labels.
- Save completed conversation mappings and replies privately across gateway restarts.
- Reserve requests on disk before native execution; incomplete tasks stay blocked after restart.
- Preserve the loopback endpoint so existing clients can reconnect.
- Add restart, retry, corrupt-state and token-budget regression coverage.
- Document GitHub installation, recovery and Desktop verification limits.

Upgrade once: stop/reinstall the gateway, relaunch clients and start a new frontend conversation. Earlier memory-only mappings cannot be recovered; native sessions remain in OpenCode.


## 0.2.0-dev.1 - 2026-10-20

### Fixed

- Accept Desktop thinking preferences without changing OpenCode's native reasoning configuration.
- Reconcile visible text independently of reasoning/tool slots; deduplicate replayed events to prevent repeated text.
- Use real provider/model IDs and display names in both clients. Keep earlier aliases as compatibility routes.
- Accept custom-model frontend instruction roles and tool advertisements without replacing OpenCode instructions/tools.
- Let interrupted initial checks retry only after verified idle and no native actions. Preserve protection after a native write and preserve provider-denial status.
- Report session conflicts as HTTP 409 instead of invalid-model HTTP 400.


## 0.2.0-dev.0 — 2026-10-20

### Changed

- Normal commands use genuine OpenCode sessions through official SDK 2.0.32. OpenCode owns instructions, history and tools; Claude provides the interface.
- Claude terminal tools are disabled; configure agents and permissions in OpenCode.
- Attach to the normal service without reconfiguring it. Shutdown preserves the service and saved conversations.
- Agent models may use any provider protocol supported by OpenCode.

### Added

- Workspace/model-scoped client credentials and explicit native permission/form replies.
- Conversation continuity and completed-request replay without duplicate tool execution.
- Passing live free DeepSeek text and actual Claude terminal native-file-task checks on Windows.
- Deterministic native-agent/tool/permission tests. Desktop chat and Code UI verification remains pending.

### Migration

Stop the earlier gateway, rebuild/reinstall and start a new Claude conversation. Relaunch/export Desktop to refresh its address and scoped credential. Run from the project directory OpenCode should use. Native conversations now live in OpenCode's normal history store.