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
                
                /* === 新增: 编辑和查看按钮的样式 === */
                .zml-edit-btn, .zml-view-image-btn {
                    position: absolute;
                    top: 5px;
                    z-index: 10;
                    background: rgba(0, 0, 0, 0.5);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s, transform 0.2s;
                    backdrop-filter: blur(2px);
                }
                .zml-edit-btn:hover, .zml-view-image-btn:hover {
                    background: rgba(0, 0, 0, 0.75);
                    transform: scale(1.1);
                }
                .zml-edit-btn { left: 5px; }
                .zml-view-image-btn { right: 5px; }
                .zml-edit-btn svg, .zml-view-image-btn svg {
                    width: 16px;
                    height: 16px;
                    fill: white;
                }
                
                /* === 新增: 编辑弹窗的样式 === */
                .zml-edit-modal { 
                    top: 15%; left: 20%; right: 20%; bottom: unset; height: 60vh; 
                }
                .zml-edit-modal-textarea {
                    width: 100%; height: 100%; box-sizing: border-box; resize: none;
                    padding: 10px; font-size: 1em; background-color: var(--zml-input-bg);
                    color: var(--zml-main-text); border: 1px solid var(--zml-input-border); border-radius: 4px;
                }
                .zml-edit-modal-copy-btn {
                    position: absolute; bottom: 15px; left: 15px; padding: 8px 16px;
                    font-size: 0.9em; background-color: #4A90E2; color: white; border: none;
                    border-radius: 5px; cursor: pointer; transition: background-color 0.2s ease, transform 0.1s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.15); z-index: 10;
                }
                .zml-edit-modal-copy-btn:hover { background-color: #357ABD; }
                .zml-edit-modal-copy-btn:active { transform: scale(0.98); }

                /* === 新增: 图片查看器的样式 === */
                 .zml-image-viewer-modal { 
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background-color: rgba(0, 0, 0, 0.8); z-index: 2000; 
                }
                .zml-image-viewer-content { 
                    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                    display: flex; flex-direction: column; align-items: center; background: #222; 
                    padding: 10px; border-radius: 8px; box-shadow: 0 5px 30px rgba(0,0,0,0.5); 
                }
                .zml-image-viewer-img { 
                    max-width: 80vw; max-height: 80vh; object-fit: contain; 
                    border: 1px solid #555; cursor: move; 
                }
                .zml-image-viewer-close-btn { 
                    position: absolute; top: -15px; right: -15px; background-color: #f44336; 
                    color: white; border: none; border-radius: 50%; width: 35px; height: 35px; 
                    font-size: 1.5em; cursor: pointer; display: flex; justify-content: center; 
                    align-items: center; transition: background-color 0.2s, transform 0.2s; 
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2); 
                }
                .zml-image-viewer-close-btn:hover { background-color: #d32f2f; transform: scale(1.05); }


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
                .zml-action-btn.undo, .zml-undo-btn { background-color: #f0ad4e; }
                .zml-action-btn.undo:hover:not(:disabled), .zml-undo-btn:hover:not(:disabled) { background-color: #ec971f; }
                .zml-action-btn.cancel, .zml-clear-btn { background-color: #d9534f; }
                .zml-action-btn.cancel:hover:not(:disabled), .zml-clear-btn:hover:not(:disabled) { background-color: #c9302c; }
                .zml-action-btn.confirm { background-color: #5cb85c; }
                .zml-action-btn.confirm:hover:not(:disabled) { background-color: #4cae4c; }


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
                
                // === 新增: SVG 图标常量 ===
                const pencilIconSVG = `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M17.56 2.44a4.2 4.2 0 0 0-5.94 0L3.4 10.66a1 1 0 0 0-.29.71L2 17l5.63-.88a1 1 0 0 0 .7-.29l8.22-8.23a4.2 4.2 0 0 0 0-5.94zM7.07 14.5l-2.12.33.33-2.12 6.37-6.36 1.79 1.8-6.37 6.35zM16.15 7l-1.8-1.79 1.1-1.1a2.82 2.82 0 1 1 4 4l-1.1 1.1-1.79-1.8.6-.6z"></path></svg>`;
                const viewIconSVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;

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
                
                // === 新增: 拖动逻辑辅助函数 ===
                const makeDraggable = (element, handle) => {
                    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
                    handle.onmousedown = dragMouseDown;

                    function dragMouseDown(e) {
                        e = e || window.event;
                        e.preventDefault();
                        pos3 = e.clientX;
                        pos4 = e.clientY;
                        document.onmouseup = closeDragElement;
                        document.onmousemove = elementDrag;
                        if (element.style.transform) {
                            const rect = element.getBoundingClientRect();
                            element.style.transform = "none";
                            element.style.left = `${rect.left}px`;
                            element.style.top = `${rect.top}px`;
                        }
                    }

                    function elementDrag(e) {
                        e = e || window.event;
                        e.preventDefault();
                        pos1 = pos3 - e.clientX;
                        pos2 = pos4 - e.clientY;
                        pos3 = e.clientX;
                        pos4 = e.clientY;
                        element.style.top = (element.offsetTop - pos2) + "px";
                        element.style.left = (element.offsetLeft - pos1) + "px";
                    }

                    function closeDragElement() {
                        document.onmouseup = null;
                        document.onmousemove = null;
                    }
                };
                
                // === 新增: 创建图片查看器弹窗的函数 ===
                const createImageViewerModal = (imageUrl) => {
                    const modal = $el("div.zml-image-viewer-modal");
                    const content = $el("div.zml-image-viewer-content");
                    const img = $el("img.zml-image-viewer-img", { src: imageUrl, alt: "Full Image" });
                    const closeBtn = $el("button.zml-image-viewer-close-btn", { textContent: "✖" });

                    const closeModal = () => { modal.remove(); };
                    closeBtn.onclick = closeModal;
                    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

                    content.append(img, closeBtn);
                    modal.appendChild(content);
                    document.body.appendChild(modal);

                    makeDraggable(content, img);
                };
                
                // === 关键修复: 创建编辑文本块弹窗的函数 ===
                const createEditModal = (currentText) => {
                    return new Promise((resolve, reject) => {
                        const backdrop = $el("div.zml-backdrop");
                        const textarea = $el("textarea.zml-edit-modal-textarea", { value: currentText });
                        const saveBtn = $el("button.zml-action-btn.confirm", { textContent: "保存" });
                        const cancelBtn = $el("button.zml-action-btn.cancel", { textContent: "取消" });
                        const copyEditBtn = $el("button.zml-edit-modal-copy-btn", { textContent: "复制" });
                        
                        copyEditBtn.onclick = () => {
                            if (!textarea.value) return;
                            navigator.clipboard.writeText(textarea.value).then(() => {
                                const originalText = copyEditBtn.textContent;
                                copyEditBtn.textContent = "已复制!";
                                setTimeout(() => { copyEditBtn.textContent = originalText; }, 2000);
                            }).catch(err => { alert("复制失败: " + err); });
                        };
                        
                        const activeTheme = document.querySelector('.zml-tag-modal')?.dataset.theme || localStorage.getItem("zml.tagImageLoader.theme") || 'blue';
                        
                        // -- 修复开始 --
                        // 创建各个部分
                        const header = $el("div.zml-tag-modal-header", { textContent: "编辑文本块" });
                        const content = $el("div.zml-tag-modal-content");
                        const footer = $el("div.zml-tag-modal-footer", {
                            style: { justifyContent: 'flex-end', gap: '10px', position: 'relative' }
                        });

                        // 使用 append 方法添加子元素，而不是通过 'children' 属性
                        content.appendChild(textarea);
                        footer.append(copyEditBtn, cancelBtn, saveBtn);

                        const modal = $el("div.zml-tag-modal.zml-edit-modal", {
                            dataset: { theme: activeTheme }
                        });
                        modal.append(header, content, footer);
                        // -- 修复结束 --

                        const closeModal = () => { modal.remove(); backdrop.remove(); };
                        saveBtn.onclick = () => { resolve(textarea.value); closeModal(); };
                        cancelBtn.onclick = () => { reject(new Error("用户取消操作")); closeModal(); };
                        backdrop.onclick = cancelBtn.onclick;
                        document.body.appendChild(backdrop);
                        document.body.appendChild(modal);
                        textarea.focus();
                    });
                };

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
                    
                    const handlePathRefresh = () => {
                        if (selectedFiles.length > 0) {
                            pushHistory(); 
                            selectedFiles.length = 0;
                            updateUiState();
                        }
                        fetchAndRenderFiles();
                    };

                    const renderCurrentLevel = () => {
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
                                const customPath = pathInput.value.trim();

                                const baseQueryParams = new URLSearchParams({
                                    filename: fileInfo.filename,
                                    subfolder: fileInfo.subfolder,
                                });
                                if (customPath) baseQueryParams.append("custom_path", customPath);

                                switch(currentDisplayMode) {
                                    case DISPLAY_MODES.TEXT_HOVER:
                                        imgBtn.addEventListener("mouseover", () => {
                                            const hoverParams = new URLSearchParams(baseQueryParams);
                                            hoverParams.append("t", +new Date());
                                            imageHost.src = `${ZML_API_PREFIX}/view_image?${hoverParams.toString()}`;
                                            showImage(imgBtn);
                                        });
                                        imgBtn.addEventListener("mouseout", hideImage);
                                        break;

                                    case DISPLAY_MODES.THUMBNAIL_ONLY:
                                        const thumbParams = new URLSearchParams(baseQueryParams);
                                        const thumb = $el("img", {
                                            loading: "lazy",
                                            src: `${ZML_API_PREFIX}/view_image_thumb?${thumbParams.toString()}`
                                        });
                                        imgBtn.prepend(thumb);
                                        
                                        const editBtn = $el("button.zml-edit-btn", { innerHTML: pencilIconSVG, title: "编辑文本块" });
                                        editBtn.onclick = async (event) => {
                                            event.stopPropagation();
                                            const originalContent = editBtn.innerHTML;
                                            editBtn.innerHTML = '...';
                                            try {
                                                const getTextUrl = `${ZML_API_PREFIX}/get_single_text_block?${baseQueryParams.toString()}`;
                                                const res = await api.fetchApi(getTextUrl);
                                                if (!res.ok) throw new Error("获取文本块失败: " + await res.text());
                                                const data = await res.json();
                                                
                                                const newText = await createEditModal(data.text_content || "");

                                                const writeData = {
                                                    custom_path: customPath,
                                                    ...fileInfo,
                                                    text_content: newText
                                                };
                                                const writeRes = await api.fetchApi(`${ZML_API_PREFIX}/write_text_block`, {
                                                    method: 'POST',
                                                    headers: {'Content-Type': 'application/json'},
                                                    body: JSON.stringify(writeData)
                                                });
                                                
                                                const writeResult = await writeRes.json();
                                                if (!writeRes.ok || writeResult.error) {
                                                    throw new Error(writeResult.error || "写入失败");
                                                }
                                                alert("写入成功！");

                                            } catch (err) {
                                                if (err.message !== "用户取消操作") {
                                                     alert(`操作失败: ${err.message}`);
                                                     console.error("编辑文本块失败:", err);
                                                }
                                            } finally {
                                                editBtn.innerHTML = originalContent;
                                            }
                                        };
                                        imgBtn.appendChild(editBtn);

                                        const fullImageUrl = `${ZML_API_PREFIX}/view_image?${baseQueryParams.toString()}`;
                                        const viewImageBtn = $el("button.zml-view-image-btn", { innerHTML: viewIconSVG, title: "查看大图" });
                                        viewImageBtn.onclick = (event) => {
                                            event.stopPropagation();
                                            createImageViewerModal(fullImageUrl);
                                        };
                                        imgBtn.appendChild(viewImageBtn);
                                        break;
                                    
                                    case DISPLAY_MODES.TEXT_ONLY:
                                    default:
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
                    
                    pathInput.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            handlePathRefresh();
                        }
                    });
                    refreshPathBtn.onclick = handlePathRefresh;
                    
                    fetchAndRenderFiles();
                    
                });
            };
        }
    },
});