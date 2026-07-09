# AGENTS.md

## Overview

SillyTavern Tavern Helper script that tracks DeepSeek API usage (tokens, cost, cache hit rates). No build system, no tests, no package manager.

**Rule: Never commit, push, deploy to gh-pages, or release unless explicitly asked. Only edit files and sync JSON.**

## Files

- `DeepSeek使用预测.js` — Source of truth (IIFE). Edit this file.
- `DeepSeek_Statistic_V2.15.json` — Packaged JSON for manual import; copy & rename from previous version on release. `content` must stay in sync with JS.
- `DeepSeek_Statistic_auto_update.json` — Auto-update loader (GitHub Pages). Only touch if URL changes.
- `DeepSeek_Statistic_auto_update_cdn.json` — Auto-update loader (jsDelivr CDN). Only touch if URL changes.
- `README.md` — Docs; update changelog in lockstep.
- `演示/` — Screenshots (gitignored).

## Making Changes

1. Edit `DeepSeek使用预测.js`
2. Bump `_ds_current_version` variable (currently `"2.15"`)
3. **Sync JSON** — extract the IIFE into the versioned JSON's `content` field:
   ```bash
    node -e "var f=require('fs');var js=f.readFileSync('DeepSeek使用预测.js','utf8');var i=js.indexOf('(function()');var json=JSON.parse(f.readFileSync('DeepSeek_Statistic_V2.15.json','utf8'));json.content=js.substring(i);f.writeFileSync('DeepSeek_Statistic_V2.15.json',JSON.stringify(json,null,2)+'\n');console.log('synced')"
    ```
4. Validate: `node --check DeepSeek使用预测.js` and `node -e "new Function(JSON.parse(require('fs').readFileSync('DeepSeek_Statistic_V2.15.json','utf8')).content);console.log('valid')"`
5. Update `README.md` changelog if needed
6. Commit and push to `main`

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

## Release

```bash
gh release create vX.XX --title "release X.XX" --notes "<changelog>"
gh release upload vX.XX "DeepSeek_Statistic_VX.XX.json" "DeepSeek_Statistic_auto_update.json" "DeepSeek_Statistic_auto_update_cdn.json"
```

Release notes 必须遵循以下固定格式：

```markdown
## X.XX 更新内容

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
| \DeepSeek_Statistic_VX.XX.json\ | 完整版脚本，手动导入 | 需要特定版本时使用 |
| \DeepSeek_Statistic_auto_update.json\ | 自动更新版（GitHub Pages），导入后自动获取最新脚本 | 境外用户推荐 |
| \DeepSeek_Statistic_auto_update_cdn.json\ | 自动更新版（jsDelivr CDN），导入后自动获取最新脚本 | ✅ 国内用户推荐 |

### 自动更新使用方法（GitHub Pages）
1. 下载 \DeepSeek_Statistic_auto_update.json\
2. 在 SillyTavern 中的酒馆助手导入该文件
3. 之后每次启动自动获取最新版本，无需手动更新

### 自动更新使用方法（jsDelivr CDN）
1. 下载 \DeepSeek_Statistic_auto_update_cdn.json\
2. 在 SillyTavern 中的酒馆助手导入该文件
3. 之后每次启动自动获取最新版本，无需手动更新

### 手动更新使用方法
1. 下载 \DeepSeek_Statistic_VX.XX.json\
2. 在 SillyTavern 中的酒馆助手导入该文件
3. 每次更新需重新导入
```

其中 X.XX 替换为实际版本号，各更新内容章节按实际情况填写，无内容的章节可省略。

> **GitHub Pages cache**: Typically serves latest file within minutes of push.
> **jsDelivr cache**: Clears within minutes after push; manual purge at https://www.jsdelivr.com/tools/purge

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
- **GitHub Pages cache**: Typically serves latest file within minutes of push, but may occasionally lag.
- **Chinese encoding**: JS source uses UTF-8 encoded Chinese characters in `PANEL_HTML` and UI strings. Any file copy must preserve UTF-8 encoding (use `git checkout` not shell redirection).
- **Sync discipline**: After editing JS, always regenerate DeepSeek_Statistic_V2.15.json. The auto-update JSONs only need changes if the import URL changes.
- **Windows encoding**: `gh release upload` with Chinese filenames via PowerShell will mangle the asset names. Workaround: rename files to ASCII before upload, then rename back. Or use `cmd /c` with proper quoting.
