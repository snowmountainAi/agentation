# Publishing Agentation for Qwikbuild

The Qwikbuild frontend and MCP server are one compatible release unit. Publish both immutable
tarballs whenever either side of the annotation/screenshot contract changes.

## Version and verify

1. Bump `package/package.json` using the next `3.0.x-qwikbuild` version.
2. Bump `mcp/package.json` using the next `1.2.x-qwikbuild` version.
3. Run:

   ```bash
   pnpm install
   pnpm --filter agentation test
   pnpm --filter agentation build
   pnpm --filter agentation-mcp build
   ```

## Pack and publish

Pack from each package directory so the filenames contain their package versions:

```bash
mkdir -p release-artifacts
(cd package && pnpm pack --pack-destination ../release-artifacts)
(cd mcp && pnpm pack --pack-destination ../release-artifacts)
```

Commit the source and version changes, push `main`, and create one GitHub release whose tag matches
the frontend version:

```bash
git tag v<frontend-version>
git push origin main v<frontend-version>
gh release create v<frontend-version> release-artifacts/*.tgz \
  --repo snowmountainAi/agentation \
  --title "v<frontend-version>" \
  --notes "Paired Qwikbuild frontend and MCP artifacts."
```

## Point AgentQ at the release

Update all three relevant values in AgentQ's `agentQ/agentq_configs/agentation_release.json`:

- `revision`: include both artifact versions;
- `frontend.version` and `frontend.artifact_url`;
- `mcp.version` and `mcp.artifact_url`.

Commit and deploy AgentQ. Do not run the old fleet migration script for a routine release. Each
sandbox reconciles the immutable artifacts when Visual Feedback is next opened, and restarts Vite
or the MCP server only when its corresponding artifact changed.

## First-sandbox check

Use one development sandbox first. Confirm port `4747` is healthy, annotations retain screenshot
metadata, and a second Visual Feedback open does not run `pnpm`. Then deploy AgentQ to production.
