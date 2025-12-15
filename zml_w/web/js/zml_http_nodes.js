import { app } from "/scripts/app.js";

// ================= CSS 样式 (美化版) =================
const HTTP_DIALOG_STYLE = `
    /* 遮罩层：加一点模糊背景 */
    .zml-http-dialog-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.7); 
        backdrop-filter: blur(4px);
        z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    /* 主容器：现代暗黑风格 */
    .zml-http-dialog-container {
        background: #1e1e1e; /* 深灰背景 */
        color: #e0e0e0;
        padding: 24px;
        border-radius: 12px;
        width: 650px;
        max-height: 85vh;
        display: flex; flex-direction: column;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        border: 1px solid #333;
        animation: zml-fade-in 0.2s ease-out;
    }

    @keyframes zml-fade-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }

    /* 头部 */
    .zml-http-header {
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #333;
        padding-bottom: 16px;
        margin-bottom: 16px;
    }
    .zml-http-header h3 {
        margin: 0; font-size: 18px; font-weight: 600; color: #fff;
    }

    /* 帮助文本 */
    .zml-http-help {
        background: #2a2a2a;
        padding: 12px;
        border-radius: 8px;
        font-size: 13px;
        color: #aaa;
        line-height: 1.5;
        margin-bottom: 20px;
        border-left: 3px solid #007bff;
    }
    .zml-http-help code {
        background: #333; padding: 2px 5px; border-radius: 4px; color: #66b0ff;
    }

    /* 滚动列表区域 */
    .zml-http-list {
        flex: 1; overflow-y: auto;
        margin-bottom: 20px;
        padding-right: 8px;
        max-height: 400px;
    }
    /* 自定义滚动条 */
    .zml-http-list::-webkit-scrollbar { width: 6px; }
    .zml-http-list::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
    .zml-http-list::-webkit-scrollbar-track { background: transparent; }

    /* 单行布局 */
    .zml-http-row {
        display: flex; gap: 12px; margin-bottom: 10px; align-items: center;
    }

    /* 输入框样式 */
    .zml-http-input {
        background: #121212;
        border: 1px solid #333;
        color: #ddd;
        padding: 0 12px;
        border-radius: 6px;
        flex: 1;
        height: 40px; /* 固定高度，确保对齐 */
        font-size: 14px;
        transition: border-color 0.2s;
        outline: none;
    }
    .zml-http-input:focus {
        border-color: #007bff;
        box-shadow: 0 0 0 1px rgba(0, 123, 255, 0.3);
    }
    .zml-http-input::placeholder { color: #555; }

    /* 按钮通用样式 */
    .zml-http-btn {
        cursor: pointer; border: none; outline: none;
        border-radius: 6px; font-weight: 500; font-size: 14px;
        transition: all 0.2s;
        display: flex; align-items: center; justify-content: center;
    }
    .zml-http-btn:active { transform: translateY(1px); }

    /* 垃圾桶按钮 - 修复错位 */
    .btn-del {
        background: #2a2a2a;
        color: #ff4d4f;
        border: 1px solid #3a1a1a;
        width: 40px; 
        height: 40px; /* 和输入框高度一致 */
        padding: 0;
        font-size: 16px;
        flex-shrink: 0; /* 防止被挤压 */
    }
    .btn-del:hover {
        background: #ff4d4f; color: white; border-color: #ff4d4f;
    }

    /* 添加一行按钮 */
    .btn-add {
        background: #2a2a2a; color: #aaa;
        border: 1px dashed #444;
        width: 100%; height: 36px;
        margin-bottom: 16px;
    }
    .btn-add:hover {
        background: #333; color: #fff; border-color: #666;
    }

    /* 底部保存/关闭按钮 */
    .btn-save {
        background: linear-gradient(135deg, #007bff, #0056b3);
        color: white;
        padding: 10px 30px;
        height: 42px;
        box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
    }
    .btn-save:hover { filter: brightness(1.1); }

    .btn-close {
        background: transparent; color: #888; width: 32px; height: 32px; font-size: 18px;
    }
    .btn-close:hover { background: #333; color: #fff; }
`;

// 注入 CSS
const styleEl = document.createElement("style");
styleEl.textContent = HTTP_DIALOG_STYLE;
document.head.appendChild(styleEl);

const STORAGE_KEY = "zml_http_browser_vars";

app.registerExtension({
    name: "ZML.HTTP.Nodes",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_HTTP_Vars_Browser") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                const w = node.widgets.find(w => w.name === "json_data");
                if (w) {
                    w.type = "hidden";
                    w.computeSize = () => [0, -4];
                }

                node.addWidget("button", "浏览器存储变量", null, () => {
                    showVarManager(node);
                });

                loadVarsToNode(node);
                node.setSize([300, 80]);
                return r;
            };
        }
    }
});

function loadVarsToNode(node) {
    const jsonStr = localStorage.getItem(STORAGE_KEY) || "{}";
    const w = node.widgets.find(w => w.name === "json_data");
    if (w) w.value = jsonStr;
}

function showVarManager(node) {
    const old = document.querySelector(".zml-http-dialog-overlay");
    if(old) old.remove();

    let data = {};
    try {
        data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch(e) {}

    const overlay = document.createElement("div");
    overlay.className = "zml-http-dialog-overlay";
    
    // 构建 HTML
    const entries = Object.entries(data);
    if(entries.length === 0) entries.push(["", ""]);

    overlay.innerHTML = `
        <div class="zml-http-dialog-container">
            <div class="zml-http-header">
                <h3>浏览器缓存变量管理</h3>
                <button class="zml-http-btn btn-close" id="zml-close" title="关闭">✕</button>
            </div>
            
            <div class="zml-http-help">
                <div style="font-weight:bold; margin-bottom:5px;">ℹ️ 说明</div>
                这里的变量保存在你的 <b>浏览器 LocalStorage</b> 中，不会随 .json 工作流文件泄露给他人。<br>
                适合存放 API Key、Secret Token 等敏感信息。<br>
                使用方法：在 HTTP 请求节点中输入 <code>{{参数名}}</code>
            </div>

            <div class="zml-http-list" id="zml-var-list">
                <!-- JS 动态填充 -->
            </div>

            <button class="zml-http-btn btn-add" id="zml-add-row">+ 添加一行新变量</button>

            <div style="display:flex; justify-content:flex-end;">
                <button class="zml-http-btn btn-save" id="zml-save">保存并应用</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const listContainer = overlay.querySelector("#zml-var-list");

    // 渲染行的函数
    function renderRow(key, val) {
        const div = document.createElement("div");
        div.className = "zml-http-row";
        div.innerHTML = `
            <input type="text" class="zml-http-input key-input" placeholder="参数名 (如 API_KEY)" value="${key}">
            <input type="text" class="zml-http-input val-input" placeholder="参数值" value="${val}">
            <button class="zml-http-btn btn-del" title="删除此行">🗑️</button>
        `;
        
        // 删除事件
        div.querySelector(".btn-del").onclick = () => {
            div.style.opacity = '0';
            div.style.transform = 'translateX(20px)';
            setTimeout(() => div.remove(), 200); // 简单的删除动画
        };
        
        listContainer.appendChild(div);
    }

    // 初始化现有数据
    entries.forEach(([k, v]) => renderRow(k, v));

    // 事件绑定
    overlay.querySelector("#zml-add-row").onclick = () => {
        renderRow("", "");
        // 自动滚动到底部
        setTimeout(() => listContainer.scrollTop = listContainer.scrollHeight, 50);
    };
    
    overlay.querySelector("#zml-close").onclick = () => overlay.remove();

    overlay.querySelector("#zml-save").onclick = () => {
        const newData = {};
        const rows = listContainer.querySelectorAll(".zml-http-row");
        let hasEmpty = false;

        rows.forEach(row => {
            const k = row.querySelector(".key-input").value.trim();
            const v = row.querySelector(".val-input").value.trim();
            if(k) {
                newData[k] = v;
            } else if (v) {
                hasEmpty = true; // 有值但没键
            }
        });

        if (hasEmpty) {
            alert("⚠️ 警告：检测到有参数值未填写参数名，这些行将被忽略。");
        }

        const jsonStr = JSON.stringify(newData);
        localStorage.setItem(STORAGE_KEY, jsonStr);
        
        const w = node.widgets.find(w => w.name === "json_data");
        if (w) w.value = jsonStr;

        overlay.remove();
        app.graph.setDirtyCanvas(true, true);
    };
    
    // 点击遮罩层背景关闭 (可选)
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
}