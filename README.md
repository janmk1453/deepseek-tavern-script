# DeepSeek 使用预测 - SillyTavern 脚本

实时统计 DeepSeek API 的 token 消耗、费用和缓存命中情况。

## 下载

前往 [Releases](https://github.com/janmk1453/deepseek-tavern-script/releases) 页面下载最新版本。

| 文件 | 说明 |
|------|------|
| `DeepSeek_Statistic_auto_update.json` | 自动更新版（推荐），导入后自动获取最新脚本 |
| `DeepSeek_Statistic_VX.XX.json` | 完整版脚本，需手动导入 |

## 使用方法

### 自动更新（推荐）
1. 下载 `DeepSeek_Statistic_auto_update.json`
2. 在 SillyTavern 中导入该文件
3. 之后每次启动自动获取最新版本，无需手动更新

### 手动更新
1. 下载 `DeepSeek_Statistic_VX.XX.json`
2. 在 SillyTavern 中导入该文件
3. 每次更新需重新导入

## 功能

- 实时统计 token 消耗、费用、缓存命中率
- 多存档管理
- 消息对比功能
- 统计图表（Token/费用趋势、缓存命中率）
- 每张图表独立滑块控制
