# AGENTS.md

## Repository Overview

SillyTavern Tavern Helper script for tracking DeepSeek API usage (token consumption, costs, cache hit rates). No build system, no tests, no package manager.

## File Structure

- `DeepSeek使用预测.js` — Actual script code (IIFE). Edit this file.
- `DeepSeek使用预测V2.10.json` — Full script for manual import into SillyTavern.
- `DeepSeek使用预测-自动更新.json` — Loader that imports from jsDelivr CDN (auto-update).
- `演示/` — Screenshots (gitignored).

## Two Distribution Channels

1. **Manual import**: User downloads `DeepSeek使用预测V2.10.json` and imports directly.
2. **Auto-update**: User imports `DeepSeek使用预测-自动更新.json` once; script loads `DeepSeek使用预测.js` from jsDelivr CDN on each SillyTavern startup.

## Making Changes

1. Edit `DeepSeek使用预测.js` (the source of truth).
2. Update version string in `_ds_current_version` variable.
3. Commit and push to `main`.

## Release Workflow

```bash
gh release create vX.XX --title "release X.XX" --notes "changelog"
gh api -X POST ".../releases/{id}/assets?name=DeepSeek_Statistic_VX.XX.json" ...
gh api -X POST ".../releases/{id}/assets?name=DeepSeek_Statistic_auto_update.json" ...
```

## Key Conventions

- UI built via string concatenation (`PANEL_HTML`) — not templates. Escape carefully.
- Script uses `localStorage` for persistence and `TavernHelper` APIs.
- Version string lives in `_ds_current_version` variable inside the JS.
- PRICING table at top of JS defines per-model costs.

## Gotchas

- The JSON `content` field is a JavaScript string — escaping matters.
- No minification step; the JS is hand-written single-line code.
