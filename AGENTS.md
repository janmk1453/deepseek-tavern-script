# AGENTS.md

## Overview

SillyTavern Tavern Helper script that tracks DeepSeek API usage (tokens, cost, cache hit rates). No build system, no tests, no package manager.

## Files

- `DeepSeek使用预测.js` — Source of truth (IIFE). Edit this file.
- `DeepSeek使用预测V2.11.json` — Packaged JSON for manual import; copy & rename from previous version on release. `content` must stay in sync with JS.
- `DeepSeek使用预测-自动更新.json` — Auto-update loader; imports JS from jsDelivr CDN. Only touch if URL changes.
- `README.md` — Docs; update changelog in lockstep.
- `演示/` — Screenshots (gitignored).

## Making Changes

1. Edit `DeepSeek使用预测.js`
2. Bump `_ds_current_version` variable (currently `"2.11"`)
3. **Sync JSON** — extract the IIFE into the versioned JSON's `content` field:
   ```bash
   node -e "var f=require('fs');var js=f.readFileSync('DeepSeek使用预测.js','utf8');var i=js.indexOf('(function()');var json=JSON.parse(f.readFileSync('DeepSeek使用预测V2.11.json','utf8'));json.content=js.substring(i);f.writeFileSync('DeepSeek使用预测V2.11.json',JSON.stringify(json,null,2)+'\n');console.log('synced')"
   ```
4. Validate: `node --check DeepSeek使用预测.js` and `node -e "new Function(JSON.parse(require('fs').readFileSync('DeepSeek使用预测V2.11.json','utf8')).content);console.log('valid')"`
5. Update `README.md` changelog if needed
6. Commit and push to `main`

## Delivery

Auto-update users fetch JS directly from `main` branch via jsDelivr CDN — no separate gh-pages deploy step.

```bash
# Release (manual JSON only — auto-update is always live from main)
gh release create vX.XX --title "release X.XX" --notes "<changelog>"
gh release upload vX.XX "DeepSeek使用预测VX.XX.json" "DeepSeek使用预测-自动更新.json"
```

> **jsDelivr cache**: The CDN caches `@main` for ~12 hours. For instant delivery, use a version tag (e.g. `@v2.10`) and update the auto-update JSON, or wait for natural cache expiry.

## Script Architecture

- **IIFE** — single `(function() {` at top, no imports/requires
- **UI** — `PANEL_HTML` string concatenation (not a template); all `"` must be escaped as `\"`
- **Persistence** — dual: `localStorage` for key/balance, `getAllVariables`/`replaceVariables` (TavernHelper API) for saves/settings
- **Pricing** — `PRICING` object at top: `{ offpeak: {...}, peak: {...} }` per model; `isPeakHour()` uses Beijing timezone
- **Version** — `_ds_current_version` variable near top of JS
- **API patching** — monkey-patches `fetch` globally to intercept API responses and record usage
- **Update check** — fetches latest release info from GitHub Releases API

## Gotchas

- **JSON escaping**: `content` is a JSON string literal; all `\` and `"` inside must be properly escaped for JSON.
- **jsDelivr cache**: The CDN caches `@main` for ~12 hours. For instant delivery, use a version tag (e.g. `@v2.10`) and update the auto-update JSON, or wait for natural cache expiry.
- **Chinese encoding**: JS source uses UTF-8 encoded Chinese characters in `PANEL_HTML` and UI strings. Any file copy must preserve UTF-8 encoding (use `git checkout` not shell redirection).
- **Sync discipline**: After editing JS, always regenerate V2.11.json. The auto-update JSON only needs changes if the import URL changes.
- **Windows encoding**: `gh release upload` with Chinese filenames via PowerShell will mangle the asset names. Workaround: rename files to ASCII before upload, then rename back. Or use `cmd /c` with proper quoting.
