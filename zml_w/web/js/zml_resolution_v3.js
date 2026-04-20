// zml_resolution_v3.js
// ZML 预设分辨率 V3 节点的管理界面

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const ZML_API_PREFIX = "/zml";

/**
 * 移除任何现有的V3弹窗
 */
function removeExistingV3Dialog() {
    const existingDialog = document.getElementById("zml-v3-dialog-overlay");
    if (existingDialog) {
        existingDialog.remove();
    }
}

/**
 * 创建并显示V3管理主对话框
 */
async function createV3ManageDialog() {
    removeExistingV3Dialog();

    // 获取模型预设列表
    let models = [];
    try {
        const response = await api.fetchApi(ZML_API_PREFIX + "/v3_get_model_presets", { method: "POST" });
        if (response.status === 200) {
            const data = await response.json();
            models = data.models || [];
        }
    } catch (error) {
        console.error("Failed to load model presets:", error);
        models = ["错误：无法加载"];
    }

    const dialogOverlay = document.createElement("div");
    dialogOverlay.id = "zml-v3-dialog-overlay";
    dialogOverlay.className = "zml-dialog-overlay";

    let modelOptionsHtml = models.map(m => `<option value="${m}">${m}</option>`).join('');
    if (models.length === 0 || models[0] === "错误：无法加载") {
        modelOptionsHtml = `<option value="">没有可用模型预设</option>`;
    }

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container" style="width: 550px;">
            <h2>V3 模型预设管理</h2>
            <hr>
            <div class="zml-form-row">
                <label for="zml-v3-select-model">选择模型预设:</label>
                <select id="zml-v3-select-model" ${models.length === 0 || models[0] === "错误：无法加载" ? 'disabled' : ''}>
                    ${modelOptionsHtml}
                </select>
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-action-buttons">
                    <button id="zml-v3-add-model-button" ${models.length === 0 || models[0] === "错误：无法加载" ? '' : ''}>添加模型预设</button>
                    <button id="zml-v3-delete-model-button" ${models.length === 0 || models[0] === "错误：无法加载" ? 'disabled' : ''}>删除模型预设</button>
                    <button id="zml-v3-manage-resolutions-button" ${models.length === 0 || models[0] === "错误：无法加载" ? 'disabled' : ''}>管理分辨率</button>
                    <button id="zml-v3-random-rules-button" ${models.length === 0 || models[0] === "错误：无法加载" ? 'disabled' : ''}>随机规则</button>
                </div>
                <div class="zml-dialog-buttons" style="margin-top: 15px;">
                    <button id="zml-v3-close-dialog">关闭</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const selectModel = dialogOverlay.querySelector("#zml-v3-select-model");
    const addModelBtn = dialogOverlay.querySelector("#zml-v3-add-model-button");
    const deleteModelBtn = dialogOverlay.querySelector("#zml-v3-delete-model-button");
    const manageResBtn = dialogOverlay.querySelector("#zml-v3-manage-resolutions-button");
    const randomRulesBtn = dialogOverlay.querySelector("#zml-v3-random-rules-button");
    const closeBtn = dialogOverlay.querySelector("#zml-v3-close-dialog");

    addModelBtn.onclick = () => createV3AddModelDialog();
    deleteModelBtn.onclick = () => createV3DeleteModelDialog(selectModel.value);
    manageResBtn.onclick = () => createV3ManageResolutionsDialog(selectModel.value);
    randomRulesBtn.onclick = () => createV3RandomRulesDialog(selectModel.value);
    closeBtn.onclick = () => dialogOverlay.remove();
}

/**
 * 创建添加模型预设对话框
 */
function createV3AddModelDialog() {
    removeExistingV3Dialog();

    const dialogOverlay = document.createElement("div");
    dialogOverlay.id = "zml-v3-dialog-overlay";
    dialogOverlay.className = "zml-dialog-overlay";

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container">
            <h2>添加模型预设</h2>
            <hr>
            <div class="zml-form-row">
                <label for="zml-v3-new-model-name">模型预设名称:</label>
                <input type="text" id="zml-v3-new-model-name" placeholder="例如: SDXL">
            </div>
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-v3-confirm-add-model">添加</button>
                    <button id="zml-v3-cancel-add-model">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const nameInput = dialogOverlay.querySelector("#zml-v3-new-model-name");
    const confirmBtn = dialogOverlay.querySelector("#zml-v3-confirm-add-model");
    const cancelBtn = dialogOverlay.querySelector("#zml-v3-cancel-add-model");

    confirmBtn.onclick = async () => {
        const modelName = nameInput.value.trim();
        if (!modelName) {
            alert("模型预设名称不能为空！");
            return;
        }

        try {
            const response = await api.fetchApi(ZML_API_PREFIX + "/v3_add_model_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model_name: modelName }),
            });

            if (response.status === 200) {
                alert(`模型预设 "${modelName}" 添加成功！`);
                dialogOverlay.remove();
                createV3ManageDialog();
            } else {
                alert(await response.text());
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
        }
    };

    cancelBtn.onclick = () => createV3ManageDialog();
}

/**
 * 创建删除模型预设对话框
 */
function createV3DeleteModelDialog(modelName) {
    if (!modelName || modelName.includes("没有") || modelName.includes("错误")) {
        alert("请选择一个有效的模型预设！");
        return;
    }

    if (modelName === "默认") {
        alert("不能删除 '默认' 模型预设！");
        return;
    }

    if (!confirm(`确定要删除模型预设 "${modelName}" 吗？\n这将删除该模型下的所有分辨率预设！\n此操作不可逆！`)) {
        return;
    }

    (async () => {
        try {
            const response = await api.fetchApi(ZML_API_PREFIX + "/v3_delete_model_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model_name: modelName }),
            });

            if (response.status === 200) {
                alert(`模型预设 "${modelName}" 已成功删除！`);
                removeExistingV3Dialog();
                createV3ManageDialog();
            } else {
                alert(await response.text());
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
        }
    })();
}

/**
 * 创建管理分辨率对话框（支持排序、添加、删除、修改）
 */
async function createV3ManageResolutionsDialog(modelName) {
    if (!modelName || modelName.includes("没有") || modelName.includes("错误")) {
        alert("请选择一个有效的模型预设！");
        return;
    }

    removeExistingV3Dialog();

    // 获取分辨率列表
    let resolutions = [];
    try {
        const response = await api.fetchApi(ZML_API_PREFIX + "/v3_get_model_resolutions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model_name: modelName }),
        });
        if (response.status === 200) {
            const data = await response.json();
            resolutions = data.resolutions || [];
        }
    } catch (error) {
        console.error("Failed to load resolutions:", error);
        resolutions = [];
    }

    // 过滤出有效的分辨率预设
    const validResolutions = resolutions.filter(name => 
        !name.includes("没有预设") && !name.includes("错误")
    );

    const dialogOverlay = document.createElement("div");
    dialogOverlay.id = "zml-v3-dialog-overlay";
    dialogOverlay.className = "zml-dialog-overlay";

    // 生成分辨率编辑列表的HTML
    let resolutionEditListHtml = '';
    if (validResolutions.length === 0) {
        resolutionEditListHtml = '<p style="text-align: center; color: #666;">没有可用的分辨率预设，请先添加。</p>';
    } else {
        resolutionEditListHtml = `
            <div id="zml-v3-resolution-list" style="max-height: 300px; overflow-y: auto;">
                ${validResolutions.map((name, index) => {
                    // 从显示名称中提取名称、宽度和高度
                    let presetName = '';
                    let width = 1024;
                    let height = 1024;
                    
                    // 尝试匹配命名格式：名称_宽x高
                    const namedMatch = name.match(/^(.+)_(\d+)x(\d+)$/);
                    if (namedMatch) {
                        presetName = namedMatch[1];
                        width = namedMatch[2];
                        height = namedMatch[3];
                    } else {
                        // 尝试匹配直接格式：宽x高
                        const directMatch = name.match(/^(\d+)x(\d+)$/);
                        if (directMatch) {
                            width = directMatch[1];
                            height = directMatch[2];
                        }
                    }
                    
                    return `
                        <div class="zml-v3-res-item" data-index="${index}" data-original="${name}" style="
                            display: flex;
                            align-items: center;
                            gap: 10px;
                            padding: 10px;
                            margin-bottom: 8px;
                            background-color: rgba(255, 255, 255, 0.7);
                            border-radius: 8px;
                            border: 1px solid #CCEEFF;
                        ">
                            <div class="zml-v3-res-handle" style="cursor: move; width: 20px; text-align: center; color: #666; font-size: 16px; user-select: none;">⋮⋮</div>
                            <div style="flex-grow: 1; display: flex; gap: 10px; align-items: center;">
                                <input type="text" class="zml-v3-res-name" value="${presetName}" placeholder="可选名称" style="width: 120px; padding: 5px; border: 1px solid #CCEEFF; border-radius: 4px;">
                                <input type="number" class="zml-v3-res-width" value="${width}" min="1" style="width: 80px; padding: 5px; border: 1px solid #CCEEFF; border-radius: 4px;">
                                <span>×</span>
                                <input type="number" class="zml-v3-res-height" value="${height}" min="1" style="width: 80px; padding: 5px; border: 1px solid #CCEEFF; border-radius: 4px;">
                            </div>
                            <button class="zml-v3-res-delete" data-name="${name}" style="padding: 5px 15px; background-color: #ff6b6b; color: white; border: none; border-radius: 4px; cursor: pointer;">删除</button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container" style="width: 650px;">
            <h2>管理分辨率 - ${modelName}</h2>
            <hr>
            <p style="color: #666; margin-bottom: 15px;">
                点击并拖动左侧的⋮⋮图标可以调整预设的顺序。
            </p>
            
            <!-- 添加新分辨率 -->
            <div style="margin-bottom: 20px; padding: 15px; background-color: rgba(204, 238, 255, 0.3); border-radius: 8px;">
                <label style="display: block; margin-bottom: 10px; font-weight: 500;">添加新分辨率:</label>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="text" id="zml-v3-new-res-name" placeholder="名称 (可选)" style="width: 120px; padding: 8px; border: 1px solid #CCEEFF; border-radius: 4px;">
                    <input type="number" id="zml-v3-new-res-width" placeholder="宽度" value="1024" min="1" style="width: 80px; padding: 8px; border: 1px solid #CCEEFF; border-radius: 4px;">
                    <span>×</span>
                    <input type="number" id="zml-v3-new-res-height" placeholder="高度" value="1024" min="1" style="width: 80px; padding: 8px; border: 1px solid #CCEEFF; border-radius: 4px;">
                    <button id="zml-v3-add-res-button" style="padding: 8px 20px; background-color: #5CB85C; color: white; border: none; border-radius: 4px; cursor: pointer;">添加</button>
                </div>
            </div>
            
            ${resolutionEditListHtml}
            
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-v3-save-resolutions" ${validResolutions.length === 0 ? 'disabled' : ''}>保存所有修改</button>
                    <button id="zml-v3-back-to-manage">返回</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    // 实现拖动排序功能
    const list = dialogOverlay.querySelector('#zml-v3-resolution-list');
    if (list) {
        let draggedItem = null;

        list.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('zml-v3-res-item')) {
                draggedItem = e.target;
                e.target.style.opacity = '0.5';
            }
        });

        list.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('zml-v3-res-item')) {
                e.target.style.opacity = '1';
                draggedItem = null;
            }
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(list, e.clientY);
            const currentItem = document.querySelector('.zml-v3-res-item[style*="opacity: 0.5"]');
            
            if (currentItem) {
                if (afterElement == null) {
                    list.appendChild(currentItem);
                } else {
                    list.insertBefore(currentItem, afterElement);
                }
            }
        });

        // 设置所有项目为可拖动
        list.querySelectorAll('.zml-v3-res-item').forEach(item => {
            item.setAttribute('draggable', 'true');
        });
    }

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.zml-v3-res-item:not([style*="opacity: 0.5"])')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // 处理删除按钮点击事件
    dialogOverlay.querySelectorAll('.zml-v3-res-delete').forEach(button => {
        button.onclick = async () => {
            const displayNameToDelete = button.getAttribute('data-name');
            
            if (!confirm(`确定要删除预设 "${displayNameToDelete}" 吗？`)) {
                return;
            }

            try {
                const response = await api.fetchApi(ZML_API_PREFIX + "/v3_delete_resolution", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        model_name: modelName,
                        res_display_name: displayNameToDelete 
                    }),
                });

                if (response.status === 200) {
                    alert(`预设 "${displayNameToDelete}" 已成功删除！`);
                    createV3ManageResolutionsDialog(modelName);
                } else {
                    alert(`删除失败: ${await response.text()}`);
                }
            } catch (error) {
                alert(`发生错误: ${error}`);
            }
        };
    });

    // 添加新分辨率
    const addResBtn = dialogOverlay.querySelector("#zml-v3-add-res-button");
    addResBtn.onclick = async () => {
        const nameInput = dialogOverlay.querySelector("#zml-v3-new-res-name");
        const widthInput = dialogOverlay.querySelector("#zml-v3-new-res-width");
        const heightInput = dialogOverlay.querySelector("#zml-v3-new-res-height");

        const resName = nameInput.value.trim();
        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);

        if (isNaN(width) || isNaN(height) || width < 64 || height < 64) {
            alert("请输入有效的宽度和高度 (至少64)");
            return;
        }

        try {
            const response = await api.fetchApi(ZML_API_PREFIX + "/v3_add_resolution", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_name: modelName,
                    res_name: resName,
                    width: width,
                    height: height
                }),
            });

            if (response.status === 200) {
                nameInput.value = "";
                widthInput.value = "1024";
                heightInput.value = "1024";
                createV3ManageResolutionsDialog(modelName);
            } else {
                alert(await response.text());
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
        }
    };

    // 保存所有修改
    const saveBtn = dialogOverlay.querySelector("#zml-v3-save-resolutions");
    const backBtn = dialogOverlay.querySelector("#zml-v3-back-to-manage");

    saveBtn.onclick = async () => {
        const editedResolutions = [];
        const items = dialogOverlay.querySelectorAll('.zml-v3-res-item');
        let isValid = true;
        
        items.forEach(item => {
            const nameInput = item.querySelector('.zml-v3-res-name');
            const widthInput = item.querySelector('.zml-v3-res-width');
            const heightInput = item.querySelector('.zml-v3-res-height');
            
            const name = nameInput.value.trim();
            const width = parseInt(widthInput.value);
            const height = parseInt(heightInput.value);
            
            if (isNaN(width) || isNaN(height) || width < 1 || height < 1) {
                alert(`请确保所有分辨率的宽高都是有效的数字！`);
                isValid = false;
                return;
            }
            
            editedResolutions.push({ name: name, width: width, height: height });
        });
        
        if (!isValid) return;
        
        if (editedResolutions.length === 0) {
            alert("没有可保存的分辨率预设！");
            return;
        }
        
        try {
            const response = await api.fetchApi(ZML_API_PREFIX + "/v3_update_resolutions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_name: modelName,
                    resolutions: editedResolutions
                }),
            });

            if (response.status === 200) {
                alert("所有修改已保存！");
                createV3ManageResolutionsDialog(modelName);
            } else {
                alert(`保存失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
        }
    };

    backBtn.onclick = () => createV3ManageDialog();
}

/**
 * 创建随机规则对话框
 */
async function createV3RandomRulesDialog(modelName) {
    if (!modelName || modelName.includes("没有") || modelName.includes("错误")) {
        alert("请选择一个有效的模型预设！");
        return;
    }

    removeExistingV3Dialog();

    // 获取分辨率列表和随机规则
    let resolutions = [];
    let rules = {};
    
    try {
        const resResponse = await api.fetchApi(ZML_API_PREFIX + "/v3_get_model_resolutions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model_name: modelName }),
        });
        if (resResponse.status === 200) {
            const data = await resResponse.json();
            resolutions = data.resolutions || [];
        }

        const rulesResponse = await api.fetchApi(ZML_API_PREFIX + "/v3_get_random_rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model_name: modelName }),
        });
        if (rulesResponse.status === 200) {
            const data = await rulesResponse.json();
            rules = data.rules || {};
        }
    } catch (error) {
        console.error("Failed to load data:", error);
    }

    // 过滤出有效的分辨率预设
    const validResolutions = resolutions.filter(name => 
        !name.includes("没有预设") && !name.includes("错误")
    );

    const dialogOverlay = document.createElement("div");
    dialogOverlay.id = "zml-v3-dialog-overlay";
    dialogOverlay.className = "zml-dialog-overlay";

    let rulesHtml = '';
    if (validResolutions.length === 0) {
        rulesHtml = '<p style="text-align: center; color: #666;">没有可用的分辨率预设。</p>';
    } else {
        rulesHtml = `
            <div style="max-height: 400px; overflow-y: auto;">
                <p style="color: #666; margin-bottom: 15px;">
                    勾选的分辨率会在随机模式中被选中，未勾选的将被排除。
                </p>
                ${validResolutions.map(name => {
                    const isChecked = rules[name] !== false; // 默认为 true
                    return `
                        <div style="display: flex; align-items: center; padding: 10px; margin-bottom: 8px; background-color: rgba(255, 255, 255, 0.7); border-radius: 8px; border: 1px solid #CCEEFF;">
                            <input type="checkbox" class="zml-v3-rule-checkbox" data-name="${name}" ${isChecked ? 'checked' : ''} style="margin-right: 10px; width: 18px; height: 18px;">
                            <span>${name}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    dialogOverlay.innerHTML = `
        <div class="zml-dialog-container" style="width: 500px;">
            <h2>随机规则 - ${modelName}</h2>
            <hr>
            ${rulesHtml}
            <div class="zml-dialog-footer">
                <div class="zml-dialog-buttons">
                    <button id="zml-v3-save-rules" ${validResolutions.length === 0 ? 'disabled' : ''}>保存规则</button>
                    <button id="zml-v3-back-to-manage">返回</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialogOverlay);

    const saveBtn = dialogOverlay.querySelector("#zml-v3-save-rules");
    const backBtn = dialogOverlay.querySelector("#zml-v3-back-to-manage");

    saveBtn.onclick = async () => {
        const newRules = {};
        dialogOverlay.querySelectorAll('.zml-v3-rule-checkbox').forEach(checkbox => {
            const name = checkbox.getAttribute('data-name');
            newRules[name] = checkbox.checked;
        });

        try {
            const response = await api.fetchApi(ZML_API_PREFIX + "/v3_set_random_rules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_name: modelName,
                    rules: newRules
                }),
            });

            if (response.status === 200) {
                alert("随机规则已保存！");
            } else {
                alert(`保存失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
        }
    };

    backBtn.onclick = () => createV3ManageDialog();
}

// ============================== 节点扩展注册 ==============================

app.registerExtension({
    name: "ZML.ResolutionV3.Manager",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // 仅针对 ZML_PresetResolutionV3 节点
        if (nodeData.name !== "ZML_PresetResolutionV3") return;
        
        // 保存原始的 onNodeCreated
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
            const node = this;
            
            // 找到所有相关的 widgets
            const modelWidget = node.widgets.find(w => w.name === "模型预设");
            const resolutionWidget = node.widgets.find(w => w.name === "分辨率预设");
            const customWidthWidget = node.widgets.find(w => w.name === "自定义宽");
            const customHeightWidget = node.widgets.find(w => w.name === "自定义高");
            const randomModeWidget = node.widgets.find(w => w.name === "随机模式");
            
            // 定义更新UI可见性的函数
            const updateUIVisibility = () => {
                const isCustomMode = modelWidget && modelWidget.value === "自定义";
                
                // 自定义模式时：显示自定义宽高，隐藏预设和随机模式
                // 非自定义模式时：显示预设和随机模式，隐藏自定义宽高
                if (resolutionWidget) {
                    if (isCustomMode) {
                        resolutionWidget.type = "hidden";
                        resolutionWidget.computeSize = () => [0, -4];
                    } else {
                        resolutionWidget.type = "combo";
                        resolutionWidget.computeSize = undefined;
                    }
                }
                if (randomModeWidget) {
                    if (isCustomMode) {
                        randomModeWidget.type = "hidden";
                        randomModeWidget.computeSize = () => [0, -4];
                    } else {
                        randomModeWidget.type = "toggle";
                        randomModeWidget.computeSize = undefined;
                    }
                }
                if (customWidthWidget) {
                    if (!isCustomMode) {
                        customWidthWidget.type = "hidden";
                        customWidthWidget.computeSize = () => [0, -4];
                    } else {
                        customWidthWidget.type = "number";
                        customWidthWidget.computeSize = undefined;
                    }
                }
                if (customHeightWidget) {
                    if (!isCustomMode) {
                        customHeightWidget.type = "hidden";
                        customHeightWidget.computeSize = () => [0, -4];
                    } else {
                        customHeightWidget.type = "number";
                        customHeightWidget.computeSize = undefined;
                    }
                }
                
                // 重新计算节点大小
                node.setSize(node.computeSize());
                
                // 触发节点更新以重绘
                node.setDirtyCanvas(true, true);
            };
            
            if (modelWidget && resolutionWidget) {
                // 标记是否正在更新，防止循环
                let isUpdating = false;
                
                // 定义更新分辨率预设的函数
                const updateResolutions = async (modelName) => {
                    if (isUpdating) return;
                    isUpdating = true;
                    
                    try {
                        const response = await api.fetchApi(ZML_API_PREFIX + "/v3_get_model_resolutions", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model_name: modelName }),
                        });
                        
                        if (response.status === 200) {
                            const data = await response.json();
                            const newResolutions = data.resolutions || [];
                            
                            // 过滤掉无效选项
                            const validResolutions = newResolutions.filter(name => 
                                !name.includes("没有预设") && !name.includes("错误")
                            );
                            
                            if (validResolutions.length === 0) {
                                validResolutions.push("没有预设");
                            }
                            
                            // 更新分辨率预设 widget 的选项
                            resolutionWidget.options.values = validResolutions;
                            
                            // 如果当前值不在新列表中，重置为第一个选项
                            if (!validResolutions.includes(resolutionWidget.value)) {
                                resolutionWidget.value = validResolutions[0];
                            }
                            
                            // 触发节点更新
                            node.setDirtyCanvas(true, true);
                        }
                    } catch (error) {
                        console.error("Failed to update resolutions:", error);
                    } finally {
                        isUpdating = false;
                    }
                };
                
                // 保存原始的 callback
                const originalCallback = modelWidget.callback;
                
                // 重写 callback，在值改变时更新分辨率预设选项和UI可见性
                modelWidget.callback = function(value) {
                    // 调用原始 callback（如果有）
                    if (originalCallback) {
                        originalCallback.apply(this, arguments);
                    }
                    
                    // 更新UI可见性（根据是否为自定义模式）
                    updateUIVisibility();
                    
                    // 如果不是自定义模式，更新分辨率预设
                    if (value !== "自定义") {
                        updateResolutions(value);
                    }
                };
                
                // 节点创建时，根据当前模型预设初始化
                setTimeout(() => {
                    // 初始化UI可见性
                    updateUIVisibility();
                    
                    // 如果不是自定义模式，加载分辨率列表
                    if (modelWidget.value !== "自定义") {
                        updateResolutions(modelWidget.value);
                    }
                }, 0);
            }
            
            return r;
        };
    },
    
    nodeCreated(node) {
        // 为 V3 节点添加管理按钮
        if (node.comfyClass === "ZML_PresetResolutionV3") {
            node.addWidget("button", "管理模型预设", null, () => {
                createV3ManageDialog();
            });
        }
    }
});

console.log("ZML Resolution V3 Manager loaded");
