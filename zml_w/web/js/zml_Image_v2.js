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
                            align-items: center;
                        }
                        .zml-v2-path-input {
                            flex-grow: 1;
                            padding: 10px 12px;
                            background-color: #333;
                            border: 1px solid #555;
                            border-radius: 3px;
                            color: #ccc;
                            font-size: 14px;
                            min-width: 150px;
                        }                        
                        .zml-v2-up-btn,
                        .zml-v2-refresh-btn,
                        .zml-v2-clear-btn {
                            padding: 6px 12px;
                            font-size: 14px;
                            border: none;
                            border-radius: 3px;
                            cursor: pointer;
                            transition: background-color 0.2s ease;
                            color: white;
                            white-space: nowrap;
                        }
                        .zml-v2-up-btn { background-color: #6c757d; }
                        .zml-v2-up-btn:hover { background-color: #5a6268; }
                        .zml-v2-refresh-btn { background-color: #4a90e2; }
                        .zml-v2-refresh-btn:hover { background-color: #3a7bd5; }
                        .zml-v2-clear-btn { background-color: #c9302c; }
                        .zml-v2-clear-btn:hover { background-color: #a92824; }
                        .zml-v2-selection-counter {
                            font-size: 14px;
                            color: #ccc;
                            display: flex;
                            align-items: center;
                            margin-left: auto;
                            padding-right: 4px;
                            white-space: nowrap;
                        }
                        
                        /* --- 🔴 MODIFIED: 修复滚动条遮挡问题 --- */
                        .zml-v2-current-path {
                            width: 100%;
                            padding: 8px 12px;
                            background-color: #333;
                            border: 1px solid #555;
                            border-radius: 3px;
                            color: #ccc;
                            font-size: 14px;
                            white-space: nowrap;     /* 保持单行 */
                            overflow: hidden;        /* 隐藏溢出部分 */
                            text-overflow: ellipsis; /* 显示省略号 */
                            margin-top: -4px;
                        }

                        .zml-v2-image-grid {
                            display: grid; 
                            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                            gap: 8px;
                            max-height: 2000px;
                            overflow-y: auto;
                            padding: 4px;
                            background: #222;
                            border-radius: 3px;
                            min-height: 110px;
                        }
                        .zml-v2-image-item {
                            position: relative;
                            border: 2px solid #555;
                            border-radius: 4px;
                            overflow: hidden;
                            cursor: pointer;
                            transition: border-color 0.2s ease, box-shadow 0.2s ease;
                            height: 0;
                            padding-bottom: 100%;
                        }
                        .zml-v2-image-item img {
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            object-fit: contain;
                        }
                        .zml-v2-image-item:hover { border-color: #4a90e2; }
                        .zml-v2-image-item.selected {
                            border-color: #5cb85c;
                            box-shadow: 0 0 8px rgba(92, 184, 92, 0.6);
                        }
                        .zml-v2-folder-item {
                            border: 1px solid #777;
                            border-radius: 4px;
                            padding: 4px 8px;
                            cursor: pointer;
                            transition: all 0.2s ease;
                            display: flex;
                            flex-direction: row;
                            align-items: center;
                            background-color: #3a3a3a;
                            color: #eee;
                            height: auto;
                            width: fit-content;
                        }
                        .zml-v2-folder-item:hover {
                            border-color: #4a90e2;
                            background-color: #444;
                        }
                        .zml-v2-folder-item::before {
                            content: '📁';
                            font-size: 14px;
                            margin-right: 5px;
                        }
                        .zml-v2-folder-item-name {
                            font-size: 12px;
                            color: #eee;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            max-width: 80px;
                        }
                        .zml-v2-loader-status {
                            font-size: 12px;
                            color: #888;
                            text-align: center;
                            padding: 16px;
                            width: 100%;
                            grid-column: 1 / -1;
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
                const rootPathWidget = this.widgets.find(w => w.name === "根目录路径");
                
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
                    
                    // 从widget获取根目录路径
                    if (rootPathWidget && rootPathWidget.value) {
                        // 根目录路径已在fetchImages中使用
                    }
                };

                const container = $el("div.zml-v2-loader-container");
                const imageGrid = $el("div.zml-v2-image-grid");
                const statusEl = $el("div.zml-v2-loader-status", { textContent: "输入绝对路径并点击刷新" });
                imageGrid.appendChild(statusEl);

                const refreshBtn = $el("button.zml-v2-refresh-btn", { textContent: "刷新" });
                const upBtn = $el("button.zml-v2-up-btn", { textContent: "返回上级" });
                const currentPathDisplay = $el("div.zml-v2-current-path");

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
                
                const header = $el("div.zml-v2-loader-header", [
                    upBtn, 
                    currentPathDisplay, 
                    refreshBtn, 
                    clearBtn, 
                    counterEl
                ]);
                container.append(header, imageGrid); 

                if (modeWidget) {
                    modeWidget.callback = updateSelectionCounter;
                }

                let comfyuiRootPath = ""; 
                let currentDisplayPath = ""; 

                const getRelativePath = (absolutePath, rootPath) => {
                    try {
                        // 规范化路径分隔符
                        const normalizedAbsPath = absolutePath.replace(/\\/g, '/');
                        const normalizedRootPath = rootPath ? rootPath.replace(/\\/g, '/') : '';
                        
                        // 如果有根目录路径，并且当前路径是根目录的子目录，则返回相对路径
                        if (normalizedRootPath && normalizedAbsPath.startsWith(normalizedRootPath)) {
                            let relativePath = normalizedAbsPath.substring(normalizedRootPath.length);
                            // 移除开头的斜杠
                            if (relativePath.startsWith('/')) {
                                relativePath = relativePath.substring(1);
                            }
                            // 确保根目录显示为"./"，子目录显示为"./子目录名"
                            return relativePath ? './' + relativePath : './';
                        }
                        
                        // 如果没有根目录路径或不是子目录，则返回相对于ComfyUI根目录的路径
                        if (comfyuiRootPath) {
                            const normalizedComfyRoot = comfyuiRootPath.replace(/\\/g, '/');
                            if (normalizedAbsPath.startsWith(normalizedComfyRoot)) {
                                let relativePath = normalizedAbsPath.substring(normalizedComfyRoot.length);
                                if (relativePath.startsWith('/')) {
                                    relativePath = relativePath.substring(1);
                                }
                                return './' + relativePath;
                            }
                        }
                        
                        // 如果都不是，则返回绝对路径的最后一部分作为相对路径显示
                        const parts = normalizedAbsPath.split('/');
                        return './' + (parts[parts.length - 1] || '');
                    } catch (e) {
                        console.error("计算相对路径时出错:", e);
                        return absolutePath;
                    }
                };
                
                const renderItems = (folders, imageFiles, basePath) => {
                    imageGrid.innerHTML = "";
                    
                    if (folders.length === 0 && imageFiles.length === 0) {
                        imageGrid.appendChild($el("div.zml-v2-loader-status", { textContent: "此文件夹中没有找到任何内容" }));
                    }

                    for (const folderName of folders) {
                        const folderNameSpan = $el("span.zml-v2-folder-item-name", { textContent: folderName });
                        const folderItem = $el("div.zml-v2-folder-item", [folderNameSpan]); 
                        folderItem.addEventListener("click", () => {
                            const newPath = basePath + (basePath.endsWith('/') || basePath.endsWith('\\') ? '' : '/') + folderName;
                            fetchImages(newPath);
                        });
                        imageGrid.appendChild(folderItem);
                    }

                    for (const filename of imageFiles) {
                        const fullPath = basePath + (basePath.endsWith('/') || basePath.endsWith('\\') ? '' : '/') + filename;
                        const encodedPath = encodeURIComponent(fullPath);
                        const img = $el("img", { src: `/zml/v2/view_thumb?path=${encodedPath}`, title: filename });
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
                    
                    if (folders.length > 0 && imageFiles.length === 0) {
                        imageGrid.style.display = 'flex';
                        imageGrid.style.flexWrap = 'wrap';
                        imageGrid.style.minHeight = 'auto';
                    } else {
                        imageGrid.style.display = 'grid';
                        imageGrid.style.flexWrap = '';
                        imageGrid.style.minHeight = '110px';
                    }
                };

                const fetchImages = async (targetPath = currentDisplayPath) => { 
                    const rootPath = rootPathWidget ? rootPathWidget.value.trim() : "";
                    let pathToSend = targetPath;

                    if (!pathToSend && rootPath) {
                        pathToSend = rootPath;
                    } else if (!pathToSend && !rootPath) {
                        pathToSend = ""; 
                    }
                    
                    localStorage.setItem(storageKey, pathToSend); 

                    if (state.path !== pathToSend) {
                         state.files = [];
                    }
                    state.path = pathToSend;
                    saveState();
                    updateSelectionCounter();

                    imageGrid.innerHTML = "";
                    imageGrid.appendChild($el("div.zml-v2-loader-status", { textContent: "正在加载..." }));
                    imageGrid.style.display = 'grid';
                    imageGrid.style.minHeight = '110px';

                    try {
                        const response = await api.fetchApi(`/zml/v2/list_images?path=${encodeURIComponent(pathToSend)}`);
                        if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.error || `HTTP错误！状态: ${response.status}`);
                        }
                        const data = await response.json();
                        currentDisplayPath = data.path;

                        // 计算相对路径用于显示，保留绝对路径在title中
                        const rootPathValue = rootPathWidget ? rootPathWidget.value.trim() : "";
                        const relativePath = getRelativePath(currentDisplayPath, rootPathValue);
                        
                        currentPathDisplay.textContent = relativePath; 
                        currentPathDisplay.title = currentDisplayPath; // 添加 title 属性以显示完整路径
                        
                        comfyuiRootPath = data.comfyui_root_path; 
                        renderItems(data.folders, data.files, data.path);
                    } catch (error) {
                        console.error("获取图像或文件夹时出错:", error);
                        imageGrid.innerHTML = "";
                        imageGrid.appendChild($el("div.zml-v2-loader-status", { textContent: `加载失败: ${error.message}` }));
                        imageGrid.style.display = 'grid'; 
                        imageGrid.style.minHeight = '110px';
                    }
                };
                
                refreshBtn.addEventListener("click", () => {
                    // 直接使用当前路径进行刷新
                    fetchImages(currentDisplayPath);
                });

                upBtn.addEventListener("click", () => {
                    // 优先从widget获取根目录路径
                    const rootPath = rootPathWidget ? rootPathWidget.value.trim() : pathInput.value.trim();
                    let normalizedCurrentDisplayPath = currentDisplayPath.replace(/\\/g, '/');
                    let normalizedRootPath = rootPath.replace(/\\/g, '/');

                    if (normalizedCurrentDisplayPath.endsWith('/') && normalizedCurrentDisplayPath !== '/') {
                        normalizedCurrentDisplayPath = normalizedCurrentDisplayPath.slice(0, -1);
                    }
                    if (normalizedRootPath && normalizedRootPath.endsWith('/') && normalizedRootPath !== '/') {
                        normalizedRootPath = normalizedRootPath.slice(0, -1);
                    }

                    if (normalizedCurrentDisplayPath === normalizedRootPath) {
                        return;
                    }
                    
                    if (normalizedCurrentDisplayPath.match(/^[a-zA-Z]:\/?$/) && !normalizedRootPath) {
                        return;
                    }
                    
                    let parentPath = normalizedCurrentDisplayPath.substring(0, normalizedCurrentDisplayPath.lastIndexOf('/'));
                    
                    if (parentPath === '' && normalizedCurrentDisplayPath.match(/^[a-zA-Z]:[^\/]*$/)) {
                        parentPath = normalizedCurrentDisplayPath.split(':')[0] + ':/';
                    } else if (parentPath === '') {
                        parentPath = '/';
                    }
                    
                    if (normalizedRootPath && normalizedCurrentDisplayPath.startsWith(normalizedRootPath)) {
                        if (parentPath.length < normalizedRootPath.length ) { 
                           parentPath = normalizedRootPath;
                        }
                    } else if (normalizedRootPath && !normalizedCurrentDisplayPath.startsWith(normalizedRootPath)) {
                         parentPath = normalizedRootPath;
                    }

                    fetchImages(parentPath);
                });


                // --- 初始加载 ---
                loadState();

                // 优先使用widget中的根目录路径，然后是state.path，最后是localStorage
                const rootPathValue = rootPathWidget ? rootPathWidget.value.trim() : "";
                const pathOnLoad = rootPathValue || state.path || localStorage.getItem(storageKey);
                
                if (pathOnLoad) {
                    fetchImages(pathOnLoad); 
                    // 如果有根目录路径，确保同步到widget
                    if (rootPathWidget && !rootPathWidget.value && state.path) {
                        rootPathWidget.value = state.path;
                    }
                } else {
                    fetchImages("").then(() => { 
                        localStorage.setItem(storageKey, currentDisplayPath);
                    });
                }
                
                updateSelectionCounter();
                
                this.addDOMWidget("loader_v2", " ", container, {});
                this.size = [
                    Math.max(this.size[0] || 0, ZML_IMAGE_NODE_MIN_WIDTH),
                    Math.max(this.size[1] || 0, ZML_IMAGE_NODE_MIN_HEIGHT)
                ];
                const origOnResize = this.onResize;
                this.onResize = function(size) {
                    size[0] = Math.max(size[0], ZML_IMAGE_NODE_MIN_WIDTH);
                    size[1] = Math.max(size[1], ZML_IMAGE_NODE_MIN_HEIGHT);
                    
                    this.size = size;
                    
                    if(origOnResize) origOnResize.call(this, size);
                };
            };
        }
    },
});
