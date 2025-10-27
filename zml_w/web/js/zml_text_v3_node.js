import { app } from "../../../scripts/app.js";

// 新增：定义 SelectTextV3 节点推荐的最小宽度和高度
const ZML_SELECT_TEXT_V3_MIN_WIDTH = 350; // 适配控件数量
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
let zmlSelectedPresets = []; // 存储批量操作中选中的预设
let zmlBatchManagementMode = false; // 跟踪是否处于批量管理模式

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
    
    // 移除点击背景关闭逻辑 - 必须通过取消或保存按钮关闭
    // 用户请求必须点击按钮才能关闭UI
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
            if (action === 'add') msg = `${payload.type === 'folder' ? '文件夹' : '预设'} '${payload.name}' 已添加.`;
            else if (action === 'update') msg = `${payload.type === 'folder' ? '文件夹' : '预设'} '${payload.new_name || payload.name}' 已更新.`;
            else if (action === 'delete') msg = `${payload.type === 'folder' ? '文件夹' : '预设'} 已删除.`;
            else if (action === 'reorder') msg = `预设顺序已更新.`;
            if (msg) showNotification(msg, 'success');
        }
        return data; // Return full data to get new ID for 'add'
    } catch (error) {
        console.error(`Error during preset operation '${action}':`, error);
        showNotification(`请求出错: ${error.message}`, 'error');
        return { success: false, message: error.message };
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
            /* 移除固定宽度，让模态框自适应屏幕大小 */
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
        textContent: "预设文本管理器"
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
    addEditSection.innerHTML = `<h4 style="${sectionTitleStyle}">添加/编辑预设</h4>`;

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
        padding: 20px 20px; /* 增加按钮高度 */
        border-radius: 8px; 
        cursor: pointer;
        font-size: 14px; /* 调整字体大小 */
        font-weight: 600;
        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
        border: none;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2); 
        
        display: flex;
        align-items: center;
        justify-content: center;
        height: 40px; /* 设置固定高度以确保一致 */
    `;

    const presetSaveBtn = createEl("button", "zml-control-btn", { textContent: "保存/新增预设" });
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

    presetSaveBtn.onclick = async () => {
        const name = zmlPresetModalNameInput.value.trim();
        const content = zmlPresetModalContentTextarea.value;
        const parent_id = zmlCurrentEditingPreset ? zmlCurrentEditingPreset.parent_id : null; // Assume top-level if not editing

        if (!name) {
            showNotification("请输入预设名称！", 'error');
            return;
        }
        
        if (zmlCurrentEditingPreset && zmlCurrentEditingPreset.type === 'text') {
            // 更新现有文本预设
            const result = await sendPresetRequest("update", {
                id: zmlCurrentEditingPreset.id,
                type: 'text',
                new_name: name,
                new_content: content,
                parent_id: parent_id
            });
            if (result.success) {
                zmlPresetModalNameInput.value = "";
                zmlPresetModalContentTextarea.value = "";
                zmlCurrentEditingPreset = null;
                renderPresetsList();
            }
        } else {
            // 添加新文本预设
            const result = await sendPresetRequest("add", {
                type: 'text',
                name: name,
                content: content,
                parent_id: parent_id // New text presets are added to the current folder context
            });
            if (result.success) {
                zmlPresetModalNameInput.value = "";
                zmlPresetModalContentTextarea.value = "";
                renderPresetsList();
            }
        }
    };

    const presetNewFolderBtn = createEl("button", "zml-control-btn", { textContent: "新建文件夹" });
    Object.assign(presetNewFolderBtn.style, {
        cssText: buttonBasePresetStyle,
        backgroundColor: '#607D8B', // 蓝色灰色
        color: 'white',
    });
    presetNewFolderBtn.onmouseenter = (e) => { 
        e.target.style.backgroundColor = adjustBrightness('#607D8B', -10); 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    }; 
    presetNewFolderBtn.onmouseleave = (e) => { 
        e.target.style.backgroundColor = '#607D8B'; 
        e.target.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)'; 
        e.target.style.transform = 'translateY(0) scale(1)'; 
    };
    presetNewFolderBtn.onmousedown = (e) => { 
        e.target.style.transform = 'translateY(3px) scale(0.96)'; 
        e.target.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)'; 
        e.target.style.backgroundColor = adjustBrightness('#607D8B', -20); 
    }; 
    presetNewFolderBtn.onmouseup = (e) => { 
        e.target.style.backgroundColor = adjustBrightness('#607D8B', -10); 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };
    presetNewFolderBtn.onclick = async () => {
        const folderName = prompt("请输入新文件夹的名称:", "新建文件夹");
        if (folderName && folderName.trim()) {
            const result = await sendPresetRequest("add", {
                type: 'folder',
                name: folderName.trim(),
                parent_id: null // New folders are always top-level initially
            });
            if (result.success) {
                renderPresetsList();
            }
        } else if (folderName !== null) { // If user clicked cancel, folderName is null
            showNotification("文件夹名称不能为空。", 'error');
        }
    };

    const presetCancelEditBtn = createEl("button", "zml-control-btn", { textContent: "取消" });
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

    // 批量管理按钮
    const presetBatchManageBtn = createEl("button", "zml-control-btn", { textContent: "批量管理" });
    Object.assign(presetBatchManageBtn.style, {
        cssText: buttonBasePresetStyle,
        backgroundColor: '#FF9800', // 橙色
        color: 'white',
    });
    presetBatchManageBtn.onmouseenter = (e) => { 
        e.target.style.backgroundColor = adjustBrightness('#FF9800', -10); 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    }; 
    presetBatchManageBtn.onmouseleave = (e) => { 
        e.target.style.backgroundColor = '#FF9800'; 
        e.target.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)'; 
        e.target.style.transform = 'translateY(0) scale(1)'; 
    };
    presetBatchManageBtn.onmousedown = (e) => { 
        e.target.style.transform = 'translateY(3px) scale(0.96)'; 
        e.target.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)'; 
        e.target.style.backgroundColor = adjustBrightness('#FF9800', -20); 
    }; 
    presetBatchManageBtn.onmouseup = (e) => { 
        e.target.style.backgroundColor = adjustBrightness('#FF9800', -10); 
        e.target.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.4)'; 
        e.target.style.transform = 'translateY(-3px) scale(1.02)'; 
    };
    presetBatchManageBtn.onclick = () => {
        zmlBatchManagementMode = !zmlBatchManagementMode;
        if (zmlBatchManagementMode) {
            presetBatchManageBtn.textContent = "退出批量管理";
            presetBatchManageBtn.style.backgroundColor = '#F44336'; // 红色表示退出
            showNotification("已进入批量管理模式，点击预设项进行选择.", 'info');
            zmlSelectedPresets = [];
        } else {
            presetBatchManageBtn.textContent = "批量管理";
            presetBatchManageBtn.style.backgroundColor = '#FF9800'; // 橙色表示进入
            showNotification("已退出批量管理模式.", 'info');
            zmlSelectedPresets = [];
        }
        renderPresetsList();
    };

    actionButtons.append(presetBatchManageBtn, presetCancelEditBtn, presetNewFolderBtn, presetSaveBtn); // Add new folder button
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
    listSection.innerHTML = `<h4 style="${sectionTitleStyle}">现有预设</h4>`;
    
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

    // 移除点击背景自动关闭的功能，用户必须点击关闭按钮才能退出
    // 这样可以防止用户意外点击背景导致退出，提高操作便利性

}

let zmlPresetDraggingItem = null; // Track the item being dragged
let zmlPresetDragOverTarget = null; // Track the element being dragged over
let zmlPresetDragOverPosition = null; // "before", "after", "into"

// Helper function to build a tree structure from a flat list of presets
function buildPresetTree(flatPresets) {
    const tree = [];
    const itemsById = {};
    
    // First, create a map of all items by their ID
    flatPresets.forEach(item => {
        // 确保文件夹默认保持折叠状态
        if (item.type === 'folder') {
            // 始终设置为折叠状态，无论服务器返回什么值
            itemsById[item.id] = {...item, children: [], is_collapsed: true}; // 克隆并设置默认折叠状态
        } else {
            itemsById[item.id] = {...item, children: []}; // 克隆并初始化children数组
        }
    });
    
    // Then build the tree structure
    flatPresets.forEach(item => {
        const currentItem = itemsById[item.id];
        
        if (item.parent_id === null) {
            // Top-level item
            tree.push(currentItem);
        } else if (itemsById[item.parent_id]) {
            // Add to parent's children array, preserving the order from flatPresets
            itemsById[item.parent_id].children.push(currentItem);
        }
    });
    
    return tree;
}

// Helper function to flatten the tree back to a list, maintaining order
function flattenPresetTree(tree) {
    const flatList = [];
    function recurse(items) {
        items.forEach(item => {
            flatList.push(item);
            if (item.children && item.children.length > 0) {
                recurse(item.children);
            }
        });
    }
    recurse(tree);
    return flatList;
}

// Drag & Drop Handlers for Preset Modal
function addPresetDragDropHandlers(element, item) {
    element.draggable = true;
    element.dataset.id = item.id;
    element.dataset.type = item.type;

    element.ondragstart = (e) => {
        e.stopPropagation();
        zmlPresetDraggingItem = item;
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => element.classList.add("zml-preset-dragging"), 0);
    };

    element.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!zmlPresetDraggingItem || zmlPresetDraggingItem.id === item.id) return;

        // Clear previous highlights
        document.querySelectorAll(".zml-preset-drag-over-line, .zml-preset-drag-over-folder").forEach(el => {
            el.classList.remove("zml-preset-drag-over-line", "zml-preset-drag-over-folder");
        });

        const rect = element.getBoundingClientRect();
        const mouseY = e.clientY;

        if (item.type === 'folder' && zmlPresetDraggingItem.type === 'text') {
            // Allow dropping text into a folder
            element.classList.add("zml-preset-drag-over-folder");
            zmlPresetDragOverPosition = "into";
        } else if (zmlPresetDraggingItem.type === 'folder' && item.type === 'text') {
            // Cannot drop folder into text
            return;
        } else {
            // For same-level reordering or moving folder/text to top-level
            if (mouseY < rect.top + rect.height / 2) {
                element.classList.add("zml-preset-drag-over-line");
                zmlPresetDragOverPosition = "before";
            } else {
                element.classList.add("zml-preset-drag-over-line");
                zmlPresetDragOverPosition = "after";
            }
        }
        zmlPresetDragOverTarget = element;
    };

    element.ondragleave = (e) => {
        e.stopPropagation();
        element.classList.remove("zml-preset-drag-over-line", "zml-preset-drag-over-folder");
        if (zmlPresetDragOverTarget === element) {
            zmlPresetDragOverTarget = null;
            zmlPresetDragOverPosition = null;
        }
    };

    element.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        document.querySelectorAll(".zml-preset-drag-over-line, .zml-preset-drag-over-folder").forEach(el => {
            el.classList.remove("zml-preset-drag-over-line", "zml-preset-drag-over-folder");
        });

        if (!zmlPresetDraggingItem || zmlPresetDraggingItem.id === item.id) return;

        // Fetch the latest presets to ensure we're working with the most current state
        const allPresets = await fetchPresets();
        let currentFlatPresets = [...allPresets];

        const fromIndex = zmlPresetDraggingItem ? currentFlatPresets.findIndex(p => p.id === zmlPresetDraggingItem.id) : -1;
        if (fromIndex === -1) return; // Item being dragged not found

        const [movedItem] = currentFlatPresets.splice(fromIndex, 1); // Remove the item from its original position

        // Determine the new parent_id and insertion point
        if (zmlPresetDragOverPosition === "into" && item.type === 'folder' && movedItem.type === 'text') {
            // Move text into folder - 直接在原对象上修改parent_id，避免深拷贝导致的问题
            movedItem.parent_id = item.id;
            
            // 将修改后的项添加回列表，保持ID不变
            currentFlatPresets.push(movedItem);
        } else {
            // Reorder at the same level or move to top level
            movedItem.parent_id = item.parent_id; // Keep same parent or move to target's parent
            
            const targetIndex = currentFlatPresets.findIndex(p => p.id === item.id);
            if (targetIndex !== -1) {
                if (zmlPresetDragOverPosition === "before") {
                    currentFlatPresets.splice(targetIndex, 0, movedItem);
                } else {
                    currentFlatPresets.splice(targetIndex + 1, 0, movedItem);
                }
            } else {
                currentFlatPresets.push(movedItem);
            }
        }
        
        // 直接发送更新后的预设列表，不需要构建树和扁平化
        const result = await sendPresetRequest("reorder", { presets: currentFlatPresets });
        if (result.success) {
            // 强制重新获取所有预设并渲染，确保UI显示正确的结构
            renderPresetsList();
        } else {
            showNotification("无法保存拖拽更改，请重试。", 'error');
        }
        zmlPresetDraggingItem = null;
        zmlPresetDragOverTarget = null;
        zmlPresetDragOverPosition = null;
    };

    element.ondragend = (e) => {
        element.classList.remove("zml-preset-dragging");
        document.querySelectorAll(".zml-preset-drag-over-line, .zml-preset-drag-over-folder").forEach(el => {
            el.classList.remove("zml-preset-drag-over-line", "zml-preset-drag-over-folder");
        });
        zmlPresetDraggingItem = null;
        zmlPresetDragOverTarget = null;
        zmlPresetDragOverPosition = null;
    };
}

// This is the base style for small buttons within preset items/folders
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

// Function to create a text preset item DOM
function createPresetTextItemDOM(preset) {
    const isSelected = zmlBatchManagementMode && zmlSelectedPresets.some(item => item.id === preset.id);
    const itemCard = createEl("div", "zml-preset-item-card", {
        style: `
            background-color: ${isSelected ? adjustBrightness(ZML_PRESET_DARK_ACCENT, 70) : adjustBrightness(ZML_PRESET_BASE_COLOR, 90)}; 
            border: 1px solid ${isSelected ? ZML_PRESET_DARK_ACCENT : adjustBrightness(ZML_PRESET_BASE_COLOR, 60)};
            border-radius: 6px;
            padding: 7px; 
            display: flex;
            flex-direction: column;
            gap: 4px; 
            box-shadow: 0 1px 4px rgba(0,0,0,0.08); 
            transition: background-color 0.2s ease, box-shadow 0.2s ease; 
            margin-left: 20px; /* Indent for text items within folders */
        `
    });
    itemCard.onmouseenter = (e) => { 
        if (!isSelected) {
            e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 80); 
        }
        e.target.style.boxShadow = '0 3px 8px rgba(0,0,0,0.15)'; 
    };
    itemCard.onmouseleave = (e) => { 
        if (!isSelected) {
            e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 90); 
        }
        e.target.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)'; 
    };
    
    // 在批量管理模式下，添加点击选择功能
    if (zmlBatchManagementMode) {
        itemCard.onclick = (e) => {
            // 如果点击的是按钮，不触发选择
            if (e.target.closest('button')) return;
            
            const index = zmlSelectedPresets.findIndex(item => item.id === preset.id);
            if (index > -1) {
                zmlSelectedPresets.splice(index, 1);
            } else {
                zmlSelectedPresets.push(preset);
            }
            renderPresetsList();
            
            // 更新批量操作按钮状态
            updateBatchActionButtons();
        };
    } else {
        itemCard.onclick = null;
    }

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

    const editBtn = createEl("button", "zml-control-btn", { textContent: "编辑" });
    Object.assign(editBtn.style, {
        cssText: buttonBaseItemStyle,
        backgroundColor: '#FFEB3B', // 柔和的黄色
        color: '#333',
    });
    editBtn.onmouseenter = (e) => { e.target.style.backgroundColor = '#FBC02D'; e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    editBtn.onmouseleave = (e) => { e.target.style.backgroundColor = '#FFEB3B'; e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; e.target.style.transform = 'translateY(0) scale(1)'; };
    editBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(1.5px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
    editBtn.onmouseup = (e) => { e.target.style.backgroundColor = '#FBC02D'; e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    editBtn.onclick = () => {
        zmlPresetModalNameInput.value = preset.name;
        zmlPresetModalContentTextarea.value = preset.content;
        zmlCurrentEditingPreset = preset; 
        showNotification(`正在编辑预设: '${preset.name}'`, 'info', 2000);
    };

    const deleteBtn = createEl("button", "zml-control-btn", { textContent: "删除" });
    Object.assign(deleteBtn.style, {
        cssText: buttonBaseItemStyle,
        backgroundColor: '#E57373', // 柔和的红色
        color: 'white',
    });
    deleteBtn.onmouseenter = (e) => { e.target.style.backgroundColor = '#D36060'; e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    deleteBtn.onmouseleave = (e) => { e.target.style.backgroundColor = '#E57373'; e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; e.target.style.transform = 'translateY(0) scale(1)'; };
    deleteBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(1.5px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
    deleteBtn.onmouseup = (e) => { e.target.style.backgroundColor = '#D36060'; e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    deleteBtn.onclick = async () => {
        if (confirm(`确定要删除预设 "${preset.name}" 吗?`)) {
            if (zmlCurrentEditingPreset && zmlCurrentEditingPreset.id === preset.id) {
                zmlPresetModalNameInput.value = "";
                zmlPresetModalContentTextarea.value = "";
                zmlCurrentEditingPreset = null; 
            }
            const result = await sendPresetRequest("delete", { id: preset.id, type: preset.type });
            if (result.success) renderPresetsList();
        }
    };

    const addToOneClickBtn = createEl("button", "zml-control-btn", { textContent: "一键添加至节点" });
    Object.assign(addToOneClickBtn.style, {
        cssText: buttonBaseItemStyle,
        backgroundColor: ZML_PRESET_DARK_ACCENT, // 深绿色
        color: 'white',
    });
    addToOneClickBtn.onmouseenter = (e) => { e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    addToOneClickBtn.onmouseleave = (e) => { e.target.style.backgroundColor = ZML_PRESET_DARK_ACCENT; e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; e.target.style.transform = 'translateY(0) scale(1)'; };
    addToOneClickBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(1.5px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
    addToOneClickBtn.onmouseup = (e) => { e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    addToOneClickBtn.onclick = () => {
        if (zmlTextV3CurrentNodeInstance) {
            const newId = "text" + Date.now() + Math.random().toString(36).substring(2, 8); 
            zmlTextV3CurrentNodeInstance.selectTextV3_data.entries.push({
                id: newId,
                item_type: "text",
                title: preset.name,
                content: preset.content,
                enabled: true,
                parent_id: null // This will be handled by the node's own drag/drop if needed
            });
            zmlTextV3CurrentNodeInstance.triggerSlotChanged();
            showNotification(`预设 '${preset.name}' 已添加至节点.`, 'success'); 
        } else {
            showNotification("当前没有活动的SelectTextV3节点实例。", 'error');
        }
    };

    // 添加移动到文件夹按钮
    const moveToFolderBtn = createEl("button", "zml-control-btn", { textContent: "移动到文件夹" });
    Object.assign(moveToFolderBtn.style, {
        cssText: buttonBaseItemStyle,
        backgroundColor: '#64B5F6', // 蓝色
        color: 'white',
    });
    moveToFolderBtn.onmouseenter = (e) => { e.target.style.backgroundColor = '#42A5F5'; e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    moveToFolderBtn.onmouseleave = (e) => { e.target.style.backgroundColor = '#64B5F6'; e.target.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)'; e.target.style.transform = 'translateY(0) scale(1)'; };
    moveToFolderBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(1.5px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
    moveToFolderBtn.onmouseup = (e) => { e.target.style.backgroundColor = '#42A5F5'; e.target.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.25)'; e.target.style.transform = 'translateY(-1.5px) scale(1.02)'; };
    moveToFolderBtn.onclick = () => showFolderSelectionDialog(preset);

    buttonGroup.append(editBtn, deleteBtn, moveToFolderBtn, addToOneClickBtn);
    itemCard.append(nameDisplay, contentPreview, buttonGroup);
    addPresetDragDropHandlers(itemCard, preset);
    return itemCard;
}

// Function to create a folder item DOM
function createPresetFolderItemDOM(folder) {
    const folderCard = createEl("div", "zml-preset-folder-card", {
        style: `
            background-color: transparent; // 移除默认黄色背景
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
            border-radius: 8px;
            padding: 5px; 
            margin-bottom: 5px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.05);
            transition: background-color 0.2s ease, box-shadow 0.2s ease;
        `
    });
    folderCard.onmouseenter = (e) => { e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 80); e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; };
    folderCard.onmouseleave = (e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)'; };

    const header = createEl("div", "zml-preset-folder-header", {
        style: `
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 3px 5px;
            cursor: pointer;
            user-select: none;
            font-weight: 600;
            color: ${ZML_PRESET_TEXT_COLOR};
        `
    });
    // 始终将文件夹设置为折叠状态，无论传入的状态是什么
    folder.is_collapsed = true;
    const toggle = createEl("span", "zml-preset-folder-toggle", { textContent: folder.is_collapsed ? "+" : "-" });
    const nameInput = createEl("input", "zml-preset-folder-name-input", {
        type: "text",
        value: folder.name,
        style: `
            flex-grow: 1;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 4px;
            color: ${ZML_PRESET_TEXT_COLOR};
            padding: 2px 5px;
            font-size: 1em;
            font-weight: 600;
            outline: none;
            transition: border-color 0.2s ease;
        `
    });
    nameInput.onfocus = (e) => { e.target.style.borderColor = ZML_PRESET_DARK_ACCENT; };
    nameInput.onblur = async (e) => {
        e.target.style.borderColor = 'transparent';
        const newName = e.target.value.trim();
        if (newName && newName !== folder.name) {
            const result = await sendPresetRequest("update", {
                id: folder.id,
                type: 'folder',
                new_name: newName
            });
            if (result.success) {
                folder.name = newName;
                renderPresetsList();
            } else {
                e.target.value = folder.name; // Revert on failure
            }
        } else if (!newName && newName !== null) {
            showNotification("文件夹名称不能为空。", 'error');
            e.target.value = folder.name; // Revert
        }
    };

    const deleteBtn = createEl("button", "zml-control-btn", { textContent: "删除" });
    Object.assign(deleteBtn.style, {
        cssText: buttonBaseItemStyle,
        backgroundColor: '#E57373', // 柔和的红色
        color: 'white',
        padding: '4px 8px',
        fontSize: '12px',
    });
    deleteBtn.onmouseenter = (e) => { e.target.style.backgroundColor = '#D36060'; };
    deleteBtn.onmouseleave = (e) => { e.target.style.backgroundColor = '#E57373'; };
    deleteBtn.onclick = async (e) => {
        e.stopPropagation(); // Prevent folder toggle
        const children = (await fetchPresets()).filter(p => p.parent_id === folder.id);
        if (children.length > 0) {
            if (confirm(`文件夹 "${folder.name}" 内含有 ${children.length} 个项目，确定要强制删除此文件夹及其所有内容吗？`)) {
                try {
                    // 首先删除所有子项
                    for (const child of children) {
                        await sendPresetRequest("delete", { id: child.id, type: child.type });
                    }
                    // 然后删除文件夹本身
                    const result = await sendPresetRequest("delete", { id: folder.id, type: folder.type });
                    if (result.success) {
                        renderPresetsList();
                        showNotification(`文件夹 "${folder.name}" 及其 ${children.length} 个项目已成功删除。`);
                    }
                } catch (error) {
                    showNotification(`删除过程中出错: ${error.message}`, 'error');
                }
            }
            return;
        }
        if (confirm(`确定要删除文件夹 "${folder.name}" 吗?`)) {
            const result = await sendPresetRequest("delete", { id: folder.id, type: folder.type });
            if (result.success) renderPresetsList();
        }
    };

    // 添加文件夹一键发送到节点按钮
    const addFolderToNodeBtn = createEl("button", "zml-control-btn", { textContent: "一键发送到节点" });
    Object.assign(addFolderToNodeBtn.style, {
        cssText: buttonBaseItemStyle,
        backgroundColor: ZML_PRESET_DARK_ACCENT, // 深绿色
        color: 'white',
        padding: '4px 8px',
        fontSize: '12px',
    });
    addFolderToNodeBtn.onmouseenter = (e) => { e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10); };
    addFolderToNodeBtn.onmouseleave = (e) => { e.target.style.backgroundColor = ZML_PRESET_DARK_ACCENT; };
    addFolderToNodeBtn.onclick = async (e) => {
        e.stopPropagation(); // Prevent folder toggle
        if (zmlTextV3CurrentNodeInstance) {
            // 获取最新的文件夹名称 - 添加安全检查，确保总是有有效的名称
            let currentFolderName = "未命名文件夹";
            
            // 尝试从UI输入框获取名称，如果失败则回退到使用原始folder对象的名称
            if (nameInput && nameInput.value) {
                currentFolderName = nameInput.value.trim();
            } else if (folder && folder.name) {
                currentFolderName = folder.name;
            }
            
            // 确保名称不为空
            if (!currentFolderName) {
                currentFolderName = "未命名文件夹";
            }
            
            const children = (await fetchPresets()).filter(p => p.parent_id === folder.id && p.type === 'text');
            if (children.length === 0) {
                showNotification(`文件夹 "${currentFolderName}" 中没有可添加的预设文本。`, 'info');
                return;
            }
            
            // 创建文件夹并保持结构添加到节点
            const folderId = "folder" + Date.now() + Math.random().toString(36).substring(2, 8);
            
            // 首先添加文件夹 - 同时设置name和title属性，确保节点能正确显示文件夹名称
            zmlTextV3CurrentNodeInstance.selectTextV3_data.entries.push({
                id: folderId,
                item_type: "folder",
                title: currentFolderName,
                name: currentFolderName, // 添加name属性，节点内部使用name属性显示文件夹名称
                content: "",
                enabled: true,
                parent_id: null
            });
            
            // 然后添加文件夹中的所有预设文本，并设置它们的父文件夹ID
            children.forEach(preset => {
                const newId = "text" + Date.now() + Math.random().toString(36).substring(2, 8); 
                zmlTextV3CurrentNodeInstance.selectTextV3_data.entries.push({
                    id: newId,
                    item_type: "text",
                    title: preset.name || "未命名预设",
                    content: preset.content || "",
                    enabled: true,
                    parent_id: folderId // 设置父文件夹ID，保持文件夹结构
                });
            });
            
            zmlTextV3CurrentNodeInstance.triggerSlotChanged();
            showNotification(`已成功添加文件夹 "${currentFolderName}" 及其 ${children.length} 个预设文本到节点（保持文件夹结构）。`, 'success');
        } else {
            showNotification("当前没有活动的SelectTextV3节点实例。", 'error');
        }
    };

    header.append(toggle, nameInput, deleteBtn, addFolderToNodeBtn);
    folderCard.append(header);

    const contentContainer = createEl("div", "zml-preset-folder-content", {
        style: `
            padding-top: 5px;
            padding-left: 10px;
            border-top: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 30)};
            margin-top: 5px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            ${folder.is_collapsed ? 'display: none;' : ''}
        `
    });
    folderCard.append(contentContainer);

    header.onclick = (e) => {
        if (e.target === nameInput || e.target === deleteBtn) return;
        folder.is_collapsed = !folder.is_collapsed;
        toggle.textContent = folder.is_collapsed ? "▶" : "▼";
        contentContainer.style.display = folder.is_collapsed ? 'none' : 'flex';
        // No need to send to backend for collapse state, it's UI only
    };

    addPresetDragDropHandlers(folderCard, folder);
    return folderCard;
}


async function renderPresetsList() {
    if (!zmlPresetModalContentContainer) return;


    
    const flatPresets = await fetchPresets();
    zmlPresetModalContentContainer.innerHTML = ""; 

    if (flatPresets.length === 0) {
        zmlPresetModalContentContainer.innerHTML = `<p style="text-align: center; color: ${ZML_PRESET_TEXT_COLOR}; margin-top: 20px; font-size: 1.1em;">🎨 暂无预设文本，赶快添加一个吧！</p>`;
        return;
    }

    const presetTree = buildPresetTree(flatPresets);

    function renderTree(items, parentContainer) {
        items.forEach(item => {
            let itemDOM;
            if (item.type === 'folder') {
                itemDOM = createPresetFolderItemDOM(item);
                parentContainer.appendChild(itemDOM);
                // Recursively render children into the folder's content area
                const folderContentArea = itemDOM.querySelector('.zml-preset-folder-content');
                if (folderContentArea && item.children.length > 0) {
                    renderTree(item.children, folderContentArea);
                }
            } else { // item.type === 'text'
                itemDOM = createPresetTextItemDOM(item);
                parentContainer.appendChild(itemDOM);
            }
        });
    }

    renderTree(presetTree, zmlPresetModalContentContainer);
    
    // 在渲染完列表后，更新批量操作按钮
    updateBatchActionButtons();
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

// 更新批量操作按钮状态
function updateBatchActionButtons() {
    if (!zmlPresetModalContentContainer) return;
    
    // 检查是否已存在批量操作容器
    let batchActionContainer = zmlPresetModalContentContainer.querySelector('.zml-batch-action-container');
    
    if (zmlBatchManagementMode) {
        // 创建或更新批量操作容器
        if (!batchActionContainer) {
            batchActionContainer = createEl("div", "zml-batch-action-container", {
                style: `
                    background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 70)}; 
                    border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
                    border-radius: 8px;
                    padding: 10px;
                    margin-bottom: 10px;
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    justify-content: center;
                `
            });
            
            // 批量移动到文件夹按钮
            const batchMoveBtn = createEl("button", "zml-control-btn", { textContent: "批量移动到文件夹" });
            Object.assign(batchMoveBtn.style, {
                cssText: buttonBaseItemStyle,
                backgroundColor: '#64B5F6', // 蓝色
                color: 'white',
            });
            batchMoveBtn.onclick = () => {
                if (zmlSelectedPresets.length > 0) {
                    showBatchFolderSelectionDialog();
                }
            };
            
            // 批量删除按钮
            const batchDeleteBtn = createEl("button", "zml-control-btn", { textContent: "批量删除" });
            Object.assign(batchDeleteBtn.style, {
                cssText: buttonBaseItemStyle,
                backgroundColor: '#E57373', // 红色
                color: 'white',
            });
            batchDeleteBtn.onclick = async () => {
                if (zmlSelectedPresets.length > 0) {
                    if (confirm(`确定要删除选中的 ${zmlSelectedPresets.length} 个预设吗?`)) {
                        // 批量删除操作
                        const deletePromises = zmlSelectedPresets.map(preset => 
                            sendPresetRequest("delete", { id: preset.id, type: preset.type })
                        );
                        
                        try {
                            const results = await Promise.all(deletePromises);
                            const allSuccess = results.every(result => result.success);
                            
                            if (allSuccess) {
                                const deletedCount = zmlSelectedPresets.length;
                                zmlSelectedPresets = [];
                                renderPresetsList();
                                showNotification(`已成功删除 ${deletedCount} 个预设。`, 'success');
                            } else {
                                showNotification("部分预设删除失败，请重试。", 'error');
                            }
                        } catch (error) {
                            showNotification("批量删除过程中发生错误。", 'error');
                        }
                    }
                }
            };
            
            // 选中数量显示
            const selectionCount = createEl("div", "zml-selection-count", {
                style: `
                    color: ${ZML_PRESET_TEXT_COLOR};
                    font-weight: 600;
                    font-size: 14px;
                `,
                textContent: `已选择: ${zmlSelectedPresets.length} 个预设`
            });
            
            batchActionContainer.append(selectionCount, batchMoveBtn, batchDeleteBtn);
            
            // 将批量操作容器添加到列表顶部
            if (zmlPresetModalContentContainer.firstChild) {
                zmlPresetModalContentContainer.insertBefore(batchActionContainer, zmlPresetModalContentContainer.firstChild);
            } else {
                zmlPresetModalContentContainer.appendChild(batchActionContainer);
            }
        } else {
            // 更新选中数量
            const selectionCount = batchActionContainer.querySelector('.zml-selection-count');
            if (selectionCount) {
                selectionCount.textContent = `已选择: ${zmlSelectedPresets.length} 个预设`;
            }
        }
    } else {
        // 非批量管理模式，移除批量操作容器
        if (batchActionContainer) {
            batchActionContainer.remove();
        }
    }
}

// 批量移动文件夹选择对话框
async function showBatchFolderSelectionDialog() {
    // 创建对话框覆盖层
    const overlay = createEl("div", "zml-folder-dialog-overlay", {
        style: `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
            backdrop-filter: blur(2px);
        `
    });

    // 创建对话框容器
    const dialog = createEl("div", "zml-folder-dialog", {
        style: `
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 60)};
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 20)};
            border-radius: 12px;
            padding: 15px;
            min-width: 350px;
            max-width: 90vw;
            max-height: 70vh;
            overflow-y: auto;
            color: ${ZML_PRESET_TEXT_COLOR};
            font-family: 'Segoe UI', Arial, sans-serif;
        `
    });

    // 对话框标题
    const title = createEl("h3", "zml-folder-dialog-title", {
        style: `
            color: ${ZML_PRESET_TEXT_COLOR};
            margin: 0 0 15px 0;
            font-size: 1.4em;
            text-align: center;
        `,
        textContent: `选择文件夹 - 移动 ${zmlSelectedPresets.length} 个预设`
    });

    // 文件夹列表容器
    const folderList = createEl("div", "zml-folder-list", {
        style: `
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 400px;
            overflow-y: auto;
            margin-bottom: 15px;
        `
    });

    // 获取所有文件夹
    const allPresets = await fetchPresets();
    const folders = allPresets.filter(item => item.type === 'folder');
    
    // 初始化选中的文件夹ID
    let selectedFolderId = null;

    // 添加所有文件夹选项
    if (folders.length === 0) {
        const emptyMessage = createEl("p", "zml-folder-empty-message", {
            style: `
                text-align: center;
                color: ${adjustBrightness(ZML_PRESET_TEXT_COLOR, 40)};
                font-style: italic;
            `,
            textContent: "暂无文件夹，请先创建文件夹"
        });
        folderList.appendChild(emptyMessage);
    } else {
        folders.forEach(folder => {
            const folderOption = createEl("div", "zml-folder-option", {
                style: `
                    padding: 10px;
                    border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
                    border-radius: 6px;
                    cursor: pointer;
                    background-color: adjustBrightness(ZML_PRESET_BASE_COLOR, 90);
                    color: ${ZML_PRESET_TEXT_COLOR};
                    transition: all 0.2s ease;
                `,
                textContent: `${folder.name}`
            });
            
            folderOption.onclick = () => {
                folderList.querySelectorAll(".zml-folder-option").forEach(el => {
                    el.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 90);
                    el.style.color = ZML_PRESET_TEXT_COLOR;
                });
                folderOption.style.backgroundColor = ZML_PRESET_DARK_ACCENT;
                folderOption.style.color = 'white';
                selectedFolderId = folder.id;
            };
            
            folderList.appendChild(folderOption);
        });
    }

    // 按钮容器
    const buttonContainer = createEl("div", "zml-dialog-buttons", {
        style: `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 15px;
        `
    });

    // 取消按钮
    const cancelBtn = createEl("button", "zml-dialog-btn", {
        style: `
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
            color: ${ZML_PRESET_TEXT_COLOR};
            border: none;
            transition: all 0.2s ease;
        `,
        textContent: "取消"
    });
    cancelBtn.onclick = () => document.body.removeChild(overlay);
    cancelBtn.onmouseenter = (e) => {
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 30);
    };
    cancelBtn.onmouseleave = (e) => {
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 40);
    };

    // 确认按钮
    const confirmBtn = createEl("button", "zml-dialog-btn", {
        style: `
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            background-color: ZML_PRESET_DARK_ACCENT;
            color: white;
            border: none;
            transition: all 0.2s ease;
        `,
        textContent: "确认移动"
    });
    confirmBtn.onclick = async () => {
        if (!selectedFolderId) {
            showNotification("请选择一个目标文件夹。", 'error');
            return;
        }
        
        // 执行批量移动操作
        const movePromises = zmlSelectedPresets.map(preset => 
            sendPresetRequest("update", {
                id: preset.id,
                type: 'text',
                new_name: preset.name,
                new_content: preset.content,
                new_parent_id: selectedFolderId
            })
        );
        
        try {
            const results = await Promise.all(movePromises);
            const allSuccess = results.every(result => result.success);
            
            if (allSuccess) {
                // 更新本地对象，确保UI显示正确
                const movedCount = zmlSelectedPresets.length;
                zmlSelectedPresets.forEach(preset => {
                    preset.parent_id = selectedFolderId;
                });
                zmlSelectedPresets = [];
                showNotification(`${movedCount} 个预设已成功移动到目标文件夹。`, 'success');
                document.body.removeChild(overlay);
                renderPresetsList();
            } else {
                showNotification("部分预设移动失败，请重试。", 'error');
            }
        } catch (error) {
            showNotification("批量移动过程中发生错误。", 'error');
        }
    };

    dialog.append(title, folderList, buttonContainer);
    buttonContainer.append(cancelBtn, confirmBtn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

// --- 节点扩展注册 ---
// 显示文件夹选择对话框
async function showFolderSelectionDialog(textPreset) {
    // 创建对话框覆盖层
    const overlay = createEl("div", "zml-folder-dialog-overlay", {
        style: `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
            backdrop-filter: blur(2px);
        `
    });

    // 创建对话框容器
    const dialog = createEl("div", "zml-folder-dialog", {
        style: `
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 60)};
            border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 20)};
            border-radius: 12px;
            padding: 15px;
            min-width: 350px;
            max-width: 90vw;
            max-height: 70vh;
            overflow-y: auto;
            color: ${ZML_PRESET_TEXT_COLOR};
            font-family: 'Segoe UI', Arial, sans-serif;
        `
    });

    // 对话框标题
    const title = createEl("h3", "zml-folder-dialog-title", {
        style: `
            color: ${ZML_PRESET_TEXT_COLOR};
            margin: 0 0 15px 0;
            font-size: 1.4em;
            text-align: center;
        `,
        textContent: `选择文件夹 - 移动预设: ${textPreset.name}`
    });

    // 文件夹列表容器
    const folderList = createEl("div", "zml-folder-list", {
        style: `
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 400px;
            overflow-y: auto;
            margin-bottom: 15px;
        `
    });

    // 获取所有文件夹
    const allPresets = await fetchPresets();
    const folders = allPresets.filter(item => item.type === 'folder');
    
    // 初始化选中的文件夹ID
    let selectedFolderId = textPreset.parent_id || null;

    // 添加所有文件夹选项
    if (folders.length === 0) {
        const emptyMessage = createEl("p", "zml-folder-empty-message", {
            style: `
                text-align: center;
                color: ${adjustBrightness(ZML_PRESET_TEXT_COLOR, 40)};
                font-style: italic;
            `,
            textContent: "暂无文件夹，请先创建文件夹"
        });
        folderList.appendChild(emptyMessage);
    } else {
        folders.forEach(folder => {
            const folderOption = createEl("div", "zml-folder-option", {
                style: `
                    padding: 10px;
                    border: 1px solid ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
                    border-radius: 6px;
                    cursor: pointer;
                    background-color: ${textPreset.parent_id === folder.id ? ZML_PRESET_DARK_ACCENT : adjustBrightness(ZML_PRESET_BASE_COLOR, 90)};
                    color: ${textPreset.parent_id === folder.id ? 'white' : ZML_PRESET_TEXT_COLOR};
                    transition: all 0.2s ease;
                `,
                textContent: `${folder.name}`
            });
            
            folderOption.onclick = () => {
                folderList.querySelectorAll(".zml-folder-option").forEach(el => {
                    el.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 90);
                    el.style.color = ZML_PRESET_TEXT_COLOR;
                });
                folderOption.style.backgroundColor = ZML_PRESET_DARK_ACCENT;
                folderOption.style.color = 'white';
                selectedFolderId = folder.id;
            };
            
            folderList.appendChild(folderOption);
        });
    }

    // 按钮容器
    const buttonContainer = createEl("div", "zml-dialog-buttons", {
        style: `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 15px;
        `
    });

    // 取消按钮
    const cancelBtn = createEl("button", "zml-dialog-btn", {
        style: `
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            background-color: ${adjustBrightness(ZML_PRESET_BASE_COLOR, 40)};
            color: ${ZML_PRESET_TEXT_COLOR};
            border: none;
            transition: all 0.2s ease;
        `,
        textContent: "取消"
    });
    cancelBtn.onclick = () => document.body.removeChild(overlay);
    cancelBtn.onmouseenter = (e) => {
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 30);
    };
    cancelBtn.onmouseleave = (e) => {
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_BASE_COLOR, 40);
    };

    // 确认按钮
    const confirmBtn = createEl("button", "zml-dialog-btn", {
        style: `
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            background-color: ZML_PRESET_DARK_ACCENT;
            color: white;
            border: none;
            transition: all 0.2s ease;
        `,
        textContent: "确认移动"
    });
    confirmBtn.onclick = async () => {
        // 执行移动操作
        // 确保空字符串、undefined和null都被视为相同的值进行比较
        const currentParent = textPreset.parent_id === null || textPreset.parent_id === undefined || textPreset.parent_id === '' ? null : textPreset.parent_id;
        if (selectedFolderId !== currentParent) {
            const result = await sendPresetRequest("update", {
                id: textPreset.id,
                type: 'text',
                new_name: textPreset.name,
                new_content: textPreset.content,
                new_parent_id: selectedFolderId
            });
            
            if (result.success) {
                // 更新本地对象，确保UI显示正确
                textPreset.parent_id = selectedFolderId;
                showNotification(`预设 '${textPreset.name}' 已成功移动到目标位置。`, 'success');
                renderPresetsList();
            } else {
                showNotification(`移动预设失败: ${result.message}`, 'error');
            }
        }
        document.body.removeChild(overlay);
    };
    confirmBtn.onmouseenter = (e) => {
        e.target.style.backgroundColor = adjustBrightness(ZML_PRESET_DARK_ACCENT, -10);
    };
    confirmBtn.onmouseleave = (e) => {
        e.target.style.backgroundColor = ZML_PRESET_DARK_ACCENT;
    };

    buttonContainer.append(cancelBtn, confirmBtn);
    dialog.append(title, folderList, buttonContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

app.registerExtension({
    name: "ZML.SelectTextV3.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeType.comfyClass === "ZML_SelectTextV3") {
            // 修改节点数据，确保可选输入接口正确显示
            if (!nodeData.input.required) nodeData.input.required = {};
            if (!nodeData.input.optional) nodeData.input.optional = {};
            nodeData.input.optional["可选输入"] = ["STRING", {"forceInput": true}];
            
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
                            .zml-st3-folder-card.zml-st3-dragging,
                            .zml-preset-dragging { /* Added for preset modal dragging */
                                opacity: 0.5;
                                background: #555;
                            }
                            /* Dragging insertion line */
                            .zml-st3-drag-over-line,
                            .zml-preset-drag-over-line { /* Added for preset modal dragging */
                                border-top: 2px solid #5d99f2 !important;
                            }
                            /* Dragging into folder highlight */
                            .zml-st3-drag-over-folder,
                            .zml-preset-drag-over-folder { /* Added for preset modal dragging */
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
                                max-width: 100%; /* 确保不会超出父容器 */
                                min-width: 0; /* 允许收缩到很小的宽度 */
                                overflow: hidden; /* 隐藏超出部分 */
                                text-overflow: ellipsis; /* 显示省略号 */
                                white-space: nowrap; /* 防止换行 */
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
                        },
                        large: {
                            cardPadding: "9px", // normal的1.5倍
                            inputPadding: "6px 12px", // normal的1.5倍
                            inputHeight: "39px", // normal的1.5倍 (26 * 1.5)
                            checkboxScale: "2.25", // normal的1.5倍
                            newButtonPadding: "12px 24px", // normal的1.5倍
                        }
                    };

                    // 初始化viewMode，优先使用viewMode，如果没有则根据compactView设置
                    this.viewMode = this.viewMode ?? (this.compactView ? 'compact' : 'normal');
                    this.isLocked = this.isLocked ?? false;
                    this.titleWidth = this.titleWidth ?? 80;
                    this.randomEnabled = this.randomEnabled ?? false; // 默认状态改为不随机
                    this.folderColor = this.folderColor ?? "#30353C"; // 深色背景
                    this.textboxColor = this.textboxColor ?? "#3a3a3a"; // 文本框背景颜色
                    this.textboxDisabledColor = this.textboxDisabledColor ?? "#2a2a2a"; // 禁用的文本框背景颜色
                    this.textboxBorderColor = this.textboxBorderColor ?? "#555"; // 文本框边框颜色
                    this.textboxDisabledBorderColor = this.textboxDisabledBorderColor ?? "#444"; // 禁用的文本框边框颜色
                    this.enabledStateColor = this.enabledStateColor ?? "#00cc00"; // 开启状态颜色

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
                            // 实时更新所有标题输入框的宽度
                            const titleInputs = entriesList.querySelectorAll("input[type='text'][placeholder='" + this.getText("inputName") + "']");
                            titleInputs.forEach(input => {
                                input.style.width = this.titleWidth + 'px';
                            });
                            app.graph.setDirtyCanvas(true, true);
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
                            is_collapsed: true,  // 默认折叠状态
                            parent_id: null,
                        });
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(newFolderBtn);

                    // 颜色选择下拉菜单
                    const colorDropdown = createEl("div", "zml-color-dropdown", {
                        style: `position: relative; display: inline-block;`
                    });
                    
                    // 下拉按钮 - 恢复图标显示
                    const colorDropdownBtn = createEl("button", "zml-control-btn", { textContent: "🎨" });
                    colorDropdownBtn.title = "颜色设置";
                    colorDropdownBtn.style.cssText += `
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                        width: 26px;
                        height: 26px;
                        padding: 0;
                        position: relative;
                    `;
                    colorDropdownBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    colorDropdownBtn.onmouseleave = (e) => { 
                        // 只有当下拉菜单关闭时才恢复样式
                        if (!colorDropdownMenu.classList.contains('show')) {
                            e.target.style.background = '#333';
                            e.target.style.boxShadow = 'none';
                            e.target.style.transform = 'translateY(0) scale(1)';
                        }
                    };
                    colorDropdownBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    colorDropdownBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    
                    // 下拉菜单内容 - 改为纵向布局，文件夹颜色显示在第一行，文本框颜色显示在第二行
                    const colorDropdownMenu = createEl("div", "zml-color-dropdown-content", {
                        style: `
                            display: none;
                            position: absolute;
                            right: 0;
                            top: 100%;
                            margin-top: 5px;
                            background: #333;
                            border: 1px solid #555;
                            border-radius: 4px;
                            padding: 4px;
                            z-index: 1000;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                            display: none;
                            flex-direction: column;
                            gap: 2px;
                        `
                    });
                    
                    // 文件夹颜色选项 - 移除图标，纯文字显示
                    const folderColorInput = createEl("input", "", { type: "color", value: this.folderColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                    folderColorInput.onchange = (e) => {
                        this.folderColor = e.target.value;
                        this.renderSelectTextV3Entries(); // 重新渲染所有条目，包括文件夹
                        this.triggerSlotChanged(); // 触发数据变化通知
                        // 关闭下拉菜单
                        colorDropdownMenu.classList.remove('show');
                        colorDropdownMenu.style.display = 'none';
                    };
                    
                    const folderColorOption = createEl("div", "zml-dropdown-option", {
                        style: `
                            padding: 4px 8px;
                            cursor: pointer;
                            white-space: nowrap;
                            transition: background-color 0.2s ease;
                            border-radius: 2px;
                            font-size: 12px;
                        `
                    });
                    folderColorOption.textContent = "文件夹颜色";
                    folderColorOption.onmouseenter = (e) => { e.target.style.background = '#444'; };
                    folderColorOption.onmouseleave = (e) => { e.target.style.background = 'transparent'; };
                    folderColorOption.onclick = function() {
                        folderColorInput.click();
                    };
                    
                    // 文本框颜色选项 - 移除图标，纯文字显示
                    const textboxColorInput = createEl("input", "", { type: "color", value: this.textboxColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                    textboxColorInput.onchange = (e) => {
                        this.textboxColor = e.target.value;
                        // 更新禁用状态的颜色为稍暗的版本
                        this.textboxDisabledColor = adjustBrightness(this.textboxColor, -30);
                        // 更新边框颜色为稍暗的版本
                        this.textboxBorderColor = adjustBrightness(this.textboxColor, -15);
                        this.textboxDisabledBorderColor = adjustBrightness(this.textboxColor, -45);
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                        // 关闭下拉菜单
                        colorDropdownMenu.classList.remove('show');
                        colorDropdownMenu.style.display = 'none';
                    };
                    
                    const textboxColorOption = createEl("div", "zml-dropdown-option", {
                        style: `
                            padding: 4px 8px;
                            cursor: pointer;
                            white-space: nowrap;
                            transition: background-color 0.2s ease;
                            border-radius: 2px;
                            font-size: 12px;
                        `
                    });
                    textboxColorOption.textContent = "文本框颜色";
                    textboxColorOption.onmouseenter = (e) => { e.target.style.background = '#444'; };
                    textboxColorOption.onmouseleave = (e) => { e.target.style.background = 'transparent'; };
                    textboxColorOption.onclick = function() {
                        textboxColorInput.click();
                    };
                    
                    // 组装下拉菜单
                    colorDropdownMenu.appendChild(folderColorOption);
                    colorDropdownMenu.appendChild(textboxColorOption);
                    
                    // 添加下拉菜单到按钮容器
                    colorDropdown.appendChild(colorDropdownBtn);
                    colorDropdown.appendChild(colorDropdownMenu);
                    
                    // 添加隐藏的颜色输入框
                    colorDropdown.appendChild(folderColorInput);
                    colorDropdown.appendChild(textboxColorInput);
                    
                    // 开启状态颜色选项
                    const enabledStateColorInput = createEl("input", "", { type: "color", value: this.enabledStateColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                    enabledStateColorInput.onchange = (e) => {
                        this.enabledStateColor = e.target.value;
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                        // 关闭下拉菜单
                        colorDropdownMenu.classList.remove('show');
                        colorDropdownMenu.style.display = 'none';
                    };
                    
                    const enabledStateColorOption = createEl("div", "zml-dropdown-option", {
                        style: `
                            padding: 4px 8px;
                            cursor: pointer;
                            white-space: nowrap;
                            transition: background-color 0.2s ease;
                            border-radius: 2px;
                            font-size: 12px;
                        `
                    });
                    enabledStateColorOption.textContent = "开启状态"; 
                    enabledStateColorOption.onmouseenter = (e) => { e.target.style.background = '#444'; };
                    enabledStateColorOption.onmouseleave = (e) => { e.target.style.background = 'transparent'; };
                    enabledStateColorOption.onclick = function() {
                        enabledStateColorInput.click();
                    };
                    
                    colorDropdownMenu.appendChild(enabledStateColorOption);
                    colorDropdown.appendChild(enabledStateColorInput);
                    
                    // 恢复默认颜色选项
                    const resetColorsOption = createEl("div", "zml-dropdown-option", {
                        style: `
                            padding: 4px 8px;
                            cursor: pointer;
                            white-space: nowrap;
                            transition: background-color 0.2s ease;
                            border-radius: 2px;
                            font-size: 12px;
                            margin-top: 8px;
                            border-top: 1px solid #555;
                            color: #ff9999;
                        `
                    });
                    resetColorsOption.textContent = "恢复默认颜色"; 
                    resetColorsOption.onmouseenter = (e) => { e.target.style.background = '#444'; };
                    resetColorsOption.onmouseleave = (e) => { e.target.style.background = 'transparent'; };
                    resetColorsOption.onclick = () => {
                        // 恢复默认颜色
                        this.folderColor = "#30353C";
                        this.textboxColor = "#3a3a3a";
                        this.textboxDisabledColor = "#2a2a2a";
                        this.textboxBorderColor = "#555";
                        this.textboxDisabledBorderColor = "#444";
                        this.enabledStateColor = "#00cc00";
                        
                        // 更新颜色输入框的值
                        if (folderColorInput) folderColorInput.value = this.folderColor;
                        if (textboxColorInput) textboxColorInput.value = this.textboxColor;
                        if (enabledStateColorInput) enabledStateColorInput.value = this.enabledStateColor;
                        
                        // 重新渲染和触发更新
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                        
                        // 关闭下拉菜单
                        colorDropdownMenu.classList.remove('show');
                        colorDropdownMenu.style.display = 'none';
                    };
                    
                    colorDropdownMenu.appendChild(resetColorsOption);
                    
                    // 点击按钮切换下拉菜单显示状态
                    colorDropdownBtn.onclick = function() {
                        const isVisible = colorDropdownMenu.classList.contains('show');
                        if (isVisible) {
                            colorDropdownMenu.classList.remove('show');
                            colorDropdownMenu.style.display = 'none';
                            colorDropdownBtn.style.background = '#333';
                            colorDropdownBtn.style.boxShadow = 'none';
                            colorDropdownBtn.style.transform = 'translateY(0) scale(1)';
                        } else {
                            colorDropdownMenu.classList.add('show');
                            colorDropdownMenu.style.display = 'flex';
                            colorDropdownBtn.style.background = '#555';
                            colorDropdownBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
                        }
                    };
                    
                    // 点击页面其他地方关闭下拉菜单
                    document.addEventListener('click', function(event) {
                        if (!colorDropdown.contains(event.target)) {
                            colorDropdownMenu.classList.remove('show');
                            colorDropdownMenu.style.display = 'none';
                            colorDropdownBtn.style.background = '#333';
                            colorDropdownBtn.style.boxShadow = 'none';
                            colorDropdownBtn.style.transform = 'translateY(0) scale(1)';
                        }
                    });
                    
                    // 添加到控件行
                    controlsRow.append(colorDropdown);

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

                    // 布局调节按钮 - 移到随机按钮左侧并更改图标为💕
                    const sizeToggleButton = createEl("button", "zml-control-btn", { textContent: "💕" });
                    // 定义布局模式和对应的标题
                    const layoutModes = [
                        { id: 'compact', name: '紧凑布局' },
                        { id: 'normal', name: '常规布局' },
                        { id: 'large', name: '大型文本框' }
                    ];
                    
                    // 获取当前布局模式的名称
                    const getCurrentLayoutName = () => {
                        const currentMode = layoutModes.find(mode => mode.id === this.viewMode);
                        return currentMode ? currentMode.name : '常规布局';
                    };
                    
                    // 设置初始按钮标题
                    sizeToggleButton.title = `当前：${getCurrentLayoutName()}\n切换布局模式：紧凑布局、常规布局、大型文本框`;
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
                        // 获取当前布局模式的索引
                        const currentIndex = layoutModes.findIndex(mode => mode.id === this.viewMode);
                        // 计算下一个布局模式的索引
                        const nextIndex = (currentIndex + 1) % layoutModes.length;
                        // 设置新的布局模式
                        this.viewMode = layoutModes[nextIndex].id;
                        
                        // 更新按钮标题，显示当前布局模式
                        sizeToggleButton.title = `当前：${layoutModes[nextIndex].name}\n切换布局模式：紧凑布局、常规布局、大型文本框`;
                        
                        this.applySizeMode();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(sizeToggleButton);

                    // 随机开关
                    const randomToggleButton = createEl("button", "zml-control-btn", { textContent: this.randomEnabled ? "🎲" : "🎯" });
                    randomToggleButton.title = "随机选择文本框";
                    randomToggleButton.style.cssText += `
                        width: 26px; height: 26px;
                        ${this.randomEnabled ? 'background: #4a6a4a;' : 'background: #333;'} 
                        transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
                        padding: 0;
                        margin-right: 2px;
                    `;
                    randomToggleButton.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(-2px) scale(1.02)'; };
                    randomToggleButton.onmouseleave = (e) => { e.target.style.background = this.randomEnabled ? '#4a6a4a' : '#333'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    randomToggleButton.onmousedown = (e) => { e.target.style.transform = 'translateY(2px) scale(0.97)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'; };
                    randomToggleButton.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                    randomToggleButton.onclick = () => {
                        this.randomEnabled = !this.randomEnabled;
                        randomToggleButton.textContent = this.randomEnabled ? "🎲" : "🎯";
                        randomToggleButton.style.background = this.randomEnabled ? '#4a6a4a' : '#333';
                        randomCountInput.disabled = !this.randomEnabled;
                        randomCountInput.style.color = this.randomEnabled ? '#ccc' : '#666';
                        // 立即更新输出预览，确保随机状态切换立即生效
                        this.updateOutputPreview();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(randomToggleButton);

                    // 随机个数选择器
                    const randomCountInput = createEl("input", "zml-control-input", { 
                        type: "text", // 使用text类型，移除调节按钮
                        value: this.randomCount || 1 
                    });
                    randomCountInput.title = "随机选择的文本框数量（1-5）";
                    randomCountInput.disabled = !this.randomEnabled;
                    randomCountInput.style.cssText += `
                        width: 26px; height: 26px; /* 和其他按钮一样大 */
                        background: #333; border: 1px solid #555; 
                        color: ${this.randomEnabled ? '#ccc' : '#666'};
                        text-align: center; border-radius: 2px; 
                        font-size: 12px; 
                        padding: 0; /* 移除内边距 */
                        transition: all 0.2s ease;
                    `;
                    
                    // 启用双击编辑
                    randomCountInput.addEventListener('dblclick', function() {
                        this.select(); // 选中当前内容方便编辑
                    });
                    
                    // 限制只能输入1-5的数字
                    randomCountInput.addEventListener('input', function(e) {
                        e.target.value = e.target.value.replace(/[^0-9]/g, '');
                        // 限制长度为1
                        if (e.target.value.length > 1) {
                            e.target.value = e.target.value.slice(0, 1);
                        }
                        // 实时更新值
                        let value = parseInt(e.target.value);
                        if (!isNaN(value)) {
                            this.randomCount = value;
                            if (this.randomEnabled) {
                                this.updateOutputPreview();
                            }
                            this.triggerSlotChanged();
                        }
                    }.bind(this));
                    
                    // 失去焦点时验证输入
                    randomCountInput.addEventListener('blur', function(e) {
                        let value = parseInt(e.target.value);
                        if (isNaN(value) || value < 1) value = 1;
                        if (value > 5) value = 5;
                        e.target.value = value;
                        this.randomCount = value;
                        if (this.randomEnabled) {
                            this.updateOutputPreview();
                        }
                    }.bind(this));
                    
                    // 按下回车键时也验证
                    randomCountInput.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.target.blur();
                        }
                    });
                    
                    controlsRow.appendChild(randomCountInput);

                    const entriesList = createEl("div");
                    entriesList.style.cssText = `margin-bottom: 6px; flex: 1; min-height: 50px; overflow-y: auto; border: 1px solid #444; border-radius: 2px; padding: 4px; background: #333; scrollbar-width: none; -ms-overflow-style: none;`;
                    entriesList.style["-webkit-scrollbar"] = "none";

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
                        // 根据viewMode选择对应的样式
                        const s = this.styles[this.viewMode] || this.styles.normal;
                        const entryCard = createEl("div", "zml-st3-entry-card", {
                            style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${entry.enabled ? this.textboxColor : this.textboxDisabledColor}; border: 1px solid ${entry.enabled ? (this.isLocked ? this.enabledStateColor : this.textboxBorderColor) : this.textboxDisabledBorderColor}; border-radius: 2px;${this.isLocked && entry.enabled ? ' border-width: 2px;' : ''}`
                        });
                        entryCard.dataset.id = entry.id;
                        entryCard.dataset.type = "text";

                        // 在锁定状态下，允许点击文本框切换开启/关闭状态
                        entryCard.onclick = (e) => {
                            if (this.isLocked) {
                                // 切换enabled状态
                                entry.enabled = !entry.enabled;
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };

                        // 创建带有样式的复选框
                        const checkbox = createEl("input", "", { 
                            type: "checkbox", 
                            checked: entry.enabled, 
                            style: `
                                transform: scale(${s.checkboxScale}); 
                                flex-shrink: 0; 
                                margin-right: 4px;
                                accent-color: ${this.enabledStateColor};
                                cursor: pointer;
                            ` 
                        });
                        checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderSelectTextV3Entries(); this.triggerSlotChanged(); };

                        const dragHandle = createEl("div", "zml-st3-drag-handle", { textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: ${parseInt(s.inputHeight) * 0.5}px;` });
                        dragHandle.draggable = !this.isLocked;
                        // 添加点击事件，阻止冒泡
                        dragHandle.onclick = (e) => {
                            e.stopPropagation();
                        };

                        const baseInputStyle = `box-sizing: border-box; background: #2b2b2b; border: 1px solid #444; border-radius: 2px; color: #ccc; font-size: ${parseInt(s.inputHeight) * 0.55}px; margin-right: 4px; padding: ${s.inputPadding}; height: ${s.inputHeight};`;

                        const titleInput = createEl("input", "", { type: "text", value: entry.title, placeholder: this.getText("inputName"), style: `width: ${this.titleWidth}px; ${baseInputStyle}` });
                        // 在锁定状态下使标题输入框只读
                        titleInput.readOnly = this.isLocked;
                        if (this.isLocked) {
                            titleInput.style.cursor = 'not-allowed';
                        }
                        titleInput.oninput = (e) => {
                            if (!this.isLocked) {
                                entry.title = e.target.value;
                            }
                        };
                        titleInput.onblur = () => {
                            if (!this.isLocked) {
                                this.triggerSlotChanged(); 
                            }
                        };

                        const contentInput = createEl("input", "zml-st3-editable-content-input", {
                            type: "text",
                            value: entry.content || "",
                            placeholder: this.getText("inputContent"),
                            readOnly: true,
                            style: `flex: 1; min-width: 50px; ${baseInputStyle}${this.isLocked ? ' cursor: not-allowed;' : ''}`
                        });
                        const currentNodeInstance = this;
                        contentInput.onclick = () => {
                            // 在锁定状态下禁用内容编辑
                            if (!this.isLocked) {
                                showEditContentModal(entry, currentNodeInstance);
                            }
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

                        const deleteBtn = createEl("button", "", { textContent: "X", style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; font-size: ${parseInt(s.inputHeight) * 0.6}px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;
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
                        // 根据viewMode选择对应的样式
                        const s = this.styles[this.viewMode] || this.styles.normal;
                        const folderCard = createEl("div", "zml-st3-folder-card", {
                            style: `background: ${this.folderColor}; border: 1px solid ${adjustBrightness(this.folderColor, -15)}; padding: ${s.cardPadding};`
                        });
                        folderCard.dataset.id = entry.id;
                        folderCard.dataset.type = "folder";

                        const header = createEl("div", "zml-st3-folder-header");
                        // 改进的文件夹展开/折叠按钮
                        const toggle = createEl("div", "zml-st3-folder-toggle", {
                            textContent: entry.is_collapsed ? "▶" : "▼", 
                            style: `
                                font-size: ${parseInt(s.inputHeight) * 0.6}px;
                                margin-right: 8px;
                                width: 28px;
                                height: 28px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                cursor: pointer;
                                background-color: transparent;
                                border: none;
                                transition: transform 0.2s ease;
                                user-select: none;
                                flex-shrink: 0;
                            `
                        });
                        
                        // 为toggle添加独立的点击事件，确保它有最高优先级
                        toggle.onclick = (e) => {
                            e.stopPropagation();
                            entry.is_collapsed = !entry.is_collapsed;
                            toggle.textContent = entry.is_collapsed ? "▶" : "▼";
                            content.classList.toggle('hidden', entry.is_collapsed);
                            this.triggerSlotChanged();
                            
                            // 添加视觉反馈
                            toggle.style.transform = "scale(0.95)";
                            setTimeout(() => {
                                toggle.style.transform = "scale(1)";
                            }, 150);
                        };
                        
                        // 为toggle添加悬停效果
                        toggle.onmouseenter = () => {
                            toggle.style.transform = "scale(1.05)";
                        };
                        
                        toggle.onmouseleave = () => {
                            toggle.style.transform = "scale(1)";
                        };
                        
                        // 为toggle添加按下效果
                        toggle.onmousedown = () => {
                            toggle.style.transform = "scale(0.95)";
                        };
                        
                        toggle.onmouseup = () => {
                            toggle.style.transform = "scale(1.05)";
                        };
                        // 添加文件夹一键开启开关
                        const enableToggle = createEl("div", "zml-folder-enable-toggle", {
                            style: `
                                width: 36px;
                                height: 18px;
                                background-color: ${this.isAllChildrenEnabled(entry) ? this.enabledStateColor : '#555'};
                                border-radius: 9px;
                                margin-right: 5px;
                                cursor: pointer;
                                position: relative;
                                transition: background-color 0.3s ease;
                                display: flex;
                                align-items: center;
                                flex-shrink: 0;
                            `
                        });
                        // 添加开关滑块
                        const toggleSlider = createEl("div", "zml-toggle-slider", {
                            style: `
                                width: 14px;
                                height: 14px;
                                background-color: white;
                                border-radius: 50%;
                                margin-left: ${this.isAllChildrenEnabled(entry) ? '19px' : '2px'};
                                transition: margin-left 0.3s ease;
                                position: absolute;
                            `
                        });
                        enableToggle.appendChild(toggleSlider);
                        
                        // 添加点击事件处理
                        enableToggle.onclick = (e) => {
                            e.stopPropagation();
                            
                            // 获取文件夹内的所有文本框
                            const children = this.selectTextV3_data.entries.filter(it => it.parent_id === entry.id);
                            if (children.length > 0) {
                                // 切换所有子文本框的enabled状态
                                const newEnabledState = !this.isAllChildrenEnabled(entry);
                                children.forEach(child => {
                                    child.enabled = newEnabledState;
                                });
                                
                                // 更新UI
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };
                        const nameInput = createEl("input", "zml-st3-folder-name-input", { type: "text", value: entry.name, placeholder: "文件夹名称", style: `box-sizing: border-box; background: #2b2b2b; border: 1px solid #444; border-radius: 2px; color: #ccc; font-size: ${parseInt(s.inputHeight) * 0.55}px; padding: ${s.inputPadding}; height: ${s.inputHeight}; flex-grow: 1; margin-right: 5px;${this.isLocked ? ' cursor: not-allowed;' : ''}` });
                        // 在锁定状态下使文件夹名称输入框只读
                        nameInput.readOnly = this.isLocked;
                        
                        // 添加保存按钮到预设
                        const saveBtn = createEl("button", "zml-st3-folder-save", { textContent: "💾", title: "保存到预设", style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0; margin-right: 5px;` });
                        
                        // 为保存按钮添加交互效果
                        saveBtn.style.cssText += `transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;`;
                        saveBtn.onmouseenter = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(-1px) scale(1.02)'; };
                        saveBtn.onmouseleave = (e) => { e.target.style.background = '#444'; e.target.style.boxShadow = 'none'; e.target.style.transform = 'translateY(0) scale(1)'; };
                        saveBtn.onmousedown = (e) => { e.target.style.transform = 'translateY(0.5px) scale(0.98)'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'; };
                        saveBtn.onmouseup = (e) => { e.target.style.background = '#555'; e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; e.target.style.transform = 'translateY(0) scale(1)'; };
                        
                        // 创建保存预设的弹窗函数
                        const createSavePresetDialog = (folderEntry, childrenTextEntries) => {
                            return new Promise((resolve) => {
                                // 移除已存在的弹窗
                                const existingDialog = document.querySelector('.zml-save-preset-dialog-overlay');
                                if (existingDialog) existingDialog.remove();
                                
                                // 创建弹窗元素
                                const overlay = document.createElement('div');
                                overlay.className = 'zml-save-preset-dialog-overlay';
                                overlay.style.cssText = `
                                    position: fixed;
                                    top: 0;
                                    left: 0;
                                    right: 0;
                                    bottom: 0;
                                    background-color: rgba(0, 0, 0, 0.7);
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    z-index: 10000;
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                `;
                                
                                const dialog = document.createElement('div');
                                dialog.className = 'zml-save-preset-dialog';
                                dialog.style.cssText = `
                                    background-color: #2a2a2a;
                                    border: 1px solid #555;
                                    border-radius: 8px;
                                    padding: 20px;
                                    width: 400px;
                                    max-width: 90vw;
                                    color: #ccc;
                                `;
                                
                                // 弹窗标题
                                const title = document.createElement('h3');
                                title.textContent = '保存文件夹到预设';
                                title.style.cssText = 'margin: 0 0 15px 0; color: #fff; font-size: 18px;';
                                
                                // 文件夹名称输入
                                const nameContainer = document.createElement('div');
                                nameContainer.style.cssText = 'margin-bottom: 15px;';
                                
                                const nameLabel = document.createElement('label');
                                nameLabel.textContent = '文件夹名称:';
                                nameLabel.style.cssText = 'display: block; margin-bottom: 5px;';
                                
                                const nameInput = document.createElement('input');
                                nameInput.type = 'text';
                                nameInput.value = folderEntry.name;
                                nameInput.style.cssText = `
                                    width: 100%;
                                    padding: 8px 12px;
                                    background-color: #3a3a3a;
                                    border: 1px solid #555;
                                    border-radius: 4px;
                                    color: #fff;
                                    font-size: 14px;
                                    box-sizing: border-box;
                                `;
                                
                                nameContainer.appendChild(nameLabel);
                                nameContainer.appendChild(nameInput);
                                
                                // 包含的文本框列表
                                const textListContainer = document.createElement('div');
                                textListContainer.style.cssText = 'margin-bottom: 20px; max-height: 200px; overflow-y: auto;';
                                
                                const listLabel = document.createElement('div');
                                listLabel.textContent = `将保存以下 ${childrenTextEntries.length} 个文本框:`;
                                listLabel.style.cssText = 'margin-bottom: 10px; font-size: 14px;';
                                
                                const textList = document.createElement('ul');
                                textList.style.cssText = 'margin: 0; padding-left: 20px;';
                                
                                childrenTextEntries.forEach(child => {
                                    if (child.item_type === 'text') {
                                        const li = document.createElement('li');
                                        li.textContent = `${child.title || '未命名文本'}`;
                                        li.style.cssText = 'margin-bottom: 5px;';
                                        textList.appendChild(li);
                                    }
                                });
                                
                                textListContainer.appendChild(listLabel);
                                textListContainer.appendChild(textList);
                                
                                // 按钮容器
                                const buttonsContainer = document.createElement('div');
                                buttonsContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';
                                
                                // 取消按钮
                                const cancelBtn = document.createElement('button');
                                cancelBtn.textContent = '取消';
                                cancelBtn.style.cssText = `
                                    padding: 8px 16px;
                                    background-color: #444;
                                    border: 1px solid #666;
                                    border-radius: 4px;
                                    color: #ccc;
                                    cursor: pointer;
                                    font-size: 14px;
                                `;
                                
                                cancelBtn.onclick = () => {
                                    overlay.remove();
                                    resolve(null);
                                };
                                
                                // 保存按钮
                                const saveBtn = document.createElement('button');
                                saveBtn.textContent = '保存';
                                saveBtn.style.cssText = `
                                    padding: 8px 16px;
                                    background-color: #555;
                                    border: 1px solid #777;
                                    border-radius: 4px;
                                    color: #fff;
                                    cursor: pointer;
                                    font-size: 14px;
                                `;
                                
                                saveBtn.onclick = () => {
                                    const folderName = nameInput.value.trim();
                                    if (!folderName) {
                                        alert('请输入文件夹名称！');
                                        return;
                                    }
                                    
                                    overlay.remove();
                                    resolve({
                                        folderName: folderName,
                                        children: childrenTextEntries
                                    });
                                };
                                
                                buttonsContainer.appendChild(cancelBtn);
                                buttonsContainer.appendChild(saveBtn);
                                
                                // 组合所有元素
                                dialog.appendChild(title);
                                dialog.appendChild(nameContainer);
                                dialog.appendChild(textListContainer);
                                dialog.appendChild(buttonsContainer);
                                overlay.appendChild(dialog);
                                
                                // 添加到文档
                                document.body.appendChild(overlay);
                                
                                // ESC键关闭弹窗
                                const handleEsc = (e) => {
                                    if (e.key === 'Escape') {
                                        overlay.remove();
                                        resolve(null);
                                        document.removeEventListener('keydown', handleEsc);
                                    }
                                };
                                
                                document.addEventListener('keydown', handleEsc);
                                
                                // 自动聚焦到名称输入框
                                nameInput.focus();
                                nameInput.select();
                            });
                        };
                        
                        // 保存按钮点击事件 - 将文件夹保存到预设
                        saveBtn.onclick = async (e) => {
                            e.stopPropagation();
                            
                            // 获取文件夹内的所有文本框
                            const children = this.selectTextV3_data.entries.filter(it => it.parent_id === entry.id);
                            
                            if (children.length === 0) {
                                alert("文件夹内没有文本框，无法保存预设！");
                                return;
                            }
                            
                            try {
                                // 显示保存预设弹窗
                                const saveInfo = await createSavePresetDialog(entry, children);
                                
                                // 如果用户取消了操作，直接返回
                                if (!saveInfo) return;
                                
                                // 首先保存文件夹预设
                                const folderResponse = await sendPresetRequest("add", {
                                    type: "folder",
                                    name: saveInfo.folderName,
                                    parent_id: null // 保存为顶级文件夹
                                });
                                
                                if (!folderResponse.success) {
                                    showNotification(`保存文件夹失败: ${folderResponse.message}`, true);
                                    return;
                                }
                                
                                // 获取新创建的文件夹ID
                                const newFolderId = folderResponse.preset_id || folderResponse.id || folderResponse.folder_id; // 尝试多种可能的ID字段名
                                
                                // 然后保存文件夹内的所有文本框
                                let saveCount = 0;
                                for (const child of saveInfo.children) {
                                    if (child.item_type === 'text') {
                                        const textResponse = await sendPresetRequest("add", {
                                            type: "text",
                                            name: child.title || "未命名文本",
                                            parent_id: newFolderId,
                                            content: child.content // 使用正确的content字段
                                        });
                                        
                                        if (textResponse.success) {
                                            saveCount++;
                                        }
                                    }
                                }
                                
                                showNotification(`文件夹 "${saveInfo.folderName}" 及其 ${saveCount} 个文本框已成功保存到预设！`);
                            } catch (error) {
                                showNotification(`保存出错: ${error.message}`, true);
                            }
                        };
                        
                        const deleteBtn = createEl("button", "zml-st3-folder-delete", { textContent: "🗑️", title: this.getText("deleteFolder"), style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;` });
                        const dragHandle = createEl("div", "zml-st3-drag-handle", { textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; color: ${this.isLocked ? '#666' : '#ccc'}; user-select: none; font-size: ${parseInt(s.inputHeight) * 0.5}px; padding: 0 5px; margin-right: 5px; display: flex; align-items: center; justify-content: center;` });
                        dragHandle.draggable = !this.isLocked;

                        const content = createEl("div", `zml-st3-folder-content ${entry.is_collapsed ? 'hidden' : ''}`, {
                            style: `border-top: 1px solid ${adjustBrightness(this.folderColor, -15)}; margin-top: 5px; padding-top: 5px;`
                        });

                        header.style.cssText = `display: flex; align-items: center;`;

                        header.onclick = (e) => {
                            // 排除toggle按钮，因为它现在有自己的点击事件
                            if (e.target === nameInput || e.target === deleteBtn || e.target === dragHandle || e.target === toggle) return;
                            if (e.target === header || e.target.parentElement === header) {
                                entry.is_collapsed = !entry.is_collapsed;
                                toggle.textContent = entry.is_collapsed ? "▶" : "▼";
                                content.classList.toggle('hidden', entry.is_collapsed);
                                this.triggerSlotChanged();
                            }
                        };

                        nameInput.onchange = (e) => { 
                            if (!this.isLocked) {
                                entry.name = e.target.value; 
                                this.triggerSlotChanged(); 
                            }
                        };

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
                                if (confirm("文件夹内含有文本框，确定要强制删除此文件夹及其所有内容吗？")) {
                                    // 删除文件夹及其所有内容
                                    const itemIndex = this.selectTextV3_data.entries.findIndex(it => it.id === entry.id);
                                    if (itemIndex > -1) {
                                        // 首先删除所有子项
                                        for (let i = this.selectTextV3_data.entries.length - 1; i >= 0; i--) {
                                            if (this.selectTextV3_data.entries[i].parent_id === entry.id) {
                                                this.selectTextV3_data.entries.splice(i, 1);
                                            }
                                        }
                                        // 然后删除文件夹本身
                                        this.selectTextV3_data.entries.splice(itemIndex, 1);
                                        this.renderSelectTextV3Entries();
                                        this.triggerSlotChanged();
                                    }
                                }
                                return;
                            }
                            const itemIndex = this.selectTextV3_data.entries.findIndex(it => it.id === entry.id);
                            if (itemIndex > -1) {
                                this.selectTextV3_data.entries.splice(itemIndex, 1);
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };

                        header.append(toggle, dragHandle, enableToggle, nameInput, saveBtn, deleteBtn);
                        folderCard.append(header, content);
                        this.addDragDropHandlers(folderCard, entry);
                        return folderCard;
                    };
                    
                    // 检查文件夹内的所有子文本框是否都已开启
                    this.isAllChildrenEnabled = (folderEntry) => {
                        const children = this.selectTextV3_data.entries.filter(it => it.parent_id === folderEntry.id);
                        if (children.length === 0) return false;
                        return children.every(child => child.enabled);
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

                        // 确保所有文件夹条目都有is_collapsed属性
                        this.selectTextV3_data.entries.forEach(e => {
                            if (e.item_type === 'folder' && e.is_collapsed === undefined) {
                                e.is_collapsed = true; // 默认折叠状态
                            }
                        });

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

                        // 收集所有启用的文本框
                        const allEnabledTextEntries = [];
                        const collectEnabledTextEntries = (items) => {
                            items.forEach(entry => {
                                if (entry.item_type === 'text' && entry.enabled) {
                                    allEnabledTextEntries.push(entry);
                                } else if (entry.item_type === 'folder' && !entry.is_collapsed) {
                                    const children = this.selectTextV3_data.entries.filter(e => e.parent_id === entry.id);
                                    collectEnabledTextEntries(children);
                                }
                            });
                        };

                        const topLevelItems = this.selectTextV3_data.entries.filter(e => !e.parent_id);
                        collectEnabledTextEntries(topLevelItems);

                        // 根据随机开关决定使用哪些文本框
                        let entriesToUse = [];
                        if (this.randomEnabled && allEnabledTextEntries.length > 0) {
                            // 确保randomCount是整数
                            const count = Math.min(parseInt(this.randomCount || 1, 10), allEnabledTextEntries.length);
                            // 使用Fisher-Yates洗牌算法进行真正的随机排序
                            const shuffled = [...allEnabledTextEntries];
                            for (let i = shuffled.length - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                            }
                            // 只选择指定数量的条目
                            entriesToUse = shuffled.slice(0, Math.max(1, count));
                        } else {
                            // 不启用随机时，使用所有启用的文本框
                            entriesToUse = allEnabledTextEntries;
                        }

                        // 处理选中的文本框内容
                        entriesToUse.forEach((entry, index) => {
                            // Replace actual newlines with a placeholder first
                            let contentToAdd = entry.content.replace(/\n/g, NEWLINE_PLACEHOLDER).trim();
                            
                            // Now apply separator trimming, which should not affect the placeholders
                            contentToAdd = contentToAdd.replace(new RegExp(`^${(separator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+|${(separator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+$`, 'g'), '');

                            if(contentToAdd) { 
                                combinedContent += (combinedContent ? separator : "") + contentToAdd;
                            }
                        });

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
                        let actualEntriesListHeight = entriesList.clientHeight; // 只使用当前可视高度，避免强制展开所有内容

                        let currentContentHeight = actualControlsRowHeight + actualEntriesListHeight + actualBottomButtonGroupHeight + 12; // 加上一些额外的间距

                        currentContentHeight = Math.max(currentContentHeight, initialHeightFromWidgets);

                        size[1] = Math.max(size[1], currentContentHeight);
                        this.size = size;

                        if (origOnResize) origOnResize.call(this, size);
                    };

                    this.triggerSlotChanged = () => {
                        // 确保randomEnabled和randomCount属性被包含在selectTextV3_data中
                        this.selectTextV3_data.randomEnabled = this.randomEnabled;
                        this.selectTextV3_data.randomCount = this.randomCount;
                        
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
                    obj.textboxColor = this.textboxColor;
            obj.enabledStateColor = this.enabledStateColor;
                    obj.textboxDisabledColor = this.textboxDisabledColor;
                    obj.textboxBorderColor = this.textboxBorderColor;
                    obj.textboxDisabledBorderColor = this.textboxDisabledBorderColor;
                    obj.randomEnabled = this.randomEnabled;
                    obj.randomCount = this.randomCount;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(obj) {
                origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
                if (obj.selectTextV3_data) {
                    // 深拷贝数据以确保不影响原始对象
                    this.selectTextV3_data = JSON.parse(JSON.stringify(obj.selectTextV3_data));
                    this.selectTextV3_data.entries.forEach(e => {
                        if (!e.item_type) e.item_type = 'text';
                        if (e.parent_id === undefined) e.parent_id = null;
                        // 严格保留原有折叠状态，只在未定义时设置默认值
                        if (e.item_type === 'folder' && e.is_collapsed === undefined) e.is_collapsed = true;  // 默认折叠状态
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
                // 恢复随机相关设置
                if (obj.randomEnabled !== undefined) this.randomEnabled = obj.randomEnabled;
                if (obj.randomCount !== undefined) this.randomCount = obj.randomCount;
                
                // 强制设置为不随机状态（无论之前保存的是什么）
                this.randomEnabled = false;
                // 同步更新selectTextV3_data中的randomEnabled属性，确保状态一致性
                if (this.selectTextV3_data) {
                    this.selectTextV3_data.randomEnabled = false;
                }
                
                this.folderColor = obj.folderColor ?? "#30353C"; // 深色背景
                    this.textboxColor = obj.textboxColor ?? "#3a3a3a";
            this.enabledStateColor = obj.enabledStateColor ?? "#00cc00";
                    this.textboxDisabledColor = obj.textboxDisabledColor ?? "#2a2a2a";
                    this.textboxBorderColor = obj.textboxBorderColor ?? "#555";
                    this.textboxDisabledBorderColor = obj.textboxDisabledBorderColor ?? "#444";
                    // 保留randomCount的设置，但确保randomEnabled始终为false
                    this.randomCount = obj.randomCount ?? 1;

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
                        const folderColorInput = this.domElement?.querySelectorAll("input[type='color']")[0];
                        if (folderColorInput) {
                            folderColorInput.value = this.folderColor;
                        }
                        
                        const textboxColorInput = this.domElement?.querySelectorAll("input[type='color']")[1];
                        if (textboxColorInput) {
                            textboxColorInput.value = this.textboxColor;
                        }
                        
                        const enabledStateColorInput = this.domElement?.querySelectorAll("input[type='color']")[2];
                        if (enabledStateColorInput) {
                            enabledStateColorInput.value = this.enabledStateColor;
                        }
                        
                        // Update feedback for node control buttons based on current state
                        const controlButtons = this.domElement?.querySelectorAll('.zml-control-btn');
                        if (controlButtons) {
                            controlButtons.forEach(btn => {
                                if (btn.title === "锁定/解锁文本框排序") {
                                    btn.style.background = this.isLocked ? '#644' : '#333';
                                }
                                if (btn.title === "随机选择文本框") {
                                    btn.textContent = this.randomEnabled ? "🎲" : "🎯";
                                    btn.style.background = this.randomEnabled ? '#4a6a4a' : '#333';
                                }
                            });
                        }

                        // 更新随机个数选择器
                        const numberInputs = this.domElement?.querySelectorAll("input.zml-control-input[type='number']");
                        for (let i = 0; i < numberInputs?.length; i++) {
                            if (numberInputs[i].title === "随机选择的文本框数量") {
                                numberInputs[i].value = this.randomCount || 1;
                                numberInputs[i].disabled = !this.randomEnabled;
                                numberInputs[i].style.color = this.randomEnabled ? '#ccc' : '#666';
                                break;
                            }
                        }


                        this.applySizeMode();
                        this.onResize(this.size);
                    }, 10);
                }
            };
        }
    }
});
