// custom_nodes/ComfyUI-ZML-Image/zml_w/web/js/zml_prompt_ui.js

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el } from "/scripts/ui.js";

// --- START: 美化样式 (已更新布局) ---
const ZML_PROMPT_UI_STYLES = `
:root {
    --zml-bg-color: #282c34;
    --zml-modal-bg-color: #313642;
    --zml-secondary-bg-color: #3c4250;
    --zml-input-bg-color: #262a32;
    --zml-border-color: #4a5162;
    --zml-text-color: #e0e2e6;
    --zml-text-color-secondary: #a0a6b3;
    --zml-accent-color: #00aaff;
    --zml-accent-hover-color: #33bbff;
    --zml-green-color: #6a6;
    --zml-red-color: #e57373;
    --zml-yellow-color: #ffeb3b;
    --zml-font-family: 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
    --zml-border-radius: 6px;
}

.zml-prompt-ui-backdrop {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.8); z-index: 999;
}

.zml-prompt-ui-modal, .zml-prompt-ui-dialog {
    font-family: var(--zml-font-family); color: var(--zml-text-color);
    background-color: var(--zml-modal-bg-color); border: 1px solid var(--zml-border-color);
    border-radius: var(--zml-border-radius); box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    transition: background-color 0.3s, color 0.3s, border-color 0.3s;
}

.zml-prompt-ui-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 95vw; height: 95vh; max-width: 1400px; max-height: 900px;
    z-index: 1001; display: flex; flex-direction: column;
    padding: 20px; gap: 10px; /* 减少全局间隙 */
}

.zml-prompt-ui-header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px; border-bottom: 1px solid var(--zml-border-color);
    position: relative; flex-shrink: 0;
}
.zml-prompt-ui-header-title { font-size: 1.5em; font-weight: 500; }
.zml-prompt-ui-header-controls { display: flex; gap: 10px; align-items: center; }

/* --- 按钮通用样式 --- */
.zml-prompt-ui-btn {
    padding: 8px 14px; border: none; border-radius: var(--zml-border-radius);
    cursor: pointer; font-size: 0.9em; font-weight: 500;
    transition: background-color 0.2s, color 0.2s, transform 0.1s, box-shadow 0.2s;
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
}
.zml-prompt-ui-btn:active { transform: scale(0.97); }
.zml-prompt-ui-btn.confirm-btn { min-width: 120px; box-shadow: 0 0 10px var(--zml-accent-color); }

.zml-prompt-ui-btn-primary { background-color: var(--zml-accent-color); color: white; }
.zml-prompt-ui-btn-primary:hover { background-color: var(--zml-accent-hover-color); }

.zml-prompt-ui-btn-secondary { background-color: var(--zml-secondary-bg-color); color: var(--zml-text-color); }
.zml-prompt-ui-btn-secondary:hover { background-color: #4f586a; }

.zml-prompt-ui-btn-danger { background-color: #c55; color: white; }
.zml-prompt-ui-btn-danger:hover { background-color: #d66; }

.zml-prompt-ui-btn-warn { background-color: #8a6d3b; color: white; }
.zml-prompt-ui-btn-warn:hover { background-color: #a1804a; }

.zml-prompt-ui-btn-add { background-color: var(--zml-green-color); color: white; }
.zml-prompt-ui-btn-add:hover { background-color: #7dbe7d; }

.zml-prompt-ui-btn-edit.active { background-color: var(--zml-accent-color); color: white; }

/* --- 主题选择器 --- */
.zml-theme-selector { display: flex; align-items: center; gap: 8px; margin-right: 10px; }
.zml-theme-ball {
    width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
    border: 2px solid transparent; transition: all 0.2s;
}
.zml-theme-ball:hover { transform: scale(1.1); }
.zml-theme-ball.active { border-color: var(--zml-accent-color); box-shadow: 0 0 8px var(--zml-accent-color); }

/* --- 已选标签区域 --- */
.zml-prompt-ui-display-area {
    display: flex; flex-direction: column; gap: 10px; flex-shrink: 0;
}
.zml-prompt-ui-tag-display-wrapper {
    display: flex; align-items: center; gap: 10px; background-color: var(--zml-input-bg-color);
    border: 1px solid var(--zml-border-color); border-radius: var(--zml-border-radius); padding: 0 8px;
}
.zml-prompt-ui-tag-display {
    min-height: 50px; flex-grow: 1; display: flex; flex-wrap: nowrap;
    gap: 8px; align-items: center; overflow-x: auto; padding: 8px 0;
}
/* 美化滚动条 */
.zml-prompt-ui-tag-display::-webkit-scrollbar, .zml-prompt-ui-tag-area::-webkit-scrollbar { width: 8px; height: 8px; }
.zml-prompt-ui-tag-display::-webkit-scrollbar-track, .zml-prompt-ui-tag-area::-webkit-scrollbar-track { background: transparent; }
.zml-prompt-ui-tag-display::-webkit-scrollbar-thumb, .zml-prompt-ui-tag-area::-webkit-scrollbar-thumb { background: var(--zml-secondary-bg-color); border-radius: 4px; }
.zml-prompt-ui-tag-display::-webkit-scrollbar-thumb:hover, .zml-prompt-ui-tag-area::-webkit-scrollbar-thumb:hover { background: #4f586a; }

/* --- 已选标签项 (通用) --- */
.zml-prompt-ui-selected-tag {
    padding: 8px 10px; border-radius: var(--zml-border-radius); background-color: var(--zml-secondary-bg-color);
    text-align: center; position: relative; overflow: hidden; cursor: pointer; transition: all 0.2s; flex-shrink: 0;
}
.zml-prompt-ui-selected-tag .name { font-weight: bold; font-size: 0.9em; color: var(--zml-yellow-color); white-space: nowrap; }
.zml-prompt-ui-selected-tag .prompt { font-size: 0.75em; color: var(--zml-text-color-secondary); white-space: nowrap; }
.zml-prompt-ui-selected-tag-controls {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.7); display: flex; justify-content: space-around;
    align-items: center; opacity: 0; transition: opacity 0.2s;
}
.zml-prompt-ui-selected-tag:hover .zml-prompt-ui-selected-tag-controls { opacity: 1; }
.zml-prompt-ui-selected-tag-controls button { background: none; border: none; color: white; font-size: 1.5em; cursor: pointer; padding: 0 10px; transition: color 0.2s; }
.zml-prompt-ui-selected-tag-controls button.plus:hover { color: var(--zml-green-color); }
.zml-prompt-ui-selected-tag-controls button.minus:hover { color: var(--zml-red-color); }
.zml-prompt-ui-selected-tag-remove-btn {
    position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; line-height: 18px;
    text-align: center; background-color: var(--zml-red-color); color: white; border-radius: 50%;
    font-size: 14px; cursor: pointer; transform: scale(0); transition: transform 0.2s;
}
.zml-prompt-ui-selected-tag:hover .zml-prompt-ui-selected-tag-remove-btn { transform: scale(1); }

/* --- 控制按钮区域 --- */
.zml-prompt-ui-main-controls { display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-shrink: 0; }
.zml-prompt-ui-main-controls-comment { color: var(--zml-text-color-secondary); font-size: 0.9em; }

/* --- 导航和标签区域 (布局调整) --- */
.zml-prompt-ui-nav-container { 
    padding: 5px 0; /* 减少垂直内边距 */
    border-bottom: 1px solid var(--zml-border-color); 
    display: flex; align-items: center; gap: 10px; flex-shrink: 0; 
}
.zml-prompt-ui-nav-tabs { display: flex; flex-wrap: wrap; gap: 8px; flex-grow: 1; }
.zml-prompt-ui-nav-btn {
    padding: 8px 12px; cursor: pointer; border: 1px solid transparent; border-radius: var(--zml-border-radius);
    background-color: var(--zml-secondary-bg-color); color: var(--zml-text-color-secondary);
    transition: all 0.2s; position: relative;
}
.zml-prompt-ui-nav-btn:hover { background-color: #4f586a; color: var(--zml-text-color); }
.zml-prompt-ui-nav-btn.active { background-color: var(--zml-accent-color); color: white; font-weight: 500; }
.zml-prompt-ui-edit-delete-btn {
    position: absolute; top: -8px; right: -8px; background-color: var(--zml-red-color);
    color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; font-size: 14px; cursor: pointer; transform: scale(0.9);
    opacity: 0.8; transition: all 0.2s;
}
.zml-prompt-ui-nav-btn:hover .zml-prompt-ui-edit-delete-btn { transform: scale(1); opacity: 1; }

.zml-prompt-ui-tag-area { flex-grow: 1; overflow-y: auto; padding-right: 10px; }
.zml-prompt-ui-group-container { margin-bottom: 20px; padding: 15px; background-color: var(--zml-input-bg-color); border-radius: var(--zml-border-radius); }
.zml-prompt-ui-group-header { margin-top: 0; margin-bottom: 15px; color: var(--zml-text-color); font-size: 1.2em; font-weight: 500; position: relative; display: flex; align-items: center; gap: 15px; }
.zml-prompt-ui-group-controls { display: flex; align-items: center; gap: 8px; position: absolute; right: 0; top: 50%; transform: translateY(-50%); flex-wrap: nowrap; }
.zml-prompt-ui-group-controls span { font-size: 0.8em; color: var(--zml-text-color-secondary); white-space: nowrap; }
.zml-prompt-ui-group-controls input[type="color"] { width: 24px; height: 24px; border: none; padding: 0; cursor: pointer; background-color: transparent; border-radius: 4px; }
.zml-prompt-ui-group-controls input[type="number"] { width: 50px; background-color: var(--zml-bg-color); color: var(--zml-text-color); border: 1px solid var(--zml-border-color); border-radius: 4px; padding: 2px 5px; }
.zml-prompt-ui-group-delete-btn { color: var(--zml-red-color); font-size: 1.5em; cursor: pointer; margin-left: -5px; transition: color 0.2s; }
.zml-prompt-ui-group-delete-btn:hover { color: #f79090; }

.zml-prompt-ui-prompt-container { display: flex; flex-wrap: wrap; gap: 8px; }
.zml-prompt-ui-prompt-btn {
    border-radius: var(--zml-border-radius); cursor: pointer; border: 1px solid var(--zml-border-color);
    text-align: center; display: flex; flex-direction: column; justify-content: center;
    align-items: center; height: 50px; overflow: hidden; position: relative;
    transition: background-color 0.2s, border-color 0.2s;
}
.zml-prompt-ui-prompt-btn .name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zml-prompt-ui-prompt-btn .prompt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* --- 弹窗样式 --- */
.zml-prompt-ui-dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1002;
    width: auto; min-width: 350px; max-width: 80vw; padding: 25px;
    display: flex; flex-direction: column; gap: 15px;
}
.zml-prompt-ui-dialog-title { margin: 0; text-align: center; font-size: 1.3em; font-weight: 500; }
.zml-prompt-ui-dialog label { display: block; margin-bottom: 5px; color: var(--zml-text-color-secondary); }
.zml-prompt-ui-dialog input, .zml-prompt-ui-dialog select, .zml-prompt-ui-dialog textarea {
    width: 100%; padding: 8px 10px; background-color: var(--zml-input-bg-color);
    border: 1px solid var(--zml-border-color); color: var(--zml-text-color);
    border-radius: var(--zml-border-radius); box-sizing: border-box; font-size: 1em;
}
.zml-prompt-ui-dialog-buttons { display: flex; gap: 10px; margin-top: 10px; justify-content: flex-end; }
.zml-prompt-ui-choice-buttons { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 10px; }
.zml-prompt-ui-choice-separator { width: 100%; border: 0; height: 1px; background-color: var(--zml-border-color); margin: 5px 0; }
#zml-view-tags-container { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px; background-color: var(--zml-input-bg-color); border-radius: var(--zml-border-radius); max-height: 60vh; overflow-y: auto; }
`;
// --- END: 美化样式 ---

const PROMPT_API_PREFIX = "/zml";
const CHINESE_TEXT_COLOR = "#b2e066";
const INACTIVE_BUTTON_BG = "#3c4250";
const ACTIVE_BUTTON_BG = "#00aaff";

const THEMES = {
    blue: { name: '天空蓝', color: '#3a5a9a', vars: { '--zml-bg-color': '#2c3e50', '--zml-modal-bg-color': '#34495e', '--zml-secondary-bg-color': '#4a6fa5', '--zml-input-bg-color': '#283747', '--zml-border-color': '#5d7bb2', '--zml-text-color': '#ecf0f1', '--zml-text-color-secondary': '#bdc3c7' } },
    green: { name: '抹茶绿', color: '#4CAF50', vars: { '--zml-bg-color': '#2e463c', '--zml-modal-bg-color': '#385449', '--zml-secondary-bg-color': '#4CAF50', '--zml-input-bg-color': '#263a31', '--zml-border-color': '#5a7e6b', '--zml-text-color': '#e8f5e9', '--zml-text-color-secondary': '#c8e6c9' } },
    yellow: { name: '活力黄', color: '#FFC107', vars: { '--zml-bg-color': '#53431b', '--zml-modal-bg-color': '#614d20', '--zml-secondary-bg-color': '#7a622a', '--zml-input-bg-color': '#4a3b16', '--zml-border-color': '#8a723a', '--zml-text-color': '#fffde7', '--zml-text-color-secondary': '#fff9c4' } },
    black: { name: '深邃黑', color: '#313642', vars: { '--zml-bg-color': '#282c34', '--zml-modal-bg-color': '#313642', '--zml-secondary-bg-color': '#3c4250', '--zml-input-bg-color': '#262a32', '--zml-border-color': '#4a5162', '--zml-text-color': '#e0e2e6', '--zml-text-color-secondary': '#a0a6b3' } },
    white: { name: '象牙白', color: '#e0e0e0', vars: { '--zml-bg-color': '#dcdcdc', '--zml-modal-bg-color': '#ebebeb', '--zml-secondary-bg-color': '#d6d6d6', '--zml-input-bg-color': '#f5f5f5', '--zml-border-color': '#c0c0c0', '--zml-text-color': '#333333', '--zml-text-color-secondary': '#555555' } },
};
const DEFAULT_THEME = 'blue';

let translationMap = new Map();
let historyStack = [];
let currentData = null;
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let isEditMode = false;
let stylesInjected = false;

function injectStyles() {
    if (!stylesInjected) {
        document.head.appendChild($el("style", { id: "zml-prompt-ui-styles", textContent: ZML_PROMPT_UI_STYLES }));
        stylesInjected = true;
    }
}

function showInputDialog(title, inputs, onConfirm) { /* ... 此函数未改变 ... */ 
    const backdrop = $el("div", { className: "zml-prompt-ui-backdrop" });
    const dialog = $el("div", { className: "zml-prompt-ui-dialog" });
    const dialogTitle = $el("h3", { textContent: title, className: "zml-prompt-ui-dialog-title" });
    dialog.appendChild(dialogTitle);
    const inputElements = {};
    inputs.forEach(input => { dialog.append($el("label", { textContent: input.label }), inputElements[input.id] = $el("input", { type: "text", placeholder: input.placeholder })); });
    const closeDialog = () => { backdrop.remove(); dialog.remove(); };
    const confirmBtn = $el("button", { textContent: "确认", className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary", onclick: () => { const v = {}; for (const id in inputElements) { v[id] = inputElements[id].value; } onConfirm(v); closeDialog(); }});
    const cancelBtn = $el("button", { textContent: "取消", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: closeDialog });
    dialog.appendChild($el("div", { className: "zml-prompt-ui-dialog-buttons" }, [confirmBtn, cancelBtn]));
    document.body.append(backdrop, dialog);
    backdrop.onclick = closeDialog;
}

function showChoiceDialog(title, choices, onConfirm) { /* ... 此函数未改变 ... */
    const backdrop = $el("div", { className: "zml-prompt-ui-backdrop" });
    const dialog = $el("div", { className: "zml-prompt-ui-dialog" });
    const dialogTitle = $el("h3", { textContent: title, className: "zml-prompt-ui-dialog-title" });
    dialog.appendChild(dialogTitle);
    const closeDialog = () => { backdrop.remove(); dialog.remove(); };
    const choiceButtonsContainer = $el("div", { className: "zml-prompt-ui-choice-buttons" });
    choices.forEach(choice => {
        if (choice === "---") { choiceButtonsContainer.appendChild($el("hr", { className: "zml-prompt-ui-choice-separator" })); } 
        else {
            const isDanger = choice.includes("应用");
            const btnClass = isDanger ? "zml-prompt-ui-btn-danger" : "zml-prompt-ui-btn-primary";
            choiceButtonsContainer.appendChild($el("button", { textContent: choice, className: `zml-prompt-ui-btn ${btnClass}`, onclick: () => { onConfirm(choice); closeDialog(); } }));
        }
    });
    dialog.appendChild(choiceButtonsContainer);
    dialog.appendChild($el("button", { textContent: "取消", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", style: { width: "100%" }, onclick: closeDialog }));
    document.body.append(backdrop, dialog);
    backdrop.onclick = closeDialog;
}

function showSelectedTagsDialog(currentPrompts, translationMap) { /* ... 此函数未改变 ... */
    const backdrop = $el("div", { className: "zml-prompt-ui-backdrop" });
    const dialog = $el("div", { className: "zml-prompt-ui-dialog", style: { minWidth: '600px' } });
    const dialogTitle = $el("h3", { textContent: "当前已选提示词", className: "zml-prompt-ui-dialog-title" });
    const tagsContainer = $el("div", { id: "zml-view-tags-container" });
    currentPrompts.forEach((weight, prompt) => {
        const name = translationMap.get(prompt) || prompt;
        const tagEl = $el("div", { className: "zml-prompt-ui-selected-tag" });
        tagEl.innerHTML = `<div class="name">${name}</div><div class="prompt">${weight === 1.0 ? prompt : `(${prompt}:${weight.toFixed(1)})`}</div>`;
        tagsContainer.appendChild(tagEl);
    });
    const closeDialog = () => { backdrop.remove(); dialog.remove(); };
    const copyBtn = $el("button", { textContent: "一键复制", className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary", onclick: () => {
        const promptString = Array.from(currentPrompts.entries()).map(([p, w]) => w === 1.0 ? p : `(${p}:${w.toFixed(1)})`).join(', ');
        navigator.clipboard.writeText(promptString).then(() => { const o = copyBtn.textContent; copyBtn.textContent = "已复制!"; setTimeout(() => { copyBtn.textContent = o; }, 1000); });
    }});
    const closeBtn = $el("button", { textContent: "关闭", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: closeDialog });
    dialog.append(dialogTitle, tagsContainer, $el("div", { className: "zml-prompt-ui-dialog-buttons" }, [copyBtn, closeBtn]));
    document.body.append(backdrop, dialog);
    backdrop.onclick = closeDialog;
}

async function savePromptsToBackend(data) { /* ... 此函数未改变 ... */ 
    try { await api.fetchApi(`${PROMPT_API_PREFIX}/save_prompts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); console.log("Prompts saved automatically."); } 
    catch (error) { console.error("Error saving prompts automatically:", error); }
}

function createPromptModal(node) {
    injectStyles();
    const backdrop = $el("div", { className: "zml-prompt-ui-backdrop" });
    const modal = $el("div", { className: "zml-prompt-ui-modal" });
    let currentTheme = DEFAULT_THEME;
    const themeBalls = {};
    const applyTheme = (themeKey) => { /* ... 此函数未改变 ... */
        const theme = THEMES[themeKey]; if (!theme) return;
        for (const [key, value] of Object.entries(theme.vars)) { modal.style.setProperty(key, value); }
        for(const key in themeBalls) { themeBalls[key].classList.toggle('active', key === themeKey); }
        currentTheme = themeKey;
    };

    const headerTitle = $el("div", { textContent: "ZML 标签化提示词", className: "zml-prompt-ui-header-title" });
    const themeSelector = $el("div", { className: 'zml-theme-selector' });
    for (const key in THEMES) {
        const theme = THEMES[key];
        themeBalls[key] = $el('div', { className: `zml-theme-ball ${key === currentTheme ? 'active' : ''}`, title: theme.name, style: { backgroundColor: theme.color }, onclick: () => applyTheme(key) });
        themeSelector.appendChild(themeBalls[key]);
    }
    const resetThemeBtn = $el("button", { textContent: "恢复默认", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: () => applyTheme(DEFAULT_THEME) });
    const refreshBtn = $el("button", { textContent: "刷新", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: () => { closeUI(); createPromptModal(node); }});
    const closeUI = () => { backdrop.remove(); modal.remove(); };
    const confirmBtn = $el("button", { textContent: "确定", className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary confirm-btn", onclick: closeUI });
    const header = $el("div", { className: "zml-prompt-ui-header" }, [headerTitle, $el("div", {className: "zml-prompt-ui-header-controls"}, [themeSelector, resetThemeBtn, refreshBtn, confirmBtn])]);
    
    // 定义translationMap作为Map对象，用于存储英文提示词到中文翻译的映射
    const translationMap = new Map();
    
    const tagDisplay = $el("div", { className: "zml-prompt-ui-tag-display" });
    const viewBtn = $el("button", { textContent: "查看", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: () => { showSelectedTagsDialog(currentPrompts, translationMap); }});
    const tagDisplayWrapper = $el("div", { className: "zml-prompt-ui-tag-display-wrapper" }, [ tagDisplay, viewBtn ]);
    
    const undoBtn = $el("button", { textContent: "撤回", className: "zml-prompt-ui-btn zml-prompt-ui-btn-warn" });
    const importBtn = $el("button", { textContent: "批量导入", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary" });
    const editModeBtn = $el("button", { textContent: "编辑模式", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary zml-prompt-ui-btn-edit" });
    const copyBtn = $el("button", { textContent: "一键复制", className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary" });
    const clearBtn = $el("button", { textContent: "一键清空", className: "zml-prompt-ui-btn zml-prompt-ui-btn-danger" });
    // 搜索框和搜索按钮
    const searchInput = $el("input", {
        id: "zml-search-input",
        type: "text", 
        placeholder: "搜索提示词...",
        style: {
            padding: "6px 12px",
            backgroundColor: "var(--zml-input-bg-color)",
            border: "1px solid var(--zml-border-color)",
            borderRadius: "var(--zml-border-radius)",
            color: "var(--zml-text-color)",
            fontSize: "14px",
            boxSizing: "border-box",
            minWidth: "180px"
        }
    });
    const searchBtn = $el("button", {
        id: "zml-search-btn",
        textContent: "搜索", 
        className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary",
        style: {
            marginLeft: "8px",
            height: "32px"
        }
    });

    // 搜索结果容器
    const searchResultsContainer = $el("div", {
        className: "zml-search-results-container",
        style: {
            display: "none",
            position: "absolute",
            top: "100%",
            right: "0",
            backgroundColor: "var(--zml-modal-bg-color)",
            border: "1px solid var(--zml-border-color)",
            borderRadius: "var(--zml-border-radius)",
            maxHeight: "300px",
            overflowY: "auto",
            zIndex: 1000, // 提高z-index确保在最上层显示
            minWidth: "300px",
            boxShadow: "0 5px 15px rgba(0,0,0,0.3)",
            margin: "5px 0 0 0"
        }
    });

    // 实现搜索功能
    function performSearch(query) {
        console.log("开始搜索，currentData:", currentData ? currentData.length : "null");
        if (!query || !currentData || !Array.isArray(currentData)) {
            console.log("搜索条件不满足");
            return [];
        }
        
        const results = [];
        query = query.toLowerCase().trim();
        console.log("搜索关键词:", query);
        
        // 遍历所有分类和分组搜索
        for (let i = 0; i < currentData.length; i++) {
            const category = currentData[i];
            if (!category || !category.groups) continue;
            
            for (let j = 0; j < category.groups.length; j++) {
                const group = category.groups[j];
                if (!group || !group.tags) continue;
                
                for (const [prompt, name] of Object.entries(group.tags)) {
                    // 搜索英文提示词或中文翻译，确保正确处理空值
                    const promptStr = String(prompt || '').toLowerCase();
                    const nameStr = String(name || '').toLowerCase();
                    const queryStr = String(query).toLowerCase();
                    
                    console.log(`检查提示词: prompt=${promptStr}, name=${nameStr}, query=${queryStr}`);
                    
                    // 增强的搜索逻辑：同时检查英文提示词和中文名称
                    if (promptStr.includes(queryStr) || nameStr.includes(queryStr)) {
                        results.push({
                            prompt: prompt,
                            name: name,
                            category: category.name || '未知分类',
                            group: group.name || '未知分组'
                        });
                        console.log("找到匹配:", prompt, name);
                    }
                }
            }
        }
        
        console.log("搜索完成，结果数量:", results.length);
        return results;
    }

    // 渲染搜索结果
    function renderSearchResults(results) {
        console.log("渲染搜索结果，数量:", results.length);
        searchResultsContainer.innerHTML = "";
        
        // 强制显示搜索结果容器
        searchResultsContainer.style.display = "block";
        
        if (results.length === 0) {
            const noResultEl = $el("div", {
                style: {
                    padding: "12px",
                    color: "var(--zml-text-color-secondary)",
                    textAlign: "center"
                },
                textContent: "未找到相关提示词"
            });
            searchResultsContainer.appendChild(noResultEl);
            console.log("显示无结果提示");
        } else {
            results.forEach(item => {
                const resultItem = $el("div", {
                    className: "zml-search-result-item",
                    style: {
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--zml-border-color)",
                        cursor: "pointer",
                        transition: "background-color 0.2s"
                    }
                });
                
                resultItem.appendChild($el("div", {
                    style: {
                        fontWeight: "bold",
                        color: CHINESE_TEXT_COLOR,
                        fontSize: "14px"
                    },
                    textContent: item.name
                }));
                
                resultItem.appendChild($el("div", {
                    style: {
                        fontSize: "12px",
                        color: "#bbb",
                        marginTop: "2px"
                    },
                    textContent: item.prompt
                }));
                
                resultItem.appendChild($el("div", {
                    style: {
                        fontSize: "11px",
                        color: "var(--zml-text-color-secondary)",
                        marginTop: "4px"
                    },
                    textContent: `${item.category} / ${item.group}`
                }));
                
                // 鼠标悬停效果
                resultItem.onmouseenter = function() {
                    this.style.backgroundColor = "var(--zml-secondary-bg-color)";
                };
                
                resultItem.onmouseleave = function() {
                    this.style.backgroundColor = "";
                };
                
                // 添加点击事件
                resultItem.onclick = function() {
                    console.log("点击搜索结果:", item.prompt);
                    pushHistory();
                    if (currentPrompts.has(item.prompt)) {
                        currentPrompts.delete(item.prompt);
                    } else {
                        currentPrompts.set(item.prompt, 1.0);
                        // 同步更新translationMap，确保标签显示中文
                        translationMap.set(item.prompt, item.name);
                    }
                    updateNodePrompt();
                    renderSelectedTags();
                    searchResultsContainer.style.display = "none";
                    savePromptsToBackend(currentData);
                };
                
                searchResultsContainer.appendChild(resultItem);
            });
        }
    }

    // 搜索按钮点击事件
    searchBtn.onclick = function() {
        const query = searchInput.value;
        console.log("搜索查询:", query);
        if (query) {
            const results = performSearch(query);
            console.log("搜索结果数量:", results.length);
            console.log("搜索结果:", results);
            renderSearchResults(results);
        }
    };

    // 回车搜索
    searchInput.onkeypress = function(e) {
        if (e.key === "Enter") {
            e.preventDefault(); // 阻止默认的回车行为
            searchBtn.click();
        }
    };

    // 点击其他区域关闭搜索结果
    modal.addEventListener("click", function(e) {
        if (!searchInput.contains(e.target) && !searchBtn.contains(e.target) && !searchResultsContainer.contains(e.target)) {
            searchResultsContainer.style.display = "none";
        }
    });

    // 主控件区域
    const controlsWrapper = $el("div", {
        className: "zml-prompt-ui-controls-wrapper",
        style: {
            display: "flex",
            alignItems: "center",
            width: "100%",
            position: "relative"
        }
    });
    
    // 手动翻译按钮功能
    function showToast(message, duration = 2000) {
    // 创建消息元素
    const toast = $el("div", {
        className: "zml-prompt-ui-toast",
        textContent: message,
        style: {
            position: "fixed",
            top: "20px",
            left: "20px",
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            color: "white",
            padding: "12px 20px",
            borderRadius: "4px",
            zIndex: 9999,
            fontSize: "14px",
            opacity: "0",
            transition: "opacity 0.3s ease"
        }
    });
    
    // 添加到文档
    document.body.appendChild(toast);
    
    // 显示消息
    setTimeout(() => {
        toast.style.opacity = "1";
    }, 10);
    
    // 自动消失
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, duration);
}

function translateSelectedTags() {
        console.log("开始手动翻译标签...");
        let translatedCount = 0;
        
        // 遍历当前已选标签
        currentPrompts.forEach((weight, prompt) => {
            // 只翻译还没有中文名称的提示词
            if (!translationMap.get(prompt)) {
                console.log(`查找提示词翻译: ${prompt}`);
                
                // 遍历所有分类和分组查找翻译
                let found = false;
                for (let i = 0; i < currentData.length && !found; i++) {
                    const category = currentData[i];
                    if (!category || !category.groups) continue;
                    
                    for (let j = 0; j < category.groups.length && !found; j++) {
                        const group = category.groups[j];
                        if (!group || !group.tags) continue;
                        
                        // 查找匹配的提示词
                        if (group.tags.hasOwnProperty(prompt)) {
                            const name = group.tags[prompt];
                            translationMap.set(prompt, name);
                            translatedCount++;
                            console.log(`找到翻译: ${prompt} -> ${name}`);
                            found = true;
                        }
                    }
                }
            }
        });
        
        // 更新标签显示
        if (translatedCount > 0) {
            renderSelectedTags();
            console.log(`成功翻译了 ${translatedCount} 个标签！`);
            showToast(`成功翻译了 ${translatedCount} 个标签！`);
        } else {
            console.log("所有标签都已有中文翻译，无需再次翻译。");
            showToast("所有标签都已有中文翻译，无需再次翻译。");
        }
    }
    
    // 创建搜索容器（移到最左侧）
    const searchContainer = $el("div", { 
        style: { 
            display: "flex", 
            alignItems: "center",
            position: "relative",
            marginRight: "16px", // 增加与右侧按钮的间距
            zIndex: 1001
        } 
    }, [searchInput, searchBtn, searchResultsContainer]);
    
    // 将搜索容器添加到最左侧
    controlsWrapper.appendChild(searchContainer);
    
    // 创建右侧的按钮区域
    const rightControls = $el("div", { 
        style: { 
            display: "flex", 
            alignItems: "center",
            position: "relative",
            flexGrow: 1,
            justifyContent: "flex-end"
        } 
    });
    
    // 翻译按钮
    const translateBtn = $el("button", {
        textContent: "翻译",
        className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary",
        title: "为未翻译的标签查找中文名称",
        onclick: translateSelectedTags
    });
    
    rightControls.appendChild($el("div", { style: { display: "flex", gap: "8px"}}, [translateBtn, undoBtn, importBtn, editModeBtn, copyBtn, clearBtn]));
    controlsWrapper.appendChild(rightControls);    
    const controls = $el("div", { className: "zml-prompt-ui-main-controls" }, [controlsWrapper]);
    const promptDisplayArea = $el("div", { className: "zml-prompt-ui-display-area" }, [tagDisplayWrapper, controls]);
    
    const mainTabs = $el("div", { className: "zml-prompt-ui-nav-tabs" });
    const addMainTabBtn = $el("button", { textContent: "+ 新增一级栏目", className: "zml-prompt-ui-btn zml-prompt-ui-btn-add" });
    const mainTabsContainer = $el("div", { className: "zml-prompt-ui-nav-container" }, [mainTabs, addMainTabBtn]);
    const subNav = $el("div", { className: "zml-prompt-ui-nav-tabs" });
    const subNavContainer = $el("div", { className: "zml-prompt-ui-nav-container" }, [subNav]);
    
    modal.append(header, promptDisplayArea, mainTabsContainer, subNavContainer, $el("div", { className: "zml-prompt-ui-tag-area" }));
    document.body.append(backdrop, modal);
    const tagArea = modal.querySelector('.zml-prompt-ui-tag-area');
    applyTheme(DEFAULT_THEME);

    const currentPromptWidget = node.widgets.find(w => w.name === "positive_prompt");
    const parseInitialPrompts = (value) => { /* ... 此函数未改变 ... */
        const prompts = new Map();
        value.split(',').forEach(s => { const t = s.trim(); if (t) { const m = t.match(/\(([^:]+):([\d.]+)\)/); if (m) { prompts.set(m[1], parseFloat(m[2])); } else { prompts.set(t, 1.0); } } });
        return prompts;
    };
    let currentPrompts = parseInitialPrompts(currentPromptWidget.value);
    const pushHistory = () => { /* ... 此函数未改变 ... */
        historyStack.push(Array.from(currentPrompts.entries()));
        if (historyStack.length > 20) historyStack.shift();
    };
    const getPromptString = () => {
        const promptStr = Array.from(currentPrompts.entries()).map(([p, w]) => w === 1.0 ? p : `(${p}:${w.toFixed(1)})`).join(', ');
        return promptStr ? promptStr + ', ' : '';
    };
    const updateNodePrompt = () => { currentPromptWidget.value = getPromptString(); app.graph.setDirtyCanvas(true); };
    const renderAllButtons = () => { if (!currentData) return; renderMainTabs(currentData); renderSelectedTags(); };
    const renderSelectedTags = () => { /* ... 此函数未改变 ... */
        tagDisplay.innerHTML = "";
        Array.from(currentPrompts.keys()).forEach(prompt => {
            const name = translationMap.get(prompt) || prompt; const weight = currentPrompts.get(prompt) || 1.0;
            const tagEl = $el("div", { className: "zml-prompt-ui-selected-tag" });
            tagEl.innerHTML = `<div class="name">${name}</div><div class="prompt">${weight === 1.0 ? prompt : `(${prompt}:${weight.toFixed(1)})`}</div>`;
            const updateWeight = (nW) => { pushHistory(); currentPrompts.set(prompt, nW.toFixed(1) * 1); updateNodePrompt(); renderSelectedTags(); const c = currentData[activeCategoryIndex]; if (c?.groups?.[activeGroupIndex]) renderGroupTags([c.groups[activeGroupIndex]]); savePromptsToBackend(currentData); };
            const mBtn = $el("button", { textContent: "-", className: "minus", onclick: (e) => { e.stopPropagation(); updateWeight(Math.max(0.1, weight - 0.1)); } });
            const pBtn = $el("button", { textContent: "+", className: "plus", onclick: (e) => { e.stopPropagation(); updateWeight(weight + 0.1); } });
            const ctlDiv = $el("div", { className: "zml-prompt-ui-selected-tag-controls" }, [mBtn, pBtn]);
            const rmBtn = $el("div", { textContent: "×", className: "zml-prompt-ui-selected-tag-remove-btn", onclick: (e) => { e.stopPropagation(); pushHistory(); currentPrompts.delete(prompt); updateNodePrompt(); renderSelectedTags(); const c = currentData[activeCategoryIndex]; if (c?.groups?.[activeGroupIndex]) renderGroupTags([c.groups[activeGroupIndex]]); savePromptsToBackend(currentData); }});
            tagEl.append(ctlDiv, rmBtn); tagDisplay.appendChild(tagEl);
        });
        updateNodePrompt();
    };
    
    undoBtn.onclick = () => { if (historyStack.length > 0) { currentPrompts = new Map(historyStack.pop()); updateNodePrompt(); renderSelectedTags(); const c = currentData[activeCategoryIndex]; if (c?.groups?.[activeGroupIndex]) renderGroupTags([c.groups[activeGroupIndex]]); savePromptsToBackend(currentData); } };
    editModeBtn.onclick = () => { isEditMode = !isEditMode; editModeBtn.classList.toggle('active', isEditMode); renderAllButtons(); };
    copyBtn.onclick = () => { navigator.clipboard.writeText(getPromptString()).then(() => { const o = copyBtn.textContent; copyBtn.textContent = "已复制!"; setTimeout(() => { copyBtn.textContent = o; }, 1000); }); };
    clearBtn.onclick = () => { pushHistory(); currentPrompts.clear(); updateNodePrompt(); renderSelectedTags(); const c = currentData[activeCategoryIndex]; if (c?.groups?.[activeGroupIndex]) renderGroupTags([c.groups[activeGroupIndex]]); savePromptsToBackend(currentData); };
    addMainTabBtn.onclick = () => showInputDialog("新增一级分类", [{ label: "分类名称", placeholder: "请输入分类名...", id: "name" }], (v) => { if (v.name) { currentData.push({ name: v.name, groups: [] }); renderAllButtons(); savePromptsToBackend(currentData); } });

    // --- 核心渲染函数 (已更新样式管理逻辑) ---
    const renderGroupTags = (groups) => {
        tagArea.innerHTML = "";
        groups.forEach((group) => {
            if (!group.name) return;
            const groupContainer = $el("div", { className: "zml-prompt-ui-group-container" });
            const groupHeader = $el("h4", { textContent: group.name, className: "zml-prompt-ui-group-header" });
            
            const manageStyleBtn = $el("button", { textContent: "管理样式", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: () => {
                const choices = [ "恢复已选颜色", "恢复颜色", "恢复背景", "恢复标签大小", "恢复字体大小", "---",
                    "应用[已选颜色]到全部", "应用[颜色]到全部", "应用[背景]到全部", "应用[标签大小]到全部", "应用[字体大小]到全部" ];
                showChoiceDialog("管理分组样式", choices, (choice) => {
                    const styleMap = {
                        "已选颜色": "selectedTagBgColor", "颜色": "textColor", "背景": "tagBgColor", "标签大小": "tagWidth", "字体大小": "fontSize"
                    };
                    const action = choice.substring(0, 2);
                    const styleName = choice.match(/\[?([^\]]+)\]?/)[1];
                    const propKey = styleMap[styleName];

                    if (action === "恢复") {
                        delete group[propKey];
                        savePromptsToBackend(currentData).then(() => renderGroupTags(groups));
                    } else if (action === "应用") {
                        if (!confirm(`确定要将当前分组的“${styleName}”样式应用到所有分组吗？`)) return;
                        const styleToApply = group[propKey];
                        currentData.forEach(category => category.groups.forEach(g => {
                            if (styleToApply !== undefined) g[propKey] = styleToApply; else delete g[propKey];
                        }));
                        savePromptsToBackend(currentData).then(renderAllButtons);
                    }
                });
            }});
            
            const sBgColorInput = $el("input", { type: "color", value: group.selectedTagBgColor || ACTIVE_BUTTON_BG, onchange: (e) => { group.selectedTagBgColor = e.target.value; savePromptsToBackend(currentData).then(() => renderGroupTags(groups)); }});
            const textColorInput = $el("input", { type: "color", value: group.textColor || CHINESE_TEXT_COLOR, onchange: (e) => { group.textColor = e.target.value; savePromptsToBackend(currentData).then(() => renderGroupTags(groups)); }});
            const tagBgColorInput = $el("input", { type: "color", value: group.tagBgColor || INACTIVE_BUTTON_BG, onchange: (e) => { group.tagBgColor = e.target.value; savePromptsToBackend(currentData).then(() => renderGroupTags(groups)); }});
            const tagSizeInput = $el("input", { type: "number", value: group.tagWidth || 200, min: 50, max: 300, onchange: (e) => { group.tagWidth = parseInt(e.target.value); savePromptsToBackend(currentData).then(() => renderGroupTags(groups)); }});
            const fontSizeInput = $el("input", { type: "number", value: group.fontSize || 16, min: 8, max: 30, onchange: (e) => { group.fontSize = parseInt(e.target.value); savePromptsToBackend(currentData).then(() => renderGroupTags(groups)); }});
            
            const controlsDiv = $el("div", { className: "zml-prompt-ui-group-controls" }, [ manageStyleBtn,
                $el("span", { textContent: "已选颜色" }), sBgColorInput, $el("span", { textContent: "颜色" }), textColorInput,
                $el("span", { textContent: "背景" }), tagBgColorInput, $el("span", { textContent: "标签大小" }), tagSizeInput,
                $el("span", { textContent: "字体大小" }), fontSizeInput ]);
            groupHeader.appendChild(controlsDiv);

            if (isEditMode) { /* ... 此部分未改变 ... */
                const deleteGroupBtn = $el("span", { textContent: "×", className: "zml-prompt-ui-group-delete-btn", onclick: (e) => { e.stopPropagation(); if (confirm(`确定要删除二级分类 '${group.name}' 吗？`)) { pushHistory(); const c = currentData[activeCategoryIndex]; const i = c.groups.indexOf(group); if (i > -1) { c.groups.splice(i, 1); renderAllButtons(); savePromptsToBackend(currentData); } } }});
                groupHeader.prepend(deleteGroupBtn);
            }
            groupContainer.appendChild(groupHeader);
            const promptContainer = $el("div", { className: "zml-prompt-ui-prompt-container" });
            const addTagBtn = $el("button", { textContent: "+ 添加", className: "zml-prompt-ui-btn zml-prompt-ui-btn-add", onclick: () => showInputDialog("添加提示词", [{ label: "提示词 (英文)", placeholder: "例如: 1girl", id: "prompt" }, { label: "中文翻译", placeholder: "例如: 1女孩", id: "name" }], (v) => { if (v.prompt && group.tags) { group.tags[v.prompt] = v.name; renderAllButtons(); savePromptsToBackend(currentData); } }) });
            promptContainer.appendChild(addTagBtn);

            for (const prompt in group.tags) {
                const name = group.tags[prompt]; translationMap.set(prompt, name);
                const isActive = currentPrompts.has(prompt);
                const activeBg = group.selectedTagBgColor || ACTIVE_BUTTON_BG;
                const promptBtn = $el("button", { className: "zml-prompt-ui-prompt-btn", style: { backgroundColor: isActive ? activeBg : (group.tagBgColor || INACTIVE_BUTTON_BG), borderColor: isActive ? activeBg : 'transparent', minWidth: `${group.tagWidth || 200}px`, width: `${group.tagWidth || 200}px` }, onclick: () => { pushHistory(); if (currentPrompts.has(prompt)) { currentPrompts.delete(prompt); } else { currentPrompts.set(prompt, 1.0); } updateNodePrompt(); renderSelectedTags(); renderGroupTags(groups); savePromptsToBackend(currentData); }});
                const nameEl = $el("div", { className: "name", textContent: name, style: { fontSize: `${group.fontSize || 16}px`, color: group.textColor || CHINESE_TEXT_COLOR }});
                const promptEl = $el("div", { className: "prompt", textContent: prompt, style: { fontSize: `${(group.fontSize || 16) * 0.8}px`, color: "#bbb" }});
                promptBtn.append(nameEl, promptEl);
                if (isEditMode) { promptBtn.appendChild($el("span", { textContent: "×", className: "zml-prompt-ui-edit-delete-btn", style: { top: '-5px', right: '-5px' }, onclick: (e) => { e.stopPropagation(); if (confirm(`确定要删除标签 '${prompt}' 吗？`)) { pushHistory(); delete group.tags[prompt]; renderAllButtons(); savePromptsToBackend(currentData); } }})); }
                promptContainer.appendChild(promptBtn);
            }
            groupContainer.appendChild(promptContainer); tagArea.appendChild(groupContainer);
        });
    };
    const renderMainTabs = (data) => { /* ... 此函数未改变 ... */
        mainTabs.innerHTML = "";
        data.forEach((categoryData, index) => {
            const navBtn = $el("button", { textContent: categoryData.name, className: `zml-prompt-ui-nav-btn ${index === activeCategoryIndex ? 'active' : ''}`, onclick: () => { activeCategoryIndex = index; activeGroupIndex = 0; renderAllButtons(); } });
            if (isEditMode) { navBtn.appendChild($el("span", { textContent: "×", className: "zml-prompt-ui-edit-delete-btn", onclick: (e) => { e.stopPropagation(); if (confirm(`确定要删除一级分类 '${categoryData.name}' 吗？`)) { pushHistory(); currentData.splice(index, 1); activeCategoryIndex = 0; activeGroupIndex = 0; renderAllButtons(); savePromptsToBackend(currentData); } }})); }
            mainTabs.appendChild(navBtn);
        });
        if (data.length > 0) { if (activeCategoryIndex >= data.length) activeCategoryIndex = 0; renderSubNavAndTags(data[activeCategoryIndex].groups); } else { renderSubNavAndTags([]); }
    };
    const renderSubNavAndTags = (groups) => { /* ... 此函数未改变 ... */
        subNav.innerHTML = ""; tagArea.innerHTML = ""; if (!groups) groups = [];
        if (activeGroupIndex >= groups.length) activeGroupIndex = 0;
        groups.forEach((group, index) => { if (group.name) subNav.appendChild($el("button", { textContent: group.name, className: `zml-prompt-ui-nav-btn ${index === activeGroupIndex ? 'active' : ''}`, onclick: () => { activeGroupIndex = index; renderSubNavAndTags(groups); } })); });
        subNav.appendChild($el("button", { textContent: "+ 新增二级栏目", className: "zml-prompt-ui-btn zml-prompt-ui-btn-add", onclick: () => showInputDialog("新增二级分类", [{ label: "分类名称", placeholder: "请输入分类名...", id: "name" }], (v) => { if (v.name && currentData[activeCategoryIndex]) { const g = { name: v.name, tags: {} }; currentData[activeCategory-index].groups.push(g); activeGroupIndex = currentData[activeCategory-index].groups.length - 1; renderAllButtons(); savePromptsToBackend(currentData); } })}));
        if (groups.length > 0 && groups[activeGroupIndex]) { renderGroupTags([groups[activeGroupIndex]]); }
    };
    
    importBtn.onclick = () => showImportDialog();
    function showImportDialog() { /* ... 此函数未改变 ... */ 
        const backdrop = $el("div", { className: "zml-prompt-ui-backdrop" }); const dialog = $el("div", { className: "zml-prompt-ui-dialog" });
        dialog.appendChild($el("h3", { textContent: "批量导入标签", className: "zml-prompt-ui-dialog-title" })); dialog.appendChild($el("label", { textContent: "选择一级栏目" }));
        const categorySelect = $el("select"); currentData.forEach((cat, index) => categorySelect.appendChild($el("option", { value: index, textContent: cat.name }))); dialog.appendChild(categorySelect);
        dialog.appendChild($el("label", { textContent: "选择二级栏目" })); const groupSelect = $el("select");
        const updateGroupSelect = (catIndex) => { groupSelect.innerHTML = ""; (currentData[catIndex]?.groups || []).forEach((group, index) => groupSelect.appendChild($el("option", { value: index, textContent: group.name }))); };
        categorySelect.onchange = (e) => updateGroupSelect(e.target.value); if (currentData.length > 0) updateGroupSelect(categorySelect.value); dialog.appendChild(groupSelect);
        const createGroupBtn = $el("button", { textContent: "+ 新建二级栏目", className: "zml-prompt-ui-btn zml-prompt-ui-btn-add", style: {width: '100%'}, onclick: () => showInputDialog("新建二级栏目", [{ label: "栏目名称", placeholder: "请输入栏目名...", id: "name" }], (v) => { if (v.name) { const catIndex = categorySelect.value; const newGroup = { name: v.name, tags: {} }; currentData[catIndex].groups.push(newGroup); updateGroupSelect(catIndex); groupSelect.value = currentData[catIndex].groups.length - 1; savePromptsToBackend(currentData); } })});
        dialog.appendChild(createGroupBtn); dialog.appendChild($el("label", { textContent: "选择TXT文件 (格式: 中文,英文)" }));
        const fileInput = $el("input", { type: "file", accept: ".txt" }); dialog.appendChild(fileInput);
        const closeDialog = () => { backdrop.remove(); dialog.remove(); };
        const confirmBtn = $el("button", { textContent: "确认导入", className: "zml-prompt-ui-btn zml-prompt-ui-btn-primary", onclick: () => {
            const file = fileInput.files[0], catIdx = categorySelect.value, grpIdx = groupSelect.value; if (!file || catIdx === "" || grpIdx === "") { alert("请选择一个文件和有效的分类！"); return; }
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target.result, lines = content.split('\n'); const newTags = {};
                lines.forEach(line => { const parts = line.trim().split(/[,，]/); if (parts.length === 2) { const [cn, en] = parts.map(s => s.trim()); if (en && cn) newTags[en] = cn; } });
                Object.assign(currentData[catIdx].groups[grpIdx].tags, newTags); await savePromptsToBackend(currentData); alert("标签导入成功！"); renderAllButtons(); closeDialog();
            };
            reader.readAsText(file, 'UTF-8');
        }});
        const cancelBtn = $el("button", { textContent: "取消", className: "zml-prompt-ui-btn zml-prompt-ui-btn-secondary", onclick: closeDialog });
        dialog.appendChild($el("div", { className: "zml-prompt-ui-dialog-buttons" }, [confirmBtn, cancelBtn]));
        document.body.append(backdrop, dialog); backdrop.onclick = closeDialog;
    }
    
    api.fetchApi(`${PROMPT_API_PREFIX}/get_prompts`).then(r => r.json()).then(d => { if (d.error) { tagArea.textContent = `加载失败: ${d.error}`; return; } currentData = d; renderAllButtons(); 
        // 实现自动翻译功能：打开UI时自动翻译一次，然后每隔1秒自动翻译一次，一共三次
        let translateCount = 0;
        const autoTranslate = () => {
            if (translateCount >= 3) return;
            
            let translatedCount = 0;
            // 遍历当前选中的所有提示词
            currentPrompts.forEach((_, prompt) => {
                // 如果提示词还没有中文翻译
                if (!translationMap.has(prompt)) {
                    // 在currentData中查找对应的中文翻译
                    for (const category of currentData) {
                        for (const group of category.groups) {
                            if (group.tags && group.tags[prompt]) {
                                // 找到翻译后更新translationMap
                                translationMap.set(prompt, group.tags[prompt]);
                                translatedCount++;
                                break;
                            }
                        }
                    }
                }
            });
            
            // 如果本次翻译了新的内容，重新渲染标签
            if (translatedCount > 0) {
                renderSelectedTags();
                console.log(`自动翻译完成，本次翻译了 ${translatedCount} 个标签`);
                // 移除自动翻译的消息提示
            }
            
            translateCount++;
            // 如果还需要继续翻译，设置1秒后再次执行
            if (translateCount < 3) {
                setTimeout(autoTranslate, 1000);
            }
        };
        
        // 开始第一次自动翻译
        autoTranslate();
    }).catch(e => { tagArea.textContent = `加载失败: ${e}`; console.error(e); });
}

app.registerExtension({
    name: "ZML.PromptUI",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "ZML_PromptUINode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                this.addWidget("button", "打开标签化PromptUI", "open", () => createPromptModal(this));
            };
        }
    },
});