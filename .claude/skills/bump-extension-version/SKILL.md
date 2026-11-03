---
name: bump-extension-version
description: Bumps the "version" field in manifest.json after any change to the Chrome extension's files (manifest.json, background.js, popup.html, popup.js, icons). Use whenever extension code is edited, or when the user says "bump version", "new release", or "update version".
---

# Bump Extension Version

After editing any extension file, bump `version` in `manifest.json` **at most once per uncommitted batch**. The user commits outside the chat, so never rely on memory of earlier bumps — run this every time before deciding:

```bash
git show HEAD:manifest.json | rg '"version"'; rg '"version"' manifest.json
```

| HEAD vs working tree | Action |
|---|---|
| **Same** (e.g. both `1.7.4`) | Bump once (`1.7.4` → `1.7.5`). |
| **Different** (e.g. HEAD `1.7.4`, working `1.7.5`) | **Do not bump.** The uncommitted work already has its version. Later fixes in the same chat/batch keep that same version. |

A long debugging session with many extension edits still gets **one** patch bump total until the user commits. Do not bump again for each follow-up fix.

Only raise further while still uncommitted if the *kind* of change grew (patch → minor), not because you edited the files again. Major: only when the user asks.

Chrome versions are 1–4 dot-separated integers (e.g. `1.0`, `1.2.3`). Use `MAJOR.MINOR.PATCH`:

- **Patch** (default): bug fixes, tweaks, refactors → `1.0.0` → `1.0.1`
- **Minor**: new user-visible feature or option → `1.0.1` → `1.1.0`
- **Major**: only when the user asks.

If the current version has fewer than 3 parts, pad with zeros first (`1.0` → `1.0.0`), then bump.

Mention the version in one line of the reply: `Version: 1.0.1 → 1.0.2` on bump, or `Version stays 1.0.2` when already bumped.
