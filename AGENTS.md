# Agentation repository instructions

## Qwikbuild releases

When changing or publishing the Qwikbuild Agentation integration, read and follow
`RELEASING-QWIKBUILD.md` before editing versions, creating tags, or uploading artifacts.

The `agentation` frontend package and `agentation-mcp` server are a paired compatibility unit.
Publish both immutable `.tgz` artifacts in the same GitHub release and update AgentQ's committed
`agentQ/agentq_configs/agentation_release.json` with both versions and URLs. Do not publish only one
side when the annotation, screenshot, transport, or persistence contract changes.
