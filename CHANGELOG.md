# Changelog

## 0.2.0-dev.1 ? 2026-10-20

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