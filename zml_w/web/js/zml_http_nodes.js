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

// =========================================================
// N8N HTTP 节点 UI 扩展
// =========================================================

const N8N_CSS = `
    .n8n-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
        z-index: 9000; display: flex; justify-content: center; align-items: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .n8n-curl-overlay {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(255, 255, 255, 0.98); z-index: 9100;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        animation: fadeIn 0.2s ease; border-radius: 12px;
    }
    .n8n-panel {
        width: 800px; max-height: 90vh; background: #fff; border-radius: 12px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        display: flex; flex-direction: column; overflow: hidden; position: relative;
        animation: popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1); color: #333;
    }
    @keyframes popIn { from { opacity: 0; transform: scale(0.98) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* 顶部 & 底部 */
    .n8n-header {
        padding: 20px 32px; border-bottom: 1px solid #eee; background: #fafafa;
        display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
    }
    .n8n-title { font-size: 18px; font-weight: 700; color: #111; display: flex; align-items: center; gap: 10px; }
    .n8n-icon { width: 28px; height: 28px; background: #FF6D5A; border-radius: 6px; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; }
    .n8n-footer {
        padding: 20px 32px; border-top: 1px solid #eee; background: #fafafa;
        display: flex; justify-content: flex-end; gap: 12px; flex-shrink: 0;
    }

    /* 内容区 */
    .n8n-content { flex: 1; overflow-y: auto; padding: 32px; background: #fff; }
    .n8n-form-group { margin-bottom: 24px; }
    .n8n-label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; font-weight: 600; }
    
    .n8n-input, .n8n-select {
        width: 100%; background: #fff; border: 1px solid #ccc; color: #222;
        padding: 10px 12px; border-radius: 6px; font-size: 14px; outline: none; transition: 0.2s;
        box-sizing: border-box;
    }
    .n8n-input:focus, .n8n-select:focus { border-color: #FF6D5A; box-shadow: 0 0 0 3px rgba(255,109,90,0.1); }
    
    .n8n-combo { display: flex; border-radius: 6px; }
    .n8n-combo .n8n-select { width: 120px; border-radius: 6px 0 0 6px; background: #f8f8f8; border-right: 1px solid #ccc; font-weight: 600; }
    .n8n-combo .n8n-input { border-radius: 0 6px 6px 0; border-left: none; }

    /* 按钮 */
    .n8n-btn { padding: 9px 22px; border-radius: 6px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .n8n-btn-secondary { background: #e5e7eb; color: #374151; } .n8n-btn-secondary:hover { background: #d1d5db; }
    .n8n-btn-primary { background: #FF6D5A; color: #fff; } .n8n-btn-primary:hover { background: #f05a46; }
    .n8n-btn-import-trigger { font-size: 12px; font-weight: 600; color: #FF6D5A; background: #fff0ee; border: none; padding: 6px 14px; border-radius: 20px; cursor: pointer; }
    .n8n-btn-import-trigger:hover { background: #ffdedb; }
    .n8n-btn-del { width: 32px; height: 32px; border: 1px solid #ddd; background: #fff; border-radius: 4px; color: #888; cursor: pointer; }
    .n8n-btn-add { background: #fff; border: 1px dashed #ccc; color: #666; width: 100%; padding: 8px; font-size: 13px; cursor: pointer; border-radius: 6px; margin-top: 8px; }

    /* 开关 */
    .n8n-toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0; margin-bottom: 8px; cursor: pointer; }
    .n8n-switch { position: relative; width: 40px; height: 22px; background: #e0e0e0; border-radius: 11px; transition: 0.3s; }
    .n8n-switch.active { background: #FF6D5A; }
    .n8n-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: 0.3s; }
    .n8n-switch.active::after { transform: translateX(18px); }

    /* 编辑器 */
    .n8n-textarea {
        width: 100%; min-height: 250px;
        font-family: "JetBrains Mono", "Fira Code", "Consolas", monospace;
        font-size: 13px; line-height: 1.5;
        white-space: pre-wrap; /* 关键：自动换行，防止一行显示 */
        padding: 12px; border: 1px solid #ccc; border-radius: 6px;
        outline: none; background: #fafafa; color: #222;
        tab-size: 2;
    }
    .n8n-textarea:focus { background: #fff; border-color: #FF6D5A; }
    .n8n-editor-toolbar { display: flex; justify-content: flex-end; margin-bottom: 5px; }
    .n8n-btn-xs { font-size: 11px; padding: 3px 8px; background: #eee; border: none; border-radius: 4px; cursor: pointer; color: #555; }
    
    /* 列表 */
    .n8n-param-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    .n8n-param-list { background: #f9f9f9; padding: 16px; border-radius: 8px; border: 1px solid #eee; }

    /* cURL 弹窗 */
    .n8n-curl-container { width: 80%; max-width: 600px; display: flex; flex-direction: column; height: 70%; }
    .n8n-curl-textarea { flex: 1; padding: 16px; border: 2px solid #eee; border-radius: 8px; font-family: monospace; font-size: 12px; margin-bottom: 20px; outline: none; resize: none; background: #f9f9f9; }
    .n8n-curl-textarea:focus { border-color: #FF6D5A; background: #fff; }
`;

const n8nStyleEl = document.createElement("style");
n8nStyleEl.textContent = N8N_CSS;
document.head.appendChild(n8nStyleEl);

// 尝试格式化 JSON
function tryPrettifyJSON(str) {
    try {
        const obj = JSON.parse(str);
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return str;
    }
}

// 深度清洗 Shell 字符串 (核心修复逻辑)
function cleanShellBody(rawBody) {
    if (!rawBody) return "";
    
    let cleaned = rawBody.trim();

    // 1. 如果是被单引号包围的 ('...')
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
        // 修复 Shell 的单引号转义: '\'' -> '
        cleaned = cleaned.replace(/'\\''/g, "'");
    } 
    // 2. 如果是被双引号包围的 ("...")
    else if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
        // 修复双引号转义: \" -> "
        cleaned = cleaned.replace(/\\"/g, '"');
    }

    // 3. 全局通用清理 (针对内部内容)
    // 修复换行符
    cleaned = cleaned.replace(/\\n/g, ""); // JSON.parse不喜换行符
    cleaned = cleaned.replace(/\\r/g, "");
    
    return cleaned;
}

function parseCurlCommand(rawCmd) {
    if (!rawCmd || typeof rawCmd !== 'string') return null;
    
    // 预处理：移除行尾反斜杠，合并为单行
    let cmd = rawCmd.trim().replace(/\\\n/g, " ").replace(/\\\r\n/g, " ").replace(/\s+/g, " ");

    if (!cmd.toLowerCase().startsWith("curl")) return null;

    const result = {
        method: "GET",
        url: "",
        headers: [],
        data: "",
        contentType: "json"
    };

    // 提取 URL
    const urlMatch = cmd.match(/['"]?(https?:\/\/[^\s'"]+)/);
    if (urlMatch) result.url = urlMatch[1];

    // 提取 Method
    const methodMatch = cmd.match(/-X\s+([A-Z]+)/i) || cmd.match(/--request\s+([A-Z]+)/i);
    if (methodMatch) result.method = methodMatch[1].toUpperCase();

    // 提取 Headers
    const headerRegex = /-H\s+['"](.*?)['"]/g;
    let match;
    while ((match = headerRegex.exec(cmd)) !== null) {
        const headerStr = match[1];
        const splitIndex = headerStr.indexOf(":");
        if (splitIndex > -1) {
            const key = headerStr.slice(0, splitIndex).trim();
            const val = headerStr.slice(splitIndex + 1).trim();
            result.headers.push({ name: key, value: val });
        }
    }

    // 提取 Body (支持 -d, --data, --data-raw 等)
    // 使用更宽松的正则，捕获引号内的内容
    const bodyMatch = cmd.match(/(--data-raw|--data-binary|--data|-d)\s+(['"])([\s\S]*?)\2/);
    
    if (bodyMatch) {
        // 拿到原始数据 (含潜在转义)
        let rawContent = bodyMatch[3]; // 第3组是引号内的内容
        let quoteType = bodyMatch[2]; // 引号类型 ' 或 "

        // 手动清洗
        let cleanedData = rawContent;
        if (quoteType === "'") {
            cleanedData = cleanedData.replace(/'\\''/g, "'"); // 还原 Shell 的单引号转义
        } else {
            cleanedData = cleanedData.replace(/\\"/g, '"'); // 还原双引号转义
        }

        if (!methodMatch) result.method = "POST";
        
        // 尝试解析 JSON
        try {
            const json = JSON.parse(cleanedData);
            result.data = JSON.stringify(json, null, 2); // 成功！美化它
            result.contentType = "json";
        } catch(e) {
            // 如果解析失败...
            console.warn("JSON parse failed, trying heuristics...", e);
            
            const trimmed = cleanedData.trim();
            // 如果看起来像 JSON，强行作为 JSON 处理（即使格式有误，方便用户在编辑器里修）
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                result.contentType = "json";
                result.data = cleanedData; // 保持原样放入，让用户在编辑器里改
            } else if (cleanedData.includes("=")) {
                result.contentType = "form-urlencoded";
                result.data = cleanedData;
            } else {
                result.contentType = "raw";
                result.data = cleanedData;
            }
        }
    }

    return result;
}

// =========================================================
// 3. UI 逻辑
// =========================================================

class N8N_Editor {
    constructor(node, configWidget) {
        this.node = node;
        this.configWidget = configWidget;
        this.data = JSON.parse(configWidget.value || "{}");
        this.render();
    }

    update(key, value) {
        this.data[key] = value;
    }

    save() {
        this.configWidget.value = JSON.stringify(this.data);
        app.graph.setDirtyCanvas(true, true);
        this.close();
    }

    close() {
        if (this.overlay) {
            this.overlay.style.opacity = '0';
            setTimeout(() => this.overlay.remove(), 200);
        }
    }

    refreshUI() {
        if(this.overlay) this.overlay.remove();
        this.render();
    }

    // --- cURL 导入逻辑 ---
    showCurlDialog() {
        const curlOverlay = document.createElement("div");
        curlOverlay.className = "n8n-curl-overlay";
        curlOverlay.innerHTML = `
            <div class="n8n-curl-container">
                <div class="n8n-curl-title">📋 粘贴 cURL 命令</div>
                <textarea class="n8n-curl-textarea" placeholder="curl -X POST ..."></textarea>
                <div style="display:flex; gap:10px; justify-content:center;">
                    <button class="n8n-btn n8n-btn-secondary" id="btn-cancel">取消</button>
                    <button class="n8n-btn n8n-btn-primary" id="btn-import">确认导入</button>
                </div>
            </div>
        `;
        
        const ta = curlOverlay.querySelector("textarea");
        setTimeout(() => ta.focus(), 50);

        curlOverlay.querySelector("#btn-cancel").onclick = () => curlOverlay.remove();
        curlOverlay.querySelector("#btn-import").onclick = () => {
            const cmd = ta.value;
            if(!cmd.trim()) { curlOverlay.remove(); return; }
            
            const parsed = parseCurlCommand(cmd);
            if (!parsed) { alert("解析失败，请检查 cURL 格式"); return; }

            this.data.method = parsed.method;
            if(parsed.url) this.data.url = parsed.url;
            
            if (parsed.headers.length) {
                this.data.send_headers = true;
                this.data.header_params = parsed.headers;
            }

            if (parsed.data) {
                this.data.send_body = true;
                this.data.body_content_type = parsed.contentType;
                
                if (parsed.contentType === "json") {
                    this.data.body_json = parsed.data; // 这里的 data 已经被尝试美化过了
                    this.data.body_raw = ""; // 清空 raw 防止干扰
                } else if (parsed.contentType === "form-urlencoded") {
                     const params = [];
                     parsed.data.split('&').forEach(pair => {
                         const [k, v] = pair.split('=');
                         if(k) params.push({name: decodeURIComponent(k), value: decodeURIComponent(v||"")});
                     });
                     this.data.body_form_params = params;
                } else {
                    this.data.body_raw = parsed.data;
                }
            }
            curlOverlay.remove();
            this.refreshUI();
        };
        this.panel.appendChild(curlOverlay);
    }

    // --- 组件 ---
    createInput(val, ph, cb) {
        const i = document.createElement("input");
        i.className = "n8n-input"; i.value = val||""; i.placeholder = ph||"";
        i.oninput = (e) => cb(e.target.value);
        return i;
    }

    createParamList(key, list) {
        const c = document.createElement("div"); c.className = "n8n-param-list";
        const rows = document.createElement("div");
        const render = () => {
            rows.innerHTML = "";
            list.forEach((item, idx) => {
                const r = document.createElement("div"); r.className = "n8n-param-row";
                r.appendChild(this.createInput(item.name, "Key", v=>item.name=v));
                r.appendChild(this.createInput(item.value, "Value", v=>item.value=v));
                const b = document.createElement("button"); b.className="n8n-btn-del"; b.innerHTML="✕";
                b.onclick=()=>{ list.splice(idx,1); render(); };
                r.appendChild(b);
                rows.appendChild(r);
            });
        };
        const add = document.createElement("button"); add.className="n8n-btn-add"; add.innerText="+ 添加参数";
        add.onclick=()=>{ list.push({name:"",value:""}); render(); };
        render(); c.append(rows, add); return c;
    }

    createToggle(label, key, contentFn) {
        const c = document.createElement("div");
        const h = document.createElement("div"); h.className="n8n-toggle-row";
        h.innerHTML = `<span class="n8n-toggle-label">${label}</span><div class="n8n-switch ${this.data[key]?'active':''}"></div>`;
        const box = document.createElement("div"); box.style.display=this.data[key]?"block":"none";
        h.onclick=()=>{ 
            this.data[key]=!this.data[key]; 
            h.querySelector(".n8n-switch").classList.toggle("active");
            box.style.display=this.data[key]?"block":"none";
        };
        box.appendChild(contentFn());
        c.append(h, box); return c;
    }

    // --- 主渲染 ---
    render() {
        this.overlay = document.createElement("div"); this.overlay.className = "n8n-overlay";
        this.overlay.onclick = (e) => { if(e.target===this.overlay) this.close(); };

        this.panel = document.createElement("div"); this.panel.className = "n8n-panel";

        // Header
        const h = document.createElement("div"); h.className="n8n-header";
        h.innerHTML = `<div class="n8n-title"><div class="n8n-icon">N</div>HTTP Request</div>`;
        const imp = document.createElement("button"); imp.className="n8n-btn-import-trigger"; imp.innerText="📥 导入 cURL";
        imp.onclick = () => this.showCurlDialog();
        h.appendChild(imp);

        // Content
        const content = document.createElement("div"); content.className="n8n-content";

        // Method / URL
        const g1 = document.createElement("div"); g1.className="n8n-form-group";
        g1.innerHTML = `<label class="n8n-label">请求方法 & URL</label>`;
        const combo = document.createElement("div"); combo.className="n8n-combo";
        const sel = document.createElement("select"); sel.className="n8n-select";
        ["GET","POST","PUT","DELETE","PATCH"].forEach(m=>{
            const o=document.createElement("option"); o.value=m; o.innerText=m; 
            if(m===(this.data.method||"GET")) o.selected=true; sel.appendChild(o);
        });
        sel.onchange=(e)=>this.update("method",e.target.value);
        const url = this.createInput(this.data.url||"https://", "URL", v=>this.update("url",v));
        combo.append(sel, url); g1.appendChild(combo); content.appendChild(g1);

        // Auth
        const g2 = document.createElement("div"); g2.className="n8n-form-group";
        g2.innerHTML = `<label class="n8n-label">认证 (Auth)</label>`;
        const asel = document.createElement("select"); asel.className="n8n-select";
        [{v:"none",t:"None"},{v:"basic",t:"Basic"},{v:"bearer",t:"Bearer"},{v:"header",t:"Header"}]
        .forEach(x=>{ const o=document.createElement("option"); o.value=x.v; o.innerText=x.t; if(x.v===(this.data.auth_type||"none"))o.selected=true; asel.appendChild(o); });
        const abox = document.createElement("div"); abox.style.marginTop="8px";
        const renderAuth = (t) => {
            abox.innerHTML=""; this.update("auth_type",t);
            if(t==="basic") abox.append(this.createInput(this.data.auth_user,"User",v=>this.update("auth_user",v)), this.createInput(this.data.auth_pass,"Pass",v=>this.update("auth_pass",v)));
            else if(t==="bearer") abox.append(this.createInput(this.data.auth_token,"Token",v=>this.update("auth_token",v)));
            else if(t==="header") abox.append(this.createInput(this.data.auth_header_name,"Name",v=>this.update("auth_header_name",v)), this.createInput(this.data.auth_header_value,"Value",v=>this.update("auth_header_value",v)));
        };
        asel.onchange=(e)=>renderAuth(e.target.value); renderAuth(this.data.auth_type||"none");
        g2.append(asel, abox); content.appendChild(g2);

        // Toggles
        if(!this.data.query_params) this.data.query_params=[];
        content.appendChild(this.createToggle("Query 参数", "send_query", ()=>this.createParamList("query_params", this.data.query_params)));
        
        if(!this.data.header_params) this.data.header_params=[];
        content.appendChild(this.createToggle("Headers", "send_headers", ()=>this.createParamList("header_params", this.data.header_params)));

        // Body
        content.appendChild(this.createToggle("Body (请求体)", "send_body", ()=>{
            const w = document.createElement("div");
            const tsel = document.createElement("select"); tsel.className="n8n-select";
            ["json","form-urlencoded","raw"].forEach(t=>{
                const o=document.createElement("option"); o.value=t; o.innerText=t.toUpperCase();
                if(t===(this.data.body_content_type||"json")) o.selected=true; tsel.appendChild(o);
            });
            const bbox = document.createElement("div"); bbox.style.marginTop="8px";
            const renderBody = (t) => {
                bbox.innerHTML=""; this.update("body_content_type", t);
                if(t==="json") {
                    const tb = document.createElement("div"); tb.className="n8n-editor-toolbar";
                    const btn = document.createElement("button"); btn.className="n8n-btn-xs"; btn.innerText="⚡ 格式化 JSON";
                    const area = document.createElement("textarea"); area.className="n8n-textarea";
                    area.value = this.data.body_json || "{}";
                    // 初始尝试格式化
                    area.value = tryPrettifyJSON(area.value);
                    area.oninput=(e)=>this.update("body_json", e.target.value);
                    btn.onclick=()=>{ area.value = tryPrettifyJSON(area.value); this.update("body_json", area.value); };
                    tb.appendChild(btn); bbox.append(tb, area);
                } else if(t==="raw") {
                    const area = document.createElement("textarea"); area.className="n8n-textarea";
                    area.value = this.data.body_raw || "";
                    area.oninput=(e)=>this.update("body_raw", e.target.value);
                    bbox.appendChild(area);
                } else if(t==="form-urlencoded") {
                    if(!this.data.body_form_params) this.data.body_form_params=[];
                    bbox.appendChild(this.createParamList("body_form_params", this.data.body_form_params));
                }
            };
            tsel.onchange=(e)=>renderBody(e.target.value); renderBody(this.data.body_content_type||"json");
            w.append(tsel, bbox); return w;
        }));

        // Footer
        const f = document.createElement("div"); f.className="n8n-footer";
        const b1 = document.createElement("button"); b1.className="n8n-btn n8n-btn-secondary"; b1.innerText="取消"; b1.onclick=()=>this.close();
        const b2 = document.createElement("button"); b2.className="n8n-btn n8n-btn-primary"; b2.innerText="保存配置"; b2.onclick=()=>this.save();
        f.append(b1, b2);

        this.panel.append(h, content, f);
        this.overlay.appendChild(this.panel);
        document.body.appendChild(this.overlay);
    }
}

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
        
        if (nodeData.name === "ZML_N8N_HTTP_Full") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const w = this.widgets.find(w => w.name === "settings");
                if (w) { w.type = "hidden"; w.computeSize = () => [0, -4]; }
                this.addWidget("button", "⚙️ 打开配置 (Edit Request)", null, () => new N8N_Editor(this, w));
                this.setSize([280, 80]); return r;
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