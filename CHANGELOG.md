# Changelog

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