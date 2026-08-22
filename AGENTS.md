# AGENTS.md

## Overview

SillyTavern Tavern Helper script that tracks DeepSeek API usage (tokens, cost, cache hit rates). No build system, no tests, no package manager.

**Rule: Never commit, push, deploy to gh-pages, or release unless explicitly asked. Only edit files and sync JSON.**

**版本号规则：未经用户明确要求，禁止推进 `_ds_current_version` 版本号、或重命名版本化 JSON 文件。功能修改只编辑代码并同步 content 即可，保持版本号不变。面板标题栏的 release 徽章会自动读取 `_ds_current_version` 动态显示（`release' + _ds_current_version + '`），升级版本号时无需（也禁止）再单独硬编码修改徽章；"使用说明"区域已移除版本徽章。**

## Files

- `DeepSeek使用预测.js` — Source of truth (IIFE). Edit this file.
- `DeepSeek_Statistic_V2.25.json` — Packaged JSON for manual import; copy & rename from previous version on release. `content` must stay in sync with JS.
- `DeepSeek_Statistic_auto_update.json` — Auto-update loader (GitHub Pages). Only touch if URL changes.
- `DeepSeek_Statistic_auto_update_jsDelivr_cdn.json` — Auto-update loader (jsDelivr CDN). Only touch if URL changes.
- `README.md` — Docs; update changelog in lockstep.

## Making Changes

1. Edit `DeepSeek使用预测.js`
2. Bump `_ds_current_version` variable (e.g. `"X.XX"`) — the title-bar release badge reads this variable dynamically, so no separate badge edit is needed
3. **Sync JSON** — extract the IIFE into the versioned JSON's `content` field:
   ```bash
    node -e "var f=require('fs');var js=f.readFileSync('DeepSeek使用预测.js','utf8');var i=js.indexOf('(function()');var json=JSON.parse(f.readFileSync('DeepSeek_Statistic_V2.25.json','utf8'));json.content=js.substring(i);f.writeFileSync('DeepSeek_Statistic_V2.25.json',JSON.stringify(json,null,2)+'\n');console.log('synced')"
    ```
4. **Rename JSON** — rename `DeepSeek_Statistic_VX.XX.json` to the new version (e.g. `DeepSeek_Statistic_V2.25.json`), or copy from previous version on release.
5. Validate: `node --check DeepSeek使用预测.js` and `node -e "new Function(JSON.parse(require('fs').readFileSync('DeepSeek_Statistic_V2.25.json','utf8')).content);console.log('valid')"`
6. Update `README.md` changelog if needed
7. Commit and push to `main`

## Deploy to GitHub Pages (for auto-update)

Auto-update users fetch JS from `gh-pages` branch via GitHub Pages. After pushing to `main`:
(The jsDelivr CDN auto-update users fetch from the same `gh-pages` branch automatically.)

```bash
git checkout gh-pages
git checkout main -- "DeepSeek使用预测.js"
git commit -m "deploy: update script to vX.XX"
git push
git checkout main
```

**⚠️ ENCODING WARNING**: Never use `>` / `Out-File` / `cp` in PowerShell to copy the JS file. These commands recode UTF-8 bytes through the system code page (GBK on Chinese Windows), corrupting all Chinese characters and causing syntax errors. `git checkout` preserves exact repository bytes.

**`.nojekyll` warning**: DO NOT add `.nojekyll` to the `gh-pages` branch. It causes GitHub Pages builds to fail with "Page build failed" error, breaking the auto-update script delivery. The `README.md` on the `gh-pages` branch provides enough content for the legacy Jekyll build to succeed.

## Release

```bash
# 1. 创建 release
gh release create v2.25 --title "release 2.25" --notes "<changelog>"

# 2. 上传资产（--clobber 允许覆盖已有文件）
gh release upload v2.25 --clobber "DeepSeek_Statistic_V2.25.json" "DeepSeek_Statistic_auto_update.json" "DeepSeek_Statistic_auto_update_jsDelivr_cdn.json"

# 3. 刷新 jsDelivr CDN 缓存
Invoke-RestMethod -Uri "https://purge.jsdelivr.net/gh/janmk1453/deepseek-tavern-script@gh-pages/DeepSeek%E4%BD%BF%E7%94%A8%E9%A2%84%E6%B5%8B.js" -Method Get | Out-Null
```

> 如需在 release 创建后修改 release notes，使用 `gh release edit vX.XX --notes "<new_changelog>"`。

Release notes 必须遵循以下固定格式：

```markdown
## 2.25 更新内容

### 新增功能
- ...

### 改进
- ...

### 修复
- ...

---

## 📥 下载指引

| 文件 | 说明 | 推荐 |
|------|------|------|
| \DeepSeek_Statistic_V2.25.json\ | 完整版脚本，手动导入 | 需要特定版本时使用 |
| \DeepSeek_Statistic_auto_update.json\ | 自动更新版（GitHub Pages），导入后自动获取最新脚本 | ✅推荐 |
| \DeepSeek_Statistic_auto_update_jsDelivr_cdn.json\ | 自动更新版（jsDelivr CDN），导入后自动获取最新脚本 | 该渠道更新较慢，但国内网络适应性强 |

### 自动更新使用方法
1. 下载 \DeepSeek_Statistic_auto_update.json\
2. 在 SillyTavern 中的酒馆助手导入该文件
3. 之后每次启动自动获取最新版本，无需手动更新

### 手动更新使用方法
1. 下载 \DeepSeek_Statistic_V2.25.json\
2. 在 SillyTavern 中的酒馆助手导入该文件
3. 每次更新需重新导入
```

其中 2.25 替换为实际版本号，各更新内容章节按实际情况填写，无内容的章节可省略。

> **jsDelivr cache**: Clears within minutes after push; manual purge at https://www.jsdelivr.com/tools/purge

## Script Architecture

- **IIFE** — single `(function() {` at top, no imports/requires
- **UI** — `PANEL_HTML` string concatenation (not a template); all `"` must be escaped as `\"`
- **Persistence** — dual: `localStorage` for key/balance, `getAllVariables`/`replaceVariables` (TavernHelper API) for saves/settings
- **Pricing** — `PRICING` object at top: `{ offpeak: {...}, peak: {...} }` per model; `isPeakHour()` uses Beijing timezone
- **Version** — `_ds_current_version` variable near top of JS is the single source of truth; the title-bar release badge reads it dynamically (`release' + _ds_current_version + '`), never hardcode the version in `PANEL_HTML`
- **API patching** — monkey-patches `fetch` globally to intercept API responses and record usage
- **Persistence failure handling** — `saveData` double-writes (`replaceVariables` via `saveWithRetry` + `localStorage` via `saveToLS`); if both fail it issues `_ds_log.error` + `_ds_toast('error', ...)`. `loadSavedData` backs up a corrupt saves blob to `ds_saves_corrupt_backup_<ts>` before resetting, so a partial corrupt file is never silently overwritten by `createNewSave()`.
- **Update check** — fetches latest version from GitHub Pages raw file (not API)

## Logging & Error Handling

**Always route logs through the `_ds_log` helper (defined near top of JS), never bare `console.log`.** Bare `console.*` in shipped code is a regression.

```js
_ds_log.debug(...);  // 默认关闭；localStorage.setItem('ds_debug_log','1') 开启
_ds_log.warn(...);   // 同类（按首参数）去重，防止刷屏
_ds_log.error(...);  // 失败点永远可见
_ds_toast(type, msg); // toastr 包装；toastr 不可用时仅 debug 提示
```

Console filtering: type `-[DS]` to isolate this script's logs.

**Empty `catch` grading (decision matrix)** — never add a bare `catch(e) {}` without judgment:

| Failure consequence | Required action |
|--------------------|-----------------|
| Data loss / lost stats record | `_ds_log.error` + `_ds_toast('error', ...)`; back up corrupt source before wiping |
| Feature degraded but usable | `_ds_log.warn`, degrade silently |
| Optional side-effect (notify, cleanup) | `_ds_toast` / `_ds_log.debug`, plus a one-line comment stating *why* it's safe to swallow |
| Known fallback path (e.g. decrypt legacy plaintext) | Keep fallback + `_ds_log.debug` |

**Key spots that must never be silent**: `saveWithRetry`/`saveToLS`/`saveData` (persistence), `loadSavedData`'s `JSON.parse` (esp. `saves`), and `_ds_parseRes`'s `processUsage` call (per-request stats write). Note `_ds_parseRes` deliberately narrows its `try` to parsing only — a parse failure is `warn`, but a `processUsage` failure is `error` + toast.

## Modals & Overlays in SillyTavern

**Never rely on `position:fixed` for modal centering.** Some ancestor container (e.g. `#shell`) carries a `transform`, which changes the containing block of `fixed` elements. When the window narrows (e.g. below ~996px) or the page scrolls, the modal drifts out of view — typically pinned to the top of the screen and half hidden. This cannot be fixed with CSS.

Robust pattern (implemented in `_dsShowImportConfirm` / `_dsPositionImportDialog` / `_dsHideImportConfirm`):

1. Append the overlay AND the dialog as **direct children of `parent.document.body`**, both `position:absolute`, so neither depends on any ancestor's positioning chain.
2. To center: temporarily set dialog `left:0;top:0`, read `getBoundingClientRect()` to derive the document-origin offset `docOff = -rect.left/top`, then position it at `docOff + viewport_center`. Since the measurement and the dialog share the same coordinate space, the math is self-consistent regardless of whether scrolling happens on `window` or an inner `overflow:auto` container, and regardless of `transform` ancestors.
3. Re-position on `scroll` (capture phase `{ capture: true, passive: true }` — `scroll` does not bubble, but capture catches inner-container scrolls) and on `resize`.
4. Make the overlay cover only the current viewport: set `width/height = documentElement.clientWidth/clientHeight` at `left/top = docOff`.

## Import / Export

- Buttons live at the right end of the "历史记录" header row in `PANEL_HTML` (`#ds-btn-export`, `#ds-btn-import`); click handlers bound in `createUI`.
- **Export** (`exportHistory`): builds `{ format: 'deepseek-stat-export', version: 1, exportedAt, appVersion, data: { saves, currentSave, balance, customBalance, settings, messageCount } }`, downloads as `.json` via `Blob` + temp `<a download>` in the parent document. **Never include the API key** (`KEY_STORAGE` / `state.apiKey`).
- **Import** (`importHistory`): hidden `<input type="file">` in the parent document, `FileReader` + `JSON.parse`, validates `format === 'deepseek-stat-export'`, then opens the confirm overlay with three choices (覆盖导入 / 合并导入 / 取消).
- **Apply** (`applyImportedData(data, mode)`):
  - `overwrite`: replaces `state.saves`, `currentSave`, `balance`, `customBalance`, `settings`, `messageCount`; write `''` to `CUSTOM_BALANCE_STORAGE` / `BALANCE_STORAGE` when the imported value is `null`/empty so stale storage is cleared.
  - `merge`: adds new saves; for same-key saves merges `history` de-duplicated by `timestamp`, keeps current balance/settings/messageCount.
  - Always backfill missing `priceType: 'old'` on history entries, then persist (`saveSaves`/`saveCurrentSaveKey`/`saveSettings`/`saveMessageCount`), call `recalcAllCosts()` so aggregate stats are recomputed from history, and refresh UI/charts.

### Forward-compatibility contract

Rules that keep old export files importable in future versions:

- **Field stability**: Never delete, rename, or change the meaning of existing fields in the export object or in save/history entries. Adding new optional fields is allowed **without** bumping `EXPORT_FORMAT_VERSION`.
- **Bump version on structural changes**: Any restructure (rename/relayout of fields) requires bumping `EXPORT_FORMAT_VERSION` (constant in `DeepSeek使用预测.js`) AND adding a migration function in `normalizeImportData`'s migration chain (`vN -> vN+1`).
- **All imports go through `normalizeImportData`**: Never consume `raw.data` directly in `importHistory`/`applyImportedData`. Every new data field must get a sensible default there so files without it still import.
- **Costs are always recomputed**: `cost`/`input_cost`/`output_cost`/`total_cost`/`cache_hit_rate` in an export are historical snapshots only. After import, `recalcAllCosts()` rebuilds them from token data using the current `PRICING` + settings. Never trust imported cost values.
- **No API keys**: The export payload is an explicit whitelist; no field inside `data` may ever contain the API key (`KEY_STORAGE`/`state.apiKey`). When adding fields, add them to the whitelist explicitly — do not dump whole `state` objects.
- **Version check policy**: Files with `version > EXPORT_FORMAT_VERSION` are rejected with an "upgrade the script" message (older scripts must not guess at newer formats).
- **Checklist after touching import/export**: (1) every new field has a default in `normalizeImportData`; (2) existing fields unchanged; (3) `EXPORT_FORMAT_VERSION` bumped only for structural changes with a migration; (4) run `node --check` + JSON sync + a manual import test with an old export file.

## Gotchas

- **JSON escaping**: `content` is a JSON string literal; all `\` and `"` inside must be properly escaped for JSON.
- **GitHub Pages cache**: Typically serves latest file within minutes of push, but may occasionally lag.
- **Chinese encoding**: JS source uses UTF-8 encoded Chinese characters in `PANEL_HTML` and UI strings. Any file copy must preserve UTF-8 encoding (use `git checkout` not shell redirection).
- **Sync discipline**: After editing JS, always regenerate DeepSeek_Statistic_VX.XX.json. The auto-update JSONs only need changes if the import URL changes.
- **Windows encoding**: `gh release upload` with Chinese filenames via PowerShell will mangle the asset names. Workaround: rename files to ASCII before upload, then rename back. Or use `cmd /c` with proper quoting.
