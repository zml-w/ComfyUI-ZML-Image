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
                    z-index: 999;
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

                /* 新增: 固定头部容器 */
                .zml-modal-fixed-header {
                    position: sticky;
                    top: 0;
                    z-index: 100;
                    background-color: var(--zml-main-bg);
                    padding: 0 0 0; /* 调整内边距，移除垂直方向的额外padding */
                    border-bottom: 1px solid var(--zml-border-color);
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
                    padding: 5px 20px; /* 调整垂直内边距 */
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
                    padding: 10px 20px; /* 调整内边距，使其与路径输入组和面包屑对齐 */
                    /* 移除 border-bottom 和 margin-bottom，因为父元素 fixed-header 已经有 border-bottom */
                }

                /* 图像容器 */
                .zml-image-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
                    gap: 15px;
                }
                
                /* 中图标模式下的图像容器 */
                .zml-image-container.medium-icon-mode {
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
                
                /* 中图标模式下的图像按钮 */
                .zml-img-btn.medium-icon-mode {
                    min-height: 180px;
                }
                
                .zml-img-btn.medium-icon-mode img {
                    max-width: 100%;
                    max-height: 150px;
                    margin-bottom: 0;
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

                /* === 新增: “记住位置”按钮样式 === */
                .zml-remember-btn {
                    background-color: #a9a9a9; /* 灰色代表关闭状态 */
                    font-size: 0.9em;
                    padding: 6px 12px;
                }
                .zml-remember-btn:hover {
                    filter: brightness(1.1);
                }
                .zml-remember-btn.active {
                    background-color: #5cb85c; /* 绿色代表开启状态 */
                }

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
                    MEDIUM_ICON_ONLY: "medium_icon_only",
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
                        const backdrop = $el("div.zml-backdrop", { style: { zIndex: 2020 } });
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
                            dataset: { theme: activeTheme },
                            style: { zIndex: 2021 }
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
                        $el("option", { value: DISPLAY_MODES.MEDIUM_ICON_ONLY, textContent: "模式4: 中图标" }),
                    ]);

                    const undoBtn = $el("button.zml-action-btn.zml-undo-btn", { textContent: "撤回" });
                    const clearBtn = $el("button.zml-action-btn.zml-clear-btn", { textContent: "清空" });
                    const randomBtn = $el("button.zml-action-btn.zml-random-btn.confirm", { textContent: "随机选择" });
                    // 在随机选择按钮左侧添加随机个数选择器
                    const randomCountSelect = $el("select.zml-random-count-select", { style: { minWidth: "80px", padding: "4px 8px", fontSize: "14px" } });
                    // 创建选项并添加到选择器
                    const options = [
                        $el("option", { value: "1", textContent: "1个" }),
                        $el("option", { value: "2", textContent: "2个" }),
                        $el("option", { value: "3", textContent: "3个" }),
                        $el("option", { value: "5", textContent: "5个" }),
                        $el("option", { value: "10", textContent: "10个" }),
                        $el("option", { value: "20", textContent: "20个" })
                    ];
                    options.forEach(option => randomCountSelect.appendChild(option));
                    // 修改为按钮形式
                    const countEl = $el("button.zml-tag-selected-count", {
                        style: {
                            position: "absolute",
                            top: "50%",
                            right: "220px", // 放置在排序按钮左侧
                            transform: "translateY(-50%)",
                            padding: "6px 12px",
                            fontSize: "0.9em",
                            backgroundColor: "var(--zml-accent-color)",
                            color: "var(--zml-button-text)",
                            borderRadius: "4px",
                            border: "none",
                            cursor: "pointer",
                            transition: "background-color 0.2s ease",
                            zIndex: 10,
                        }
                    });
                    // 鼠标悬停效果
                    countEl.onmouseover = () => { countEl.style.backgroundColor = "var(--zml-accent-hover)"; };
                    countEl.onmouseout = () => { countEl.style.backgroundColor = "var(--zml-accent-color)"; };
                    
                    // --- 🔴 MODIFICATION START: “记住位置”按钮 ---
                    const rememberPathBtn = $el("button.zml-action-btn.zml-remember-btn", { textContent: "记住打开位置" });
                    // --- 🔴 MODIFICATION END ---
                    
                    // --- 🔴 NEW FEATURE: 预设路径下拉列表 --- 
                    const LS_PRESET_PATHS_KEY = "zml.tagImageLoader.presetPaths";
                    let presetPaths = [];
                    
                    // 从localStorage加载预设路径，并限制数量为5个
                    try {
                        const savedPresets = localStorage.getItem(LS_PRESET_PATHS_KEY);
                        if (savedPresets) {
                            presetPaths = JSON.parse(savedPresets);
                            // 限制预设数量不超过5个
                            if (presetPaths.length > 5) {
                                presetPaths = presetPaths.slice(0, 5);
                                localStorage.setItem(LS_PRESET_PATHS_KEY, JSON.stringify(presetPaths));
                            }
                        }
                    } catch (e) {
                        console.error("ZML_TagImageLoader: 无法加载预设路径。", e);
                    }
                    
                    // 创建下拉列表容器
                    const presetSelectorContainer = $el("div.zml-preset-selector-container", {
                        style: {
                            position: "relative",
                            display: "inline-block"
                        }
                    });
                    
                    // 创建预设选择按钮
                    const presetSelectBtn = $el("button.zml-preset-select-btn", {
                        textContent: "常用预设",
                        style: {
                            padding: "3px 10px",
                            border: "1px solid var(--zml-border-color)",
                            backgroundColor: "var(--zml-accent-color)",
                            color: "var(--zml-button-text)",
                            cursor: "pointer",
                            borderRadius: "4px 0 0 4px",
                            height: "24px",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            transition: "all 0.2s ease-in-out",
                            fontSize: "11px"
                        }
                    });

                    // 常用预设按钮悬停效果
                    presetSelectBtn.onmouseover = () => {
                        presetSelectBtn.style.backgroundColor = "var(--zml-accent-hover)";
                        presetSelectBtn.style.borderColor = "var(--zml-accent-color)";
                    };
                    presetSelectBtn.onmouseout = () => {
                        presetSelectBtn.style.backgroundColor = "var(--zml-accent-color)";
                        presetSelectBtn.style.borderColor = "var(--zml-border-color)";
                    };
                    
                    // 创建下拉内容容器
                    const dropdownContent = $el("div.zml-preset-dropdown-content", {
                        style: {
                            display: "none",
                            position: "absolute",
                            backgroundColor: "var(--zml-bg-color, #ffffff)", // 默认为白色背景
                            minWidth: "180px",
                            border: "1px solid var(--zml-border-color)",
                            borderRadius: "4px",
                            zIndex: 1000,
                            maxHeight: "200px",
                            overflowY: "auto",
                            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)", // 添加阴影增加层次感
                            opacity: "1" // 确保完全不透明
                        }
                    });
                    
                    // 显示/隐藏下拉菜单
                    presetSelectBtn.onclick = (e) => {
                        e.stopPropagation();
                        dropdownContent.style.display = dropdownContent.style.display === "block" ? "none" : "block";
                    };
                    
                    // 点击外部关闭下拉菜单
                    document.addEventListener("click", (e) => {
                          if (!presetSelectorContainer.contains(e.target)) {
                              dropdownContent.style.display = "none";
                          }
                      });

                      // 设置下拉菜单背景色以统一按钮缝隙颜色
                      dropdownContent.style.backgroundColor = "var(--zml-modal-bg-color)";
                    
                    // 创建保存预设按钮
                    const addPresetBtn = $el("button.zml-add-preset-btn", {
                        textContent: "保存当前路径到预设",
                        style: {
                            width: "calc(100% - 20px)",
                            padding: "6px 12px",
                            margin: "6px auto",
                            border: "1px solid var(--zml-accent-color)",
                            backgroundColor: "var(--zml-accent-color)",
                            color: "var(--zml-button-text)",
                            cursor: "pointer",
                            textAlign: "center",
                            borderRadius: "8px",
                            display: "block",
                            transition: "all 0.3s ease",
                            fontWeight: "500",
                            fontSize: "11px",
                            boxShadow: "0 2px 5px rgba(0, 0, 0, 0.1)"
                        }
                    });

                    // 按钮悬停和点击效果
                    addPresetBtn.onmouseover = () => {
                        addPresetBtn.style.backgroundColor = "var(--zml-accent-hover)";
                        addPresetBtn.style.transform = "translateY(-2px)";
                        addPresetBtn.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.15)";
                    };
                    addPresetBtn.onmouseout = () => {
                        addPresetBtn.style.backgroundColor = "var(--zml-accent-color)";
                        addPresetBtn.style.transform = "translateY(0)";
                        addPresetBtn.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
                    };
                    addPresetBtn.onmousedown = () => {
                        addPresetBtn.style.transform = "translateY(0)";
                        addPresetBtn.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.1)";
                    };
                    addPresetBtn.onmouseup = () => {
                        addPresetBtn.style.transform = "translateY(-2px)";
                        addPresetBtn.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.15)";
                    };
                    addPresetBtn.onmouseleave = () => {
                        addPresetBtn.style.transform = "translateY(0)";
                        addPresetBtn.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
                    };
                    
                    addPresetBtn.onclick = () => {
                        const currentPath = pathInput.value.trim();
                        if (currentPath) {
                            const presetName = prompt("请输入预设名称：");
                            if (presetName && presetName.trim()) {
                                // 检查是否已存在同名预设
                                const existingIndex = presetPaths.findIndex(p => p.name === presetName.trim());
                                if (existingIndex >= 0) {
                                    if (confirm(`预设名称'${presetName}'已存在，是否覆盖？`)) {
                                        presetPaths[existingIndex] = { name: presetName.trim(), path: currentPath };
                                    } else {
                                        return;
                                    }
                                } else {
                                    presetPaths.push({ name: presetName.trim(), path: currentPath });
                                }
                                
                                // 保存到localStorage
                                localStorage.setItem(LS_PRESET_PATHS_KEY, JSON.stringify(presetPaths));
                                
                                // 重新渲染预设列表
                                renderPresetList();
                            }
                        } else {
                            alert("请先输入有效的路径再创建预设。");
                        }
                    };
                    
                    // 渲染预设列表
                    const renderPresetList = () => {
                        // 清空现有内容
                        dropdownContent.innerHTML = "";
                        
                        // 添加新建预设按钮
                        dropdownContent.appendChild(addPresetBtn);
                        
                        // 如果没有预设，添加提示
                        if (presetPaths.length === 0) {
                            const emptyMsg = $el("div.zml-empty-preset-msg", {
                                textContent: "暂无预设路径",
                                style: {
                                    padding: "12px",
                                    textAlign: "center",
                                    color: "#1890ff"
                                }
                            });
                            dropdownContent.appendChild(emptyMsg);
                            return;
                        }
                        
                        // 添加预设项目
                        presetPaths.forEach((preset, index) => {
                            const presetItem = $el("div.zml-preset-item", {
                                style: {
                                    width: "calc(100% - 20px)",
                                    padding: "6px 12px",
                                    cursor: "pointer",
                                    position: "relative",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    transition: "all 0.3s ease",
                                    backgroundColor: "var(--zml-accent-color)",
                                    border: "1px solid var(--zml-accent-color)",
                                    color: "var(--zml-button-text)",
                                    borderRadius: "8px",
                                    margin: "6px auto",
                                    fontWeight: "500",
                                    fontSize: "11px",
                                    boxShadow: "0 2px 5px rgba(0, 0, 0, 0.1)"
                                }
                            });

                            // 预设项悬停和点击效果
                            presetItem.onmouseover = () => {
                                presetItem.style.backgroundColor = "var(--zml-accent-hover)";
                                presetItem.style.transform = "translateY(-2px)";
                                presetItem.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.15)";
                                presetItem.style.borderColor = "var(--zml-accent-color)";
                            };
                            presetItem.onmouseout = () => {
                                presetItem.style.backgroundColor = "var(--zml-accent-color)";
                                presetItem.style.transform = "translateY(0)";
                                presetItem.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
                                presetItem.style.borderColor = "var(--zml-accent-color)";
                            };
                            presetItem.onmousedown = () => {
                                presetItem.style.transform = "translateY(0)";
                                presetItem.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.1)";
                            };
                            presetItem.onmouseup = () => {
                                presetItem.style.transform = "translateY(-2px)";
                                presetItem.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.15)";
                            };
                            presetItem.onmouseleave = () => {
                                presetItem.style.transform = "translateY(0)";
                                presetItem.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
                            };
                            
                            // 预设名称和路径
                            const presetInfo = $el("div.zml-preset-info", {
                                style: {
                                    maxWidth: "150px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }
                            });
                            
                            const presetName = $el("div.zml-preset-name", {
                                textContent: preset.name,
                                title: preset.name,
                                style: {
                                    fontWeight: "bold",
                                    fontSize: "11px",
                                    color: "var(--zml-secondary-text)"
                                }
                            });
                            
                            const presetPath = $el("div.zml-preset-path", {
                                textContent: preset.path,
                                title: preset.path,
                                style: {
                                    fontSize: "11px",
                                    color: "var(--zml-secondary-text)"
                                }
                            });
                            
                            presetInfo.append(presetName, presetPath);
                            
                            // 删除按钮
                            const deleteBtn = $el("button.zml-delete-preset-btn", {
                                textContent: "×",
                                style: {
                                    border: "1px solid var(--zml-danger-color, #ff4d4f)",
                                    backgroundColor: "transparent",
                                    color: "var(--zml-danger-color, #ff4d4f)",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    width: "20px",
                                    height: "20px",
                                    padding: "0",
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    opacity: "0.7",
                                    transition: "all 0.2s ease-in-out"
                                }
                            });

                            // 删除按钮悬停效果
                            deleteBtn.onmouseover = () => {
                                deleteBtn.style.opacity = "1";
                                deleteBtn.style.backgroundColor = "var(--zml-danger-color, #ff4d4f)";
                                deleteBtn.style.color = "white";
                            };
                            deleteBtn.onmouseout = () => {
                                deleteBtn.style.opacity = "0.7";
                                deleteBtn.style.backgroundColor = "transparent";
                                deleteBtn.style.color = "var(--zml-danger-color, #ff4d4f)";
                            };
                            
                            deleteBtn.onclick = (e) => {
                                e.stopPropagation();
                                if (confirm(`确定要删除预设'${preset.name}'吗？`)) {
                                    presetPaths.splice(index, 1);
                                    localStorage.setItem(LS_PRESET_PATHS_KEY, JSON.stringify(presetPaths));
                                    renderPresetList();
                                }
                            };
                            
                            presetItem.append(presetInfo, deleteBtn);
                            
                            // 选择预设时填充到输入框
                            presetItem.onclick = () => {
                                pathInput.value = preset.path;
                                dropdownContent.style.display = "none";
                                // 添加选择反馈
                                const originalBg = presetItem.style.backgroundColor;
                                presetItem.style.backgroundColor = "#e6f7ff";
                                setTimeout(() => {
                                    presetItem.style.backgroundColor = originalBg;
                                }, 300);
                            };
                            
                            dropdownContent.appendChild(presetItem);
                        });
                    };
                    
                    // 初始化预设列表
                    renderPresetList();
                    
                    // 将下拉内容添加到容器
                    presetSelectorContainer.append(presetSelectBtn, dropdownContent);
                    // --- 🔴 NEW FEATURE END ---
                    
                    const pathInput = $el("input.zml-path-input", { type: "text", placeholder: "自定义图片文件夹路径 (留空使用output)" });
                    const refreshPathBtn = $el("button.zml-path-refresh-btn", { textContent: "刷新路径" });
                    const pathInputGroup = $el("div.zml-path-input-group", [
                        $el("span", { textContent: "路径:", style: {color: 'var(--zml-secondary-text)'} }),
                        presetSelectorContainer,
                        pathInput,
                        refreshPathBtn,
                    ]);

                    const confirmBtn = $el("button.zml-confirm-btn-main", { textContent: "确认" });
                    
                    const modalHeader = $el("div.zml-tag-modal-header", { textContent: "标签化图像选择器" });

                    const fixedHeader = $el("div.zml-modal-fixed-header", [
                        pathInputGroup,
                        $el("div.zml-tag-modal-breadcrumbs"),
                    ]);

                    const modal = $el("div.zml-tag-modal", [
                        modalHeader,
                        fixedHeader, // 将固定头部添加到模态框
                        $el("div.zml-tag-modal-content"),
                        $el("div.zml-tag-modal-footer", [
                            // --- 🔴 MODIFICATION START: 添加按钮到Footer ---
                            $el("div.zml-footer-group", [ displayModeSelector, rememberPathBtn ]),
                            // --- 🔴 MODIFICATION END ---
                            $el("div.zml-footer-group.center", [ confirmBtn ]),
                            $el("div.zml-footer-group", [ randomCountSelect, randomBtn, undoBtn, clearBtn ])
                        ])
                    ]);

                    // [新增] 创建并添加主题切换器
                    const THEMES = {
                        blue: { name: '天空蓝', color: '#87ceeb', vars: { '--zml-bg-color': '#2c3e50', '--zml-modal-bg-color': '#34495e', '--zml-secondary-bg-color': '#4a6fa5', '--zml-input-bg-color': '#283747', '--zml-border-color': '#5d7bb2', '--zml-text-color': '#ecf0f1', '--zml-text-color-secondary': '#bdc3c7', '--zml-button-text': '#ffffff' } },
                        green: { name: '抹茶绿', color: '#90ee90', vars: { '--zml-bg-color': '#2e463c', '--zml-modal-bg-color': '#385449', '--zml-secondary-bg-color': '#4CAF50', '--zml-input-bg-color': '#263a31', '--zml-border-color': '#5a7e6b', '--zml-text-color': '#e8f5e9', '--zml-text-color-secondary': '#c8e6c9', '--zml-button-text': '#ffffff' } },
                        yellow: { name: '活力黄', color: '#ffd700', vars: { '--zml-bg-color': '#53431b', '--zml-modal-bg-color': '#614d20', '--zml-secondary-bg-color': '#7a622a', '--zml-input-bg-color': '#4a3b16', '--zml-border-color': '#8a723a', '--zml-text-color': '#fffde7', '--zml-text-color-secondary': '#fff9c4', '--zml-button-text': '#000000' } },
                        black: { name: '深邃黑', color: '#616161', vars: { '--zml-bg-color': '#282c34', '--zml-modal-bg-color': '#313642', '--zml-secondary-bg-color': '#3c4250', '--zml-input-bg-color': '#262a32', '--zml-border-color': '#4a5162', '--zml-text-color': '#e0e2e6', '--zml-text-color-secondary': '#a0a6b3', '--zml-button-text': '#ffffff' } },
                        pink: { name: '浪漫粉', color: '#ffb6c1', vars: { '--zml-bg-color': '#5d4954', '--zml-modal-bg-color': '#705c68', '--zml-secondary-bg-color': '#846e7a', '--zml-input-bg-color': '#53414c', '--zml-border-color': '#987b87', '--zml-text-color': '#fce4ec', '--zml-text-color-secondary': '#f8bbd0', '--zml-button-text': '#000000' } },
                    };
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
                        const themeKey = btn.dataset.theme;
                        modal.dataset.theme = themeKey;
                        localStorage.setItem("zml.tagImageLoader.theme", themeKey);
                        // 应用主题变量
                        const selectedTheme = THEMES[themeKey];
                        if (selectedTheme) {
                            for (const [key, value] of Object.entries(selectedTheme.vars)) {
                                modal.style.setProperty(key, value);
                            }
                        }
                        // 更新激活状态
                        Object.values(themeButtons).forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                    };
                        themeSwitcher.appendChild(btn);
                        themeButtons[theme.name] = btn;
                    });
                    modalHeader.appendChild(themeSwitcher);
                    
                    // [新增] 排序按钮和下拉菜单
                    const sortButton = $el("button.zml-action-btn", {
                        textContent: "排序",
                        style: {
                            position: "absolute",
                            top: "50%",
                            right: "130px", // 调整位置，为滚动按钮留出足够空间
                            transform: "translateY(-50%)",
                            padding: "6px 12px",
                            fontSize: "0.9em",
                            backgroundColor: "var(--zml-accent-color)",
                            color: "var(--zml-button-text)",
                            borderRadius: "4px",
                            border: "none",
                            cursor: "pointer",
                            transition: "background-color 0.2s ease",
                            zIndex: 10,
                        }
                    });

                    // [新增] 滚动到顶部按钮 - 1:1比例，尺寸为40x40像素
                    const scrollTopButton = $el("button.zml-action-btn", {
                        textContent: "↑",
                        style: {
                            position: "absolute",
                            top: "50%",
                            right: "80px", // 增加间距，避免与其他按钮重叠
                            transform: "translateY(-50%)",
                            width: "40px", // 1:1比例，尺寸为40像素
                            height: "40px", // 尺寸为40像素
                            padding: "0",
                            fontSize: "1.3em",
                            lineHeight: "40px",
                            textAlign: "center",
                            backgroundColor: "var(--zml-accent-color)",
                            color: "var(--zml-button-text)",
                            borderRadius: "4px",
                            border: "none",
                            cursor: "pointer",
                            transition: "background-color 0.2s ease",
                            zIndex: 10,
                        }
                    });

                    // [新增] 滚动到底部按钮 - 1:1比例，尺寸为40x40像素
                    const scrollBottomButton = $el("button.zml-action-btn", {
                        textContent: "↓",
                        style: {
                            position: "absolute",
                            top: "50%",
                            right: "30px", // 增加间距，避免与其他按钮重叠
                            transform: "translateY(-50%)",
                            width: "40px", // 1:1比例，尺寸为40像素
                            height: "40px", // 尺寸为40像素
                            padding: "0",
                            fontSize: "1.3em",
                            lineHeight: "40px",
                            textAlign: "center",
                            backgroundColor: "var(--zml-accent-color)",
                            color: "var(--zml-button-text)",
                            borderRadius: "4px",
                            border: "none",
                            cursor: "pointer",
                            transition: "background-color 0.2s ease",
                            zIndex: 10,
                        }
                    });
                    sortButton.onmouseover = () => { sortButton.style.backgroundColor = "var(--zml-accent-hover)"; };
                    sortButton.onmouseout = () => { sortButton.style.backgroundColor = "var(--zml-accent-color)"; };
                    
                    scrollTopButton.onmouseover = () => { scrollTopButton.style.backgroundColor = "var(--zml-accent-hover)"; };
                    scrollTopButton.onmouseout = () => { scrollTopButton.style.backgroundColor = "var(--zml-accent-color)"; };
                    
                    scrollBottomButton.onmouseover = () => { scrollBottomButton.style.backgroundColor = "var(--zml-accent-hover)"; };
                    scrollBottomButton.onmouseout = () => { scrollBottomButton.style.backgroundColor = "var(--zml-accent-color)"; };

                    const sortDropdown = $el("div.zml-sort-dropdown", {
                        style: {
                            display: "none",
                            position: "absolute",
                            top: "calc(100% + 5px)",
                            right: "15px",
                            backgroundColor: "var(--zml-main-bg)",
                            border: "1px solid var(--zml-border-color)",
                            borderRadius: "4px",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                            zIndex: 1002,
                            minWidth: "150px",
                        }
                    });

                    const createSortOption = (text, value) => {
                        const option = $el("button.zml-sort-option", {
                            textContent: text,
                            dataset: { sort: value },
                            style: {
                                display: "block",
                                width: "100%",
                                padding: "8px 12px",
                                border: "none",
                                background: "none",
                                textAlign: "left",
                                cursor: "pointer",
                                color: "var(--zml-main-text)",
                                fontSize: "0.9em",
                                transition: "background-color 0.2s ease",
                            }
                        });
                        option.onmouseover = () => { option.style.backgroundColor = "var(--zml-header-bg)"; };
                        option.onmouseout = () => { option.style.backgroundColor = "transparent"; };
                        return option;
                    };

                    const sortOptions = [
                        createSortOption("名称 - 升序", "name-asc"),
                        createSortOption("名称 - 降序", "name-desc"),
                    ];
                    sortOptions.forEach(option => sortDropdown.appendChild(option));
                    
                    sortButton.onclick = (e) => {
                        e.stopPropagation();
                        sortDropdown.style.display = sortDropdown.style.display === "block" ? "none" : "block";
                    };

                    document.addEventListener("click", (e) => {
                        if (!sortButton.contains(e.target) && !sortDropdown.contains(e.target)) {
                            sortDropdown.style.display = "none";
                        }
                    });

                    modalHeader.append(countEl, sortButton, scrollTopButton, scrollBottomButton, sortDropdown);

                    // 应用保存的主题
                    const savedTheme = localStorage.getItem("zml.tagImageLoader.theme") || 'blue';
                    modal.dataset.theme = savedTheme;
                    // 应用主题变量
                    const theme = THEMES[savedTheme];
                    if (theme) {
                        for (const [key, value] of Object.entries(theme.vars)) {
                            modal.style.setProperty(key, value);
                        }
                    }
                    if(themeButtons[savedTheme]) {
                        themeButtons[savedTheme].classList.add('active');
                    }


                    document.body.appendChild(backdrop);
                    document.body.appendChild(modal);

                    let fileTree = {}, currentPath = [], selectedFiles = [], historyStack = [];
                    
                    let currentDisplayMode = localStorage.getItem("zml.tagImageLoader.displayMode") || DISPLAY_MODES.TEXT_ONLY;
                    displayModeSelector.value = currentDisplayMode;
                    
                    pathInput.value = localStorage.getItem("zml.tagImageLoader.lastPath") || "";

                    // --- 🔴 MODIFICATION START: “记住位置”功能逻辑 ---
                    const LS_REMEMBER_ENABLED_KEY = "zml.tagImageLoader.rememberPathEnabled";
                    const LS_LAST_FOLDER_PATH_KEY = "zml.tagImageLoader.lastFolderPath";
                    const LS_SORT_ORDER_KEY = "zml.tagImageLoader.sortOrder"; // 新增：排序方式的localStorage键

                    let rememberPathEnabled = localStorage.getItem(LS_REMEMBER_ENABLED_KEY) !== 'false';
                    rememberPathBtn.classList.toggle('active', rememberPathEnabled);

                    rememberPathBtn.onclick = () => {
                        rememberPathEnabled = !rememberPathEnabled;
                        rememberPathBtn.classList.toggle('active', rememberPathEnabled);
                        localStorage.setItem(LS_REMEMBER_ENABLED_KEY, rememberPathEnabled);
                        // 如果关闭该功能，则清除已保存的路径
                        if (!rememberPathEnabled) {
                            localStorage.removeItem(LS_LAST_FOLDER_PATH_KEY);
                        }
                    };
                    // --- 🔴 MODIFICATION END ---

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

                    // 添加预览已选图像功能
                    countEl.onclick = (e) => {
                        e.stopPropagation();
                        if (selectedFiles.length === 0) {
                            alert("没有已选择的图像");
                            return;
                        }

                        // 创建预览模态框
                        const previewBackdrop = $el("div.zml-backdrop", { style: { zIndex: 2000 } });
                        const previewModal = $el("div.zml-tag-modal.zml-preview-modal", {
                            style: {
                                zIndex: 2001,
                                width: "50%", // 调整为UI的一半大小
                                maxWidth: "50vw",
                                maxHeight: "60vh", // 相应减小最大高度
                                minHeight: "auto",
                                height: "auto",
                                display: "flex",
                                flexDirection: "column",
                                left: "25%", // 调整左侧位置以保持居中
                                top: "20%" // 略微提高垂直位置
                            },
                            dataset: { theme: savedTheme }
                        });

                        const previewHeader = $el("div.zml-tag-modal-header", { textContent: `已选图像预览 (${selectedFiles.length}个)` });
                        const previewContent = $el("div.zml-tag-modal-content", {
                            style: {
                                display: "grid",
                                // 使用响应式尺寸，最小120px，最大180px，适应更小的容器
                                gridTemplateColumns: "repeat(auto-fill, minmax(min(120px, 100%), 180px))",
                                gap: "10px", // 减小间距以适应更小的容器
                                overflowY: "auto",
                                padding: "15px",
                                minHeight: "200px",
                                maxHeight: "calc(60vh - 120px)", // 根据模态框最大高度调整
                                justifyContent: "start",
                                alignContent: "start",
                                width: "100%", // 确保内容区占满宽度
                                boxSizing: "border-box"
                            }
                        });
                        const previewFooter = $el("div.zml-tag-modal-footer", { 
                            style: { 
                                justifyContent: 'center',
                                padding: "10px 0",
                                marginTop: "auto", // 确保底部区域在内容下方
                                boxSizing: "border-box"
                            } 
                        });
                        const closeBtn = $el("button.zml-confirm-btn-main", { textContent: "关闭" });

                        previewFooter.appendChild(closeBtn);
                        previewModal.append(previewHeader, previewContent, previewFooter);

                        // 填充预览内容
                        selectedFiles.forEach((file, index) => {
                            const previewItem = $el("div.zml-preview-item", {
                                style: {
                                    border: "1px solid var(--zml-border-color)",
                                    borderRadius: "4px",
                                    padding: "5px",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease",
                                    backgroundColor: "var(--zml-secondary-bg-color)",
                                    // 使用响应式高度，确保宽高比一致
                                    aspectRatio: "1/1",
                                    boxSizing: "border-box",
                                    display: "flex",
                                    flexDirection: "column",
                                    flexShrink: 0,
                                    width: "100%" // 确保预览项占满单元格宽度
                                }
                            });

                            previewItem.onmouseover = () => {
                                previewItem.style.transform = "translateY(-2px)";
                                previewItem.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.15)";
                            };

                            previewItem.onmouseout = () => {
                                previewItem.style.transform = "translateY(0)";
                                previewItem.style.boxShadow = "none";
                            };

                            // 创建基本查询参数
                            const baseQueryParams = new URLSearchParams();
                            baseQueryParams.append("filename", file.filename);
                            baseQueryParams.append("subfolder", file.subfolder || pathInput.value);
                            if (pathInput.value.trim()) {
                                baseQueryParams.append("custom_path", pathInput.value.trim());
                            }
                            baseQueryParams.append("t", Date.now());

                            // 图像容器（适用于所有预览模式）
                            const imageContainer = $el("div", {
                                style: {
                                    width: "100%",
                                    height: "150px",
                                    overflow: "hidden",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginBottom: "8px",
                                    position: "relative"
                                }
                            });

                            // 图像参数
                            const imageParams = new URLSearchParams(baseQueryParams);
                            imageParams.append('width', '300');
                            imageParams.append('height', '300');

                            // 图像
                            const previewImg = $el("img", {
                                loading: "lazy",
                                src: `${ZML_API_PREFIX}/view_image?${imageParams.toString()}`,
                                style: {
                                    maxWidth: "100%",
                                    maxHeight: "100%",
                                    objectFit: "contain"
                                }
                            });

                            // 创建放大镜图标（移动到编辑按钮下方）
                            const zoomIcon = $el("div", {
                                style: {
                                    position: "absolute",
                                    top: "35px", // 修改为在编辑按钮下方
                                    left: "5px", // 与编辑按钮左对齐
                                    width: "24px",
                                    height: "24px",
                                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                                    color: "white",
                                    borderRadius: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    zIndex: 10,
                                    opacity: 0,
                                    transition: "opacity 0.2s ease"
                                },
                                textContent: "🔍"
                            });

                            // 添加悬停效果 - 统一控制三个图标的显示/隐藏
                            imageContainer.onmouseenter = () => {
                                editIcon.style.opacity = "1";
                                zoomIcon.style.opacity = "1";
                                cancelIcon.style.opacity = "1";
                            };
                            
                            imageContainer.onmouseleave = () => {
                                editIcon.style.opacity = "0";
                                zoomIcon.style.opacity = "0";
                                cancelIcon.style.opacity = "0";
                            };

                            // 添加点击放大镜查看大图的功能
                            zoomIcon.onclick = (e) => {
                                e.stopPropagation(); // 阻止事件冒泡，避免触发预览项的点击事件

                                // 创建查看大图的模态框
                                const zoomBackdrop = $el("div.zml-backdrop", { style: { zIndex: 2010 } });
                                const zoomModal = $el("div.zml-tag-modal.zml-zoom-modal", {
                                    style: {
                                        zIndex: 2011,
                                        width: "90%",
                                        maxWidth: "90vw",
                                        maxHeight: "90vh",
                                        minHeight: "auto",
                                        height: "auto",
                                        display: "flex",
                                        flexDirection: "column",
                                        left: "5%",
                                        top: "5%"
                                    },
                                    dataset: { theme: savedTheme }
                                });

                                const zoomHeader = $el("div.zml-tag-modal-header", { textContent: file.filename });
                                const zoomContent = $el("div.zml-tag-modal-content", {
                                    style: {
                                        overflow: "auto",
                                        padding: "15px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flex: 1
                                    }
                                });
                                const zoomFooter = $el("div.zml-tag-modal-footer", { style: { justifyContent: 'center' } });
                                const closeZoomBtn = $el("button.zml-confirm-btn-main", { textContent: "关闭" });

                                // 原图参数
                                const fullSizeParams = new URLSearchParams(baseQueryParams);
                                // 不设置宽度和高度，获取原始大小

                                // 原始大小图像
                                const fullSizeImg = $el("img", {
                                    loading: "lazy",
                                    src: `${ZML_API_PREFIX}/view_image?${fullSizeParams.toString()}`,
                                    style: {
                                        maxWidth: "100%",
                                        maxHeight: "calc(90vh - 100px)",
                                        objectFit: "contain"
                                    }
                                });

                                zoomContent.appendChild(fullSizeImg);
                                zoomFooter.appendChild(closeZoomBtn);
                                zoomModal.append(zoomHeader, zoomContent, zoomFooter);
                                zoomBackdrop.appendChild(zoomModal);
                                document.body.appendChild(zoomBackdrop);

                                // 关闭大图模态框
                                closeZoomBtn.onclick = () => {
                                    zoomModal.remove();
                                    zoomBackdrop.remove();
                                };

                                // 点击背景关闭
                                zoomBackdrop.onclick = (e) => {
                                    if (e.target === zoomBackdrop) {
                                        zoomModal.remove();
                                        zoomBackdrop.remove();
                                    }
                                };
                            };

                            // 高亮显示文件名
                            const filename = $el("div", {
                                textContent: file.filename,
                                style: {
                                    fontSize: "14px",
                                    fontWeight: "bold",
                                    color: "var(--zml-primary-color)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    textAlign: "center",
                                    padding: "5px 8px",
                                    backgroundColor: "rgba(0, 0, 0, 0.05)",
                                    borderRadius: "4px"
                                }
                            });

                            // 创建编辑文本块按钮
                            const editIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
                            const editIcon = $el("div.zml-edit-icon", {
                                innerHTML: editIconSVG,
                                style: {
                                    position: "absolute",
                                    top: "5px",
                                    left: "5px",
                                    width: "24px",
                                    height: "24px",
                                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                                    color: "white",
                                    borderRadius: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    opacity: "0",
                                    transition: "opacity 0.2s ease",
                                    zIndex: "10"
                                },
                                title: "编辑文本块"
                            });

                            // 创建取消选择按钮（右上角）
                            const cancelIcon = $el("div.zml-cancel-icon", {
                                style: {
                                    position: "absolute",
                                    top: "5px",
                                    right: "5px",
                                    width: "24px",
                                    height: "24px",
                                    backgroundColor: "rgba(244, 67, 54, 0.7)", // 红色背景
                                    color: "white",
                                    borderRadius: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    opacity: 0,
                                    transition: "opacity 0.2s ease",
                                    zIndex: 10
                                },
                                textContent: "✕",
                                title: "取消选择图像"
                            });

                            // 添加取消选择按钮点击事件
                            cancelIcon.onclick = (e) => {
                                e.stopPropagation();
                                pushHistory();
                                // 从selectedFiles中移除当前文件
                                const index = selectedFiles.findIndex(f => f.filename === file.filename && f.subfolder === file.subfolder);
                                if (index > -1) {
                                    selectedFiles.splice(index, 1);
                                    // 从预览中移除该项目
                                    previewItem.remove();
                                    // 更新标题计数
                                    previewHeader.textContent = `已选图像预览 (${selectedFiles.length}个)`;
                                    // 如果没有文件了，关闭预览
                                    if (selectedFiles.length === 0) {
                                        closePreviewModal();
                                    }
                                    // 更新主UI状态
                                    updateUiState();
                                }
                            };

                            // 添加编辑按钮点击事件
                            editIcon.onclick = async (event) => {
                                event.stopPropagation();
                                const originalContent = editIcon.innerHTML;
                                editIcon.innerHTML = '...';
                                try {
                                    // 直接使用已有的baseQueryParams变量
                                    const textQueryParams = new URLSearchParams(baseQueryParams);

                                    // 获取当前文本内容
                                    const getTextUrl = `${ZML_API_PREFIX}/get_single_text_block?${textQueryParams.toString()}`;
                                    const res = await api.fetchApi(getTextUrl);
                                    if (!res.ok) throw new Error("获取文本块失败: " + await res.text());
                                    const data = await res.json();
                                      
                                    // 创建编辑模态框
                                    const newText = await createEditModal(data.text_content || "");

                                    // 保存新文本
                                    // 从baseQueryParams中获取需要的参数
                                    const writeData = {
                                        filename: file.filename,
                                        subfolder: file.subfolder || pathInput.value,
                                        text_content: newText
                                    };
                                    // 如果有custom_path参数，也添加到writeData中
                                    if (pathInput.value.trim()) {
                                        writeData.custom_path = pathInput.value.trim();
                                    }
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
                                    editIcon.innerHTML = originalContent;
                                }
                            };

                            imageContainer.appendChild(previewImg);
                            imageContainer.appendChild(editIcon);
                            imageContainer.appendChild(zoomIcon);
                            imageContainer.appendChild(cancelIcon);
                            previewItem.append(imageContainer, filename);
                            
                            previewContent.appendChild(previewItem);

                            // 点击缩略图跳转到对应位置
                            previewItem.onclick = () => {
                                // 关闭预览模态框
                                previewModal.remove();
                                previewBackdrop.remove();

                                // 查找并滚动到对应的图像
                                const contentEl = modal.querySelector(".zml-tag-modal-content");
                                const fileButtons = contentEl.querySelectorAll(".zml-file-button");
                                
                                for (const btn of fileButtons) {
                                    // 确保使用相同的属性进行比较
                                    if (btn.dataset.filename === file.filename) {
                                        // 滚动到元素
                                        btn.scrollIntoView({ behavior: "smooth", block: "center" });
                                        
                                        // 高亮显示
                                        const originalBg = btn.style.backgroundColor;
                                        btn.style.backgroundColor = "var(--zml-highlight-color, #e6f7ff)";
                                        
                                        // 2秒后恢复原来的背景色
                                        setTimeout(() => {
                                            btn.style.backgroundColor = originalBg;
                                        }, 2000);
                                        
                                        break;
                                    }
                                }
                            };
                        });

                        // 关闭预览模态框
                        const closePreviewModal = () => {
                            previewModal.remove();
                            previewBackdrop.remove();
                            // 添加自动刷新功能，确保图像选择状态正确显示
                            renderCurrentLevel();
                        };

                        closeBtn.onclick = closePreviewModal;
                        previewBackdrop.onclick = closePreviewModal;

                        document.body.appendChild(previewBackdrop);
                        document.body.appendChild(previewModal);
                    };                    
                    
                    // 随机选择当前目录的图像
                    randomBtn.onclick = () => {
                        // 计算当前目录
                        let currentLevel = fileTree;
                        const tempCurrentPath = [...currentPath];
                        
                        for (const part of tempCurrentPath) {
                            if (currentLevel && currentLevel[part]) {
                                currentLevel = currentLevel[part];
                            } else {
                                break;
                            }
                        }
                        
                        if (currentLevel && currentLevel.files && currentLevel.files.length > 0) {
                            pushHistory();
                            // 清空已选文件
                            selectedFiles.length = 0;
                            // 根据选择的个数随机选择文件
                            const count = parseInt(randomCountSelect.value);
                            
                            if (count > 0) {
                                // 如果选择的个数大于文件总数，则选择所有文件
                                const filesToSelect = Math.min(count, currentLevel.files.length);
                                
                                // 随机打乱文件数组
                                const shuffledFiles = [...currentLevel.files].sort(() => Math.random() - 0.5);
                                
                                // 选择前count个文件
                                for (let i = 0; i < filesToSelect; i++) {
                                    selectedFiles.push(shuffledFiles[i]);
                                }
                            }
                            renderCurrentLevel();
                            updateUiState();
                        } else {
                            alert("当前目录中没有可选择的图像文件");
                        }
                    };
                    updateUiState();

                    const closeModal = () => {
                        // --- 🔴 MODIFICATION START: 关闭时保存位置 ---
                        if (rememberPathEnabled) {
                            localStorage.setItem(LS_LAST_FOLDER_PATH_KEY, JSON.stringify(currentPath));
                        }
                        // --- 🔴 MODIFICATION END ---
                        hideImage(); 
                        backdrop.remove(); 
                        modal.remove(); 
                    };
                    backdrop.onclick = closeModal;
                    confirmBtn.onclick = async () => { 
                        const dataToSave = {
                            files: selectedFiles,
                            _base_path: pathInput.value
                        };
                        if (selectedFilesJsonWidget) selectedFilesJsonWidget.value = JSON.stringify(dataToSave); 
                        localStorage.setItem("zml.tagImageLoader.lastPath", pathInput.value);
                        
                        // 尝试从选中的图像中提取文本块信息并填充到输入框
                        if (selectedFiles.length > 0) {
                            try {
                                const textBlocksWidget = this.widgets.find(w => w.name === "text_blocks_input");
                                if (textBlocksWidget) {
                                    // 创建文本块内容数组
                                    const allTextBlocks = [];
                                    
                                    // 遍历选中的文件，获取每个文件的文本块内容
                                    for (const file of selectedFiles) {
                                        const baseQueryParams = new URLSearchParams();
                                        baseQueryParams.append("filename", file.filename);
                                        // 修复：确保使用正确的子文件夹路径，优先使用file.subfolder，如果不存在则使用空字符串
                                        baseQueryParams.append("subfolder", file.subfolder || "");
                                        // 统一使用 custom_path，后端仅识别该参数；当 file.custom_path 缺失时回退到输入框路径
                                        const effectiveCustomPath = (file.custom_path && String(file.custom_path).trim()) || String(pathInput.value || "").trim();
                                        if (effectiveCustomPath) {
                                            baseQueryParams.append("custom_path", effectiveCustomPath);
                                        }
                                        
                                        const getTextUrl = `${ZML_API_PREFIX}/get_single_text_block?${baseQueryParams.toString()}`;
                                        try {
                                            // 使用原生fetch API，与111.js保持一致
                                            const response = await fetch(getTextUrl);
                                            
                                            if (response.ok) {
                                                const data = await response.json();
                                                if (data.text_content && data.text_content.trim()) {
                                                    allTextBlocks.push(data.text_content.trim());
                                                }
                                            } else {
                                                console.warn(`获取文件 ${file.filename} 的文本块失败: HTTP ${response.status}`);
                                            }
                                        } catch (error) {
                                            console.error(`获取文件 ${file.filename} 的文本块失败:`, error);
                                        }
                                    }
                                    
                                    // 如果有获取到文本块内容，则填充到输入框
                                    if (allTextBlocks.length > 0) {
                                        const textContent = allTextBlocks.join("\n\n");
                                        textBlocksWidget.value = textContent;
                                        
                                        // 确保DOM元素也被更新
                                        if (textBlocksWidget.inputEl) {
                                            textBlocksWidget.inputEl.value = textContent;
                                            // 触发input事件，确保UI完全更新
                                            const event = new Event('input', { bubbles: true });
                                            textBlocksWidget.inputEl.dispatchEvent(event);
                                        }
                                        
                                        // 通知widget值变化
                                        if (this.onWidgetValueChanged) {
                                            this.onWidgetValueChanged(textBlocksWidget, textContent);
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error("获取文本块信息失败:", error);
                            }
                        }
                        
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

                    let currentSortOrder = localStorage.getItem(LS_SORT_ORDER_KEY) || "name-asc"; // 默认按名称升序
                    // 激活当前排序选项的样式
                    sortOptions.forEach(option => {
                        if (option.dataset.sort === currentSortOrder) {
                            option.style.fontWeight = "bold";
                            option.style.backgroundColor = "var(--zml-header-bg)";
                        } else {
                            option.style.fontWeight = "normal";
                            option.style.backgroundColor = "transparent";
                        }
                        option.onclick = (e) => {
                            e.stopPropagation();
                            currentSortOrder = option.dataset.sort;
                            localStorage.setItem(LS_SORT_ORDER_KEY, currentSortOrder);
                            sortDropdown.style.display = "none";
                            renderCurrentLevel(); // 重新渲染以应用排序
                            // 更新激活状态
                            sortOptions.forEach(opt => {
                                if (opt.dataset.sort === currentSortOrder) {
                                    opt.style.fontWeight = "bold";
                                    opt.style.backgroundColor = "var(--zml-header-bg)";
                                } else {
                                    opt.style.fontWeight = "normal";
                                    opt.style.backgroundColor = "transparent";
                                }
                            });
                        };
                    });

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

                            // --- 🔴 MODIFICATION START: 加载并验证已保存的位置 ---
                            if (rememberPathEnabled) {
                                const savedPathJSON = localStorage.getItem(LS_LAST_FOLDER_PATH_KEY);
                                if (savedPathJSON) {
                                    try {
                                        const savedPath = JSON.parse(savedPathJSON);
                                        if (Array.isArray(savedPath)) {
                                            // 验证路径是否在当前文件树中有效
                                            let tempLevel = fileTree;
                                            let isPathValid = true;
                                            for (const part of savedPath) {
                                                if (tempLevel[part] && typeof tempLevel[part] === 'object') {
                                                    tempLevel = tempLevel[part];
                                                } else {
                                                    isPathValid = false;
                                                    break;
                                                }
                                            }
                                            // 如果路径有效，则应用它
                                            if (isPathValid) {
                                                currentPath = savedPath;
                                                // 同时更新pathInput，确保_base_path会被正确保存
                                                // 注意：我们不需要直接设置pathInput.value，因为_base_path已经从selected_files_json中加载
                                            } else {
                                                // 如果路径无效 (例如，文件夹被删除或移动)，则清除保存的记录
                                                localStorage.removeItem(LS_LAST_FOLDER_PATH_KEY);
                                            }
                                        }
                                    } catch (e) {
                                        console.error("解析已保存的文件夹路径失败:", e);
                                        localStorage.removeItem(LS_LAST_FOLDER_PATH_KEY); // 解析失败则清除
                                    }
                                }
                            }
                            // --- 🔴 MODIFICATION END ---
                            
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

                    // 设置滚动按钮的点击事件处理函数
                    scrollTopButton.onclick = () => {
                        const contentEl = modal.querySelector(".zml-tag-modal-content");
                        if (contentEl) {
                            contentEl.scrollTop = 0;
                        }
                    };

                    scrollBottomButton.onclick = () => {
                        const contentEl = modal.querySelector(".zml-tag-modal-content");
                        if (contentEl) {
                            contentEl.scrollTop = contentEl.scrollHeight;
                        }
                    };

                    const renderCurrentLevel = () => {
                        contentEl.innerHTML = ""; // 清空内容区域，只保留图片
                        const folderContainer = $el("div.zml-folder-container", { style: { position: 'relative' } });
                        const imageContainer = $el("div.zml-image-container");
                        
                        // 将 folderContainer 添加到 fixedHeader，而不是 contentEl
                        const fixedHeader = modal.querySelector(".zml-modal-fixed-header");
                        // 清空 fixedHeader 中除了 pathInputGroup 和 breadcrumbsEl 之外的内容
                        // 确保只移除旧的 folderContainer，而不是整个 fixedHeader 的内容
                        const existingFolderContainer = fixedHeader.querySelector(".zml-folder-container");
                        if (existingFolderContainer) {
                            existingFolderContainer.remove();
                        }
                        fixedHeader.appendChild(folderContainer);
                        contentEl.appendChild(imageContainer); // 图片容器仍在内容区域
                        let currentLevel = fileTree;
                        
                        // 初始化固定位置模式变量
                        let fixedLocationMode = localStorage.getItem("zml.imageSelector.fixedLocationMode") === 'true';
                        
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
                                tagBtn.onclick = () => {
                                    // 固定位置模式和正常模式行为一致，只是保持当前文件夹位置不变
                                    // 在固定位置模式下，我们不修改currentPath，只显示子文件夹内容
                                    if (fixedLocationMode) {
                                        // 保持当前目录显示不变
                                          
                                        // 获取并显示该子文件夹的内容
                                        let previewLevel = currentLevel[key];
                                        contentEl.innerHTML = "";
                                        const previewImageContainer = $el("div.zml-image-container");
                                        contentEl.appendChild(previewImageContainer);
                                          
                                        // 递归收集子文件夹中的所有文件
                                        const collectFiles = (folder, currentSubfolder = '') => {
                                            let files = [];
                                            if (folder.files) {
                                                files = files.concat(folder.files.map(file => ({
                                                    ...file,
                                                    fullSubfolder: currentSubfolder
                                                })));
                                            }
                                            Object.keys(folder).forEach(subKey => {
                                                if (typeof folder[subKey] === 'object' && !Array.isArray(folder[subKey]) && subKey !== 'files') {
                                                    files = files.concat(collectFiles(folder[subKey], currentSubfolder ? `${currentSubfolder}/${subKey}` : subKey));
                                                }
                                            });
                                            return files;
                                        };
                                         
                                        // 获取当前子文件夹及其所有子文件夹中的文件
                                        const allFiles = collectFiles(previewLevel);
                                         
                                        if (allFiles.length > 0) {
                                            // 排序文件
                                            allFiles.sort((a, b) => {
                                                const nameA = a.filename.toLowerCase();
                                                const nameB = b.filename.toLowerCase();
                                                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                                                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;

                                                switch (currentSortOrder) {
                                                    case "name-asc":
                                                        return nameA.localeCompare(nameB, undefined, { numeric: true });
                                                    case "name-desc":
                                                        return nameB.localeCompare(nameA, undefined, { numeric: true });
                                                    case "date-asc":
                                                        return dateA - dateB;
                                                    case "date-desc":
                                                        return dateB - dateA;
                                                    default:
                                                        return nameA.localeCompare(nameB, undefined, { numeric: true });
                                                }
                                            });
                                               
                                            // 显示文件
                                            for (const fileInfo of allFiles) {
                                                const [displayName] = fileInfo.filename.split('.');
                                                const imgInnerChildren = [$el("span", { textContent: displayName })];
                                                // 设置data-filename属性，并同时添加zml-file-button类以便查找
                                                const imgBtn = $el("button.zml-img-btn.zml-file-button", imgInnerChildren, {
                                                    dataset: { filename: fileInfo.filename }
                                                });
                                                const customPath = pathInput.value.trim();

                                                // 构建正确的子文件夹路径
                                                const subfolderPath = fileInfo.fullSubfolder ? `${key}/${fileInfo.fullSubfolder}` : key;
                                                const baseQueryParams = new URLSearchParams({
                                                    filename: fileInfo.filename,
                                                    subfolder: subfolderPath
                                                });
                                                if (customPath) baseQueryParams.append("custom_path", customPath);

                                                // 切换模式前先移除medium-icon-mode类
                                                previewImageContainer.classList.remove('medium-icon-mode');
                                                 
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
                                                                    subfolder: fileInfo.fullSubfolder ? `${key}/${fileInfo.fullSubfolder}` : key,
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
                                                          
                                                    case DISPLAY_MODES.MEDIUM_ICON_ONLY:
                                                        // 清空现有子元素，不显示名称
                                                        imgBtn.innerHTML = '';
                                                        // 为图像容器添加medium-icon-mode类
                                                        previewImageContainer.classList.add('medium-icon-mode');
                                                        imgBtn.classList.add('medium-icon-mode');
                                                         
                                                        const mediumParams = new URLSearchParams(baseQueryParams);
                                                        // 使用view_image端点但调整尺寸参数
                                                        mediumParams.append('width', '300');
                                                        mediumParams.append('height', '300');
                                                        const mediumImg = $el("img", {
                                                            loading: "lazy",
                                                            src: `${ZML_API_PREFIX}/view_image?${mediumParams.toString()}`,
                                                            style: { width: '100%', maxHeight: '200px', objectFit: 'contain' }
                                                        });
                                                        imgBtn.appendChild(mediumImg);
                                                         
                                                        // 添加编辑按钮
                                                        const mediumEditBtn = $el("button.zml-edit-btn", { innerHTML: pencilIconSVG, title: "编辑文本块" });
                                                        mediumEditBtn.onclick = async (event) => {
                                                            event.stopPropagation();
                                                            const originalContent = mediumEditBtn.innerHTML;
                                                            mediumEditBtn.innerHTML = '...';
                                                            try {
                                                                const getTextUrl = `${ZML_API_PREFIX}/get_single_text_block?${baseQueryParams.toString()}`;
                                                                const res = await api.fetchApi(getTextUrl);
                                                                if (!res.ok) throw new Error("获取文本块失败: " + await res.text());
                                                                const data = await res.json();
                                                                 
                                                                const newText = await createEditModal(data.text_content || "");

                                                                const writeData = {
                                                                    custom_path: customPath,
                                                                    ...fileInfo,
                                                                    subfolder: fileInfo.fullSubfolder ? `${key}/${fileInfo.fullSubfolder}` : key,
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
                                                                mediumEditBtn.innerHTML = originalContent;
                                                            }
                                                        };
                                                        imgBtn.appendChild(mediumEditBtn);
                                                         
                                                        // 添加查看大图按钮
                                                        const mediumViewImageBtn = $el("button.zml-view-image-btn", { innerHTML: viewIconSVG, title: "查看大图" });
                                                        mediumViewImageBtn.onclick = (event) => {
                                                            event.stopPropagation();
                                                            // 创建原始大小的图像URL，不设置宽度和高度限制
                                                            const fullImageParams = new URLSearchParams(baseQueryParams);
                                                            const fullImageUrl = `${ZML_API_PREFIX}/view_image?${fullImageParams.toString()}`;
                                                            createImageViewerModal(fullImageUrl);
                                                        };
                                                        imgBtn.appendChild(mediumViewImageBtn);
                                                        break;
                                                         
                                                    case DISPLAY_MODES.TEXT_ONLY:
                                                    default:
                                                        break;
                                                }

                                                // 在固定位置模式下使用正确的子文件夹路径构建
                                                // 注意：在这个作用域中，key是循环变量，有效
                                                const correctSubfolderPath = fileInfo.fullSubfolder ? `${key}/${fileInfo.fullSubfolder}` : key;
                                                
                                                if (selectedFiles.some(f => f.filename === fileInfo.filename && f.subfolder === correctSubfolderPath)) {
                                                    imgBtn.classList.add("selected");
                                                }

                                                imgBtn.onclick = () => {
                                                    pushHistory();
                                                    // 确保使用与添加时相同的子文件夹路径进行查找
                                                    const findIndex = selectedFiles.findIndex(f => f.filename === fileInfo.filename && f.subfolder === correctSubfolderPath);
                                                    if (findIndex > -1) {
                                                        selectedFiles.splice(findIndex, 1);
                                                        imgBtn.classList.remove("selected");
                                                    } else {
                                                        // 创建fileInfo的副本并添加到selectedFiles，避免对象引用问题
                                                        // 使用正确的子文件夹路径
                                                        const fileCopy = {...fileInfo};
                                                        fileCopy.subfolder = correctSubfolderPath;
                                                        // 修复：确保添加custom_path信息
                                                        fileCopy.custom_path = customPath;
                                                        selectedFiles.push(fileCopy);
                                                        imgBtn.classList.add("selected");
                                                    }
                                                    updateUiState();
                                                };
                                                previewImageContainer.appendChild(imgBtn);
                                            }
                                        }
                                    } else {
                                        // 正常模式，进入子文件夹
                                        currentPath.push(key);
                                        renderCurrentLevel();
                                    }
                                };
                                folderContainer.appendChild(tagBtn);
                            }
                        });
                         
                        // 添加固定位置按钮到folderContainer最右边
                        const fixedLocationBtn = $el("button.zml-tag-btn", {
                            textContent: fixedLocationMode ? "固定已开启" : "固定位置",
                            style: {
                                backgroundColor: fixedLocationMode ? '#4CAF50' : '#a9a9a9',
                                borderColor: fixedLocationMode ? '#4CAF50' : '#888',
                                position: 'absolute',
                                right: '10px'
                            }
                        });
                         
                        fixedLocationBtn.onclick = () => {
                            fixedLocationMode = !fixedLocationMode;
                            localStorage.setItem("zml.imageSelector.fixedLocationMode", fixedLocationMode);
                            fixedLocationBtn.textContent = fixedLocationMode ? "固定已开启" : "固定位置";
                            fixedLocationBtn.style.backgroundColor = fixedLocationMode ? '#4CAF50' : '#a9a9a9';
                            fixedLocationBtn.style.borderColor = fixedLocationMode ? '#4CAF50' : '#888';
                             
                            // 如果关闭固定模式，恢复显示当前路径的内容
                            if (!fixedLocationMode) {
                                renderCurrentLevel();
                            }
                        };
                         
                        folderContainer.appendChild(fixedLocationBtn);
                        
                        if (currentLevel.files) {
                            // 根据 currentSortOrder 对文件进行排序
                            currentLevel.files.sort((a, b) => {
                                const nameA = a.filename.toLowerCase();
                                const nameB = b.filename.toLowerCase();
                                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;

                                switch (currentSortOrder) {
                                    case "name-asc":
                                        return nameA.localeCompare(nameB, undefined, { numeric: true });
                                    case "name-desc":
                                        return nameB.localeCompare(nameA, undefined, { numeric: true });
                                    case "date-asc":
                                        return dateA - dateB;
                                    case "date-desc":
                                        return dateB - dateA;
                                    default:
                                        return nameA.localeCompare(nameB, undefined, { numeric: true });
                                }
                            });
                            for (const fileInfo of currentLevel.files) {
                                const [displayName] = fileInfo.filename.split('.');
                                const imgInnerChildren = [$el("span", { textContent: displayName })];
                                // 设置data-filename属性，并同时添加zml-file-button类以便查找
                                const imgBtn = $el("button.zml-img-btn.zml-file-button", imgInnerChildren, {
                                    dataset: { filename: fileInfo.filename }
                                });
                                const customPath = pathInput.value.trim();

                                const baseQueryParams = new URLSearchParams({
                                    filename: fileInfo.filename,
                                    subfolder: fileInfo.subfolder,
                                });
                                if (customPath) baseQueryParams.append("custom_path", customPath);

                                // 切换模式前先移除medium-icon-mode类
                                imageContainer.classList.remove('medium-icon-mode');
                                
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
                                         
                                    case DISPLAY_MODES.MEDIUM_ICON_ONLY:
                                        // 清空现有子元素，不显示名称
                                        imgBtn.innerHTML = '';
                                        // 为图像容器添加medium-icon-mode类
                                        imageContainer.classList.add('medium-icon-mode');
                                        imgBtn.classList.add('medium-icon-mode');
                                        
                                        const mediumParams = new URLSearchParams(baseQueryParams);
                                        // 使用view_image端点但调整尺寸参数
                                        mediumParams.append('width', '300');
                                        mediumParams.append('height', '300');
                                        const mediumImg = $el("img", {
                                            loading: "lazy",
                                            src: `${ZML_API_PREFIX}/view_image?${mediumParams.toString()}`,
                                            style: { width: '100%', maxHeight: '200px', objectFit: 'contain' }
                                        });
                                        imgBtn.appendChild(mediumImg);
                                        
                                        // 添加编辑按钮
                                        const mediumEditBtn = $el("button.zml-edit-btn", { innerHTML: pencilIconSVG, title: "编辑文本块" });
                                        mediumEditBtn.onclick = async (event) => {
                                            event.stopPropagation();
                                            const originalContent = mediumEditBtn.innerHTML;
                                            mediumEditBtn.innerHTML = '...';
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
                                                mediumEditBtn.innerHTML = originalContent;
                                            }
                                        };
                                        imgBtn.appendChild(mediumEditBtn);
                                        
                                        // 添加查看大图按钮
                                        const mediumViewImageBtn = $el("button.zml-view-image-btn", { innerHTML: viewIconSVG, title: "查看大图" });
                                        mediumViewImageBtn.onclick = (event) => {
                                            event.stopPropagation();
                                            // 创建原始大小的图像URL，不设置宽度和高度限制
                                            const fullImageParams = new URLSearchParams(baseQueryParams);
                                            const fullImageUrl = `${ZML_API_PREFIX}/view_image?${fullImageParams.toString()}`;
                                            createImageViewerModal(fullImageUrl);
                                        };
                                        imgBtn.appendChild(mediumViewImageBtn);
                                        break;
                                    
                                    case DISPLAY_MODES.TEXT_ONLY:
                                    default:
                                        break;
                                }

                                // 使用fileInfo中的子文件夹路径信息
                                const subfolderPath = fileInfo.subfolder || fileInfo.fullSubfolder || '';

                                if (selectedFiles.some(f => f.filename === fileInfo.filename && f.subfolder === subfolderPath)) {
                                    imgBtn.classList.add("selected");
                                }

                                imgBtn.onclick = () => {
                                    pushHistory();
                                    const findIndex = selectedFiles.findIndex(f => f.filename === fileInfo.filename && f.subfolder === subfolderPath);
                                    if (findIndex > -1) {
                                        selectedFiles.splice(findIndex, 1);
                                        imgBtn.classList.remove("selected");
                                    } else {
                                        // 创建fileInfo的副本并添加到selectedFiles，避免对象引用问题
                                        // 确保使用正确的子文件夹路径
                                        const fileCopy = {...fileInfo};
                                        if (!fileCopy.subfolder && fileCopy.fullSubfolder) {
                                            fileCopy.subfolder = fileCopy.fullSubfolder;
                                        } else if (!fileCopy.subfolder) {
                                            fileCopy.subfolder = subfolderPath;
                                        }
                                        selectedFiles.push(fileCopy);
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
