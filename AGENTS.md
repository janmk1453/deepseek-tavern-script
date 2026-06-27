# AGENTS.md

## Repository Overview

This repo contains a single SillyTavern Tavern Helper script (`DeepSeek使用预测release1.51.json`). There is no build system, no tests, no linting, no package manager, and no source directory structure.

## File Format

The `.json` file is a complete Tavern Helper script export with an inline IIFE in its `content` field. The JavaScript code is minified/concatenated on a single line — use a JSON viewer or formatter before editing.

## Making Changes

- Edit the `"content"` field inside the JSON file. The script is self-contained JavaScript (IIFE pattern).
- PRICING table at the top of the script defines per-model costs for `deepseek-v4-flash` and `deepseek-v4-pro`.
- UI is built via string concatenation (`PANEL_HTML`) — not a template system. Be careful with escaping.
- The script uses `localStorage` for saves and `TavernHelper` APIs for message monitoring.
- Version string is in the filename (`release1.51`). Update it when bumping versions.

## No Build Step

There is no compilation, transpilation, or bundling. The JSON file is the deliverable — paste it directly into SillyTavern's script import.
