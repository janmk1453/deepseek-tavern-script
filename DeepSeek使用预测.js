

(function() {
  // ===== 定价表（单位：¥/百万 tokens） =====
  // 分为 offpeak（非高峰/旧价格）和 peak（高峰时段价格，UTC+8 09:00-12:00 及 14:00-18:00）
  var PRICING = { 'deepseek-v4-flash': { usePeakPricing: true, offpeak: { hit: 0.05, miss: 1.5, output: 4.5 }, peak: { hit: 0.10, miss: 3.0, output: 9.0 } }, 'deepseek-v4-pro': { usePeakPricing: true, offpeak: { hit: 0.15, miss: 4.5, output: 13.5 }, peak: { hit: 0.30, miss: 9.0, output: 27.0 } } };
  // ===== 默认高峰时段（可被 settings.peakHours 覆盖，格式 HH:mm，北京时区） =====
  var DEFAULT_PEAK_HOURS = [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }];
  // ===== 全局状态对象 =====
  // 涵盖当前存档、UI 开关、图表库加载状态、API 密钥、余额、设置和消息计数
  var state = { currentSave: null, saves: {}, lastUsage: null, panelOpen: false, chartPanelOpen: false, chartLibLoaded: false, chartModel: '__all__', overviewModel: '__all__', compareBefore: null, compareAfter: null, apiKey: '', balance: null, customBalance: null, settings: { autoBalance: false, balanceInterval: 10, debug: false, debugHit: 10000, debugMiss: 5000, debugOutput: 2000, debugModel: 'deepseek-v4-flash', debugDateStart: '', debugDateEnd: '', debugBatchCount: 30, useNewPricing: true, newPricingDate: new Date('2026-08-17T00:00:00+08:00').getTime(), customModels: [], peakHours: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], peakDot: true }, messageCount: 0 };
  // ===== 判断是否为高峰时段（UTC+8 时区） =====
  // 高峰时段：09:00-12:00（540-720 min）和 14:00-18:00（840-1080 min）
  function isPeakHour(timestamp) { var d = new Date(timestamp); var totalMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 8 * 60) % 1440; var hours = (state.settings && state.settings.peakHours) || DEFAULT_PEAK_HOURS; for (var i = 0; i < hours.length; i++) { var h = hours[i]; if (!h || !h.start || !h.end) continue; var p = h.start.split(':'); var q = h.end.split(':'); var sp = parseInt(p[0]) * 60 + parseInt(p[1] || 0); var ep = parseInt(q[0]) * 60 + parseInt(q[1] || 0); if (sp < ep) { if (totalMinutes >= sp && totalMinutes < ep) return true; } else if (totalMinutes >= sp || totalMinutes < ep) { return true; } } return false; }
  // ===== 获取全部可统计模型列表（内置 PRICING keys ∪ 用户自定义模型） =====
  // 用于图表面板模型切换、调试模式模型下拉及模型有效性校验
  function getModelList() { var set = {}; Object.keys(PRICING).forEach(function(k) { set[k] = 1; }); (state.settings.customModels || []).forEach(function(m) { if (m && m.model) set[m.model] = 1; }); return Object.keys(set); }
  // ===== 合并内置价格与用户自定义价格（字段级覆盖，留空回落内置） =====
  function mergePrices(base, custom) { if (!custom) return base; return { hit: custom.hit !== undefined && custom.hit !== '' ? parseFloat(custom.hit) : base.hit, miss: custom.miss !== undefined && custom.miss !== '' ? parseFloat(custom.miss) : base.miss, output: custom.output !== undefined && custom.output !== '' ? parseFloat(custom.output) : base.output }; }
  // ===== 查询模型定价：用户自定义优先，未定义回落内置，未知模型回落 flash =====
  function getPricing(model) { var m = model || 'deepseek-v4-flash'; var base = PRICING[m] || PRICING['deepseek-v4-flash']; var cm = state.settings.customModels || []; for (var i = 0; i < cm.length; i++) { if (cm[i] && cm[i].model === m) return { usePeakPricing: cm[i].usePeakPricing !== false, offpeak: mergePrices(base.offpeak, cm[i].offpeak), peak: mergePrices(base.peak, cm[i].peak) }; } return base; }
  var isInitDone = false;
  function shortModel(m) { return m.replace(/^deepseek-/, 'DS-'); }
  function shortModelV2(m) { if (m.indexOf('deepseek') !== -1) { if (m.indexOf('flash') !== -1) return 'V4F'; if (m.indexOf('pro') !== -1) return 'V4P'; } return shortModel(m); }
  // ===== 判断是否为 DeepSeek 官方 API 模型（模型名以 deepseek 开头） =====
  // 对话轮次等仅针对 DeepSeek 官方 API 的功能需据此过滤，避免使用其他厂商/供应商的模型数据
  function isDeepSeekOfficialModel(m) { return typeof m === 'string' && m.toLowerCase().indexOf('deepseek') === 0; }
  // ===== 获取当前存档历史记录中实际出现过的模型列表（去重） =====
  function getRecordedModels() { var s = getSelectedSave(); var set = {}; if (s && s.history) { s.history.forEach(function(h) { if (h && h.model) set[h.model] = 1; }); } return Object.keys(set).sort(); }
  // ===== 刷新统计概览盘右上角的模型下拉（全部模型 / 记录中出现过的模型） =====
  function refreshOverviewModelSelect() { var p = window.parent || window; var sel = p.document.getElementById('ds-overview-model'); if (!sel) return; var current = state.overviewModel || '__all__'; var models = getRecordedModels(); var html = '<option value="__all__">全部模型</option>' + models.map(function(m) { return '<option value="' + m + '">' + shortModelV2(m) + '</option>'; }).join(''); if (sel.innerHTML !== html) sel.innerHTML = html; sel.value = models.indexOf(current) !== -1 ? current : '__all__'; if (state.overviewModel !== sel.value) { state.overviewModel = sel.value; } }
  var initTimestamp = 0;
  // ===== 面板 HTML 模板（含内联 CSS 样式） =====
  // 使用字符串拼接而非模板字符串，所有 " 需转义为 \"
  var PANEL_HTML = "<style>@media(max-width:480px){.ds-grid-3{grid-template-columns:repeat(1,1fr) !important}}.ds-diff-del{background:rgba(255,100,100,0.3);color:#ff8888;text-decoration:line-through;padding:0 2px;border-radius:2px}.ds-diff-ins{background:rgba(52,211,153,0.3);color:#34d399;font-weight:bold;padding:0 2px;border-radius:2px}.ds-diff-ctx{color:#6b7280;opacity:0.7}.ds-diff-block{margin:4px 0 8px;padding:10px;background:#0e1520;border:1px solid #374151;border-radius:8px;line-height:1.6;word-break:break-all;font-size:12px}.ds-diff-full{display:none;margin-top:8px;padding:10px;background:#060a10;border:1px solid #374151;border-radius:6px;white-space:pre-wrap;word-break:break-all;font-size:12px}.ds-diff-full.open{display:block}.ds-compare-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:999999;display:none}.ds-compare-panel{position:fixed;z-index:999999;background:#0e1520;border:1px solid #374151;font-family:'Microsoft YaHei','微软雅黑',sans-serif;color:#e5e7eb;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;transition:transform 0.3s ease,opacity 0.3s ease;bottom:0!important;left:50%!important;transform:translateX(-50%) translateY(100%)!important;opacity:0!important;pointer-events:none!important;width:min(820px,100%)!important;max-height:85vh!important;border-radius:12px 12px 0 0!important}.ds-compare-panel.ds-open{transform:translateX(-50%) translateY(0)!important;opacity:1!important;pointer-events:auto!important}.ds-compare-body{flex:1;overflow-y:auto;padding:16px}@media(max-width:480px){.ds-compare-panel{width:100vw!important;height:100vh!important;max-height:none!important;border-radius:0!important;left:0!important;top:0!important;transform:translateY(100%)!important;transition:transform 0.2s ease,opacity 0.2s ease!important}.ds-compare-panel.ds-open{transform:translateY(0)!important;opacity:1!important}}}to{opacity:1;transform:scale(1)}}.ds-compare-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #374151;font-size:14px;font-weight:600;color:#f3f4f6;background:#0a1018;border-radius:12px 12px 0 0;flex-shrink:0}.ds-compare-body{padding:16px 18px}.ds-compare-info{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;background:#060a10;border-radius:8px;font-size:11px;color:#9ca3af}.ds-compare-info .ds-info-old{color:#6366f1;font-weight:600}.ds-compare-info .ds-info-new{color:#a78bfa;font-weight:600}.ds-diff-msg{margin-bottom:14px;padding:12px;background:#0a1018;border-radius:8px;border-left:3px solid #6366f1}.ds-diff-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px}.ds-diff-header b{color:#a5b4fc}.ds-chart-slider-track{position:relative;height:28px;background:#1e293b;border-radius:4px;margin:8px 0;cursor:pointer;user-select:none;touch-action:none}.ds-chart-slider-thumb{position:absolute;top:2px;bottom:2px;background:rgba(99,102,241,0.35);border:1px solid rgba(99,102,241,0.6);border-radius:3px;cursor:grab;min-width:20px;touch-action:none}.ds-chart-slider-thumb:active{cursor:grabbing}.ds-slider-handle{position:absolute;top:50%;transform:translateY(-50%);width:22px;height:22px;background:#818cf8;border:2px solid #6366f1;border-radius:50%;cursor:ew-resize;z-index:2;opacity:0;transition:opacity 0.15s;touch-action:none}.ds-chart-slider-thumb:hover .ds-slider-handle,.ds-chart-slider-track:hover .ds-slider-handle{opacity:1}.ds-slider-handle-left{left:-11px}.ds-slider-handle-right{right:-11px}.ds-chart-slider-label{text-align:center;font-size:11px;color:#6b7280;margin-top:4px;font-family:'Microsoft YaHei','微软雅黑',sans-serif}#ds-content{background:rgb(13,19,38) !important}.ds-grid-3>div{background:rgb(22,33,60) !important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:box-shadow 0.25s ease,background 0.25s ease;border:0.5px solid rgba(55,65,81,0.3) !important;border-radius:14px !important;box-shadow:0 4px 12px rgba(0,0,0,0.3) !important}.ds-grid-3>div:hover{background:rgb(32,46,80) !important;box-shadow:0 4px 16px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06) !important}#ds-balance-box{background:rgb(22,33,60) !important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform 0.25s ease,box-shadow 0.25s ease,background 0.25s ease;border:0.5px solid rgba(37,99,235,0.25) !important;border-radius:14px !important}#ds-balance-box:hover{background:rgb(32,46,80) !important;box-shadow:0 4px 16px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06) !important}.ds-history-item{background:rgb(22,33,60) !important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform 0.25s ease,box-shadow 0.25s ease,background 0.25s ease;border:0.5px solid rgba(55,65,81,0.3) !important;border-radius:14px !important;margin-bottom:10px}.ds-history-item:hover{background:rgb(32,46,80) !important;box-shadow:0 4px 16px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06) !important}@media(max-width:480px){#ds-btn-refresh,#ds-btn-clear{padding:4px 8px!important;font-size:11px!important}}</style><div style=\"display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:16px\"><select id=\"ds-save-select\" style=\"flex:1;min-width:120px;padding:8px 10px;border:0.5px solid rgba(55,65,81,0.5);border-radius:8px;font-size:13px;background:rgb(13,19,38);color:#e5e7eb;outline:none;font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:border-color 0.2s\"><option value=\"\">加载中...</option></select><button id=\"ds-btn-new-save\" style=\"padding:8px 12px;border:0.5px solid rgba(5,150,105,0.4);border-radius:8px;background:rgba(5,150,105,0.12);color:#34d399;font-size:12px;font-weight:600;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap;transition:background 0.2s\" onmouseenter=\"this.style.background='rgba(5,150,105,0.25)'\" onmouseleave=\"this.style.background='rgba(5,150,105,0.12)'\">+ 新建</button><button id=\"ds-btn-delete-save\" style=\"padding:8px 12px;border:0.5px solid rgba(220,38,38,0.3);border-radius:8px;background:rgba(220,38,38,0.08);color:#fca5a5;font-size:12px;font-weight:600;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap;transition:background 0.2s\" onmouseenter=\"this.style.background='rgba(220,38,38,0.2)'\" onmouseleave=\"this.style.background='rgba(220,38,38,0.08)'\">删除当前</button><button id=\"ds-btn-delete-all\" style=\"padding:8px 12px;border:0.5px solid rgba(220,38,38,0.4);border-radius:8px;background:rgba(220,38,38,0.12);color:#fecaca;font-size:12px;font-weight:600;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap;transition:background 0.2s\" onmouseenter=\"this.style.background='rgba(220,38,38,0.25)'\" onmouseleave=\"this.style.background='rgba(220,38,38,0.12)'\">清空全部</button></div><div id=\"ds-balance-box\" style=\"padding:14px;background:#0c1a2e;border:1px solid #2563eb;border-radius:10px;margin-bottom:4px\"><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px\"><div style=\"font-size:12px;color:#93c5fd;font-weight:500\">账户余额</div><div style=\"display:flex;gap:6px\"><button id=\"ds-btn-query-balance\" style=\"padding:4px 10px;border:1px solid #3b82f6;border-radius:6px;background:#2563eb;color:white;font-size:11px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">查询</button></div></div><div id=\"ds-balance\" style=\"font-size:26px;font-weight:700;color:#60a5fa;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">¥0.00 CNY</div><div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-top:6px\"><div style=\"flex:1;min-width:0\"><div id=\"ds-balance-remaining\" style=\"font-size:14px;color:#34d399;font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif\"></div><div id=\"ds-balance-status\" style=\"font-size:11px;color:#93c5fd;font-weight:500;margin-top:4px\"></div></div><button id=\"ds-btn-settings\" style=\"display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border:0.5px solid rgba(96,165,250,0.4);border-radius:6px;background:rgba(96,165,250,0.1);color:#93c5fd;font-size:11px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap;transition:background 0.2s\" title=\"打开设置\" onmouseenter=\"this.style.background='rgba(96,165,250,0.22)'\" onmouseleave=\"this.style.background='rgba(96,165,250,0.1)'\">⚙️ 设置</button></div></div><details id=\"ds-help-section\" style=\"margin-bottom:12px;border:1px solid #374151;border-radius:8px;overflow:hidden\"><summary id=\"ds-help-header\" style=\"padding:10px 12px;background:#0e1520;cursor:pointer;display:flex;justify-content:space-between;align-items:center;list-style:none\"><div style=\"display:flex;align-items:center;gap:8px\"><span style=\"font-size:13px;color:#e5e7eb;font-weight:500\">使用说明</span><span style=\"font-size:10px;color:#6b7280\">release2.30</span></div><span id=\"ds-help-arrow\" style=\"font-size:12px;color:#6b7280;transition:transform 0.2s\">▼</span></summary><div id=\"ds-help-content\" style=\"padding:12px;background:#060a10;font-size:12px;color:#9ca3af;line-height:1.6;font-family:'Microsoft YaHei','微软雅黑',sans-serif\"><div style=\"margin-bottom:12px\"><div style=\"font-size:11px;color:#f87171;font-weight:600;margin-bottom:4px\">⚠️ 安全提示</div><div>在本插件中填入API密钥存在安全风险。密钥仅混淆后存储在SillyTavern变量系统中，建议使用权限受限的API密钥。</div></div><div style=\"margin-bottom:10px\"><div style=\"font-size:11px;color:#60a5fa;font-weight:600;margin-bottom:4px\">📊 使用统计/预测</div><div><div>1. 输入API密钥并保存后点击\"查询\"获取余额（余额和缓存命中仅支持DeepSeek官方）</div><div>2. 正常对话，插件自动记录每次请求的费用、token数及缓存命中等任何你想的到的统计数据</div><div>3. 切换存档或选择不同模型查看统计</div></div></div><div style=\"margin-bottom:10px\"><div style=\"font-size:11px;color:#34d399;font-weight:600;margin-bottom:4px\">💡高峰时间提示</div><div><div>1.设置中提供一个可以在酒馆中展示当前高低峰状态的小圆点，便于直观控制使用</div><div>2.圆点位置和时间规则可自定义，找不到圆点时可重置位置</div></div></div><div style=\"margin-bottom:10px\"><div style=\"font-size:11px;color:#f472b6;font-weight:600;margin-bottom:4px\">🔄 消息对比</div><div><div>1. 在历史记录中找到想对比的两条消息，前者点击「旧」，后者点击「新」</div><div>2. 弹出对比面板显示请求消息的文字差异</div><div>3. 差异点即缓存发散起始位置（前N条相同为缓存命中阶段）</div></div></div><div style=\"margin-bottom:10px\"><div style=\"font-size:11px;color:#fbbf24;font-weight:600;margin-bottom:4px\">📈 统计图表</div><div><div>1. 点击「详情」按钮打开图表页面</div><div>2. 左上角切换不同模型查看对应数据</div><div>3. 丰富的图表展示不同跨度下各类数据的趋势和统计</div><div>4. 可拖拽底部横条缩放、移动、重置视图</div></div></div><div style=\"margin-bottom:10px\"><div style=\"font-size:11px;color:#a78bfa;font-weight:600;margin-bottom:4px\">💾 请求详细参数</div><div><div>1. 在历史记录中点击某条记录右上角的按钮</div><div>2. 查看包括：请求参数/API 完整响应/原始 Token 用量/消息内容 在内的所有参数</div><div>3. 兼容波峰波谷计价规则</div></div></div><div style=\"margin-bottom:10px\"><div style=\"font-size:11px;color:#22d3ee;font-weight:600;margin-bottom:4px\">🧡模型兼容问题</div><div><div>1.脚本完整兼容DeepSeek官方API</div><div>2.脚本尽量兼容不同厂商/供应商/渠道的API请求格式，对于大部分模型无法获取缓存命中数</div><div>3.如遇部分数据未被记录或记录数据有误，请携带完整API请求和响应内容反馈</div></div></div><div><div style=\"font-size:11px;color:#9ca3af;font-weight:600;margin-bottom:4px\">✨ 关于</div><div>本脚本基本由AI编写 @janmk 项目仓库：https://github.com/janmk1453/deepseek-tavern-script</div></div></div></details><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px\"><div style=\"font-size:14px;font-weight:600;color:#e5e7eb;display:flex;align-items:center;gap:8px;flex-wrap:wrap\"><div style=\"width:3px;height:14px;background:#818cf8;border-radius:2px\"></div><span>统计概览</span><select id=\"ds-overview-model\" style=\"margin-left:8px;padding:1px 6px;border:1px solid #374151;border-radius:6px;background:#0e1520;color:#e5e7eb;font-size:11px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;cursor:pointer;vertical-align:middle;align-self:center;line-height:normal;height:22px;box-sizing:border-box;position:relative;top:3px\"></select><span id=\"ds-btn-charts\" style=\"font-size:13px;cursor:pointer;color:#6b7280;margin-left:4px;margin-right:6px;transition:color 0.2s\" title=\"统计图\">📊 详情</span><span id=\"ds-save-time\" style=\"font-size:11px;color:#6b7280;font-weight:400\"></span></div><div style=\"display:flex;gap:6px\"><button id=\"ds-btn-refresh\" style=\"padding:6px 12px;border:1px solid #374151;border-radius:6px;background:#0e1520;color:#e5e7eb;font-size:12px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">刷新</button><button id=\"ds-btn-clear\" style=\"padding:6px 12px;border:1px solid #7f1d1d;border-radius:6px;background:#7f1d1d;color:#fca5a5;font-size:12px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">清空</button></div></div><div class=\"ds-grid-3\" style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px\"><div style=\"background:#0e1520;border:1px solid #374151;border-radius:8px;padding:14px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px\">总花费（人民币）</div><div style=\"font-size:20px;font-weight:700;color:#f3f4f6;font-family:'Microsoft YaHei','微软雅黑',sans-serif;margin-bottom:8px\"><span id=\"ds-total-cost\">¥0.0000</span></div><div style=\"border-top:1px solid #1f2937;padding-top:8px\"><div style=\"display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;margin-bottom:4px\"><span>Token 历史消耗</span><span id=\"ds-total-tokens\" style=\"color:#e5e7eb;font-weight:500\">0</span></div><div style=\"display:flex;justify-content:space-between;font-size:12px;color:#93c5fd;margin-bottom:4px\"><span>输入（命中缓存）</span><span id=\"ds-total-cache-hit\" style=\"color:#e5e7eb;font-weight:500\">0</span></div><div style=\"display:flex;justify-content:space-between;font-size:12px;color:#fca5a5;margin-bottom:4px\"><span>输入（未命中缓存）</span><span id=\"ds-total-cache-miss\" style=\"color:#e5e7eb;font-weight:500\">0</span></div><div style=\"display:flex;justify-content:space-between;font-size:12px;color:#a5b4fc\"><span>输出</span><span id=\"ds-total-output\" style=\"color:#e5e7eb;font-weight:500\">0</span></div></div></div><div style=\"background:#0e1520;border:1px solid #374151;border-radius:8px;padding:14px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px\">加权缓存命中率</div><div style=\"font-size:20px;font-weight:700;color:#34d399;font-family:'Microsoft YaHei','微软雅黑',sans-serif\"><span id=\"ds-weighted-rate\">0%</span></div><div id=\"ds-rounds\" style=\"font-size:12px;color:#6b7280;margin-top:6px;font-weight:500\">基于 0 轮</div></div><div style=\"background:#0e1520;border:1px solid #374151;border-radius:8px;padding:14px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px\">平均每轮</div><div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px\"><div style=\"display:flex;align-items:center;gap:8px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:10px 12px\"><div style=\"width:32px;height:32px;border-radius:8px;background:rgba(251,191,36,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0\"><span style=\"font-size:14px\">💰</span></div><div style=\"line-height:1.3\"><div style=\"font-size:10px;color:#d4a017;font-weight:500\">每轮费用</div><div style=\"font-size:14px;font-weight:700;color:#fbbf24\"><span id=\"ds-avg-cost\">¥0.00</span></div></div></div><div style=\"display:flex;align-items:center;gap:8px;background:rgba(229,231,235,0.06);border:1px solid rgba(229,231,235,0.15);border-radius:8px;padding:10px 12px\"><div style=\"width:32px;height:32px;border-radius:8px;background:rgba(229,231,235,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0\"><span style=\"font-size:14px\">📊</span></div><div style=\"line-height:1.3\"><div style=\"font-size:10px;color:#9ca3af;font-weight:500\">每轮Token</div><div style=\"font-size:14px;font-weight:700;color:#e5e7eb\"><span id=\"ds-avg-tokens\">0</span></div></div></div><div style=\"display:flex;align-items:center;gap:8px;background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.2);border-radius:8px;padding:10px 12px\"><div style=\"width:32px;height:32px;border-radius:8px;background:rgba(96,165,250,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0\"><span style=\"font-size:14px\">⏱️</span></div><div style=\"line-height:1.3\"><div style=\"font-size:10px;color:#60a5fa;font-weight:500\">平均耗时</div><div style=\"font-size:14px;font-weight:700;color:#93c5fd\"><span id=\"ds-avg-duration\">--</span></div></div></div><div style=\"display:flex;align-items:center;gap:8px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:8px;padding:10px 12px\"><div style=\"width:32px;height:32px;border-radius:8px;background:rgba(52,211,153,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0\"><span style=\"font-size:14px\">⚡</span></div><div style=\"line-height:1.3\"><div style=\"font-size:10px;color:#34d399;font-weight:500\">输出速率</div><div style=\"font-size:14px;font-weight:700;color:#6ee7b7\"><span id=\"ds-avg-tokenrate\">--</span></div></div></div></div></div><div style=\"background:#0e1520;border:1px solid #374151;border-radius:8px;padding:14px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px\">支出明细</div><div style=\"border-bottom:1px solid #1f2937;padding-bottom:8px;margin-bottom:8px\"><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:2px\"><span style=\"font-size:12px;color:#34d399;font-weight:500\">预计节省</span><span style=\"font-size:14px;font-weight:700;color:#34d399\"><span id=\"ds-savings\">¥0.0000</span></span></div><div style=\"font-size:11px;color:#6b7280;text-align:right\"><span id=\"ds-savings-tokens\">0</span> tokens</div></div><div style=\"border-bottom:1px solid #1f2937;padding-bottom:8px;margin-bottom:8px\"><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:2px\"><span style=\"font-size:12px;color:#93c5fd;font-weight:500\">支出在输入</span><span style=\"font-size:14px;font-weight:700;color:#f3f4f6\"><span id=\"ds-input-cost\">¥0.0000</span></span></div><div style=\"font-size:11px;color:#6b7280;text-align:right\"><span id=\"ds-input-tokens\">0</span> tokens</div></div><div><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:2px\"><span style=\"font-size:12px;color:#a5b4fc;font-weight:500\">支出在输出</span><span style=\"font-size:14px;font-weight:700;color:#f3f4f6\"><span id=\"ds-output-cost\">¥0.0000</span></span></div><div style=\"font-size:11px;color:#6b7280;text-align:right\"><span id=\"ds-output-tokens\">0</span> tokens</div></div></div></div><div style=\"font-size:14px;font-weight:600;color:#e5e7eb;margin-bottom:12px;display:flex;align-items:center;gap:8px\"><div style=\"width:3px;height:14px;background:#818cf8;border-radius:2px\"></div><span>历史记录</span><div style=\"margin-left:auto;display:flex;gap:6px\"><button id=\"ds-btn-export\" style=\"padding:5px 10px;border:0.5px solid rgba(96,165,250,0.4);border-radius:6px;background:rgba(96,165,250,0.1);color:#60a5fa;font-size:11px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap;transition:background 0.2s\" title=\"导出全部历史记录与统计（不含API密钥）\">📤 导出</button><button id=\"ds-btn-import\" style=\"padding:5px 10px;border:0.5px solid rgba(52,211,153,0.4);border-radius:6px;background:rgba(52,211,153,0.1);color:#34d399;font-size:11px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap;transition:background 0.2s\" title=\"从文件导入历史记录与统计\">📥 导入</button></div></div><div id=\"ds-history\"><div style=\"text-align:center;padding:16px;color:#6b7280;font-weight:500;font-size:13px\">暂无历史记录</div></div>";
  // ===== 常量 =====
  var TARGET_API = '/api/backends/chat-completions/generate';   // 拦截的 API 路径
  var KEY_STORAGE = 'ds_api_key';                               // API 密钥存储键
  var BALANCE_STORAGE = 'ds_balance_data';                      // 余额数据存储键
  var SAVES_STORAGE = 'ds_saves';                               // 存档数据
  var CURRENT_SAVE_KEY = 'ds_current_save';                     // 当前选中存档
  var SETTINGS_STORAGE = 'ds_settings';                         // 设置
  var MESSAGE_COUNT_STORAGE = 'ds_message_count';               // 消息计数
  var CUSTOM_BALANCE_STORAGE = 'ds_custom_balance';             // 自定义余额
  var LAST_VERSION_STORAGE = 'ds_last_version';                  // 上次运行的脚本版本号（用于版本迁移）
  var EXPORT_FORMAT_VERSION = 1;                                 // 导入导出文件格式版本（结构性变更时 +1，并提供迁移）
  
  // ===== 持久化存储工具（双写：酒馆变量 + localStorage） =====
  function saveWithRetry(key, value) { for (var i = 0; i < 3; i++) { try { var v = getAllVariables(); v[key] = value; replaceVariables(v); return true; } catch(e) {} } return false; }
  function loadWithRetry(key) { for (var i = 0; i < 3; i++) { try { var v = getAllVariables(); return v[key] || null; } catch(e) {} } return null; }
  function saveToLS(key, value) { try { localStorage.setItem('ds_' + key, value); } catch(e) {} }
  function loadFromLS(key) { try { return localStorage.getItem('ds_' + key); } catch(e) { return null; } }
  function saveData(key, value) { saveWithRetry(key, value); saveToLS(key, value); }
  function loadData(key) { var v = loadWithRetry(key); if (v === null) v = loadFromLS(key); return v; }
  
  // ===== 工具函数 =====
  function isMobile() { var p = window.parent || window; return (p.innerWidth || 768) <= 760; } function syncViewportHeight() { try { var p = window.parent || window; var h = (p.visualViewport && p.visualViewport.height) || p.innerHeight || 640; p.document.documentElement.style.setProperty('--ds-vvh', Math.max(320, Math.round(h)) + 'px'); } catch(e) {} } 

// ===== 版本号与更新检测 =====
var _ds_current_version = "2.30";
var _ds_github_repo = "janmk1453/deepseek-tavern-script";
// 通过 GitHub Pages 原始文件检查新版本（避免 API 限流）
function checkForUpdates() {
  var p = window.parent || window;
  var doc = p.document;
  var btn = doc.getElementById("ds-btn-check-update");
  if (btn) btn.textContent = "🔄 检查中...";
  var url = "https://raw.githubusercontent.com/" + _ds_github_repo + "/gh-pages/DeepSeek%E4%BD%BF%E7%94%A8%E9%A2%84%E6%B5%8B.js";
  fetch(url)
    .then(function(r) { return r.text(); })
    .then(function(text) {
      var match = text.match(/var _ds_current_version\s*=\s*"([^"]+)"/);
      if (!match) {
        if (btn) btn.textContent = "❌ 检查失败";
        setTimeout(function() { if (btn) btn.textContent = "🔄 检查更新"; }, 2000);
        return;
      }
      var remoteVersion = match[1];
      var curParts = _ds_current_version.split(".").map(Number);
      var remParts = remoteVersion.split(".").map(Number);
      var isNewer = false;
      for (var i = 0; i < Math.max(curParts.length, remParts.length); i++) {
        var c = curParts[i] || 0;
        var r = remParts[i] || 0;
        if (r > c) { isNewer = true; break; }
        if (r < c) { break; }
      }
      if (isNewer) {
        var msg = "发现新版本 v" + remoteVersion + "（当前 v" + _ds_current_version + "）\n\n请前往下载最新版本：\nhttps://github.com/" + _ds_github_repo + "/releases/latest";
        if (btn) btn.textContent = "✅ 发现新版本";
        alert(msg);
      } else {
        if (btn) btn.textContent = "✅ 已是最新";
      }
      setTimeout(function() { if (btn) btn.textContent = "🔄 检查更新"; }, 2000);
    })
    .catch(function(e) {
      if (btn) btn.textContent = "❌ 网络错误";
      setTimeout(function() { if (btn) btn.textContent = "🔄 检查更新"; }, 2000);
  });
}


// ===== 初始化入口 =====
// 延迟 2 秒后执行，确保酒馆和酒馆助手接口已就绪
function init() { 
    loadSavedData(); // 从持久化存储加载 API Key、余额、存档、设置
    loadCurrentSave(); // 加载当前存档（或新建）
    recalcAllCosts(); // 重新计算所有存档的费用和缓存率
      setupEvents(); // 注册酒馆事件监听
      setupVisibilityFix(); // 注册页面可见性监听（修复切回标签页后 UI 空白）
      console.log('[DS] init');createUI(); // 创建主面板 DOM
    patchFetch(); // 拦截 fetch 以捕获 API 用量
    state.panelOpen = false;
    initTimestamp = Date.now();
    isInitDone = true;
    syncViewportHeight();
    setInterval(function() { updatePeakDot(); }, 30000);
    try {
      var p = window.parent || window;
      if (p.visualViewport) {
        p.visualViewport.addEventListener('resize', syncViewportHeight, { passive: true });
        p.visualViewport.addEventListener('scroll', syncViewportHeight, { passive: true });
      }
      p.addEventListener('resize', syncViewportHeight, { passive: true });
    } catch(e) {}
    try {
      var p3 = window.parent || window;
      var vw = (p3.innerWidth || 768) > 760 ? 'desktop' : 'mobile';
      p3.addEventListener('resize', function() {
        var nv = (p3.innerWidth || 768) > 760 ? 'desktop' : 'mobile';
        if (vw !== nv) {
          vw = nv;
          var pn = p3.document.getElementById('ds-panel');
          if (pn && pn.classList.contains('ds-open')) {
            pn.classList.add('ds-no-animation');
            setTimeout(function() {
              pn.classList.remove('ds-no-animation');
            }, 30);
          }
        }
      }, { passive: true });
    } catch(e) {}
    try {
      var wp = window.parent || window;
      var wdoc = wp.document;
      var menu = wdoc.getElementById('extensionsMenu');
      if (menu) {
        var container = wdoc.createElement('div');
        container.id = 'ds_wand_container';
        container.className = 'extension_container';
        container.innerHTML = '<div id="ds_wand_entry" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-chart-bar extensionsMenuExtensionButton" /></div>DeepSeek使用预测</div>';
        menu.appendChild(container);
        var wandBtn = wdoc.getElementById('ds_wand_entry');
        if (wandBtn) { wandBtn.addEventListener('click', function() { togglePanel(); }); }
      try {
        var checkBtn = wdoc.getElementById('ds-btn-check-update');
        if (checkBtn) { checkBtn.addEventListener('click', function() { checkForUpdates(); }); }
      } catch(e) {}
      }
    } catch(e) {}
  }
  // ===== 从持久化存储加载所有数据 =====
  function loadSavedData() { 
    try { 
      state.apiKey = decryptKey(loadData(KEY_STORAGE)) || ''; 
      var bd = loadData(BALANCE_STORAGE); 
      if (bd) { try { state.balance = JSON.parse(bd); } catch(e) {} }
      var cbd = loadData(CUSTOM_BALANCE_STORAGE);
      if (cbd) { state.customBalance = cbd; }
      var sd = loadData(SAVES_STORAGE); 
      if (sd) { try { state.saves = JSON.parse(sd); } catch(e) {} }
      var std = loadData(SETTINGS_STORAGE); 
      if (std) { try { state.settings = JSON.parse(std); } catch(e) {} }
      if (state.settings.useNewPricing === undefined) state.settings.useNewPricing = true;
      if (state.settings.newPricingDate === undefined) state.settings.newPricingDate = new Date('2026-08-17T00:00:00+08:00').getTime(); if (state.settings.customModels === undefined) state.settings.customModels = []; if (state.settings.peakHours === undefined) state.settings.peakHours = JSON.parse(JSON.stringify(DEFAULT_PEAK_HOURS)); if (state.settings.peakDot === undefined) state.settings.peakDot = true;
      // 版本迁移：从旧版本（< 2.28）升级后的首次运行，强制启用新价格机制并设置为 2026-08-17 生效，高峰时段恢复默认
      var lastVer = loadData(LAST_VERSION_STORAGE);
      var needForce = true;
      if (lastVer) {
        var lv = String(lastVer).split('.').map(Number);
        var cv = _ds_current_version.split('.').map(Number);
        needForce = lv[0] < cv[0] || (lv[0] === cv[0] && lv[1] < cv[1]);
      }
      if (needForce) {
        state.settings.useNewPricing = true;
        state.settings.newPricingDate = new Date('2026-08-17T00:00:00+08:00').getTime();
        state.settings.peakHours = JSON.parse(JSON.stringify(DEFAULT_PEAK_HOURS));
        saveSettings();
      }
      saveData(LAST_VERSION_STORAGE, _ds_current_version);
      state.messageCount = parseInt(loadData(MESSAGE_COUNT_STORAGE) || '0');
      // 向后兼容：为旧记录补充 priceType 字段
      Object.keys(state.saves).forEach(function(k) { var s = state.saves[k]; if (s.history) { s.history.forEach(function(h) { if (!h.priceType) h.priceType = 'old'; }); } });
    } catch(e) {
      console.error('[DS] loadSavedData error:', e);
    }
  }
  // ===== 持久化保存快捷函数 =====
  function saveSaves() { saveData(SAVES_STORAGE, JSON.stringify(state.saves)); }
  function saveCurrentSaveKey() { saveData(CURRENT_SAVE_KEY, state.currentSave); }
  function saveSettings() { saveData(SETTINGS_STORAGE, JSON.stringify(state.settings)); }
  function saveMessageCount() { saveData(MESSAGE_COUNT_STORAGE, String(state.messageCount)); }
  // 面板状态不保存，每次刷新默认关闭
  
  // ===== 计算剩余可对话轮数 =====
  // 使用 EWMA（指数加权移动平均，alpha=0.3）预测后续单轮费用，再按余额推算
  // 对话轮次仅针对 DeepSeek 官方 API：只使用模型名为 deepseek 开头的记录，其他厂商/供应商数据不计入
  function calculateRemainingRounds(stats) {
    var bal = (state.customBalance !== null && state.customBalance !== '') ? parseFloat(state.customBalance) : (state.balance && state.balance.balance ? parseFloat(state.balance.balance) : null);
    if (bal === null || isNaN(bal)) return null;
    var s = stats || getSelectedSave();
    if (!s) return null;
    var history = (s.history || []).filter(function(h) { return isDeepSeekOfficialModel(h.model); });
    if (history.length === 0) return null;
    var alpha = 0.3;
    var ewma = history[history.length - 1].cost || 0;
    for (var i = history.length - 2; i >= 0; i--) {
      ewma = alpha * (history[i].cost || 0) + (1 - alpha) * ewma;
    }
    if (ewma <= 0) return null;
    return Math.floor(bal / ewma);
  }
  
  // ===== 存档管理：加载、创建、选择、合并、删除 =====
  function loadCurrentSave() { try { var k = loadData(CURRENT_SAVE_KEY); if (k && state.saves[k]) { state.currentSave = k; } else if (Object.keys(state.saves).length > 0) { var keys = Object.keys(state.saves); var latest = keys[0]; var lt = 0; keys.forEach(function(k) { if (state.saves[k].startTime > lt) { lt = state.saves[k].startTime; latest = k; } }); state.currentSave = latest; } else { createNewSave(); } } catch(e) { createNewSave(); } }
  function createNewSave() { var cn = ''; try { cn = SillyTavern.getContext().name2 || ''; } catch(e) {} var n = new Date(); var key = n.getFullYear() + '' + String(n.getMonth()+1).padStart(2,'0') + '' + String(n.getDate()).padStart(2,'0') + '_' + String(n.getHours()).padStart(2,'0') + String(n.getMinutes()).padStart(2,'0') + String(n.getSeconds()).padStart(2,'0') + '_' + (cn || 'unknown'); state.saves[key] = { name: key, character: cn, startTime: n.getTime(), total_tokens: 0, total_cost: 0, input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, input_cost: 0, output_cost: 0, rounds: 0, history: [] }; state.currentSave = key; saveSaves(); saveCurrentSaveKey(); return key; }
  function getSelectedSave() { if (state.currentSave === '__all__') return getMergedStats(); return state.saves[state.currentSave] || null; }
  function getMergedStats() { var m = { total_tokens: 0, total_cost: 0, input_tokens: 0, output_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, input_cost: 0, output_cost: 0, rounds: 0, history: [], startTime: Date.now() }; var ah = []; var es = Date.now(); Object.keys(state.saves).forEach(function(k) { var s = state.saves[k]; m.total_tokens += s.total_tokens || 0; m.total_cost += s.total_cost || 0; m.input_tokens += s.input_tokens || 0; m.output_tokens += s.output_tokens || 0; m.cache_hit_tokens += s.cache_hit_tokens || 0; m.cache_miss_tokens += s.cache_miss_tokens || 0; m.input_cost += s.input_cost || 0; m.output_cost += s.output_cost || 0; m.rounds += s.rounds || 0; if (s.startTime && s.startTime < es) es = s.startTime; ah = ah.concat(s.history || []); }); m.startTime = es; ah.sort(function(a, b) { return b.timestamp - a.timestamp; }); m.history = ah.slice(0, 100); return m; }
  function deleteSave(key) { delete state.saves[key]; saveSaves(); if (state.currentSave === key) { var keys = Object.keys(state.saves); state.currentSave = keys.length > 0 ? keys[0] : null; if (!state.currentSave) createNewSave(); saveCurrentSaveKey(); } }

  // ===== 导出历史记录与统计（不含 API 密钥） =====
  // 导出 state 中的全部存档、当前存档、余额、自定义余额、设置与消息计数为 JSON 文件
  function exportHistory() {
    var p = window.parent || window;
    var doc = p.document;
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    var payload = {
      format: 'deepseek-stat-export',
      version: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: _ds_current_version,
      data: {
        saves: state.saves,
        currentSave: state.currentSave,
        balance: state.balance,
        customBalance: state.customBalance,
        settings: state.settings,
        messageCount: state.messageCount
      }
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = 'DeepSeek使用预测_导出_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.json';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(function() { try { URL.revokeObjectURL(url); } catch(e) {} }, 1000);
    try { toastr.success('已导出 ' + Object.keys(state.saves).length + ' 个存档（不含API密钥）'); } catch(e) {}
  }

  // ===== 导入数据归一化（版本迁移 + 防御解析） =====
  // 保证旧版本导出文件可在未来脚本中正常导入：
  //   - version 低于当前 → 依次执行迁移链；高于当前 → 拒绝并提示升级
  //   - 未知字段透传保留（未来版本解释），缺失字段补默认值
  //   - 派生成本字段（cost 等）不信任，由 recalcAllCosts 按当前定价表从 token 重算
  function normalizeImportData(raw) {
    var skipped = { saves: 0, entries: 0 };
    var version = raw.version;
    if (version === undefined) version = 1;
    if (typeof version !== 'number' || isNaN(version) || version < 1) version = 1;
    if (version > EXPORT_FORMAT_VERSION) {
      return { error: '文件版本（v' + version + '）高于当前脚本支持的版本（v' + EXPORT_FORMAT_VERSION + '），请升级脚本后再导入' };
    }
    // 迁移链扩展点：结构性变更时 bump EXPORT_FORMAT_VERSION 并在此添加迁移函数
    // var d = raw.data; d = migrateV1toV2(d); // v1 -> v2 示例
    var d = raw.data;
    if (!d || typeof d !== 'object') return { error: '文件中缺少数据' };
    if (!d.saves || typeof d.saves !== 'object') d.saves = {};
    var saves = {};
    Object.keys(d.saves).forEach(function(k) {
      var s = d.saves[k];
      if (!s || typeof s !== 'object') { skipped.saves++; return; }
      var ns = { name: s.name || k, character: (s.character === undefined ? '' : s.character) };
      if (s.startTime !== undefined) ns.startTime = s.startTime;
      var hs = [];
      if (Array.isArray(s.history)) {
        s.history.forEach(function(h) {
          if (!h || typeof h !== 'object' || h.timestamp === undefined || isNaN(h.timestamp)) { skipped.entries++; return; }
          var nh = {
            timestamp: h.timestamp,
            model: h.model || 'unknown',
            prompt_tokens: h.prompt_tokens || 0,
            cache_hit_tokens: h.cache_hit_tokens || 0,
            cache_miss_tokens: h.cache_miss_tokens || 0,
            completion_tokens: h.completion_tokens || 0,
            total_tokens: h.total_tokens || 0,
            priceType: h.priceType || 'old'
          };
          Object.keys(h).forEach(function(f) { if (nh[f] === undefined) nh[f] = h[f]; });
          hs.push(nh);
        });
      }
      ns.history = hs;
      Object.keys(s).forEach(function(f) { if (ns[f] === undefined && f !== 'history') ns[f] = s[f]; });
      saves[k] = ns;
    });
    d.saves = saves;
    var settings = (d.settings && typeof d.settings === 'object') ? d.settings : {};
    if (settings.useNewPricing === undefined) settings.useNewPricing = true;
    if (settings.newPricingDate === undefined) settings.newPricingDate = new Date('2026-08-17T00:00:00+08:00').getTime(); if (settings.customModels === undefined) settings.customModels = []; if (settings.peakHours === undefined) settings.peakHours = JSON.parse(JSON.stringify(DEFAULT_PEAK_HOURS)); if (settings.peakDot === undefined) settings.peakDot = true;
    d.settings = settings;
    if (d.currentSave !== undefined && !saves[d.currentSave]) d.currentSave = null;
    return { data: d, skipped: skipped };
  }

  // ===== 导入历史记录与统计 =====
  // 通过隐藏 file input 选择 JSON 文件，校验后弹出覆盖/合并选择
  function importHistory() {
    var p = window.parent || window;
    var doc = p.document;
    var input = doc.getElementById('ds-import-file');
    if (!input) {
      input = doc.createElement('input');
      input.type = 'file';
      input.id = 'ds-import-file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      doc.body.appendChild(input);
      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function() {
          var raw = null;
          try { raw = JSON.parse(reader.result); } catch(e) {}
          if (!raw || raw.format !== 'deepseek-stat-export') {
            try { toastr.error('导入失败：文件格式不正确'); } catch(e2) {}
            return;
          }
          var result = normalizeImportData(raw);
          if (result.error) {
            try { toastr.error('导入失败：' + result.error); } catch(e2) {}
            return;
          }
          _dsShowImportConfirm(result);
        };
        reader.readAsText(file, 'utf-8');
      });
    }
    input.click();
  }

  // ===== 导入确认弹层（覆盖 / 合并 / 取消） =====
  function _dsPositionImportDialog() {
    var p = window.parent || window;
    var doc = p.document;
    var overlay = doc.getElementById('ds-import-overlay');
    var dlg = doc.getElementById('ds-import-dialog');
    if (!overlay || !dlg || overlay.style.display === 'none') return;
    var vw = doc.documentElement.clientWidth || p.innerWidth || 0;
    var vh = doc.documentElement.clientHeight || p.innerHeight || 0;
    var w = Math.min(440, Math.max(280, vw * 0.92));
    dlg.style.left = '0px';
    dlg.style.top = '0px';
    var rect = dlg.getBoundingClientRect();
    var docOffX = -rect.left;
    var docOffY = -rect.top;
    dlg.style.width = Math.round(w) + 'px';
    dlg.style.maxHeight = Math.round(vh - 48) + 'px';
    var h = Math.min(dlg.scrollHeight || 400, Math.max(240, vh - 48));
    dlg.style.left = Math.round(docOffX + (vw - w) / 2) + 'px';
    dlg.style.top = Math.round(docOffY + Math.max(8, (vh - h) / 2)) + 'px';
    overlay.style.left = docOffX + 'px';
    overlay.style.top = docOffY + 'px';
    overlay.style.width = vw + 'px';
    overlay.style.height = vh + 'px';
  }
  function _dsHideImportConfirm() {
    var p = window.parent || window;
    var doc = p.document;
    var overlay = doc.getElementById('ds-import-overlay');
    var dlg = doc.getElementById('ds-import-dialog');
    if (overlay) overlay.style.display = 'none';
    if (dlg) dlg.style.display = 'none';
  }
  function _dsShowImportConfirm(result) {
    var p = window.parent || window;
    var doc = p.document;
    var overlay = doc.getElementById('ds-import-overlay');
    if (!overlay) {
      overlay = doc.createElement('div');
      overlay.id = 'ds-import-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;background:rgba(0,0,0,0.6);z-index:999999;display:none;';
      overlay.addEventListener('click', function(e) { if (e.target === overlay) _dsHideImportConfirm(); });
      doc.body.appendChild(overlay);

      var dlg = doc.createElement('div');
      dlg.id = 'ds-import-dialog';
      dlg.style.cssText = 'position:absolute;z-index:1000000;background:#0e1520;border:1px solid #374151;border-radius:12px;padding:20px 24px;box-sizing:border-box;color:#e5e7eb;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
      dlg.innerHTML = '<div style="font-size:15px;font-weight:600;margin-bottom:8px">📥 导入历史记录</div>' +
        '<div style="font-size:12px;color:#9ca3af;line-height:1.8;margin-bottom:6px">检测到 <span style="color:#60a5fa;font-weight:600" id="ds-import-count"></span> 个存档。请选择导入方式：</div>' +
        '<div style="font-size:12px;color:#6b7280;line-height:1.8;margin-bottom:16px">覆盖导入将整体替换当前数据；合并导入仅新增存档或按时间戳合并同存档的历史记录，并保留当前余额与设置。两种方式均不含 API 密钥。</div>' +
        '<div style="font-size:12px;color:#f59e0b;line-height:1.6;margin-bottom:12px" id="ds-import-skipped"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
        '<button id="ds-import-cancel" style="padding:7px 14px;border:1px solid #374151;border-radius:6px;background:transparent;color:#9ca3af;font-size:12px;cursor:pointer;font-family:inherit">取消</button>' +
        '<button id="ds-import-merge" style="padding:7px 14px;border:1px solid rgba(52,211,153,0.4);border-radius:6px;background:rgba(52,211,153,0.12);color:#34d399;font-size:12px;cursor:pointer;font-family:inherit">合并导入</button>' +
        '<button id="ds-import-overwrite" style="padding:7px 14px;border:1px solid rgba(96,165,250,0.5);border-radius:6px;background:rgba(96,165,250,0.15);color:#60a5fa;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">覆盖导入</button>' +
        '</div>';
      doc.body.appendChild(dlg);

      overlay._dsPendingData = null;
      var cb = dlg.querySelector('#ds-import-cancel');
      var mb = dlg.querySelector('#ds-import-merge');
      var ob = dlg.querySelector('#ds-import-overwrite');
      if (cb) cb.onclick = function() { _dsHideImportConfirm(); };
      if (mb) mb.onclick = function() { _dsHideImportConfirm(); if (overlay._dsPendingData) applyImportedData(overlay._dsPendingData.data, 'merge'); };
      if (ob) ob.onclick = function() { _dsHideImportConfirm(); if (overlay._dsPendingData) applyImportedData(overlay._dsPendingData.data, 'overwrite'); };
      p.addEventListener('scroll', _dsPositionImportDialog, { capture: true, passive: true });
      p.addEventListener('resize', _dsPositionImportDialog, { passive: true });
      setTimeout(_dsPositionImportDialog, 50);
    }
    overlay._dsPendingData = result;
    var c = doc.getElementById('ds-import-count');
    if (c) c.textContent = Object.keys(result.data.saves).length;
    var sk = doc.getElementById('ds-import-skipped');
    if (sk) {
      var n = (result.skipped && (result.skipped.saves + result.skipped.entries)) || 0;
      sk.style.display = n > 0 ? 'block' : 'none';
      if (n > 0) sk.textContent = '已忽略 ' + result.skipped.saves + ' 个无效存档、' + result.skipped.entries + ' 条无效记录';
    }
    var dlg = doc.getElementById('ds-import-dialog');
    if (dlg) dlg.style.display = 'block';
    overlay.style.display = 'block';
    _dsPositionImportDialog();
  }

  // ===== 应用导入的数据（overwrite 覆盖全部 / merge 合并存档） =====
  // d 已通过 normalizeImportData 归一化（版本迁移 + 缺省补全）；
  // 导入后统一调用 recalcAllCosts 从 history 重算汇总，确保统计完整正确还原
  function applyImportedData(d, mode) {
    var importedSaves = d.saves || {};
    Object.keys(importedSaves).forEach(function(k) {
      var s = importedSaves[k];
      if (!s || typeof s !== 'object') return;
      s.name = s.name || k;
      if (s.character === undefined) s.character = '';
      s.history = Array.isArray(s.history) ? s.history : [];
      s.history.forEach(function(h) { if (h && h.priceType === undefined) h.priceType = 'old'; });
    });
    if (mode === 'overwrite') {
      state.saves = importedSaves;
      state.currentSave = (d.currentSave && importedSaves[d.currentSave]) ? d.currentSave : null;
      if (d.balance !== undefined) state.balance = d.balance;
      if (d.customBalance !== undefined) state.customBalance = d.customBalance;
      if (d.settings && typeof d.settings === 'object') state.settings = d.settings;
      if (d.messageCount !== undefined) state.messageCount = d.messageCount;
    } else {
      Object.keys(importedSaves).forEach(function(k) {
        var s = importedSaves[k];
        if (!state.saves[k]) {
          state.saves[k] = s;
        } else {
          var seen = {};
          (state.saves[k].history || []).forEach(function(h) { if (h) seen[h.timestamp] = true; });
          (s.history || []).forEach(function(h) { if (h && !seen[h.timestamp]) { seen[h.timestamp] = true; state.saves[k].history.push(h); } });
          state.saves[k].history.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
          if (state.saves[k].history.length > 200) state.saves[k].history = state.saves[k].history.slice(0, 200);
        }
      });
    }
    if (state.settings.useNewPricing === undefined) state.settings.useNewPricing = true;
    if (state.settings.newPricingDate === undefined) state.settings.newPricingDate = new Date('2026-08-17T00:00:00+08:00').getTime(); if (state.settings.customModels === undefined) state.settings.customModels = []; if (state.settings.peakHours === undefined) state.settings.peakHours = JSON.parse(JSON.stringify(DEFAULT_PEAK_HOURS)); if (state.settings.peakDot === undefined) state.settings.peakDot = true;
    if (!state.currentSave || !state.saves[state.currentSave]) {
      var keys = Object.keys(state.saves);
      state.currentSave = keys.length > 0 ? keys[0] : null;
    }
    if (!state.currentSave) createNewSave();
    saveSaves();
    saveCurrentSaveKey();
    saveSettings();
    saveMessageCount();
    if (mode === 'overwrite') {
      if (state.customBalance !== null && state.customBalance !== '') saveData(CUSTOM_BALANCE_STORAGE, state.customBalance);
      else saveData(CUSTOM_BALANCE_STORAGE, '');
      if (state.balance) saveData(BALANCE_STORAGE, JSON.stringify(state.balance));
      else saveData(BALANCE_STORAGE, '');
    }
    recalcAllCosts();
    refreshSaveSelect();
    refreshUI();
    if (state.chartPanelOpen) { try { renderCharts(); } catch(e) {} }
    try { toastr.success(mode === 'overwrite' ? '导入完成：已覆盖全部数据' : '导入完成：已合并存档'); } catch(e) {}
  }
  
  // ===== 注册酒馆事件监听 =====
  function setupEvents() { eventOn(tavern_events.MESSAGE_RECEIVED, function() { setTimeout(function() { refreshUI(); }, 500); }); try { eventOn(getButtonEvent('打开面板'), function() { togglePanel(); }); } catch(e) {} }

  // ===== 页面可见性修复 =====
  // 现象：打开面板 → 切换浏览器标签页 → 切回后面板部分 UI/内容随机空白，鼠标悬停后恢复。
  // 原因：面板常驻 will-change 且为 position:fixed 滚动容器，成为独立 GPU 合成层；
  //       Chromium 后台标签页期间可能丢弃合成层缓存，切回前台时未重新栅格化。
  // 处理：可见时强制销毁并重建合成层、强制重绘内容层，一帧内完成且禁动画，无视觉变化。
  var _ds_visibilityFixPending = false;
  function setupVisibilityFix() {
    var targets = [document, (window.parent && window.parent.document)];
    targets.forEach(function(doc) {
      if (!doc) return;
      try { doc.addEventListener('visibilitychange', function() { if (doc.visibilityState === 'visible') { schedulePanelRepaint(); } }); } catch(e) {}
    });
  }
  function schedulePanelRepaint() {
    if (_ds_visibilityFixPending) return;
    _ds_visibilityFixPending = true;
    requestAnimationFrame(function() { forcePanelRepaint(); _ds_visibilityFixPending = false; });
  }
  function forcePanelRepaint() {
    var p = window.parent || window;
    var doc = p.document;
    var panels = [];
    var mainPanel = doc.getElementById('ds-panel');
    if (mainPanel && state.panelOpen) panels.push(mainPanel);
    var chartPanel = doc.getElementById('ds-chart-panel');
    if (chartPanel && state.chartPanelOpen) panels.push(chartPanel);
    var compareOverlay = doc.getElementById('ds-compare-overlay');
    var comparePanel = doc.getElementById('ds-compare-panel');
    if (compareOverlay && compareOverlay.style.display === 'block' && comparePanel) panels.push(comparePanel);
    var usageOverlay = doc.getElementById('ds-usage-overlay');
    var usagePanel = doc.getElementById('ds-usage-panel');
    if (usageOverlay && usageOverlay.style.display === 'block' && usagePanel) panels.push(usagePanel);
    var settingsOverlay = doc.getElementById('ds-settings-overlay');
    var settingsPanel = doc.getElementById('ds-settings-panel');
    if (settingsOverlay && settingsOverlay.style.display === 'block' && settingsPanel) panels.push(settingsPanel);
    panels.forEach(function(el) {
      if (!el || el.style.display === 'none') return;
      // 1) 禁用过渡动画：CSS 中 transition 为 !important，必须同样以 important 覆盖，否则扰动 transform 会触发过渡动画导致闪烁
      try { el.style.setProperty('transition', 'none', 'important'); } catch(e) {}
      // 2) 解除 will-change 销毁独立合成层（同样 important 覆盖），强制回流
      try { el.style.setProperty('will-change', 'auto', 'important'); } catch(e) {}
      void el.offsetHeight;
      // 3) 追加 translateZ(0) 强制内容重新栅格化（视觉上无变化，动画已禁用）
      try {
        var base = getComputedStyle(el).transform;
        el.style.setProperty('transform', (base && base !== 'none' ? base + ' ' : '') + 'translateZ(0)', 'important');
      } catch(e) {}
      void el.offsetHeight;
      // 4) 下一帧恢复原样式：先移除 transform（动画仍禁用），再恢复 transition 与 will-change，避免残留影响后续开合动画
      requestAnimationFrame(function() {
        try { el.style.removeProperty('transform'); } catch(e) {}
        try { el.style.removeProperty('transition'); } catch(e) {}
        try { el.style.removeProperty('will-change'); } catch(e) {}
      });
    });
    if (state.panelOpen) { try { refreshUI(); } catch(e) {} }
    if (state.chartPanelOpen) {
      try { Object.keys(_chartInstances).forEach(function(k) { var c = _chartInstances[k]; if (c && c.resize) { try { c.resize(); } catch(e) {} } }); } catch(e) {}
      try { var heatmap = doc.getElementById('ds-heatmap-container'); if (heatmap) { heatmap.style.transform = 'translateZ(0)'; void heatmap.offsetHeight; heatmap.style.transform = ''; } } catch(e) {}
    }
    try { p.dispatchEvent(new Event('resize')); } catch(e) {}
  }
  
  // ===== 拦截 fetch 以捕获 DeepSeek API 用量 =====
  // 仅拦截 TARGET_API 路径的请求，提取 usage 并传给 processUsage
  // 调试模式下直接用模拟数据返回，不实际请求 API
  function patchFetch() { var p = window.parent || window; if (p._ds_fetch_patched) return; var rawFetch = p.fetch; p.fetch = function() { var args = arguments; var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url); if (url && url.indexOf(TARGET_API) !== -1) { var _ds_reqBody = null; try { _ds_reqBody = JSON.parse(args[1].body); } catch(e){} var _ds_fullReq = _ds_reqBody ? JSON.parse(JSON.stringify(_ds_reqBody)) : null; var _ds_msgs = []; if (_ds_reqBody && _ds_reqBody.messages && _ds_reqBody.messages.length) { try { _ds_msgs = _ds_reqBody.messages.slice(-10); } catch(e){} } var _ds_startTime = Date.now();
       if (state.settings.debug) { var fakeUsage = { prompt_cache_hit_tokens: state.settings.debugHit, prompt_cache_miss_tokens: state.settings.debugMiss, completion_tokens: state.settings.debugOutput, total_tokens: state.settings.debugHit + state.settings.debugMiss + state.settings.debugOutput }; var fakeResponse = { choices: [{ message: { content: '[调试模式] 此响应为模拟数据，未产生API费用' } }], usage: fakeUsage, model: state.settings.debugModel }; setTimeout(function() { try { var _p = window.parent || window; var _ctx = _p.SillyTavern && _p.SillyTavern.getContext && _p.SillyTavern.getContext(); var _chat = (_ctx && _ctx.chat) || []; var _chatMsgs = []; _chat.forEach(function(m){ if(m && m.mes) _chatMsgs.push({role:m.is_user?'user':'assistant',content:m.mes}); }); _ds_msgs = _chatMsgs.slice(-10); _ds_fullReq = null; } catch(e){} processUsage(fakeUsage, state.settings.debugModel, _ds_msgs, _ds_startTime, _ds_fullReq, fakeResponse, 0, 0); }, 100); return Promise.resolve(new Response(JSON.stringify(fakeResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })); } return rawFetch.apply(p, args).then(function(res) { var clone = res.clone(); var _ds_ttft = 0; var _ds_thinkStart = 0; var _ds_thinkEnd = 0; var _ds_parseRes = function(text, ttftVal, thinkTimeVal) { try { var data = null; var trimmed = text.trim(); if (trimmed.startsWith('{')) { data = JSON.parse(trimmed); } else { text.split('\n').forEach(function(line) { if (line.startsWith('data: ') && line !== 'data: [DONE]') { try { var chunk = JSON.parse(line.substring(6)); if (chunk.usage) data = chunk; } catch(e) {} } }); } if (data && data.usage) { processUsage(data.usage, _ds_extractModel(data, _ds_fullReq), _ds_msgs, _ds_startTime, _ds_fullReq, data, ttftVal, thinkTimeVal) } } catch(e) {} }; var _ds_extractModel = function(data, fullReq) { try { if (data && data.model) return data.model; if (data && data.choices && data.choices[0] && data.choices[0].model) return data.choices[0].model; if (data && data.body && data.body.model) return data.body.model; if (fullReq && fullReq.model) return fullReq.model; } catch(e) {} return null; }; var _ds_reader = clone.body && clone.body.getReader ? clone.body.getReader() : null; if (_ds_reader) { var _ds_buf = ''; var _ds_dec = new TextDecoder('utf-8'); var _ds_pump = function() { return _ds_reader.read().then(function(r) { if (r.done) { try { _ds_parseRes(_ds_buf, _ds_ttft || (Date.now() - _ds_startTime), _ds_thinkStart && _ds_thinkEnd ? (_ds_thinkEnd - _ds_thinkStart) : 0); } catch(e) {} return; } var _ds_chunkText = _ds_dec.decode(r.value, { stream: true }); _ds_buf += _ds_chunkText; if (!_ds_ttft && /"reasoning_content"\s*:\s*"(?:[^"\\]|\\.)/.test(_ds_buf)) _ds_ttft = Date.now() - _ds_startTime; if (!_ds_ttft && /"content"\s*:\s*"(?:[^"\\]|\\.)/.test(_ds_buf)) _ds_ttft = Date.now() - _ds_startTime; if (/"reasoning_content"\s*:\s*"(?:[^"\\]|\\.)/.test(_ds_chunkText)) { if (!_ds_thinkStart) _ds_thinkStart = Date.now(); _ds_thinkEnd = Date.now(); } return _ds_pump(); }); }; _ds_pump().catch(function(err) { console.error("[DS] stream read error", err); }); } else { clone.text().then(function(text) { try { _ds_parseRes(text, Date.now() - _ds_startTime, 0); } catch(e) {} }).catch(function(err) { console.error("[DS] text() error", err); }); } return res; }); } return rawFetch.apply(p, args); }; p._ds_fetch_patched = true; }
  
  // ===== 处理单次 API 调用用量 =====
  // 从 usage 中提取 token 数，计算费用，更新当前存档和历史记录
  function processUsage(usage, model, messages, startTime, fullRequest, fullResponse, ttft, thinkTime) {
     messages = messages || []; var model = model || ''; if (!model) { try { model = SillyTavern.getContext().model || ''; } catch(e) {} } if (!model) model = 'deepseek'; var hit = usage.prompt_cache_hit_tokens || 0; if (!hit && usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) { hit = usage.prompt_tokens_details.cached_tokens; } var miss = usage.prompt_cache_miss_tokens; if (miss === undefined || miss === null) { miss = (usage.prompt_tokens || usage.input_tokens || 0) - hit; if (miss < 0) miss = 0; } var comp = usage.completion_tokens || usage.output_tokens || 0; var total = usage.total_tokens || (hit + miss + comp); var lu = { timestamp: Date.now(), model: model, prompt_tokens: hit + miss, prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: miss, completion_tokens: comp, total_tokens: total }; var duration = startTime ? (Date.now() - startTime) : 0; var tokenRate = duration > 0 && comp > 0 ? Math.round((comp / duration) * 1000) : 0; var ttftVal = (ttft && ttft > 0) ? ttft : duration; var thinkTokens = 0; try { thinkTokens = (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0; } catch(e){} lu.duration = duration; lu.tokenRate = tokenRate; lu.ttft = ttftVal; lu.thinkTime = (thinkTime && thinkTime > 0) ? thinkTime : 0; lu.thinkTokens = thinkTokens; lu.messages = messages; lu.cost = calcCost(lu); lu.rawUsage = usage; lu.fullRequest = fullRequest || null; lu.fullResponse = fullResponse || null; state.lastUsage = lu; var s = getSelectedSave(); if (!s) return; s.total_tokens += lu.total_tokens; s.total_cost += lu.cost.total; s.input_tokens += lu.prompt_tokens; s.output_tokens += lu.completion_tokens; s.cache_hit_tokens += lu.prompt_cache_hit_tokens; s.cache_miss_tokens += lu.prompt_cache_miss_tokens; s.input_cost += lu.cost.input; s.output_cost += lu.cost.output; if (isDeepSeekOfficialModel(lu.model)) { s.rounds += 1; } s.history.unshift({ timestamp: lu.timestamp, model: lu.model, prompt_tokens: lu.prompt_tokens, cache_hit_tokens: lu.prompt_cache_hit_tokens, cache_miss_tokens: lu.prompt_cache_miss_tokens, completion_tokens: lu.completion_tokens, total_tokens: lu.total_tokens, input_cost: lu.cost.input, output_cost: lu.cost.output, cost: lu.cost.total, cache_hit_rate: lu.prompt_tokens > 0 ? (lu.prompt_cache_hit_tokens / lu.prompt_tokens * 100) : 0, priceType: lu.cost.priceType || 'old', raw_usage: lu.rawUsage, messages: lu.messages, duration: lu.duration, ttft: lu.ttft, thinkTime: lu.thinkTime, thinkTokens: lu.thinkTokens, tokenRate: lu.tokenRate, fullRequest: lu.fullRequest, fullResponse: lu.fullResponse }); if (s.history.length > 200) s.history = s.history.slice(0, 200); saveSaves(); if (state.customBalance !== null && state.customBalance !== '') { state.customBalance = parseFloat(state.customBalance) - lu.cost.total; saveData(CUSTOM_BALANCE_STORAGE, String(state.customBalance)); } else if (state.balance && state.balance.balance) { state.balance.balance = parseFloat(state.balance.balance) - lu.cost.total; saveData(BALANCE_STORAGE, JSON.stringify(state.balance)); } state.messageCount++; saveMessageCount(); if (state.settings.autoBalance && state.apiKey && state.messageCount >= state.settings.balanceInterval) { state.messageCount = 0; saveMessageCount(); autoQueryBalance(); } refreshUI(); }
  
  // ===== 根据 token 用量和定价表计算费用 =====
  // 支持新旧两套定价，新定价区分高峰/非高峰时段
  function calcCost(u) { var model = u.model || 'deepseek-v4-flash'; var pricing = getPricing(model); var useNewPricing = state.settings.useNewPricing && u.timestamp >= state.settings.newPricingDate; var p; var priceType; if (useNewPricing && pricing.usePeakPricing !== false) { var isPeak = isPeakHour(u.timestamp); p = isPeak ? pricing.peak : pricing.offpeak; priceType = isPeak ? 'new-peak' : 'new-offpeak'; } else { p = pricing.offpeak; priceType = useNewPricing ? 'new-offpeak' : 'old'; } var ih = (u.prompt_cache_hit_tokens / 1e6) * p.hit; var im = (u.prompt_cache_miss_tokens / 1e6) * p.miss; var o = (u.completion_tokens / 1e6) * p.output; return { input: ih + im, output: o, total: ih + im + o, priceType: priceType }; }
  // ===== 重新计算所有存档的汇总费用 =====
  // 在加载旧数据或切换定价模式后调用，确保统计一致性
  function recalcAllCosts() { Object.keys(state.saves).forEach(function(k) { var s = state.saves[k]; s.total_tokens = 0; s.total_cost = 0; s.input_tokens = 0; s.output_tokens = 0; s.cache_hit_tokens = 0; s.cache_miss_tokens = 0; s.input_cost = 0; s.output_cost = 0; s.rounds = 0; (s.history || []).forEach(function(h) { var u = { timestamp: h.timestamp, model: h.model, prompt_cache_hit_tokens: h.cache_hit_tokens || 0, prompt_cache_miss_tokens: h.cache_miss_tokens || 0, completion_tokens: h.completion_tokens || 0 }; var c = calcCost(u); h.input_cost = c.input; h.output_cost = c.output; h.cost = c.total; h.priceType = c.priceType; h.cache_hit_rate = (h.cache_hit_tokens || 0) + (h.cache_miss_tokens || 0) > 0 ? ((h.cache_hit_tokens || 0) / ((h.cache_hit_tokens || 0) + (h.cache_miss_tokens || 0)) * 100) : 0; s.total_tokens += h.total_tokens || 0; s.total_cost += h.cost; s.input_tokens += (h.prompt_tokens || 0); s.output_tokens += h.completion_tokens || 0; s.cache_hit_tokens += h.cache_hit_tokens || 0; s.cache_miss_tokens += h.cache_miss_tokens || 0; s.input_cost += c.input; s.output_cost += c.output; if (isDeepSeekOfficialModel(h.model)) { s.rounds += 1; } }); if (s.history && s.history.length > 200) s.history = s.history.slice(0, 200); }); saveSaves(); }
  // ===== 批量生成调试模拟数据 =====
  function generateDebugBatch() {
    var s = getSelectedSave();
    if (!s) { try { var p = window.parent || window; toastr.warning('请先选择存档'); } catch(e){} return; }
    var startStr = state.settings.debugDateStart;
    var endStr = state.settings.debugDateEnd;
    if (!startStr || !endStr) { try { var p = window.parent || window; toastr.warning('请设置起始日期和结束日期'); } catch(e){} return; }
    var startDate = new Date(startStr + 'T00:00:00Z');
    var endDate = new Date(endStr + 'T00:00:00Z');
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) {
      try { var p = window.parent || window; toastr.warning('请设置有效的日期范围'); } catch(e){} return;
    }
    var count = state.settings.debugBatchCount || 30;
    var model = state.settings.debugModel || getModelList()[0] || 'deepseek-v4-flash';
    var hit = state.settings.debugHit || 10000;
    var miss = state.settings.debugMiss || 5000;
    var output = state.settings.debugOutput || 2000;
    var totalDays = Math.round((endDate - startDate) / 86400000) + 1;
    var entriesPerDay = Math.ceil(count / totalDays);
    var generated = 0;
    var maxHistory = 200;
    for (var d = 0; d < totalDays && generated < count; d++) {
      var currentDate = new Date(startDate);
      currentDate.setUTCDate(startDate.getUTCDate() + d);
      for (var i = 0; i < entriesPerDay && generated < count; i++) {
        var randVar = function(base) { return Math.round(base * (0.3 + Math.random() * 1.4)); };
        var h = randVar(hit);
        var m = randVar(miss);
        var o = randVar(output);
        var total = h + m + o;
        var hour = Math.floor(Math.random() * 24);
        var minute = Math.floor(Math.random() * 60);
        var second = Math.floor(Math.random() * 60);
        var ts = new Date(currentDate);
        ts.setUTCHours(hour, minute, second, 0);
        var dur = Math.floor(Math.random() * 5000) + 500;
        var ttft = Math.floor(Math.random() * 1000) + 100;
        var thinkDur = Math.floor(Math.random() * 2000) + 200;
        var thinkTok = Math.floor(Math.random() * o * 0.4);
        var tRate = dur > 0 ? Math.round(o / dur * 1000) : 0;
        var promptTotal = h + m;
        var hitRate = promptTotal > 0 ? (h / promptTotal * 100) : 0;
        var fakeUsage = { prompt_cache_hit_tokens: h, prompt_cache_miss_tokens: m, completion_tokens: o, total_tokens: total };
        var c = calcCost({ timestamp: ts.getTime(), model: model, prompt_cache_hit_tokens: h, prompt_cache_miss_tokens: m, completion_tokens: o });
        s.history.unshift({
          timestamp: ts.getTime(),
          model: model,
          prompt_tokens: promptTotal,
          cache_hit_tokens: h,
          cache_miss_tokens: m,
          completion_tokens: o,
          total_tokens: total,
          input_cost: c.input,
          output_cost: c.output,
          cost: c.total,
          cache_hit_rate: hitRate,
          priceType: c.priceType,
          raw_usage: fakeUsage,
          messages: [],
          duration: dur,
          ttft: ttft,
          thinkTime: thinkDur,
          thinkTokens: thinkTok,
          tokenRate: tRate,
          fullRequest: null,
          fullResponse: null
        });
        generated++;
      }
    }
    if (s.history.length > maxHistory) s.history = s.history.slice(0, maxHistory);
    s.history.sort(function(a, b) { return b.timestamp - a.timestamp; });
    recalcAllCosts();
    saveSaves();
    refreshUI();
    if (state.chartPanelOpen) {
      renderCharts();
    }
    try { var p = window.parent || window; toastr.success('已生成 ' + generated + ' 条模拟数据'); } catch(e){}
  }
  // ===== API Key 简单 XOR 加密（非安全，仅防明文存储） =====
  var XOR_KEY = 'ds-stats-v1-xor-key!@#$%^&*';
  function encryptKey(plaintext) {
    if (!plaintext) return '';
    var result = '';
    for (var i = 0; i < plaintext.length; i++) {
      result += String.fromCharCode(plaintext.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    }
    return btoa(result);
  }
  function decryptKey(ciphertext) {
    if (!ciphertext) return '';
    try {
      var decoded = atob(ciphertext);
      var result = '';
      for (var i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
      }
      return result;
    } catch(e) { return ciphertext; }
  }
  function maskApiKey(key) {
    if (!key || key.length < 8) return '****';
    return '****' + key.slice(-4);
  }
  function saveApiKey(key) { saveData(KEY_STORAGE, encryptKey(key)); state.apiKey = key; }
  function saveBalanceData(data) { state.balance = data; saveData(BALANCE_STORAGE, JSON.stringify(data)); }
  
  // ===== 调用 DeepSeek 余额 API 查询余额 =====
  async function queryBalance() { var p = window.parent || window; var doc = p.document; var se = doc.getElementById('ds-balance-status'); var be = doc.getElementById('ds-balance'); var btn = doc.getElementById('ds-btn-query-balance'); if (!state.apiKey) { if (se) se.textContent = '请先输入API密钥'; return; } if (btn) btn.textContent = '查询中...'; if (se) se.textContent = '正在查询...'; try { var r = await fetch('https://api.deepseek.com/user/balance', { method: 'GET', headers: { 'Authorization': 'Bearer ' + state.apiKey, 'Content-Type': 'application/json' } }); var d = await r.json(); if (d.is_available && d.balance_infos && d.balance_infos.length > 0) { var i = d.balance_infos[0]; saveBalanceData({ balance: i.total_balance, currency: i.currency, available: d.is_available, timestamp: Date.now() }); if (state.customBalance === null || state.customBalance === '') { if (be) be.textContent = '\u00A5' + i.total_balance + ' ' + i.currency; if (se) se.textContent = '\u8D26\u6237\u53EF\u7528 | ' + new Date().toLocaleTimeString('zh-CN'); } else { if (se) se.textContent = '\u81EA\u5B9A\u4E49\u4F59\u989D\u7565\u8FC7 | API: \u00A5' + i.total_balance; } } else { if (be) be.textContent = '\u67E5\u8BE2\u5931\u8D25'; if (se) se.textContent = d.error ? d.error.message : '\u8BF7\u68C0\u67E5\u5BC6\u94A5'; } } catch(e) { if (be) be.textContent = '\u7F51\u7EDC\u9519\u8BEF'; if (se) se.textContent = e.message; } if (btn) btn.textContent = '\u67E5\u8BE2'; }
  
  // ===== 自动查询余额（定时任务调用，不显示 UI 反馈） =====
  async function autoQueryBalance() { try { var r = await fetch('https://api.deepseek.com/user/balance', { method: 'GET', headers: { 'Authorization': 'Bearer ' + state.apiKey, 'Content-Type': 'application/json' } }); var d = await r.json(); if (d.is_available && d.balance_infos && d.balance_infos.length > 0) { var i = d.balance_infos[0]; saveBalanceData({ balance: i.total_balance, currency: i.currency, available: d.is_available, timestamp: Date.now() }); if (state.customBalance === null || state.customBalance === '') { var p = window.parent || window; var doc = p.document; var be = doc.getElementById('ds-balance'); var se = doc.getElementById('ds-balance-status'); if (be) be.textContent = '\u00A5' + i.total_balance + ' ' + i.currency; if (se) se.textContent = '\u8D26\u6237\u53EF\u7528 | ' + new Date().toLocaleTimeString('zh-CN'); } } } catch(e) {} }
  
  function formatStartTime(ts) { if (!ts) return ''; var d = new Date(ts); return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}); }
  
  
// ===== 模型与价格 / 峰谷时段 编辑器（自定义模型名与价格、自定义高峰时段） =====
function modelEditorRowHtml(model, entry, isBuiltin) {
  var p = getPricing(model);
  var usePeak = p.usePeakPricing !== false;
  var oh = p.offpeak, pk = p.peak;
  var rowStyle = 'display:flex;flex-direction:column;gap:6px;padding:8px;background:#0a1018;border:1px solid #1f2937;border-radius:8px';
  var inpStyle = 'flex:1;min-width:0;padding:5px 8px;border:1px solid #374151;border-radius:5px;background:#0e1520;color:#e5e7eb;font-size:12px;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;outline:none';
  var roStyle = 'flex:1;min-width:0;padding:5px 8px;border:1px solid #374151;border-radius:5px;background:#111827;color:#9ca3af;font-size:12px;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;outline:none';
  var modelInput = '<input type="text" class="ds-cm-model" value="' + model + '" placeholder="模型名" ' + (isBuiltin ? 'readonly style="' + roStyle + '"' : 'style="' + inpStyle + '"') + '>';
  var delBtn = isBuiltin ? '' : '<button data-del="1" style="padding:5px 9px;border:1px solid #7f1d1d;border-radius:5px;background:#7f1d1d;color:#fca5a5;font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap">删除</button>';
  var sliderLeft = usePeak ? '19px' : '3px';
  var peakToggle = '<label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;flex-shrink:0" title="开启后按高峰/非高峰时段分别计价，关闭则使用统一价格">' +
    '<input type="checkbox" class="ds-cm-peak" style="opacity:0;width:0;height:0"' + (usePeak ? ' checked' : '') + '>' +
    '<span style="position:absolute;top:0;left:0;right:0;bottom:0;background:' + (usePeak ? '#2563eb' : '#374151') + ';border-radius:10px;transition:0.3s;cursor:pointer">' +
    '<span class="ds-cm-slider" style="position:absolute;height:14px;width:14px;left:' + sliderLeft + ';bottom:3px;background:white;border-radius:50%;transition:0.3s"></span></span></label>';
  var header = '<div style="display:flex;align-items:center;gap:8px">' +
    '<span style="font-size:10px;color:#6b7280;white-space:nowrap;flex-shrink:0">模型</span>' + modelInput +
    '<span style="flex:1;min-width:4px"></span>' +
    '<span style="font-size:10px;color:#9ca3af;white-space:nowrap;flex-shrink:0">峰谷</span>' + peakToggle +
    delBtn + '</div>';
  function fieldHtml(zone, f, val) {
    var lbl = f === 'hit' ? '命中' : f === 'miss' ? '未命中' : '输出';
    return '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:#9ca3af;width:44px;flex-shrink:0">' + lbl + '</span><input type="number" min="0" step="0.001" data-price="' + zone + '.' + f + '" value="' + (val !== undefined && val !== '' ? val : '') + '" style="' + inpStyle + '"></div>';
  }
  function zoneHtml(zoneLabel, zone, zonePrices, accent) {
    var body = '';
    ['hit', 'miss', 'output'].forEach(function(f) { body += fieldHtml(zone, f, zonePrices ? zonePrices[f] : ''); });
    return '<div style="background:#0e1520;border:1px solid #1f2937;border-radius:6px;padding:7px;display:flex;flex-direction:column;gap:5px">' +
      '<div style="font-size:10px;color:' + accent + ';font-weight:600;margin-bottom:1px">' + zoneLabel + '</div>' + body + '</div>';
  }
  var offZone = zoneHtml('非峰时段', 'offpeak', oh, '#34d399');
  var peakZone = zoneHtml('高峰时段', 'peak', pk, '#fbbf24');
  var pricesArea = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
    '<div class="ds-cm-off-zone" style="' + (usePeak ? '' : 'grid-column:1/-1;') + '">' + offZone + '</div>' +
    '<div class="ds-cm-peak-zone" style="' + (usePeak ? '' : 'display:none;') + '">' + peakZone + '</div></div>';
  var foot = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">' +
    '<span style="font-size:9px;color:#6b7280">单位：元 / 百万 tokens</span>' +
    '<span style="font-size:9px;color:#6b7280">' + (isBuiltin ? '内置模型（价格可覆盖，不可删除）' : '自定义模型') + '</span></div>';
  return '<div class="ds-cm-row" data-model="' + model + '" data-builtin="' + (isBuiltin ? '1' : '0') + '" style="' + rowStyle + '">' +
    header + pricesArea + foot + '</div>';
}
function readCustomModelRow(row) {
  var res = { offpeak: {}, peak: {} };
  var cb = row.querySelector('.ds-cm-peak');
  res.usePeakPricing = cb ? cb.checked : true;
  var inputs = row.querySelectorAll('input[data-price]');
  for (var i = 0; i < inputs.length; i++) {
    var inp = inputs[i];
    var f = inp.getAttribute('data-price');
    var v = inp.value.trim();
    var val = v === '' ? '' : parseFloat(v);
    if (v !== '' && isNaN(val)) val = '';
    var parts = f.split('.');
    res[parts[0]][parts[1]] = val;
  }
  return res;
}
function saveCustomModelRow(model, prices, isBuiltin) {
  var cm = state.settings.customModels;
  var base = PRICING[model];
  var usePeak = prices.usePeakPricing !== false;
  var sameAsBase = true;
  ['hit', 'miss', 'output'].forEach(function(f) {
    var o = prices.offpeak[f], k = prices.peak[f];
    if (o !== '' && o !== (base ? base.offpeak[f] : undefined)) sameAsBase = false;
    if (k !== '' && k !== (base ? base.peak[f] : undefined)) sameAsBase = false;
  });
  var found = -1;
  for (var i = 0; i < cm.length; i++) if (cm[i] && cm[i].model === model) { found = i; break; }
  if (isBuiltin && usePeak && sameAsBase) {
    if (found !== -1) cm.splice(found, 1);
  } else {
    var entry = { model: model, usePeakPricing: usePeak, offpeak: prices.offpeak, peak: prices.peak };
    if (found !== -1) cm[found] = entry; else cm.push(entry);
  }
  saveSettings();
  recalcAllCosts();
  refreshUI();
  if (state.chartPanelOpen) refreshChartModelSelect();
}
function onCustomModelInput(e, list) {
  var row = e.target.closest('.ds-cm-row');
  if (!row) return;
  var model = row.getAttribute('data-model');
  var isBuiltin = row.getAttribute('data-builtin') === '1';
  if (e.target.classList.contains('ds-cm-peak')) {
    var usePeak = e.target.checked;
    var prices = readCustomModelRow(row);
    var cm = state.settings.customModels;
    var found = -1;
    for (var i = 0; i < cm.length; i++) { if (cm[i] && cm[i].model === model) { found = i; break; } }
    if (found !== -1) {
      cm[found].usePeakPricing = usePeak;
      cm[found].offpeak = prices.offpeak;
      cm[found].peak = prices.peak;
    } else {
      cm.push({ model: model, usePeakPricing: usePeak, offpeak: prices.offpeak, peak: prices.peak });
    }
    saveSettings();
    var offEl = row.querySelector('.ds-cm-off-zone');
    var pkEl = row.querySelector('.ds-cm-peak-zone');
    var slider = row.querySelector('.ds-cm-slider');
    var track = e.target.parentElement ? e.target.parentElement.querySelector('span') : null;
    if (offEl) offEl.style.gridColumn = usePeak ? '' : '1/-1';
    if (pkEl) pkEl.style.display = usePeak ? '' : 'none';
    if (slider) slider.style.left = usePeak ? '19px' : '3px';
    if (track) track.style.background = usePeak ? '#2563eb' : '#374151';
    recalcAllCosts();
    refreshUI();
    if (state.chartPanelOpen) refreshChartModelSelect();
    return;
  }
  if (e.target.classList.contains('ds-cm-model')) {
    if (isBuiltin) return;
    var newModel = e.target.value.trim();
    if (!newModel) return;
    row.setAttribute('data-model', newModel);
    var cm = state.settings.customModels;
    for (var i = 0; i < cm.length; i++) { if (cm[i] && cm[i].model === model) { cm[i].model = newModel; break; } }
    saveSettings();
    fillDebugModelSelect();
    if (state.chartPanelOpen) refreshChartModelSelect();
    recalcAllCosts();
    refreshUI();
    return;
  }
  if (!e.target.getAttribute('data-price')) return;
  var prices = readCustomModelRow(row);
  saveCustomModelRow(model, prices, isBuiltin);
}
function onCustomModelClick(e, list) {
  var del = e.target;
  if (!del || del.getAttribute('data-del') !== '1') return;
  var row = del.closest('.ds-cm-row');
  if (!row || row.getAttribute('data-builtin') === '1') return;
  var model = row.getAttribute('data-model');
  var cm = state.settings.customModels;
  for (var i = 0; i < cm.length; i++) { if (cm[i] && cm[i].model === model) { cm.splice(i, 1); break; } }
  saveSettings();
  renderCustomModelsEditor();
  fillDebugModelSelect();
  if (state.chartPanelOpen) refreshChartModelSelect();
}
function renderCustomModelsEditor() {
  var p = window.parent || window;
  var doc = p.document;
  var list = doc.getElementById('ds-custom-models-list');
  if (!list) return;
  var builtin = Object.keys(PRICING);
  var cm = state.settings.customModels || [];
  var html = '';
  builtin.forEach(function(m) { html += modelEditorRowHtml(m, null, true); });
  cm.forEach(function(e) { if (e && e.model && builtin.indexOf(e.model) === -1) html += modelEditorRowHtml(e.model, e, false); });
  list.innerHTML = html;
  list.onchange = function(e) { onCustomModelInput(e, list); };
  list.onclick = function(e) { onCustomModelClick(e, list); };
  var addBtn = doc.getElementById('ds-btn-add-model');
  if (addBtn) addBtn.onclick = function() {
    var cm2 = state.settings.customModels;
    var name = 'custom-model-' + (cm2.length + 1);
    cm2.push({ model: name, usePeakPricing: true, offpeak: {}, peak: {} });
    saveSettings();
    renderCustomModelsEditor();
    fillDebugModelSelect();
    if (state.chartPanelOpen) refreshChartModelSelect();
  };
}
function renderPeakHoursEditor() {
  var p = window.parent || window;
  var doc = p.document;
  var list = doc.getElementById('ds-peak-hours-list');
  if (!list) return;
  var hours = state.settings.peakHours;
  if (!Array.isArray(hours)) hours = [];
  var inpStyle = 'flex:1;min-width:0;padding:5px 6px;border:1px solid #374151;border-radius:5px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;outline:none';
  var html = '';
  hours.forEach(function(h, i) {
    h = h || {};
    html += '<div class="ds-ph-row" data-idx="' + i + '" style="display:flex;align-items:center;gap:6px">' +
      '<span style="font-size:11px;color:#9ca3af;white-space:nowrap">开始</span>' +
      '<input type="time" data-field="start" value="' + (h.start || '') + '" style="' + inpStyle + '">' +
      '<span style="font-size:11px;color:#9ca3af;white-space:nowrap">结束</span>' +
      '<input type="time" data-field="end" value="' + (h.end || '') + '" style="' + inpStyle + '">' +
      '<button data-del="1" style="padding:5px 8px;border:1px solid #7f1d1d;border-radius:5px;background:#7f1d1d;color:#fca5a5;font-size:11px;cursor:pointer;font-family:inherit">删除</button>' +
      '</div>';
  });
  list.innerHTML = html;
  list.onchange = function(e) {
    var row = e.target.closest('.ds-ph-row');
    if (!row) return;
    var field = e.target.getAttribute('data-field');
    if (!field) return;
    var idx = parseInt(row.getAttribute('data-idx'));
    var hours2 = state.settings.peakHours;
    if (!Array.isArray(hours2)) hours2 = [];
    if (!hours2[idx]) hours2[idx] = {};
    hours2[idx][field] = e.target.value;
    state.settings.peakHours = hours2;
    saveSettings();
    recalcAllCosts();
    refreshUI();
  };
  list.onclick = function(e) {
    var del = e.target;
    if (!del || del.getAttribute('data-del') !== '1') return;
    var row = del.closest('.ds-ph-row');
    if (!row) return;
    var idx = parseInt(row.getAttribute('data-idx'));
    var hours2 = state.settings.peakHours;
    if (!Array.isArray(hours2)) hours2 = [];
    hours2.splice(idx, 1);
    if (hours2.length === 0) hours2 = JSON.parse(JSON.stringify(DEFAULT_PEAK_HOURS));
    state.settings.peakHours = hours2;
    saveSettings();
    renderPeakHoursEditor();
    recalcAllCosts();
    refreshUI();
  };
  var addBtn = doc.getElementById('ds-btn-add-peak-hour');
  if (addBtn) addBtn.onclick = function() {
    var hours2 = state.settings.peakHours;
    if (!Array.isArray(hours2)) hours2 = [];
    hours2.push({ start: '09:00', end: '12:00' });
    state.settings.peakHours = hours2;
    saveSettings();
    renderPeakHoursEditor();
  };
}
function fillDebugModelSelect() {
  var p = window.parent || window;
  var doc = p.document;
  var sel = doc.getElementById('ds-debug-model');
  if (!sel) return;
  var models = getModelList();
  var cur = state.settings.debugModel;
  if (models.indexOf(cur) === -1) { state.settings.debugModel = models[0] || 'deepseek-v4-flash'; cur = state.settings.debugModel; }
  sel.innerHTML = '';
  models.forEach(function(m) {
    var opt = doc.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
  sel.value = cur;
}
function buildChartModelSelectHtml() {
  var set = {};
  getModelList().forEach(function(m) { set[m] = 1; });
  getRecordedModels().forEach(function(m) { set[m] = 1; });
  var models = Object.keys(set).sort();
  var html = '<option value="__all__">全部模型</option>' + models.map(function(m) { return '<option value="' + m + '">' + shortModelV2(m) + '</option>'; }).join('');
  return html;
}
function refreshChartModelSelect() {
  var p = window.parent || window;
  var doc = p.document;
  var sel = doc.getElementById('ds-chart-model-select');
  if (!sel) return;
  var set = {};
  getModelList().forEach(function(m) { set[m] = 1; });
  getRecordedModels().forEach(function(m) { set[m] = 1; });
  var models = Object.keys(set);
  if (state.chartModel !== '__all__' && models.indexOf(state.chartModel) === -1) state.chartModel = '__all__';
  var html = buildChartModelSelectHtml();
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.value = state.chartModel;
  sel.onchange = function() {
    state.chartModel = sel.value;
    updateChartModelSelection();
    renderCharts();
  };
  updateChartModelSelection();
}
function initPricingEditors() {
  renderCustomModelsEditor();
  renderPeakHoursEditor();
  fillDebugModelSelect();
}

// ===== 创建主面板 UI（含 overlay、panel、header、content、floating close 按钮） =====
  function createUI() { var p = window.parent || window; var doc = p.document; if (doc.getElementById('ds-panel') && doc.getElementById('ds-overlay')) { return; } ['ds-overlay', 'ds-panel'].forEach(function(id) { var el = doc.getElementById(id); if (el) el.remove(); }); var overlay = doc.createElement('div'); overlay.id = 'ds-overlay'; overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:100000;display:block;opacity:0;pointer-events:none;transition:opacity 0.3s ease;'; overlay.addEventListener('click', function(e) { if (e.target === overlay) togglePanel(); }); var panel = doc.createElement('div'); panel.id = 'ds-panel'; panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:85vh;background:rgb(13,19,38);border-radius:12px 12px 0 0;z-index:100001;overflow:hidden;display:flex;flex-direction:column;border-top:0.5px solid rgba(55,65,81,0.35);box-sizing:border-box;transform:translate(-50%,-50%) scale(0.95);opacity:0;pointer-events:none;will-change:transform,opacity;'; var header = doc.createElement('div'); header.style.cssText = 'padding:14px 16px;background:rgb(13,19,38);border-bottom:0.5px solid rgba(55,65,81,0.35);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;'; header.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;color:#f3f4f6;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;line-height:1">DeepSeek使用预测<span style="font-size:10px;font-weight:500;color:#9ca3af;background:rgba(55,65,81,0.4);padding:2px 8px;border-radius:10px;border:0.5px solid rgba(55,65,81,0.3);line-height:1">release2.30</span><span id="ds-btn-check-update" style="font-size:11px;font-weight:500;color:#60a5fa;background:rgba(96,165,250,0.1);padding:3px 10px;border-radius:8px;border:0.5px solid rgba(96,165,250,0.25);cursor:pointer;transition:background 0.2s;line-height:1" title="检查更新">检查更新</span></div>'; var hr = doc.createElement('div'); hr.style.cssText = 'width:28px;height:28px;background:#374151;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:#9ca3af;'; hr.innerHTML = '\u2715'; hr.addEventListener('click', function(e) { e.stopPropagation(); togglePanel(); }); header.appendChild(hr); var content = doc.createElement('div'); content.id = 'ds-content'; content.style.cssText = 'flex:1;overflow-y:auto;padding:16px;background:rgb(13,19,38);font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;'; content.innerHTML = PANEL_HTML; panel.appendChild(header); panel.appendChild(content); doc.body.appendChild(overlay); var dsStyle = doc.createElement('style'); dsStyle.id = 'ds-responsive-css'; dsStyle.textContent = '@media(min-width:761px){#ds-panel{position:fixed!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%) scale(0.95)!important;opacity:0!important;pointer-events:none!important;will-change:transform,opacity!important;transition:opacity 0.25s ease,transform 0.25s ease!important;width:min(1200px,75%)!important;height:min(1400px,calc(var(--ds-vvh,95vh) - 24px))!important;max-height:min(1400px,calc(var(--ds-vvh,95vh) - 24px))!important;border-radius:12px!important;border-top:1px solid #374151!important}#ds-panel.ds-open{transform:translate(-50%,-50%) scale(1)!important;opacity:1!important;pointer-events:auto!important}}@media(max-width:760px){#ds-panel{display:flex!important;width:100vw!important;height:100vh!important;max-height:none!important;border-radius:0!important;top:0!important;border-top:1px solid #374151!important;transform:translateY(100%)!important;opacity:0!important;pointer-events:none!important;will-change:transform,opacity!important;transition:opacity 0.25s ease,transform 0.25s ease!important}#ds-panel.ds-open{display:flex!important;transform:translateY(0)!important;opacity:1!important;pointer-events:auto!important}}#ds-panel.ds-no-animation,#ds-panel.ds-no-animation.ds-open{transition:none!important}'; doc.head.appendChild(dsStyle); var dsRespCSS = doc.createElement('style'); dsRespCSS.textContent = '@media(max-width:400px){#ds-panel .ds-history-header{flex-wrap:wrap;gap:4px!important}#ds-panel .ds-history-header>div:first-child{width:100%}#ds-panel .ds-history-header>div:last-child{width:100%;justify-content:flex-end}#ds-panel .ds-model-badge{font-size:9px;padding:1px 4px!important;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#ds-panel .ds-price-type{font-size:9px;padding:0px 3px!important}#ds-panel .ds-btn-compare,#ds-panel .ds-btn-usage{font-size:9px;padding:1px 5px!important;margin-left:2px!important}}'; doc.head.appendChild(dsRespCSS);
  var dsHover = doc.createElement('style');
  dsHover.textContent = '#ds-btn-check-update:hover{background:rgba(96,165,250,0.25)!important}';
  doc.head.appendChild(dsHover); doc.body.appendChild(panel); setTimeout(function() { if (state.customBalance !== null && state.customBalance !== '') { var be = doc.getElementById('ds-balance'); var se = doc.getElementById('ds-balance-status'); if (be) be.textContent = '\u00A5' + state.customBalance + ' CNY'; if (se) se.textContent = '\u81EA\u5B9A\u4E49\u4F59\u989D'; } else if (state.balance) { var be = doc.getElementById('ds-balance'); var se = doc.getElementById('ds-balance-status'); if (be) be.textContent = '\u00A5' + state.balance.balance + ' ' + state.balance.currency; if (se) se.textContent = '\u8D26\u6237\u53EF\u7528'; } doc.getElementById('ds-btn-new-save').onclick = function() { createNewSave(); refreshUI(); }; doc.getElementById('ds-btn-delete-save').onclick = function() { if (confirm('确定删除当前存档？')) { deleteSave(state.currentSave); refreshUI(); } }; doc.getElementById('ds-btn-delete-all').onclick = function() { if (confirm('确定清空全部存档？此操作不可恢复！')) { state.saves = {}; saveSaves(); createNewSave(); refreshUI(); } }; doc.getElementById('ds-btn-refresh').onclick = function() { refreshUI(); }; doc.getElementById('ds-btn-clear').onclick = function() { var s = getSelectedSave(); if (s) { s.total_tokens = 0; s.total_cost = 0; s.input_tokens = 0; s.output_tokens = 0; s.cache_hit_tokens = 0; s.cache_miss_tokens = 0; s.input_cost = 0; s.output_cost = 0; s.rounds = 0; s.history = []; saveSaves(); refreshUI(); } }; doc.getElementById('ds-btn-query-balance').onclick = function() { queryBalance(); }; doc.getElementById('ds-btn-settings').onclick = function() { toggleSettings(); };
doc.getElementById('ds-save-select').onchange = function(e) { state.currentSave = e.target.value; saveCurrentSaveKey(); refreshUI(); };       
      doc.getElementById('ds-btn-charts').onclick = function() { toggleCharts(); };
      var omSel = doc.getElementById('ds-overview-model');
      if (omSel) { omSel.onchange = function() { state.overviewModel = omSel.value; refreshUI(); }; }
      var expBtn = doc.getElementById('ds-btn-export');
      if (expBtn) { expBtn.onclick = function() { exportHistory(); }; }
      var impBtn = doc.getElementById('ds-btn-import');
      if (impBtn) { impBtn.onclick = function() { importHistory(); }; }
      updateChartModelSelection();
      refreshSaveSelect();
      refreshUI();
    }, 100); 
  var dsFB = doc.createElement('div');
  dsFB.id = 'ds-floating-close';
  dsFB.style.cssText = 'position:absolute;right:4px;bottom:60px;width:32px;height:32px;background:#1e293b;border:1px solid #374151;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:#9ca3af;z-index:1;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  dsFB.innerHTML = '\u2715';
  dsFB.title = '\u5173\u95ED\u9762\u677F';
  dsFB.addEventListener('click', function(e) { e.stopPropagation(); togglePanel(); });
  panel.appendChild(dsFB);
  var dsCO = doc.createElement('div');
  dsCO.id = 'ds-compare-overlay';
  dsCO.className = 'ds-compare-overlay'; dsCO.style.zIndex = '999999';
  dsCO.innerHTML = '<div class="ds-compare-panel"><div class="ds-compare-header" style="padding:16px 20px"><span style="flex:1;text-align:center">🔍 消息差异对比</span><div id="ds-compare-close" style="width:28px;height:28px;background:#374151;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:#9ca3af;flex-shrink:0;margin-left:auto">✕</div></div><div class="ds-compare-body" id="ds-compare-body"></div></div>';
  dsCO.addEventListener('click', function(e) { if (e.target === dsCO) closeComparePanel(); });
  doc.body.appendChild(dsCO);
  doc.getElementById('ds-compare-close').addEventListener('click', closeComparePanel);
  createPeakDot();
  doc.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeComparePanel(); });
  doc.addEventListener('click', function(e) { var t = e.target; if (t.classList.contains('ds-btn-compare-old')) { window._dsHandleCompare(t, 'old'); } else if (t.classList.contains('ds-btn-compare-new')) { window._dsHandleCompare(t, 'new'); } else if (t.classList.contains('ds-btn-usage')) { var ts=parseInt(t.getAttribute('data-ts')); var s=getSelectedSave(); var entry=null; if(s&&s.history){for(var hi=0;hi<s.history.length;hi++){if(s.history[hi].timestamp===ts){entry=s.history[hi];break;}}} if(entry){showUsageDetail(entry.model,{timestamp:entry.timestamp,model:entry.model,prompt_tokens:entry.prompt_tokens,cache_hit_tokens:entry.cache_hit_tokens,cache_miss_tokens:entry.cache_miss_tokens,completion_tokens:entry.completion_tokens,total_tokens:entry.total_tokens,input_cost:entry.input_cost,output_cost:entry.output_cost,cost:entry.cost,priceType:entry.priceType,raw_usage:entry.raw_usage,fullRequest:entry.fullRequest,fullResponse:entry.fullResponse,messages:entry.messages,duration:entry.duration,ttft:entry.ttft,thinkTime:entry.thinkTime,thinkTokens:entry.thinkTokens,tokenRate:entry.tokenRate});} } });
}
  
  // ===== 峰值提示小圆点（高峰红色 / 临近高峰黄色 / 非高峰绿色，可拖动并记忆位置） =====
  var PEAK_DOT_POS_KEY = 'ds_peak_dot_pos';
  var _ds_peak_dot_dragging = false;
  function loadPeakDotPos() { try { var v = loadFromLS(PEAK_DOT_POS_KEY); if (v) { var o = JSON.parse(v); if (o && typeof o.top === 'number' && typeof o.left === 'number') return o; } } catch(e) {} return null; }
  function savePeakDotPos(o) { try { localStorage.setItem('ds_' + PEAK_DOT_POS_KEY, JSON.stringify(o)); } catch(e) {} }
  function getPeakDotStatus(now) {
    now = now || Date.now();
    var hours = (state.settings && state.settings.peakHours) || DEFAULT_PEAK_HOURS;
    if (isPeakHour(now)) return { color: '#ef4444', label: '当前为高峰时段（价格上调）' };
    var d = new Date(now);
    var totalMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 8 * 60) % 1440;
    var nearest = 1440;
    for (var i = 0; i < hours.length; i++) {
      var h = hours[i];
      if (!h || !h.start) continue;
      var p = h.start.split(':');
      var sp = parseInt(p[0]) * 60 + parseInt(p[1] || 0);
      var diff = sp - totalMinutes;
      if (diff < 0) diff += 1440;
      if (diff < nearest) nearest = diff;
    }
    if (nearest <= 10) return { color: '#eab308', label: '距离高峰开始约 ' + nearest + ' 分钟' };
    return { color: '#22c55e', label: '当前为非高峰时段' };
  }
  function isTavernMainPage() {
    try {
      var p = window.parent || window;
      var path = (p.location.pathname || '').split('/').pop();
      if (!path || path === '/' || path === 'index.html') return true;
      return false;
    } catch(e) { return true; }
  }
  function updatePeakDot() {
    var p = window.parent || window;
    var doc = p.document;
    var dot = doc.getElementById('ds-peak-dot-indicator');
    if (!dot) return;
    if (!isTavernMainPage()) { dot.style.display = 'none'; return; }
    if (!state.settings || state.settings.peakDot === false) { dot.style.display = 'none'; return; }
    dot.style.display = 'block';
    var st = getPeakDotStatus();
    dot.style.background = st.color;
    dot.style.boxShadow = '0 0 8px ' + st.color;
    dot.title = 'DeepSeek · ' + st.label;
  }
  function resetPeakDot() {
    try { localStorage.removeItem('ds_' + PEAK_DOT_POS_KEY); } catch(e) {}
    var p = window.parent || window;
    var doc = p.document;
    var dot = doc.getElementById('ds-peak-dot-indicator');
    if (!dot) return;
    var topBar = doc.getElementById('top-bar');
    var defaultTop = (topBar && topBar.offsetHeight ? topBar.offsetHeight : 52) + 8;
    dot.style.left = '';
    dot.style.top = defaultTop + 'px';
    dot.style.right = '16px';
    updatePeakDot();
  }
  function createPeakDot() {
    var p = window.parent || window;
    var doc = p.document;
    if (doc.getElementById('ds-peak-dot-indicator')) return;
    var dot = doc.createElement('div');
    dot.id = 'ds-peak-dot-indicator';
    dot.style.cssText = 'position:fixed;width:18px;height:18px;border-radius:50%;z-index:3000;cursor:grab;opacity:0.75;border:2px solid rgba(0,0,0,0.35);transition:opacity 0.2s,box-shadow 0.3s;user-select:none;-webkit-user-select:none;touch-action:none;';
    var saved = loadPeakDotPos();
    var topBar = doc.getElementById('top-bar');
    var defaultTop = (topBar && topBar.offsetHeight ? topBar.offsetHeight : 52) + 8;
    if (saved) {
      dot.style.left = saved.left + 'px';
      dot.style.top = saved.top + 'px';
    } else {
      dot.style.right = '16px';
      dot.style.top = defaultTop + 'px';
    }
    dot.addEventListener('mouseenter', function() { dot.style.opacity = '1'; });
    dot.addEventListener('mouseleave', function() { if (!_ds_peak_dot_dragging) dot.style.opacity = '0.75'; });
    function startDrag(e) {
      if (!state.settings || state.settings.peakDot === false) return;
      _ds_peak_dot_dragging = true;
      dot.style.opacity = '1';
      dot.style.cursor = 'grabbing';
      var pt = (e.touches && e.touches.length) ? e.touches[0] : e;
      var baseRect = dot.getBoundingClientRect();
      var startLeft = baseRect.left;
      var startTop = baseRect.top;
      var startX = pt.clientX;
      var startY = pt.clientY;
      var edgeMargin = 12;
      function move(ev) {
        var vw = p.innerWidth || doc.documentElement.clientWidth;
        var vh = p.innerHeight || doc.documentElement.clientHeight;
        var nx = startLeft + (ev.clientX - startX);
        var ny = startTop + (ev.clientY - startY);
        nx = Math.max(edgeMargin, Math.min(nx, vw - dot.offsetWidth - edgeMargin));
        ny = Math.max(edgeMargin, Math.min(ny, vh - dot.offsetHeight - edgeMargin));
        dot.style.left = nx + 'px';
        dot.style.top = ny + 'px';
        dot.style.right = 'auto';
      }
      function tmove(ev) { ev.preventDefault(); move(ev.touches[0]); }
      function up() {
        _ds_peak_dot_dragging = false;
        dot.style.cursor = 'grab';
        dot.style.opacity = '0.75';
        p.removeEventListener('mousemove', move);
        p.removeEventListener('mouseup', up);
        p.removeEventListener('touchmove', tmove);
        p.removeEventListener('touchend', up);
        savePeakDotPos({ left: parseInt(dot.style.left) || 0, top: parseInt(dot.style.top) || 0 });
      }
      p.addEventListener('mousemove', move);
      p.addEventListener('mouseup', up);
      p.addEventListener('touchmove', tmove, { passive: false });
      p.addEventListener('touchend', up);
      e.preventDefault();
      e.stopPropagation();
    }
    dot.addEventListener('mousedown', startDrag);
    dot.addEventListener('touchstart', startDrag, { passive: false });
    doc.body.appendChild(dot);
    updatePeakDot();
    if (state.settings && state.settings.peakDot !== false) {
      try {
        var hinted = loadFromLS('peak_dot_hinted');
        if (!hinted) {
          saveToLS('peak_dot_hinted', '1');
          setTimeout(function() { try { (window.parent || window).toastr.info('峰值提示小圆点已显示在酒馆右上角（顶栏下方），拖动可移动，可在设置中关闭'); } catch(e) {} }, 500);
        }
      } catch(e) {}
    }
  }

  // ===== 刷新存档下拉选择器 =====
  function refreshSaveSelect() { var p = window.parent || window; var doc = p.document; var select = doc.getElementById('ds-save-select'); if (!select) return; var html = '<option value="__all__"' + (state.currentSave === '__all__' ? ' selected' : '') + '>全部存档 (合并统计)</option>'; Object.keys(state.saves).sort(function(a, b) { return (state.saves[b].startTime || 0) - (state.saves[a].startTime || 0); }).forEach(function(k) { var s = state.saves[k]; html += '<option value="' + k + '"' + (k === state.currentSave ? ' selected' : '') + '>' + s.name + ' (' + (s.rounds || 0) + '轮)</option>'; }); select.innerHTML = html; }

// ===== 加载 Chart.js 图表库（多 CDN 后备） =====
function loadChartLib(callback) {
  if (typeof Chart !== 'undefined') { state.chartLibLoaded = true; if (callback) callback(); return; }
  if (window.parent && typeof window.parent.Chart !== 'undefined') {
    window.Chart = window.parent.Chart;
    state.chartLibLoaded = true; if (callback) callback(); return;
  }
  var cdnList = [
    'https://cdn.jsdelivr.net/npm/chart.js@5/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
    'https://unpkg.com/chart.js@5/dist/chart.umd.min.js'
  ];
  var pluginCdnList = [
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2/dist/chartjs-plugin-zoom.min.js',
    'https://unpkg.com/chartjs-plugin-zoom@2/dist/chartjs-plugin-zoom.min.js'
  ];
  var cdnIdx = 0;
  var pluginCdnIdx = 0;
  var loadingPlugin = false;
  function tryNextCdn() {
    if (loadingPlugin) {
      if (pluginCdnIdx < pluginCdnList.length) {
        loadScript(pluginCdnList[pluginCdnIdx++], true);
      } else {
        state.chartLibLoaded = true;
        if (callback) callback();
      }
      return;
    }
    if (cdnIdx < cdnList.length) {
      loadScript(cdnList[cdnIdx++], false);
    } else {
      if (window.parent && typeof window.parent.Chart !== 'undefined') {
        window.Chart = window.parent.Chart;
        state.chartLibLoaded = true;
        if (callback) callback();
      } else {
        state.chartLibLoaded = true;
        if (callback) callback();
      }
    }
  }
  // 动态创建 script 标签加载，失败时自动切换到下一个 CDN
  function loadScript(url, isPlugin) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function() {
      if (!loadingPlugin && (typeof Chart !== 'undefined')) {
        loadingPlugin = true;
        loadScript(pluginCdnList[pluginCdnIdx++], true);
      } else if (loadingPlugin) {
        state.chartLibLoaded = true;
        if (callback) callback();
      } else {
        tryNextCdn();
      }
    };
    s.onerror = function() { tryNextCdn(); };
    document.head.appendChild(s);
  }
  tryNextCdn();
}// ===== 切换图表面板开启/关闭 =====
function toggleCharts() {
  if (!isInitDone) return;
  var p = window.parent || window;
  var ov = p.document.getElementById('ds-chart-overlay');
  var pn = p.document.getElementById('ds-chart-panel');
  if (!ov || !pn) { createChartUI(); state.chartPanelOpen = true; refreshChartModelSelect(); ov = p.document.getElementById('ds-chart-overlay'); pn = p.document.getElementById('ds-chart-panel'); if (ov) ov.style.display = 'block'; if (pn) pn.classList.add('ds-open'); renderCharts(); return; }
  if (state.chartPanelOpen) {
    ov.style.display = 'none';
    pn.classList.remove('ds-open');
    state.chartPanelOpen = false;
  } else {
    ov.style.display = 'block';
    pn.classList.add('ds-open');
    state.chartPanelOpen = true;state.chartPanelOpen = true;
    renderCharts();
  }
}

// ===== 关闭图表面板 =====
function closeCharts() {
  var p = window.parent || window;
  var ov = p.document.getElementById('ds-chart-overlay');
  var pn = p.document.getElementById('ds-chart-panel');
  if (ov) ov.style.display = 'none';
  if (pn) pn.classList.remove('ds-open');
  state.chartPanelOpen = false;
}

// ===== 创建图表统计面板 UI =====
function createChartUI() {
  if (state.chartPanelCreated) return;
  state.chartPanelCreated = true;
  var p = window.parent || window;
  var doc = p.document;
  var overlay = doc.createElement('div');
  overlay.id = 'ds-chart-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:200000;display:none;';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeCharts(); });
  var panel = doc.createElement('div');
  panel.id = 'ds-chart-panel';
  panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:90vh;background:#080d14;border-radius:12px 12px 0 0;z-index:200001;overflow:hidden;display:flex;flex-direction:column;border-top:1px solid #374151;box-sizing:border-box;';
  panel.innerHTML = '<div style="padding:12px 16px;background:#080d14;border-bottom:1px solid #374151;display:flex;justify-content:space-between;align-items:center;flex-shrink:0"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px;font-weight:600;color:#f3f4f6;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif">统计详情</span><select id="ds-chart-model-select" style="margin-left:8px;padding:1px 6px;border:1px solid #374151;border-radius:6px;background:#0e1520;color:#e5e7eb;font-size:11px;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;cursor:pointer;vertical-align:middle;align-self:center;line-height:normal;height:22px;box-sizing:border-box;position:relative;top:3px"></select></div><div style="display:flex;align-items:center;gap:8px"><button id="ds-btn-chart-reset" style="padding:4px 8px;border:1px solid #374151;border-radius:4px;background:#0e1520;color:#9ca3af;font-size:11px;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif">重置缩放</button><div id="ds-btn-chart-help" style="width:24px;height:24px;background:#1e293b;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#9ca3af;font-weight:700;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif">?</div><div id="ds-btn-close-charts" style="width:28px;height:28px;background:#374151;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:#9ca3af">✕</div></div></div><div id="ds-chart-body" style="flex:1;overflow-y:auto;padding:12px 16px 24px;background:#060a10;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif">' +
    '<div id="ds-chart-help" style="display:none;margin-bottom:12px;padding:12px 14px;background:#0e1520;border:1px solid #374151;border-radius:8px;font-size:12px;color:#9ca3af;line-height:1.7;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"><div style="font-size:13px;color:#e5e7eb;font-weight:600;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1f2937">操作说明</div><div style="margin-bottom:8px"><span style="color:#60a5fa;font-weight:500">🖱️ 键鼠操作：</span>滚轮缩放，鼠标选中缩放，拖拽底部滑块沿X轴移动，按住滑块任意一边拖动缩放</div><div style="margin-bottom:8px"><span style="color:#60a5fa;font-weight:500">📱 触屏操作：</span>按住滑块任意一边拖动缩放 · 拖拽底部滑块沿X轴移动</div><div style="margin-bottom:8px"><span style="color:#60a5fa;font-weight:500">📊 图例切换：</span>点击图例名称可显示/隐藏对应数据系列</div><div style="margin-bottom:8px"><span style="color:#60a5fa;font-weight:500">🔄 模型切换：</span>左上角下拉切换模型（全部模型 / 单个模型）查看不同模型的统计数据</div><div><span style="color:#60a5fa;font-weight:500">↩️ 重置视图：</span>点击「重置缩放」按钮恢复默认缩放状态</div></div>' +
    '<div id="ds-chart-loading" style="text-align:center;padding:40px;color:#6b7280;font-size:13px">正在加载图表，可能需要较长时间，请保证良好网络环境，耐心等待...</div>' +
    '<div id="ds-chart-container" style="display:none"><div id="ds-model-summary" style="margin-bottom:16px;padding:12px;background:#0e1520;border:1px solid #374151;border-radius:8px;overflow-x:auto"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px">模型汇总</div><table style="width:100%;border-collapse:collapse;font-size:11px;color:#e5e7eb"><thead><tr style="color:#6b7280;border-bottom:1px solid #374151"><th style="text-align:left;padding:6px 8px;white-space:nowrap">模型</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">调用次数</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">输入(命中)</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">输入(未命中)</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">输出</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">总Token</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">总成本</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">平均成本</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">平均耗时</th><th style="text-align:right;padding:6px 8px;white-space:nowrap">平均速率</th></tr></thead><tbody id="ds-summary-tbody"><tr><td colspan="10" style="text-align:center;padding:20px;color:#6b7280">加载中...</td></tr></tbody></table></div><div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px">Token 使用量热力图<span id="ds-heatmap-legend" style="display:inline-flex;align-items:center;gap:3px;margin-left:8px;font-size:10px;color:#6b7280"></span></div><div style="display:flex"><div id="ds-heatmap-labels" style="flex-shrink:0;padding:4px 0"></div><div id="ds-heatmap-scroll" style="overflow-x:auto;padding:4px 0;cursor:pointer;flex:1;min-width:0"><div id="ds-heatmap-container" style="display:inline-block;min-width:100%"></div></div></div></div><div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">图1 · Token 趋势<span id="ds-toggle-token" style="font-size:10px;padding:2px 7px;border-radius:3px;background:#374151;color:#9ca3af;cursor:pointer">轮次</span><select id="ds-month-token" style="font-size:11px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#93c5fd;border:1px solid #6366f1;display:none;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"></select></div><div style="position:relative;height:40vh;min-height:280px"><canvas id="ds-chart-token"></canvas></div><div id="ds-slider-token-track" class="ds-chart-slider-track" style="margin:0"><div id="ds-slider-token-thumb" class="ds-chart-slider-thumb"><div class="ds-slider-handle ds-slider-handle-left"></div><div class="ds-slider-handle ds-slider-handle-right"></div></div></div><div id="ds-slider-token-label" class="ds-chart-slider-label"></div></div>' +
      '<div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">图2 · 费用趋势<span id="ds-toggle-cost" style="font-size:10px;padding:2px 7px;border-radius:3px;background:#374151;color:#9ca3af;cursor:pointer">轮次</span><select id="ds-month-cost" style="font-size:11px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#93c5fd;border:1px solid #6366f1;display:none;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"></select></div><div style="position:relative;height:40vh;min-height:280px"><canvas id="ds-chart-cost"></canvas></div><div id="ds-slider-cost-track" class="ds-chart-slider-track" style="margin:0"><div id="ds-slider-cost-thumb" class="ds-chart-slider-thumb"><div class="ds-slider-handle ds-slider-handle-left"></div><div class="ds-slider-handle ds-slider-handle-right"></div></div></div><div id="ds-slider-cost-label" class="ds-chart-slider-label"></div></div>' +
      '<div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">图3 · 缓存命中率趋势<span id="ds-toggle-rate" style="font-size:10px;padding:2px 7px;border-radius:3px;background:#374151;color:#9ca3af;cursor:pointer">轮次</span><select id="ds-month-rate" style="font-size:11px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#93c5fd;border:1px solid #6366f1;display:none;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"></select></div><div style="position:relative;height:40vh;min-height:280px"><canvas id="ds-chart-rate"></canvas></div><div id="ds-slider-rate-track" class="ds-chart-slider-track" style="margin:0"><div id="ds-slider-rate-thumb" class="ds-chart-slider-thumb"><div class="ds-slider-handle ds-slider-handle-left"></div><div class="ds-slider-handle ds-slider-handle-right"></div></div></div><div id="ds-slider-rate-label" class="ds-chart-slider-label"></div></div>' +
      '<div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">图4 · API请求次数趋势<select id="ds-month-requests" style="font-size:11px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#93c5fd;border:1px solid #6366f1;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"></select></div><div style="position:relative;height:40vh;min-height:280px"><canvas id="ds-chart-requests"></canvas></div><div id="ds-slider-requests-track" class="ds-chart-slider-track" style="margin:0"><div id="ds-slider-requests-thumb" class="ds-chart-slider-thumb"><div class="ds-slider-handle ds-slider-handle-left"></div><div class="ds-slider-handle ds-slider-handle-right"></div></div></div><div id="ds-slider-requests-label" class="ds-chart-slider-label"></div></div>' +
      '<div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">图5 · 耗时与速率趋势<span id="ds-toggle-duration" style="font-size:10px;padding:2px 7px;border-radius:3px;background:#374151;color:#9ca3af;cursor:pointer">轮次</span><select id="ds-month-duration" style="font-size:11px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#93c5fd;border:1px solid #6366f1;display:none;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"></select></div><div style="position:relative;height:40vh;min-height:280px"><canvas id="ds-chart-duration"></canvas></div><div id="ds-slider-duration-track" class="ds-chart-slider-track" style="margin:0"><div id="ds-slider-duration-thumb" class="ds-chart-slider-thumb"><div class="ds-slider-handle ds-slider-handle-left"></div><div class="ds-slider-handle ds-slider-handle-right"></div></div></div><div id="ds-slider-duration-label" class="ds-chart-slider-label"></div></div>' +
    '</div>' +
      '<div style="margin-bottom:20px"><div style="font-size:12px;color:#9ca3af;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">图7 · 模型用量占比<span id="ds-toggle-modeltokens" style="display:inline-flex;font-size:10px;padding:2px 4px;border-radius:4px;background:#1e293b;border:1px solid #374151;overflow:hidden;cursor:pointer;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"><span id="ds-mode-btn-token" style="padding:2px 8px;color:#93c5fd;background:#1e1b4b">Token</span><span id="ds-mode-btn-count" style="padding:2px 8px;color:#9ca3af">次数</span></span></div><div style="position:relative;height:40vh;min-height:280px;max-width:500px;margin:0 auto"><canvas id="ds-chart-modeltokens"></canvas></div></div>' +

  '</div>';
  var dsCFB = doc.createElement('div');
  dsCFB.id = 'ds-chart-floating-close';
  dsCFB.style.cssText = 'position:absolute;right:4px;bottom:60px;width:32px;height:32px;background:#1e293b;border:1px solid #374151;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:#9ca3af;z-index:1;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  dsCFB.innerHTML = '\u2715';
  dsCFB.title = '\u5173\u95ED\u56FE\u8868\u9762\u677F';
  dsCFB.addEventListener('click', function(e) { e.stopPropagation(); closeCharts(); });
  panel.appendChild(dsCFB);
  doc.body.appendChild(overlay);
  doc.body.appendChild(panel);
  var dsStyle = doc.createElement('style');
  dsStyle.id = 'ds-chart-responsive-css';
  dsStyle.textContent = '@media(min-width:761px){#ds-chart-panel{position:fixed!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%) scale(0.95)!important;opacity:0!important;pointer-events:none!important;transition:opacity 0.2s ease,transform 0.2s ease!important;width:min(1200px,80%)!important;height:min(1400px,calc(100vh - 24px))!important;max-height:min(1400px,calc(100vh - 24px))!important;border-radius:12px!important;border-top:1px solid #374151!important}#ds-chart-panel.ds-open{transform:translate(-50%,-50%) scale(1)!important;opacity:1!important;pointer-events:auto!important}}@media(max-width:760px){#ds-chart-panel{display:flex!important;width:100vw!important;height:100vh!important;max-height:none!important;border-radius:0!important;top:0!important;border-top:1px solid #374151!important;transform:translateY(100%)!important;opacity:0!important;pointer-events:none!important;transition:opacity 0.2s ease,transform 0.2s ease!important}#ds-chart-panel.ds-open{display:flex!important;transform:translateY(0)!important;opacity:1!important;pointer-events:auto!important}}';
  doc.head.appendChild(dsStyle);
  doc.getElementById('ds-btn-close-charts').onclick = closeCharts;
  doc.getElementById('ds-btn-chart-help').addEventListener('click', function() { console.log('[DS Chart] Help clicked'); var he = doc.getElementById('ds-chart-help'); if (he) { console.log('[DS Chart] Help el found, current display:', he.style.display); he.style.display = he.style.display === 'none' ? 'block' : 'none'; console.log('[DS Chart] New display:', he.style.display); } else { console.log('[DS Chart] Help el NOT FOUND'); } });
  doc.getElementById('ds-btn-chart-reset').onclick = function() { resetChartZoom(); };
  ['token','cost','rate','duration'].forEach(function(k) {
    var el = doc.getElementById('ds-toggle-' + k);
    if (el) el.addEventListener('click', function() {
      _chartDayMode[k] = !_chartDayMode[k];
      el.textContent = _chartDayMode[k] ? '日期' : '轮次';
      el.style.background = _chartDayMode[k] ? '#6366f1' : '#374151';
      el.style.color = _chartDayMode[k] ? '#fff' : '#9ca3af';
      if (!_chartDayMode[k]) { _chartMonthIdx[k] = -1; }
      renderCharts();
    });
  });
  ['token','cost','rate','requests','duration'].forEach(function(k) {
    var sel = doc.getElementById('ds-month-' + k);
    if (sel) sel.addEventListener('change', function() { selectMonth(k, this.value); });
  });
  var mtb = doc.getElementById('ds-toggle-modeltokens');
  if (mtb) mtb.addEventListener('click', function() {
    _chartModelUsageMode = _chartModelUsageMode === 'token' ? 'count' : 'token';
    var tBtn = doc.getElementById('ds-mode-btn-token');
    var cBtn = doc.getElementById('ds-mode-btn-count');
    if (tBtn) { tBtn.style.background = _chartModelUsageMode === 'token' ? '#1e1b4b' : 'transparent'; tBtn.style.color = _chartModelUsageMode === 'token' ? '#93c5fd' : '#9ca3af'; }
    if (cBtn) { cBtn.style.background = _chartModelUsageMode === 'count' ? '#1e1b4b' : 'transparent'; cBtn.style.color = _chartModelUsageMode === 'count' ? '#93c5fd' : '#9ca3af'; }
    renderCharts();
  });
}


  // ===== 设置窗口内容模板（迁移自原主面板设置菜单） =====
  var SETTINGS_PANEL_HTML = "<div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px\">设置</div><div style=\"display:flex;flex-direction:column;gap:10px\"><div style=\"margin-bottom:2px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px\">API密钥</div><div style=\"display:flex;gap:6px\"><input id=\"ds-api-key\" type=\"password\" placeholder=\"输入DeepSeek API密钥\" style=\"flex:1;padding:8px 10px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:13px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"><button id=\"ds-btn-save-key\" style=\"padding:8px 12px;border:1px solid #374151;border-radius:6px;background:#374151;color:#e5e7eb;font-size:12px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap\">保存</button></div></div><div style=\"border-top:1px solid #374151;padding-top:10px\"><div style=\"display:flex;align-items:center;justify-content:space-between\"><span style=\"font-size:13px;color:#e5e7eb;font-weight:500\">自动校准余额</span><label style=\"position:relative;display:inline-block;width:44px;height:24px;cursor:pointer\"><input type=\"checkbox\" id=\"ds-auto-balance\" style=\"opacity:0;width:0;height:0\"><span style=\"position:absolute;top:0;left:0;right:0;bottom:0;background:#374151;border-radius:12px;transition:0.3s;cursor:pointer\"><span id=\"ds-auto-balance-slider\" style=\"position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:white;border-radius:50%;transition:0.3s\"></span></span></label></div><div id=\"ds-auto-balance-interval\" style=\"display:none;margin-top:8px\"><div style=\"display:flex;align-items:center;justify-content:space-between\"><span style=\"font-size:13px;color:#e5e7eb;font-weight:500\">校准间隔</span><div style=\"display:flex;align-items:center;gap:8px\"><input type=\"number\" id=\"ds-balance-interval\" min=\"1\" max=\"100\" value=\"10\" style=\"width:60px;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:13px;text-align:center;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"><span style=\"font-size:12px;color:#9ca3af\">条消息</span></div></div></div></div><div style=\"border-top:1px solid #374151;padding-top:10px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px\">自定义余额</div><div style=\"font-size:12px;color:#6b7280;margin-bottom:8px\">手动设置余额，设置后将覆盖API查询值</div><div style=\"display:flex;gap:6px\"><input id=\"ds-custom-balance\" type=\"number\" step=\"0.01\" placeholder=\"输入余额金额\" style=\"flex:1;padding:8px 10px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:13px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"><button id=\"ds-btn-save-balance\" style=\"padding:8px 12px;border:1px solid #065f46;border-radius:6px;background:#065f46;color:#6ee7b7;font-size:12px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap\">保存</button><button id=\"ds-btn-clear-balance\" style=\"padding:8px 12px;border:1px solid #7f1d1d;border-radius:6px;background:#7f1d1d;color:#fca5a5;font-size:12px;font-weight:500;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap\">清除</button></div><div id=\"ds-custom-balance-status\" style=\"font-size:11px;color:#6b7280;margin-top:4px\"></div></div></div><div style=\"border-top:1px solid #374151;padding-top:10px\"><div style=\"display:flex;align-items:center;justify-content:space-between\"><span style=\"font-size:13px;color:#e5e7eb;font-weight:500\">新价格机制</span><label style=\"position:relative;display:inline-block;width:44px;height:24px;cursor:pointer\"><input type=\"checkbox\" id=\"ds-use-new-pricing\" style=\"opacity:0;width:0;height:0\"><span style=\"position:absolute;top:0;left:0;right:0;bottom:0;background:#374151;border-radius:12px;transition:0.3s;cursor:pointer\"><span id=\"ds-use-new-pricing-slider\" style=\"position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:white;border-radius:50%;transition:0.3s\"></span></span></label></div><div id=\"ds-new-pricing-panel\" style=\"display:none;margin-top:8px\"><div style=\"display:flex;align-items:center;gap:6px;margin-bottom:6px\"><span style=\"font-size:11px;color:#6b7280;white-space:nowrap\">生效日期</span><input type=\"date\" id=\"ds-new-pricing-date\" style=\"flex:1;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"><button id=\"ds-btn-pricing-today\" style=\"padding:4px 8px;border:1px solid #374151;border-radius:4px;background:#0e1520;color:#60a5fa;font-size:11px;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif;white-space:nowrap\">今天</button></div><div style=\"font-size:10px;color:#6b7280;line-height:1.5\"><div style=\"font-weight:500;color:#9ca3af;margin-bottom:4px\">高峰时段（北京时间）</div><div>结束时间早于开始时间视为跨天（如 22:00~次日02:00）</div></div><div id=\"ds-peak-hours-list\" style=\"margin-top:6px;display:flex;flex-direction:column;gap:4px\"></div><div style=\"display:flex;justify-content:flex-end;margin-top:6px\"><button id=\"ds-btn-add-peak-hour\" style=\"padding:4px 10px;border:1px solid #374151;border-radius:5px;background:#0e1520;color:#60a5fa;font-size:11px;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">＋ 添加时段</button></div><div style=\"font-size:10px;color:#6b7280;margin-top:4px\">该时间之前的请求统一使用旧价格</div><div id=\"ds-new-pricing-status\" style=\"font-size:11px;color:#6b7280;margin-top:4px\"></div></div></div><div style=\"border-top:1px solid #374151;padding-top:10px\"><div style=\"display:flex;align-items:center;justify-content:space-between\"><span style=\"font-size:13px;color:#e5e7eb;font-weight:500\">峰值提示小圆点</span><label style=\"position:relative;display:inline-block;width:44px;height:24px;cursor:pointer\"><input type=\"checkbox\" id=\"ds-peak-dot\" style=\"opacity:0;width:0;height:0\"><span style=\"position:absolute;top:0;left:0;right:0;bottom:0;background:#374151;border-radius:12px;transition:0.3s;cursor:pointer\"><span id=\"ds-peak-dot-slider\" style=\"position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:white;border-radius:50%;transition:0.3s\"></span></span></label></div><div style=\"font-size:11px;color:#6b7280;margin-top:6px;line-height:1.6\">在酒馆右上角显示高峰提示小圆点：高峰时段红色、临近高峰(10分钟内)黄色、非高峰绿色，可拖动并记忆位置</div><div style=\"display:flex;align-items:center;gap:6px;margin-top:8px\"><button id=\"ds-btn-reset-peak-dot\" style=\"padding:4px 10px;border:1px solid #374151;border-radius:5px;background:#0e1520;color:#60a5fa;font-size:11px;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">重置位置</button><span style=\"font-size:10px;color:#6b7280\">将圆点恢复至右上角默认位置</span></div></div><div style=\"border-top:1px solid #374151;padding-top:10px\"><div style=\"font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px\">模型与价格</div><div style=\"font-size:11px;color:#6b7280;line-height:1.6;margin-bottom:6px\">模型名需与 API 返回的 model 一致；价格为 ¥/百万 tokens；留空则回落内置价格，内置模型不可删除。</div><div id=\"ds-custom-models-list\" style=\"display:flex;flex-direction:column;gap:6px\"></div><div style=\"display:flex;justify-content:flex-end;margin-top:6px\"><button id=\"ds-btn-add-model\" style=\"padding:4px 10px;border:1px solid #374151;border-radius:5px;background:#0e1520;color:#60a5fa;font-size:11px;cursor:pointer;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">＋ 添加模型</button></div></div><div style=\"border-top:1px solid #374151;padding-top:10px\"><div style=\"display:flex;align-items:center;justify-content:space-between\"><span style=\"font-size:13px;color:#e5e7eb;font-weight:500\">调试模式</span><label style=\"position:relative;display:inline-block;width:44px;height:24px;cursor:pointer\"><input type=\"checkbox\" id=\"ds-debug-mode\" style=\"opacity:0;width:0;height:0\"><span style=\"position:absolute;top:0;left:0;right:0;bottom:0;background:#374151;border-radius:12px;transition:0.3s;cursor:pointer\"><span id=\"ds-debug-mode-slider\" style=\"position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:white;border-radius:50%;transition:0.3s\"></span></span></label></div><div id=\"ds-debug-panel\" style=\"display:none;margin-top:8px\"><div style=\"font-size:11px;color:#6b7280;margin-bottom:8px\">\u6A21\u62DF\u5355\u6B21\u5BF9\u8BDD\u7684token\u6D88\u8017\u53C2\u6570\uFF0C\u4E0D\u4F1A\u4EA7\u751FAPI\u8D39\u7528</div><div style=\"display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px\"><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">\u7F13\u5B58\u547D\u4E2D tokens</div><input id=\"ds-debug-hit\" type=\"number\" min=\"0\" value=\"10000\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></div><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">\u7F13\u5B58\u672A\u547D\u4E2D tokens</div><input id=\"ds-debug-miss\" type=\"number\" min=\"0\" value=\"5000\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></div><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">\u8F93\u51FA tokens</div><input id=\"ds-debug-output\" type=\"number\" min=\"0\" value=\"2000\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></div><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">\u6A21\u578B</div><select id=\"ds-debug-model\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></select></div></div><div style=\"margin-top:6px;padding-top:6px;border-top:1px solid #374151\"><div style=\"font-size:11px;color:#6b7280;margin-bottom:6px\">批量生成历史数据（用于测试图表）</div><div style=\"display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px\"><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">起始日期</div><input id=\"ds-debug-date-start\" type=\"date\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></div><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">结束日期</div><input id=\"ds-debug-date-end\" type=\"date\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></div></div><div style=\"display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px\"><div><div style=\"font-size:10px;color:#9ca3af;margin-bottom:2px\">每日生成条数</div><input id=\"ds-debug-batch-count\" type=\"number\" min=\"1\" max=\"100\" value=\"1\" style=\"width:100%;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#080d14;color:#e5e7eb;font-size:12px;font-family:'Microsoft YaHei','微软雅黑',sans-serif;outline:none\"></div><div style=\"display:flex;align-items:flex-end\"><button id=\"ds-btn-debug-batch\" style=\"width:100%;padding:6px 8px;background:#6366f1;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">生成模拟数据</button></div></div></div><div id=\"ds-debug-status\" style=\"font-size:11px;color:#34d399\"></div></div></div></div>";

  // ===== 设置窗口（仿照统计详情窗口样式创建独立弹窗） =====
  var _ds_settingsOpen = false;
  function createSettingsUI() {
    if (state.settingsPanelCreated) return;
    state.settingsPanelCreated = true;
    var p = window.parent || window;
    var doc = p.document;
    var overlay = doc.createElement('div');
    overlay.id = 'ds-settings-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:230000;display:none;';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeSettings(); });
    var panel = doc.createElement('div');
    panel.id = 'ds-settings-panel';
    panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:90vh;background:#080d14;border-radius:12px 12px 0 0;z-index:230001;overflow:hidden;display:flex;flex-direction:column;border-top:1px solid #374151;box-sizing:border-box;';
    panel.innerHTML = "<div style=\"padding:12px 16px;background:#080d14;border-bottom:1px solid #374151;display:flex;justify-content:space-between;align-items:center;flex-shrink:0\"><div style=\"display:flex;align-items:center;gap:8px;min-width:0\"><span style=\"font-size:16px;font-weight:600;color:#f3f4f6;font-family:'Microsoft YaHei','微软雅黑',sans-serif\">⚙️ 设置</span><span style=\"font-size:10px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">API密钥 · 余额 · 价格 · 调试</span></div><div id=\"ds-btn-close-settings\" style=\"width:28px;height:28px;background:#374151;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:#9ca3af;flex-shrink:0\" title=\"关闭设置\">✕</div></div><div id=\"ds-settings-body\" style=\"flex:1;overflow-y:auto;padding:14px 16px 20px;background:#0e1520;font-family:'Microsoft YaHei','微软雅黑',sans-serif\"></div>";
    doc.body.appendChild(overlay);
    doc.body.appendChild(panel);
    doc.getElementById('ds-settings-body').innerHTML = SETTINGS_PANEL_HTML;
    var dsStyle = doc.createElement('style');
    dsStyle.id = 'ds-settings-responsive-css';
    dsStyle.textContent = '@media(min-width:761px){#ds-settings-panel{position:fixed!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%) scale(0.95)!important;opacity:0!important;pointer-events:none!important;transition:opacity 0.2s ease,transform 0.2s ease!important;width:min(680px,80%)!important;max-height:calc(var(--ds-vvh,100vh) - 24px)!important;border-radius:12px!important;border:1px solid #374151!important}#ds-settings-panel.ds-open{transform:translate(-50%,-50%) scale(1)!important;opacity:1!important;pointer-events:auto!important}}@media(max-width:760px){#ds-settings-panel{display:flex!important;width:100vw!important;height:100vh!important;max-height:none!important;border-radius:0!important;top:0!important;border-top:1px solid #374151!important;transform:translateY(100%)!important;opacity:0!important;pointer-events:none!important;transition:opacity 0.2s ease,transform 0.2s ease!important}#ds-settings-panel.ds-open{display:flex!important;transform:translateY(0)!important;opacity:1!important;pointer-events:auto!important}}';
    doc.head.appendChild(dsStyle);
    doc.getElementById('ds-btn-close-settings').onclick = closeSettings;
    bindSettingsControls();
  }
  function openSettings() {
    var p = window.parent || window;
    var doc = p.document;
    var ov = doc.getElementById('ds-settings-overlay');
    var pn = doc.getElementById('ds-settings-panel');
    if (!ov || !pn) { createSettingsUI(); ov = doc.getElementById('ds-settings-overlay'); pn = doc.getElementById('ds-settings-panel'); }
    if (!ov || !pn) return;
    initPricingEditors();
    refreshSettingsUI();
    ov.style.display = 'block';
    pn.classList.add('ds-open');
    _ds_settingsOpen = true;
  }
  function closeSettings() {
    var p = window.parent || window;
    var doc = p.document;
    var ov = doc.getElementById('ds-settings-overlay');
    var pn = doc.getElementById('ds-settings-panel');
    if (ov) ov.style.display = 'none';
    if (pn) pn.classList.remove('ds-open');
    _ds_settingsOpen = false;
  }
  function toggleSettings() {
    if (_ds_settingsOpen) closeSettings(); else openSettings();
  }
  // ===== 设置窗口控件事件绑定 =====
  function bindSettingsControls() {
    var p = window.parent || window;
    var doc = p.document;
    var apiKeyInput = doc.getElementById('ds-api-key');
    var saveKeyBtn = doc.getElementById('ds-btn-save-key');
    if (saveKeyBtn) { saveKeyBtn.onclick = function() { var key = apiKeyInput ? apiKeyInput.value.trim() : ''; saveApiKey(key); var s = doc.getElementById('ds-balance-status'); if (s) s.textContent = key ? '密钥已保存' : '密钥已清空'; }; }
    var abc = doc.getElementById('ds-auto-balance');
    var abs = doc.getElementById('ds-auto-balance-slider');
    var abi = doc.getElementById('ds-auto-balance-interval');
    var bii = doc.getElementById('ds-balance-interval');
    if (abc) { abc.onchange = function() { state.settings.autoBalance = this.checked; if (abs) abs.style.left = this.checked ? '23px' : '3px'; if (abi) abi.style.display = this.checked ? 'block' : 'none'; saveSettings(); }; }
    if (bii) { bii.onchange = function() { state.settings.balanceInterval = parseInt(this.value) || 10; saveSettings(); }; }
    var cbs = doc.getElementById('ds-btn-save-balance');
    var cbc = doc.getElementById('ds-btn-clear-balance');
    var cbInput = doc.getElementById('ds-custom-balance');
    var cbStatus = doc.getElementById('ds-custom-balance-status');
    if (cbs) { cbs.onclick = function() { var val = cbInput ? cbInput.value.trim() : ''; if (val === '' || isNaN(parseFloat(val))) { if (cbStatus) { cbStatus.textContent = '请输入有效金额'; cbStatus.style.color = '#f87171'; } return; } state.customBalance = val; saveData(CUSTOM_BALANCE_STORAGE, val); if (cbStatus) { cbStatus.textContent = '已保存'; cbStatus.style.color = '#34d399'; } var be = doc.getElementById('ds-balance'); var se = doc.getElementById('ds-balance-status'); if (be) be.textContent = '¥' + val + ' CNY'; if (se) se.textContent = '自定义余额'; refreshUI(); }; }
    if (cbc) { cbc.onclick = function() { state.customBalance = null; saveData(CUSTOM_BALANCE_STORAGE, ''); if (cbInput) cbInput.value = ''; if (cbStatus) { cbStatus.textContent = '已清除，恢复使用API余额'; cbStatus.style.color = '#9ca3af'; } if (state.balance) { var be = doc.getElementById('ds-balance'); var se = doc.getElementById('ds-balance-status'); if (be) be.textContent = '¥' + state.balance.balance + ' ' + state.balance.currency; if (se) se.textContent = '账户可用'; } else { var be = doc.getElementById('ds-balance'); var se = doc.getElementById('ds-balance-status'); if (be) be.textContent = '¥0.00 CNY'; if (se) se.textContent = ''; } refreshUI(); }; }
    var debugToggle = doc.getElementById('ds-debug-mode');
    var debugSlider = doc.getElementById('ds-debug-mode-slider');
    var debugPanel = doc.getElementById('ds-debug-panel');
    var debugHit = doc.getElementById('ds-debug-hit');
    var debugMiss = doc.getElementById('ds-debug-miss');
    var debugOutput = doc.getElementById('ds-debug-output');
    var debugModel = doc.getElementById('ds-debug-model');
    var debugDateStart = doc.getElementById('ds-debug-date-start');
    var debugDateEnd = doc.getElementById('ds-debug-date-end');
    var debugBatchCount = doc.getElementById('ds-debug-batch-count');
    var debugBatchBtn = doc.getElementById('ds-btn-debug-batch');
    if (debugToggle) { debugToggle.onchange = function() { state.settings.debug = this.checked; if (debugSlider) debugSlider.style.left = this.checked ? '23px' : '3px'; if (debugPanel) debugPanel.style.display = this.checked ? 'block' : 'none'; var ds = doc.getElementById('ds-debug-status'); if (ds) ds.textContent = this.checked ? '调试模式已开启，下次对话将使用模拟参数，不会产生API费用' : ''; saveSettings(); }; }
    if (debugHit) debugHit.onchange = function() { state.settings.debugHit = parseInt(this.value) || 0; saveSettings(); };
    if (debugMiss) debugMiss.onchange = function() { state.settings.debugMiss = parseInt(this.value) || 0; saveSettings(); };
    if (debugOutput) debugOutput.onchange = function() { state.settings.debugOutput = parseInt(this.value) || 0; saveSettings(); };
    if (debugModel) debugModel.onchange = function() { state.settings.debugModel = this.value; saveSettings(); };
    if (debugDateStart) debugDateStart.onchange = function() { state.settings.debugDateStart = this.value; saveSettings(); };
    if (debugDateEnd) debugDateEnd.onchange = function() { state.settings.debugDateEnd = this.value; saveSettings(); };
    if (debugBatchCount) debugBatchCount.onchange = function() { state.settings.debugBatchCount = parseInt(this.value) || 1; saveSettings(); };
    if (debugBatchBtn) debugBatchBtn.onclick = function() { generateDebugBatch(); };
    var newPricingToggle = doc.getElementById('ds-use-new-pricing');
    var newPricingSlider = doc.getElementById('ds-use-new-pricing-slider');
    var newPricingPanel = doc.getElementById('ds-new-pricing-panel');
    var newPricingDate = doc.getElementById('ds-new-pricing-date');
    if (newPricingToggle) { newPricingToggle.onchange = function() { state.settings.useNewPricing = this.checked; if (newPricingSlider) newPricingSlider.style.left = this.checked ? '23px' : '3px'; if (newPricingPanel) newPricingPanel.style.display = this.checked ? 'block' : 'none'; saveSettings(); recalcAllCosts(); refreshUI(); }; }
    if (newPricingDate) { newPricingDate.onchange = function() { if (this.value) { var pp = this.value.split('-'); state.settings.newPricingDate = new Date(pp[0] + '-' + pp[1] + '-' + pp[2] + 'T00:00:00+08:00').getTime(); } else { state.settings.newPricingDate = 0; } saveSettings(); recalcAllCosts(); refreshUI(); }; }
    var pricingTodayBtn = doc.getElementById('ds-btn-pricing-today');
    if (pricingTodayBtn) { pricingTodayBtn.onclick = function() { var d = new Date(); d.setHours(0,0,0,0); state.settings.newPricingDate = d.getTime(); if (newPricingDate) newPricingDate.value = d.toISOString().split('T')[0]; if (newPricingToggle && !newPricingToggle.checked) { newPricingToggle.checked = true; if (newPricingSlider) newPricingSlider.style.left = '23px'; if (newPricingPanel) newPricingPanel.style.display = 'block'; } saveSettings(); recalcAllCosts(); refreshUI(); }; }
    var peakDotToggle = doc.getElementById('ds-peak-dot');
    var peakDotSlider = doc.getElementById('ds-peak-dot-slider');
    if (peakDotToggle) { peakDotToggle.onchange = function() { state.settings.peakDot = this.checked; if (peakDotSlider) peakDotSlider.style.left = this.checked ? '23px' : '3px'; saveSettings(); updatePeakDot(); }; }
    var peakDotResetBtn = doc.getElementById('ds-btn-reset-peak-dot');
    if (peakDotResetBtn) { peakDotResetBtn.onclick = function() { resetPeakDot(); try { (window.parent || window).toastr.success('已重置圆点到右上角默认位置'); } catch(e) {} }; }
  }
  // ===== 设置窗口打开时同步各控件当前值 =====
  function refreshSettingsUI() {
    var p = window.parent || window;
    var doc = p.document;
    var apiKeyInput = doc.getElementById('ds-api-key');
    if (apiKeyInput && state.apiKey) apiKeyInput.value = state.apiKey;
    var cbi = doc.getElementById('ds-custom-balance');
    var cbs = doc.getElementById('ds-custom-balance-status');
    if (cbi) cbi.value = (state.customBalance !== null && state.customBalance !== '') ? state.customBalance : '';
    if (cbs) { cbs.textContent = (state.customBalance !== null && state.customBalance !== '') ? '已设置' : ''; cbs.style.color = ''; }
    var abc = doc.getElementById('ds-auto-balance');
    var abs = doc.getElementById('ds-auto-balance-slider');
    var abi = doc.getElementById('ds-auto-balance-interval');
    var bii = doc.getElementById('ds-balance-interval');
    if (abc) abc.checked = state.settings.autoBalance;
    if (abs) abs.style.left = state.settings.autoBalance ? '23px' : '3px';
    if (abi) abi.style.display = state.settings.autoBalance ? 'block' : 'none';
    if (bii) bii.value = state.settings.balanceInterval;
    var debugToggle = doc.getElementById('ds-debug-mode');
    var debugSlider = doc.getElementById('ds-debug-mode-slider');
    var debugPanel = doc.getElementById('ds-debug-panel');
    var debugHit = doc.getElementById('ds-debug-hit');
    var debugMiss = doc.getElementById('ds-debug-miss');
    var debugOutput = doc.getElementById('ds-debug-output');
    var debugModel = doc.getElementById('ds-debug-model');
    var debugDateStart = doc.getElementById('ds-debug-date-start');
    var debugDateEnd = doc.getElementById('ds-debug-date-end');
    var debugBatchCount = doc.getElementById('ds-debug-batch-count');
    if (debugToggle) debugToggle.checked = state.settings.debug;
    if (debugSlider) debugSlider.style.left = state.settings.debug ? '23px' : '3px';
    if (debugPanel) debugPanel.style.display = state.settings.debug ? 'block' : 'none';
    if (debugHit) debugHit.value = state.settings.debugHit;
    if (debugMiss) debugMiss.value = state.settings.debugMiss;
    if (debugOutput) debugOutput.value = state.settings.debugOutput;
    if (debugModel) debugModel.value = state.settings.debugModel;
    if (debugDateStart && state.settings.debugDateStart) debugDateStart.value = state.settings.debugDateStart;
    if (debugDateEnd && state.settings.debugDateEnd) debugDateEnd.value = state.settings.debugDateEnd;
    if (debugBatchCount) debugBatchCount.value = state.settings.debugBatchCount || 30;
    var ds = doc.getElementById('ds-debug-status');
    if (ds) ds.textContent = state.settings.debug ? '调试模式已开启，下次对话将使用模拟参数，不会产生API费用' : '';
    var newPricingToggle = doc.getElementById('ds-use-new-pricing');
    var newPricingSlider = doc.getElementById('ds-use-new-pricing-slider');
    var newPricingPanel = doc.getElementById('ds-new-pricing-panel');
    var newPricingDate = doc.getElementById('ds-new-pricing-date');
    if (newPricingToggle) newPricingToggle.checked = !!state.settings.useNewPricing;
    if (newPricingSlider) newPricingSlider.style.left = state.settings.useNewPricing ? '23px' : '3px';
    if (newPricingPanel) newPricingPanel.style.display = state.settings.useNewPricing ? 'block' : 'none';
    if (newPricingDate) {
      try {
        var d = new Date(state.settings.newPricingDate);
        if (isNaN(d.getTime())) throw new Error();
        newPricingDate.value = state.settings.newPricingDate === 0 ? '' : d.toISOString().split('T')[0];
      } catch(e) {}
    }
    var peakDotToggle = doc.getElementById('ds-peak-dot');
    var peakDotSlider = doc.getElementById('ds-peak-dot-slider');
    if (peakDotToggle) peakDotToggle.checked = state.settings.peakDot !== false;
    if (peakDotSlider) peakDotSlider.style.left = (state.settings.peakDot !== false) ? '23px' : '3px';
    fillDebugModelSelect();
  }

// ===== 更新图表模型选择器高亮样式 =====
function updateChartModelSelection() {
  var p = window.parent || window;
  var doc = p.document;
  var sel = doc.getElementById('ds-chart-model-select');
  if (!sel) return;
  sel.value = state.chartModel || '__all__';
}

// ===== 图表实例缓存 =====
var _chartInstances = { token: null, cost: null, rate: null, requests: null, duration: null, modeltokens: null };
// ===== 图表日视图模式开关（false=轮次，true=日期） =====
var _chartDayMode = { token: false, cost: false, rate: false, requests: true, duration: false };
// ===== 图表当前显示的月份索引（-1=最新月份） =====
var _chartMonthIdx = { token: -1, cost: -1, rate: -1, requests: -1, duration: -1 };
// ===== 模型用量占比图模式（token=Token占比，count=调用次数占比） =====
var _chartModelUsageMode = 'token';
// ===== 缓存最近一次聚合的日数据，供月份导航使用 =====
var _dayAggCache = null;
// ===== 按自然日聚合数据 =====
function aggregateByDay(entries) {
  var dayMap = {};
  entries.forEach(function(e) {
    var key = new Date(e.timestamp).toISOString().slice(0, 10);
    if (!dayMap[key]) dayMap[key] = { count: 0, total_tokens: 0, cost: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, completion_tokens: 0, input_cost: 0, output_cost: 0, prompt_tokens: 0, duration: 0, tokenRateSum: 0, rateCount: 0 };
    var d = dayMap[key];
    d.count++;
    d.total_tokens += e.total_tokens || 0;
    d.cost += e.cost || 0;
    d.cache_hit_tokens += e.cache_hit_tokens || 0;
    d.cache_miss_tokens += e.cache_miss_tokens || 0;
    d.completion_tokens += e.completion_tokens || 0;
    d.input_cost += e.input_cost || 0;
    d.duration += e.duration || 0;
    if (e.tokenRate) { d.tokenRateSum += e.tokenRate; d.rateCount++; }
    d.output_cost += e.output_cost || 0;
    d.prompt_tokens += e.prompt_tokens || 0;
  });
  var keys = Object.keys(dayMap).sort();
  if (keys.length === 0) return { labels: [], keys: [], data: [] };
  var minD = new Date(keys[0] + 'T00:00:00Z');
  var maxD = new Date(keys[keys.length - 1] + 'T00:00:00Z');
  var startD = new Date(Date.UTC(minD.getUTCFullYear(), minD.getUTCMonth(), 1));
  var endD = new Date(Date.UTC(maxD.getUTCFullYear(), maxD.getUTCMonth() + 1, 0));
  var filledKeys = [], cur = new Date(startD);
  while (cur <= endD) { filledKeys.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
  var emptyRec = function() { return { count:0, total_tokens:0, cost:0, cache_hit_tokens:0, cache_miss_tokens:0, completion_tokens:0, input_cost:0, output_cost:0, prompt_tokens:0, duration:0, tokenRateSum:0, rateCount:0 }; };
  var fmtLabels = filledKeys.map(function(k) { var p = k.split('-'); return parseInt(p[1]) + '/' + parseInt(p[2]); });
  return { labels: fmtLabels, keys: filledKeys, data: filledKeys.map(function(k) { return dayMap[k] || emptyRec(); }) };
}

// ===== 重置所有图表缩放 =====
function resetChartZoom() {
  if (_chartInstances.token) _chartInstances.token.resetZoom();
  if (_chartInstances.cost) _chartInstances.cost.resetZoom();
  if (_chartInstances.rate) _chartInstances.rate.resetZoom();
  if (_chartInstances.requests) _chartInstances.requests.resetZoom();
  if (_chartInstances.duration) _chartInstances.duration.resetZoom();
}



// ===== 图表底部滑块状态 =====
var _chartSliders={token:{total:0,viewStart:0,viewEnd:0,trackEl:null,thumbEl:null,labelEl:null,dragging:null,dragOffset:0,dragStartVS:0,dragStartVE:0},cost:{total:0,viewStart:0,viewEnd:0,trackEl:null,thumbEl:null,labelEl:null,dragging:null,dragOffset:0,dragStartVS:0,dragStartVE:0},rate:{total:0,viewStart:0,viewEnd:0,trackEl:null,thumbEl:null,labelEl:null,dragging:null,dragOffset:0,dragStartVS:0,dragStartVE:0},requests:{total:0,viewStart:0,viewEnd:0,trackEl:null,thumbEl:null,labelEl:null,dragging:null,dragOffset:0,dragStartVS:0,dragStartVE:0},duration:{total:0,viewStart:0,viewEnd:0,trackEl:null,thumbEl:null,labelEl:null,dragging:null,dragOffset:0,dragStartVS:0,dragStartVE:0}};
// ===== 初始化图表滑块 =====
function initChartSliders(){var p=window.parent||window;var doc=p.document;["token","cost","rate","requests","duration"].forEach(function(key){var track=doc.getElementById("ds-slider-"+key+"-track");var thumb=doc.getElementById("ds-slider-"+key+"-thumb");var label=doc.getElementById("ds-slider-"+key+"-label");if(!track||!thumb||!label)return;var s=_chartSliders[key];s.trackEl=track;s.thumbEl=thumb;s.labelEl=label;var chart=_chartInstances[key];if(!chart)return;var total=chart.data.labels.length;var min=chart.scales.x.options.min!==undefined?chart.scales.x.options.min:0;var max=chart.scales.x.options.max!==undefined?chart.scales.x.options.max:total-1;s.total=total;s.viewStart=Math.max(0,Math.round(min));s.viewEnd=Math.min(total-1,Math.round(max));updateSliderVisual(key);thumb.addEventListener("pointerdown",function(e){onSliderPointerDown(e,key);});track.addEventListener("click",function(e){onSliderTrackClick(e,key);});});}
// ===== 更新滑块视觉位置 =====
function updateSliderVisual(key){var s=_chartSliders[key];if(!s||!s.trackEl||!s.thumbEl||!s.labelEl||s.total<=0)return;var tw=s.trackEl.clientWidth;if(tw<=0)return;var left=(s.viewStart/s.total)*tw;var width=Math.max(16,((s.viewEnd-s.viewStart+1)/s.total)*tw);s.thumbEl.style.left=left+"px";s.thumbEl.style.width=width+"px";s.labelEl.textContent="#"+(s.viewStart+1)+"~#"+(s.viewEnd+1)+" ("+(s.viewEnd-s.viewStart+1)+"/"+s.total+")";}
// ===== 图表缩放后同步滑块 =====
function syncSliderFromChart(chart){var key=null;if(chart===_chartInstances.token)key="token";else if(chart===_chartInstances.cost)key="cost";else if(chart===_chartInstances.rate)key="rate";else if(chart===_chartInstances.requests)key="requests";if(!key)return;var s=_chartSliders[key];var total=chart.data.labels.length;var min=chart.scales.x.options.min!==undefined?chart.scales.x.options.min:0;var max=chart.scales.x.options.max!==undefined?chart.scales.x.options.max:total-1;s.total=total;s.viewStart=Math.max(0,Math.round(min));s.viewEnd=Math.min(total-1,Math.round(max));updateSliderVisual(key);}
// ===== 滑块拖动后同步图表 =====
function syncChartFromSlider(key){var s=_chartSliders[key];var chart=_chartInstances[key];if(!chart)return;chart.options.scales.x.min=s.viewStart;chart.options.scales.x.max=s.viewEnd;chart.update("none");}
// ===== 滑块指针按下（开始拖动或调整范围） =====
function onSliderPointerDown(e,key){e.preventDefault();e.stopPropagation();var s=_chartSliders[key];var doc=(window.parent||window).document;var tr=s.thumbEl.getBoundingClientRect();var mx=e.clientX;var target=e.target;if(target&&target.classList&&target.classList.contains("ds-slider-handle-left")){s.dragging="left";}else if(target&&target.classList&&target.classList.contains("ds-slider-handle-right")){s.dragging="right";}else{s.dragging="pan";s.dragOffset=mx-tr.left;}s.dragStartVS=s.viewStart;s.dragStartVE=s.viewEnd;s._onMove=function(e2){onSliderPointerMove(e2,key);};s._onUp=function(e2){onSliderPointerUp(e2,key);};doc.addEventListener("pointermove",s._onMove);doc.addEventListener("pointerup",s._onUp);doc.addEventListener("pointercancel",s._onUp);}
// ===== 滑块指针移动 =====
function onSliderPointerMove(e,key){e.preventDefault();var s=_chartSliders[key];var tr=s.trackEl.getBoundingClientRect();var tw=tr.width;var mx=e.clientX;if(tw<=0)return;if(s.dragging==="pan"){var nL=mx-tr.left-s.dragOffset;var nVS=Math.round((nL/tw)*s.total);var vc=s.dragStartVE-s.dragStartVS+1;nVS=Math.max(0,Math.min(s.total-vc,nVS));s.viewStart=nVS;s.viewEnd=nVS+vc-1;}else if(s.dragging==="left"){var nL=mx-tr.left;var nVS=Math.round((nL/tw)*s.total);nVS=Math.max(0,Math.min(s.viewEnd-1,nVS));s.viewStart=nVS;}else if(s.dragging==="right"){var nR=mx-tr.left;var nVE=Math.round((nR/tw)*s.total);nVE=Math.max(s.viewStart+1,Math.min(s.total-1,nVE));s.viewEnd=nVE;}updateSliderVisual(key);syncChartFromSlider(key);}
// ===== 滑块指针释放 =====
function onSliderPointerUp(e,key){var s=_chartSliders[key];var doc=(window.parent||window).document;s.dragging=null;s.lastDragTime=Date.now();if(s._onMove)doc.removeEventListener("pointermove",s._onMove);if(s._onUp){doc.removeEventListener("pointerup",s._onUp);doc.removeEventListener("pointercancel",s._onUp);}s._onMove=null;s._onUp=null;}
// ===== 在滑块轨道上点击 =====
function onSliderTrackClick(e,key){var s=_chartSliders[key];if(s.dragging)return;if(Date.now()-(s.lastDragTime||0)<150)return;var tr=s.trackEl.getBoundingClientRect();var cX=e.clientX-tr.left;var cI=Math.round((cX/tr.width)*s.total);var vc=s.viewEnd-s.viewStart+1;var nVS=Math.round(cI-vc/2);nVS=Math.max(0,Math.min(s.total-vc,nVS));s.viewStart=nVS;s.viewEnd=nVS+vc-1;updateSliderVisual(key);syncChartFromSlider(key);}

// ⚠️ 以下三个函数是旧版鼠标事件处理器的残留，目前未被调用，保留以兼容
function onSliderMouseUp(key){var s=_chartSliders[key];var doc=(window.parent||window).document;s.dragging=null;s.lastDragTime=Date.now();if(s._mm)doc.removeEventListener("mousemove",s._mm);if(s._mu)doc.removeEventListener("mouseup",s._mu);s._mm=null;s._mu=null;}
function onSliderTrackClick(e,key){var s=_chartSliders[key];if(s.dragging)return;if(Date.now()-s.lastDragTime<150)return;var tr=s.trackEl.getBoundingClientRect();var cX=e.clientX-tr.left;var cI=Math.round((cX/tr.width)*s.total);var vc=s.viewEnd-s.viewStart+1;var nVS=Math.round(cI-vc/2);nVS=Math.max(0,Math.min(s.total-vc,nVS));s.viewStart=nVS;s.viewEnd=nVS+vc-1;updateSliderVisual(key);syncChartFromSlider(key);}

function onSliderMouseUp(key){var s=_chartSliders[key];var doc=window.parent||window;doc=doc.document;s.dragging=null;if(s._mm)doc.removeEventListener("mousemove",s._mm);if(s._mu)doc.removeEventListener("mouseup",s._mu);s._mm=null;s._mu=null;}
function onSliderTrackClick(e,key){var s=_chartSliders[key];if(s.dragging)return;var tr=s.trackEl.getBoundingClientRect();var cX=e.clientX-tr.left;var cI=Math.round((cX/tr.width)*s.total);var vc=s.viewEnd-s.viewStart+1;var nVS=Math.round(cI-vc/2);nVS=Math.max(0,Math.min(s.total-vc,nVS));s.viewStart=nVS;s.viewEnd=nVS+vc-1;updateSliderVisual(key);syncChartFromSlider(key);}

function onSliderMouseUp(){var s=_chartSlider;s.dragging=null;s.doc.removeEventListener("mousemove",onSliderMouseMove);s.doc.removeEventListener("mouseup",onSliderMouseUp);}
function onSliderTrackClick(e){var s=_chartSlider;if(s.dragging)return;var tr=s.trackEl.getBoundingClientRect();var cX=e.clientX-tr.left;var cI=Math.round((cX/tr.width)*s.total);var vc=s.viewEnd-s.viewStart+1;var nVS=Math.round(cI-vc/2);nVS=Math.max(0,Math.min(s.total-vc,nVS));s.viewStart=nVS;s.viewEnd=nVS+vc-1;updateSliderVisual();syncChartsFromSlider();}


// ===== 月份导航：将图表缩放到指定月份 =====
function zoomToMonth(chart, agg, monthIdx) {
  if (!chart || !agg || !agg.keys || agg.keys.length === 0) return;
  var months = []; agg.keys.forEach(function(k) { var m = k.slice(0, 7); if (months.indexOf(m) === -1) months.push(m); });
  if (months.length <= 1) return;
  if (monthIdx < 0) monthIdx = months.length - 1;
  if (monthIdx >= months.length) monthIdx = months.length - 1;
  var target = months[monthIdx];
  var startIdx = -1, endIdx = -1;
  agg.keys.forEach(function(k, idx) { if (k.slice(0, 7) === target) { if (startIdx === -1) startIdx = idx; endIdx = idx; } });
  if (startIdx === -1) return;
  chart.options.scales.x.min = Math.max(0, startIdx - 0.5);
  chart.options.scales.x.max = Math.min(agg.keys.length - 1, endIdx + 0.5);
  chart.update();
  syncSliderFromChart(chart);
}
// ===== 选择月份 =====
function selectMonth(key, monthStr) {
  var chart = _chartInstances[key];
  if (!chart || !_dayAggCache) return;
  var agg = _dayAggCache;
  var months = []; agg.keys.forEach(function(k) { var m = k.slice(0, 7); if (months.indexOf(m) === -1) months.push(m); });
  var idx = months.indexOf(monthStr);
  if (idx === -1) return;
  _chartMonthIdx[key] = idx;
  zoomToMonth(chart, agg, idx);
}
// ===== 填充月份选择器下拉框 =====
function populateMonthSelects(agg) {
  if (!agg || !agg.keys || agg.keys.length === 0) return;
  var months = []; agg.keys.forEach(function(k) { var m = k.slice(0, 7); if (months.indexOf(m) === -1) months.push(m); });
  var p = window.parent || window;
  var doc = p.document;
  ['token','cost','rate','requests','duration'].forEach(function(k) {
    var sel = doc.getElementById('ds-month-' + k);
    if (!sel) return;
    sel.innerHTML = '';
    months.forEach(function(m) {
      var opt = doc.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    });
    sel.value = months[_chartMonthIdx[k] >= 0 && _chartMonthIdx[k] < months.length ? _chartMonthIdx[k] : months.length - 1];
    if (k === 'requests') { sel.style.display = 'inline-block'; } else { sel.style.display = _chartDayMode[k] ? 'inline-block' : 'none'; }
  });
}
// ===== 渲染 Token 使用量热力图 =====
function renderHeatmap(filtered, dayAgg) {
  var p = window.parent || window;
  var doc = p.document;
  var container = doc.getElementById('ds-heatmap-container');
  var scrollEl = doc.getElementById('ds-heatmap-scroll');
  var legendEl = doc.getElementById('ds-heatmap-legend');
  if (!container) return;
  if (!filtered || filtered.length === 0 || !dayAgg || !dayAgg.keys || dayAgg.keys.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;font-size:12px">暂无数据</div>';
    return;
  }
  var dayMap = {};
  for (var i = 0; i < dayAgg.keys.length; i++) {
    dayMap[dayAgg.keys[i]] = dayAgg.data[i].total_tokens;
  }
  var now = new Date();
  var endStr = now.toISOString().slice(0, 10);
  var endDate = new Date(endStr + 'T00:00:00Z');
  var startDate = new Date(endDate);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 2);
  if (dayAgg.keys.length > 0) {
    var earliest = new Date(dayAgg.keys[0] + 'T00:00:00Z');
    if (earliest < startDate) startDate = earliest;
  }
  var startDow = startDate.getUTCDay();
  startDate.setUTCDate(startDate.getUTCDate() + (startDow === 0 ? -6 : 1 - startDow));
  var endDow = endDate.getUTCDay();
  endDate.setUTCDate(endDate.getUTCDate() + (endDow === 0 ? 0 : 7 - endDow));
  var totalDays = Math.round((endDate - startDate) / 86400000);
  var totalWeeks = Math.ceil(totalDays / 7);
  var vals = [];
  for (var k in dayMap) { if (dayMap[k] > 0) vals.push(dayMap[k]); }
  vals.sort(function(a, b) { return a - b; });
  function pct(arr, pctVal) {
    if (arr.length === 0) return 0;
    var idx = Math.ceil(arr.length * pctVal / 100) - 1;
    return arr[Math.max(0, Math.min(idx, arr.length - 1))];
  }
  var p25 = pct(vals, 25), p50 = pct(vals, 50), p75 = pct(vals, 75);
  if (p25 === 0 && p50 === 0 && p75 === 0) { p25 = 1; p50 = 1000; p75 = 10000; }
  else if (p25 === p50 && p50 === p75) { p25 = Math.max(1, Math.floor(p50 / 2)); p75 = p50 * 2; }
  function getLevel(t) {
    if (t <= 0) return 0;
    if (t <= p25) return 1;
    if (t <= p50) return 2;
    if (t <= p75) return 3;
    return 4;
  }
  var clr = ['#161b22','#0d3b20','#1a7f37','#3fb950','#aceebb'];
  var mn = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var dl = ['周一','','周三','','周五','','周日'];
  var cs = 11;
  // 左侧固定星期标签
  var labelsEl = doc.getElementById('ds-heatmap-labels');
  var lhtml = '<div style="display:flex;flex-direction:column">';
  lhtml += '<div style="height:14px;width:30px;padding:0;line-height:14px;font-size:9px;color:#6b7280;text-align:right;padding-right:4px"></div>';
  for (var d = 0; d < 7; d++) {
    var lh = cs + 2;
    lhtml += '<div style="height:' + lh + 'px;width:30px;padding:0 4px 0 0;line-height:' + lh + 'px;font-size:9px;color:#6b7280;text-align:right;box-sizing:border-box">' + (d % 2 === 0 ? dl[d] : '') + '</div>';
  }
  lhtml += '</div>';
  labelsEl.innerHTML = lhtml;
  // 可滚动网格（不含星期列）
  var html = '<table style="border-collapse:collapse;font-size:10px;color:#6b7280"><tr><td style="height:14px;padding:0;line-height:14px"></td>';
  var lastM = -1;
  for (var w = 0; w < totalWeeks; w++) {
    var ws = new Date(startDate);
    ws.setUTCDate(startDate.getUTCDate() + w * 7);
    var mk = ws.getUTCFullYear() * 12 + ws.getUTCMonth();
    if (mk !== lastM) {
      var span = 1;
      for (var w2 = w + 1; w2 < totalWeeks; w2++) {
        var ws2 = new Date(startDate);
        ws2.setUTCDate(startDate.getUTCDate() + w2 * 7);
        if (ws2.getUTCFullYear() * 12 + ws2.getUTCMonth() === mk) span++;
        else break;
      }
      var label = mn[ws.getUTCMonth()];
      if (ws.getUTCMonth() === 0) label = ws.getUTCFullYear() + '年';
      html += '<td colspan="' + span + '" style="padding:0 0 0 2px;line-height:14px;height:14px;font-size:10px;color:#6b7280;white-space:nowrap">' + label + '</td>';
      lastM = mk;
    }
  }
  html += '</tr>';
  for (var d = 0; d < 7; d++) {
    html += '<tr>';
    for (var w = 0; w < totalWeeks; w++) {
      var cd = new Date(startDate);
      cd.setUTCDate(startDate.getUTCDate() + w * 7 + d);
      var key = cd.toISOString().slice(0, 10);
      var t = dayMap[key] || 0;
      var lv = getLevel(t);
      var y = cd.getUTCFullYear();
      var m = cd.getUTCMonth() + 1;
      var day = cd.getUTCDate();
      var tip = y + '年' + m + '月' + day + '日';
      tip += t > 0 ? ' · ' + t.toLocaleString() + ' Token' : ' · 无记录';
      html += '<td style="padding:1px;line-height:0;font-size:0"><div style="width:' + cs + 'px;height:' + cs + 'px;border-radius:2px;background:' + clr[lv] + ';cursor:pointer" title="' + tip + '"></div></td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  container.innerHTML = html;
  if (legendEl) {
    var lhtml = '更少 ';
    for (var i = 0; i < 5; i++) {
      lhtml += '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + clr[i] + ';vertical-align:middle;margin:0 0 0 2px"></span>';
    }
    lhtml += ' 更多';
    legendEl.innerHTML = lhtml;
  }
  setTimeout(function() {
    if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth;
  }, 50);
}
// ===== 渲染统计图表（Token 趋势、费用趋势、缓存命中率、API请求次数） =====
function renderCharts() {
  var p = window.parent || window;
  var doc = p.document;
  if (!state.chartLibLoaded) {
    doc.getElementById('ds-chart-loading').style.display = 'block';
    doc.getElementById('ds-chart-container').style.display = 'none';
    loadChartLib(function() { renderCharts(); });
    return;
  }
  if (typeof Chart === 'undefined') {
    doc.getElementById('ds-chart-loading').style.display = 'block';
    doc.getElementById('ds-chart-loading').textContent = '图表库加载失败，请检查网络或刷新重试';
    doc.getElementById('ds-chart-container').style.display = 'none';
    return;
  }
  doc.getElementById('ds-chart-loading').style.display = 'none';
  doc.getElementById('ds-chart-container').style.display = 'block';
  var s = getSelectedSave();
  if (!s || !s.history || s.history.length === 0) {
    doc.getElementById('ds-chart-loading').style.display = 'block';
    doc.getElementById('ds-chart-loading').textContent = '暂无对话数据，请先进行对话';
    doc.getElementById('ds-chart-container').style.display = 'none';
    return;
  }
  var data = s.history.slice().reverse(); var summaryBody = doc.getElementById('ds-summary-tbody'); if (summaryBody) { var modelMap = {}; s.history.forEach(function(h) { var m = h.model || 'unknown'; if (!modelMap[m]) modelMap[m] = {count:0,hit:0,miss:0,comp:0,total:0,cost:0,duration:0,tokenRateSum:0,rateCount:0}; var e = modelMap[m]; e.count++; e.hit += h.cache_hit_tokens || 0; e.miss += h.cache_miss_tokens || 0; e.comp += h.completion_tokens || 0; e.total += h.total_tokens || 0; e.cost += h.cost || 0; if (h.duration) { e.duration += h.duration; e.rateCount++; e.tokenRateSum += h.tokenRate || 0; } }); var html = ''; var modelsSorted = Object.keys(modelMap).sort(); modelsSorted.forEach(function(m) { var e = modelMap[m]; var avgCost = e.count > 0 ? (e.cost / e.count) : 0; var avgDur = e.rateCount > 0 ? (e.duration / e.rateCount / 1000).toFixed(1) + 's' : '—'; var avgRate = e.rateCount > 0 ? Math.round(e.tokenRateSum / e.rateCount) + ' t/s' : '—'; html += '<tr style="border-bottom:1px solid #1f2937">' + '<td style="padding:6px 8px;color:#a5b4fc;font-weight:500">' + shortModel(m) + '</td>' + '<td style="padding:6px 8px;text-align:right">' + e.count + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#34d399">' + e.hit.toLocaleString() + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#fca5a5">' + e.miss.toLocaleString() + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#a5b4fc">' + e.comp.toLocaleString() + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#f3f4f6">' + e.total.toLocaleString() + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#fbbf24">¥' + e.cost.toFixed(4) + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#fbbf24">¥' + avgCost.toFixed(4) + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#6b7280">' + avgDur + '</td>' + '<td style="padding:6px 8px;text-align:right;color:#60a5fa">' + avgRate + '</td>' + '</tr>'; }); summaryBody.innerHTML = html || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#6b7280">暂无数据</td></tr>'; }
  var model = state.chartModel === '__all__' ? '__all__' : (getModelList().indexOf(state.chartModel) !== -1 ? state.chartModel : '__all__');
  var filtered = model === '__all__' ? data : data.filter(function(d) { return d.model === model; });
  if (filtered.length === 0) {
    doc.getElementById('ds-chart-loading').style.display = 'block';
    doc.getElementById('ds-chart-loading').textContent = '所选模型「' + (model === '__all__' ? '全部' : model) + '」暂无对话数据，请先使用该模型进行对话';
    doc.getElementById('ds-chart-container').style.display = 'none';
    return;
  }
  // ===== 轮次模式数据（按单个对话） =====
  var labels = filtered.map(function(_, idx) { return '#' + (idx + 1); });
  var hitTokens = filtered.map(function(d) { return d.cache_hit_tokens || 0; });
  var missTokens = filtered.map(function(d) { return d.cache_miss_tokens || 0; });
  var compTokens = filtered.map(function(d) { return d.completion_tokens || 0; });
  var totalTokens = filtered.map(function(d) { return d.total_tokens || 0; });
  function getHitCost(d) { var total = (d.cache_hit_tokens || 0) + (d.cache_miss_tokens || 0); return total > 0 ? (d.input_cost || 0) * (d.cache_hit_tokens / total) : 0; }
  function getMissCost(d) { var total = (d.cache_hit_tokens || 0) + (d.cache_miss_tokens || 0); return total > 0 ? (d.input_cost || 0) * (d.cache_miss_tokens / total) : 0; }
  var hitCost = filtered.map(getHitCost);
  var missCost = filtered.map(getMissCost);
  var outputCost = filtered.map(function(d) { return d.output_cost || 0; });
  var totalCost = filtered.map(function(d) { return d.cost || 0; });
  var hitRateData = filtered.map(function(d) { return d.cache_hit_tokens > 0 && (d.cache_hit_tokens + d.cache_miss_tokens) > 0 ? (d.cache_hit_tokens / (d.cache_hit_tokens + d.cache_miss_tokens) * 100) : 0; });
  // ===== 日期模式数据（按自然日聚合） =====
  var dayAgg = aggregateByDay(filtered);
  var dayLabels = dayAgg.labels, dD = dayAgg.data;
  var dayHitT = dD.map(function(d){return d.cache_hit_tokens;});
  var dayMissT = dD.map(function(d){return d.cache_miss_tokens;});
  var dayCompT = dD.map(function(d){return d.completion_tokens;});
  var dayTotalT = dD.map(function(d){return d.total_tokens;});
  var dayHitC = dD.map(function(d){return d.prompt_tokens>0?d.input_cost*(d.cache_hit_tokens/d.prompt_tokens):0;});
  var dayMissC = dD.map(function(d){return d.prompt_tokens>0?d.input_cost*(d.cache_miss_tokens/d.prompt_tokens):0;});
  var dayOutC = dD.map(function(d){return d.output_cost;});
  var dayTotalC = dD.map(function(d){return d.cost;});
  var dayHitRate = dD.map(function(d){return d.prompt_tokens>0?d.cache_hit_tokens/d.prompt_tokens*100:0;});
  var dayReqCount = dD.map(function(d){return d.count;});
  // ===== 公共变量 =====
  var fontFam = "'system-ui', '-apple-system', sans-serif";
  var zR=filtered.length>20?{l:filtered.length-20.4,r:filtered.length-1+0.4}:null;
  ['token','cost','rate','requests','duration','modeltokens'].forEach(function(k){if(_chartInstances[k]){_chartInstances[k].destroy();_chartInstances[k]=null;}});
  // ===== 工具：根据模式选取数据集 =====
  function pick(modeKey, roundArr, dayArr) { return _chartDayMode[modeKey] ? dayArr : roundArr; }
  function srcData(modeKey) { return _chartDayMode[modeKey] ? dD : filtered; }
  // ===== 热力图 =====
  renderHeatmap(filtered, dayAgg);
  // ===== 图1 · Token 趋势 =====
  var ctx1 = doc.getElementById('ds-chart-token');
  if (ctx1) {
    ctx1 = ctx1.getContext('2d');
    if (ctx1) {
      var tUseDay = _chartDayMode.token;
      _chartInstances.token = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: pick('token', labels, dayLabels),
          datasets: [
            { label: '命中缓存 Token', data: pick('token', hitTokens, dayHitT), backgroundColor: 'rgba(52,211,153,0.7)', borderColor: '#34d399', borderWidth: 1, borderRadius: 2, order: 2 },
            { label: '未命中缓存 Token', data: pick('token', missTokens, dayMissT), backgroundColor: 'rgba(252,165,165,0.7)', borderColor: '#fca5a5', borderWidth: 1, borderRadius: 2, order: 2 },
            { label: '输出 Token', data: pick('token', compTokens, dayCompT), backgroundColor: 'rgba(165,180,252,0.7)', borderColor: '#a5b4fc', borderWidth: 1, borderRadius: 2, order: 2 },
            { label: 'Token 总消耗', data: pick('token', totalTokens, dayTotalT), type: 'line', borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#fbbf24', fill: false, tension: 0.3, order: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { color: '#9ca3af', font: { family: fontFam }, boxWidth: 12, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { afterBody: function(items) { var idx = items[0].dataIndex; var d = srcData('token')[idx]; if (!d) return []; var t = new Date(d.timestamp?d.timestamp:dD[idx]?Date.now():0).toLocaleString('zh-CN'); var p = d.priceType === 'new-peak' ? '\uD83D\uDD34 \u9AD8\u5CF0' : d.priceType === 'new-offpeak' ? '\uD83D\uDFE2 \u975E\u9AD8\u5CF0' : '\u26AA \u65E7\u4EF7\u683C'; return ['\u5BF9\u8BDD\u65F6\u95F4: ' + t, '\u65F6\u6BB5: ' + p]; } } },
            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: false }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(99,102,241,0.08)', borderColor: '#6366f1', borderWidth: 1 }, mode: 'x' }, onPanComplete:function(ctx){syncSliderFromChart(ctx.chart)}, onZoomComplete:function(ctx){syncSliderFromChart(ctx.chart)} }
          },
          scales: {
            x: tUseDay?{stacked:true,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'日期',color:'#6b7280',font:{size:11,family:fontFam}}}:{min:zR?zR.l:void 0,max:zR?zR.r:void 0,stacked:true,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'对话轮次',color:'#6b7280',font:{size:11,family:fontFam}}},
            y: { stacked: true, ticks: { color: '#6b7280', font: { family: fontFam } }, grid: { color: 'rgba(55,65,81,0.4)' }, beginAtZero: true }
          }
        }
      });
    }
  }
  // ===== 图2 · 费用趋势 =====
  var ctx2 = doc.getElementById('ds-chart-cost');
  if (ctx2) {
    ctx2 = ctx2.getContext('2d');
    if (ctx2) {
      var cUseDay = _chartDayMode.cost;
      _chartInstances.cost = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: pick('cost', labels, dayLabels),
          datasets: [
            { label: '命中缓存费用', data: pick('cost', hitCost, dayHitC), backgroundColor: 'rgba(52,211,153,0.7)', borderColor: '#34d399', borderWidth: 1, borderRadius: 2, order: 2 },
            { label: '未命中缓存费用', data: pick('cost', missCost, dayMissC), backgroundColor: 'rgba(252,165,165,0.7)', borderColor: '#fca5a5', borderWidth: 1, borderRadius: 2, order: 2 },
            { label: '输出费用', data: pick('cost', outputCost, dayOutC), backgroundColor: 'rgba(165,180,252,0.7)', borderColor: '#a5b4fc', borderWidth: 1, borderRadius: 2, order: 2 },
            { label: '总消耗费用', data: pick('cost', totalCost, dayTotalC), type: 'line', borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#fbbf24', fill: false, tension: 0.3, order: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { color: '#9ca3af', font: { family: fontFam }, boxWidth: 12, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { afterBody: function(items) { var idx = items[0].dataIndex; var d = srcData('cost')[idx]; if (!d) return []; var t = new Date(d.timestamp?d.timestamp:dD[idx]?Date.now():0).toLocaleString('zh-CN'); var p = d.priceType === 'new-peak' ? '\uD83D\uDD34 \u9AD8\u5CF0' : d.priceType === 'new-offpeak' ? '\uD83D\uDFE2 \u975E\u9AD8\u5CF0' : '\u26AA \u65E7\u4EF7\u683C'; return ['\u5BF9\u8BDD\u65F6\u95F4: ' + t, '\u65F6\u6BB5: ' + p]; } } },
            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: false }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(99,102,241,0.08)', borderColor: '#6366f1', borderWidth: 1 }, mode: 'x' }, onPanComplete:function(ctx){syncSliderFromChart(ctx.chart)}, onZoomComplete:function(ctx){syncSliderFromChart(ctx.chart)} }
          },
          scales: {
            x: cUseDay?{stacked:true,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'日期',color:'#6b7280',font:{size:11,family:fontFam}}}:{min:zR?zR.l:void 0,max:zR?zR.r:void 0,stacked:true,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'对话轮次',color:'#6b7280',font:{size:11,family:fontFam}}},
            y: { stacked: true, ticks: { color: '#6b7280', font: { family: fontFam } }, grid: { color: 'rgba(55,65,81,0.4)' }, beginAtZero: true, title: { display: true, text: '费用 (¥)', color: '#6b7280', font: { size: 11, family: fontFam } } }
          }
        }
      });
    }
  }
  // ===== 图3 · 缓存命中率趋势 =====
  var ctx3 = doc.getElementById('ds-chart-rate');
  if (ctx3) {
    ctx3 = ctx3.getContext('2d');
    if (ctx3) {
      var rUseDay = _chartDayMode.rate;
      _chartInstances.rate = new Chart(ctx3, {
        type: 'line',
        data: {
          labels: pick('rate', labels, dayLabels),
          datasets: [
            { label: '缓存命中率', data: pick('rate', hitRateData, dayHitRate), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.15)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#34d399', fill: true, tension: 0.3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { color: '#9ca3af', font: { family: fontFam }, boxWidth: 12, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { afterBody: function(items) { var idx = items[0].dataIndex; var d = srcData('rate')[idx]; if (!d) return []; var t = new Date(d.timestamp?d.timestamp:dD[idx]?Date.now():0).toLocaleString('zh-CN'); var p = d.priceType === 'new-peak' ? '\uD83D\uDD34 \u9AD8\u5CF0' : d.priceType === 'new-offpeak' ? '\uD83D\uDFE2 \u975E\u9AD8\u5CF0' : '\u26AA \u65E7\u4EF7\u683C'; return ['\u5BF9\u8BDD\u65F6\u95F4: ' + t, '\u65F6\u6BB5: ' + p]; } } },
            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: false }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(99,102,241,0.08)', borderColor: '#6366f1', borderWidth: 1 }, mode: 'x' }, onPanComplete:function(ctx){syncSliderFromChart(ctx.chart)}, onZoomComplete:function(ctx){syncSliderFromChart(ctx.chart)} }
          },
          scales: {
            x: rUseDay?{ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'日期',color:'#6b7280',font:{size:11,family:fontFam}}}:{min:zR?zR.l:void 0,max:zR?zR.r:void 0,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'对话轮次',color:'#6b7280',font:{size:11,family:fontFam}}},
            y: { ticks: { color: '#6b7280', font: { family: fontFam }, callback: function(value) { return value.toFixed(1) + '%'; } }, grid: { color: 'rgba(55,65,81,0.4)' }, beginAtZero: true, max: 100, title: { display: true, text: '缓存命中率', color: '#6b7280', font: { size: 11, family: fontFam } } }
          }
        }
      });
    }
  }
  // ===== 图4 · API请求次数趋势（始终使用日期模式） =====
  var ctx4 = doc.getElementById('ds-chart-requests');
  if (ctx4) {
    ctx4 = ctx4.getContext('2d');
    if (ctx4) {
      _chartInstances.requests = new Chart(ctx4, {
        type: 'bar',
        data: {
          labels: dayLabels,
          datasets: [
            { label: 'API请求次数', data: dayReqCount, backgroundColor: 'rgba(96,165,250,0.7)', borderColor: '#60a5fa', borderWidth: 1, borderRadius: 2 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { color: '#9ca3af', font: { family: fontFam }, boxWidth: 12, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { afterBody: function(items) { var idx = items[0].dataIndex; var rec = dD[idx]; if (!rec) return []; return ['\u5F53\u65E5\u8BF7\u6C42: ' + rec.count + ' \u6B21']; } } },
            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: false }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(99,102,241,0.08)', borderColor: '#6366f1', borderWidth: 1 }, mode: 'x' }, onPanComplete:function(ctx){syncSliderFromChart(ctx.chart)}, onZoomComplete:function(ctx){syncSliderFromChart(ctx.chart)} }
          },
          scales: {
            x: {stacked:true,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'日期',color:'#6b7280',font:{size:11,family:fontFam}}},
            y: { ticks: { color: '#6b7280', font: { family: fontFam } }, grid: { color: 'rgba(55,65,81,0.4)' }, beginAtZero: true, title: { display: true, text: '请求次数', color: '#6b7280', font: { size: 11, family: fontFam } } }
          }
        }
      });
    }
  }

  // ===== 图5 · 耗时与速率趋势（合并展示，双Y轴） =====
  var ctx5 = doc.getElementById('ds-chart-duration');
  if (ctx5) {
    ctx5 = ctx5.getContext('2d');
    if (ctx5) {
      var dUseDay = _chartDayMode.duration;
      var durationRound = filtered.map(function(d) { return d.duration ? (d.duration / 1000) : 0; });
      var durationDay = dD.map(function(d) { return (d.duration && d.count > 0) ? (d.duration / d.count / 1000) : 0; });
      var trRound = filtered.map(function(d) { return d.tokenRate || 0; });
      var trDay = dD.map(function(d) { return (d.rateCount > 0 && d.tokenRateSum > 0) ? Math.round(d.tokenRateSum / d.rateCount) : 0; });
      _chartInstances.duration = new Chart(ctx5, {
        type: 'bar',
        data: {
          labels: pick('duration', labels, dayLabels),
          datasets: [
            { label: '平均耗时(s)', data: pick('duration', durationRound, durationDay), backgroundColor: 'rgba(96,165,250,0.7)', borderColor: '#60a5fa', borderWidth: 1, borderRadius: 2, yAxisID: 'y' },
            { label: '平均速率(t/s)', data: pick('duration', trRound, trDay), type: 'line', borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#fbbf24', fill: false, tension: 0.3, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { color: '#9ca3af', font: { family: fontFam }, boxWidth: 12, padding: 12, usePointStyle: true } },
            tooltip: { callbacks: { afterBody: function(items) { var idx = items[0].dataIndex; var d = srcData('duration')[idx]; if (!d) return []; var t = new Date(d.timestamp?d.timestamp:dD[idx]?Date.now():0).toLocaleString('zh-CN'); var p = d.priceType === 'new-peak' ? '🔴 高峰' : d.priceType === 'new-offpeak' ? '🟢 非高峰' : '⚪ 旧价格'; return ['对话时间: ' + t, '时段: ' + p]; } } },
            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: false }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(99,102,241,0.08)', borderColor: '#6366f1', borderWidth: 1 }, mode: 'x' }, onPanComplete:function(ctx){syncSliderFromChart(ctx.chart)}, onZoomComplete:function(ctx){syncSliderFromChart(ctx.chart)} }
          },
          scales: {
            x: dUseDay?{stacked:false,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'日期',color:'#6b7280',font:{size:11,family:fontFam}}}:{min:zR?zR.l:void 0,max:zR?zR.r:void 0,stacked:false,ticks:{color:'#6b7280',font:{family:fontFam},maxTicksLimit:20},grid:{color:'rgba(55,65,81,0.4)'},title:{display:true,text:'对话轮次',color:'#6b7280',font:{size:11,family:fontFam}}},
            y: { stacked: false, ticks: { color: '#6b7280', font: { family: fontFam }, callback: function(v) { return v.toFixed(1) + 's'; } }, grid: { color: 'rgba(55,65,81,0.4)' }, beginAtZero: true, title: { display: true, text: '耗时 (s)', color: '#6b7280', font: { size: 11, family: fontFam } } },
            y1: { position: 'right', stacked: false, ticks: { color: '#fbbf24', font: { family: fontFam } }, grid: { drawOnChartArea: false }, beginAtZero: true, title: { display: true, text: '速率 (t/s)', color: '#fbbf24', font: { size: 11, family: fontFam } } }
          }
        }
      });
    }
  }

  // ===== 图7 · 模型用量占比（Token / 次数 切换） =====
  var pieCtx = doc.getElementById('ds-chart-modeltokens');
  if (pieCtx) {
    pieCtx = pieCtx.getContext('2d');
    if (pieCtx) {
      var modelTokenMap = {};
      var modelCountMap = {};
      s.history.forEach(function(h) {
        var m = h.model || 'unknown';
        if (!modelTokenMap[m]) modelTokenMap[m] = 0;
        if (!modelCountMap[m]) modelCountMap[m] = 0;
        modelTokenMap[m] += h.total_tokens || 0;
        modelCountMap[m] += 1;
      });
      var pieModels = Object.keys(modelTokenMap).sort();
      var pieLabels = pieModels.map(function(m) { return shortModel(m); });
      var pieData = pieModels.map(function(m) { return _chartModelUsageMode === 'count' ? modelCountMap[m] : modelTokenMap[m]; });
      var pieColors = ['#6366f1','#f59e0b','#34d399','#f87171','#60a5fa','#a78bfa','#fbbf24','#6ee7b7','#f472b6','#94a3b8'];
      _chartInstances.modeltokens = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: pieLabels,
          datasets: [{
            data: pieData,
            backgroundColor: pieColors,
            borderColor: '#0f172a',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#9ca3af', font: { family: fontFam }, boxWidth: 12, padding: 12, usePointStyle: true } },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  var total = ctx.dataset.data.reduce(function(a,b){return a+b;},0);
                  var val = ctx.parsed;
                  var pct = total > 0 ? (val/total*100).toFixed(1) : 0;
                  return ctx.label + ': ' + val.toLocaleString() + (_chartModelUsageMode === 'count' ? ' 次 (' : ' tokens (') + pct + '%)';
                }
              }
            }
          },
          cutout: '50%'
        }
      });
    }
  }

    _dayAggCache = dayAgg;
  populateMonthSelects(dayAgg);
  initChartSliders();
  // 对日期模式的图表应用月份缩放
  var dayKeys = ['token','cost','rate','duration'];
  dayKeys.forEach(function(k) {
    if (_chartDayMode[k] && _chartInstances[k]) {
      if (_chartMonthIdx[k] < 0) _chartMonthIdx[k] = -1;
      zoomToMonth(_chartInstances[k], dayAgg, _chartMonthIdx[k]);
    }
  });
  
}
  
  // ===== 面板切换与 UI 刷新 =====
  var _historyPage = 0;                             // 历史记录当前页码
var _ds_last_toggle = 0;                          // 防抖时间戳
  function togglePanel() { console.log('[DS] togglePanel called, state.panelOpen=' + state.panelOpen);
    if (!isInitDone) return;
    if (Date.now() - _ds_last_toggle < 300) return;
    _ds_last_toggle = Date.now();
    var p = window.parent || window;
    var ov = p.document.getElementById('ds-overlay');
    var pn = p.document.getElementById('ds-panel');
    console.log('[DS] ov=' + !!ov + ' pn=' + !!pn + ' ov.opacity=' + (ov ? ov.style.opacity : 'N/A'));
    if (!ov || !pn) { console.log('[DS] recreateUI'); createUI(); return; }
    if (state.panelOpen) { 
      console.log('[DS] closing');
      ov.style.opacity = '0';
      ov.style.pointerEvents = 'none';
      pn.classList.remove('ds-open');
      state.panelOpen = false; 
    } else { 
      console.log('[DS] opening');
      ov.style.pointerEvents = 'auto';
      ov.style.opacity = '1';
      pn.classList.add('ds-open');
      state.panelOpen = true;
      requestAnimationFrame(function(){ syncViewportHeight(); refreshUI(); }); 
    }
  // ===== 刷新主面板 UI 数据（重新计算并填充 DOM） =====
  }function refreshUI() { var p = window.parent || window; var doc = p.document; var el = function(id) { return doc.getElementById(id); }; refreshSaveSelect(); refreshOverviewModelSelect(); var s = getSelectedSave(); if (!s) return; var ltc=0,lic=0,loc=0,lr=0; (s.history||[]).forEach(function(h){var u={timestamp:h.timestamp,model:h.model,prompt_cache_hit_tokens:h.cache_hit_tokens||0,prompt_cache_miss_tokens:h.cache_miss_tokens||0,completion_tokens:h.completion_tokens||0};var c=calcCost(u);h.cost=c.total;h.input_cost=c.input;h.output_cost=c.output;h.priceType=c.priceType;ltc+=c.total;lic+=c.input;loc+=c.output;if(isDeepSeekOfficialModel(h.model)){lr++}}); s.total_cost=ltc;s.input_cost=lic;s.output_cost=loc;s.rounds=lr; var om=state.overviewModel||'__all__'; var ovH=(s.history||[]).filter(function(h){return om==='__all__'||h.model===om;}); var ov={total_tokens:0,total_cost:0,input_tokens:0,output_tokens:0,cache_hit_tokens:0,cache_miss_tokens:0,input_cost:0,output_cost:0,rounds:0}; ovH.forEach(function(h){ov.total_tokens+=h.total_tokens||0;ov.total_cost+=h.cost||0;ov.input_tokens+=h.prompt_tokens||0;ov.output_tokens+=h.completion_tokens||0;ov.cache_hit_tokens+=h.cache_hit_tokens||0;ov.cache_miss_tokens+=h.cache_miss_tokens||0;ov.input_cost+=h.input_cost||0;ov.output_cost+=h.output_cost||0;if(isDeepSeekOfficialModel(h.model)){ov.rounds++}}); if (el('ds-save-time')) el('ds-save-time').textContent = state.currentSave === '__all__' ? '' : '开始于 ' + formatStartTime(s.startTime); if (el('ds-total-tokens')) el('ds-total-tokens').textContent = (ov.total_tokens || 0).toLocaleString(); if (el('ds-total-cost')) el('ds-total-cost').textContent = '\u00A5' + (ov.total_cost || 0).toFixed(4); if (el('ds-total-cache-hit')) el('ds-total-cache-hit').textContent = (ov.cache_hit_tokens || 0).toLocaleString(); if (el('ds-total-cache-miss')) el('ds-total-cache-miss').textContent = (ov.cache_miss_tokens || 0).toLocaleString(); if (el('ds-total-output')) el('ds-total-output').textContent = (ov.output_tokens || 0).toLocaleString(); if (el('ds-rounds')) el('ds-rounds').textContent = '基于 ' + (ov.rounds || 0) + ' 轮'; var tp = 0, th = 0; ovH.forEach(function(i) { tp += i.prompt_tokens || 0; th += i.cache_hit_tokens || 0; }); if (el('ds-weighted-rate')) el('ds-weighted-rate').textContent = (tp > 0 ? (th / tp * 100) : 0).toFixed(1) + '%'; if ((ov.rounds || 0) > 0) { if (el('ds-avg-tokens')) el('ds-avg-tokens').textContent = Math.round((ov.total_tokens || 0) / ov.rounds) + ' tokens'; var _durSum=0,_durCnt=0,_trSum=0,_trCnt=0;ovH.forEach(function(h){if(h.duration){_durSum+=h.duration;_durCnt++}if(h.tokenRate){_trSum+=h.tokenRate;_trCnt++}});if(el('ds-avg-duration'))el('ds-avg-duration').textContent=_durCnt>0?(_durSum/_durCnt/1000).toFixed(1)+'s':'--';if(el('ds-avg-tokenrate'))el('ds-avg-tokenrate').textContent=_trCnt>0?Math.round(_trSum/_trCnt)+' t/s':'--';if(el('ds-dur-dot')){if(_durCnt>0){var _ds=_durSum/_durCnt/1000;el('ds-dur-dot').style.background=_ds<30?'#34d399':_ds<60?'#fbbf24':'#f87171'}else{el('ds-dur-dot').style.background='#6b7280'}}if(el('ds-rate-dot')){if(_trCnt>0){var _tr=_trSum/_trCnt;el('ds-rate-dot').style.background=_tr>50?'#34d399':_tr>20?'#fbbf24':'#f87171'}else{el('ds-rate-dot').style.background='#6b7280'}}if(el('ds-cost-dot')){var _ac=parseFloat(el('ds-avg-cost').textContent.replace('¥',''))||0;el('ds-cost-dot').style.background=_ac<0.005?'#34d399':_ac<0.02?'#fbbf24':'#f87171'}if(el('ds-tokens-dot')){var _at=parseInt(el('ds-avg-tokens').textContent.replace(/[^0-9]/g,''))||0;el('ds-tokens-dot').style.background=_at<1000?'#34d399':_at<3000?'#fbbf24':'#f87171'}if (el('ds-avg-cost')) el('ds-avg-cost').textContent = '\u00A5' + ((ov.total_cost || 0) / ov.rounds).toFixed(4); } var sv = (ov.cache_hit_tokens || 0) * 0.98 / 1e6; if (el('ds-savings')) el('ds-savings').textContent = '\u00A5' + sv.toFixed(4); if (el('ds-savings-tokens')) el('ds-savings-tokens').textContent = (ov.cache_hit_tokens || 0).toLocaleString(); if (el('ds-input-cost')) el('ds-input-cost').textContent = '\u00A5' + (ov.input_cost || 0).toFixed(4); if (el('ds-input-tokens')) el('ds-input-tokens').textContent = (ov.input_tokens || 0).toLocaleString(); if (el('ds-output-cost')) el('ds-output-cost').textContent = '\u00A5' + (ov.output_cost || 0).toFixed(4); if (el('ds-output-tokens')) el('ds-output-tokens').textContent = (ov.output_tokens || 0).toLocaleString(); var be = el('ds-balance'); if (be) { var balText = '\u00A5'; if (state.customBalance !== null && state.customBalance !== '') { balText += parseFloat(state.customBalance).toFixed(2) + ' CNY'; } else if (state.balance && state.balance.balance) { balText += parseFloat(state.balance.balance).toFixed(2) + ' ' + state.balance.currency; } else { balText += '0.00 CNY'; } be.textContent = balText; } var rem = el('ds-balance-remaining'); if (rem) { var r = calculateRemainingRounds({ rounds: ov.rounds, total_cost: ov.total_cost, history: ovH }); rem.textContent = r !== null ? '预计还可进行 ' + r + ' 轮对话' : ''; } var PAGE_SIZE = 20; var totalPages = Math.ceil((s.history.length || 0) / PAGE_SIZE); if (_historyPage >= totalPages) _historyPage = Math.max(0, totalPages - 1); if (_historyPage < 0) _historyPage = 0; var startIdx = _historyPage * PAGE_SIZE; var pageItems = s.history.slice(startIdx, startIdx + PAGE_SIZE); if (s.history && s.history.length > 0 && el('ds-history')) { el('ds-history').innerHTML = pageItems.map(function(i, idx) {
              var t = new Date(i.timestamp).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); var _ds_hp = i.total_tokens > 0 ? (i.cache_hit_tokens / i.total_tokens * 100) : 0; var _ds_mp = i.total_tokens > 0 ? (i.cache_miss_tokens / i.total_tokens * 100) : 0; var _ds_hps = _ds_hp.toFixed(1); var _ds_mps = _ds_mp.toFixed(1); var _ds_ops = i.total_tokens > 0 ? (100 - parseFloat(_ds_hps) - parseFloat(_ds_mps)).toFixed(1) : '0.0';
              
              return '<div class="ds-history-item" style="padding:10px 12px;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px"><div style="display:flex;align-items:center;gap:6px;min-width:0"><span style="font-size:11px;color:#6b7280;font-weight:500;white-space:nowrap">#' + (s.history.length - 1 - (startIdx + idx)) + ' · ' + t + '</span><span class="ds-model-badge" style="font-size:10px;padding:2px 6px;border-radius:4px;background:#312e81;color:#a5b4fc;font-weight:500;white-space:nowrap">' + shortModelV2(i.model) + '</span>' + (isDeepSeekOfficialModel(i.model) ? (i.priceType === 'new-peak' ? '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:#f59e0b;color:#1c1917;font-weight:500">高峰</span>' : i.priceType === 'new-offpeak' ? '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:#374151;color:#9ca3af;font-weight:500">非高峰</span>' : '') : '') + '</div><div style="display:flex;align-items:center;gap:4px;flex-shrink:0"><button class="ds-btn-usage" data-ts="' + i.timestamp + '" style="padding:3px 6px;border:1px solid #374151;border-radius:4px;background:transparent;color:#9ca3af;font-size:10px;cursor:pointer;font-family:inherit" title="查看完整使用数据">📄</button><button class="ds-btn-compare ds-btn-compare-old" data-ts="' + i.timestamp + '" style="padding:3px 6px;border:1px solid #374151;border-radius:4px;background:transparent;color:#6366f1;font-size:10px;cursor:pointer;font-family:inherit">旧</button><button class="ds-btn-compare ds-btn-compare-new" data-ts="' + i.timestamp + '" style="padding:3px 6px;border:1px solid #374151;border-radius:4px;background:transparent;color:#a78bfa;font-size:10px;cursor:pointer;font-family:inherit">新</button></div></div><div style="background:#060a10;border-radius:6px;height:8px;overflow:hidden;margin-bottom:6px;display:flex"><div style="background:#34d399;width:' + _ds_hp + '%;height:100%;transition:width 0.3s"></div><div style="background:#fca5a5;width:' + _ds_mp + '%;height:100%;transition:width 0.3s"></div><div style="background:#a5b4fc;width:' + (i.total_tokens > 0 ? (100 - _ds_hp - _ds_mp) : 0) + '%;height:100%;transition:width 0.3s"></div></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;margin-bottom:6px"><div style="display:flex;gap:6px"><span style="color:#34d399;font-weight:500">' + _ds_hps + '%命中</span><span style="color:#fca5a5;font-weight:500">' + _ds_mps + '%未命中</span><span style="color:#a5b4fc;font-weight:500">' + _ds_ops + '%输出</span></div><span style="color:#e5e7eb;font-weight:600">' + i.total_tokens.toLocaleString() + 't</span></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:10px"><div style="display:flex;flex-wrap:wrap;gap:8px;color:#6b7280"><span>⏱' + (i.duration ? (i.duration / 1000).toFixed(1) + 's' : '--') + '</span><span>⚡' + (i.tokenRate ? i.tokenRate + 't/s' : '--') + '</span><span style="color:#34d399;font-weight:600">↑' + (i.prompt_tokens ? (i.prompt_tokens / 1000).toFixed(1) + 'k' : '--') + '</span><span style="color:#a5b4fc;font-weight:600">↓' + (i.completion_tokens ? (i.completion_tokens / 1000).toFixed(1) + 'k' : '--') + '</span></div><span style="color:#fbbf24;font-weight:700">¥' + (i.cost ? i.cost.toFixed(4) : '0.0000') + '</span></div></div>'; }).join('') + (totalPages > 1 ? '<div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid #374151"><button id="ds-page-prev" style="padding:5px 10px;border:1px solid #374151;border-radius:4px;background:' + (_historyPage > 0 ? '#0e1520;color:#e5e7eb' : 'transparent;color:#4b5563') + ';font-size:11px;cursor:' + (_historyPage > 0 ? 'pointer' : 'default') + ';font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif">◀ 上一页</button><span style="font-size:12px;color:#9ca3af;font-weight:500">第 ' + (_historyPage + 1) + '/' + totalPages + ' 页</span><button id="ds-page-next" style="padding:5px 10px;border:1px solid #374151;border-radius:4px;background:' + (_historyPage < totalPages - 1 ? '#0e1520;color:#e5e7eb' : 'transparent;color:#4b5563') + ';font-size:11px;cursor:' + (_historyPage < totalPages - 1 ? 'pointer' : 'default') + ';font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif">下一页 ▶</button></div>' : ''); if (totalPages > 1) { (function() { var p = window.parent || window; var d = p.document; var prv = d.getElementById('ds-page-prev'); var nxt = d.getElementById('ds-page-next'); if (prv) prv.onclick = function() { if (_historyPage > 0) { _historyPage--; refreshUI(); } }; if (nxt) nxt.onclick = function() { if (_historyPage < totalPages - 1) { _historyPage++; refreshUI(); } }; })(); } } else if (el('ds-history')) { el('ds-history').innerHTML = '<div style="text-align:center;padding:16px;color:#6b7280;font-weight:500;font-size:13px">暂无历史记录</div>'; } }
  
  
  // ===== 消息差异对比：选择新旧记录（高亮选中状态） =====
  window._dsHandleCompare = function(btn, role) {
    var _p = window.parent || window; var _doc = _p.document; var ts = btn.getAttribute('data-ts');
    if (role === 'old') {
      if (state.compareBefore === ts) { state.compareBefore = null; btn.style.background = 'transparent'; btn.style.color = '#6366f1'; return; }
      state.compareBefore = ts; btn.style.background = '#6366f1'; btn.style.color = '#fff';
      _doc.querySelectorAll('.ds-btn-compare-old').forEach(function(b) {
        if (b !== btn && b.getAttribute('data-ts') !== ts) { b.style.background = 'transparent'; b.style.color = '#6366f1'; }
      });
    } else {
      if (state.compareAfter === ts) { state.compareAfter = null; btn.style.background = 'transparent'; btn.style.color = '#a78bfa'; return; }
      state.compareAfter = ts; btn.style.background = '#a78bfa'; btn.style.color = '#fff';
      _doc.querySelectorAll('.ds-btn-compare-new').forEach(function(b) {
        if (b !== btn && b.getAttribute('data-ts') !== ts) { b.style.background = 'transparent'; b.style.color = '#a78bfa'; }
      });
    }
    if (state.compareBefore && state.compareAfter) {
      openComparePanel(state.compareBefore, state.compareAfter);
    }
  };

  // ===== 文本粒度差异渲染（高亮增删改部分） =====
  function renderGranularDiff(s1, s2, mode) {
    mode = mode || 'summary';
    var str1 = s1 || ''; var str2 = s2 || '';
    if (str1 === str2) return mode === 'summary' ? '<span class="ds-diff-ctx">' + str1.substring(0, 50) + '... (内容一致)</span>' : '<span class="ds-diff-ctx">' + str1 + '</span>';
    var prefixLen = 0;
    while (prefixLen < str1.length && prefixLen < str2.length && str1[prefixLen] === str2[prefixLen]) prefixLen++;
    var s1End = str1.length - 1, s2End = str2.length - 1, suffixLen = 0;
    while (s1End >= prefixLen && s2End >= prefixLen && str1[s1End] === str2[s2End]) { s1End--; s2End--; suffixLen++; }
    var removed = str1.substring(prefixLen, str1.length - suffixLen);
    var added = str2.substring(prefixLen, str2.length - suffixLen);
    function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    if (mode === 'old') {
      return esc(str1.substring(0, prefixLen)) + '<span class="ds-diff-del">' + esc(removed) + '</span>' + esc(str1.substring(str1.length - suffixLen));
    } else if (mode === 'new') {
      return esc(str2.substring(0, prefixLen)) + '<span class="ds-diff-ins">' + esc(added) + '</span>' + esc(str2.substring(str2.length - suffixLen));
    } else {
      var prefix = (prefixLen > 50 ? '...' : '') + esc(str1.substring(Math.max(0, prefixLen - 50), prefixLen));
      var suffix = esc(str1.substring(str1.length - suffixLen, Math.min(str1.length, str1.length - suffixLen + 50))) + (suffixLen > 50 ? '...' : '');
      return '<span class="ds-diff-ctx">' + prefix + '</span><span class="ds-diff-del">' + esc(removed.substring(0, 1000)) + '</span><span class="ds-diff-ins">' + esc(added.substring(0, 1000)) + '</span><span class="ds-diff-ctx">' + suffix + '</span>';
    }
  }

  // ===== 对比两条历史记录的差异（消息级别） =====
  function generateDiff(obj1, obj2) {
    
    var msg1 = (obj1 && obj1.messages) || [];
    var msg2 = (obj2 && obj2.messages) || [];
    var minLen = Math.min(msg1.length, msg2.length);
    function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // Find the first difference index
    var diffIdx = -1;
    for (var i = 0; i < minLen; i++) {
      var m1 = msg1[i]; var m2 = msg2[i];
      if (m1.role !== m2.role || m1.content !== m2.content) {
        diffIdx = i;
        break;
      }
    }

    // If arrays have different lengths, the excess is the divergence
    if (diffIdx === -1 && msg1.length !== msg2.length) {
      diffIdx = minLen;
    }

    if (diffIdx === -1) {
      // No difference found
      return ['<div style="text-align:center;padding:40px;color:#6b7280"><div style="font-size:14px;color:#34d399;margin-bottom:8px">✔ 完全一致</div><div style="font-size:12px">两次请求的输入消息完全相同，缓存应当全部命中</div></div>'];
    }

    var pct = diffIdx > 0 ? ' <span style="color:#6b7280;font-size:10px;font-weight:400">(前 ' + diffIdx + ' 条消息相同——缓存命中阶段)</span>' : '';

    var m1 = msg1[diffIdx];
    var m2 = msg2[diffIdx];
    var contentHtml = '';

    if (!m1 && m2) {
      // New message (only in new request)
      var content = m2.content || '';
      contentHtml =
        '<div class="ds-diff-header"><b>#' + diffIdx + ' ' + m2.role + ' <span style="color:#4ec9b0">[新增消息]</span></b></div>' +
        '<div class="ds-diff-block" style="margin-top:8px">' +
          '<div style="color:#6b7280;font-size:11px;margin-bottom:2px">旧请求 <span style="color:#ff6464">0 字</span></div>' +
          '<div style="color:#666;font-style:italic;font-size:13px;padding:6px 0">∅</div>' +
          '<div style="color:#6b7280;font-size:11px;margin:6px 0 2px">新请求 <span style="color:#34d399">' + content.length + ' 字</span></div>' +
          '<div style="color:#f3f4f6;font-size:13px;padding:6px 0;word-break:break-all">' + esc(content) + '</div>' +
        '</div>';
    } else if (m1 && !m2) {
      // Message removed
      var content = m1.content || '';
      contentHtml =
        '<div class="ds-diff-header"><b>#' + diffIdx + ' ' + m1.role + ' <span style="color:#ff6464">[消息消失]</span></b></div>' +
        '<div class="ds-diff-block" style="margin-top:8px">' +
          '<div style="color:#6b7280;font-size:11px;margin-bottom:2px">旧请求 <span style="color:#ff6464">' + content.length + ' 字</span></div>' +
          '<div style="color:#ff8888;font-size:13px;padding:6px 0;word-break:break-all">' + esc(content) + '</div>' +
          '<div style="color:#6b7280;font-size:11px;margin:6px 0 2px">新请求 <span style="color:#ff6464">0 字</span></div>' +
          '<div style="color:#666;font-style:italic;font-size:13px;padding:6px 0">∅</div>' +
        '</div>';
    } else {
      // Content changed
      var role = m2.role || m1.role;
      contentHtml =
        '<div class="ds-diff-header"><b>#' + diffIdx + ' ' + role + ' <span style="color:#a5b4fc">[内容变更]</span></b>' +
        '<button onclick="var p=this.parentElement.parentElement;p.querySelector(\'.ds-diff-full\').classList.toggle(\'open\')" style="padding:2px 8px;border:1px solid #374151;border-radius:4px;background:transparent;color:#9ca3af;font-size:10px;cursor:pointer;font-family:inherit">全文对比</button></div>' +
        '<div class="ds-diff-block" style="margin-top:8px">' + renderGranularDiff(m1 && m1.content, m2 && m2.content, 'summary') + '</div>' +
        '<div class="ds-diff-full"><div style="white-space:pre-wrap;word-break:break-all;margin-bottom:8px;color:#ff8888">' + renderGranularDiff(m1 && m1.content, m2 && m2.content, 'old') + '</div>' +
        '<hr style="border:0;border-top:1px dashed #374151;margin:8px 0">' +
        '<div style="white-space:pre-wrap;word-break:break-all;margin-top:8px;color:#34d399">' + renderGranularDiff(m1 && m1.content, m2 && m2.content, 'new') + '</div></div>';
    }

    var diffs = ['<div class="ds-diff-msg"><div class="ds-diff-header" style="margin-bottom:8px;border-bottom:1px solid #374151;padding-bottom:8px"><span style="color:#fbbf24;font-size:11px;font-weight:600">⚠️ 缓存差异起始点</span>' + pct + '</div>' + contentHtml + '</div>'];
    return diffs;
  }
  // ===== 打开差异对比面板 =====
  function openComparePanel(tsBefore, tsAfter) {
    
    var p = window.parent || window; var doc = p.document;
    var overlay = doc.getElementById('ds-compare-overlay'); var body = doc.getElementById('ds-compare-body');
    var panel = doc.querySelector('.ds-compare-panel');
    if (!overlay || !body || !panel) return;
    var s = getSelectedSave(); if (!s) return;
    var a = null, b = null;
    (s.history || []).forEach(function(h) {
      if (h.timestamp == tsBefore) a = h; if (h.timestamp == tsAfter) b = h;
    });
    
     if (!a || !b) { body.innerHTML = '<div class="ds-no-diff">请选择两条包含消息内容的记录</div>'; overlay.style.display = 'block'; panel.classList.add('ds-open'); return; }
    body.innerHTML = '<div class="ds-compare-info"><span><span class="ds-info-old">旧请求</span> #' + (s.history.indexOf(a) + 1) + ' \u00b7 ' + new Date(a.timestamp).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) + ' \u00b7 ' + a.model + '</span><span style="color:#6b7280">\u2192</span><span><span class="ds-info-new">新请求</span> #' + (s.history.indexOf(b) + 1) + ' \u00b7 ' + new Date(b.timestamp).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) + ' \u00b7 ' + b.model + '</span></div>';
    var diffs = generateDiff(a, b);
    diffs.forEach(function(html) { body.insertAdjacentHTML('beforeend', html); });
    overlay.style.display = 'block';
    requestAnimationFrame(function() { requestAnimationFrame(function() { panel.classList.add('ds-open'); try { var _pcr = panel.getBoundingClientRect();  } catch(e){} }); });
  }

  // ===== 关闭差异对比面板 =====
  function closeComparePanel() {
    var p = window.parent || window; var doc = p.document;
    var overlay = doc.getElementById('ds-compare-overlay');
    var panel = doc.querySelector('.ds-compare-panel');
    if (overlay) overlay.style.display = 'none';
    if (panel) panel.classList.remove('ds-open');
    state.compareBefore = null; state.compareAfter = null;
    doc.querySelectorAll('.ds-btn-compare-old, .ds-btn-compare-new').forEach(function(b) {
      var isOld = b.classList.contains('ds-btn-compare-old');
      b.style.background = 'transparent'; b.style.color = isOld ? '#6366f1' : '#a78bfa';
    });
  }


// ===== 显示使用详情弹窗 =====
function showUsageDetail(model, rawUsage) {
  var p = window.parent || window; var doc = p.document;
  function renderContent() {
    var card = function(title, obj) {
      if (!obj) return '<div style="margin-bottom:8px;padding:10px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="font-size:11px;color:#9ca3af;font-weight:500;margin-bottom:6px">' + title + '</div><div style="color:#6b7280;font-size:11px;font-style:italic">无数据</div></div>';
      var json = JSON.stringify(obj, null, 2);
      var isLong = json.length > 500;
      var id = 'ds-detail-' + title.replace(/\s+/g, '-');
      return '<div style="margin-bottom:8px;padding:10px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:11px;color:#9ca3af;font-weight:500">' + title + '</span>' + (isLong ? '<span id="' + id + '-toggle" style="font-size:10px;color:#6366f1;cursor:pointer">展开</span>' : '') + '</div><pre style="margin:0;font-size:11px;line-height:1.5;color:#d1d5db;white-space:pre-wrap;word-break:break-all;' + (isLong ? 'max-height:200px;overflow:hidden' : '') + '">' + json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre></div>';
    };
    var ts = rawUsage.timestamp ? new Date(rawUsage.timestamp).toLocaleString('zh-CN') : '';
    var tokenInfo = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;font-size:11px">' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">模型</div><div style="color:#a5b4fc;font-weight:600">' + (rawUsage.model || model) + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">时间</div><div style="color:#e5e7eb">' + ts + '</div></div>' +
      (rawUsage.duration ? '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">耗时</div><div style="color:#60a5fa">' + (rawUsage.duration/1000).toFixed(1) + 's</div></div>' : '') + (rawUsage.ttft ? '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px" title="从请求发出到思维链首个字符输出的时间"><div style="color:#6b7280">首字延迟</div><div style="color:#34d399">' + (rawUsage.ttft/1000).toFixed(1) + 's</div></div>' : '') + (rawUsage.thinkTime ? '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px" title="从思维链首字到末字的持续时间"><div style="color:#6b7280">思维链耗时</div><div style="color:#c084fc">' + (rawUsage.thinkTime/1000).toFixed(1) + 's</div></div>' : '') + (rawUsage.thinkTokens ? '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px" title="思维链（reasoning_content）消耗的 Token 数"><div style="color:#6b7280">思维链 Token</div><div style="color:#c084fc">' + (rawUsage.thinkTokens).toLocaleString() + '</div></div>' : '') +
      (rawUsage.tokenRate ? '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">速率</div><div style="color:#fbbf24">' + rawUsage.tokenRate + ' t/s</div></div>' : '') +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">时段</div><div style="color:' + (rawUsage.priceType === 'new-peak' ? '#f59e0b' : rawUsage.priceType === 'new-offpeak' ? '#9ca3af' : '#6b7280') + '">' + (rawUsage.priceType === 'new-peak' ? '🔴 高峰' : rawUsage.priceType === 'new-offpeak' ? '🟢 非高峰' : '⚪ 旧价格') + '</div></div>' +
      '</div>';
    var costInfo = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;font-size:11px">' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">缓存命中</div><div style="color:#34d399">' + (rawUsage.cache_hit_tokens || 0).toLocaleString() + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">缓存未命中</div><div style="color:#fca5a5">' + (rawUsage.cache_miss_tokens || 0).toLocaleString() + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">输出 Token</div><div style="color:#a5b4fc">' + (rawUsage.completion_tokens || 0).toLocaleString() + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">总 Token</div><div style="color:#f3f4f6;font-weight:600">' + (rawUsage.total_tokens || 0).toLocaleString() + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">输入费用</div><div style="color:#fbbf24">¥' + (rawUsage.input_cost || 0).toFixed(6) + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px"><div style="color:#6b7280">输出费用</div><div style="color:#fbbf24">¥' + (rawUsage.output_cost || 0).toFixed(6) + '</div></div>' +
      '<div style="padding:8px;background:#060a10;border:1px solid #374151;border-radius:6px;grid-column:1/-1"><div style="color:#6b7280">总费用</div><div style="color:#fbbf24;font-weight:700;font-size:13px">¥' + (rawUsage.cost || 0).toFixed(6) + '</div></div>' +
      '</div>';
    var sections = tokenInfo + costInfo;
    sections += card('请求参数 (Request Body)', rawUsage.fullRequest);
    sections += card('API 完整响应 (Full Response)', rawUsage.fullResponse);
    sections += card('原始 Token 用量 (Raw Usage)', rawUsage.raw_usage);
    sections += card('消息内容 (Messages)', rawUsage.messages);
    return sections;
  }
  var isMobile = p.innerWidth <= 480;
  var headerStyle = isMobile ? 'padding:12px 16px;border-bottom:1px solid #374151;display:flex;justify-content:space-between;align-items:center;flex-shrink:0' : 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #374151';
  var bodyStyle = isMobile ? 'padding:12px;flex:1;overflow-y:auto' : 'overflow-y:auto';
  var contentHtml = '<div style="' + headerStyle + '"><span style="font-weight:600;font-size:14px">使用详情 — ' + model + '</span><div id="ds-usage-close" style="width:28px;height:28px;background:#374151;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:#9ca3af;flex-shrink:0;margin-left:auto">✕</div></div><div style="' + bodyStyle + '">' + renderContent() + '</div>';
  var existingOverlay = doc.getElementById('ds-usage-overlay');
  var existingPanel = doc.getElementById('ds-usage-panel');
  if (existingOverlay && existingPanel) {
    existingPanel.innerHTML = contentHtml;
    existingOverlay.style.display = 'block';
    doc.getElementById('ds-usage-close').onclick = closeUsageDetail;
    existingPanel.querySelectorAll('[id$="-toggle"]').forEach(function(el) {
      el.onclick = function() {
        var pre = this.parentElement.nextElementSibling;
        if (pre) {
          var isCollapsed = pre.style.maxHeight !== 'none';
          pre.style.maxHeight = isCollapsed ? 'none' : '200px';
          this.textContent = isCollapsed ? '收起' : '展开';
        }
      };
    });
    requestAnimationFrame(function() { requestAnimationFrame(function() { existingPanel.classList.add('ds-open'); }); });
    return;
  }
  var overlay = doc.createElement('div'); overlay.id = 'ds-usage-overlay'; overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:999999;display:block;';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeUsageDetail(); });
  var panel = doc.createElement('div'); panel.id = 'ds-usage-panel';
  panel.style.cssText = 'position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);z-index:999999;background:#0e1520;font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;color:#e5e7eb;opacity:0;pointer-events:none;box-sizing:border-box';
  panel.innerHTML = contentHtml;
  doc.body.appendChild(overlay); doc.body.appendChild(panel);
  if (!doc.getElementById('ds-usage-css')) {
    var dsUS = doc.createElement('style'); dsUS.id = 'ds-usage-css';
    dsUS.textContent = '@media(max-width:480px){#ds-usage-panel{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;max-height:none!important;border-radius:0!important;border:none!important;box-shadow:none!important;padding:0!important;transform:translateY(100%)!important;opacity:0!important;pointer-events:none!important;transition:transform 0.2s ease,opacity 0.2s ease!important;display:flex!important;flex-direction:column!important;overflow:hidden!important}#ds-usage-panel.ds-open{transform:translateY(0)!important;opacity:1!important;pointer-events:auto!important}}@media(min-width:481px){#ds-usage-panel{border:1px solid #374151!important;border-radius:12px 12px 0 0!important;padding:16px!important;box-shadow:0 20px 60px rgba(0,0,0,0.5)!important;width:min(580px,calc(100vw - 32px))!important;max-height:65vh!important;overflow-y:auto!important;max-width:calc(100vw - 32px)!important;transition:transform 0.3s ease,opacity 0.3s ease!important}#ds-usage-panel.ds-open{transform:translateX(-50%) translateY(0)!important;opacity:1!important;pointer-events:auto!important}}';
    doc.head.appendChild(dsUS);
  }
  doc.getElementById('ds-usage-close').addEventListener('click', closeUsageDetail);
  panel.querySelectorAll('[id$="-toggle"]').forEach(function(el) {
    el.onclick = function() {
      var pre = this.parentElement.nextElementSibling;
      if (pre) {
        var isCollapsed = pre.style.maxHeight !== 'none';
        pre.style.maxHeight = isCollapsed ? 'none' : '200px';
        this.textContent = isCollapsed ? '收起' : '展开';
      }
    };
  });
  doc.addEventListener('keydown', function _dsEsc(e) { if (e.key === 'Escape') { closeUsageDetail(); doc.removeEventListener('keydown', _dsEsc); } });
  requestAnimationFrame(function() { requestAnimationFrame(function() { panel.classList.add('ds-open'); }); });
}
function closeUsageDetail() {
  var p = window.parent || window; var doc = p.document;
  var overlay = doc.getElementById('ds-usage-overlay');
  var panel = doc.getElementById('ds-usage-panel');
  if (overlay) overlay.style.display = 'none';
  if (panel) panel.classList.remove('ds-open');
}

// ===== 导出接口供外部调试访问 =====
window.DeepSeekStats = { state: state, togglePanel: togglePanel, refreshUI: refreshUI, queryBalance: queryBalance };
(window.parent || window).showUsageDetail = showUsageDetail;
(window.parent || window).closeUsageDetail = closeUsageDetail;
  // 延迟 2 秒初始化，确保酒馆和酒馆助手接口已就绪
  setTimeout(init, 2000);
})();

