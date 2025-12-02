import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// ================= CSS 样式 (仅保留弹窗样式) =================
const LLM_DIALOG_STYLE = `
    .zml-llm-dialog-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.5); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Segoe UI', sans-serif;
    }
    .zml-llm-dialog-container {
        background: #F0F8FF; padding: 25px; border-radius: 12px;
        width: 450px; box-shadow: 0 6px 15px rgba(0,0,0,0.2);
        border: 1px solid #B0D0E0; display: flex; flex-direction: column; gap: 15px;
    }
    .zml-llm-dialog-container h3 {
        margin: 0 0 10px 0; color: #0F4C81; text-align: center;
    }
    .zml-llm-form-row label {
        display: block; margin-bottom: 5px; color: #3A668E; font-weight: 500; font-size: 0.9em;
    }
    .zml-llm-form-row input {
        width: 100%; padding: 8px; border: 1px solid #CCEEFF; border-radius: 6px;
        box-sizing: border-box; outline: none;
    }
    .zml-llm-form-row input:focus { border-color: #6FAEE0; box-shadow: 0 0 0 2px rgba(111,174,224,0.3); }
    .zml-llm-buttons { display: flex; justify-content: center; gap: 15px; margin-top: 10px; }
    .zml-llm-btn {
        padding: 8px 20px; border-radius: 6px; border: none; cursor: pointer; color: white;
    }
    .zml-llm-btn-save { background: linear-gradient(180deg, #6FD06F, #5CB85C); }
    .zml-llm-btn-save:hover { background: linear-gradient(180deg, #82DB82, #6FC76F); }
    .zml-llm-btn-cancel { background: linear-gradient(180deg, #7A828B, #6C757D); }
    .zml-llm-btn-cancel:hover { background: linear-gradient(180deg, #8E979F, #7A828B); }
`;

// 注入 CSS
const styleEl = document.createElement("style");
styleEl.textContent = LLM_DIALOG_STYLE;
document.head.appendChild(styleEl);

// 缓存键名
const STORAGE_KEY = "zml_llm_config_cache";

// 默认配置 (已修改为 DeepSeek)
const DEFAULT_CONFIG = {
    api_url: "https://api.deepseek.com",
    api_key: "",
    model_id: "deepseek-chat"
};

app.registerExtension({
    name: "ZML.LLM.Nodes",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_LLM_ModelLoader") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                // 1. 只隐藏 api_url 和 api_key
                // 此时 model_id 会作为标准输入框保留在节点上，充当显示作用
                const hiddenWidgetNames = ["api_url", "api_key"];
                node.widgets.forEach(w => {
                    if (hiddenWidgetNames.includes(w.name)) {
                        w.type = "hidden";
                        w.computeSize = () => [0, -4];
                    }
                });

                // 2. 添加“切换配置”按钮
                node.addWidget("button", "⚙️ 切换模型配置", null, () => {
                    showConfigDialog(node);
                });

                // 3. 初始化：加载配置
                loadConfigToNode(node);

                // 调整大小
                setTimeout(() => { node.setSize([node.size[0], node.computeSize()[1]]); }, 50);

                return r;
            };
        }
    }
});

// 从 LocalStorage 加载配置并更新节点 Widgets
function loadConfigToNode(node) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const config = saved ? JSON.parse(saved) : DEFAULT_CONFIG;
        updateNodeWidgets(node, config);
    } catch (e) {
        console.error("ZML LLM: Failed to load config", e);
    }
}

// 更新节点上的 Widget 值 (包括隐藏的和显示的 model_id)
function updateNodeWidgets(node, config) {
    const map = {
        "api_url": config.api_url,
        "api_key": config.api_key,
        "model_id": config.model_id
    };

    node.widgets.forEach(w => {
        if (map.hasOwnProperty(w.name)) {
            w.value = map[w.name];
        }
    });
}

// 显示配置弹窗
function showConfigDialog(node) {
    // 移除旧弹窗
    const old = document.querySelector(".zml-llm-dialog-overlay");
    if(old) old.remove();

    // 读取当前缓存
    let config = DEFAULT_CONFIG;
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) config = JSON.parse(saved);
    } catch(e) {}

    const overlay = document.createElement("div");
    overlay.className = "zml-llm-dialog-overlay";
    
    overlay.innerHTML = `
        <div class="zml-llm-dialog-container">
            <h3>LLM 模型配置</h3>
            
            <div class="zml-llm-form-row">
                <label>API 地址 (Base URL):</label>
                <input type="text" id="zml-llm-url" value="${config.api_url}" placeholder="例如: https://api.deepseek.com">
                <div style="font-size:10px; color:#888; margin-top:2px;">* 如果使用本地ollama，通常为 http://localhost:11434</div>
            </div>

            <div class="zml-llm-form-row">
                <label>API Key (密钥):</label>
                <input type="password" id="zml-llm-key" value="${config.api_key}" placeholder="sk-...">
            </div>

            <div class="zml-llm-form-row">
                <label>模型 ID (Model ID):</label>
                <input type="text" id="zml-llm-model" value="${config.model_id}" placeholder="例如: deepseek-chat">
            </div>

            <div class="zml-llm-buttons">
                <button class="zml-llm-btn zml-llm-btn-save" id="zml-llm-save">保存并应用</button>
                <button class="zml-llm-btn zml-llm-btn-cancel" id="zml-llm-cancel">取消</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const btnSave = overlay.querySelector("#zml-llm-save");
    const btnCancel = overlay.querySelector("#zml-llm-cancel");

    btnSave.onclick = () => {
        const newConfig = {
            api_url: overlay.querySelector("#zml-llm-url").value.trim(),
            api_key: overlay.querySelector("#zml-llm-key").value.trim(),
            model_id: overlay.querySelector("#zml-llm-model").value.trim()
        };

        // 1. 保存到浏览器缓存
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));

        // 2. 更新节点数据 (这会自动更新界面上的 model_id 输入框)
        updateNodeWidgets(node, newConfig);

        // 3. 关闭
        overlay.remove();
        
        // 4. 标记变化
        app.graph.setDirtyCanvas(true, true);
    };

    btnCancel.onclick = () => overlay.remove();
}