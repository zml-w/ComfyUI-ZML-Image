import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// 全局默认模板内容定义
const DEFAULT_TEMPLATES = {
    zh: `你是一个 Stable Diffusion 的 AI 助手。你的任务是替换提示中的特征，且保持sdxl可识别的tag格式。
你的目标是提取"替换提示词"中描述的特征（同时要保持"替换提示词"的格式和英文的大小写），并有条理地将它们完全替换到"原始提示词"中，此外要删除"原始提示词"中的质量提示词（masterpiece, newest, absurdres, best quality, amazing quality, very aesthetic, ultra-detailed, highly detailed）。
"要替换的特征（指南）"列表告诉你应该从"替换提示词"中提取哪些类别的特征（例如发型、眼睛颜色、服装）。
请只回复新的、修改后的提示，不要包含任何解释。

原始提示词：
{original_prompt}

替换提示词：
{substitute_prompt}

要替换的特征（指南）：
{target_features}
`,
    en: `You are a Stable Diffusion AI assistant. Your task is to replace features in prompts while maintaining the sdxl-recognizable tag format.
Your goal is to extract features described in the "substitute prompt" (while maintaining the format and English case of the "substitute prompt") and systematically replace them completely in the "original prompt", additionally removing quality prompts from the "original prompt" (masterpiece, newest, absurdres, best quality, amazing quality, very aesthetic, ultra-detailed, highly detailed).
The "features to replace (guide)" list tells you which categories of features to extract from the "substitute prompt" (e.g., hairstyle, eye color, clothing).
Please only reply with the new, modified prompt without any explanation.

Original prompt:
{original_prompt}

Substitute prompt:
{substitute_prompt}

Features to replace (guide):
{target_features}
`
};

// 工具函数集合
const Utils = {
    // 防抖函数，用于延迟执行，避免频繁的API调用
    debounce(func, delay) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    },

    // 带超时的 fetch 函数
    async fetchWithTimeout(resource, options = {}, timeout = 60000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);

        return response;
    },

    // 保存当前模板内容到后端
    async saveCurrentTemplateContent(templateId, content) {
        try {
            // 获取当前所有设置
            const response = await fetch('/zml_ai_tool/get_settings');
            const settings = await response.json();
            
            // 确保templates对象存在
            if (!settings.templates) {
                settings.templates = {};
            }
            
            // 更新指定模板的内容
            settings.templates[templateId] = content;
            
            // 保存回后端
            await fetch('/zml_ai_tool/save_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        } catch (error) {
            console.error('保存模板内容失败:', error);
        }
    }
};
// --- 扩展 ComfyUI ---
app.registerExtension({
    name: "Comfy.ZML_Ai多功能助手",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_Ai多功能助手") {

            // --- 全局国际化和UI管理 ---
            const i18n = {
                zh: {
                    language: "语言",
                    prompt: "提示词",
                    llm: "LLM",
                    languageSettings: "语言设置",
                    promptSettings: "提示词设置",
                    promptTemplate: "提示词模板",
                    customPrompt: "自定义AI提示词 (Custom Prompt):",
                    promptPlaceholder: "使用 <code>{original_prompt}</code> 作为必需占位符；<code>{substitute_prompt}</code> 与 <code>{target_features}</code> 可选。",
                    llmSettings: "LLM 设置",
                    llmDescription: `配置用于特征替换的LLM API。推荐使用 <a href="https://openrouter.ai" target="_blank">OpenRouter</a> (部分模型免费)。`,
                    channel: "渠道:",
                    apiUrl: "API URL:",
                    apiKey: "API Key:",
                    model: "模型 (Model):",
                    search: "搜索...",
                    save: "保存",
                    close: "关闭",
                    settingsSaved: "设置已保存！",
                    saveFailed: "保存失败: ",
                    testConnection: "测试连接",
                    getModels: "获取模型列表",
                    testResponse: "测试回复",
                    testing: "测试中...",
                    connectionSuccess: "连接成功！",
                    connectionFailed: "连接失败: ",
                    responseSuccess: "回复成功: ",
                    responseFailed: "回复失败: ",
                    import: "导入",
                    export: "导出",
                    debug: "调试",
                    settings: "设置",
                    addTagPlaceholder: "输入后按回车...",
                    apiKeyMissingWarning: "警告: 未设置API Key。请在“设置”中配置。",
                    connectionFailedWarning: "连接失败。请检查设置和网络。",
                    checkingConnection: "正在检查连接...",
                    exportSuccess: "设置已成功导出！",
                    exportFailed: "导出失败。",
                    importSuccess: "设置已成功导入！",
                    importError: "导入设置失败，文件格式无效或已损坏。",
                    presets: "预设",
                    managePresets: "管理预设",
                    addPreset: "添加预设",
                    presetName: "预设名称...",
                    savePreset: "保存当前标签为预设",
                    deletePresetConfirmation: "确定要删除预设 '{presetName}' 吗？此操作无法撤销。",
                    presetNameExists: "预设名称已存在。",
                    presetDeleted: "预设已删除。",
                    presetSaved: "预设已保存。",
                    saveCurrentPreset: "保存到当前预set",
                    saveAsPreset: "另存为新预设",
                    loadingModels: "正在加载模型...",
                    selectModel: "选择一个模型",
                    errorLoadingModels: "加载模型失败",
                    modelsRefreshed: "模型列表已刷新！",
                    timeout: "超时 (秒)",
                    timeoutHint: "LLM API请求的等待时间。",
                    helpTitle: "功能说明",
                    helpIntro: "此区域用于选择需要进行特征融合的'特征类别'。",
                    helpWorkflowTitle: "工作流程：",
                    helpWorkflowStep1: "1. 节点会从'original_prompt'中寻找并移除与所选类别相关的标签。",
        helpWorkflowStep2: "2. 同时，节点会将'substitute_prompt'中与这些类别相关的标签提取出来。",
                    helpWorkflowStep3: "3. 最后，将提取出的特征标签与处理过的'original_prompt'合并，生成'new_prompt'。",
                    helpExampleTitle: "示例：",
                    helpExampleCategories: "- 选择的特征类别: [hair style], [eye color], [clothing]",
                    helpExampleResult: "- 结果 (new_prompt): 1girl, solo, smile, short hair, green eyes, armor",
                    importTooltip: "导入设置和预设 (.json)",
                    exportTooltip: "导出设置和预设 (.json)",
                    debugTooltip: "查看发送给LLM的最终提示词以进行调试",
                    settingsTooltip: "打开LLM、提示词和语言设置",
                    presetsTooltip: "管理和切换特征预设",
                    helpTooltip: "显示此节点的功能说明",
                    addTagTooltip: "添加一个新的特征类别",
                    // 模板与弹窗
                    addTemplate: "+ 增加模板",
                    editTemplate: "修改模板",
                    restoreSystemTemplate: "一键恢复系统默认模板",
                    newTemplateTitle: "新增模板",
                    editTemplateTitle: "修改模板",
                    templateName: "模板名称：",
                    templateContent: "自定义提示词：",
                    templateNameRequired: "模板名称不能为空",
                    cannotEditDefaultTemplate: "不能修改默认模板的名称",
                    templatePlaceholdersMissing: "模板缺少必需占位符：{missing}",
                    placeholdersHelpTitle: "占位符说明",
                    placeholdersHelpList: "- {original_prompt}: 原始提示词，作为输入（必需）\n- {substitute_prompt}: 替换提示词，提供按规则提取/替换的内容（可选）\n- {target_features}: 要替换的特征类别列表（可选，如 hair style, eye color)",
                    restoreConfirm: "确认将系统默认模板恢复到初始固定提示词？此操作不影响自定义模板。",
                    restoreSuccess: "系统模板已恢复",
                    restoreFailed: "恢复失败: ",
                    deleteTemplate: "删除模板",
                    deleteTemplateConfirm: "确定要删除模板 '{templateName}' 吗？此操作无法撤销。",
                    cannotDeleteDefaultTemplate: "不能删除默认模板",
                    templateDeleted: "模板已删除",
                    deleteFailed: "删除失败: ",
                },
                en: {
                    language: "Language",
                    prompt: "Prompt",
                    llm: "LLM",
                    languageSettings: "Language Settings",
                    promptSettings: "Prompt Settings",
                    promptTemplate: "Prompt Template",
                    customPrompt: "Custom AI Prompt:",
                    promptPlaceholder: "Use <code>{original_prompt}</code> as required; <code>{substitute_prompt}</code> and <code>{target_features}</code> are optional.",
                    llmSettings: "LLM Settings",
                    llmDescription: `Configure the LLM API for feature swapping. <a href="https://openrouter.ai" target="_blank">OpenRouter</a> is recommended (Some models are free).`,
                    channel: "Channel:",
                    apiUrl: "API URL:",
                    apiKey: "API Key:",
                    model: "Model:",
                    search: "Search...",
                    save: "Save",
                    close: "Close",
                    settingsSaved: "Settings saved!",
                    saveFailed: "Save failed: ",
                    testConnection: "Test Connection",
                    getModels: "Get Models",
                    testResponse: "Test Response",
                    testing: "Testing...",
                    connectionSuccess: "Connection successful!",
                    connectionFailed: "Connection failed: ",
                    responseSuccess: "Response successful: ",
                    responseFailed: "Response failed: ",
                    import: "Import",
                    export: "Export",
                    debug: "Debug",
                    settings: "Settings",
                    addTagPlaceholder: "Enter to add...",
                    apiKeyMissingWarning: "Warning: API Key is not set. Please configure in Settings.",
                    connectionFailedWarning: "Connection failed. Check settings and network.",
                    checkingConnection: "Checking connection...",
                    exportSuccess: "Settings exported successfully!",
                    exportFailed: "Export failed.",
                    importSuccess: "Settings imported successfully!",
                    importError: "Failed to import settings. Invalid or corrupt file format.",
                    presets: "Presets",
                    managePresets: "Manage Presets",
                    addPreset: "Add Preset",
                    presetName: "Preset name...",
                    savePreset: "Save current tags as preset",
                    deletePresetConfirmation: "Are you sure you want to delete the preset '{presetName}'? This cannot be undone.",
                    presetNameExists: "Preset name already exists.",
                    presetDeleted: "Preset deleted.",
                    presetSaved: "Preset saved.",
                    saveCurrentPreset: "Save to Current Preset",
                    saveAsPreset: "Save as New Preset",
                    loadingModels: "Loading models...",
                    selectModel: "Select a model",
                    errorLoadingModels: "Error loading models",
                    modelsRefreshed: "Model list refreshed!",
                    timeout: "Timeout (s)",
                    timeoutHint: "Time to wait for the LLM API request.",
                    helpTitle: "Feature Description",
                    helpIntro: "This area is for selecting 'feature categories' for feature merging.",
                    helpWorkflowTitle: "Workflow:",
                    helpWorkflowStep1: "1. The node finds and removes tags related to the selected categories from the 'original_prompt'.",
        helpWorkflowStep2: "2. Simultaneously, the node extracts tags related to these categories from the 'substitute_prompt'.",
                    helpWorkflowStep3: "3. Finally, it merges the extracted feature tags with the processed 'original_prompt' to generate the 'new_prompt'.",
                    helpExampleTitle: "Example:",
                    helpExampleCategories: "- Selected Feature Categories: [hair style], [eye color], [clothing]",
                    helpExampleResult: "- Result (new_prompt): 1girl, solo, smile, short hair, green eyes, armor",
                    importTooltip: "Import settings and presets (.json)",
                    exportTooltip: "Export settings and presets (.json)",
                    debugTooltip: "View the final prompt sent to the LLM for debugging",
                    settingsTooltip: "Open LLM, prompt, and language settings",
                    presetsTooltip: "Manage and switch feature presets",
                    helpTooltip: "Show the feature description for this node",
                    addTagTooltip: "Add a new feature category",
                    // Template & modal
                    addTemplate: "+ Add Template",
                    editTemplate: "Edit Template",
                    restoreSystemTemplate: "Restore System Default Template",
                    newTemplateTitle: "Add New Template",
                    editTemplateTitle: "Edit Template",
                    templateName: "Template Name:",
                    templateContent: "Template Content:",
                    templateNameRequired: "Template Name is required",
                    cannotEditDefaultTemplate: "Cannot edit default template name",
                    templatePlaceholdersMissing: "Template is missing required placeholders: {missing}",
                    placeholdersHelpTitle: "Placeholders",
                    placeholdersHelpList: "- {original_prompt}: The original prompt input (required)\n- {substitute_prompt}: The substitute prompt for rule-based replacement (optional)\n- {target_features}: Feature categories to replace (optional, e.g., hair style, eye color)",
                    restoreConfirm: "Confirm restoring system default template content? Custom templates won't be affected.",
                    restoreSuccess: "System template restored",
                    restoreFailed: "Restore failed: ",
                    deleteTemplate: "Delete Template",
                    deleteTemplateConfirm: "Are you sure you want to delete template '{templateName}'? This cannot be undone.",
                    cannotDeleteDefaultTemplate: "Cannot delete default template",
                    templateDeleted: "Template deleted",
                    deleteFailed: "Delete failed: ",
                }
            };
            let currentLanguage = 'zh';
            const t = (key) => i18n[currentLanguage]?.[key] || i18n.zh[key];
            const nodeUIs = new Map();

            function updateAllNodeUIs() {
                for (const [node, ui] of nodeUIs.entries()) {
                    ui.importButton.innerHTML = `<i class="fas fa-upload"></i> ${t('import')}`;
                    ui.importButton.removeAttribute('title');
                    ui.exportButton.innerHTML = `<i class="fas fa-download"></i> ${t('export')}`;
                    ui.exportButton.removeAttribute('title');
                    ui.debugButton.innerHTML = `<i class="fas fa-bug"></i> ${t('debug')}`;
                    ui.debugButton.removeAttribute('title');
                    ui.settingsButton.innerHTML = `<i class="fas fa-cog"></i> ${t('settings')}`;
                    ui.settingsButton.removeAttribute('title');
                    // ui.presetButton.title = t('presetsTooltip');
                    // ui.helpIcon.title = t('helpTooltip');
                    ui.addTagButton.title = t('addTagTooltip');
                }
            }

            function showMessage(ui, text, color = "#FF9800") {
                if (!ui || !ui.messageArea) return;
                ui.messageArea.textContent = text;
                ui.messageArea.style.color = color;
                ui.messageArea.style.display = text ? "block" : "none";
            }

            function showToast(message, type = 'success', duration = 3000) {
                const dialog = document.querySelector(".cfs-new-settings-dialog");
                if (!dialog) return;

                let toastContainer = dialog.querySelector(".cfs-toast-container");
                if (!toastContainer) {
                    toastContainer = document.createElement("div");
                    toastContainer.className = "cfs-toast-container";
                    dialog.appendChild(toastContainer);
                }

                const toast = document.createElement("div");
                toast.className = `cfs-toast cfs-toast-${type}`;
                toast.textContent = message;

                toastContainer.appendChild(toast);

                // Animate in
                setTimeout(() => {
                    toast.style.opacity = "1";
                    toast.style.transform = "translateY(0)";
                }, 10);

                // Animate out and remove
                setTimeout(() => {
                    toast.style.opacity = "0";
                    toast.style.transform = "translateY(-20px)";
                    setTimeout(() => {
                        toast.remove();
                        // If container is empty, remove it
                        if (toastContainer.children.length === 0) {
                            toastContainer.remove();
                        }
                    }, 300);
                }, duration);
            }

            async function checkConnectionStatus(ui, settingsOverride = null) {
                if (!ui) return;
                showMessage(ui, t('checkingConnection'), '#ccc');
                try {
                    const settings = settingsOverride || await api.fetchApi("/zml/ai/llm_settings").then(r => r.json());
                    const channel = settings.api_channel || 'openrouter';
                    const channelConf = settings.channels_config?.[channel] || {};

                    if (channel !== 'gemini_cli' && !channelConf.api_key) {
                        showMessage(ui, t('apiKeyMissingWarning'));
                        return;
                    }
                    const payload = {
                        api_channel: channel,
                        api_url: channelConf.api_url || '',
                        api_key: channelConf.api_key || '',
                        timeout: settings.timeout || 60
                    };
                    const response = await api.fetchApi("/zml/ai/test_llm_connection", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });
                    if (!response.ok) {
                        showMessage(ui, t('connectionFailedWarning'));
                    } else {
                        showMessage(ui, ""); // Success
                    }
                } catch (error) {
                    showMessage(ui, t('connectionFailedWarning'));
                    console.error("CFS: Connection check failed.", error);
                }
            }

            // 简洁的新增模板对话框
            function showAddTemplateDialog() {
                // 防止重复弹窗
                if (document.querySelector('.cfs-add-template-modal')) return;

                const modal = document.createElement('div');
                modal.className = 'cfs-add-template-modal';
                modal.innerHTML = `
                    <div class="cfs-modal-content">
                        <h4>${t('newTemplateTitle')}</h4>
                        <label>${t('templateName')}</label>
                        <input type="text" id="cfs-template-name" placeholder="${t('templateName')}">
                        <label>${t('templateContent')}</label>
                        <textarea id="cfs-template-content" rows="6" placeholder="${t('customPrompt')}"></textarea>
                        <div class="cfs-modal-buttons">
                            <button id="cfs-save-template">${t('save')}</button>
                            <button id="cfs-cancel-template">${t('close')}</button>
                        </div>
                    </div>
                `;
                
                document.body.appendChild(modal);
                
                // 关闭按钮
                modal.querySelector('#cfs-cancel-template').onclick = () => modal.remove();
                
                // 保存按钮
                modal.querySelector('#cfs-save-template').onclick = async () => {
                    const name = modal.querySelector('#cfs-template-name').value.trim();
                    const content = modal.querySelector('#cfs-template-content').value.trim();
                    
                    if (!name) {
                        alert(t('templateNameRequired'));
                        return;
                    }
                    
                    if (!content || !content.includes('{original_prompt}')) {
                        alert('模板内容必须包含 {original_prompt} 占位符');
                        return;
                    }
                    
                    try {
                        // 获取当前设置
                        const response = await api.fetchApi('/zml/ai/llm_settings');
                        const settings = response.ok ? await response.json() : {};
                        
                        // 生成模板ID
                        const templateId = 'custom_' + Date.now();
                        
                        // 更新模板列表
                        if (!settings.prompt_templates) settings.prompt_templates = {};
                        settings.prompt_templates[templateId] = {
                            name_zh: name,
                            name_en: name,
                            content: content
                        };
                        
                        // 保存设置
                        const saveResponse = await api.fetchApi('/zml/ai/llm_settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(settings)
                        });
                        
                        if (saveResponse.ok) {
                            showToast(t('settingsSaved'), 'success');
                            modal.remove();
                            // 刷新设置对话框中的模板列表
                            const templateSelect = document.querySelector('#cfs-prompt-template-select');
                            if (templateSelect) {
                                const option = document.createElement('option');
                                option.value = templateId;
                                option.textContent = name;
                                templateSelect.appendChild(option);
                                templateSelect.value = templateId;
                                
                                // 更新文本域内容
                                const textArea = document.querySelector('#cfs-custom-prompt-new');
                                if (textArea) textArea.value = content;
                            }
                        } else {
                            throw new Error('保存失败');
                        }
                    } catch (error) {
                        showToast(t('saveFailed') + error.message, 'error');
                    }
                };
                

            }

            // 修改模板对话框
            function showEditTemplateDialog() {
                // 防止重复弹窗
                if (document.querySelector('.cfs-edit-template-modal')) return;

                // 获取当前选中的模板
                const templateSelect = document.querySelector('#cfs-prompt-template-select');
                if (!templateSelect || !templateSelect.value) {
                    alert('请先选择一个模板');
                    return;
                }

                const selectedTemplateId = templateSelect.value;
                const selectedTemplateName = templateSelect.options[templateSelect.selectedIndex].text;
                const currentContent = document.querySelector('#cfs-custom-prompt-new').value;

                // 检查是否为默认模板
                const isDefaultTemplate = selectedTemplateId === 'character_feature_replace';

                const modal = document.createElement('div');
                modal.className = 'cfs-edit-template-modal';
                modal.innerHTML = `
                    <div class="cfs-modal-content">
                        <h4>${t('editTemplateTitle')}</h4>
                        <label>${t('templateName')}</label>
                        <input type="text" id="cfs-edit-template-name" placeholder="${t('templateName')}" 
                               value="${selectedTemplateName}" ${isDefaultTemplate ? 'readonly style="background-color: #1a1a1a; cursor: not-allowed;"' : ''}>
                        ${isDefaultTemplate ? `<p style="color: #888; font-size: 12px; margin: 4px 0;">${t('cannotEditDefaultTemplate')}</p>` : ''}
                        <label>${t('templateContent')}</label>
                        <textarea id="cfs-edit-template-content" rows="6" placeholder="${t('customPrompt')}">${currentContent}</textarea>
                        <div class="cfs-modal-buttons">
                            <button id="cfs-save-edit-template">${t('save')}</button>
                            ${!isDefaultTemplate ? `<button id="cfs-delete-template" style="background-color: #d32f2f; margin-left: 8px;">${t('deleteTemplate')}</button>` : ''}
                            <button id="cfs-cancel-edit-template">${t('close')}</button>
                        </div>
                    </div>
                `;
                
                document.body.appendChild(modal);
                
                // 关闭按钮
                modal.querySelector('#cfs-cancel-edit-template').onclick = () => modal.remove();
                
                // 保存按钮
                modal.querySelector('#cfs-save-edit-template').onclick = async () => {
                    const name = modal.querySelector('#cfs-edit-template-name').value.trim();
                    const content = modal.querySelector('#cfs-edit-template-content').value.trim();
                    
                    if (!name) {
                        alert(t('templateNameRequired'));
                        return;
                    }
                    
                    if (!content || !content.includes('{original_prompt}')) {
                        alert('模板内容必须包含 {original_prompt} 占位符');
                        return;
                    }
                    
                    try {
                        // 获取当前设置
                        const response = await api.fetchApi('/zml/ai/llm_settings');
                        const settings = response.ok ? await response.json() : {};
                        
                        if (!settings.prompt_templates) settings.prompt_templates = {};
                        
                        // 更新模板
                        if (isDefaultTemplate) {
                            // 只更新默认模板的内容，不更新名称
                            settings.prompt_templates[selectedTemplateId] = {
                                ...settings.prompt_templates[selectedTemplateId],
                                content: content
                            };
                        } else {
                            // 更新自定义模板的名称和内容
                            settings.prompt_templates[selectedTemplateId] = {
                                name_zh: name,
                                name_en: name,
                                content: content
                            };
                        }
                        
                        // 保存设置
                        const saveResponse = await api.fetchApi('/zml/ai/llm_settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(settings)
                        });
                        
                        if (saveResponse.ok) {
                            showToast(t('settingsSaved'), 'success');
                            modal.remove();
                            
                            // 刷新设置对话框中的模板列表
                            if (!isDefaultTemplate) {
                                const option = templateSelect.options[templateSelect.selectedIndex];
                                option.textContent = name;
                            }
                            
                            // 更新文本域内容
                            const textArea = document.querySelector('#cfs-custom-prompt-new');
                            if (textArea) textArea.value = content;
                        } else {
                            throw new Error('保存失败');
                        }
                    } catch (error) {
                        showToast(t('saveFailed') + error.message, 'error');
                    }
                };
                
                // 删除按钮事件处理
                if (!isDefaultTemplate) {
                    const deleteButton = modal.querySelector('#cfs-delete-template');
                    if (deleteButton) {
                        deleteButton.addEventListener('click', async (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            
                            console.log('删除按钮被点击，模板ID:', selectedTemplateId, '模板名称:', selectedTemplateName);
                            
                            // 显示确认对话框
                            const confirmMessage = t('deleteTemplateConfirm').replace('{templateName}', selectedTemplateName);
                            if (!confirm(confirmMessage)) {
                                console.log('用户取消删除操作');
                                return;
                            }
                            
                            console.log('用户确认删除，开始执行删除操作');
                            
                            try {
                                // 显示加载状态
                                deleteButton.disabled = true;
                                deleteButton.textContent = '删除中...';
                                
                                // 获取当前设置
                                console.log('正在获取当前设置...');
                                const response = await api.fetchApi('/zml/ai/llm_settings');
                                console.log('获取设置响应状态:', response.status);
                                
                                if (!response.ok) {
                                    throw new Error('无法获取当前设置');
                                }
                                
                                const settings = await response.json();
                                console.log('当前设置:', settings);
                                
                                if (!settings.prompt_templates) {
                                    settings.prompt_templates = {};
                                }
                                
                                console.log('删除前的模板列表:', Object.keys(settings.prompt_templates));
                                
                                // 检查模板是否存在
                                if (!settings.prompt_templates[selectedTemplateId]) {
                                    console.warn('模板不存在:', selectedTemplateId);
                                    showToast('模板不存在或已被删除', 'warning');
                                    modal.remove();
                                    return;
                                }
                                
                                // 删除模板
                                delete settings.prompt_templates[selectedTemplateId];
                                console.log('删除后的模板列表:', Object.keys(settings.prompt_templates));
                                
                                // 保存设置
                                console.log('正在保存更新后的设置...');
                                const saveResponse = await api.fetchApi('/zml/ai/llm_settings', {
                                    method: 'POST',
                                    headers: { 
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify(settings)
                                });
                                
                                console.log('保存响应状态:', saveResponse.status);
                                
                                if (saveResponse.ok) {
                                    console.log('模板删除成功');
                                    showToast(t('templateDeleted'), 'success');
                                    
                                    // 关闭模态框
                                    modal.remove();
                                    
                                    // 从下拉列表中移除该选项
                                    const templateSelect = document.querySelector('#cfs-prompt-template-select');
                                    if (templateSelect) {
                                        const optionToRemove = Array.from(templateSelect.options).find(option => option.value === selectedTemplateId);
                                        if (optionToRemove) {
                                            console.log('从下拉列表中移除选项:', selectedTemplateId);
                                            optionToRemove.remove();
                                        }
                                        
                                        // 选择默认模板
                                        templateSelect.value = 'character_feature_replace';
                                        templateSelect.dispatchEvent(new Event('change'));
                                        console.log('切换到默认模板');
                                    }
                                    
                                    // 更新文本域内容为完整的默认模板内容
                                    const textArea = document.querySelector('#cfs-custom-prompt-new');
                                    if (textArea) {
                                        // 使用完整的默认模板内容，而不是简化的占位符
                                        const defaultContent = DEFAULT_TEMPLATES[currentLanguage];
                                        textArea.value = defaultContent;
                                    }
                                    
                                } else {
                                    const errorText = await saveResponse.text();
                                    console.error('保存失败:', errorText);
                                    throw new Error('保存失败: ' + errorText);
                                }
                                
                            } catch (error) {
                                console.error('删除模板时发生错误:', error);
                                showToast(t('deleteFailed') + ': ' + error.message, 'error');
                                
                                // 恢复按钮状态
                                deleteButton.disabled = false;
                                deleteButton.textContent = t('deleteTemplate');
                            }
                        });
                    }
                }
            }

            // --- 新的设置对话框 ---
            function createNewSettingsDialog(node) {
                // Prevent multiple dialogs
                if (document.querySelector(".cfs-new-settings-dialog")) {
                    return;
                }

                const dialog = document.createElement("div");
                dialog.className = "cfs-new-settings-dialog";

                // Initial structure, texts will be populated by updateUITexts
                dialog.innerHTML = `
        <div class="cfs-new-settings-content">
            <div class="cfs-new-settings-sidebar">
                <button class="cfs-new-settings-tab active" data-tab="language" data-i18n="language"></button>
                <button class="cfs-new-settings-tab" data-tab="prompt" data-i18n="prompt"></button>
                <button class="cfs-new-settings-tab" data-tab="llm" data-i18n="llm"></button>
            </div>
            <div class="cfs-new-settings-main">
                <div class="cfs-new-settings-pane active" data-pane="language">
                    <h3 data-i18n="languageSettings"></h3>
                    <div id="cfs-language-options"></div>
                </div>
                <div class="cfs-new-settings-pane" data-pane="prompt">
                    <h3 data-i18n="promptSettings"></h3>
                    <div class="cfs-template-actions" style="display:flex; gap:8px; margin-bottom:8px;">
                        <button id="cfs-add-template-btn" data-i18n="addTemplate"></button>
                        <button id="cfs-edit-template-btn" data-i18n="editTemplate"></button>
                        <button id="cfs-restore-default-btn" data-i18n="restoreSystemTemplate"></button>
                    </div>
                    <label for="cfs-prompt-template-select" data-i18n="promptTemplate"></label>
                    <select id="cfs-prompt-template-select" name="prompt_template" style="margin-bottom: 8px; width: 100%; padding: 8px; box-sizing: border-box; background-color: #222; border: 1px solid #555; color: #E0E0E0; border-radius: 4px;"></select>
                    <label for="cfs-custom-prompt-new" data-i18n="customPrompt"></label>
                    <textarea id="cfs-custom-prompt-new" name="custom_prompt" rows="10" readonly style="background-color: #1a1a1a; cursor: not-allowed;"></textarea>
                    <p class="description" data-i18n="promptPlaceholder" data-i18n-html></p>
                </div>
                <div class="cfs-new-settings-pane" data-pane="llm">
                     <h3 data-i18n="llmSettings"></h3>
                     <p data-i18n="llmDescription" data-i18n-html></p>
                     <label for="cfs-api-channel-new" data-i18n="channel"></label>
                      <select id="cfs-api-channel-new" name="api_channel" style="margin-bottom: 12px; width: 100%; padding: 8px; box-sizing: border-box; background-color: #222; border: 1px solid #555; color: #E0E0E0; border-radius: 4px;">
                          <option value="openrouter">OpenRouter</option>
                          <option value="gemini_api">Gemini API</option>
                          <option value="gemini_cli">Gemini CLI</option>
                          <option value="deepseek">DeepSeek</option>
                          <option value="openai_compatible">OpenAI Compatible</option>
                      </select>
                     <label for="cfs-api-url-new" data-i18n="apiUrl"></label>
                     <input type="text" id="cfs-api-url-new" name="api_url">
                     <div id="cfs-api-url-placeholder" class="cfs-input-placeholder" style="display: none;">不需要</div>
                     <label for="cfs-api-key-new" data-i18n="apiKey"></label>
                     <input type="password" id="cfs-api-key-new" name="api_key">
                     <div id="cfs-api-key-placeholder" class="cfs-input-placeholder" style="display: none;">不需要</div>
                     <label for="cfs-model-new" data-i18n="model"></label>
                     <div class="cfs-custom-select-wrapper">
                         <div id="cfs-model-selected" class="cfs-custom-select-selected" tabindex="0"></div>
                         <div id="cfs-model-items" class="cfs-custom-select-items cfs-select-hide">
                             <input type="text" id="cfs-model-search-input" data-i18n-placeholder="search">
                             <div id="cfs-model-options"></div>
                         </div>
                     </div>
                     <select id="cfs-model-new" name="model" style="display: none;"></select>
                     <div class="cfs-llm-test-buttons">
                        <button id="cfs-get-models-btn" data-i18n="getModels"></button>
                        <button id="cfs-test-connection-btn" data-i18n="testConnection"></button>
                        <button id="cfs-test-response-btn" data-i18n="testResponse"></button>
                    </div>
                     <div class="cfs-timeout-container">
                        <label for="cfs-timeout-new" data-i18n="timeout"></label>
                        <input type="number" id="cfs-timeout-new" name="timeout" min="1" max="300">
                     </div>
                     <p class="description" data-i18n="timeoutHint"></p>
                </div>
            </div>
        </div>
        <div class="cfs-new-settings-buttons">
            <div>
                <button id="cfs-save-new-settings" data-i18n="save"></button>
                <button id="cfs-close-new-dialog" data-i18n="close"></button>
            </div>
        </div>
    `;

                document.body.appendChild(dialog);

                function updateUITexts() {
                    dialog.querySelectorAll("[data-i18n]").forEach(el => {
                        const key = el.dataset.i18n;
                        if (el.hasAttribute("data-i18n-html")) {
                            el.innerHTML = t(key);
                        } else {
                            el.textContent = t(key);
                        }
                    });
                    dialog.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
                        const key = el.dataset.i18nPlaceholder;
                        el.placeholder = t(key);
                    });

                    // 社交按钮已移除
                }

                // Tab switching logic
                const tabs = dialog.querySelectorAll(".cfs-new-settings-tab");
                const panes = dialog.querySelectorAll(".cfs-new-settings-pane");

                tabs.forEach(tab => {
                    tab.addEventListener("click", () => {
                        const targetPane = tab.dataset.tab;

                        tabs.forEach(t => t.classList.remove("active"));
                        tab.classList.add("active");

                        panes.forEach(p => {
                            p.classList.remove("active");
                            if (p.dataset.pane === targetPane) {
                                p.classList.add("active");
                            }
                        });
                    });
                });

                // Close button
                dialog.querySelector("#cfs-close-new-dialog").addEventListener("click", () => {
                    const ui = nodeUIs.get(node);
                    if (ui) {
                        // 当关闭对话框时，使用当前选择的渠道重新检查连接状态
                        // 当关闭对话框时，使用UI上当前的值来检查连接状态
                        const currentUIConfig = {
                            api_channel: apiChannelSelect.value,
                            api_url: apiUrlInput.value,
                            api_key: apiKeyInput.value,
                            timeout: parseInt(timeoutInput.value, 10) || 60
                        };
                        // 传递一个临时的、包含当前UI值的settings对象
                        const tempSettingsForCheck = {
                            ...node.cfs_settings,
                            api_channel: currentUIConfig.api_channel,
                            timeout: currentUIConfig.timeout,
                            channels_config: {
                                ...(node.cfs_settings.channels_config || {}),
                                [currentUIConfig.api_channel]: {
                                    api_url: currentUIConfig.api_url,
                                    api_key: currentUIConfig.api_key
                                }
                            }
                        };
                        checkConnectionStatus(ui, tempSettingsForCheck);
                    }
                    dialog.remove();
                });

                // 社交按钮已移除

                // --- Load and Save Logic ---
                const apiChannelSelect = dialog.querySelector("#cfs-api-channel-new");
                const apiUrlInput = dialog.querySelector("#cfs-api-url-new");
                const apiKeyInput = dialog.querySelector("#cfs-api-key-new");
                const modelInput = dialog.querySelector("#cfs-model-new");
                const customPromptInput = dialog.querySelector("#cfs-custom-prompt-new");
                const promptTemplateSelect = dialog.querySelector('#cfs-prompt-template-select');
                const timeoutInput = dialog.querySelector("#cfs-timeout-new");
                const apiUrlLabel = dialog.querySelector('label[for="cfs-api-url-new"]');
                const apiKeyLabel = dialog.querySelector('label[for="cfs-api-key-new"]');
                const apiUrlPlaceholder = dialog.querySelector('#cfs-api-url-placeholder');
                const apiKeyPlaceholder = dialog.querySelector('#cfs-api-key-placeholder');

                // --- Custom Searchable Select Logic ---
                const wrapper = dialog.querySelector(".cfs-custom-select-wrapper");
                const selectedDisplay = dialog.querySelector("#cfs-model-selected");
                const itemsContainer = dialog.querySelector("#cfs-model-items");
                const searchInput = dialog.querySelector("#cfs-model-search-input");
                const optionsContainer = dialog.querySelector("#cfs-model-options");
                const hiddenSelect = modelInput; // modelInput is the original, now hidden, select
                const originalParent = itemsContainer.parentNode;

                let allModels = [];

                async function fetchAndPopulateModels(force = false, silent = false) {
                    if (allModels.length > 0 && !force) {
                        return Promise.resolve();
                    }

                    if (!silent) {
                        showToast(t('loadingModels'), 'info', 2000);
                    }

                    try {
                        const selectedChannel = apiChannelSelect.value;
                        // 在获取模型之前，我们先将当前的api_key保存到节点的临时设置中
                        // 这样后端就能从settings文件中读取到正确的key
                        const tempSettings = {
                            ...node.cfs_settings,
                            api_channel: selectedChannel,
                            channels_config: {
                                ...(node.cfs_settings.channels_config || {}),
                                [selectedChannel]: {
                                    api_url: apiUrlInput.value,
                                    api_key: apiKeyInput.value
                                }
                            }
                        };

                        // 先进行一次静默保存
                        await api.fetchApi("/zml/ai/llm_settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(tempSettings),
                        });

                        // 现在后端可以从保存的设置中获取正确的凭据
                        const response = await api.fetchApi("/zml/ai/llm_models", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ api_channel: selectedChannel }),
                        });

                        if (!response.ok) {
                            const err = await response.json();
                            throw new Error(err.error || 'Unknown error');
                        }

                        const models = await response.json();
                        allModels = models;
                        updateOptions();

                        // Keep current selection, just show a success message
                        // testResultDiv.textContent = t('modelsRefreshed');
                        // testResultDiv.style.color = '#8BC34A';
                        showToast(t('modelsRefreshed'), 'success');

                    } catch (error) {
                        console.error("Failed to load LLM models:", error);
                        // Don't change the selection text on error
                        allModels = [];
                        updateOptions();
                        showToast(`${t('errorLoadingModels')}: ${error.message}`, 'error');
                    }
                }

                function fuzzySearch(needle, haystack) {
                    const h = haystack.toLowerCase();
                    const n = needle.toLowerCase().replace(/\s/g, '');
                    if (n === "") return true;
                    let n_idx = 0;
                    let h_idx = 0;
                    while (n_idx < n.length && h_idx < h.length) {
                        if (h[h_idx] === n[n_idx]) {
                            n_idx++;
                        }
                        h_idx++;
                    }
                    return n_idx === n.length;
                }

                function updateOptions(filter = "") {
                    optionsContainer.innerHTML = "";
                    const filtered = allModels.filter(m => fuzzySearch(filter, m));

                    filtered.forEach(modelId => {
                        const opt = document.createElement("div");
                        opt.dataset.value = modelId;
                        opt.textContent = modelId;
                        if (modelId === hiddenSelect.value) {
                            opt.classList.add("selected");
                        }
                        optionsContainer.appendChild(opt);
                    });
                }

                function closeDropdown() {
                    if (!itemsContainer.classList.contains("cfs-select-hide")) {
                        itemsContainer.classList.add("cfs-select-hide");
                        // Crucially, move it back to the dialog so it's not orphaned
                        originalParent.appendChild(itemsContainer);
                    }
                }

                selectedDisplay.addEventListener("click", (e) => {
                    e.stopPropagation();

                    if (itemsContainer.classList.contains("cfs-select-hide")) {
                        const openDropdown = () => {
                            // Move to body to break out of stacking context
                            document.body.appendChild(itemsContainer);

                            // Position it
                            const rect = selectedDisplay.getBoundingClientRect();
                            itemsContainer.style.top = `${rect.bottom + 2}px`;
                            itemsContainer.style.left = `${rect.left}px`;
                            itemsContainer.style.width = `${rect.width}px`;

                            itemsContainer.classList.remove("cfs-select-hide");

                            updateOptions();
                            searchInput.value = "";
                            searchInput.focus();
                        };

                        // Always try to fetch, the function itself will handle caching
                        fetchAndPopulateModels(false, false).then(() => {
                            openDropdown();
                        });
                    } else {
                        closeDropdown();
                    }
                });

                searchInput.addEventListener("input", () => updateOptions(searchInput.value));
                searchInput.addEventListener("click", e => e.stopPropagation());

                optionsContainer.addEventListener("click", (e) => {
                    if (e.target.dataset.value) {
                        e.stopPropagation();
                        hiddenSelect.value = e.target.dataset.value;
                        selectedDisplay.textContent = e.target.dataset.value;
                        closeDropdown();
                    }
                });

                // Close dropdown when clicking outside
                document.addEventListener("click", (e) => {
                    if (!itemsContainer.contains(e.target) && !selectedDisplay.contains(e.target)) {
                        closeDropdown();
                    }
                });

                // --- Load Models and Settings ---
                function loadSettings() {
                    api.fetchApi("/zml/ai/llm_settings")
                        .then(response => response.json())
                        .then(settings => {
                            currentLanguage = settings.language || 'zh';
                            updateUITexts(); // Update UI text first

                            node.cfs_settings = settings; // 缓存最新的设置
                            const savedChannel = settings.api_channel || 'openrouter';
                            const channelsConfig = settings.channels_config || {};

                            timeoutInput.value = settings.timeout || 60;
                            apiChannelSelect.value = savedChannel;

                            // 根据渠道更新UI
                            updateUIForChannel(savedChannel, channelsConfig);

                            // 初始化模板选项：合并后端模板列表与系统默认
                            const templates = [];
                            let backendTemplates = (settings.prompt_templates && typeof settings.prompt_templates === 'object') ? settings.prompt_templates : {};
                            
                            // 从新的templates字段读取模板内容
                            const savedTemplateContents = settings.templates || {};
                            
                            // 合并本地暂存模板（如果此前保存失败而被暂存）
                            try {
                                const pendingStr = localStorage.getItem('zml_pending_templates');
                                if (pendingStr) {
                                    const pending = JSON.parse(pendingStr);
                                    if (pending && typeof pending === 'object') {
                                        backendTemplates = { ...backendTemplates, ...pending };
                                        // 尝试同步到后端，并在成功后清除暂存
                                        const mergedSettings = { ...settings, prompt_templates: backendTemplates };
                                        api.fetchApi('/zml/ai/llm_settings', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(mergedSettings),
                                        }).then(res => {
                                            if (res.ok) {
                                                localStorage.removeItem('zml_pending_templates');
                                            }
                                        }).catch(() => {});
                                    }
                                }
                            } catch (e) { /* ignore */ }
                            const ensureTpl = (id, zh, en, content) => {
                                // 优先使用savedTemplateContents中的内容
                                const savedContent = savedTemplateContents[id];
                                templates.push({ id, zh, en, value: savedContent || content });
                            };
                            // 系统默认（语言双版本）- 先用简化版本初始化
                            ensureTpl('character_feature_replace', '默认-人物特征替换', '默认-Character Feature Replace', DEFAULT_TEMPLATES[currentLanguage]);
                            
                            // 用户模板列表
                            Object.keys(backendTemplates).forEach(id => {
                                const tpl = backendTemplates[id];
                                const zhName = tpl.name_zh || id;
                                const enName = tpl.name_en || id;
                                const content = tpl.content || '';
                                // 如果是系统默认ID，覆盖内容为后端的，名称保持国际化
                                if (id === 'character_feature_replace') {
                                    // 优先使用savedTemplateContents中的内容，其次是tpl.content，最后是默认值
                                    const savedContent = savedTemplateContents[id];
                                    templates[0].value = savedContent || content || templates[0].value;
                                } else {
                                    ensureTpl(id, zhName, enName, content);
                                }
                            });
                            
                            // 确保默认模板有完整内容：如果后端没有提供默认模板，使用后端定义的完整内容
                            if (!backendTemplates['character_feature_replace'] && templates[0]) {
                                // 从后端获取默认模板的完整内容
                                const defaultTemplate = settings.prompt_templates && settings.prompt_templates['character_feature_replace'];
                                if (defaultTemplate && defaultTemplate.content) {
                                    templates[0].value = savedTemplateContents['character_feature_replace'] || defaultTemplate.content;
                                }
                            }

                            promptTemplateSelect.innerHTML = '';
                            templates.forEach(tpl => {
                                const opt = document.createElement('option');
                                opt.value = tpl.id;
                                opt.textContent = currentLanguage === 'zh' ? tpl.zh : tpl.en;
                                promptTemplateSelect.appendChild(opt);
                            });
                            // 优先使用当前选中模板内容作为文本域初值
                            let prompt = settings.custom_prompt;
                            // 仅当缺少必要占位符时才回退到默认模板，允许中文/自定义标题
                            const hasPlaceholders = (
                                typeof prompt === 'string' &&
                                prompt.includes('{original_prompt}')
                            );
                            if (!hasPlaceholders) {
                                // 如果选中模板存在且有内容，则使用选中模板内容
                                const selId = settings.prompt_template_id || 'character_feature_replace';
                                // 优先从savedTemplateContents读取，其次从prompt_templates读取
                                const savedContent = savedTemplateContents[selId];
                                const selTpl = (settings.prompt_templates && settings.prompt_templates[selId]) ? settings.prompt_templates[selId] : null;
                                if (savedContent) {
                                    prompt = savedContent;
                                } else if (selTpl && selTpl.content) {
                                    prompt = selTpl.content;
                                } else {
                                    // 最后回退：对于默认模板，尝试从templates数组中获取已设置的完整内容
                                    const defaultTpl = templates.find(t => t.id === selId);
                                    if (defaultTpl && defaultTpl.value && !Object.values(DEFAULT_TEMPLATES).includes(defaultTpl.value)) {
                                        prompt = defaultTpl.value;
                                    } else {
                                        prompt = DEFAULT_TEMPLATES[currentLanguage];
                                    }
                                }
                            }
                            customPromptInput.value = prompt;

                            // 根据已有设置选中模板ID（如果存在），否则默认第一个
                            const tplId = settings.prompt_template_id || 'character_feature_replace';
                            promptTemplateSelect.value = tplId;

                            // 模板选择联动：选择后重置文本域为对应模板内容
                            promptTemplateSelect.onchange = () => {
                                // 先保存当前模板的内容
                                const currentTplId = promptTemplateSelect.dataset.currentTemplate || 'character_feature_replace';
                                const currentIdx = templates.findIndex(t => t.id === currentTplId);
                                if (currentIdx >= 0) {
                                    templates[currentIdx].value = customPromptInput.value;
                                    // 实时保存到后端
                                    Utils.saveCurrentTemplateContent(currentTplId, customPromptInput.value);
                                }
                                
                                // 切换到新模板
                                const selected = templates.find(t => t.id === promptTemplateSelect.value) || templates[0];
                                // 优先使用模板的value，如果为空且是默认模板，则使用后端内容，最后才使用简化版本
                                let v = selected.value;
                                if (!v && selected.id === 'character_feature_replace') {
                                    // 对于默认模板，如果没有内容，尝试从后端获取
                                    const backendTemplate = backendTemplates['character_feature_replace'];
                                    v = backendTemplate ? backendTemplate.content : DEFAULT_TEMPLATES[currentLanguage];
                                } else if (!v) {
                                    // 对于其他模板，使用简化版本作为最后回退
                                    v = DEFAULT_TEMPLATES[currentLanguage];
                                }
                                customPromptInput.value = v;
                                promptTemplateSelect.dataset.currentTemplate = promptTemplateSelect.value;
                            };

                            // 设置初始当前模板标记
                            promptTemplateSelect.dataset.currentTemplate = tplId;

                            // 文本域实时更新：修改时同步当前选中模板的内容到缓存和后端
                            customPromptInput.addEventListener('input', Utils.debounce(() => {
                                const selId = promptTemplateSelect.value || 'character_feature_replace';
                                const idx = templates.findIndex(t => t.id === selId);
                                if (idx >= 0) {
                                    templates[idx].value = customPromptInput.value;
                                    // 实时保存到后端
                                    Utils.saveCurrentTemplateContent(selId, customPromptInput.value);
                                }
                            }, 500));

                            // 加载当前渠道的模型
                            const channelModels = settings.channel_models || {};
                            const currentModel = channelModels[savedChannel] || "";
                            hiddenSelect.value = currentModel;
                            selectedDisplay.textContent = currentModel || t('selectModel');

                            // Create language buttons
                            const langOptionsContainer = dialog.querySelector("#cfs-language-options");
                            langOptionsContainer.innerHTML = '';
                            const zhButton = document.createElement("button");
                            zhButton.textContent = "中文";
                            zhButton.className = `cfs-language-button ${currentLanguage === 'zh' ? 'active' : ''}`;
                            zhButton.onclick = () => handleLanguageChange('zh', settings);

                            const enButton = document.createElement("button");
                            enButton.textContent = "English";
                            enButton.className = `cfs-language-button ${currentLanguage === 'en' ? 'active' : ''}`;
                            enButton.onclick = () => handleLanguageChange('en', settings);

                            langOptionsContainer.appendChild(zhButton);
                            langOptionsContainer.appendChild(enButton);

                            // Pre-fetch models silently when the dialog opens
                            fetchAndPopulateModels(false, true);
                        });
                }

                function handleLanguageChange(lang, currentSettings) {
                    if (lang === currentLanguage) return;

                    const newSettings = { ...currentSettings, language: lang };

                    api.fetchApi("/zml/ai/llm_settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(newSettings),
                    }).then(response => {
                        if (response.ok) {
                            currentLanguage = lang; // 更新当前语言
                            updateAllNodeUIs(); // 更新所有节点的UI
                            dialog.remove();
                            createNewSettingsDialog(node); // 使用新语言重新创建对话框
                        } else {
                            alert("Failed to save language setting.");
                        }
                    });
                }

                // --- LLM Testing Logic ---
                const getModelsBtn = dialog.querySelector("#cfs-get-models-btn");
                const testConnectionBtn = dialog.querySelector("#cfs-test-connection-btn");
                const testResponseBtn = dialog.querySelector("#cfs-test-response-btn");

                getModelsBtn.addEventListener("click", () => {
                    fetchAndPopulateModels(true, false); // Force refresh, not silent
                });

                testConnectionBtn.addEventListener("click", async () => {
                    showToast(t('testing'), 'info', 2000);
                    testConnectionBtn.disabled = true;
                    testResponseBtn.disabled = true;

                    try {
                        const settingsPayload = {
                            api_channel: apiChannelSelect.value,
                            api_url: apiUrlInput.value,
                            api_key: apiKeyInput.value,
                            model: selectedDisplay.textContent,
                            timeout: parseInt(timeoutInput.value, 10) || 60,
                        };
                        const timeout = settingsPayload.timeout * 1000;

                        const response = await Utils.fetchWithTimeout(
                            api.api_base + "/zml/ai/test_llm_connection",
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(settingsPayload),
                            },
                            timeout
                        );

                        const result = await response.json();
                        if (response.ok && result.success) {
                            showToast(t('connectionSuccess'), 'success');
                        } else {
                            throw new Error(result.error || 'Unknown error');
                        }
                    } catch (error) {
                        let errorMessage = error.message;
                        if (error.name === 'AbortError') {
                            errorMessage = `请求超时（${(parseInt(timeoutInput.value, 10) || 60)}秒）`;
                        }
                        showToast(`${t('connectionFailed')} ${errorMessage}`, 'error');
                    } finally {
                        testConnectionBtn.disabled = false;
                        testResponseBtn.disabled = false;
                    }
                });

                testResponseBtn.addEventListener("click", async () => {
                    showToast(t('testing'), 'info', 2000);
                    testConnectionBtn.disabled = true;
                    testResponseBtn.disabled = true;

                    try {
                        const settingsPayload = {
                            api_channel: apiChannelSelect.value,
                            api_url: apiUrlInput.value,
                            api_key: apiKeyInput.value,
                            model: selectedDisplay.textContent,
                            timeout: parseInt(timeoutInput.value, 10) || 60,
                        };
                        const timeout = settingsPayload.timeout * 1000;

                        const response = await Utils.fetchWithTimeout(
                            api.api_base + "/zml/ai/test_llm_response",
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(settingsPayload),
                            },
                            timeout
                        );

                        const result = await response.json();
                        if (response.ok && result.success) {
                            showToast(result.message, 'success');
                        } else {
                            throw new Error(result.error || 'Unknown error');
                        }
                    } catch (error) {
                        let errorMessage = error.message;
                        if (error.name === 'AbortError') {
                            errorMessage = `请求超时（${(parseInt(timeoutInput.value, 10) || 60)}秒）`;
                        }
                        showToast(`${t('responseFailed')} ${errorMessage}`, 'error');
                    } finally {
                        testConnectionBtn.disabled = false;
                        testResponseBtn.disabled = false;
                    }
                });

                loadSettings();

                // --- Channel Switch Logic ---
                function updateUIForChannel(channel, config) {
                    const channelConf = config[channel] || {};
                    const url = channelConf.api_url || "";
                    const key = channelConf.api_key || "";

                    apiUrlInput.value = url;
                    apiKeyInput.value = key;

                    // Reset to default state first
                    apiUrlInput.style.display = '';
                    apiUrlLabel.style.display = '';
                    apiUrlPlaceholder.style.display = 'none';
                    apiUrlInput.disabled = false;
                    apiUrlInput.readOnly = false;

                    apiKeyInput.style.display = '';
                    apiKeyLabel.style.display = '';
                    apiKeyPlaceholder.style.display = 'none';
                    apiKeyInput.disabled = false;

                    if (channel === 'gemini_cli') {
                        apiUrlInput.style.display = 'none';
                        apiUrlLabel.style.display = 'none';
                        apiUrlPlaceholder.style.display = 'block';

                        apiKeyInput.style.display = 'none';
                        apiKeyLabel.style.display = 'none';
                        apiKeyPlaceholder.style.display = 'block';
                    } else if (url && (channel !== 'openai_compatible')) {
                        apiUrlInput.readOnly = true;
                    }
                }

                apiChannelSelect.addEventListener("change", (e) => {
                    const selectedChannel = e.target.value;
                    const channelsConfig = node.cfs_settings.channels_config || {};

                    // 更新UI显示
                    updateUIForChannel(selectedChannel, channelsConfig);

                    // 加载并设置新渠道的模型
                    fetchAndPopulateModels(true, false).then(() => {
                        const channelModels = node.cfs_settings.channel_models || {};
                        let newModel = channelModels[selectedChannel];

                        if (!newModel && allModels.length > 0) {
                            newModel = allModels[0];
                        }

                        hiddenSelect.value = newModel || "";
                        selectedDisplay.textContent = newModel || t('selectModel');
                    });
                });

                // Save settings
                dialog.querySelector("#cfs-save-new-settings").addEventListener("click", async () => {
                    const selectedChannel = apiChannelSelect.value;

                    // 1. 复制现有设置
                    const newSettings = JSON.parse(JSON.stringify(node.cfs_settings || {}));

                    // 2. 更新顶层设置
                    newSettings.api_channel = selectedChannel;
                    newSettings.timeout = parseInt(timeoutInput.value, 10) || 60;
                    // 移除 custom_prompt 的保存，因为提示词内容在修改模板里面进行
                    // newSettings.custom_prompt = customPromptInput.value;
                    const currentTplId = promptTemplateSelect.value || 'character_feature_replace';
                    newSettings.prompt_template_id = currentTplId;
                    
                    // 将模板列表写入设置（保留原有用户模板）
                    const prevTemplates = (newSettings.prompt_templates && typeof newSettings.prompt_templates === 'object') ? newSettings.prompt_templates : {};
                    // 同步当前所有模板内容
                    templates.forEach(tpl => {
                        prevTemplates[tpl.id] = {
                            name_zh: tpl.zh,
                            name_en: tpl.en,
                            content: tpl.value || ''
                        };
                    });
                    newSettings.prompt_templates = prevTemplates;
                    
                    // 保存所有模板的实际内容到新的templates字段
                    if (!newSettings.templates) newSettings.templates = {};
                    templates.forEach(tpl => {
                        newSettings.templates[tpl.id] = tpl.value || '';
                    });
                    
                    newSettings.language = currentLanguage;

                    // 3. 更新分渠道配置
                    if (!newSettings.channels_config) newSettings.channels_config = {};
                    newSettings.channels_config[selectedChannel] = {
                        api_url: (selectedChannel === 'gemini_cli') ? "gemini_cli_mode" : apiUrlInput.value,
                        api_key: (selectedChannel === 'gemini_cli') ? "" : apiKeyInput.value,
                    };

                    // 4. 更新分渠道模型
                    if (!newSettings.channel_models) newSettings.channel_models = {};
                    newSettings.channel_models[selectedChannel] = selectedDisplay.textContent;


                    try {
                        const response = await api.fetchApi("/zml/ai/llm_settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(newSettings),
                        });

                        if (response.ok) {
                            node.cfs_settings = newSettings; // 更新节点上的缓存
                            showToast(t('settingsSaved'), 'success');


                            const ui = nodeUIs.get(node);
                            if (ui) {
                                checkConnectionStatus(ui, newSettings);
                            }
                        } else {
                            const error = await response.json();
                            throw new Error(error.error || response.statusText);
                        }
                    } catch (error) {
                        showToast(t('saveFailed') + error.message, 'error');
                    }
                });

                // --- 增加模板功能（简化版） ---
                const addTplBtn = dialog.querySelector('#cfs-add-template-btn');
                addTplBtn.addEventListener('click', () => {
                    showAddTemplateDialog();
                });

                // --- 修改模板功能 ---
                const editTplBtn = dialog.querySelector('#cfs-edit-template-btn');
                editTplBtn.addEventListener('click', () => {
                    showEditTemplateDialog();
                });

                // --- 一键恢复系统默认模板 ---
                const restoreBtn = dialog.querySelector('#cfs-restore-default-btn');
                restoreBtn.addEventListener('click', async () => {
                    if (!confirm(t('restoreConfirm'))) return;
                    try {
                        // 使用全局定义的默认模板内容
                        
                        const current = JSON.parse(JSON.stringify(node.cfs_settings || {}));
                        const prevTemplates = (current.prompt_templates && typeof current.prompt_templates === 'object') ? current.prompt_templates : {};
                        // 仅重置系统默认模板内容
                        prevTemplates['character_feature_replace'] = {
                            name_zh: '默认-人物特征替换',
                            name_en: 'Default-Character Feature Replace',
                            content: DEFAULT_TEMPLATES[currentLanguage]
                        };
                        current.prompt_templates = prevTemplates;
                        // 若当前选中的是系统模板，则同步到文本域显示
                        if ((promptTemplateSelect.value || 'character_feature_replace') === 'character_feature_replace') {
                            customPromptInput.value = DEFAULT_TEMPLATES[currentLanguage];
                        }

                        const response = await api.fetchApi('/zml/ai/llm_settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(current),
                        });
                        if (response.ok) {
                            showToast(t('restoreSuccess'), 'success');
                            // 刷新设置以更新UI
                            loadSettings();
                        } else {
                            const err = await response.json();
                            throw new Error(err.error || response.statusText);
                        }
                    } catch (e) {
                        showToast(t('restoreFailed') + e.message, 'error');
                    }
                });
            }

            // --- 标签选择模态框 (已移除) ---

            // --- 帮助面板 ---
            function createHelpPanel() {
                // Prevent multiple panels
                if (document.querySelector(".cfs-help-panel")) {
                    return;
                }

                const panel = document.createElement("div");
                panel.className = "cfs-help-panel";

                const preContent = [
                    t('helpIntro'),
                    '',
                    `<strong>${t('helpWorkflowTitle')}</strong>`,
                    t('helpWorkflowStep1'),
                    t('helpWorkflowStep2'),
                    t('helpWorkflowStep3'),
                    '',
                    `<strong>${t('helpExampleTitle')}</strong>`,
                    `- original_prompt: 1girl, solo, long hair, blue eyes, school uniform, smile`,
        `- substitute_prompt: 1boy, short hair, green eyes, armor, serious`,
                    t('helpExampleCategories'),
                    t('helpExampleResult')
                ].join('\n');

                const content = `
        <div class="cfs-help-panel-content">
            <h2>${t('helpTitle')}</h2>
            <pre>${preContent}</pre>
            <button class="cfs-help-panel-close-button">${t('close')}</button>
        </div>
    `;

                panel.innerHTML = content;
                document.body.appendChild(panel);

                panel.querySelector(".cfs-help-panel-close-button").addEventListener("click", () => {
                    panel.remove();
                });

                // Also close when clicking the overlay
                panel.addEventListener("click", (e) => {
                    if (e.target === panel) {
                        panel.remove();
                    }
                });
            }

            const onNodeCreated_orig = nodeType.prototype.onNodeCreated; // Store original before overriding
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated_orig && onNodeCreated_orig !== nodeType.prototype.onNodeCreated) { // Prevent infinite recursion
                    onNodeCreated_orig.apply(this, arguments); // Call original if it exists
                }

                // 设置节点的最小尺寸
                this.min_size = [360, 260]; /* Adjusted height for message area */

                // --- 尺寸修复 ---
                // 存储原始的 computeSize 方法
                const originalComputeSize = this.computeSize;
                // 覆盖 computeSize 方法
                this.computeSize = () => {
                    // 调用原始的 computeSize
                    let size = originalComputeSize.apply(this, arguments);
                    // 确保尺寸不小于 min_size
                    if (this.min_size) {
                        size[0] = Math.max(this.min_size[0], size[0]);
                        size[1] = Math.max(this.min_size[1], size[1]);
                    }
                    return size;
                };

                // --- 隐藏 character_prompt 小部件 ---
                try {
                    const charWidgetIndex = this.widgets.findIndex(w => w.name === "character_prompt");
                    if (charWidgetIndex !== -1) {
                        const charWidget = this.widgets[charWidgetIndex];
                        charWidget.computeSize = () => [0, -4];
                        charWidget.draw = () => { };
                        charWidget.type = "hidden";
                    }
                } catch (e) {
                    console.warn("[ZML_Ai多功能助手] 隐藏 character_prompt 失败:", e);
                }

                // --- 尝试移除 character_prompt 输入端口（若仍存在） ---
                try {
                    // LiteGraph的输入存储在 this.inputs，元素可能是对象({name})或数组([name,type])
                    const findName = (i) => {
                        if (!i) return null;
                        if (typeof i === "object" && i.name) return i.name;
                        if (Array.isArray(i) && i.length > 0) return i[0];
                        return null;
                    };
                    const idx = Array.isArray(this.inputs) ? this.inputs.findIndex(i => findName(i) === "character_prompt") : -1;
                    if (idx >= 0) {
                        // 优先使用框架提供的移除方法
                        if (typeof this.removeInput === "function") {
                            this.removeInput(idx);
                        } else if (typeof this.removeInputSlot === "function") {
                            this.removeInputSlot(idx);
                        } else {
                            // 回退：直接修改内部数组，尽力保持一致
                            try {
                                this.inputs.splice(idx, 1);
                                if (Array.isArray(this.input_types)) this.input_types.splice(idx, 1);
                                if (Array.isArray(this.inputs_connections)) this.inputs_connections.splice(idx, 1);
                            } catch (innerErr) {
                                console.warn("[ZML_Ai多功能助手] 直接移除输入端口时发生错误:", innerErr);
                            }
                        }
                        // 刷新外观与尺寸
                        if (typeof this.setDirtyCanvas === "function") this.setDirtyCanvas(true, true);
                        if (typeof this.onResize === "function") this.onResize();
                    }
                } catch (e) {
                    console.warn("[ZML_Ai多功能助手] 移除 character_prompt 输入端口失败:", e);
                }

                // --- 兼容旧工作流加载：在被添加进图时也执行一次移除 ---
                try {
                    const onAdded_orig = nodeType.prototype.onAdded;
                    nodeType.prototype.onAdded = function () {
                        if (onAdded_orig && onAdded_orig !== nodeType.prototype.onAdded) {
                            onAdded_orig.apply(this, arguments);
                        }
                        try {
                            const findName = (i) => {
                                if (!i) return null;
                                if (typeof i === "object" && i.name) return i.name;
                                if (Array.isArray(i) && i.length > 0) return i[0];
                                return null;
                            };
                            const idx = Array.isArray(this.inputs) ? this.inputs.findIndex(i => findName(i) === "character_prompt") : -1;
                            if (idx >= 0) {
                                if (typeof this.removeInput === "function") {
                                    this.removeInput(idx);
                                } else if (typeof this.removeInputSlot === "function") {
                                    this.removeInputSlot(idx);
                                } else {
                                    try {
                                        this.inputs.splice(idx, 1);
                                        if (Array.isArray(this.input_types)) this.input_types.splice(idx, 1);
                                        if (Array.isArray(this.inputs_connections)) this.inputs_connections.splice(idx, 1);
                                    } catch (innerErr) {
                                        console.warn("[ZML_Ai多功能助手] onAdded: 直接移除输入端口时发生错误:", innerErr);
                                    }
                                }
                                if (typeof this.setDirtyCanvas === "function") this.setDirtyCanvas(true, true);
                                if (typeof this.onResize === "function") this.onResize();
                            }
                        } catch (err) {
                            console.warn("[ZML_Ai多功能助手] onAdded: 移除 character_prompt 失败:", err);
                        }
                    };
                } catch (e) {
                    console.warn("[ZML_Ai多功能助手] 安装 onAdded 钩子失败:", e);
                }

                // --- 兼容旧序列化：在配置反序列化时也尝试移除 ---
                try {
                    const onConfigure_orig = nodeType.prototype.onConfigure;
                    nodeType.prototype.onConfigure = function () {
                        if (onConfigure_orig && onConfigure_orig !== nodeType.prototype.onConfigure) {
                            onConfigure_orig.apply(this, arguments);
                        }
                        try {
                            const findName = (i) => {
                                if (!i) return null;
                                if (typeof i === "object" && i.name) return i.name;
                                if (Array.isArray(i) && i.length > 0) return i[0];
                                return null;
                            };
                            const idx = Array.isArray(this.inputs) ? this.inputs.findIndex(i => findName(i) === "character_prompt") : -1;
                            if (idx >= 0) {
                                if (typeof this.removeInput === "function") {
                                    this.removeInput(idx);
                                } else if (typeof this.removeInputSlot === "function") {
                                    this.removeInputSlot(idx);
                                } else {
                                    try {
                                        this.inputs.splice(idx, 1);
                                        if (Array.isArray(this.input_types)) this.input_types.splice(idx, 1);
                                        if (Array.isArray(this.inputs_connections)) this.inputs_connections.splice(idx, 1);
                                    } catch (innerErr) {
                                        console.warn("[ZML_Ai多功能助手] onConfigure: 直接移除输入端口时发生错误:", innerErr);
                                    }
                                }
                                if (typeof this.setDirtyCanvas === "function") this.setDirtyCanvas(true, true);
                                if (typeof this.onResize === "function") this.onResize();
                            }
                        } catch (err) {
                            console.warn("[ZML_Ai多功能助手] onConfigure: 移除 character_prompt 失败:", err);
                        }
                    };
                } catch (e) {
                    console.warn("[ZML_Ai多功能助手] 安装 onConfigure 钩子失败:", e);
                }

                const widgetName = "target_features";
                const widgetIndex = this.widgets.findIndex(w => w.name === widgetName);
                if (widgetIndex === -1) return;

                const originalWidget = this.widgets[widgetIndex];

                // 使用danbooru-gallery的方法彻底隐藏原始小部件
                originalWidget.computeSize = () => [0, -4]; // 让小部件不占空间
                originalWidget.draw = () => { }; // 阻止小部件(包括其标签)被绘制
                originalWidget.type = "hidden"; // 在某些UI模式下隐藏


                // --- 创建主容器 ---
                const wrapper = document.createElement("div");
                wrapper.className = "cfs-widget-wrapper";
                wrapper.style.marginBottom = "5px"; // Add some spacing

                // --- 添加帮助图标 ---
                const helpIcon = document.createElement("div");
                helpIcon.className = "cfs-help-icon";
                helpIcon.textContent = "?";
                helpIcon.onclick = createHelpPanel;
                wrapper.appendChild(helpIcon);

                // --- 已选标签容器 (REMOVED) ---

                // --- 添加标签按钮 ---
                const addTagButton = document.createElement("button");
                addTagButton.textContent = "＋";
                addTagButton.className = "cfs-add-tag-button";
                wrapper.appendChild(addTagButton);

                // --- 函数: 更新小部件的值 ---
                const updateWidgetValue = () => {
                    const tags = Array.from(wrapper.querySelectorAll(".cfs-tag")).map(el => el.textContent.replace("✖", "").trim());
                    // Update the value of the original widget
                    originalWidget.value = tags.join(", ");
                    this.setDirtyCanvas(true, true);
                };

                // --- 颜色管理 ---
                const tagColors = [
                    { bg: 'rgba(139, 195, 74, 0.3)', border: '#8BC34A', text: '#E0E0E0' }, // Light Green
                    { bg: 'rgba(3, 169, 244, 0.3)', border: '#03A9F4', text: '#E0E0E0' }, // Light Blue
                    { bg: 'rgba(255, 152, 0, 0.3)', border: '#FF9800', text: '#E0E0E0' }, // Orange
                    { bg: 'rgba(156, 39, 176, 0.3)', border: '#9C27B0', text: '#E0E0E0' }, // Purple
                    { bg: 'rgba(233, 30, 99, 0.3)', border: '#E91E63', text: '#E0E0E0' },  // Pink
                    { bg: 'rgba(0, 150, 136, 0.3)', border: '#009688', text: '#E0E0E0' },  // Teal
                ];
                let colorIndex = 0;
                const getNextColor = () => {
                    const color = tagColors[colorIndex];
                    colorIndex = (colorIndex + 1) % tagColors.length;
                    return color;
                };

                // --- 函数: 添加一个已选标签的UI元素 ---
                const addSelectedTag = (text) => {
                    text = text.trim();
                    const currentTags = Array.from(wrapper.querySelectorAll(".cfs-tag")).map(el => el.textContent.replace("✖", "").trim());
                    if (!currentTags.includes(text) && text) { // Only add if not already present and not empty
                        const tag = document.createElement("div");
                        tag.className = "cfs-tag";

                        // --- 应用颜色 ---
                        const color = getNextColor();
                        tag.style.backgroundColor = color.bg;
                        tag.style.borderColor = color.border;
                        tag.style.color = color.text;


                        const label = document.createElement("span");
                        label.className = "cfs-tag-label";
                        label.textContent = text;
                        tag.appendChild(label);

                        const removeBtn = document.createElement("span");
                        removeBtn.className = "cfs-remove-btn";
                        removeBtn.textContent = "✖";
                        removeBtn.onclick = (e) => {
                            e.stopPropagation();
                            tag.remove();
                            updateWidgetValue();
                            debouncedAutosave(); // 自动保存
                        };

                        tag.appendChild(removeBtn);
                        // 将新标签插入到 addTagButton 之前
                        wrapper.insertBefore(tag, addTagButton);
                        updateWidgetValue();
                        debouncedAutosave(); // 自动保存
                    }
                };

                // --- 事件监听 ---
                addTagButton.addEventListener("click", () => {
                    // 隐藏按钮
                    addTagButton.style.display = "none";

                    // 创建临时输入框
                    const tempInput = document.createElement("input");
                    tempInput.type = "text";
                    tempInput.className = "cfs-temp-input";
                    tempInput.placeholder = t('addTagPlaceholder');
                    wrapper.appendChild(tempInput);
                    tempInput.focus();

                    const finalizeTag = () => {
                        const newTag = tempInput.value.trim();
                        if (newTag) {
                            addSelectedTag(newTag);
                        }
                        // 移除输入框并显示按钮
                        tempInput.remove();
                        addTagButton.style.display = "";
                    };

                    // 当输入框失去焦点时
                    tempInput.addEventListener("blur", finalizeTag);

                    // 当在输入框中按下回车时
                    tempInput.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            finalizeTag();
                        } else if (e.key === "Escape") {
                            tempInput.value = ""; // 清空以防添加
                            finalizeTag();
                        }
                    });
                });

                // --- 创建底部按钮栏 ---
                const bottomBar = document.createElement("div");
                bottomBar.className = "cfs-bottom-bar";
                bottomBar.title = "";

                const importButton = document.createElement("button");
                importButton.innerHTML = `<i class="fas fa-upload"></i> ${t('import')}`;
                importButton.className = "cfs-bottom-button";
                importButton.onclick = () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = (e) => {
                        const file = e.target.files[0];
                        if (!file) return;

                        const reader = new FileReader();
                        reader.onload = async (event) => {
                            try {
                                const importedData = JSON.parse(event.target.result);

                                // --- 全面导入逻辑 ---
                                // 1. 验证导入的数据结构
                                if (!importedData || (!importedData.presets && !importedData.target_features)) {
                                    alert(t('importError'));
                                    return;
                                }

                                // 2. 获取当前设置
                                const response = await api.fetchApi("/zml/ai/llm_settings");
                                const currentSettings = await response.json();

                                // 3. 合并设置
                                const newSettings = { ...currentSettings };

                                // 优先导入新的预设结构
                                if (importedData.presets && Array.isArray(importedData.presets)) {
                                    newSettings.presets = importedData.presets;
                                    newSettings.active_preset_name = importedData.active_preset_name || "default";
                                }
                                // 向后兼容旧的 target_features 格式
                                else if (importedData.target_features) {
                                    const defaultPreset = newSettings.presets.find(p => p.name === "default") || { name: "default", features: [] };
                                    defaultPreset.features = importedData.target_features;
                                    if (!newSettings.presets.some(p => p.name === "default")) {
                                        newSettings.presets.push(defaultPreset);
                                    }
                                    newSettings.active_preset_name = "default";
                                }

                                // 更新其他非敏感设置
                                if (importedData.language) newSettings.language = importedData.language;
                                // 移除 custom_prompt 的导入，因为提示词内容在修改模板里面进行
                                // if (importedData.custom_prompt) newSettings.custom_prompt = importedData.custom_prompt;


                                // 4. 保存合并后的设置
                                const saveResponse = await api.fetchApi("/zml/ai/llm_settings", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(newSettings),
                                });

                                if (!saveResponse.ok) {
                                    throw new Error('Failed to save imported settings.');
                                }

                                // 5. 刷新整个节点UI以反映所有变化
                                this.cfs_settings = newSettings; // 更新缓存
                                currentLanguage = newSettings.language;
                                updateAllNodeUIs();

                                const activePreset = newSettings.presets.find(p => p.name === newSettings.active_preset_name) || newSettings.presets.find(p => p.name === "default");
                                wrapper.querySelectorAll(".cfs-tag").forEach(tag => tag.remove());
                                if (activePreset) {
                                    activePreset.features.forEach(addSelectedTag);
                                }
                                updateWidgetValue();
                                const ui = nodeUIs.get(this);
                                ui.presetButton.querySelector(".cfs-preset-text").textContent = newSettings.active_preset_name;


                                alert(t('importSuccess'));

                            } catch (err) {
                                alert(t('importError') + ": " + err.message);
                                console.error("CFS: Import failed", err);
                            }
                        };
                        reader.readAsText(file);
                    };
                    input.click();
                };

                const exportButton = document.createElement("button");
                exportButton.innerHTML = `<i class="fas fa-download"></i> ${t('export')}`;
                exportButton.className = "cfs-bottom-button";
                exportButton.onclick = async () => {
                    try {
                        const response = await api.fetchApi("/zml/ai/llm_settings");
                        const currentSettings = await response.json();

                        // 创建一个不包含敏感信息的新对象用于导出
                        const settingsToExport = {
                            language: currentSettings.language,
                            // 移除 custom_prompt 的导出，因为提示词内容在修改模板里面进行
                            // custom_prompt: currentSettings.custom_prompt,
                            presets: currentSettings.presets,
                            active_preset_name: currentSettings.active_preset_name,
                        };
                        // 清理API Key
                        delete settingsToExport.api_key;
                        delete settingsToExport.api_url;
                        delete settingsToExport.model;


                        const blob = new Blob([JSON.stringify(settingsToExport, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'cfs_settings.json';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        alert(t('exportSuccess'));
                    } catch (error) {
                        console.error("CFS: Export failed", error);
                        alert(t('exportFailed'));
                    }
                };

                const debugButton = document.createElement("button");
                debugButton.innerHTML = `<i class="fas fa-bug"></i> ${t('debug')}`;
                debugButton.className = "cfs-bottom-button";
                debugButton.onclick = async () => {
                    const getPromptFromInput = (slot) => {
                        // A much simpler and potentially more robust way to get input data.
                        // This relies on the litegraph's built-in data flow.
                        const data = this.getInputData(slot);

                        if (data === undefined || data === null) {
                            return null;
                        }

                        // The data could be anything, so we need to handle it.
                        // It might be an array from a Reroute node, or a string, or our JSON object.
                        if (Array.isArray(data)) {
                            // Let's assume if it's an array, we want the first element.
                            // This is a common pattern in ComfyUI.
                            const firstElement = data[0];
                            if (firstElement === undefined || firstElement === null) return null;
                            return String(firstElement);
                        }

                        return String(data);
                    };

                    const showDebugPanel = async (finalPrompt) => {
                        if (document.querySelector(".cfs-debug-panel")) {
                            document.querySelector(".cfs-debug-panel").remove();
                        }
                        const debugPanel = document.createElement("div");
                        debugPanel.className = "cfs-help-panel cfs-debug-panel";
                        debugPanel.style.zIndex = "2001";
                        debugPanel.innerHTML = `
                            <div class="cfs-help-panel-content" style="max-width: 800px;">
                                <h2>LLM Debug Prompt</h2>
                                <pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 60vh; overflow-y: auto; background-color: #222; padding: 10px; border-radius: 5px;">${finalPrompt}</pre>
                                <button class="cfs-help-panel-close-button">关闭</button>
                            </div>
                        `;
                        document.body.appendChild(debugPanel);
                        const closeButton = debugPanel.querySelector(".cfs-help-panel-close-button");
                        closeButton.onclick = () => debugPanel.remove();
                        debugPanel.onclick = (e) => { if (e.target === debugPanel) debugPanel.remove(); };
                    };

                    try {
                        let originalPrompt = getPromptFromInput(0);
                        let substitutePrompt = getPromptFromInput(1);

                        // 如果任何一个输入未连接，则尝试从缓存中获取
                        if (originalPrompt === null || substitutePrompt === null) {
                        const cachedResponse = await api.fetchApi("/zml/ai/cached_prompts");
                            const cachedData = await cachedResponse.json();

                            if (originalPrompt === null) {
                                originalPrompt = cachedData.original_prompt || "";
                            }
                            if (substitutePrompt === null) {
                                substitutePrompt = cachedData.substitute_prompt || "";
                            }
                        }

                        // JSON parsing logic
                        const parseIfNeeded = (promptStr) => {
                            if (typeof promptStr === 'string' && promptStr.trim().startsWith('{')) {
                                try {
                                    const parsed = JSON.parse(promptStr);
                                    if (parsed && typeof parsed === 'object' && 'prompt' in parsed) {
                                        return parsed.prompt;
                                    }
                                } catch (e) {
                                    // Not a valid JSON, return original string
                                }
                            }
                            return promptStr;
                        };

                        originalPrompt = parseIfNeeded(originalPrompt);
                        substitutePrompt = parseIfNeeded(substitutePrompt);

                        if (!originalPrompt && !substitutePrompt) {
                            alert("无法获取提示词。请确保至少有一个输入已连接，或者已经成功运行过一次以生成缓存。");
                            return;
                        }

                        const featureWidget = this.widgets.find(w => w.name === "target_features");
                        const targetFeatures = featureWidget ? featureWidget.value : "";

                        const payload = {
                            original_prompt: originalPrompt,
                            substitute_prompt: substitutePrompt,
                            target_features: targetFeatures.split(",").map(t => t.trim()).filter(t => t)
                        };


                        const response = await api.fetchApi("/zml/ai/debug_prompt", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                        });

                        const data = await response.json();


                        if (!response.ok) {
                            throw new Error(data.error || `获取调试信息失败 (HTTP ${response.status})`);
                        }

                        if (data.error) {
                            alert("调试错误: " + data.error);
                            return;
                        }

                        if (document.querySelector(".cfs-debug-panel")) {
                            document.querySelector(".cfs-debug-panel").remove();
                        }

                        const debugPanel = document.createElement("div");
                        debugPanel.className = "cfs-help-panel cfs-debug-panel";
                        debugPanel.style.zIndex = "2001";
                        debugPanel.innerHTML = `
                            <div class="cfs-help-panel-content" style="max-width: 800px;">
                                <h2>LLM Debug Prompt</h2>
                                <pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 60vh; overflow-y: auto; background-color: #222; padding: 10px; border-radius: 5px;">${data.final_prompt}</pre>
                                <button class="cfs-help-panel-close-button">关闭</button>
                            </div>
                        `;
                        document.body.appendChild(debugPanel);

                        const closeButton = debugPanel.querySelector(".cfs-help-panel-close-button");
                        closeButton.onclick = () => debugPanel.remove();
                        debugPanel.onclick = (e) => { if (e.target === debugPanel) debugPanel.remove(); };

                    } catch (error) {
                        alert("错误: " + error.message);
                    }
                };

                const settingsButton = document.createElement("button");
                settingsButton.innerHTML = `<i class="fas fa-cog"></i> ${t('settings')}`;
                settingsButton.className = "cfs-bottom-button cfs-settings-button";
                settingsButton.onclick = () => {
                    createNewSettingsDialog(this);
                };

                // This block is now incorrect, it will be moved and corrected.
                // We will add the preset button inside the wrapper directly.
                bottomBar.appendChild(importButton);
                bottomBar.appendChild(exportButton);
                bottomBar.appendChild(debugButton);
                bottomBar.appendChild(settingsButton);

                const mainContainer = document.createElement("div");
                mainContainer.className = "cfs-main-container";
                mainContainer.title = "";

                const presetButtonContainer = document.createElement("div");
                presetButtonContainer.className = "cfs-preset-button-container";
                const presetButton = document.createElement("button");
                presetButton.className = "cfs-preset-button-widget";
                presetButton.innerHTML = `<span class="cfs-preset-text">${t('presets')}</span><span class="cfs-preset-arrow">▼</span>`;
                presetButtonContainer.appendChild(presetButton);
                wrapper.appendChild(presetButtonContainer);

                mainContainer.appendChild(wrapper);

                // --- 预设下拉菜单逻辑 ---
                const createPresetDropdown = () => {
                    if (document.querySelector(".cfs-preset-dropdown")) {
                        document.querySelector(".cfs-preset-dropdown").remove();
                        return;
                    }

                    const dropdown = document.createElement("div");
                    dropdown.className = "cfs-preset-dropdown";
                    document.body.appendChild(dropdown);

                    const rect = presetButton.getBoundingClientRect();
                    // Position dropdown above the button
                    dropdown.style.left = `${rect.left}px`;
                    // dropdown.style.width = `${rect.width}px`; // Let CSS handle width

                    // Must be visible to calculate height
                    dropdown.style.visibility = "hidden";
                    dropdown.style.display = "flex";

                    const dropdownHeight = dropdown.offsetHeight;
                    dropdown.style.top = `${rect.top - dropdownHeight - 5}px`;

                    // Make it visible again
                    dropdown.style.visibility = "visible";


                    const searchInput = document.createElement("input");
                    searchInput.type = "text";
                    searchInput.placeholder = t('search');
                    searchInput.className = "cfs-preset-search";

                    const saveBtn = document.createElement("button");
                    saveBtn.className = "cfs-preset-action-btn";
                    saveBtn.innerHTML = `<i class="fas fa-save"></i>`;
                    saveBtn.title = t('saveCurrentPreset');

                    const saveAsBtn = document.createElement("button");
                    saveAsBtn.className = "cfs-preset-action-btn";
                    saveAsBtn.innerHTML = `<i class="fas fa-plus-square"></i>`;
                    saveAsBtn.title = t('saveAsPreset');

                    const searchContainer = document.createElement("div");
                    searchContainer.className = "cfs-search-container";
                    searchContainer.appendChild(searchInput);
                    searchContainer.appendChild(saveBtn);
                    searchContainer.appendChild(saveAsBtn);

                    const presetList = document.createElement("div");
                    presetList.className = "cfs-preset-list";

                    dropdown.appendChild(searchContainer);
                    dropdown.appendChild(presetList);

                    const node = this;

                    const renderPresets = (filter = "") => {
                        presetList.innerHTML = "";
                        const presets = (node.cfs_settings?.presets || []).filter(p =>
                            p.name.toLowerCase().includes(filter.toLowerCase())
                        );

                        presets.forEach(p => {
                            const item = document.createElement("div");
                            item.className = "cfs-preset-item";
                            if (p.name === node.cfs_settings.active_preset_name) {
                                item.classList.add("active");
                            }

                            const nameSpan = document.createElement("span");
                            nameSpan.textContent = p.name;
                            nameSpan.onclick = async () => {
                                node.cfs_settings.active_preset_name = p.name;
                                    await api.fetchApi("/zml/ai/llm_settings", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify(node.cfs_settings),
                                    });

                                // Reload UI
                                wrapper.querySelectorAll(".cfs-tag").forEach(tag => tag.remove());
                                p.features.forEach(addSelectedTag);
                                updateWidgetValue();
                                presetButton.querySelector(".cfs-preset-text").textContent = p.name;
                                dropdown.remove();
                            };

                            const deleteBtn = document.createElement("div");
                            deleteBtn.className = "cfs-preset-delete-btn";
                            deleteBtn.innerHTML = "✖";
                            deleteBtn.onclick = async (e) => {
                                e.stopPropagation();
                                if (p.name === "default") return; // Cannot delete default
                                if (confirm(t('deletePresetConfirmation').replace('{presetName}', p.name))) {
                                    node.cfs_settings.presets = node.cfs_settings.presets.filter(preset => preset.name !== p.name);
                                    if (node.cfs_settings.active_preset_name === p.name) {
                                        node.cfs_settings.active_preset_name = "default";
                                        // Switch to default preset's tags
                                        const defaultPreset = node.cfs_settings.presets.find(pr => pr.name === "default");
                                        if (defaultPreset) {
                                            wrapper.querySelectorAll(".cfs-tag").forEach(tag => tag.remove());
                                            defaultPreset.features.forEach(addSelectedTag);
                                            updateWidgetValue();
                                            presetButton.querySelector(".cfs-preset-text").textContent = "default";
                                        }
                                    }
                                    await api.fetchApi("/zml/ai/llm_settings", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify(node.cfs_settings),
                                    });
                                    renderPresets(searchInput.value);
                                    // alert(t('presetDeleted')); // No need for alert, UI updates
                                }
                            };

                            item.appendChild(nameSpan);
                            if (p.name !== "default") {
                                item.appendChild(deleteBtn);
                            }
                            presetList.appendChild(item);
                        });
                    };

                    searchInput.oninput = () => renderPresets(searchInput.value);

                    // "另存为" 按钮功能
                    saveAsBtn.onclick = async () => {
                        const newName = prompt(t('presetName'));
                        if (!newName || !newName.trim()) return;

                        const exists = node.cfs_settings.presets.some(p => p.name === newName.trim());
                        if (exists) {
                            alert(t('presetNameExists'));
                            return;
                        }

                        const currentTags = Array.from(wrapper.querySelectorAll(".cfs-tag-label")).map(el => el.textContent);
                        const newPreset = { name: newName.trim(), features: currentTags };
                        node.cfs_settings.presets.push(newPreset);
                        node.cfs_settings.active_preset_name = newName.trim();

                        await api.fetchApi("/zml/ai/llm_settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(node.cfs_settings),
                        });

                        presetButton.querySelector(".cfs-preset-text").textContent = newName.trim();
                        dropdown.remove();
                    };

                    // "保存" 按钮功能
                    saveBtn.onclick = async () => {
                        const activePresetName = node.cfs_settings.active_preset_name;
                        const activePreset = node.cfs_settings.presets.find(p => p.name === activePresetName);
                        if (activePreset) {
                            const currentTags = Array.from(wrapper.querySelectorAll(".cfs-tag-label")).map(el => el.textContent);
                            activePreset.features = currentTags;

                            await api.fetchApi("/zml/ai/llm_settings", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(node.cfs_settings),
                            });

                            saveBtn.style.background = '#8BC34A';
                            setTimeout(() => {
                                dropdown.remove();
                            }, 300);
                        }
                    };

                    renderPresets();
                    searchInput.focus();

                    // Close dropdown when clicking outside
                    const closeHandler = (e) => {
                        if (!dropdown.contains(e.target) && e.target !== presetButton && !presetButton.contains(e.target)) {
                            dropdown.remove();
                            document.removeEventListener("click", closeHandler, true);
                        }
                    };
                    document.addEventListener("click", closeHandler, true);
                };

                presetButton.addEventListener("click", createPresetDropdown);
                // --- 创建消息区域 ---
                const messageArea = document.createElement("div");
                messageArea.className = "cfs-message-area";
                mainContainer.appendChild(messageArea);

                mainContainer.appendChild(bottomBar);

                // --- 存储UI元素并添加DOM小部件 ---
                const uiElements = {
                    importButton,
                    exportButton,
                    debugButton,
                    settingsButton,
                    presetButton,
                    messageArea,
                    helpIcon,
                    addTagButton,
                };
                nodeUIs.set(this, uiElements);
                this.addDOMWidget(widgetName + "_custom", "div", mainContainer);

                // --- 自动保存逻辑 ---
                const nodeInstance = this; // 保存节点实例的引用
                const debouncedAutosave = Utils.debounce(async () => {
                    try {
                        // 1. 获取当前所有设置以避免覆盖
                        const response = await api.fetchApi("/zml/ai/llm_settings");
                        if (!response.ok) throw new Error("Failed to fetch current settings.");
                        const currentSettings = await response.json();

                        // 2. 从小部件获取最新的特征列表
                        const featureWidget = nodeInstance.widgets.find(w => w.name === "target_features");
                        const currentFeatures = featureWidget ? featureWidget.value.split(",").map(t => t.trim()).filter(t => t) : [];

                        // 3. 创建新的设置对象
                        const newSettings = { ...currentSettings };
                        const activePresetName = newSettings.active_preset_name || "default";
                        let presetFound = false;
                        if (newSettings.presets) {
                            for (let preset of newSettings.presets) {
                                if (preset.name === activePresetName) {
                                    preset.features = currentFeatures;
                                    presetFound = true;
                                    break;
                                }
                            }
                        }
                        if (!presetFound) {
                            if (!newSettings.presets) newSettings.presets = [];
                            newSettings.presets.push({ name: activePresetName, features: currentFeatures });
                        }

                        // 4. 将更新后的设置发送回服务器
                        const saveResponse = await api.fetchApi("/zml/ai/llm_settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(newSettings),
                        });

                        if (!saveResponse.ok) throw new Error("Failed to save settings.");


                    } catch (error) {
                        console.error("CFS: Autosave failed.", error);
                        // 可以在这里添加一个小的UI提示，告知用户自动保存失败
                    }
                }, 500); // 500毫秒延迟



                // 从服务器加载设置并应用 target_features
                api.fetchApi("/zml/ai/llm_settings")
                    .then(response => response.json())
                    .then(settings => {
                        this.cfs_settings = settings; // 在节点上缓存设置
                        currentLanguage = settings.language || 'zh';
                        const ui = nodeUIs.get(this);
                        if (ui) {
                            checkConnectionStatus(ui, settings);
                        }
                        updateAllNodeUIs();

                        wrapper.querySelectorAll(".cfs-tag").forEach(tag => tag.remove());

                        const activePresetName = settings.active_preset_name || "default";
                        const activePreset = settings.presets?.find(p => p.name === activePresetName);

                        let tagsToRender = [];
                        if (activePreset && Array.isArray(activePreset.features)) {
                            tagsToRender = activePreset.features;
                        } else {
                            // Fallback if preset not found or features are missing
                            const defaultPreset = settings.presets?.find(p => p.name === "default");
                            if (defaultPreset && Array.isArray(defaultPreset.features)) {
                                tagsToRender = defaultPreset.features;
                                this.cfs_settings.active_preset_name = "default"; // Correct active preset name
                            } else {
                                tagsToRender = (originalWidget.value || "").split(",").map(t => t.trim()).filter(t => t);
                            }
                        }

                        tagsToRender.forEach(addSelectedTag);
                        updateWidgetValue();

                        // 更新预设按钮的文本
                        const presetButtonText = ui.presetButton.querySelector(".cfs-preset-text");
                        if (presetButtonText) {
                            presetButtonText.textContent = activePresetName;
                        }
                    })
                    .catch(error => {
                        // 如果加载失败，则使用小部件的默认值
                        console.error("CFS: Failed to load settings for tags, using default.", error);
                        const initialTags = (originalWidget.value || "").split(",").filter(t => t.trim());
                        initialTags.forEach(addSelectedTag);
                    });



                // --- 添加样式 (保持不变) ---
                // --- Font Awesome ---
                if (!document.querySelector('link[href*="font-awesome"]')) {
                    const faLink = document.createElement('link');
                    faLink.rel = 'stylesheet';
                    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
                    document.head.appendChild(faLink);
                }

                // --- 添加样式 (保持不变) ---
                if (!document.getElementById("cfs-custom-styles")) {
                    const style = document.createElement('style');
                    style.id = "cfs-custom-styles";
                    style.textContent = `
                        /* 全局样式调整 */
                        :root {
                            --cfs-text-color: #E0E0E0;
                            --cfs-background-dark: #2a2a2a;
                            --cfs-background-medium: #333333;
                            --cfs-border-color: #555555;
                            --cfs-widget-border-color: #c53939; /* A more vibrant red for the main border */
                            --cfs-widget-bg: linear-gradient(145deg, #383838, #2e2e2e); /* Subtle gradient for the background */
                            --cfs-add-button-bg: #444444;
                            --cfs-add-button-border: #666666;
                            --cfs-hover-bg: #555555;
                            --cfs-selected-bg: #666666;
                        }

                        /* Main container for dynamic layout */
                        .cfs-main-container {
                            display: flex;
                            flex-direction: column;
                            min-height: 150px;  /* Set a default height for the whole widget area */
                            justify-content: space-between; /* Push content and bottom bar apart */
                        }

                        /* Message Area Styles */
                        .cfs-message-area {
                            padding: 4px 8px;
                            margin: 0 4px 4px 4px; /* Top, H, Bottom, H */
                            color: #FF9800; /* Warning color */
                            background-color: rgba(255, 152, 0, 0.1);
                            border: 1px solid rgba(255, 152, 0, 0.3);
                            border-radius: 4px;
                            font-size: 12px;
                            text-align: center;
                            display: none; /* Hidden by default */
                            flex-shrink: 0;
                        }

                        /* Bottom Bar Styles */
                        .cfs-bottom-bar {
                            width: 100%;
                            display: flex;
                            gap: 8px;
                            box-sizing: border-box;
                            padding: 8px 4px; /* Adjust horizontal padding */
                            flex-shrink: 0; /* Prevent buttons from shrinking */
                        }
                        .cfs-bottom-button {
                            height: 28px;
                            padding: 0 12px;
                            background-color: #333;
                            color: #E0E0E0;
                            border: 1px solid #555;
                            border-radius: 4px;
                            cursor: pointer;
                            text-align: center;
                            font-size: 12px;
                            transition: background-color 0.2s;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            gap: 6px; /* Icon-text spacing */
                        }
                        .cfs-bottom-button:hover {
                            background-color: #444;
                            color: #fff;
                        }
                        .cfs-bottom-button:active {
                           background-color: #2a2a2a;
                        }
                        .cfs-settings-button {
                           margin-left: auto;
                        }

                        .cfs-preset-button-container {
                            position: absolute;
                            bottom: 8px;
                            right: 8px;
                        }

                        /* New style for the button inside the widget */
                        .cfs-preset-button-widget {
                            background-color: #222;
                            border: 1px solid #555;
                            color: #E0E0E0;
                            border-radius: 4px;
                            padding: 4px 12px;
                            cursor: pointer;
                            font-size: 13px;
                            height: 26px;
                            box-sizing: border-box;
                            width: auto; /* Let width be dynamic */
                            display: inline-flex; /* Use inline-flex for dynamic width */
                            align-items: center;
                            justify-content: center;
                            gap: 6px; /* Space between text and arrow */
                        }
                        .cfs-preset-button-widget .cfs-preset-text {
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            max-width: 120px; /* Prevent extremely long names from breaking layout */
                        }
                        .cfs-preset-button-widget .cfs-preset-arrow {
                            font-size: 10px;
                        }
                        .cfs-preset-button-widget:hover {
                            border-color: #888;
                        }

                        /* Preset Dropdown Styles */
                        .cfs-preset-dropdown {
                            position: fixed;
                            z-index: 2100;
                            background: #2a2a2a;
                            border: 1px solid #555;
                            border-radius: 6px;
                            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
                            display: flex;
                            flex-direction: column;
                            padding: 5px;
                            gap: 5px;
                            min-width: 180px; /* Ensure minimum width */
                        }
                        .cfs-search-container {
                            display: flex;
                            align-items: center;
                            gap: 5px;
                        }
                        .cfs-preset-search {
                            flex-grow: 1;
                            padding: 8px;
                            margin: 0;
                            border: 1px solid #444;
                            background: #222;
                            color: #eee;
                            outline: none;
                            font-size: 13px;
                            border-radius: 4px;
                        }
                        .cfs-preset-action-btn {
                            flex-shrink: 0;
                            cursor: pointer;
                            width: 32px;
                            height: 32px;
                            font-size: 14px;
                            color: #ccc;
                            background: #3a3a3a;
                            border: 1px solid #444;
                            border-radius: 4px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s;
                            padding: 0;
                        }
                        .cfs-preset-action-btn:hover {
                            background: #4a4a4a;
                            color: white;
                        }
                        .cfs-preset-action-btn:disabled {
                            opacity: 0.5;
                            cursor: not-allowed;
                            background: #3a3a3a;
                            color: #666;
                        }
                        .cfs-preset-list {
                            max-height: 200px;
                            overflow-y: auto;
                            display: flex;
                            flex-direction: column;
                            scrollbar-width: thin;
                            scrollbar-color: #555 #2a2a2a;
                        }
                        .cfs-preset-item {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            padding: 8px 10px;
                            color: #ccc;
                            cursor: pointer;
                            border-radius: 4px;
                        }
                        .cfs-preset-item:hover {
                            background: #3a3a3a;
                        }
                        .cfs-preset-item.active {
                            background: #03A9F4;
                            color: white;
                        }
                        .cfs-preset-item.active:hover {
                            background: #0288D1;
                        }
                        .cfs-preset-item span {
                            flex-grow: 1;
                        }
                        .cfs-preset-delete-btn {
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-size: 12px;
                            opacity: 0.7;
                            font-weight: bold;
                        }
                        .cfs-preset-delete-btn:hover {
                            background: rgba(255, 82, 82, 0.3);
                            color: #ff5252;
                            opacity: 1;
                        }
                        .cfs-search-container {
                            display: flex;
                            align-items: center;
                            gap: 5px;
                        }
                        .cfs-preset-search {
                            flex-grow: 1;
                            padding: 8px;
                            margin: 0;
                            border: 1px solid #444;
                            background: #222;
                            color: #eee;
                            outline: none;
                            font-size: 13px;
                            border-radius: 4px;
                        }
                        /* This style block is now handled by .cfs-preset-action-btn */

                        /* New Settings Dialog Styles */
.cfs-new-settings-dialog {
                            position: fixed;
                            z-index: 2000;
                            left: 50%;
                            top: 50%;
                            transform: translate(-50%, -50%);
                            width: 90%;
                            max-width: 700px;
                            background: #2c2c2c;
                            border: 1px solid #444;
                            border-radius: 8px;
                            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                            display: flex;
                            flex-direction: column;
                            animation: cfs-fade-in 0.2s ease-out;
}

.cfs-template-actions button, #cfs-add-template-btn, #cfs-restore-default-btn {
    background-color: #2a3b4f;
    color: #E0E0E0;
    border: 1px solid #4b5b70;
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
}
.cfs-template-actions button:hover {
    background-color: #33506c;
}

.cfs-modal {
    position: fixed;
    left: 0; top: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}
.cfs-modal-content {
    background: #1f1f1f;
    border: 1px solid #555;
    padding: 16px;
    width: 520px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: auto;
    color: #E0E0E0;
}
.cfs-modal-content input, .cfs-modal-content textarea {
    width: 100%;
    margin: 6px 0 10px;
    padding: 8px;
    box-sizing: border-box;
    background-color: #222;
    border: 1px solid #555;
    color: #E0E0E0;
    border-radius: 4px;
}
.cfs-modal-content textarea { resize: vertical; max-height: 60vh; min-height: 140px; }
.cfs-modal-buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}
.cfs-add-template-modal {
    position: fixed;
    left: 0; top: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}
.cfs-add-template-modal .cfs-modal-content {
    background: #1f1f1f;
    border: 1px solid #555;
    padding: 20px;
    width: 500px;
    max-width: 90vw;
    color: #E0E0E0;
    border-radius: 8px;
}
.cfs-add-template-modal h4 {
    margin: 0 0 15px 0;
    color: #fff;
}
.cfs-add-template-modal label {
    display: block;
    margin: 10px 0 5px 0;
    font-weight: bold;
}
.cfs-add-template-modal input,
.cfs-add-template-modal textarea {
    width: 100%;
    padding: 8px;
    margin-bottom: 10px;
    background: #333;
    border: 1px solid #555;
    color: #E0E0E0;
    border-radius: 4px;
    box-sizing: border-box;
}
.cfs-add-template-modal textarea {
    min-height: 120px;
    resize: vertical;
}
.cfs-add-template-modal .cfs-modal-buttons {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 15px;
}
.cfs-add-template-modal button {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}
.cfs-add-template-modal #cfs-save-template {
    background: #007acc;
    color: white;
}
.cfs-add-template-modal #cfs-save-template:hover {
    background: #005a9e;
}
.cfs-add-template-modal #cfs-cancel-template {
    background: #666;
    color: white;
}
.cfs-add-template-modal #cfs-cancel-template:hover {
    background: #555;
}
/* 修改模板对话框样式 */
.cfs-edit-template-modal {
    position: fixed;
    left: 0; top: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}
.cfs-edit-template-modal .cfs-modal-content {
    background: #1f1f1f;
    border: 1px solid #555;
    padding: 20px;
    width: 500px;
    max-width: 90vw;
    color: #E0E0E0;
    border-radius: 8px;
}
.cfs-edit-template-modal h4 {
    margin: 0 0 15px 0;
    color: #fff;
}
.cfs-edit-template-modal label {
    display: block;
    margin: 10px 0 5px 0;
    font-weight: bold;
}
.cfs-edit-template-modal input,
.cfs-edit-template-modal textarea {
    width: 100%;
    padding: 8px;
    margin-bottom: 10px;
    background: #333;
    border: 1px solid #555;
    color: #E0E0E0;
    border-radius: 4px;
    box-sizing: border-box;
}
.cfs-edit-template-modal textarea {
    min-height: 120px;
    resize: vertical;
}
.cfs-edit-template-modal .cfs-modal-buttons {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 15px;
}
.cfs-edit-template-modal button {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}
.cfs-edit-template-modal #cfs-save-edit-template {
    background: #007acc;
    color: white;
}
.cfs-edit-template-modal #cfs-save-edit-template:hover {
    background: #005a9e;
}
.cfs-edit-template-modal #cfs-cancel-edit-template {
    background: #666;
    color: white;
}
.cfs-edit-template-modal #cfs-cancel-edit-template:hover {
    background: #555;
}
                        .cfs-new-settings-content {
                            display: flex;
                            flex-grow: 1;
                        }
                        .cfs-new-settings-sidebar {
                            width: 150px; /* Increased from 120px */
                            min-width: 150px; /* Ensure it doesn't shrink */
                            padding: 15px; /* Simplified padding */
                            border-right: 1px solid #444;
                            display: flex;
                            flex-direction: column;
                            gap: 8px; /* Slightly reduced gap */
                        }
                        .cfs-new-settings-tab {
                            width: 100%;
                            padding: 12px 18px; /* Increased padding for more space */
                            background: transparent;
                            border: none; /* Remove border */
                            color: #ccc;
                            text-align: left;
                            cursor: pointer;
                            border-radius: 0; /* Remove border-radius for a cleaner look */
                            font-size: 14px;
                            font-weight: 500; /* Set a consistent font-weight */
                            transition: background-color 0.2s, color 0.2s; /* Smooth transitions */
                            box-sizing: border-box;
                            white-space: nowrap; /* Prevent text from wrapping */
                            overflow: hidden; /* Hide overflowing text */
                            text-overflow: ellipsis; /* Add ellipsis for overflowing text */
                        }
                        .cfs-new-settings-tab:hover {
                            background: #3a3a3a; /* A slightly different hover color */
                            color: #fff;
                        }
                        .cfs-new-settings-tab.active {
                            background: #454545; /* A more distinct active background */
                            color: #fff;
                            box-shadow: inset 3px 0 0 0 #03A9F4; /* Use box-shadow for indicator */
                        }
                        #cfs-language-options {
                            display: flex;
                            gap: 10px;
                            margin-top: 10px;
                        }
                        .cfs-language-button {
                            padding: 8px 16px;
                            border: 1px solid #555;
                            border-radius: 5px;
                            background-color: #333;
                            color: #ccc;
                            cursor: pointer;
                            transition: all 0.2s;
                        }
                        .cfs-language-button:hover {
                            background-color: #444;
                            border-color: #777;
                        }
                        .cfs-language-button.active {
                            background-color: #03A9F4;
                            color: white;
                            border-color: #03A9F4;
                        }
                        .cfs-new-settings-main {
                            flex-grow: 1;
                            padding: 20px;
                            overflow-y: auto;
                        }
                        .cfs-new-settings-pane {
                            display: none;
                        }
                        .cfs-new-settings-pane.active {
                            display: block;
                        }
                        .cfs-new-settings-pane h3 {
                            margin-top: 0;
                            margin-bottom: 20px;
                            color: #E0E0E0;
                            border-bottom: 1px solid #444;
                            padding-bottom: 10px;
                        }
                        .cfs-new-settings-pane label, .cfs-new-settings-pane p {
                            color: #ccc;
                            font-size: 13px;
                        }
                        .cfs-new-settings-pane input[type="text"],
                        .cfs-new-settings-pane input[type="password"],
                        .cfs-new-settings-pane textarea,
                        .cfs-new-settings-pane select {
                            width: 100%;
                            padding: 8px;
                            margin-top: 4px;
                            margin-bottom: 12px;
                            box-sizing: border-box;
                            background-color: #222;
                            border: 1px solid #555;
                            color: #E0E0E0;
                            border-radius: 4px;
                        }
                        .cfs-new-settings-buttons {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            padding: 15px 20px;
                            border-top: 1px solid #444;
                            gap: 10px;
                        }
                        #cfs-save-new-settings, #cfs-close-new-dialog {
                            padding: 8px 16px;
                            border: none;
                            border-radius: 5px;
                            cursor: pointer;
                            font-weight: bold;
                        }
                        #cfs-save-new-settings {
                            background: #03A9F4;
                            color: #fff;
                        }
                        #cfs-close-new-dialog {
                            background: #4f4f4f;
                            color: #ccc;
                        }


                        .cfs-input-placeholder {
                            padding: 8px;
                            margin-bottom: 12px;
                            background-color: #222;
                            border: 1px solid #555;
                            color: #888; /* Dark text */
                            border-radius: 4px;
                        }
    
                        /* Custom Searchable Select */
                        .cfs-custom-select-wrapper {
                            position: relative;
                            width: 100%;
                        }
                        .cfs-custom-select-selected {
                            width: 100%;
                            padding: 8px;
                            box-sizing: border-box;
                            background-color: #222;
                            border: 1px solid #555;
                            color: #E0E0E0;
                            border-radius: 4px;
                            cursor: pointer;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            position: relative;
                        }
                        .cfs-custom-select-selected:after {
                            content: '↕';
                            position: absolute;
                            right: 10px;
                            top: 50%;
                            transform: translateY(-50%);
                            color: #ccc;
                            font-size: 14px;
                        }
                        .cfs-custom-select-items {
                            position: fixed; /* Use fixed to break out of dialog */
                            z-index: 2100;
                            background: #333;
                            border: 1px solid #555;
                            border-radius: 4px;
                            max-height: 300px;
                            display: flex;
                            flex-direction: column;
                            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
                        }
                        .cfs-select-hide {
                            display: none;
                        }
                        #cfs-model-search-input {
                            flex-shrink: 0;
                            padding: 10px;
                            margin: 0;
                            border: none;
                            border-bottom: 1px solid #555;
                            background: #2a2a2a;
                            color: #eee;
                            outline: none;
                            font-size: 14px;
                        }
                        #cfs-model-options {
                            overflow-y: auto;
                            flex-grow: 1;
                        }
                        #cfs-model-options div {
                            padding: 10px 12px;
                            color: #ccc;
                            cursor: pointer;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                        #cfs-model-options div:hover {
                            background: #4a4a4a;
                        }
                        #cfs-model-options div.selected {
                            background: #03A9F4;
                            color: white;
                        }

                        /* Modal styles (保持与图2风格一致的扁平化) */
                        .cfs-tag-modal {
                            position: fixed;
                            z-index: 1000;
                            left: 0;
                            top: 0;
                            width: 100%;
                            height: 100%;
                            overflow: auto;
                            background-color: rgba(0,0,0,0.7); /* 更深的背景遮罩 */
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .cfs-tag-modal-content {
                            background-color: var(--cfs-background-dark);
                            margin: auto;
                            padding: 20px;
                            border: 1px solid var(--cfs-border-color);
                            width: 80%;
                            max-width: 500px;
                            border-radius: 5px; /* 较小的圆角 */
                            box-shadow: none; /* 移除阴影，扁平化 */
                            display: flex;
                            flex-direction: column;
                            gap: 10px;
                        }
                        .cfs-tag-modal-content h2 {
                            color: var(--cfs-text-color);
                            margin-bottom: 15px;
                            text-align: center;
                        }
                        .cfs-tag-modal-search-input {
                            width: 100%;
                            padding: 8px;
                            box-sizing: border-box;
                            background-color: var(--cfs-background-medium);
                            border: 1px solid var(--cfs-border-color);
                            color: var(--cfs-text-color);
                            border-radius: 4px;
                            font-size: 13px;
                        }
                        .cfs-tag-modal-search-input:focus {
                            border-color: var(--cfs-text-color);
                            outline: none;
                        }
                        .cfs-tag-modal-available-tags {
                            max-height: 300px;
                            overflow-y: auto;
                            display: flex;
                            flex-wrap: wrap;
                            gap: 6px;
                            padding: 8px;
                            border: 1px solid var(--cfs-border-color);
                            background-color: var(--cfs-background-dark);
                            border-radius: 4px;
                            scrollbar-width: thin;
                            scrollbar-color: var(--cfs-tag-border) transparent;
                        }
                        .cfs-tag-modal-available-tags::-webkit-scrollbar {
                            width: 6px;
                        }
                        .cfs-tag-modal-available-tags::-webkit-scrollbar-thumb {
                            background-color: var(--cfs-tag-border);
                            border-radius: 3px;
                        }
                        .cfs-tag-modal-available-tags::-webkit-scrollbar-track {
                            background-color: var(--cfs-background-medium);
                        }
                        .cfs-tag-modal-buttons {
                            display: flex;
                            justify-content: flex-end;
                            margin-top: 10px;
                        }
                        .cfs-tag-modal-close-button {
                            background-color: var(--cfs-tag-bg);
                            color: var(--cfs-text-color);
                            border: 1px solid var(--cfs-tag-border);
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            transition: background-color 0.2s, border-color 0.2s;
                            font-size: 13px;
                        }
                        .cfs-tag-modal-close-button:hover {
                            background-color: var(--cfs-hover-bg);
                            border-color: var(--cfs-text-color);
                        }

                        /* Help Panel Animations */
                        @keyframes cfs-fade-in {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                        @keyframes cfs-scale-up {
                            from { transform: scale(0.95); opacity: 0; }
                            to { transform: scale(1); opacity: 1; }
                        }

                        /* Help Panel */
                        .cfs-help-panel {
                            position: fixed;
                            z-index: 1001;
                            left: 0;
                            top: 0;
                            width: 100%;
                            height: 100%;
                            background-color: rgba(0, 0, 0, 0.8); /* Darker overlay */
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            animation: cfs-fade-in 0.2s ease-out;
                        }
                        .cfs-help-panel-content {
                            background: #2c2c2c;
                            padding: 20px 25px;
                            border: 1px solid #444;
                            width: 90%;
                            max-width: 650px;
                            border-radius: 8px;
                            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                            display: flex;
                            flex-direction: column;
                            gap: 15px;
                            animation: cfs-scale-up 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                        }
                        .cfs-help-panel-content h2 {
                            color: #E0E0E0;
                            margin: 0;
                            text-align: center;
                            font-size: 18px;
                            font-weight: 600;
                            border-bottom: 1px solid #444;
                            padding-bottom: 10px;
                            margin-bottom: 5px;
                        }
                        .cfs-help-panel-content pre {
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                            font-size: 14.5px;
                            color: #e0e0e0;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            background-color: transparent;
                            padding: 0;
                            border-radius: 0;
                            border: none;
                            line-height: 1.8;
                        }
                        .cfs-help-panel-close-button {
                            background: #4f4f4f;
                            color: #fff;
                            border: none;
                            padding: 8px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            transition: all 0.2s ease;
                            align-self: center;
                            font-weight: 600;
                            box-shadow: none;
                            margin-top: 10px;
                        }
                        .cfs-help-panel-close-button:hover {
                            background: #666;
                        }

                        /* Widget Wrapper (Tag Area) */
                        .cfs-widget-wrapper {
                            position: relative; /* For positioning context */
                            width: 100%;
                            display: flex;
                            flex-wrap: wrap;
                            gap: 6px; /* A bit more space */
                            padding: 8px !important;
                            padding-bottom: 16px !important; /* Add more padding to the bottom */
                            border: 1px solid #000; /* Almost invisible border */
                            background: #1a1a1a; /* Very dark background */
                            border-radius: 6px; /* Standard ComfyUI radius */
                            box-sizing: border-box;
                            box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5); /* Deep inner shadow */
                            align-content: flex-start; /* Use align-content for multi-line flex alignment */
                            flex-grow: 1; /* Allow this area to grow */
                            overflow-y: auto; /* Allow scrolling */
                            min-height: 120px; /* 为标签区域设置一个最小高度 */
                        }

                        /* Help Icon */
                        .cfs-help-icon {
                            position: absolute;
                            top: 4px;
                            right: 4px;
                            width: 16px;
                            height: 16px;
                            background-color: #444;
                            color: #ccc;
                            border: 1px solid #666;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 11px;
                            font-weight: bold;
                            cursor: help;
                            z-index: 10;
                            transition: all 0.2s;
                        }
                        .cfs-help-icon:hover {
                            background-color: #555;
                            color: #fff;
                        }

                        /* Tag styles */
                        .cfs-tag {
                            /* background-color is set by JS, using rgba(..., 0.3) for softer look */
                            padding: 4px 10px; /* More horizontal padding */
                            border-radius: 12px; /* Pill-shaped */
                            border: 1px solid; /* border-color is set by JS */
                            display: inline-flex;
                            align-items: center;
                            font-size: 13px;
                            font-weight: normal; /* Cleaner look */
                            /* box-shadow: none; */ /* Flat design */
                            transition: all 0.2s ease-in-out;
                            height: 26px;
                            line-height: 18px;
                            cursor: default;
                        }
                        .cfs-tag:hover {
                           /* No hover effect to keep it clean */
                        }

                        /* Remove button for tags */
                        .cfs-remove-btn {
                            cursor: pointer;
                            margin-left: 8px;
                            font-weight: bold;
                            font-size: 12px;
                            color: inherit;
                            opacity: 0.6;
                            transition: all 0.2s;
                            line-height: 1;
                        }
                        .cfs-remove-btn:hover {
                            opacity: 1;
                            transform: scale(1.1);
                        }
                        .cfs-remove-btn:active {
                            transform: none;
                        }

                        /* Add Tag Button */
                        .cfs-add-tag-button {
                            background-color: #2a2a2a;
                            color: #888;
                            border: 1px solid #333;
                            border-radius: 50%;
                            width: 26px;
                            height: 26px;
                            font-size: 18px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            cursor: pointer;
                            transition: all 0.2s;
                            flex-shrink: 0;
                            line-height: 26px;
                        }
                        .cfs-add-tag-button:hover {
                            background-color: #333;
                            color: #aaa;
                            border-color: #555;
                        }
                        .cfs-add-tag-button:active {
                        }

                        /* Temporary Input for adding tags */
                        .cfs-temp-input {
                            background-color: #333;
                            border: 1px solid #555;
                            color: #E0E0E0;
                            padding: 4px 10px;
                            border-radius: 12px;
                            font-size: 13px;
                            height: 26px;
                            box-sizing: border-box;
                            outline: none;
                            width: 120px; /* Give it a default width */
                            transition: all 0.2s;
                        }
                        .cfs-temp-input:focus {
                            border-color: #888;
                        }

                        /* Selectable Tags in Modal */
                        .cfs-selectable-tag {
                            background-color: var(--cfs-tag-bg);
                            color: var(--cfs-text-color);
                            padding: 4px 8px; /* 调整内边距 */
                            border-radius: 4px;
                            border: 1px solid var(--cfs-tag-border);
                            cursor: pointer;
                            transition: background-color 0.2s, border-color 0.2s;
                            font-size: 13px; /* 调整字体大小 */
                        }
                        .cfs-selectable-tag:hover {
                            background-color: var(--cfs-hover-bg);
                            border-color: var(--cfs-text-color);
                        }
                        .cfs-selectable-tag.selected {
                            background-color: var(--cfs-selected-bg);
                            color: var(--cfs-text-color);
                            cursor: not-allowed;
                            border-color: var(--cfs-text-color);
                        }
                        .cfs-llm-test-buttons {
                            display: flex;
                            gap: 10px;
                            margin-top: 15px;
                        }
                        /* Social buttons removed */
                        .cfs-llm-test-buttons button {
                            padding: 6px 12px;
                            border: 1px solid #555;
                            border-radius: 5px;
                            background-color: #3a3a3a;
                            color: #ccc;
                            cursor: pointer;
                            font-size: 12px;
                            transition: background-color 0.2s;
                        }
                        .cfs-llm-test-buttons button:hover {
                            background-color: #4a4a4a;
                        }
                        .cfs-llm-test-buttons button:disabled {
                            background-color: #2a2a2a;
                            color: #666;
                            cursor: not-allowed;
                        }
                        .cfs-llm-test-result {
                            margin-top: 10px;
                            padding: 8px;
                            background-color: #222;
                            border: 1px solid #444;
                            border-radius: 4px;
                            font-size: 12px;
                            color: #ccc;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            display: none; /* Hidden by default */
                            max-height: 150px;
                            overflow-y: auto;
                        }
                        .cfs-timeout-container {
                            display: flex;
                            align-items: center;
                            gap: 10px;
                            margin-top: 12px;
                        }
                        #cfs-timeout-new {
                            width: 80px;
                            padding: 8px;
                            box-sizing: border-box;
                            background-color: #222;
                            border: 1px solid #555;
                            color: #E0E0E0;
                            border-radius: 4px;
                            margin: 0;
                        }
                    `;
                    style.textContent += `
                       /* Toast Notification */
                       .cfs-toast-container {
                           position: absolute;
                           top: 15px;
                           left: 50%;
                           transform: translateX(-50%);
                           z-index: 2200;
                           display: flex;
                           flex-direction: column;
                           align-items: center;
                           gap: 8px;
                           pointer-events: none;
                       }
                       .cfs-toast {
                           padding: 10px 18px;
                           border-radius: 6px;
                           color: #fff;
                           font-size: 14px;
                           opacity: 0;
                           transition: opacity 0.3s ease, transform 0.3s ease;
                           box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                           white-space: nowrap;
                           transform: translateY(-20px);
                       }
                       .cfs-toast-success {
                           background-color: #4CAF50; /* Green */
                       }
                       .cfs-toast-error {
                           background-color: #f44336; /* Red */
                       }
                       .cfs-toast-info {
                           background-color: #2196F3; /* Blue */
                       }
                   `;
                    document.head.appendChild(style);
                }


                // 强制节点在创建后重新计算其大小
                this.size = this.computeSize();
                this.setDirtyCanvas(true, true);
            };

            const onNodeRemoved_orig = nodeType.prototype.onNodeRemoved;
            nodeType.prototype.onNodeRemoved = function () {
                nodeUIs.delete(this);

                // 清理所有由该节点创建的、附加到 document.body 的UI元素
                const elementsToRemove = document.querySelectorAll(
                    ".cfs-new-settings-dialog, .cfs-help-panel, .cfs-preset-dropdown, .cfs-debug-panel"
                );
                elementsToRemove.forEach(el => el.remove());

                if (onNodeRemoved_orig) {
                    onNodeRemoved_orig.apply(this, arguments);
                }
            };
        }
    }
});
