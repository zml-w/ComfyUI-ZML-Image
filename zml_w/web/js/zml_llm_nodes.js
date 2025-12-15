import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// ================= CSS 样式 =================
const LLM_MANAGER_STYLE = `
    .zml-llm-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.6); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        font-family: sans-serif;
    }
    .zml-llm-window {
        background: #1e1e1e; color: #ddd; width: 700px; height: 500px;
        border-radius: 8px; display: flex; flex-direction: column;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #333;
        overflow: hidden;
    }
    .zml-llm-header {
        padding: 15px; background: #252525; border-bottom: 1px solid #333;
        display: flex; justify-content: space-between; align-items: center;
    }
    .zml-llm-body {
        display: flex; flex: 1; overflow: hidden;
    }
    .zml-llm-sidebar {
        width: 200px; background: #222; border-right: 1px solid #333;
        display: flex; flex-direction: column;
    }
    .zml-llm-list {
        flex: 1; overflow-y: auto; padding: 5px;
    }
    .zml-llm-item {
        padding: 8px 10px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .zml-llm-item:hover { background: #333; }
    .zml-llm-item.active { background: #0F4C81; color: white; }
    
    .zml-llm-content {
        flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 15px;
        overflow-y: auto;
    }
    .zml-llm-row { display: flex; flex-direction: column; gap: 5px; }
    .zml-llm-row label { font-size: 12px; color: #aaa; }
    .zml-llm-input {
        background: #111; border: 1px solid #444; color: white;
        padding: 8px; border-radius: 4px; outline: none;
    }
    .zml-llm-input:focus { border-color: #0F4C81; }
    
    .zml-llm-footer {
        padding: 10px 15px; background: #252525; border-top: 1px solid #333;
        display: flex; justify-content: flex-end; gap: 10px;
    }
    
    .zml-btn {
        padding: 6px 15px; border-radius: 4px; border: none; cursor: pointer;
        font-size: 12px; color: white; background: #444; transition: 0.2s;
    }
    .zml-btn:hover { opacity: 0.9; }
    .zml-btn-primary { background: #0F4C81; }
    .zml-btn-danger { background: #811e1e; }
    .zml-btn-success { background: #2e7d32; }
    .zml-path-bar {
        display: flex; gap: 10px; margin-bottom: 10px; align-items: center;
    }
`;

// 注入 CSS
const styleEl = document.createElement("style");
styleEl.textContent = LLM_MANAGER_STYLE;
document.head.appendChild(styleEl);

// 本地存储 key
const STORAGE_PATH_KEY = "zml_llm_config_path_v2";

app.registerExtension({
    name: "ZML.LLM.Nodes",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_LLM_ModelLoaderV2") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                // 1. 设置 Widget 属性
                setTimeout(() => {
                    // config_folder 是必须存在的参数，但我们不希望用户手动去改它，
                    // 也不希望它占用太多视觉空间，所以将其设为只读或者隐藏
                    // 为了能看到当前连的是哪个库，我们这里设为只读 (readOnly)
                    const w_folder = node.widgets.find(w => w.name === "config_folder");
                    if (w_folder) {
                        w_folder.inputEl.readOnly = true;
                        w_folder.inputEl.style.opacity = 0.5;
                        w_folder.inputEl.title = "由管理器自动填充的路径";
                    }
                    
                    const w_preset = node.widgets.find(w => w.name === "preset_name");
                    if (w_preset) {
                        w_preset.inputEl.readOnly = true;
                        w_preset.inputEl.style.opacity = 0.8;
                    }

                    node.setSize([node.size[0], node.computeSize()[1]]);
                }, 50);

                // 2. 添加“模型管理”按钮
                node.addWidget("button", "📂 管理/选择模型库", null, () => {
                    showModelManager(node);
                });

                return r;
            };
        }
    }
});

/**
 * 显示模型管理器弹窗
 */
function showModelManager(node) {
    // 移除旧窗口
    const old = document.querySelector(".zml-llm-overlay");
    if(old) old.remove();

    // 状态数据
    let presets = [];
    // 尝试从节点当前值获取路径，如果没有则从 LocalStorage 获取
    let nodeCurrentPath = "";
    const w_folder = node.widgets.find(w => w.name === "config_folder");
    if (w_folder) nodeCurrentPath = w_folder.value;

    let currentPath = nodeCurrentPath || localStorage.getItem(STORAGE_PATH_KEY) || "";
    let activeIndex = -1;

    // 创建 DOM
    const overlay = document.createElement("div");
    overlay.className = "zml-llm-overlay";
    
    const html = `
    <div class="zml-llm-window">
        <div class="zml-llm-header">
            <span>📚 LLM 模型列表管理 (V2 安全版)</span>
            <button class="zml-btn" id="zml-close">×</button>
        </div>
        
        <div style="padding: 10px; background: #2a2a2a; border-bottom:1px solid #333;">
            <div class="zml-path-bar">
                <label>配置文件存放文件夹:</label>
                <input type="text" class="zml-llm-input" style="flex:1" id="zml-path-input" value="${currentPath}" placeholder="例如: D:\\AI\\Configs">
                <button class="zml-btn zml-btn-primary" id="zml-load-btn">读取/加载</button>
            </div>
            <div style="font-size:11px; color:#888;">* 敏感数据(Key/URL)将保存在此文件夹的 json 文件中，不会保存到工作流图片里。</div>
        </div>

        <div class="zml-llm-body">
            <!-- 左侧列表 -->
            <div class="zml-llm-sidebar">
                <div class="zml-llm-list" id="zml-preset-list"></div>
                <div style="padding:10px; border-top:1px solid #333;">
                    <button class="zml-btn zml-btn-success" style="width:100%" id="zml-add-btn">+ 新增配置</button>
                </div>
            </div>

            <!-- 右侧详情 -->
            <div class="zml-llm-content" id="zml-detail-panel" style="display:none;">
                <div class="zml-llm-row">
                    <label>预设名称 (Alias):</label>
                    <input type="text" class="zml-llm-input" id="inp-name">
                </div>
                <div class="zml-llm-row">
                    <label>API URL (Base URL):</label>
                    <input type="text" class="zml-llm-input" id="inp-url" placeholder="https://api...">
                </div>
                <div class="zml-llm-row">
                    <label>API Key:</label>
                    <input type="password" class="zml-llm-input" id="inp-key">
                </div>
                <div class="zml-llm-row">
                    <label>Model ID (Default):</label>
                    <input type="text" class="zml-llm-input" id="inp-model" placeholder="gpt-4o, deepseek-chat...">
                </div>
                
                <div style="margin-top:auto; display:flex; gap:10px; justify-content:space-between;">
                    <button class="zml-btn zml-btn-danger" id="zml-del-btn">删除此条</button>
                    <button class="zml-btn zml-btn-primary" id="zml-apply-btn">👉 应用到节点</button>
                </div>
            </div>
            
            <div class="zml-llm-content" id="zml-empty-panel" style="align-items:center; justify-content:center; color:#555;">
                请先加载文件夹，并在左侧选择或新建一个配置
            </div>
        </div>

        <div class="zml-llm-footer">
            <span id="zml-status" style="margin-right:auto; font-size:12px; color:#aaa; align-self:center;"></span>
            <button class="zml-btn" id="zml-cancel">关闭</button>
            <button class="zml-btn zml-btn-save" style="background:#0F4C81; font-weight:bold;" id="zml-save-json">💾 保存到 JSON 文件</button>
        </div>
    </div>
    `;
    
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // ================= 逻辑绑定 =================

    const el = (id) => overlay.querySelector(`#${id}`);
    const listEl = el("zml-preset-list");
    const detailPanel = el("zml-detail-panel");
    const emptyPanel = el("zml-empty-panel");
    const statusEl = el("zml-status");

    // 关闭
    const close = () => overlay.remove();
    el("zml-close").onclick = close;
    el("zml-cancel").onclick = close;

    // 状态提示
    const msg = (text, color="#aaa") => {
        statusEl.textContent = text;
        statusEl.style.color = color;
        setTimeout(() => statusEl.textContent = "", 3000);
    };

    // 渲染列表
    function renderList() {
        listEl.innerHTML = "";
        if (presets.length === 0) {
            detailPanel.style.display = "none";
            emptyPanel.style.display = "flex";
            return;
        }

        presets.forEach((p, idx) => {
            const div = document.createElement("div");
            div.className = `zml-llm-item ${idx === activeIndex ? "active" : ""}`;
            div.textContent = p.name || "未命名配置";
            div.onclick = () => selectIndex(idx);
            listEl.appendChild(div);
        });
    }

    // 选中某一项
    function selectIndex(idx) {
        saveCurrentToMemory();
        activeIndex = idx;
        renderList();

        if (idx >= 0 && idx < presets.length) {
            const p = presets[idx];
            emptyPanel.style.display = "none";
            detailPanel.style.display = "flex";
            
            el("inp-name").value = p.name || "";
            el("inp-url").value = p.url || "";
            el("inp-key").value = p.key || "";
            el("inp-model").value = p.model || "";
        } else {
            detailPanel.style.display = "none";
            emptyPanel.style.display = "flex";
        }
    }

    // 将输入框内容同步回 presets 数组
    function saveCurrentToMemory() {
        if (activeIndex >= 0 && activeIndex < presets.length) {
            presets[activeIndex] = {
                name: el("inp-name").value,
                url: el("inp-url").value,
                key: el("inp-key").value,
                model: el("inp-model").value
            };
        }
    }

    // 监听输入框变化
    el("inp-name").addEventListener("input", () => {
        if (activeIndex >= 0) {
            presets[activeIndex].name = el("inp-name").value;
            const item = listEl.children[activeIndex];
            if(item) item.textContent = el("inp-name").value || "未命名配置";
        }
    });

    // 加载 JSON
    el("zml-load-btn").onclick = async () => {
        const path = el("zml-path-input").value.trim();
        if (!path) return msg("请输入文件夹路径", "salmon");

        localStorage.setItem(STORAGE_PATH_KEY, path);

        try {
            const res = await api.fetchApi("/zml/llm/load_config", {
                method: "POST",
                body: JSON.stringify({ path: path })
            });
            const data = await res.json();
            
            if (data.success) {
                presets = data.presets || [];
                msg(`加载成功! 找到 ${presets.length} 个配置`, "#6FD06F");
                activeIndex = -1;
                renderList();
            } else {
                msg("加载失败: " + data.error, "salmon");
            }
        } catch (e) {
            msg("请求错误: " + e, "salmon");
        }
    };

    // 保存 JSON
    el("zml-save-json").onclick = async () => {
        saveCurrentToMemory();
        const path = el("zml-path-input").value.trim();
        if (!path) return msg("路径为空，无法保存", "salmon");

        try {
            const res = await api.fetchApi("/zml/llm/save_config", {
                method: "POST",
                body: JSON.stringify({ path: path, presets: presets })
            });
            const data = await res.json();
            
            if (data.success) {
                msg("文件保存成功!", "#6FD06F");
            } else {
                msg("保存失败: " + data.error, "salmon");
            }
        } catch (e) {
            msg("保存错误: " + e, "salmon");
        }
    };

    // 新增
    el("zml-add-btn").onclick = () => {
        saveCurrentToMemory();
        presets.push({ name: "新配置", url: "", key: "", model: "" });
        selectIndex(presets.length - 1);
        el("inp-name").focus();
        el("inp-name").select();
    };

    // 删除
    el("zml-del-btn").onclick = () => {
        if (confirm("确定要删除这个配置吗？")) {
            presets.splice(activeIndex, 1);
            activeIndex = -1;
            renderList();
            selectIndex(-1);
        }
    };

    // 应用到节点 (核心修改：只填路径和名字，不填Key)
    el("zml-apply-btn").onclick = () => {
        saveCurrentToMemory();
        if (activeIndex < 0) return;

        const p = presets[activeIndex];
        const path = el("zml-path-input").value.trim();
        
        // 我们只把 路径(config_folder) 和 预设名(preset_name) 填到节点上
        // 另外可以把 model_override 填一下方便用户修改
        // 绝对不要填 api_key 或 api_url，因为节点上已经没有这俩接口了！
        
        const widgetMap = {
            "config_folder": path,
            "preset_name": p.name,
            "model_override": p.model // 顺便把预设的模型ID填入覆盖框，方便查看
        };

        if (node && node.widgets) {
            node.widgets.forEach(w => {
                if (widgetMap.hasOwnProperty(w.name)) {
                    w.value = widgetMap[w.name];
                }
            });
            
            node.setDirtyCanvas(true, true);
            msg(`已应用配置: ${p.name}`, "#6FD06F");
            
            // 自动保存一下 JSON 防止用户忘记保存导致节点读取不到
            el("zml-save-json").click();
            
            setTimeout(() => overlay.remove(), 800);
        }
    };
    
    // 如果有路径，自动尝试加载一次
    if (currentPath) {
        el("zml-load-btn").click();
    }
}