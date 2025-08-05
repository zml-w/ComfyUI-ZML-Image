// custom_nodes/zml_w/web/js/zml_Image.js

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el } from "/scripts/ui.js";

const ZML_API_PREFIX = "/zml"; // 定义API前缀

// --- 从 Lora Loader 借鉴并修改的核心功能 ---

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

// 创建一个浮动窗口的函数
function createModal(content) {
    const backdrop = document.createElement("div");
    backdrop.style.position = "fixed";
    backdrop.style.top = "0";
    backdrop.style.left = "0";
    backdrop.style.width = "100%";
    backdrop.style.height = "100%";
    backdrop.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    backdrop.style.zIndex = "1000";

    const modal = document.createElement("div");
    modal.innerHTML = content;
    modal.style.position = "fixed";
    modal.style.top = "50%";
    modal.style.left = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.backgroundColor = "#333";
    modal.style.padding = "20px";
    modal.style.border = "1px solid #555";
    modal.style.borderRadius = "8px";
    modal.style.zIndex = "1001";
    modal.style.maxHeight = "80vh";
    modal.style.overflowY = "auto";
    modal.style.minWidth = "400px";

    backdrop.onclick = () => {
        document.body.removeChild(backdrop);
        document.body.removeChild(modal);
    };

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    return modal;
}

app.registerExtension({
    name: "ZML.ImageLoaders.Enhanced",
    init() {
        // 添加CSS样式
		$el("style", {
			textContent: `
                .zml-image-preview {
                    position: absolute; left: 0; top: 0; width: auto; height: auto;
                    max-width: ${IMAGE_WIDTH}px; max-height: ${IMAGE_HEIGHT}px;
                    object-fit: contain; object-position: top left; z-index: 9999;
                    pointer-events: none; background-color: #111; border: 1px solid #444;
                }
				.zml-image-preview.left { object-position: top right; }
                .zml-image-browser-folder {
                    cursor: pointer; padding: 5px; border-radius: 3px;
                }
                .zml-image-browser-folder:hover { background-color: rgba(255, 255, 255, 0.1); }
				.zml-image-browser-arrow { display: inline-block; width: 15px; }
                .zml-image-browser-contents { display: none; padding-left: 15px; }
                .zml-image-browser-file {
                    display: block; width: calc(100% - 10px); margin-bottom: 5px; text-align: left;
                    padding: 5px; background-color: #444; border: 1px solid #555;
                    border-radius: 3px; cursor: pointer;
                }
                .zml-image-browser-file:hover { background-color: #555; border-color: #777; }
                .zml-tag-modal {
                    position: fixed; top: 5%; left: 5%; right: 5%; bottom: 5%; background-color: #222;
                    border: 1px solid #555; border-radius: 8px; z-index: 1001;
                    display: flex; flex-direction: column; box-shadow: 0 0 20px rgba(0,0,0,0.5);
                }
                .zml-tag-modal-header {
                    padding: 10px; background-color: #333; font-size: 1.2em;
                    border-bottom: 1px solid #555; text-align: center;
                }
                .zml-tag-modal-breadcrumbs { padding: 10px; background-color: #2a2a2a; border-bottom: 1px solid #444; color: #ccc; }
                .zml-tag-modal-content {
                    flex-grow: 1; padding: 15px; overflow-y: auto; display: flex;
                    flex-direction: column; gap: 20px;
                }
                .zml-folder-container { display: flex; flex-wrap: wrap; gap: 10px; padding-bottom: 15px; border-bottom: 1px solid #444; }
                .zml-image-container { display: flex; flex-wrap: wrap; gap: 10px; }
                .zml-tag-btn {
                    padding: 8px 16px; border: 1px solid #4a5a79; border-radius: 20px;
                    background-color: #4a5a79; cursor: pointer; color: #e0e5ff; transition: all 0.2s;
                }
                .zml-tag-btn:hover { background-color: #5a6a89; border-color: #7a8ab9; color: #fff; }
                .zml-img-btn {
                    padding: 10px 15px; border: 1px solid #555; border-radius: 5px; background-color: #444;
                    cursor: pointer; color: #eee; transition: background-color 0.2s, border-color 0.2s;
                    text-align: center; display: flex; flex-direction: column; align-items: center;
                    min-width: 120px; max-width: 150px;
                }
                .zml-img-btn:hover { background-color: #555; border-color: #777; }
                .zml-img-btn span { word-break: break-all; }
                .zml-img-btn.selected { background-color: #6a6; border-color: #8c8; }
                .zml-tag-modal-footer {
                    padding: 10px 20px; border-top: 1px solid #444; background-color: #333;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .zml-info-text { font-size: 0.8em; color: #999; }
                .zml-footer-actions { display: flex; align-items: center; gap: 10px; }
                .zml-tag-selected-count { color: #ccc; margin: 0 10px; }
                .zml-action-btn { padding: 8px 16px; border: none; color: white; border-radius: 5px; cursor: pointer; transition: background-color 0.2s; }
                .zml-undo-btn { background-color: #8a6d3b; }
                .zml-undo-btn:hover { background-color: #a0804a; }
                .zml-undo-btn:disabled { background-color: #555; color: #888; cursor: not-allowed; }
                .zml-clear-btn { background-color: #8c5a5a; }
                .zml-clear-btn:hover { background-color: #a06a6a; }
                .zml-tag-modal-confirm-btn { background-color: #57a; }
                .zml-tag-modal-confirm-btn:hover { background-color: #68b; }
                .zml-preview-toggle { display: flex; align-items: center; gap: 6px; color: #ccc; font-size: 0.9em; cursor: pointer; }
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
                    const modal = createModal(`
                        <div id="zml-image-list-container">
                            <h3>选择图片加载文本块</h3>
                            <p>正在加载图片列表...</p>
                        </div>`);
                    const container = modal.querySelector("#zml-image-list-container");

                    api.fetchApi(`${ZML_API_PREFIX}/get_output_images`)
                        .then(response => response.json())
                        .then(imageFiles => {
                            container.innerHTML = "<h3>选择图片加载文本块</h3>";
                            if (imageFiles.length === 0) {
                                container.innerHTML += "<p>Output 文件夹中没有找到图片。</p>";
                                return;
                            }
                            const folderMap = new Map(), itemsSymbol = Symbol("items"), splitBy = /\\|\//;
                            for (const fileInfo of imageFiles) {
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
                                    const fileEl = $el("button.zml-image-browser-file", {textContent: fileInfo.filename});
                                    fileEl.addEventListener("mouseover", () => {
                                        const subfolder = encodeRFC3986URIComponent(fileInfo.subfolder), filename = encodeRFC3986URIComponent(fileInfo.filename);
                                        imageHost.src = `${ZML_API_PREFIX}/view_image?filename=${filename}&subfolder=${subfolder}&t=${+new Date()}`;
                                        showImage(fileEl);
                                    });
                                    fileEl.addEventListener("mouseout", hideImage);
                                    fileEl.onclick = () => {
                                        hideImage();
                                        const subfolder = encodeURIComponent(fileInfo.subfolder), filename = encodeURIComponent(fileInfo.filename);
                                        api.fetchApi(`${ZML_API_PREFIX}/get_image_text_block?filename=${filename}&subfolder=${subfolder}`)
                                            .then(res => res.json()).then(data => {
                                                const textWidget = this.widgets.find(w => w.name === "text_from_image");
                                                if (textWidget) textWidget.value = data.text;
                                                modal.parentElement.onclick();
                                            });
                                    };
                                    parentEl.appendChild(fileEl);
                                }
                                for (const [folderName, content] of map.entries()) {
                                    if (folderName === itemsSymbol) continue;
                                    const folderEl = $el("div.zml-image-browser-folder", [$el("span.zml-image-browser-arrow", {textContent: "▶"}), $el("span", {textContent: folderName})]);
                                    parentEl.appendChild(folderEl);
                                    const contentContainer = $el("div.zml-image-browser-contents");
                                    insert(contentContainer, content);
                                    parentEl.appendChild(contentContainer);
                                    folderEl.addEventListener("click", () => {
                                        const arrow = folderEl.querySelector(".zml-image-browser-arrow");
                                        const isHidden = contentContainer.style.display === "none";
                                        contentContainer.style.display = isHidden ? "block" : "none";
                                        arrow.textContent = isHidden ? "▼" : "▶";
                                    });
                                }
                            };
                            insert(container, folderMap);
                        });
                });
            };
        }

        if (nodeData.name === "ZML_TagImageLoader") {
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

                this.addWidget("button", "打开标签选择器", "open", () => {
                    const backdrop = $el("div", { style: { position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0, 0, 0, 0.7)", zIndex: "1000" } });

                    const previewToggleCheckbox = $el("input", { type: "checkbox" });
                    const previewToggle = $el("label.zml-preview-toggle", [ previewToggleCheckbox, $el("span", { textContent: "启用预览" }) ]);
                    const undoBtn = $el("button.zml-action-btn.zml-undo-btn", { textContent: "撤回" });
                    const clearBtn = $el("button.zml-action-btn.zml-clear-btn", { textContent: "清空" });
                    const confirmBtn = $el("button.zml-action-btn.zml-tag-modal-confirm-btn", { textContent: "确认" });
                    const countEl = $el("div.zml-tag-selected-count");
                    
                    const modal = $el("div.zml-tag-modal", [
                        $el("div.zml-tag-modal-header", { textContent: "标签化图片选择器" }),
                        $el("div.zml-tag-modal-breadcrumbs"),
                        $el("div.zml-tag-modal-content"),
                        // --- [修改] 在底部栏左侧增加提示文字 ---
                        $el("div.zml-tag-modal-footer", [
                            $el("div", [
                                $el("span.zml-info-text", { textContent: "读取路径: ./output" }),
                                $el("br"),
                                $el("span.zml-info-text", { textContent: "开启预览后，快速滑动鼠标查看多个图片可能会导致控制台有报错信息，但完全可以忽略掉它" })
                            ]),
                            $el("div.zml-footer-actions", [ previewToggle, undoBtn, clearBtn, countEl, confirmBtn ])
                        ])
                    ]);

                    document.body.appendChild(backdrop);
                    document.body.appendChild(modal);

                    let fileTree = {}, currentPath = [], selectedFiles = [], historyStack = [];
                    let isPreviewEnabled = localStorage.getItem("zml.previewEnabled") !== "false";
                    previewToggleCheckbox.checked = isPreviewEnabled;

                    const widget = this.widgets.find(w => w.name === "selected_files_json");
                    if (widget && widget.value) {
                        try {
                            const previouslySelected = JSON.parse(widget.value);
                            if (Array.isArray(previouslySelected)) selectedFiles = previouslySelected;
                        } catch (e) { console.error("ZML_TagImageLoader: 无法解析已存在的JSON选项。", e); }
                    }

                    const contentEl = modal.querySelector(".zml-tag-modal-content");
                    const breadcrumbsEl = modal.querySelector(".zml-tag-modal-breadcrumbs");
                    
                    const updateUiState = () => { countEl.textContent = `已选: ${selectedFiles.length}`; undoBtn.disabled = historyStack.length === 0; };
                    updateUiState();

                    const closeModal = () => { hideImage(); backdrop.remove(); modal.remove(); };
                    backdrop.onclick = closeModal;
                    confirmBtn.onclick = () => { if (widget) widget.value = JSON.stringify(selectedFiles); closeModal(); };
                    
                    previewToggle.onchange = () => {
                        isPreviewEnabled = previewToggleCheckbox.checked;
                        localStorage.setItem("zml.previewEnabled", isPreviewEnabled);
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

                    const renderCurrentLevel = () => {
                        contentEl.innerHTML = "";
                        const folderContainer = $el("div.zml-folder-container");
                        const imageContainer = $el("div.zml-image-container");
                        contentEl.appendChild(folderContainer);
                        contentEl.appendChild(imageContainer);
                        let currentLevel = fileTree;
                        currentPath.forEach(part => { currentLevel = currentLevel[part]; });
                        breadcrumbsEl.textContent = `路径: /${currentPath.join("/")}`;

                        Object.keys(currentLevel).forEach(key => {
                            if (typeof currentLevel[key] === 'object' && !Array.isArray(currentLevel[key])) {
                                const tagBtn = $el("button.zml-tag-btn", { textContent: key });
                                tagBtn.onclick = () => { currentPath.push(key); renderCurrentLevel(); };
                                folderContainer.appendChild(tagBtn);
                            }
                        });
                        
                        if (currentLevel.files) {
                            for (const fileInfo of currentLevel.files) {
                                const [displayName] = fileInfo.filename.split('.');
                                const imgBtn = $el("button.zml-img-btn", [$el("span", { textContent: displayName })]);
                                if (selectedFiles.some(f => f.filename === fileInfo.filename && f.subfolder === fileInfo.subfolder)) {
                                    imgBtn.classList.add("selected");
                                }
                                imgBtn.addEventListener("mouseover", () => {
                                    if (!isPreviewEnabled) return;
                                    const subfolder = encodeRFC3986URIComponent(fileInfo.subfolder), filename = encodeRFC3986URIComponent(fileInfo.filename);
                                    imageHost.src = `${ZML_API_PREFIX}/view_image?filename=${filename}&subfolder=${subfolder}&t=${+new Date()}`;
                                    showImage(imgBtn);
                                });
                                imgBtn.addEventListener("mouseout", hideImage);
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
                        
                        if (currentPath.length > 0) {
                             const backBtn = $el("button.zml-tag-btn", { textContent: "⬅️ 返回上一级" });
                             backBtn.onclick = () => { currentPath.pop(); renderCurrentLevel(); };
                             folderContainer.prepend(backBtn);
                        }
                    };

                    api.fetchApi(`${ZML_API_PREFIX}/get_output_images`).then(r => r.json()).then(allFiles => {
                        for (const fileInfo of allFiles) {
                            const pathParts = fileInfo.subfolder ? fileInfo.subfolder.split(/\\|\//) : [];
                            let currentLevel = fileTree;
                            for (const part of pathParts) {
                                if (!part) continue;
                                if (!currentLevel[part]) currentLevel[part] = {};
                                currentLevel = currentLevel[part];
                            }
                            if (!currentLevel.files) currentLevel.files = [];
                            currentLevel.files.push(fileInfo);
                        }
                        renderCurrentLevel();
                    }).catch(error => { contentEl.textContent = `加载失败: ${error}`; });
                });
            };
        }
    },
});