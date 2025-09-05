import { app } from "../../../scripts/app.js";

// 新增：定义 SelectTextV3 节点推荐的最小宽度和高度
const ZML_SELECT_TEXT_V3_MIN_WIDTH = 280; // 适配控件数量
const ZML_SELECT_TEXT_V3_MIN_HEIGHT_EMPTY_LIST = 185; // 空列表时列表区域的最小高度

function escapeNewlinesForInput(text) {
    if (typeof text !== 'string') return text;
    return text.replaceAll('\n', '\\n');
}
// 将字面量字符串 \\n 转换回实际的换行符 (\n)，以便 ComfyUI Widget 和后端处理
function unescapeNewlinesFromInput(text) {
    if (typeof text !== 'string') return text;
    return text.replaceAll('\\n', '\n');
}

function createEl(tag, className = "", properties = {}, text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.assign(el, properties);
    if (text) el.textContent = text;
    return el;
}

// === Helper function to adjust color brightness ===
function adjustBrightness(hex, percent) {
    if (!hex || typeof hex !== 'string') {
        console.warn('Invalid hex color for adjustBrightness:', hex);
        return '#000000'; // Fallback
    }
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    const factor = (100 + percent) / 100;

    r = Math.min(255, Math.max(0, Math.floor(r * factor)));
    g = Math.min(255, Math.max(0, Math.floor(g * factor)));
    b = Math.min(255, Math.max(0, Math.floor(b * factor)));

    const toHex = (c) => ('0' + c.toString(16)).slice(-2);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
// ===============================================

// --- 全局弹窗元素和变量 ---
let zmlTextV3ModalOverlay = null; // 用于编辑当前节点条目的文本
let zmlTextV3ModalTextarea = null;
let zmlTextV3ModalTitle = null;
let zmlTextV3CurrentEditingEntry = null;
let zmlTextV3CurrentNodeInstance = null; // Stored here for all modals

// --- 预设文本弹窗元素和变量 ---
let zmlPresetModalOverlay = null; // 预设文本管理器模态框
let zmlPresetModalContentContainer = null; // 预设列表的父容器
let zmlPresetModalNameInput = null; // 预设名称输入框
let zmlPresetModalContentTextarea = null; // 预设内容文本区域
let zmlCurrentEditingPreset = null; // 用于编辑模式下的当前预设对象

// --- 统一颜色主题为舒适的浅绿色调 ---
const ZML_PRESET_BASE_COLOR = "#C8E6C9"; // 柔和的浅绿色，作为主要背景色
const ZML_PRESET_DARK_ACCENT = "#388E3C"; // 深绿色，用于标题和重要按钮
const ZML_PRESET_LIGHT_ACCENT = "#81C784"; // 亮绿色，用于卡片背景或hover效果
const ZML_PRESET_TEXT_COLOR = "#2E7D32"; // 文本颜色，比深绿色稍亮

// --- 消息提示系统 ---
let zmlNotificationContainer = null;

function createNotificationSystem() {
    if (zmlNotificationContainer) return;

    zmlNotificationContainer = createEl("div", "zml-notification-container", {
        style: `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002; /* 确保在所有模态框之上 */
            display: flex;
            flex-direction: column;
            gap: 10px;
        `
    });
    document.body.appendChild(zmlNotificationContainer);
}

function showNotification(message, type = 'info', duration = 3000) {
    if (!zmlNotificationContainer) createNotificationSystem();

    const notification = createEl("div", `zml-notification zml-notification-${type}`, {
        textContent: message,
        style: `
            background-color: ${ZML_PRESET_BASE_COLOR};
            color: ${ZML_PRESET_TEXT_COLOR};
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, -20)};
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            font-size: 14px;
            font-weight: 500;
            opacity: 0;
            transform: translateY(-20px);
            transition: opacity 0.3s ease-out, transform 0.3s ease-out;
            max-width: 300px;
            word-wrap: break-word; /* 防止长文本溢出 */
        `
    });

    if (type === 'success') {
        notification.style.backgroundColor = ZML_PRESET_LIGHT_ACCENT; // 亮绿色
        notification.style.color = 'white';
        notification.style.border = '1px solid ' + adjustBrightness(ZML_PRESET_LIGHT_ACCENT, -20);
    } else if (type === 'error') {
        notification.style.backgroundColor = '#e57373'; // 柔和的红色
        notification.style.color = 'white';
        notification.style.border = '1px solid #d36060';
    } else if (type === 'info') {
        notification.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, -10); // 稍深的浅绿色
        notification.style.color = ZML_PRESET_TEXT_COLOR;
        notification.style.border = `1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, -30)}`;
    }

    zmlNotificationContainer.appendChild(notification);

    // Fade in
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 50);

    // Fade out and remove
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-20px)';
        notification.addEventListener('transitionend', () => notification.remove());
    }, duration);
}


// --- 编辑文本弹窗逻辑 (较少改动，保持原有深色主题) ---
// 为了与 ComfyUI 的深色主题协调，通常编辑文本的弹窗会保持默认的深色调，不跟随预设管理器的亮色主题。
function createEditContentModal() {
    if (zmlTextV3ModalOverlay) return; 

    zmlTextV3ModalOverlay = createEl("div", "zml-st3-modal-overlay", {
        style: `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.75); 
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            display: none; 
            backdrop-filter: blur(3px);
        `
    });

    const modalContainer = createEl("div", "zml-st3-modal-container", {
        style: `
            background-color: #31353a; 
            border: 1px solid #4a515a; 
            border-radius: 8px;
            padding: 20px;
            min-width: 550px; 
            max-width: 80vw;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            gap: 15px;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6); 
            position: relative; 
        `
    });

    zmlTextV3ModalTitle = createEl("h3", "zml-st3-modal-title", {
        style: `
            color: #e0e0e0; 
            margin: 0;
            font-size: 1.3em; 
            border-bottom: 2px solid #4a515a; 
            padding-bottom: 15px;
            text-align: center;
            font-weight: 600; 
        `,
        textContent: "文本标题"
    });

    zmlTextV3ModalTextarea = createEl("textarea", "zml-st3-modal-textarea", {
        style: `
            width: 100%;
            height: 350px;
            resize: vertical; 
            background-color: #1a1a1a;
            border: 1px solid #4a4a4a;
            color: #f0f0f0;
            padding: 12px;
            font-family: 'Segoe UI Mono', 'Consolas', monospace; 
            font-size: 14px;
            border-radius: 4px;
            box-sizing: border-box;
            outline: none; 
            transition: border-color 0.2s ease, box-shadow 0.2s ease; 
        `
    });
    zmlTextV3ModalTextarea.onfocus = (e) => {
        e.target.style.borderColor = '#5d99f2';
        e.target.style.boxShadow = '0 0 8px rgba(93, 153, 242, 0.4)';
    };
    zmlTextV3ModalTextarea.onblur = (e) => {
        e.target.style.borderColor = '#4a4a4a';
        e.target.style.boxShadow = 'none';
    };

    const buttonGroup = createEl("div", "zml-st3-modal-buttons", {
        style: `
            display: flex;
            justify-content: flex-end;
            gap: 12px; 
            padding-top: 10px; 
        `
    });

    const baseButtonStyle = `
        height: 38px; 
        padding: 0 25px; 
        text-align: center;
        text-decoration: none;
        display: flex; 
        align-items: center;
        justify-content: center;
        font-size: 15px; 
        font-weight: 500; 
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease; 
        white-space: nowrap; 
    `;

    const saveButton = createEl("button", "zml-control-btn zml-st3-modal-save", {
        textContent: "保存",
        style: `
            ${baseButtonStyle}
            background-color: #4CAF50; 
            border: 1px solid #3e8e41; 
            color: white;
        `
    });
    saveButton.onmouseenter = (e) => { e.target.style.backgroundColor = '#45a049'; e.target.style.boxShadow = '0 2px 8px rgba(76, 175, 80, 0.4)'; };
    saveButton.onmouseleave = (e) => { e.target.style.backgroundColor = '#4CAF50'; e.target.style.boxShadow = 'none'; };
    saveButton.onmousedown = (e) => { e.target.style.transform = 'translateY(1px) scale(0.99)'; }; 
    saveButton.onmouseup = (e) => { e.target.style.transform = 'translateY(0) scale(1)'; };

    const cancelButton = createEl("button", "zml-control-btn zml-st3-modal-cancel", {
        textContent: "取消",
        style: `
            ${baseButtonStyle}
            background-color: #f44336; 
            border: 1px solid #da190b; 
            color: white;
        `
    });
    cancelButton.onmouseenter = (e) => { e.target.style.backgroundColor = '#da190b'; e.target.style.boxShadow = '0 2px 8px rgba(244, 67, 54, 0.4)'; };
    cancelButton.onmouseleave = (e) => { e.target.style.backgroundColor = '#f44336'; e.target.style.boxShadow = 'none'; };
    cancelButton.onmousedown = (e) => { e.target.style.transform = 'translateY(1px) scale(0.99)'; }; 
    cancelButton.onmouseup = (e) => { e.target.style.transform = 'translateY(0) scale(1)'; };

    buttonGroup.append(cancelButton, saveButton);
    modalContainer.append(zmlTextV3ModalTitle, zmlTextV3ModalTextarea, buttonGroup);
    zmlTextV3ModalOverlay.appendChild(modalContainer);
    document.body.appendChild(zmlTextV3ModalOverlay);

    // 绑定事件
    saveButton.onclick = () => {
        if (zmlTextV3CurrentEditingEntry && zmlTextV3CurrentNodeInstance) {
            zmlTextV3CurrentEditingEntry.content = zmlTextV3ModalTextarea.value;
            zmlTextV3CurrentNodeInstance.triggerSlotChanged();
        }
        hideEditContentModal();
    };

    cancelButton.onclick = () => {
        hideEditContentModal();
    };
    
    // 点击背景关闭
    zmlTextV3ModalOverlay.onclick = (e) => {
        if (e.target === zmlTextV3ModalOverlay) {
            hideEditContentModal();
        }
    };
}

function showEditContentModal(entry, nodeInstance) {
    if (!zmlTextV3ModalOverlay) createEditContentModal();
    
    if (nodeInstance) {
        zmlTextV3CurrentNodeInstance = nodeInstance; 
    }

    zmlTextV3CurrentEditingEntry = entry;
    zmlTextV3ModalTextarea.value = entry.content;
    zmlTextV3ModalTitle.textContent = `文本标题: ${entry.title || "(未命名文本)"}`; 
    zmlTextV3ModalOverlay.style.display = 'flex'; 
    zmlTextV3ModalTextarea.focus(); 
}

function hideEditContentModal() {
    if (zmlTextV3ModalOverlay) {
        zmlTextV3ModalOverlay.style.display = 'none'; 
        zmlTextV3CurrentEditingEntry = null;
    }
}
// --- 结束：编辑文本弹窗逻辑 ---


// --- 预设文本UI逻辑 (主要修改部分) ---
async function fetchPresets() {
    try {
        const response = await fetch("/zml_select_text_v3/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "get_all" }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            throw new Error(`Server error: ${errorText}`);
        }
        const data = await response.json();
        if (data.success) {
            return data.presets;
        } else {
            console.error("Failed to fetch presets:", data.message);
            showNotification(`获取预设失败: ${data.message}`, 'error');
            return [];
        }
    } catch (error) {
        console.error("Error fetching presets:", error);
        showNotification(`请求出错: ${error.message}`, 'error');
        return [];
    }
}

async function sendPresetRequest(action, payload) {
    try {
        const response = await fetch("/zml_select_text_v3/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...payload }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            throw new Error(`Server error: ${errorText}`);
        }
        const data = await response.json();
        if (!data.success) {
            console.error(`Preset operation '${action}' failed:`, data.message);
            showNotification(`操作失败: ${data.message}`, 'error');
        } else {
            let msg = '';
            if (action === 'add') msg = `预设 '${payload.name}' 已添加.`;
            else if (action === 'update') msg = `预设 '${payload.new_name}' 已更新.`;
            else if (action === 'delete') msg = `预设 '${payload.name}' 已删除.`;
            if (msg) showNotification(msg, 'success');
        }
        return data.success;
    } catch (error) {
        console.error(`Error during preset operation '${action}':`, error);
        showNotification(`请求出错: ${error.message}`, 'error');
        return false;
    }
}

function createPresetModal() {
    if (zmlPresetModalOverlay) return;

    zmlPresetModalOverlay = createEl("div", "zml-preset-modal-overlay", {
        style: `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001; 
            display: none;
            backdrop-filter: blur(2px);
        `
    });

    const modalContainer = createEl("div", "zml-preset-modal-container", {
        style: `
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 60)}; /* 浅绿色背景 */
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 20)};
            border-radius: 12px; 
            padding: 12px; 
            min-width: 780px; 
            width: 800px; /* 固定宽度，更可控 */
            max-width: 90vw;
            max-height: 90vh; /* 确保高度限制 */
            display: flex;
            flex-direction: column;
            gap: 8px; /* 减小内部间距 */
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3); 
            color: ${ZML_PRESET_TEXT_COLOR}; 
            font-family: 'Segoe UI', Arial, sans-serif; 
            overflow-y: auto; /* 允许整个模态框滚动 */
            overflow-x: hidden; /* 防止横向溢出 */
        `
    });

    const modalTitle = createEl("h3", "zml-preset-modal-title", {
        style: `
            color: ${ZML_PRESET_TEXT_COLOR}; 
            margin: 0;
            font-size: 1.6em; 
            border-bottom: 2px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 10)};
            padding-bottom: 5px; 
            text-align: center;
            font-weight: 700;
        `,
        textContent: "💖 预设文本管理器 💖"
    });

    const sectionTitleStyle = `
        font-weight: bold;
        color: ${ZML_PRESET_TEXT_COLOR}; 
        margin-bottom: 3px; 
        border-bottom: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 20)};
        padding-bottom: 3px; 
        font-size: 1.1em;
    `;

    // --- 添加/编辑预设区域 ---
    const addEditSection = createEl("div", "zml-preset-add-edit-section", {
        style: `
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 70)};
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
            border-radius: 8px; 
            padding: 8px; 
            display: flex;
            flex-direction: column;
            gap: 5px; 
        `
    });
    addEditSection.innerHTML = `<h4 style="${sectionTitleStyle}">✨ 添加/编辑预设</h4>`;

    const nameGroup = createEl("div", "", {style: "display: flex; align-items: center; gap: 3px;"}); 
    nameGroup.append(
        createEl("span", "", {textContent: "名称:", style: `color: ${ZML_PRESET_TEXT_COLOR}; font-weight: 600; flex-shrink: 0; font-size: 0.95em;`}),
        (zmlPresetModalNameInput = createEl("input", "zml-control-input preset-text-input", {
            type: "text",
            placeholder: "输入预设名称 (如: 人物描述)",
            style: `
                flex: 1;
                background-color: white;
                border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, -10)};
                border-radius: 6px;
                color: #333;
                padding: 4px 8px; 
                height: 28px; 
                font-size: 13px;
                outline: none;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            `
        }))
    );
    zmlPresetModalNameInput.onfocus = (e) => { e.target.style.borderColor = ZML_PRESET_DARK_ACCENT; e.target.style.boxShadow = `0 0 6px ${adjustBrightness(ZML_PRESET_DARK_ACCENT, 20)}`; };
    zmlPresetModalNameInput.onblur = (e) => { e.target.style.borderColor = adjustBrightness(ZML_PRESET_BASE_COLOR, -10); e.target.style.boxShadow = 'none'; };


    const contentGroup = createEl("div", "", {style: "display: flex; align-items: flex-start; gap: 3px;"}); 
    contentGroup.append(
        createEl("span", "", {textContent: "内容:", style: `color: ${ZML_PRESET_TEXT_COLOR}; font-weight: 600; padding-top: 3px; flex-shrink: 0; font-size: 0.95em;`}), 
        (zmlPresetModalContentTextarea = createEl("textarea", "zml-preset-textarea preset-text-input", {
            placeholder: "输入预设内容 (如: 1girl, solo, long hair, blue eyes)",
            style: `
                flex: 1;
                height: 60px; 
                resize: vertical;
                background-color: white;
                border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, -10)};
                border-radius: 6px;
                color: #333;
                padding: 4px 8px; 
                font-size: 13px;
                outline: none;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            `
        }))
    );
    zmlPresetModalContentTextarea.onfocus = (e) => { e.target.style.borderColor = ZML_PRESET_DARK_ACCENT; e.target.style.boxShadow = `0 0 6px ${adjustBrightness(ZML_PRESET_DARK_ACCENT, 20)}`; };
    zmlPresetModalContentTextarea.onblur = (e) => { e.target.style.borderColor = adjustBrightness(ZML_PRESET_BASE_COLOR, -10); e.target.style.boxShadow = 'none'; };

    const actionButtons = createEl("div", "", {style: "display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px;"}); 

    // 这是预设弹窗中的大按钮样式
    const buttonBasePresetStyle = `
        padding: 24px 24px; 
        border-radius: 8px; 
        cursor: pointer;
        font-size: 16px; 
        font-weight: 600;
        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
        border: none;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2); 
        
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const presetSaveBtn = createEl("button", "zml-control-btn", { textContent: "💾 保存/新增预设" });
    Object.assign(presetSaveBtn.style, {
        cssText: buttonBasePresetStyle,
        backgroundColor: ZML_PRESET_DARK_ACCENT, // 深绿色
        color: 'white',
    });
    // 显眼的视觉反馈
    presetSaveBtn.onmouseenter = (e) => { 
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; // 更大更浓的阴影
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; // 明显上浮和略微变大
    }; 
    presetSaveBtn.onmouseleave = (e) => { 
        e.target.style.backgroundColor = ZML_PRESET_DARK_ACCENT; 
        e.target.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)'; 
        e.target.style.transform = 'translateY(0) scale(1)'; 
    };
    presetSaveBtn.onmousedown = (e) => { 
        e.target.style.transform = 'translateY(3px) scale(0.96)'; 
        e.target.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)'; 
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -20); // 按下时更深的颜色
    }; 
    presetSaveBtn.onmouseup = (e) => { 
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };

    // 添加缺失的点击事件处理程序
    presetSaveBtn.onclick = async () => {
        const name = zmlPresetModalNameInput.value.trim();
        const content = zmlPresetModalContentTextarea.value;
        
        if (!name) {
            showNotification("请输入预设名称！", 'error');
            return;
        }
        
        if (zmlCurrentEditingPreset) {
            // 更新现有预设
            const success = await sendPresetRequest("update", {
                old_name: zmlCurrentEditingPreset.name,
                new_name: name,
                new_content: content
            });
            if (success) {
                zmlPresetModalNameInput.value = "";
                zmlPresetModalContentTextarea.value = "";
                zmlCurrentEditingPreset = null;
                renderPresetsList();
            }
        } else {
            // 添加新预设
            const success = await sendPresetRequest("add", {
                name: name,
                content: content
            });
            if (success) {
                zmlPresetModalNameInput.value = "";
                zmlPresetModalContentTextarea.value = "";
                renderPresetsList();
            }
        }
    };

    const presetCancelEditBtn = createEl("button", "zml-control-btn", { textContent: "❌ 取消" });
    Object.assign(presetCancelEditBtn.style, {
        cssText: buttonBasePresetStyle,
        backgroundColor: '#999', // 保持灰色调
        color: 'white',
    });
    // 显眼的视觉反馈
    presetCancelEditBtn.onmouseenter = (e) => { 
        e.target.style.backgroundColor = '#777'; 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };
    presetCancelEditBtn.onmouseleave = (e) => { 
        e.target.style.backgroundColor = '#999'; 
        e.target.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)'; 
        e.target.style.transform = 'translateY(0) scale(1)'; 
    };
    presetCancelEditBtn.onmousedown = (e) => { 
        e.target.style.transform = 'translateY(3px) scale(0.96)'; 
        e.target.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)'; 
        e.target.style.backgroundColor = '#666'; 
    }; 
    presetCancelEditBtn.onmouseup = (e) => { 
        e.target.style.backgroundColor = '#777'; 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };

    presetCancelEditBtn.onclick = () => {
        zmlPresetModalNameInput.value = "";
        zmlPresetModalContentTextarea.value = "";
        zmlCurrentEditingPreset = null;
        showNotification("已取消预设编辑.", 'info');
    };

    actionButtons.append(presetCancelEditBtn, presetSaveBtn);
    addEditSection.append(nameGroup, contentGroup, actionButtons);


    // --- 预设列表区域 ---
    const listSection = createEl("div", "zml-preset-list-section", {
        style: `
            flex: 1; 
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 80)}; 
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 50)};
            border-radius: 8px; 
            padding: 8px; 
            display: flex;
            flex-direction: column;
            overflow-y: hidden; 
            margin-top: 8px; 
        `
    });
    listSection.innerHTML = `<h4 style="${sectionTitleStyle}">📋 现有预设</h4>`;
    
    zmlPresetModalContentContainer = createEl("div", "zml-preset-items-container", {
        style: `
            flex: 1; 
            overflow-y: auto; 
            padding-right: 8px; 
            display: flex;
            flex-direction: column;
            gap: 8px; 
            min-height: 200px; 
        `
    });
    listSection.append(zmlPresetModalContentContainer);

    // --- 关闭按钮 ---
    const closeBtn = createEl("button", "zml-control-btn zml-preset-modal-close", {
        textContent: "关闭",
        style: `
            ${buttonBasePresetStyle}
            background-color: '#E57373'; // 柔和的红色
            color: 'white';
            align-self: flex-end; 
            margin-top: 8px; 
        `
    });
    // 显眼的视觉反馈
    closeBtn.onmouseenter = (e) => { 
        e.target.style.backgroundColor = '#D36060'; 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };
    closeBtn.onmouseleave = (e) => { 
        e.target.style.backgroundColor = '#E57373'; 
        e.target.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)'; 
        e.target.style.transform = 'translateY(0) scale(1)'; 
    };
    closeBtn.onmousedown = (e) => { 
        e.target.style.transform = 'translateY(3px) scale(0.96)'; 
        e.target.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)'; 
        e.target.style.backgroundColor = '#B74C4C'; 
    };
    closeBtn.onmouseup = (e) => { 
        e.target.style.backgroundColor = '#D36060'; 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };
    closeBtn.onclick = () => zmlPresetModalOverlay.style.display = 'none';

    modalContainer.append(modalTitle, addEditSection, listSection, closeBtn);
    zmlPresetModalOverlay.appendChild(modalContainer);
    document.body.appendChild(zmlPresetModalOverlay);

    // 点击背景关闭
    zmlPresetModalOverlay.onclick = (e) => {
        if (e.target === zmlPresetModalOverlay) {
            zmlPresetModalOverlay.style.display = 'none';
        }
    };
}

async function renderPresetsList() {
    if (!zmlPresetModalContentContainer) return;

    const presets = await fetchPresets();
    zmlPresetModalContentContainer.innerHTML = ""; 

    if (presets.length === 0) {
        zmlPresetModalContentContainer.innerHTML = `<p style="text-align: center; color: ${ZML_PRESET_TEXT_COLOR}; margin-top: 20px; font-size: 1.1em;">🎨 暂无预设文本，赶快添加一个吧！</p>`;
        return;
    }

    presets.forEach(preset => {
        const itemCard = createEl("div", "zml-preset-item-card", {
            style: `
                background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 90)}; 
                border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 60)};
                border-radius: 6px;
                padding: 7px; 
                display: flex;
                flex-direction: column;
                gap: 4px; 
                box-shadow: 0 1px 4px rgba(0,0,0,0.08); 
                transition: background-color 0.2s ease, box-shadow 0.2s ease; 
            `
        });
        itemCard.onmouseenter = (e) => { e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 80); e.target.style.boxShadow = '0 3px 8px rgba(0,0,0,0.15)'; };
        itemCard.onmouseleave = (e) => { e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 90); e.target.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)'; };


        const nameDisplay = createEl("div", "zml-preset-name-display", {
            textContent: `名称: ${preset.name}`,
            title: preset.name,
            style: `
                font-weight: 600;
                color: ${ZML_PRESET_TEXT_COLOR}; 
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: 1.05em;
            `
        });

        const contentPreview = createEl("div", "zml-preset-content-preview", {
            textContent: `内容: ${preset.content.substring(0, 120)}${preset.content.length > 120 ? '...' : ''}`,
            title: preset.content,
            style: `
                font-size: 13px;
                color: ${adjustBrightness(ZML_PRESET_TEXT_COLOR, 40)}; 
                max-height: 44px; 
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            `
        });

        const buttonGroup = createEl("div", "", {
            style: `
                display: flex;
                justify-content: flex-end;
                gap: 8px; 
                margin-top: 5px; 
            `
        });

        // 这是预设列表中的小按钮样式
        const buttonBaseItemStyle = `
            padding: 8px 12px; 
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px; 
            font-weight: 500;
            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
            border: none;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1); 
            
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const editBtn = createEl("button", "zml-control-btn", { textContent: "✏️ 编辑" });
        Object.assign(editBtn.style, {
            cssText: buttonBaseItemStyle,
            backgroundColor: '#FFEB3B', // 柔和的黄色
            color: '#333',
        });
        // 显眼的视觉反馈
        editBtn.onmouseenter = (e) => { 
            e.target.style.backgroundColor = '#FBC02D'; 
            e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; 
            e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; 
        };
        editBtn.onmouseleave = (e) => { 
            e.target.style.backgroundColor = '#FFEB3B'; 
            e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; 
            e.target.style.transform = 'translateY(0) scale(1)'; 
        };
        editBtn.onmousedown = (e) => { 
            e.target.style.transform = 'translateY(1.5px) scale(0.97)'; 
            e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; 
            e.target.style.backgroundColor = '#D39E00'; 
        };
        editBtn.onmouseup = (e) => { 
            e.target.style.backgroundColor = '#FBC02D'; 
            e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; 
            e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; 
        };
        editBtn.onclick = () => {
            zmlPresetModalNameInput.value = preset.name;
            zmlPresetModalContentTextarea.value = preset.content;
            zmlCurrentEditingPreset = preset; 
            showNotification(`正在编辑预设: '${preset.name}'`, 'info', 2000);
        };

        const deleteBtn = createEl("button", "zml-control-btn", { textContent: "🗑️ 删除" });
        Object.assign(deleteBtn.style, {
            cssText: buttonBaseItemStyle,
            backgroundColor: '#E57373', // 柔和的红色
            color: 'white',
        });
        // 显眼的视觉反馈
        deleteBtn.onmouseenter = (e) => { 
            e.target.style.backgroundColor = '#D36060'; 
            e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; 
            e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; 
        };
        deleteBtn.onmouseleave = (e) => { 
            e.target.style.backgroundColor = '#E57373'; 
            e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; 
            e.target.style.transform = 'translateY(0) scale(1)'; 
        };
        deleteBtn.onmousedown = (e) => { 
            e.target.style.transform = 'translateY(1.5px) scale(0.97)'; 
            e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; 
            e.target.style.backgroundColor = '#B74C4C'; 
        };
        deleteBtn.onmouseup = (e) => { 
            e.target.style.backgroundColor = '#D36060'; 
            e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; 
            e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; 
        };
        deleteBtn.onclick = async () => {
            if (confirm(`确定要删除预设 "${preset.name}" 吗?`)) {
                if (zmlCurrentEditingPreset && zmlCurrentEditingPreset.name === preset.name) {
                    zmlPresetModalNameInput.value = "";
                    zmlPresetModalContentTextarea.value = "";
                    zmlCurrentEditingPreset = null; 
                }
                const success = await sendPresetRequest("delete", { name: preset.name });
                if (success) renderPresetsList();
            }
        };

        const addToOneClickBtn = createEl("button", "zml-control-btn", { textContent: "➕ 一键添加至节点" });
        Object.assign(addToOneClickBtn.style, {
            cssText: buttonBaseItemStyle,
            backgroundColor: ZML_PRESET_DARK_ACCENT, // 深绿色
            color: 'white',
        });
        // 显眼的视觉反馈
        addToOneClickBtn.onmouseenter = (e) => { 
            e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); 
            e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; 
            e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; 
        };
        addToOneClickBtn.onmouseleave = (e) => { 
            e.target.style.backgroundColor = ZML_PRESET_DARK_ACCENT; 
            e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; 
            e.target.style.transform = 'translateY(0) scale(1)'; 
        };
        addToOneClickBtn.onmousedown = (e) => { 
            e.target.style.transform = 'translateY(1.5px) scale(0.97)'; 
            e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; 
            e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -20); 
        };
        addToOneClickBtn.onmouseup = (e) => { 
            e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); 
            e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; 
            e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; 
        };
        addToOneClickBtn.onclick = () => {
            if (zmlTextV3CurrentNodeInstance) {
                const newId = "text" + Date.now() + Math.random().toString(36).substring(2, 8); 
                zmlTextV3CurrentNodeInstance.selectTextV3_data.entries.push({
                    id: newId,
                    item_type: "text",
                    title: preset.name,
                    content: preset.content,
                    enabled: true,
                    parent_id: null
                });
                zmlTextV3CurrentNodeInstance.triggerSlotChanged();
                showNotification(`预设 '${preset.name}' 已添加至节点.`, 'success'); 
            } else {
                showNotification("当前没有活动的SelectTextV3节点实例。", 'error');
            }
        };

        buttonGroup.append(editBtn, deleteBtn, addToOneClickBtn);
        itemCard.append(nameDisplay, contentPreview, buttonGroup);
        zmlPresetModalContentContainer.appendChild(itemCard);
    });
}

function showPresetModal(nodeInstance) {
    if (!zmlPresetModalOverlay) createPresetModal();
    if (nodeInstance) {
        zmlTextV3CurrentNodeInstance = nodeInstance; 
    }
    zmlPresetModalOverlay.style.display = 'flex';
    renderPresetsList(); 
    // Reset add/edit form when opening preset modal
    zmlPresetModalNameInput.value = "";
    zmlPresetModalContentTextarea.value = "";
    zmlCurrentEditingPreset = null;
}

// --- 节点扩展注册 ---
app.registerExtension({
    name: "ZML.SelectTextV3.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeType.comfyClass === "ZML_SelectTextV3") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;

                try {
                    if (this.selectTextV3_initialized) return r;
                    this.selectTextV3_initialized = true;

                    // 确保弹窗的DOM已创建
                    createEditContentModal();
                    createPresetModal(); 
                    createNotificationSystem(); // 创建消息提示系统
                    
                    if (!document.getElementById("zml-select-text-v3-styles")) {
                        const style = createEl("style"); 
                        style.id = "zml-select-text-v3-styles";
                        style.innerHTML = `
                            .zml-st3-entry-card.zml-st3-dragging,
                            .zml-st3-folder-card.zml-st3-dragging {
                                opacity: 0.5;
                                background: #555;
                            }
                            /* Dragging insertion line */
                            .zml-st3-drag-over-line {
                                border-top: 2px solid #5d99f2 !important;
                            }
                            /* Dragging into folder highlight */
                            .zml-st3-drag-over-folder {
                                background-color: rgba(93, 153, 242, 0.3) !important;
                            }

                            .zml-st3-drag-handle.locked {
                                cursor: not-allowed !important;
                                color: #666 !important;
                            }

                            /* Folder specific styles */
                            .zml-st3-folder-card {
                                background: #30353c; /* Default folder background */
                                border: 1px solid #4a515a; /* Default folder border */
                                border-radius: 4px;
                                margin-bottom: 4px; /* Spacing between folder cards */
                            }
                            .zml-st3-folder-header {
                                display: flex;
                                align-items: center;
                                padding: 4px;
                                cursor: pointer;
                                user-select: none;
                            }
                            .zml-st3-folder-toggle {
                                width: 20px;
                                text-align: center;
                                font-size: 14px;
                                user-select: none;
                                flex-shrink: 0;
                            }
                            .zml-st3-folder-name-input {
                                background: #2b2b2b;
                                border: 1px solid #444;
                                color: #ccc;
                                border-radius: 2px;
                                flex-grow: 1;
                                padding: 4px;
                                margin: 0 4px;
                            }
                            .zml-st3-folder-delete {
                                background: #444;
                                color: #ccc;
                                border: 1px solid #666;
                                border-radius: 2px;
                                width: 28px;
                                height: 28px;
                                cursor: pointer;
                                flex-shrink: 0;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            .zml-st3-folder-content {
                                padding: 4px;
                                border-top: 1px solid #4a515a;
                                display: flex;
                                flex-direction: column;
                                gap: 4px;
                            }
                            .zml-st3-folder-content.hidden {
                                display: none;
                            }

                            /* Existing control styles, ensuring consistency */
                            .zml-control-btn, .zml-control-input {
                                height: 26px; /* Default height */
                                padding: 0;
                                border: 1px solid #555;
                                border-radius: 2px;
                                background: #333;
                                color: #ccc;
                                cursor: pointer;
                                font-size: 14px;
                                line-height: 1;
                                box-sizing: border-box;
                                flex-shrink: 0;
                            }
                            .zml-control-input {
                                padding: 4px 8px;
                                font-size: 12px;
                                background: #333;
                            }
                            .zml-control-label {
                                font-size: 12px;
                                color: #ccc;
                                flex-shrink: 0;
                            }
                            .zml-control-group {
                                display: flex;
                                align-items: center;
                                gap: 4px;
                            }
                            // --- 新增：点击编辑的输入框样式 ---
                            .zml-st3-editable-content-input {
                                cursor: pointer; 
                            }
                            .zml-st3-editable-content-input:hover {
                                border-color: #5d99f2 !important; 
                                box-shadow: 0 0 5px rgba(93, 153, 242, 0.4); 
                            }
                            // --- 结束：新增 ---
                        `;
                        document.head.appendChild(style);
                    }

                    this.styles = {
                        normal: {
                            cardPadding: "6px",
                            inputPadding: "4px 8px",
                            inputHeight: "26px",
                            checkboxScale: "1.5",
                            newButtonPadding: "8px 16px",
                        },
                        compact: {
                            cardPadding: "2px 4px",
                            inputPadding: "2px 6px",
                            inputHeight: "22px",
                            checkboxScale: "1.2",
                            newButtonPadding: "4px 16px",
                        }
                    };

                    this.compactView = this.compactView ?? false;
                    this.isLocked = this.isLocked ?? false;
                    this.titleWidth = this.titleWidth ?? 80;
                    this.folderColor = this.folderColor ?? "#30353c";

                    if (!this.selectTextV3_data) {
                        this.selectTextV3_data = {
                            entries: [
                                { id: "entry1", item_type: "text", title: "", content: "", enabled: true, parent_id: null },
                            ]
                        };
                    } else {
                        this.selectTextV3_data.entries.forEach(e => {
                            if (!e.item_type) e.item_type = 'text'; 
                            if (e.parent_id === undefined) e.parent_id = null; 
                        });
                    }

                    this.language = "zh";
                    this.texts = {
                        zh: {
                            title: "选择文本V3",
                            separator: "分隔符",
                            newTextBox: "新建文本框",
                            inputName: "输入名称...",
                            inputContent: "输入内容...",
                            lockDrag: "锁定/解锁文本框排序",
                            titleWidth: "名称宽度",
                            newFolder: "新建文件夹",
                            moveOut: "移出",
                            deleteFolder: "删除文件夹",
                            presetText: "预设文本", 
                        }
                    };
                    this.getText = (key) => this.texts[this.language][key] || key;

                    const dataWidget = this.addWidget("text", "selectTextV3_data", JSON.stringify(this.selectTextV3_data), (v) => { try { if(v) this.selectTextV3_data = JSON.parse(v); } catch(e){} }, { serialize: true });
                    dataWidget.hidden = true;
                    dataWidget.computeSize = () => [0, 0];

                    const container = createEl("div");
                    container.style.cssText = `position: absolute; top: -38px; left: 0; right: 5px; height: calc(100% + 38px); padding: 40px 6px 6px 6px; background: #2b2b2b; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; display: flex; flex-direction: column; z-index: 1;`;

                    const header = createEl("div");
                    header.style.cssText = `display: flex; align-items: center; margin-top: -32px; margin-bottom: 8px; padding-bottom: 0px; border-bottom: 1px solid #444;`;

                    const controlsRow = createEl("div");
                    // 恢复默认的按钮高度，确保间距，避免溢出
                    controlsRow.style.cssText = `margin-bottom: 8px; display: flex; align-items: center; gap: 4px;`; 

                    const separatorGroup = createEl("div", "zml-control-group");
                    const separatorInput = createEl("input", "zml-control-input", {
                         placeholder: this.getText("separator"),
                         title: this.getText("separator"),
                    });
                    separatorInput.type = "text";
                    separatorInput.value = escapeNewlinesForInput(this.widgets.find(w => w.name === "separator")?.value || ""); 
                    separatorInput.style.cssText += `width: 60px; text-align: left; flex-shrink: 0;`;
                    separatorInput.oninput = (e) => { 
                        this.widgets.find(w => w.name === "separator").value = unescapeNewlinesFromInput(e.target.value);
                        this.triggerSlotChanged();
                    };
                    separatorGroup.append(separatorInput);
                    controlsRow.appendChild(separatorGroup);

                    const titleWidthGroup = createEl("div", "zml-control-group");
                    const titleWidthInput = createEl("input", "zml-control-input");
                    titleWidthInput.type = "number";
                    titleWidthInput.min = "20";
                    titleWidthInput.max = "300";
                    titleWidthInput.value = this.titleWidth;
                    titleWidthInput.placeholder = this.getText("titleWidth");
                    titleWidthInput.title = this.getText("titleWidth");
                    titleWidthInput.style.cssText += `width: 60px; text-align: left; flex-shrink: 0;`;
                    titleWidthInput.oninput = (e) => {
                        this.titleWidth = parseInt(e.target.value, 10);
                    };
                    titleWidthInput.onblur = (e) => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val)) val = 80;
                        val = Math.max(20, Math.min(300, val));
                        this.titleWidth = val;
                        e.target.value = val; 
                        this.renderSelectTextV3Entries(); 
                        this.triggerSlotChanged(); 
                    };
                    titleWidthGroup.append(titleWidthInput);
                    controlsRow.appendChild(titleWidthGroup);

                    const newFolderBtn = createEl("button", "zml-control-btn", { textContent: "📁+" });
                    newFolderBtn.title = this.getText("newFolder");
                    newFolderBtn.style.cssText += `
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                        width: 26px; /* 恢复默认宽度以匹配其他小按钮 */
                        height: 26px; /* 恢复默认高度 */
                        padding: 0; /* 移除额外padding */
                        font-size: 14px; /* 保持图标大小 */
                    `;
                    newFolderBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    newFolderBtn.onmouseleave = (e) => { e.target.style.background = '#333'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    newFolderBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    newFolderBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; }; 
                    newFolderBtn.onclick = () => {
                        this.selectTextV3_data.entries.push({
                            id: "folder" + Date.now(),
                            item_type: "folder",
                            name: "新建文件夹",
                            is_collapsed: false,
                            parent_id: null,
                        });
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(newFolderBtn);

                    const folderColorInput = createEl("input", "", { type: "color", value: this.folderColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                    folderColorInput.onchange = (e) => {
                        this.folderColor = e.target.value;
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    const folderColorBtn = createEl("button", "zml-control-btn", { textContent: "🎨" });
                    folderColorBtn.title = "自定义文件夹颜色";
                    folderColorBtn.style.cssText += `
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                        width: 26px; /* 恢复默认宽度 */
                        height: 26px; /* 恢复默认高度 */
                        padding: 0;
                    `;
                    folderColorBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    folderColorBtn.onmouseleave = (e) => { e.target.style.background = '#333'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    folderColorBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    folderColorBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    folderColorBtn.onclick = () => folderColorInput.click();
                    controlsRow.append(folderColorInput, folderColorBtn);

                    const lockToggleButton = createEl("button", "zml-control-btn", { textContent: this.isLocked ? "🔒" : "🔓" });
                    lockToggleButton.title = this.getText("lockDrag");
                    // Add feedback
                    lockToggleButton.style.cssText += `
                        width: 26px; height: 26px; /* 恢复默认高度 */
                        ${this.isLocked ? 'background: #644;' : 'background: #333;'} 
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                        padding: 0;
                    `;
                    lockToggleButton.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    lockToggleButton.onmouseleave = (e) => { e.target.style.background = this.isLocked ? '#644' : '#333'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    lockToggleButton.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    lockToggleButton.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    lockToggleButton.onclick = () => {
                        this.isLocked = !this.isLocked;
                        lockToggleButton.textContent = this.isLocked ? "🔒" : "🔓";
                        lockToggleButton.style.background = this.isLocked ? '#644' : '#333';
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(lockToggleButton);

                    const sizeToggleButton = createEl("button", "zml-control-btn", { textContent: "↕" });
                    sizeToggleButton.title = "切换紧凑/普通视图";
                    sizeToggleButton.style.cssText += `
                        width: 26px; height: 26px; /* 恢复默认高度 */
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                        padding: 0;
                    `;
                    sizeToggleButton.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    sizeToggleButton.onmouseleave = (e) => { e.target.style.background = '#333'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    sizeToggleButton.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    sizeToggleButton.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    sizeToggleButton.onclick = () => {
                        this.compactView = !this.compactView;
                        this.applySizeMode();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(sizeToggleButton);

                    const entriesList = createEl("div");
                    entriesList.style.cssText = `margin-bottom: 6px; flex: 1; min-height: 50px; overflow-y: auto; border: 1px solid #444; border-radius: 2px; padding: 4px; background: #333;`;

                    const presetTextButton = createEl("button", "", { textContent: this.getText("presetText") });
                    presetTextButton.style.cssText = `
                        background: #444; color: #ccc; border: 1px solid #666; border-radius: 2px;
                        cursor: pointer; font-size: 13px; font-weight: 500; margin-top: auto;
                        padding: 4px 10px; /* 恢复默认大小 */
                        margin-right: 4px; 
                        flex-grow: 1; 
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                    `;
                    presetTextButton.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    presetTextButton.onmouseleave = (e) => { e.target.style.background = '#444'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    presetTextButton.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    presetTextButton.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    presetTextButton.onclick = () => showPresetModal(this); 

                    const newTextBoxBtn = createEl("button", "", { textContent: "＋ " + this.getText("newTextBox") });
                    newTextBoxBtn.style.cssText = `
                        background: #444; color: #ccc; border: 1px solid #666; border-radius: 2px;
                        cursor: pointer; font-size: 13px; font-weight: 500; margin-top: auto; flex-grow: 1;
                        padding: 4px 10px; /* 恢复默认大小 */
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                    `;
                    newTextBoxBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    newTextBoxBtn.onmouseleave = (e) => { e.target.style.background = '#444'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    newTextBoxBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    newTextBoxBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    newTextBoxBtn.onclick = () => {
                        const newId = "text" + Date.now();
                        this.selectTextV3_data.entries.push({ id: newId, item_type: "text", title: "", content: "", enabled: true, parent_id: null });
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };

                    const bottomButtonGroup = createEl("div", "", {
                        style: `display: flex; gap: 4px; margin-top: auto;` 
                    });
                    bottomButtonGroup.append(presetTextButton, newTextBoxBtn); 

                    container.append(header, controlsRow, entriesList, bottomButtonGroup); 

                    this.applySizeMode = () => {
                        // 这些将由上面的 style.cssText Individual sizing设置控制
                        // presetTextButton.style.padding = s.newButtonPadding; 
                        // newTextBoxBtn.style.padding = s.newButtonPadding;
                        this.renderSelectTextV3Entries();
                    };
                    
                    this.createTextEntryDOM = (entry) => {
                        const s = this.compactView ? this.styles.compact : this.styles.normal;
                        const entryCard = createEl("div", "zml-st3-entry-card", {
                            style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${entry.enabled ? '#3a3a3a' : '#2a2a2a'}; border: 1px solid ${entry.enabled ? '#555' : '#444'}; border-radius: 2px;`
                        });
                        entryCard.dataset.id = entry.id;
                        entryCard.dataset.type = "text";

                        const checkbox = createEl("input", "", { type: "checkbox", checked: entry.enabled, style: `transform: scale(${s.checkboxScale}); flex-shrink: 0; margin-right: 4px;` });
                        checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderSelectTextV3Entries(); this.triggerSlotChanged(); };

                        const dragHandle = createEl("div", "zml-st3-drag-handle", { textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: 14px;` });
                        dragHandle.draggable = !this.isLocked;

                        const baseInputStyle = `box-sizing: border-box; background: #2b2b2b; border: 1px solid #444; border-radius: 2px; color: #ccc; font-size: 12px; margin-right: 4px; padding: ${s.inputPadding}; height: ${s.inputHeight};`;

                        const titleInput = createEl("input", "", { type: "text", value: entry.title, placeholder: this.getText("inputName"), style: `width: ${this.titleWidth}px; ${baseInputStyle}` });
                        titleInput.oninput = (e) => {
                            entry.title = e.target.value;
                        };
                        titleInput.onblur = () => {
                            this.triggerSlotChanged(); 
                        };

                        const contentInput = createEl("input", "zml-st3-editable-content-input", {
                            type: "text",
                            value: entry.content || "",
                            placeholder: this.getText("inputContent"),
                            readOnly: true,
                            style: `flex: 1; min-width: 50px; ${baseInputStyle}`
                        });
                        const currentNodeInstance = this;
                        contentInput.onclick = () => {
                            showEditContentModal(entry, currentNodeInstance);
                        };

                        entryCard.append(checkbox, dragHandle, titleInput, contentInput);

                        if (entry.parent_id) {
                            const moveOutBtn = createEl("button", "", {
                                textContent: "⬆️", title: this.getText("moveOut"),
                                style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #4a6a4a; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0; margin-right: 4px;
                                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;`
                            });
                            moveOutBtn.onmouseenter = (e) => { e.target.style.backgroundColor = '#5c8a5c'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(-1px) scale(1.02)'; };
                            moveOutBtn.onmouseleave = (e) => { e.target.style.backgroundColor = '#4a6a4a'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                            moveOutBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(0.5px) scale(0.98)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
                            moveOutBtn.onmouseup = (e) => { e.target.style.backgroundColor = '#5c8a5c'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(0) scale(1)'; }; 
                            moveOutBtn.onclick = () => {
                                entry.parent_id = null;
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            };
                            entryCard.appendChild(moveOutBtn);
                        }

                        const deleteBtn = createEl("button", "", { textContent: "X", style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0;
                            transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;` });
                        deleteBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(-1px) scale(1.02)'; };
                        deleteBtn.onmouseleave = (e) => { e.target.style.background = '#444'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                        deleteBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(0.5px) scale(0.98)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
                        deleteBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(0) scale(1)'; }; 
                        deleteBtn.onclick = () => {
                            const itemIndex = this.selectTextV3_data.entries.findIndex(it => it.id === entry.id);
                            if (itemIndex > -1) {
                                this.selectTextV3_data.entries.splice(itemIndex, 1);
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };
                        entryCard.appendChild(deleteBtn);

                        this.addDragDropHandlers(entryCard, entry);
                        return entryCard;
                    };


                    this.createFolderDOM = (entry) => {
                        const folderCard = createEl("div", "zml-st3-folder-card", {
                            style: `background: ${this.folderColor}; border: 1px solid ${adjustBrightness(this.folderColor, -15)};`
                        });
                        folderCard.dataset.id = entry.id;
                        folderCard.dataset.type = "folder";

                        const header = createEl("div", "zml-st3-folder-header");
                        const toggle = createEl("div", "zml-st3-folder-toggle", { textContent: entry.is_collapsed ? "▶" : "▼" });
                        const nameInput = createEl("input", "zml-st3-folder-name-input", { type: "text", value: entry.name, placeholder: "文件夹名称" });
                        const deleteBtn = createEl("button", "zml-st3-folder-delete", { textContent: "🗑️", title: this.getText("deleteFolder") });
                        const dragHandle = createEl("div", "zml-st3-drag-handle", { textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; color: ${this.isLocked ? '#666' : '#ccc'}; user-select: none; font-size: 14px; padding: 0 5px;` });
                        dragHandle.draggable = !this.isLocked;

                        const content = createEl("div", `zml-st3-folder-content ${entry.is_collapsed ? 'hidden' : ''}`, {
                            style: `border-top: 1px solid ${adjustBrightness(this.folderColor, -15)};`
                        });

                        header.onclick = (e) => {
                            if (e.target === nameInput || e.target === deleteBtn || e.target === dragHandle) return;
                            if (e.target === header || e.target === toggle || e.target.parentElement === header) {
                                entry.is_collapsed = !entry.is_collapsed;
                                toggle.textContent = entry.is_collapsed ? "▶" : "▼";
                                content.classList.toggle('hidden', entry.is_collapsed);
                                this.triggerSlotChanged();
                            }
                        };

                        nameInput.onchange = (e) => { entry.name = e.target.value; this.triggerSlotChanged(); };

                        // Add feedback for folder delete button
                        deleteBtn.style.cssText += `transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;`;
                        deleteBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(-1px) scale(1.02)'; };
                        deleteBtn.onmouseleave = (e) => { e.target.style.background = '#444'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                        deleteBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(0.5px) scale(0.98)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
                        deleteBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(0) scale(1)'; }; 

                        deleteBtn.onclick = (e) => {
                            e.stopPropagation();
                            const children = this.selectTextV3_data.entries.filter(it => it.parent_id === entry.id);
                            if (children.length > 0) {
                                alert("文件夹内含有文本框，无法删除！");
                                return;
                            }
                            const itemIndex = this.selectTextV3_data.entries.findIndex(it => it.id === entry.id);
                            if (itemIndex > -1) {
                                this.selectTextV3_data.entries.splice(itemIndex, 1);
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };

                        header.append(toggle, dragHandle, nameInput, deleteBtn);
                        folderCard.append(header, content);
                        this.addDragDropHandlers(folderCard, entry);
                        return folderCard;
                    };

                    this.addDragDropHandlers = (element, entry) => {
                        if (this.isLocked) return;

                        const handle = element.querySelector(".zml-st3-drag-handle");
                        if (!handle) return;

                        handle.ondragstart = (e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData("text/plain", entry.id);
                            e.dataTransfer.setDragImage(element, e.offsetX, e.offsetY);
                            setTimeout(() => element.classList.add("zml-st3-dragging"), 0);
                        };

                        element.ondragover = (e) => {
                            e.preventDefault();
                            const draggingEl = document.querySelector(".zml-st3-dragging");
                            if (draggingEl && draggingEl !== element) {
                                const draggingEntryId = e.dataTransfer.getData("text/plain");
                                const draggingEntry = this.selectTextV3_data.entries.find(it => it.id === draggingEntryId);

                                if (!draggingEntry) return;

                                document.querySelectorAll(".zml-st3-drag-over-line, .zml-st3-drag-over-folder").forEach(el => {
                                    el.classList.remove("zml-st3-drag-over-line", "zml-st3-drag-over-folder");
                                });

                                if (entry.item_type === 'folder' && draggingEntry.item_type === 'text') {
                                    element.querySelector('.zml-st3-folder-header').classList.add("zml-st3-drag-over-folder");
                                } else {
                                    element.classList.add("zml-st3-drag-over-line");
                                }
                            }
                        };

                        element.ondragleave = (e) => {
                            element.classList.remove("zml-st3-drag-over-line");
                            if (entry.item_type === 'folder') {
                                element.querySelector('.zml-st3-folder-header').classList.remove("zml-st3-drag-over-folder");
                            }
                        };

                        element.ondrop = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            document.querySelectorAll(".zml-st3-drag-over-line, .zml-st3-drag-over-folder").forEach(el => {
                                el.classList.remove("zml-st3-drag-over-line", "zml-st3-drag-over-folder");
                            });

                            const fromId = e.dataTransfer.getData("text/plain");
                            const toId = entry.id;

                            const fromIndex = this.selectTextV3_data.entries.findIndex(it => it.id === fromId);
                            const toIndex = this.selectTextV3_data.entries.findIndex(it => it.id === toId);
                            const fromItem = this.selectTextV3_data.entries[fromIndex];
                            const toItem = this.selectTextV3_data.entries[toIndex];

                            if (fromIndex === -1 || toIndex === -1 || fromId === toId) return;

                            const itemToMove = this.selectTextV3_data.entries.splice(fromIndex, 1)[0];
                            let newInsertIndex = this.selectTextV3_data.entries.findIndex(it => it.id === toId); 

                            if (newInsertIndex === -1) { 
                                this.selectTextV3_data.entries.push(itemToMove); 
                                console.warn(`Target item for drop not found after splice, item moved to end.`);
                            } else if (toItem.item_type === 'folder' && fromItem.item_type === 'text') {
                                itemToMove.parent_id = toItem.id;
                                this.selectTextV3_data.entries.splice(newInsertIndex + 1, 0, itemToMove); 
                            } else {
                                itemToMove.parent_id = toItem.parent_id;
                                const isDroppingToOwnChild = itemToMove.item_type === 'folder' && itemToMove.id === toItem.parent_id;
                                if (!isDroppingToOwnChild) {
                                    this.selectTextV3_data.entries.splice(newInsertIndex, 0, itemToMove);
                                } else {
                                    this.selectTextV3_data.entries.splice(toIndex + 1, 0, itemToMove); 
                                    console.warn("Attempted to drop folder into its own child - adjusted insert position.");
                                }
                            }


                            this.renderSelectTextV3Entries();
                            this.triggerSlotChanged();
                        };

                        element.ondragend = (e) => {
                            element.classList.remove("zml-st3-dragging");
                            document.querySelectorAll(".zml-st3-drag-over-line, .zml-st3-drag-over-folder").forEach(el => {
                                el.classList.remove("zml-st3-drag-over-line", "zml-st3-drag-over-folder");
                            });
                        };
                    };

                    this.renderSelectTextV3Entries = () => {
                        entriesList.innerHTML = "";
                        if (!this.selectTextV3_data || !Array.isArray(this.selectTextV3_data.entries)) {
                            this.selectTextV3_data = { entries: [] };
                        }

                        const itemMap = new Map(this.selectTextV3_data.entries.map(e => [e.id, { entry: e, dom: null }]));

                        for (const [id, item] of itemMap) {
                            if (item.entry.item_type === 'folder') {
                                item.dom = this.createFolderDOM(item.entry);
                            } else {
                                item.dom = this.createTextEntryDOM(item.entry);
                            }
                        }

                        const topLevelItems = this.selectTextV3_data.entries.filter(e => !e.parent_id);

                        const appendRecursive = (parentDom, itemsToAppend) => {
                            itemsToAppend.forEach(item => {
                                const domInfo = itemMap.get(item.id);
                                if (!domInfo || !domInfo.dom) return; 

                                parentDom.appendChild(domInfo.dom);

                                if (item.item_type === 'folder') {
                                    const folderContentArea = domInfo.dom.querySelector('.zml-st3-folder-content');
                                    if (folderContentArea) {
                                        const children = this.selectTextV3_data.entries.filter(e => e.parent_id === item.id);
                                        const sortedChildren = children.sort((a, b) =>
                                            this.selectTextV3_data.entries.indexOf(a) - this.selectTextV3_data.entries.indexOf(b)
                                        );
                                        appendRecursive(folderContentArea, sortedChildren);
                                    }
                                }
                            });
                        };

                        const sortedTopLevelItems = topLevelItems.sort((a, b) =>
                            this.selectTextV3_data.entries.indexOf(a) - this.selectTextV3_data.entries.indexOf(b)
                        );

                        appendRecursive(entriesList, sortedTopLevelItems);
                        this.updateOutputPreview();
                        app.graph.setDirtyCanvas(true, true);
                    };

                    this.updateOutputPreview = () => {
                        const separatorWidget = this.widgets.find(w => w.name === "separator");
                        const separator = separatorWidget ? separatorWidget.value : ",";
                        
                        let combinedContent = "";
                        const NEWLINE_PLACEHOLDER = "__ZML_NEWLINE_PLACEHOLDER__"; // Unique placeholder

                        const collectContentRecursive = (items) => {
                            items.forEach(entry => {
                                if (entry.item_type === 'text' && entry.enabled) {
                                    // Replace actual newlines with a placeholder first
                                    let contentToAdd = entry.content.replace(/\n/g, NEWLINE_PLACEHOLDER).trim();
                                    
                                    // Now apply separator trimming, which should not affect the placeholders
                                    contentToAdd = contentToAdd.replace(new RegExp(`^${(separator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+|${(separator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+$`, 'g'), '');

                                    if(contentToAdd) { 
                                        combinedContent += (combinedContent ? separator : "") + contentToAdd;
                                    }
                                } else if (entry.item_type === 'folder' && !entry.is_collapsed) {
                                    const children = this.selectTextV3_data.entries.filter(e => e.parent_id === entry.id);
                                    const sortedChildren = children.sort((a, b) => 
                                        this.selectTextV3_data.entries.indexOf(a) - this.selectTextV3_data.entries.indexOf(b)
                                    );
                                    collectContentRecursive(sortedChildren);
                                }
                            });
                        };
                        
                        const topLevelItems = this.selectTextV3_data.entries.filter(e => !e.parent_id);
                        collectContentRecursive(topLevelItems.sort((a, b) => this.selectTextV3_data.entries.indexOf(a) - this.selectTextV3_data.entries.indexOf(b)));


                        const outputWidget = this.widgets.find(w=>w.name === "text");
                        if(outputWidget) {
                            let finalOutput = combinedContent;
                            finalOutput = finalOutput.replace(new RegExp(`(${separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}){2,}`, 'g'), separator);
                            finalOutput = finalOutput.replace(new RegExp(`^${(separator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+|${(separator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+$`, 'g'), '');
                            
                            // Finally, replace the newline placeholders back to actual newlines
                            finalOutput = finalOutput.replace(new RegExp(NEWLINE_PLACEHOLDER, 'g'), '\n');

                            outputWidget.value = finalOutput;
                        }
                    };

                    this.addDOMWidget("selecttextv3_ui", "div", container, { serialize: false });
                    
                    const initialHeightFromWidgets = (this.widgets_always_on_top?.[0]?.last_y || 0) + ZML_SELECT_TEXT_V3_MIN_HEIGHT_EMPTY_LIST;
                    this.size = [
                        Math.max(this.size[0] || 0, ZML_SELECT_TEXT_V3_MIN_WIDTH), 
                        Math.max(this.size[1] || 0, initialHeightFromWidgets)
                    ];
                    
                    const origOnResize = this.onResize;
                    this.onResize = function(size) {
                        size[0] = Math.max(size[0], ZML_SELECT_TEXT_V3_MIN_WIDTH);

                        // 确保计算高度时考虑所有元素实际高度
                        let actualControlsRowHeight = controlsRow.offsetHeight;
                        let actualBottomButtonGroupHeight = bottomButtonGroup.offsetHeight;
                        let actualEntriesListHeight = entriesList.scrollHeight > entriesList.clientHeight ? entriesList.scrollHeight : entriesList.clientHeight; // 取实际内容高度与视口高度最大值

                        let currentContentHeight = actualControlsRowHeight + actualEntriesListHeight + actualBottomButtonGroupHeight + 12; // 加上一些额外的间距

                        currentContentHeight = Math.max(currentContentHeight, initialHeightFromWidgets);

                        size[1] = Math.max(size[1], currentContentHeight);
                        this.size = size;

                        if (origOnResize) origOnResize.call(this, size);
                    };

                    this.triggerSlotChanged = () => {
                        dataWidget.value = JSON.stringify(this.selectTextV3_data);
                        this.updateOutputPreview();
                        this.renderSelectTextV3Entries(); 
                        this.setDirtyCanvas(true, true);
                    };

                    setTimeout(() => {
                        this.onResize(this.size);
                        this.applySizeMode();
                    }, 0);


                } catch (error) { console.error("ZML_SelectTextV3: Error during initialization:", error); }
                return r;
            };

            const origOnSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(obj) {
                origOnSerialize ? origOnSerialize.apply(this, arguments) : undefined;
                if (this.selectTextV3_data) obj.selectTextV3_data = this.selectTextV3_data;
                obj.compactView = this.compactView;
                obj.isLocked = this.isLocked;
                obj.titleWidth = this.titleWidth;
                obj.folderColor = this.folderColor;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(obj) {
                origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
                if (obj.selectTextV3_data) {
                    this.selectTextV3_data = obj.selectTextV3_data;
                    this.selectTextV3_data.entries.forEach(e => {
                        if (!e.item_type) e.item_type = 'text';
                        if (e.parent_id === undefined) e.parent_id = null;
                        if (e.item_type === 'folder' && e.is_collapsed === undefined) e.is_collapsed = false;
                        if (e.item_type === 'folder' && e.name === undefined) e.name = "新建文件夹";
                    });
                } else {
                    this.selectTextV3_data = { entries: [] };
                }
                if (obj.compactView !== undefined) this.compactView = obj.compactView;
                if (obj.isLocked !== undefined) this.isLocked = obj.isLocked;
                if (obj.titleWidth !== undefined) {
                    this.titleWidth = obj.titleWidth;
                }
                this.folderColor = obj.folderColor ?? "#30353c";

                if (this.selectTextV3_initialized) {
                    setTimeout(() => {
                        const dataWidget = this.widgets.find(w => w.name === "selectTextV3_data");
                        if (dataWidget) dataWidget.value = JSON.stringify(this.selectTextV3_data);

                        const separatorInput = this.domElement?.querySelector("input[placeholder='" + this.getText("separator") + "']");
                        if (separatorInput) {
                            separatorInput.placeholder = this.getText("separator");
                        }

                        const lockButton = this.domElement?.querySelector("button.zml-control-btn[title='锁定/解锁文本框排序']");
                        if (lockButton) {
                            lockButton.textContent = this.isLocked ? "🔒" : "🔓";
                            lockButton.style.background = this.isLocked ? '#644' : '#333';
                        }
                        const titleWidthInput = this.domElement?.querySelector("input.zml-control-input[type='number']");
                        if (titleWidthInput) {
                            titleWidthInput.value = this.titleWidth;
                        }
                        const folderColorInput = this.domElement?.querySelector("input[type='color']");
                        if (folderColorInput) {
                            folderColorInput.value = this.folderColor;
                        }
                        
                        // Update feedback for node control buttons based on current state
                        const controlButtons = this.domElement?.querySelectorAll('.zml-control-btn');
                        controlButtons.forEach(btn => {
                            if (btn.title === "锁定/解锁文本框排序") {
                                btn.style.background = this.isLocked ? '#644' : '#333';
                            }
                        });


                        this.applySizeMode();
                        this.onResize(this.size);
                    }, 10);
                }
            };
        }
    }
});
