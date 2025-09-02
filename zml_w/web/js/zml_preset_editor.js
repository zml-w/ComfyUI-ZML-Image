// zml_preset_editor.js
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// 定义通用弹窗样式 - 简约浅蓝色风格
const DIALOG_STYLE_TEXT = `
    .zml-dialog-overlay {
        position: fixed; 
        top: 0; 
        left: 0; 
        width: 100%; 
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5); /* 半透明背景 */
        display: flex; 
        align-items: center; 
        justify-content: center; 
        z-index: 1001;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; /* 现代无衬线字体 */
        animation: fadeIn 0.2s ease-out; /* 快速淡入 */
    }

    .zml-dialog-container {
        background: #F0F8FF; /* 淡蓝色背景 */
        padding: 25px; 
        border-radius: 12px; /* 适度圆角 */
        width: 480px; 
        box-shadow: 0 6px 15px rgba(0,0,0,0.2); /* 柔和阴影 */
        color: #333; /* 深色字体 */
        border: 1px solid #B0D0E0; /* 浅蓝色边框 */
        display: flex; 
        flex-direction: column; 
        gap: 15px; 
        max-height: 90vh; 
        overflow-y: auto; 
        animation: slideIn 0.2s ease-out; /* 从顶部滑入 */
    }

    .zml-dialog-container::-webkit-scrollbar {
        width: 6px;
    }
    .zml-dialog-container::-webkit-scrollbar-track {
        background: #E0EBF5;
        border-radius: 3px;
    }
    .zml-dialog-container::-webkit-scrollbar-thumb {
        background: #A8D8F0;
        border-radius: 3px;
    }
    .zml-dialog-container::-webkit-scrollbar-thumb:hover {
        background: #83CDE5;
    }

    .zml-dialog-container h2 { 
        margin-top: 5px; 
        margin-bottom: 15px; 
        text-align: center; 
        color: #0F4C81; /* 深蓝色标题 */
        font-size: 1.8em; 
        font-weight: 600;
    }
    .zml-dialog-container hr {
        border: none;
        border-top: 1px dashed #C0D8E8; /* 虚线分隔 */
        margin: 10px 0;
    }
    .zml-form-row { 
        margin-bottom: 12px; 
    }
    .zml-form-row label { 
        display: block; 
        margin-bottom: 6px; 
        font-size: 1em; 
        font-weight: 500;
        color: #3A668E; /* 中蓝色标签 */
    }
    .zml-form-row input, 
    .zml-form-row textarea, 
    .zml-form-row select {
        width: 100%; 
        box-sizing: border-box; 
        background: #FFFFFF; /* 白色背景 */
        color: #333;
        border: 1px solid #CCEEFF; /* 浅边框 */
        border-radius: 8px; /* 较小圆角 */
        padding: 10px; 
        font-size: 1em; 
        -webkit-appearance: none; 
        -moz-appearance: none;    
        appearance: none;
        transition: all 0.15s ease-out; 
    }
    .zml-form-row input:focus, 
    .zml-form-row textarea:focus, 
    .zml-form-row select:focus {
        outline: none;
        border-color: #6FAEE0; /* 选中时边框变色 */
        box-shadow: 0 0 0 3px rgba(111,174,224,0.3); /* 选中时柔和发光 */
    }

    .zml-form-row input.small-input {
        width: calc(50% - 7.5px); 
        display: inline-block;
    }
    .zml-form-row input.small-input:first-child {
        margin-right: 15px; 
    }
    .zml-form-row select {
        padding-right: 35px; 
        background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%230F4C81%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20128c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4l128-128c3.8-3.6%205.6-7.8%205.6-12.8-.2-5-1.8-9.2-5.4-12.8z%22%2F%3E%3C%2Fsvg%3E'); 
        background-repeat: no-repeat, repeat;
        background-position: right 0.8em top 50%, 0 0;
        background-size: 0.7em auto, 100%; 
    }
    .zml-dialog-footer {
        display: flex;
        flex-direction: column; 
        align-items: center;
        margin-top: 15px;
        gap: 10px; 
    }

    .zml-dialog-buttons {
        display: flex;
        justify-content: center;
        gap: 15px; 
    }
    .zml-dialog-buttons button,
    .zml-action-buttons button {
        padding: 10px 20px; 
        border-radius: 8px; 
        border: none;
        cursor: pointer; 
        font-weight: 500; 
        font-size: 1em;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1); 
        transition: background-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
    }
    .zml-dialog-buttons button:hover,
    .zml-action-buttons button:hover {
        transform: translateY(-1px); 
        box-shadow: 0 4px 8px rgba(0,0,0,0.15); 
    }
    .zml-dialog-buttons button:active,
    .zml-action-buttons button:active {
        transform: translateY(0); 
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    #zml-add-preset-button, 
    #zml-delete-resolution-confirm, 
    #zml-manage-add-button, 
    #zml-manage-delete-button,
    #zml-add-text-category-button, 
    #zml-add-text-preset-button { 
        background-color: #5CB85C; /* 绿色 */
        color: white; 
        background: linear-gradient(180deg, #6FD06F, #5CB85C); /* 绿色渐变 */
    }
    #zml-add-preset-button:hover, 
    #zml-delete-resolution-confirm:hover, 
    #zml-manage-add-button:hover, 
    #zml-manage-delete-button:hover,
    #zml-add-text-category-button:hover,
    #zml-add-text-preset-button:hover { 
        background: linear-gradient(180deg, #82DB82, #6FC76F); 
    }

    #zml-cancel-preset, 
    #zml-close-dialog, 
    #zml-manage-cancel-button { 
        background-color: #6C757D; /* 灰色 */
        color: white; 
        background: linear-gradient(180deg, #7A828B, #6C757D); /* 灰色渐变 */
    }
    #zml-cancel-preset:hover, 
    #zml-close-dialog:hover, 
    #zml-manage-cancel-button:hover { 
        background: linear-gradient(180deg, #8E979F, #7A828B); 
    }

    /* 红色用于删除操作 */
    #zml-delete-resolution-button,
    #zml-delete-text-preset-confirm { 
        background-color: #DC3545; 
        color: white;
        background: linear-gradient(180deg, #E65A68, #DC3545); 
    }
    #zml-delete-resolution-button:hover,
    #zml-delete-text-preset-confirm:hover {
        background: linear-gradient(180deg, #F07E88, #E65A68); 
    }

    .zml-action-buttons {
        display: flex;
        gap: 15px; 
        justify-content: center;
        margin-top: 20px;
    }

    /* 动画关键帧 */
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes slideIn {
        from { 
            transform: translateY(-20px) scale(0.95); 
            opacity: 0; 
        }
        to { 
            transform: translateY(0) scale(1); 
            opacity: 1; 
        }
    }
`;

/**
 * 移除任何现有的ZML弹窗
 */
function removeExistingDialog() {
    const existingDialog = document.querySelector(".zml-dialog-overlay");
    if (existingDialog) {
        existingDialog.remove();
    }
}


/**
 * ============================== 文本预设相关弹窗 ==============================
 */


/**
 * 创建并显示一个用于添加文本预设的弹窗
 */
async function createTextAddDialog() {
    removeExistingDialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "zml-dialog-overlay";

    // 获取固定分类列表
    let categories = [];
    try {
        const response = await api.fetchApi("/zml/get_fixed_text_categories", { method: "POST" });
        if (response.status === 200) {
            const data = await response.json();
            categories = data.categories; // 例如 ["预设类别1", "预设类别2", ...]
        }
    } catch (error) {
        console.error("Failed to load fixed text categories:", error);
        categories = ["错误：无法加载分类"];
    }

    let categoryOptionsHtml = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    if (categories.length === 0 || categories[0] === "错误：无法加载分类") { // 如果没有有效分类，提供提示
        categoryOptionsHtml = `<option value="">没有可用分类</option>`;
    }


    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container">
            <h2>添加新的文本预设</h2>
            <hr>
            <div class="zml-form-row">
                <label for="zml-preset-text-category">选择预设类别:</label>
                <select id="zml-preset-text-category" ${categories.length === 0 || categories[0] === "错误：无法加载分类" ? 'disabled' : ''}>${categoryOptionsHtml}</select>
            </div>
            <div class="zml-form-row">
                <label for="zml-preset-text-name">预设名称:</label>
                <input type="text" id="zml-preset-text-name" placeholder="例如: 正面提示词">
            </div>
            <div class="zml-form-row">
                <label for="zml-preset-text-value">预设内容:</label>
                <textarea id="zml-preset-text-value" rows="5" placeholder="例如: best quality, masterpiece"></textarea>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-add-text-preset-button" ${categories.length === 0 || categories[0] === "错误：无法加载分类" ? 'disabled' : ''}>添加</button>
                    <button id="zml-cancel-preset">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const selectCategory = dialogOverlay.querySelector("#zml-preset-text-category");
    const addButton = dialogOverlay.querySelector("#zml-add-text-preset-button");
    const cancelButton = dialogOverlay.querySelector("#zml-cancel-preset");
    const nameInput = dialogOverlay.querySelector("#zml-preset-text-name");
    const valueInput = dialogOverlay.querySelector("#zml-preset-text-value");

    addButton.onclick = async () => {
        const category_name = selectCategory.value;
        const preset_name = nameInput.value.trim();
        const preset_value = valueInput.value.trim();

        if (category_name === "没有可用分类" || category_name.includes("错误")) {
             alert("没有可用分类，无法添加预设！");
             return;
        }
        if (!preset_name || !preset_value) {
            alert("预设名称和内容均不能为空！");
            return;
        }

        try {
            const response = await api.fetchApi("/zml/add_text_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category_name, preset_name, preset_value }),
            });

            if (response.status === 200) {
                alert("文本预设已成功添加！");
                dialogOverlay.remove();
            } else if (response.status === 409) {
                alert(await response.text()); 
            } else {
                alert(`添加失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
            console.error("ZML Text Preset Add Error:", error);
        }
    };

    cancelButton.onclick = () => {
        dialogOverlay.remove();
    };
}


/**
 * 创建并显示一个用于删除文本预设的弹窗
 */
async function createTextDeleteDialog() {
    removeExistingDialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "zml-dialog-overlay";

    let categories = [];
    try {
        const response = await api.fetchApi("/zml/get_fixed_text_categories", { method: "POST" });
        if (response.status === 200) {
            const data = await response.json();
            categories = data.categories;
        }
    } catch (error) {
        console.error("Failed to load fixed text categories:", error);
        categories = ["错误：无法加载分类"];
    }


    let categoryOptionsHtml = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    // 如果没有有效分类，提供提示
    if (categories.length === 0 || categories[0] === "错误：无法加载分类") { 
        categoryOptionsHtml = `<option value="">没有可用分类</option>`;
    }

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container">
            <h2>删除文本预设</h2>
            <hr>
            <div class="zml-form-row">
                <label for="zml-delete-text-preset-category">选择预设类别:</label>
                <select id="zml-delete-text-preset-category" ${categories.length === 0 || categories[0] === "错误：无法加载分类" ? 'disabled' : ''}>${categoryOptionsHtml}</select>
            </div>
            <div class="zml-form-row">
                <label for="zml-delete-text-preset-name">选择要删除的预设:</label>
                <select id="zml-delete-text-preset-name" disabled>
                    <option value="">请先选择类别</option>
                </select>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-delete-text-preset-confirm" disabled>删除</button>
                    <button id="zml-close-dialog">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const selectCategory = dialogOverlay.querySelector("#zml-delete-text-preset-category");
    const selectPreset = dialogOverlay.querySelector("#zml-delete-text-preset-name");
    const confirmButton = dialogOverlay.querySelector("#zml-delete-text-preset-confirm");
    const closeButton = dialogOverlay.querySelector("#zml-close-dialog");

    const updatePresetsDropdown = async () => {
        const selectedCategory = selectCategory.value;
        // 检查分类是否有效
        if (selectedCategory && selectedCategory !== "没有可用分类" && !selectedCategory.includes("错误")) {
            try {
                const response = await api.fetchApi("/zml/get_text_presets_in_category", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ category_name: selectedCategory }),
                });
                if (response.status === 200) {
                    const data = await response.json();
                    let preset_names = data.presets;

                    // 确保如果只有占位符，就禁用删除
                    const hasRealPresets = preset_names.length > 0 && preset_names[0] !== "没有预设 (请添加)";
                    
                    selectPreset.innerHTML = preset_names.map(p => `<option value="${p}">${p}</option>`).join('');
                    selectPreset.disabled = !hasRealPresets;
                    confirmButton.disabled = !hasRealPresets;
                } else {
                    selectPreset.innerHTML = '<option value="">错误：无法加载预设</option>';
                    selectPreset.disabled = true;
                    confirmButton.disabled = true;
                }
            } catch (error) {
                console.error("Failed to load presets for category:", error);
                selectPreset.innerHTML = '<option value="">错误：无法加载预设</option>';
                selectPreset.disabled = true;
                confirmButton.disabled = true;
            }
        } else { // 无效分类选项
            selectPreset.innerHTML = '<option value="">请先选择类别</option>';
            selectPreset.disabled = true;
            confirmButton.disabled = true;
        }
    };

    // 初始化时尝试加载预设列表
    if (categories.length > 0 && categories[0] !== "没有可用分类" && !categories[0].includes("错误")) {
        selectCategory.value = categories[0]; // 默认选中第一个可用分类
        updatePresetsDropdown();
    } else {
        selectCategory.disabled = true;
        selectPreset.innerHTML = '<option value="">没有可用预设</option>'; // 明确提示没有预设
    }
    
    selectCategory.onchange = updatePresetsDropdown; // 绑定change事件


    confirmButton.onclick = async () => {
        const category_name = selectCategory.value;
        const preset_name_to_delete = selectPreset.value;

        if (!category_name || category_name.includes("没有可用分类") || category_name.includes("错误")) {
            alert("请选择一个有效的分类！");
            return;
        }
        if (!preset_name_to_delete || preset_name_to_delete.includes("没有预设")) { // 明确检查占位符
            alert("请选择要删除的预设！");
            return;
        }

        if (!confirm(`确定要删除分类 "${category_name}" 下的预设 "${preset_name_to_delete}" 吗？\n此操作不可逆！`)) {
            return;
        }

        try {
            const response = await api.fetchApi("/zml/delete_text_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category_name, preset_name: preset_name_to_delete }),
            });

            if (response.status === 200) {
                alert(`预设 "${preset_name_to_delete}" 已成功删除！`);
                dialogOverlay.remove();
            } else {
                alert(`删除失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
            console.error("ZML Text Preset Delete Error:", error);
        }
    };

    closeButton.onclick = () => {
        dialogOverlay.remove();
    };
}


/**
 * 创建用于管理文本预设的主弹窗（包含添加和删除按钮）
 */
function createTextManageDialog() {
    removeExistingDialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "zml-dialog-overlay";

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container" style="width: 380px; padding: 30px 25px;">
            <h2>管理文本预设</h2>
            <hr>
            <p style="text-align: center; color: #3A668E; font-size: 1em; font-weight: 500; margin-bottom: 5px;">
                选择您的操作:
            </p>
            <div class="zml-action-buttons">
                <button id="zml-manage-add-text-button">添加文本预设</button>
                <button id="zml-manage-delete-text-button">删除文本预设</button>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-manage-cancel-button">关闭</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const addButton = dialogOverlay.querySelector("#zml-manage-add-text-button");
    const deleteButton = dialogOverlay.querySelector("#zml-manage-delete-text-button");
    const cancelButton = dialogOverlay.querySelector("#zml-manage-cancel-button");

    addButton.onclick = () => {
        dialogOverlay.remove();
        createTextAddDialog();
    };

    deleteButton.onclick = () => {
        dialogOverlay.remove();
        createTextDeleteDialog();
    };

    cancelButton.onclick = () => {
        dialogOverlay.remove();
    };
}


/**
 * ============================== 分辨率预设相关弹窗 ==============================
 */

/**
 * 创建并显示一个用于添加分辨率预设的弹窗
 */
function createResolutionAddDialog() {
    removeExistingDialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "zml-dialog-overlay";

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container">
            <h2>添加新的分辨率预设</h2>
            <hr>
            <div class="zml-form-row">
                <label for="zml-preset-resolution-name">预设名称 (可选，如为空则只显示宽x高):</label>
                <input type="text" id="zml-preset-resolution-name" placeholder="例如: 方形, 横版, 竖版">
            </div>
            <div class="zml-form-row" style="display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="flex-grow: 1;">
                    <label for="zml-preset-resolution-width">宽度 (W):</label>
                    <input type="number" id="zml-preset-resolution-width" value="1024" min="1" class="small-input"> <!-- 移除 step="64" -->
                </div>
                <div style="flex-grow: 1;">
                    <label for="zml-preset-resolution-height">高度 (H):</label>
                    <input type="number" id="zml-preset-resolution-height" value="768" min="1" class="small-input"> <!-- 移除 step="64" -->
                </div>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-add-preset-button">添加</button>
                    <button id="zml-cancel-preset">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const saveButton = dialogOverlay.querySelector("#zml-add-preset-button");
    const cancelButton = dialogOverlay.querySelector("#zml-cancel-preset");
    const nameInput = dialogOverlay.querySelector("#zml-preset-resolution-name");
    const widthInput = dialogOverlay.querySelector("#zml-preset-resolution-width");
    const heightInput = dialogOverlay.querySelector("#zml-preset-resolution-height");

    // 添加自定义验证逻辑，阻止浏览器默认提示
    [widthInput, heightInput].forEach(input => {
        input.addEventListener('invalid', function(event) {
            event.preventDefault(); // 阻止浏览器显示默认提示
            // 您可以在此处添加您自己的视觉反馈，例如改变输入框边框颜色
            console.log('Validation failed:', this.validationMessage);
            // 或者使用alert来提示，但通常不推荐频繁弹窗
            // alert(`输入无效: ${this.value}, 请输入正确的数字。`);
        });
        input.addEventListener('input', function() {
            // 用户再次输入时，理论上应该再次验证，但因为我们阻止了默认行为，
            // 浏览器不会自动重置 validity 状态，所以这里不需要 setCustomValidity("")
            // 如果希望有自己的错误消息显示在其他地方，需要在这里更新
        });
    });


    saveButton.onclick = async () => {
        const preset_name = nameInput.value.trim();
        const width = widthInput.value;
        const height = heightInput.value;

        // 手动进行输入验证
        if (!width || !height) {
            alert("宽度和高度不能为空！");
            return;
        }
        
        const parsedWidth = parseInt(width);
        const parsedHeight = parseInt(height);

        if (isNaN(parsedWidth) || isNaN(parsedHeight)) {
            alert("宽度和高度必须是有效的数字！");
            return;
        }

        // 进一步的范围或步长验证 (可选，如果仍需要特定规则)
        // 例如：
        // if (parsedWidth < 1 || parsedWidth > 16384) {
        //     alert("宽度必须在 1 到 16384 之间！");
        //     return;
        // }
        // if (parsedHeight < 1 || parsedHeight > 16384) {
        //     alert("高度必须在 1 到 16384 之间！");
        //     return;
        // }


        try {
            const response = await api.fetchApi("/zml/add_resolution_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ preset_name, width: parsedWidth, height: parsedHeight }),
            });

            if (response.status === 200) {
                alert("分辨率预设已成功添加！");
                dialogOverlay.remove();
            } else {
                alert(`添加失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
            console.error("ZML Resolution Preset Add Error:", error);
        }
    };

    cancelButton.onclick = () => {
        dialogOverlay.remove();
    };
}


/**
 * 创建并显示一个用于删除分辨率预设的弹窗
 * @param {Array<string>} resolutionNames - 当前加载的所有分辨率预设的显示名称
 */
function createResolutionDeleteDialog(resolutionNames) {
    removeExistingDialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "zml-dialog-overlay";

    let optionsHtml = '';
    const deletableResolutions = resolutionNames.filter(name => 
        !name.includes("文件为空") && !name.includes("错误：无法加载") && !name.includes("没有预设")
    );

    if (deletableResolutions.length === 0) {
        optionsHtml = `<option value="">没有可删除的预设</option>`;
    } else {
        deletableResolutions.forEach(name => {
            optionsHtml += `<option value="${name}">${name}</option>`;
        });
    }
    

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container">
            <h2>删除分辨率预设</h2>
            <hr>
            <div class="zml-form-row">
                <label for="zml-delete-resolution-select">选择要删除的预设:</label>
                <select id="zml-delete-resolution-select">
                    ${optionsHtml}
                </select>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-delete-resolution-confirm" ${deletableResolutions.length === 0 ? 'disabled' : ''}>删除</button>
                    <button id="zml-close-dialog">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const confirmButton = dialogOverlay.querySelector("#zml-delete-resolution-confirm");
    const closeButton = dialogOverlay.querySelector("#zml-close-dialog");
    const selectElement = dialogOverlay.querySelector("#zml-delete-resolution-select");

    confirmButton.onclick = async () => {
        const display_name_to_delete = selectElement.value;

        if (!display_name_to_delete || display_name_to_delete === "没有可删除的预设") {
            alert("请选择一个有效的预设进行删除！");
            return;
        }

        if (!confirm(`确定要删除预设 "${display_name_to_delete}" 吗？\n此操作不可逆！`)) {
            return;
        }

        try {
            const response = await api.fetchApi("/zml/delete_resolution_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ display_name: display_name_to_delete }),
            });

            if (response.status === 200) {
                alert(`预设 "${display_name_to_delete}" 已成功删除！`);
                dialogOverlay.remove();
            } else {
                alert(`删除失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
            console.error("ZML Resolution Preset Delete Error:", error);
        }
    };

    closeButton.onclick = () => {
        dialogOverlay.remove();
    };
}


/**
 * 创建用于管理分辨率预设的主弹窗（包含添加和删除按钮）
 * @param {Array<string>} resolutionNames - 当前加载的所有分辨率预设的显示名称
 */
function createResolutionManageDialog(resolutionNames) {
    removeExistingDialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "zml-dialog-overlay";

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container" style="width: 380px; padding: 30px 25px;">
            <h2>管理分辨率预设</h2>
            <hr>
            <p style="text-align: center; color: #3A668E; font-size: 1em; font-weight: 500; margin-bottom: 5px;">
                选择您的操作:
            </p>
            <div class="zml-action-buttons">
                <button id="zml-manage-add-button">添加分辨率</button>
                <button id="zml-manage-delete-button">删除分辨率</button>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-manage-cancel-button">关闭</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const addButton = dialogOverlay.querySelector("#zml-manage-add-button");
    const deleteButton = dialogOverlay.querySelector("#zml-manage-delete-button");
    const cancelButton = dialogOverlay.querySelector("#zml-manage-cancel-button");

    addButton.onclick = () => {
        dialogOverlay.remove(); 
        createResolutionAddDialog(); 
    };

    deleteButton.onclick = () => {
        dialogOverlay.remove(); 
        createResolutionDeleteDialog(resolutionNames); 
    };

    cancelButton.onclick = () => {
        dialogOverlay.remove();
    };
}


// 注册ComfyUI扩展
app.registerExtension({
    name: "ZML.PresetEditor",
    async setup(app) {
        const style = document.createElement('style');
        style.textContent = DIALOG_STYLE_TEXT;
        document.head.appendChild(style);
    },

    nodeCreated(node) {
        // 为“预设文本”节点添加“管理文本预设”按钮
        if (node.comfyClass === "ZML_PresetText") {
            node.addWidget( "button", "管理文本预设", null, () => createTextManageDialog() );
        }
        
        // 为“预设分辨率”节点添加“管理预设”按钮
        if (node.comfyClass === "ZML_PresetResolution") {
            node.addWidget("button", "管理预设", null, () => {
                const widget = node.widgets.find(w => w.name === "预设");
                let currentResolutions = [];
                if (widget && widget.options && widget.options.values) {
                    currentResolutions = widget.options.values;
                }
                createResolutionManageDialog(currentResolutions);
            });
        }
    }
});
