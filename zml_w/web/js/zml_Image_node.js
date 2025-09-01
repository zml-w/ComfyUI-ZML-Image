// custom_nodes/ComfyUI-ZML-Image/zml_w/web/js/zml_Image_node.js

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el } from "/scripts/ui.js";

const ZML_API_PREFIX = "/zml"; // 定义API前缀

const IMAGE_WIDTH = 384;
const IMAGE_HEIGHT = 384;

// 安全的URL编码
function encodeRFC3986URIComponent(str) {
	return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// 计算预览图位置
const calculateImagePosition = (el, bodyRect) => {
	let { top, left, right } = el.getBoundingClientRect();
	const { width: bodyWidth, height: bodyHeight } = bodyRect;
	const isSpaceRight = right + IMAGE_WIDTH <= bodyWidth;
	if (isSpaceRight) left = right;
	else left -= IMAGE_WIDTH;
	top = Math.max(0, top - (IMAGE_HEIGHT / 2));
	if (top + IMAGE_HEIGHT > bodyHeight) top = bodyHeight - IMAGE_HEIGHT;
	return { left: Math.round(left), top: Math.round(top), isLeft: !isSpaceRight };
};

app.registerExtension({
    name: "ZML.ImageLoaders.Enhanced",
    init() {
        // --- 更新 CSS 样式为浅蓝色简约风格 ---
		$el("style", {
			textContent: `
                .zml-image-preview {
                    position: absolute; left: 0; top: 0; width: auto; height: auto;
                    max-width: ${IMAGE_WIDTH}px; max-height: ${IMAGE_HEIGHT}px;
                    object-fit: contain; object-position: top left; z-index: 9999;
                    pointer-events: none; background-color: #111; border: 1px solid #444;
                }
				.zml-image-preview.left { object-position: top right; }

                /* ========================================================== */
                /* 全局模态框背景 */
                .zml-backdrop {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background-color: rgba(0, 0, 0, 0.6);
                    z-index: 1000;
                }

                /* 模态框主体 */
                .zml-tag-modal {
                    /* [新增] 默认主题 (蓝色) 的颜色变量 */
                    --zml-main-bg: #f0f8ff;
                    --zml-header-bg: #e0f2ff;
                    --zml-path-bg: #f7fcff;
                    --zml-accent-color: #87ceeb;
                    --zml-accent-hover: #6a9acb;
                    --zml-header-text: #2a648b;
                    --zml-main-text: #333;
                    --zml-secondary-text: #666;
                    --zml-border-color: #c0e0f8;
                    --zml-button-text: white;
                    --zml-input-bg: #ffffff;
                    --zml-input-border: #add8e6;

                    position: fixed; top: 5%; left: 5%; right: 5%; bottom: 5%;
                    background-color: var(--zml-main-bg);
                    border: 1px solid var(--zml-accent-color);
                    border-radius: 8px;
                    z-index: 1001;
                    display: flex; flex-direction: column;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                    color: var(--zml-main-text);
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    transition: background-color 0.3s, border-color 0.3s;
                }

                /* [新增] 绿色主题 */
                .zml-tag-modal[data-theme="green"] {
                    --zml-main-bg: #f0fff0;
                    --zml-header-bg: #e6f9e6;
                    --zml-path-bg: #f8fff8;
                    --zml-accent-color: #90ee90;
                    --zml-accent-hover: #3cb371;
                    --zml-header-text: #2e8b57;
                    --zml-border-color: #c8e6c9;
                    --zml-input-border: #a5d6a7;
                }
                /* [新增] 黄色主题 */
                .zml-tag-modal[data-theme="yellow"] {
                    --zml-main-bg: #fffacd;
                    --zml-header-bg: #fff8e1;
                    --zml-path-bg: #fffdf5;
                    --zml-accent-color: #ffd700;
                    --zml-accent-hover: #ffc107;
                    --zml-header-text: #b8860b;
                    --zml-border-color: #ffecb3;
                    --zml-input-border: #ffe082;
                }
                /* [新增] 黑色 (暗黑) 主题 */
                .zml-tag-modal[data-theme="black"] {
                    --zml-main-bg: #212121;
                    --zml-header-bg: #2c2c2c;
                    --zml-path-bg: #1e1e1e;
                    --zml-accent-color: #03a9f4; /* 亮蓝色作为点缀 */
                    --zml-accent-hover: #29b6f6;
                    --zml-header-text: #e0e0e0;
                    --zml-main-text: #f5f5f5;
                    --zml-secondary-text: #bdbdbd;
                    --zml-border-color: #424242;
                    --zml-button-text: white;
                    --zml-input-bg: #424242;
                    --zml-input-border: #616161;
                }
                /* [新增] 粉色主题 */
                .zml-tag-modal[data-theme="pink"] {
                    --zml-main-bg: #fff0f5;
                    --zml-header-bg: #ffe4e1;
                    --zml-path-bg: #fff5f7;
                    --zml-accent-color: #ffb6c1;
                    --zml-accent-hover: #ff69b4;
                    --zml-header-text: #c71585;
                    --zml-border-color: #f8c0c8;
                    --zml-input-border: #f48fb1;
                }


                /* 模态框头部 */
                .zml-tag-modal-header {
                    position: relative; /* 为主题切换器定位 */
                    padding: 12px 20px;
                    background-color: var(--zml-header-bg);
                    font-size: 1.3em;
                    font-weight: bold;
                    border-bottom: 1px solid var(--zml-border-color);
                    text-align: center;
                    color: var(--zml-header-text);
                }

                /* [新增] 主题切换器 */
                .zml-theme-switcher {
                    position: absolute;
                    top: 50%;
                    left: 15px;
                    transform: translateY(-50%);
                    display: flex;
                    gap: 8px;
                }
                .zml-theme-button {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    border: 2px solid rgba(0,0,0,0.2);
                    cursor: pointer;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .zml-theme-button:hover {
                    transform: scale(1.1);
                }
                .zml-theme-button.active {
                    transform: scale(1.15);
                    box-shadow: 0 0 0 3px var(--zml-accent-color);
                }

                /* 路径输入组 */
                .zml-path-input-group {
                    display: flex; align-items: center; gap: 10px;
                    padding: 10px 20px;
                    background-color: var(--zml-path-bg);
                    border-bottom: 1px solid var(--zml-header-bg);
                }
                .zml-path-input {
                    flex-grow: 1; padding: 8px 12px;
                    border: 1px solid var(--zml-input-border);
                    border-radius: 4px;
                    background-color: var(--zml-input-bg);
                    color: var(--zml-main-text);
                    font-size: 0.95em;
                }
                .zml-path-input::placeholder { color: #888; }

                /* 刷新按钮 */
                .zml-path-refresh-btn {
                    padding: 8px 15px;
                    border: none;
                    border-radius: 4px;
                    background-color: var(--zml-accent-color);
                    cursor: pointer;
                    color: var(--zml-button-text);
                    font-size: 0.95em;
                    transition: background-color 0.2s ease;
                }
                .zml-path-refresh-btn:hover { background-color: var(--zml-accent-hover); }

                /* 面包屑导航 */
                .zml-tag-modal-breadcrumbs {
                    padding: 10px 20px;
                    background-color: var(--zml-path-bg);
                    border-bottom: 1px solid var(--zml-header-bg);
                    color: var(--zml-secondary-text);
                    font-size: 0.9em;
                }

                /* 内容区域 */
                .zml-tag-modal-content {
                    flex-grow: 1;
                    padding: 15px 20px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    background-color: var(--zml-main-bg);
                }

                /* 文件夹容器 */
                .zml-folder-container {
                    display: flex; flex-wrap: wrap; gap: 10px;
                    padding-bottom: 10px;
                    border-bottom: 1px dashed var(--zml-border-color);
                    margin-bottom: 10px;
                }

                /* 图像容器 */
                .zml-image-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
                    gap: 15px;
                }

                /* 文件夹/返回按钮样式 */
                .zml-tag-btn {
                    padding: 8px 16px;
                    border: 1px solid var(--zml-accent-color);
                    border-radius: 20px;
                    background-color: var(--zml-accent-color);
                    cursor: pointer;
                    color: var(--zml-button-text);
                    font-size: 0.9em;
                    transition: all 0.2s ease;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 180px;
                }
                .zml-tag-btn:hover {
                    background-color: var(--zml-accent-hover);
                    border-color: var(--zml-accent-hover);
                }
                .zml-tag-btn.back {
                    background-color: #a9a9a9;
                    border-color: #888;
                }
                .zml-tag-btn.back:hover {
                    background-color: #888;
                    border-color: #666;
                }
                .zml-tag-modal[data-theme="black"] .zml-tag-btn.back {
                    background-color: #616161;
                    border-color: #424242;
                }

                /* 图像按钮 */
                .zml-img-btn {
                    position: relative;
                    padding: 8px;
                    border: 1px solid var(--zml-border-color);
                    border-radius: 5px;
                    background-color: var(--zml-input-bg);
                    cursor: pointer;
                    color: var(--zml-main-text);
                    transition: background-color 0.2s, border-color 0.2s, box-shadow 0.2s;
                    text-align: center;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    min-width: 120px; max-width: 100%;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    min-height: 50px;
                }
                .zml-img-btn:hover {
                    border-color: var(--zml-accent-color);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .zml-img-btn.selected {
                    background-color: #5cb85c !important; /* Important to override dark theme */
                    border-color: #4cae4c !important;
                    color: white !important;
                    box-shadow: 0 2px 10px rgba(0, 255, 0, 0.3);
                }
                .zml-img-btn img {
                    max-width: 100px;
                    max-height: 100px;
                    object-fit: contain;
                    margin-bottom: 5px;
                    border-radius: 3px;
                }
                .zml-img-btn span {
                    word-break: break-all;
                    font-size: 0.85em;
                    line-height: 1.3;
                    max-height: 2.6em;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                /* 模态框底部布局 */
                .zml-tag-modal-footer {
                    padding: 8px 20px;
                    border-top: 1px solid var(--zml-border-color);
                    background-color: var(--zml-header-bg);
                    display: flex; justify-content: space-between; align-items: center;
                }
                .zml-footer-group {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }
                .zml-footer-group.center {
                    flex-grow: 1;
                    justify-content: center;
                }
                .zml-tag-selected-count {
                    color: var(--zml-header-text);
                    font-weight: bold;
                }

                /* 下拉选择器样式 */
                .zml-display-mode-selector {
                    padding: 6px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--zml-input-border);
                    background-color: var(--zml-input-bg);
                    color: var(--zml-main-text);
                    font-size: 0.9em;
                }
                
                /* 按钮通用样式 */
                .zml-action-btn {
                    padding: 8px 16px;
                    border: none;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s ease, box-shadow 0.2s ease;
                    font-size: 0.95em;
                }
                .zml-action-btn:hover:not(:disabled) {
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                }
                .zml-action-btn:disabled {
                    background-color: #cccccc;
                    color: #888888;
                    cursor: not-allowed;
                    box-shadow: none;
                }

                /* 特定动作按钮颜色 */
                .zml-undo-btn { background-color: #f0ad4e; }
                .zml-undo-btn:hover:not(:disabled) { background-color: #ec971f; }
                .zml-clear-btn { background-color: #d9534f; }
                .zml-clear-btn:hover:not(:disabled) { background-color: #c9302c; }

                /* 按钮样式 */
                .zml-confirm-btn-main {
                    padding: 10px 200px;
                    font-size: 1.5em;
                    font-weight: bold;
                    border-radius: 40px;
                    border: none;
                    color: white;
                    cursor: pointer;
                    background-color: var(--zml-accent-color);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                }
                .zml-confirm-btn-main:hover:not(:disabled) {
                    background-color: var(--zml-accent-hover);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.25);
                    transform: translateY(-2px);
                }
			`,
			parent: document.body,
		});
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_TextBlockLoader") {
            // ZML_TextBlockLoader code remains unchanged
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                const imageHost = $el("img.zml-image-preview");
                const showImage = (relativeToEl) => {
                    const bodyRect = document.body.getBoundingClientRect();
                    if (!bodyRect) return;
                    const { left, top, isLeft } = calculateImagePosition(relativeToEl, bodyRect);
                    imageHost.style.left = `${left}px`; imageHost.style.top = `${top}px`;
                    imageHost.classList.toggle("left", isLeft);
                    document.body.appendChild(imageHost);
                };
                const hideImage = () => { imageHost.remove(); };

                const button = this.addWidget("button", "打开图片浏览器", "open", () => {
                    const modal = $el("div", {
                        className: "zml-tag-modal",
                        style: {
                            top: "unset", left: "unset", right: "unset", bottom: "unset",
                            width: "600px", height: "auto", maxWidth: "90vw", maxHeight: "90vh",
                            margin: "auto", position: "fixed",
                            transform: "translate(-50%, -50%)",
                            top: "50%", left: "50%",
                        },
                        children: [
                            $el("div.zml-tag-modal-header", { textContent: "选择图片加载文本块" }),
                            $el("div", {
                                style: {
                                    flexGrow: 1, padding: "15px", overflowY: "auto",
                                    maxHeight: "75vh",
                                },
                                children: [
                                    $el("p", { textContent: "正在加载图片列表..." })
                                ],
                            }),
                            $el("div.zml-tag-modal-footer", {
                                style: { justifyContent: "flex-end"},
                                children: [
                                    $el("button.zml-action-btn", { textContent: "关闭", onclick: () => { backdrop.remove(); modal.remove(); }, style: {backgroundColor: '#5bc0de'} })
                                ]
                            })
                        ]
                    });
                    const backdrop = $el("div.zml-backdrop", {
                        onclick: () => { backdrop.remove(); modal.remove(); }
                    });
                    document.body.appendChild(backdrop);
                    document.body.appendChild(modal);

                    const container = modal.querySelector("div:nth-child(2)");

                    api.fetchApi(`${ZML_API_PREFIX}/get_output_images`)
                        .then(response => response.json())
                        .then(data => {
                            container.innerHTML = "";
                            const header = $el("h4", { textContent: `Output 文件夹中的图片 (路径: ${data.base_path_display}):`});
                            container.appendChild(header);

                            if (data.files.length === 0) {
                                container.innerHTML += "<p>Output 文件夹中没有找到图片。</p>";
                                return;
                            }
                            const folderMap = new Map(), itemsSymbol = Symbol("items"), splitBy = /\\|\//;
                            for (const fileInfo of data.files) {
                                const path = (fileInfo.subfolder ? fileInfo.subfolder.split(splitBy) : []).concat(fileInfo.filename);
                                let currentLevel = folderMap;
                                for (let i = 0; i < path.length - 1; i++) {
                                    if (!currentLevel.has(path[i])) currentLevel.set(path[i], new Map());
                                    currentLevel = currentLevel.get(path[i]);
                                }
                                if (!currentLevel.has(itemsSymbol)) currentLevel.set(itemsSymbol, []);
                                currentLevel.get(itemsSymbol).push(fileInfo);
                            }
                            const insert = (parentEl, map) => {
                                const files = map.get(itemsSymbol) || [];
                                for (const fileInfo of files) {
                                    const fileEl = $el("button.zml-image-browser-file", {textContent: fileInfo.filename, style: {backgroundColor: '#add8e6', borderColor: '#87ceeb', color: '#2a648b'}});
                                    fileEl.addEventListener("mouseover", () => {
                                        imageHost.src = `${ZML_API_PREFIX}/view_image?${new URLSearchParams({filename: fileInfo.filename, subfolder: fileInfo.subfolder, t: +new Date()})}`;
                                        showImage(fileEl);
                                    });
                                    fileEl.addEventListener("mouseout", hideImage);
                                    fileEl.onclick = () => {
                                        hideImage();
                                        api.fetchApi(`${ZML_API_PREFIX}/get_image_text_block?${new URLSearchParams({filename: fileInfo.filename, subfolder: fileInfo.subfolder})}`)
                                            .then(res => res.json()).then(data => {
                                                this.widgets.find(w => w.name === "text_from_image").value = data.text;
                                                backdrop.remove(); modal.remove();
                                            });
                                    };
                                    parentEl.appendChild(fileEl);
                                }
                                for (const [folderName, content] of map.entries()) {
                                    if (folderName === itemsSymbol) continue;
                                    const folderEl = $el("div.zml-image-browser-folder", [ $el("span", {textContent: "▶"}), $el("span", {textContent: folderName}) ]);
                                    parentEl.appendChild(folderEl);
                                    const contentContainer = $el("div.zml-image-browser-contents");
                                    insert(contentContainer, content);
                                    parentEl.appendChild(contentContainer);
                                    folderEl.addEventListener("click", () => {
                                        const arrow = folderEl.querySelector("span");
                                        const isHidden = contentContainer.style.display === "none";
                                        contentContainer.style.display = isHidden ? "block" : "none";
                                        arrow.textContent = isHidden ? "▼" : "▶";
                                    });
                                }
                            };
                            insert(container, folderMap);
                        }).catch(e => {
                            container.innerHTML = `<p style="color:red;">加载图片列表失败: ${e.message}</p>`;
                            console.error("Failed to load output images for ZML_TextBlockLoader:", e);
                        });
                });
            };
        }

        if (nodeData.name === "ZML_TagImageLoader") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                
                const DISPLAY_MODES = {
                    TEXT_ONLY: "text_only",
                    TEXT_HOVER: "text_hover",
                    THUMBNAIL_ONLY: "thumbnail_only",
                };

                const imageHost = $el("img.zml-image-preview");
                const showImage = (relativeToEl) => {
                    const bodyRect = document.body.getBoundingClientRect();
                    if (!bodyRect) return;
                    const { left, top, isLeft } = calculateImagePosition(relativeToEl, bodyRect);
                    imageHost.style.left = `${left}px`; imageHost.style.top = `${top}px`;
                    imageHost.classList.toggle("left", isLeft);
                    document.body.appendChild(imageHost);
                };
                const hideImage = () => { imageHost.remove(); };

                this.addWidget("button", "打开标签选择器", "open", () => {
                    const backdrop = $el("div.zml-backdrop");

                    const displayModeSelector = $el("select.zml-display-mode-selector", [
                        $el("option", { value: DISPLAY_MODES.TEXT_ONLY, textContent: "模式1: 仅名称" }),
                        $el("option", { value: DISPLAY_MODES.TEXT_HOVER, textContent: "模式2: 名称+悬停预览" }),
                        $el("option", { value: DISPLAY_MODES.THUMBNAIL_ONLY, textContent: "模式3: 名称+缩略图" }),
                    ]);

                    const undoBtn = $el("button.zml-action-btn.zml-undo-btn", { textContent: "撤回" });
                    const clearBtn = $el("button.zml-action-btn.zml-clear-btn", { textContent: "清空" });
                    const countEl = $el("div.zml-tag-selected-count");
                    
                    const pathInput = $el("input.zml-path-input", { type: "text", placeholder: "自定义图片文件夹路径 (留空使用output)" });
                    const refreshPathBtn = $el("button.zml-path-refresh-btn", { textContent: "刷新路径" });
                    const pathInputGroup = $el("div.zml-path-input-group", [
                        $el("span", { textContent: "路径:", style: {color: 'var(--zml-secondary-text)'} }),
                        pathInput,
                        refreshPathBtn,
                    ]);

                    const confirmBtn = $el("button.zml-confirm-btn-main", { textContent: "确认" });
                    
                    const modalHeader = $el("div.zml-tag-modal-header", { textContent: "标签化图像选择器" });

                    const modal = $el("div.zml-tag-modal", [
                        modalHeader,
                        pathInputGroup,
                        $el("div.zml-tag-modal-breadcrumbs"),
                        $el("div.zml-tag-modal-content"),
                        $el("div.zml-tag-modal-footer", [
                            $el("div.zml-footer-group", [ displayModeSelector, countEl ]),
                            $el("div.zml-footer-group.center", [ confirmBtn ]),
                            $el("div.zml-footer-group", [ undoBtn, clearBtn ])
                        ])
                    ]);

                    // [新增] 创建并添加主题切换器
                    const themes = [
                        { name: 'blue', color: '#87ceeb' },
                        { name: 'green', color: '#90ee90' },
                        { name: 'yellow', color: '#ffd700' },
                        { name: 'black', color: '#616161' },
                        { name: 'pink', color: '#ffb6c1' },
                    ];
                    const themeSwitcher = $el("div.zml-theme-switcher");
                    const themeButtons = {};
                    themes.forEach(theme => {
                        const btn = $el("button.zml-theme-button", {
                            style: { backgroundColor: theme.color },
                            dataset: { theme: theme.name },
                        });
                        btn.onclick = () => {
                            modal.dataset.theme = theme.name;
                            localStorage.setItem("zml.tagImageLoader.theme", theme.name);
                            // 更新激活状态
                            Object.values(themeButtons).forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                        };
                        themeSwitcher.appendChild(btn);
                        themeButtons[theme.name] = btn;
                    });
                    modalHeader.appendChild(themeSwitcher);
                    
                    // 应用保存的主题
                    const savedTheme = localStorage.getItem("zml.tagImageLoader.theme") || 'blue';
                    modal.dataset.theme = savedTheme;
                    if(themeButtons[savedTheme]) {
                        themeButtons[savedTheme].classList.add('active');
                    }


                    document.body.appendChild(backdrop);
                    document.body.appendChild(modal);

                    let fileTree = {}, currentPath = [], selectedFiles = [], historyStack = [];
                    
                    let currentDisplayMode = localStorage.getItem("zml.tagImageLoader.displayMode") || DISPLAY_MODES.TEXT_ONLY;
                    displayModeSelector.value = currentDisplayMode;
                    
                    pathInput.value = localStorage.getItem("zml.tagImageLoader.lastPath") || "";

                    const selectedFilesJsonWidget = this.widgets.find(w => w.name === "selected_files_json");

                    if (selectedFilesJsonWidget && selectedFilesJsonWidget.value && selectedFilesJsonWidget.value !== "[]") {
                        try {
                            const parsedData = JSON.parse(selectedFilesJsonWidget.value);
                            if (parsedData && Array.isArray(parsedData.files)) {
                                selectedFiles = parsedData.files;
                                if (parsedData._base_path && pathInput.value === "") {
                                    pathInput.value = parsedData._base_path;
                                }
                            } else if (Array.isArray(parsedData)) {
                                selectedFiles = parsedData;
                            }
                        } catch (e) { console.error("ZML_TagImageLoader: 无法解析已存在的JSON选项。", e); selectedFiles = []; }
                    }

                    const contentEl = modal.querySelector(".zml-tag-modal-content");
                    const breadcrumbsEl = modal.querySelector(".zml-tag-modal-breadcrumbs");
                    
                    const updateUiState = () => { countEl.textContent = `已选: ${selectedFiles.length}`; undoBtn.disabled = historyStack.length === 0; };
                    updateUiState();

                    const closeModal = () => { hideImage(); backdrop.remove(); modal.remove(); };
                    backdrop.onclick = closeModal;
                    confirmBtn.onclick = () => { 
                        const dataToSave = {
                            files: selectedFiles,
                            _base_path: pathInput.value
                        };
                        if (selectedFilesJsonWidget) selectedFilesJsonWidget.value = JSON.stringify(dataToSave); 
                        localStorage.setItem("zml.tagImageLoader.lastPath", pathInput.value);
                        closeModal(); 
                    };
                    
                    displayModeSelector.onchange = () => {
                        currentDisplayMode = displayModeSelector.value;
                        localStorage.setItem("zml.tagImageLoader.displayMode", currentDisplayMode);
                        renderCurrentLevel();
                    };

                    const pushHistory = () => {
                        historyStack.push(JSON.parse(JSON.stringify(selectedFiles)));
                        if (historyStack.length > 20) historyStack.shift();
                        updateUiState();
                    };

                    undoBtn.onclick = () => {
                        if (historyStack.length > 0) {
                            selectedFiles = historyStack.pop();
                            renderCurrentLevel();
                            updateUiState();
                        }
                    };
                    clearBtn.onclick = () => {
                        if (selectedFiles.length > 0) {
                            pushHistory();
                            selectedFiles.length = 0;
                            renderCurrentLevel();
                            updateUiState();
                        }
                    };

                    const fetchAndRenderFiles = async () => {
                        currentPath = []; fileTree = {};
                        contentEl.innerHTML = "<p>正在加载图片列表...</p>";
                        breadcrumbsEl.textContent = "路径: /";
                        
                        const customPath = pathInput.value.trim();
                        let apiUrl = `${ZML_API_PREFIX}/get_output_images`;
                        if (customPath) {
                            apiUrl += `?custom_path=${encodeRFC3986URIComponent(customPath)}`;
                        }

                        try {
                            const response = await api.fetchApi(apiUrl);
                            const data = await response.json();
                            
                            if (data.files.length === 0) {
                                contentEl.innerHTML = `<p>在路径 '${customPath || "output"}' 中没有找到图片。</p>`;
                                return;
                            }
                            for (const fileInfo of data.files) {
                                const subfolderPath = fileInfo.subfolder || "";
                                const pathParts = subfolderPath ? subfolderPath.split(/\\|\//) : [];
                                let currentLevel = fileTree;
                                for (let i = 0; i < pathParts.length; i++) {
                                    const part = pathParts[i];
                                    if (!part) continue;
                                    if (!currentLevel[part]) { currentLevel[part] = {}; }
                                    currentLevel = currentLevel[part];
                                }
                                if (!currentLevel.files) currentLevel.files = [];
                                currentLevel.files.push(fileInfo);
                            }
                            renderCurrentLevel();
                        } catch (error) {
                            contentEl.innerHTML = `<p style="color:red;">加载失败: ${error.message}</p>`;
                            console.error("Failed to load images from API:", error);
                        }
                    };
                    
                    // ==================== START: MODIFIED CODE ====================

                    /**
                     * @summary 路径刷新事件的处理器
                     * 这个函数会在用户点击“刷新路径”或在输入框按回车时触发。
                     * 它会先清空当前已有的选择，然后再调用 fetchAndRenderFiles 加载新内容。
                     */
                    const handlePathRefresh = () => {
                        // 如果在刷新路径时已经有选中的文件，则先将其清空
                        if (selectedFiles.length > 0) {
                            pushHistory(); // 将清空前的状态存入历史，以便撤回
                            selectedFiles.length = 0; // 高效清空已选文件数组
                            updateUiState(); // 立即更新UI显示（例如已选数量变为0）
                        }
                        fetchAndRenderFiles(); // 调用核心函数加载新路径的文件
                    };

                    const renderCurrentLevel = () => {
                    // ==================== END: MODIFIED CODE ======================
                        contentEl.innerHTML = "";
                        const folderContainer = $el("div.zml-folder-container");
                        const imageContainer = $el("div.zml-image-container");
                        contentEl.appendChild(folderContainer);
                        contentEl.appendChild(imageContainer);
                        let currentLevel = fileTree;
                        
                        const tempCurrentPath = [...currentPath];
                        currentPath.length = 0;
                        for (const part of tempCurrentPath) {
                            if (currentLevel[part]) {
                                currentLevel = currentLevel[part];
                                currentPath.push(part);
                            } else {
                                console.warn(`Path part '${part}' not found.`);
                                break;
                            }
                        }

                        breadcrumbsEl.textContent = `当前目录: ${currentPath.length > 0 ? `/ ${currentPath.join(" / ")}` : "/ (根目录)"}`;

                        if (currentPath.length > 0) {
                             const backBtn = $el("button.zml-tag-btn.back", { textContent: "⬅️ 返回上一级" });
                             backBtn.onclick = () => { currentPath.pop(); renderCurrentLevel(); };
                             folderContainer.appendChild(backBtn);
                        }

                        Object.keys(currentLevel).forEach(key => {
                            if (typeof currentLevel[key] === 'object' && !Array.isArray(currentLevel[key])) {
                                const tagBtn = $el("button.zml-tag-btn", { textContent: key });
                                tagBtn.onclick = () => { currentPath.push(key); renderCurrentLevel(); };
                                folderContainer.appendChild(tagBtn);
                            }
                        });
                        
                        if (currentLevel.files) {
                            currentLevel.files.sort((a,b) => a.filename.localeCompare(b.filename));
                            for (const fileInfo of currentLevel.files) {
                                const [displayName] = fileInfo.filename.split('.');
                                const imgInnerChildren = [$el("span", { textContent: displayName })];
                                const imgBtn = $el("button.zml-img-btn", imgInnerChildren);

                                switch(currentDisplayMode) {
                                    case DISPLAY_MODES.TEXT_HOVER:
                                        imgBtn.addEventListener("mouseover", () => {
                                            const customPath = pathInput.value.trim();
                                            const queryParams = new URLSearchParams({
                                                filename: fileInfo.filename,
                                                subfolder: fileInfo.subfolder,
                                                t: +new Date(),
                                            });
                                            if (customPath) queryParams.append("custom_path", customPath);
                                            imageHost.src = `${ZML_API_PREFIX}/view_image?${queryParams.toString()}`;
                                            showImage(imgBtn);
                                        });
                                        imgBtn.addEventListener("mouseout", hideImage);
                                        break;

                                    case DISPLAY_MODES.THUMBNAIL_ONLY:
                                        const thumb = $el("img", {
                                            loading: "lazy",
                                            src: `${ZML_API_PREFIX}/view_image_thumb?filename=${encodeRFC3986URIComponent(fileInfo.filename)}&subfolder=${encodeRFC3986URIComponent(fileInfo.subfolder)}&custom_path=${encodeRFC3986URIComponent(pathInput.value.trim())}`
                                        });
                                        imgBtn.prepend(thumb);
                                        break;
                                    
                                    case DISPLAY_MODES.TEXT_ONLY:
                                    default:
                                        // 无需额外操作
                                        break;
                                }

                                if (selectedFiles.some(f => f.filename === fileInfo.filename && f.subfolder === fileInfo.subfolder)) {
                                    imgBtn.classList.add("selected");
                                }

                                imgBtn.onclick = () => {
                                    pushHistory();
                                    const index = selectedFiles.findIndex(f => f.filename === fileInfo.filename && f.subfolder === fileInfo.subfolder);
                                    if (index > -1) {
                                        selectedFiles.splice(index, 1);
                                        imgBtn.classList.remove("selected");
                                    } else {
                                        selectedFiles.push(fileInfo);
                                        imgBtn.classList.add("selected");
                                    }
                                    updateUiState();
                                };
                                imageContainer.appendChild(imgBtn);
                            }
                        }
                    };
                    
                    // ==================== START: MODIFIED CODE ====================
                    
                    // 将事件监听器指向新的 handlePathRefresh 函数
                    pathInput.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            handlePathRefresh();
                        }
                    });
                    refreshPathBtn.onclick = handlePathRefresh;
                    
                    // 首次加载时，直接调用 fetchAndRenderFiles，以保留已有的选择
                    fetchAndRenderFiles();
                    
                    // ==================== END: MODIFIED CODE ======================
                });
            };
        }
    },
});