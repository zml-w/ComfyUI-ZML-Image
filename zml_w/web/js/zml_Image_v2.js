// custom_nodes/ComfyUI-ZML-Image/zml_w/web/js/zml_Image_v2.js

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el } from "/scripts/ui.js";

// 定义节点的最小尺寸常量
const ZML_IMAGE_NODE_MIN_WIDTH = 400;
const ZML_IMAGE_NODE_MIN_HEIGHT = 400;

app.registerExtension({
    name: "ZML.LoadImageFromPathV2",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_LoadImageFromPathV2") {
            // --- 为新节点添加CSS样式 ---
            if (!document.getElementById('zml-v2-loader-styles')) {
                $el("style", {
                    id: 'zml-v2-loader-styles',
                    textContent: `
                        .zml-v2-loader-container {
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                            padding: 8px;
                            background-color: #2a2a2a;
                            border: 1px solid #444;
                            border-radius: 4px;
                        }
                        .zml-v2-loader-header {
                            display: flex;
                            gap: 8px;
                        }
                        .zml-v2-path-input {
                            flex-grow: 1;
                            padding: 6px 8px;
                            background-color: #333;
                            border: 1px solid #555;
                            border-radius: 3px;
                            color: #ccc;
                            font-size: 12px;
                        }
                        .zml-v2-refresh-btn {
                            padding: 6px 12px;
                            background-color: #4a90e2;
                            color: white;
                            border: none;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            transition: background-color 0.2s ease;
                        }
                        .zml-v2-refresh-btn:hover { background-color: #3a7bd5; }

                        .zml-v2-clear-btn {
                            padding: 6px 12px;
                            background-color: #c9302c; /* 使用一个警示性的红色 */
                            color: white;
                            border: none;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            transition: background-color 0.2s ease;
                        }
                        .zml-v2-clear-btn:hover { background-color: #a92824; }
                        
                        .zml-v2-selection-counter {
                            font-size: 12px;
                            color: #ccc;
                            display: flex;
                            align-items: center; /* 垂直居中对齐 */
                            margin-left: auto; /* 将计数器推到最右边 */
                            padding-right: 8px;
                        }

                        .zml-v2-image-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                            gap: 8px;
                            max-height: 2000px; /* 限制最大高度，超出则滚动 */
                            overflow-y: auto;
                            padding: 4px;
                            background: #222;
                            border-radius: 3px;
                            min-height: 110px; /* 设置最小高度以显示状态文本 */
                        }
                        
                        .zml-v2-image-item {
                            position: relative;
                            border: 2px solid #555;
                            border-radius: 4px;
                            overflow: hidden;
                            cursor: pointer;
                            transition: border-color 0.2s ease, box-shadow 0.2s ease;
                            height: 0;
                            padding-bottom: 100%; /* 使用padding创建正方形 */
                        }
                        .zml-v2-image-item img {
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            object-fit: contain; /* 确保图片等比缩放并完整显示 */
                        }

                        .zml-v2-image-item:hover {
                            border-color: #4a90e2;
                        }
                        .zml-v2-image-item.selected {
                            border-color: #5cb85c;
                            box-shadow: 0 0 8px rgba(92, 184, 92, 0.6);
                        }
                        .zml-v2-loader-status {
                            font-size: 12px;
                            color: #888;
                            text-align: center;
                            padding: 16px;
                            width: 100%;
                            grid-column: 1 / -1; /* 让状态文本横跨整个网格 */
                        }
                    `,
                    parent: document.body,
                });
            }

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                const jsonWidget = this.widgets.find(w => w.name === "selected_files_json");
                const modeWidget = this.widgets.find(w => w.name === "模式");
                
                if (jsonWidget && jsonWidget.element) {
                    jsonWidget.element.style.display = 'none';
                }

                const storageKey = `zml.v2.lastPath.${this.id}`;

                let state = {
                    path: "",
                    files: [],
                };
                
                const counterEl = $el("span.zml-v2-selection-counter", { textContent: "已选: 0 张" });
                
                const updateSelectionCounter = () => {
                    const mode = modeWidget.value;
                    let modeText = "";
                    if (mode === "随机") {
                        modeText = " (运行时随机)";
                    } else if (mode === "关闭预览") {
                        modeText = " (预览关闭, 运行时随机)";
                    }
                    counterEl.textContent = `已选: ${state.files.length} 张${modeText}`;
                };

                const saveState = () => {
                    jsonWidget.value = JSON.stringify(state);
                };
                
                const loadState = () => {
                    try {
                        const loaded = JSON.parse(jsonWidget.value);
                        if (loaded && typeof loaded === 'object') {
                            state.path = loaded.path || "";
                            state.files = loaded.files || [];
                        }
                    } catch(e) {}
                };

                const container = $el("div.zml-v2-loader-container");
                const imageGrid = $el("div.zml-v2-image-grid");
                const statusEl = $el("div.zml-v2-loader-status", { textContent: "输入绝对路径并点击刷新" });
                imageGrid.appendChild(statusEl);

                const refreshBtn = $el("button.zml-v2-refresh-btn", { textContent: "刷新" });
                const pathInput = $el("input.zml-v2-path-input", {
                    type: "text",
                    placeholder: "输入图像文件夹的绝对路径...",
                });

                const clearBtn = $el("button.zml-v2-clear-btn", { textContent: "清空" });

                clearBtn.addEventListener("click", () => {
                    if (state.files.length === 0) return;

                    state.files = [];
                    saveState();
                    updateSelectionCounter();

                    const allItems = imageGrid.querySelectorAll(".zml-v2-image-item.selected");
                    allItems.forEach(item => {
                        item.classList.remove("selected");
                    });
                });
                
                const header = $el("div.zml-v2-loader-header", [pathInput, refreshBtn, clearBtn, counterEl]);
                container.append(header, imageGrid);

                // 函数：根据当前模式更新UI的可见性
                const updateUIVisibility = () => {
                    const isPreviewDisabled = modeWidget.value === "关闭预览";
                    
                    // 隐藏或显示整个UI容器
                    container.style.display = isPreviewDisabled ? 'none' : 'flex';
                    
                    // 更新计数器文本
                    updateSelectionCounter();

                    // 如果切换到可见模式，且当前没有图片，则尝试自动加载
                    if (!isPreviewDisabled) {
                        const hasImages = imageGrid.querySelector(".zml-v2-image-item");
                        if (!hasImages && pathInput.value) {
                             fetchImages();
                        }
                    }
                };

                // 当模式切换时，只更新UI可见性和提示文本
                if (modeWidget) {
                    modeWidget.callback = updateUIVisibility;
                }

                const renderImages = (imageFiles, basePath) => {
                    imageGrid.innerHTML = "";
                    if (imageFiles.length === 0) {
                        imageGrid.appendChild($el("div.zml-v2-loader-status", { textContent: "此文件夹中没有找到图片" }));
                        return;
                    }

                    for (const filename of imageFiles) {
                        const fullPath = basePath + (basePath.endsWith('/') || basePath.endsWith('\\') ? '' : '/') + filename;
                        const encodedPath = encodeURIComponent(fullPath);

                        const img = $el("img", {
                            src: `/zml/v2/view_thumb?path=${encodedPath}`,
                            title: filename
                        });

                        const imageItem = $el("div.zml-v2-image-item", [img]);
                        imageItem.dataset.fullpath = fullPath;
                        
                        if (state.files.includes(fullPath)) {
                            imageItem.classList.add("selected");
                        }

                        imageItem.addEventListener("click", () => {
                            imageItem.classList.toggle("selected");
                            const filePath = imageItem.dataset.fullpath;
                            const index = state.files.indexOf(filePath);

                            if (imageItem.classList.contains("selected")) {
                                if (index === -1) state.files.push(filePath);
                            } else {
                                if (index > -1) state.files.splice(index, 1);
                            }
                            saveState();
                            updateSelectionCounter(); 
                        });
                        
                        imageGrid.appendChild(imageItem);
                    }
                };

                const fetchImages = async () => {
                    // 如果UI是关闭的，则不执行任何获取操作
                    if (modeWidget.value === "关闭预览") return;

                    const path = pathInput.value.trim();
                    if (!path) {
                        alert("请输入文件夹路径。");
                        return;
                    }
                    
                    localStorage.setItem(storageKey, path);
                    
                    if (state.path !== path) {
                         state.files = [];
                    }
                    state.path = path;
                    saveState();
                    updateSelectionCounter();

                    imageGrid.innerHTML = "";
                    imageGrid.appendChild($el("div.zml-v2-loader-status", { textContent: "正在加载..." }));

                    try {
                        const response = await api.fetchApi(`/zml/v2/list_images?path=${encodeURIComponent(path)}`);
                        if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.error || `HTTP错误！状态: ${response.status}`);
                        }
                        const data = await response.json();
                        renderImages(data.files, data.path);
                    } catch (error) {
                        console.error("获取图像时出错:", error);
                        imageGrid.innerHTML = "";
                        imageGrid.appendChild($el("div.zml-v2-loader-status", { textContent: `加载失败: ${error.message}` }));
                    }
                };
                
                refreshBtn.addEventListener("click", fetchImages);
                pathInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") fetchImages();
                });

                // --- 初始加载 ---
                loadState();

                const pathOnLoad = state.path || localStorage.getItem(storageKey);
                if (pathOnLoad) {
                    pathInput.value = pathOnLoad;
                    // 仅在预览模式开启时自动加载
                    if (modeWidget.value !== "关闭预览") {
                        fetchImages(); 
                    }
                }
                
                // 设置初始UI可见性
                updateUIVisibility();
                
                this.addDOMWidget("loader_v2", " ", container, {});
                // 使用常量设置初始最小尺寸
                this.size = [
                    Math.max(this.size[0] || 0, ZML_IMAGE_NODE_MIN_WIDTH),
                    Math.max(this.size[1] || 0, ZML_IMAGE_NODE_MIN_HEIGHT)
                ];
                const origOnResize = this.onResize;
                this.onResize = function(size) {
                    // 使用常量确保最小宽度和最小高度
                    size[0] = Math.max(size[0], ZML_IMAGE_NODE_MIN_WIDTH);
                    size[1] = Math.max(size[1], ZML_IMAGE_NODE_MIN_HEIGHT);
                    
                    this.size = size;
                    
                    if(origOnResize) origOnResize.call(this, size);
                };
            };
        }
    },
});