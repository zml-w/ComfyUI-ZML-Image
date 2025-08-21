// 文件路径: ComfyUI-ZML-Image\zml_w\web\js\zml_lora_loader.js

import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";
import { api } from "/scripts/api.js";

const TARGET_LORA_LOADERS = ["ZmlLoraLoader", "ZmlLoraLoaderModelOnly", "ZmlLoraLoaderFive", "ZmlLoraMetadataParser"];
const ZML_API_PREFIX = "/zml/lora";
const IMAGE_WIDTH = 384;
const IMAGE_HEIGHT = 384;
// 定义强力LORA加载器推荐的最小宽度
const POWER_LORA_LOADER_MIN_WIDTH = 460; 

// 新增：定义强力LORA加载器推荐的最小高度（仅当lora列表为空时使用）
const POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST = 280; // 根据实际测试调整，确保底部按钮不被裁切


function encodeRFC3986URIComponent(str) {
	return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
const calculateImagePosition = (el, bodyRect) => {
	let { top, left, right } = el.getBoundingClientRect();
	const { width: bodyWidth, height: bodyHeight } = bodyRect;
	const isSpaceRight = right + IMAGE_WIDTH <= bodyWidth;
	if (isSpaceRight) left = right;
	else left -= IMAGE_WIDTH;
	top = Math.max(0, top - IMAGE_HEIGHT / 2);
	if (top + IMAGE_HEIGHT > bodyHeight) top = bodyHeight - IMAGE_HEIGHT;
	return { left: Math.round(left), top: Math.round(top), isLeft: !isSpaceRight };
};
let loraImages = {};
const loadImageList = async () => {
	loraImages = await (await api.fetchApi(`${ZML_API_PREFIX}/images/loras`)).json();
};

/**
 * 调整颜色的亮度。
 * @param {string} hex - 十六进制颜色字符串 (e.g., "#RRGGBB").
 * @param {number} percent - 调整百分比 (-100 到 100).
 * @returns {string} 调整后的十六进制颜色字符串.
 */
function adjustBrightness(hex, percent) {
    // 移除 # 号
    hex = hex.replace(/^#/, '');
    // 解析R, G, B
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // 计算新的R, G, B
    r = Math.min(255, Math.max(0, r + Math.floor(percent / 100 * 255)));
    g = Math.min(255, Math.max(0, g + Math.floor(percent / 100 * 255)));
    b = Math.min(255, Math.max(0, b + Math.floor(percent / 100 * 255)));

    // 转换回十六进制
    const toHex = (c) => ('0' + c.toString(16)).slice(-2);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}


app.registerExtension({
	name: "zml.LoraLoader.Final.v9",
	init() {
		// --- init() 函数只执行与UI运行时无关的、一次性的初始化配置 ---

		// 1. 注入CSS样式
		$el("style", {
			textContent: `
				.zml-lora-image-preview { position: absolute; left: 0; top: 0; width: ${IMAGE_WIDTH}px; height: ${IMAGE_HEIGHT}px; object-fit: contain; object-position: top left; z-index: 9999; pointer-events: none; }
				.zml-lora-image-preview.left { object-position: top right; }
				.zml-lora-folder { opacity: 0.7; } .zml-lora-folder-arrow { display: inline-block; width: 15px; } .zml-lora-folder:hover { background-color: rgba(255, 255, 255, 0.1); }
				.zml-lora-prefix { display: none; } .litecontextmenu:has(input:not(:placeholder-shown)) .zml-lora-folder-contents { display: block !important; }
				.litecontextmenu:has(input:not(:placeholder-shown)) .zml-lora-folder { display: none; } .litecontextmenu:has(input:not(:placeholder-shown)) .zml-lora-prefix { display: inline; }
				.litecontextmenu:has(input:not(:placeholder-shown)) .litemenu-entry { padding-left: 2px !important; }
			`,
			parent: document.body,
		});

		// 2. 注册设置项
		const displayOptions = { "树状(子文件夹)": 1, "列表(原始)": 0 };
		const displaySetting = app.ui.settings.addSetting({
			id: "zml.LoraLoader.DisplayMode", name: "LORA文件夹显示样式", defaultValue: 1, type: "combo",
			options: (value) => Object.entries(displayOptions).map(([k, v]) => ({ value: v, text: k, selected: v === +value })),
		});
		// 将设置项保存到 this，以便 setup 函数可以访问
		this.zmlLoraDisplaySetting = displaySetting;

		// 3. 封装原始的 Lora 刷新函数，并触发首次 Lora 列表加载
		const refreshComboInNodes = app.refreshComboInNodes;
		app.refreshComboInNodes = async function () {
			const r = await Promise.all([ refreshComboInNodes.apply(this, arguments), loadImageList().catch(() => {}) ]);
			return r[0];
		};
		// 保存首次加载的 Promise，以便在 setup 中等待
		this.zmlLoraInitialLoad = loadImageList();
	},

	async setup() {
		// --- setup() 函数在UI完全加载后执行，处理所有与DOM和运行时交互相关的逻辑 ---

		// 1. 等待首次 Lora 镜像列表加载完成
		await this.zmlLoraInitialLoad.catch(console.error);

		// 2. 创建图片预览的DOM元素
        this.imageHost = $el("img.zml-lora-image-preview");

		// 3. 定义图片显示/隐藏的辅助函数
		this.showImage = (relativeToEl) => {
			const bodyRect = document.body.getBoundingClientRect();
			if (!bodyRect) return;
			const { left, top, isLeft } = calculateImagePosition(relativeToEl, bodyRect);
			this.imageHost.style.left = `${left}px`; this.imageHost.style.top = `${top}px`;
			this.imageHost.classList.toggle("left", isLeft);
			document.body.appendChild(this.imageHost);
		};
		this.hideImage = () => {
			this.imageHost.remove();
		};

		// 4. 定义更新 Lora 菜单的函数
		const updateMenu = (menu) => {
			menu.style.maxHeight = `${window.innerHeight - menu.getBoundingClientRect().top - 20}px`;
			const items = menu.querySelectorAll(".litemenu-entry");
			const addImageHandler = (item) => {
				const text = item.getAttribute("data-value")?.trim();
				if (text && loraImages[text]) {
					item.addEventListener("mouseover", () => {
						const imagePath = loraImages[text];
						const fullViewPath = `loras/${imagePath}`;
						this.imageHost.src = `${ZML_API_PREFIX}/view/${encodeRFC3986URIComponent(fullViewPath)}?${+new Date()}`;
						this.showImage(item);
					});
					item.addEventListener("mouseout", this.hideImage);
					item.addEventListener("click", this.hideImage);
				}
			};

			const createTree = () => {
				const folderMap = new Map(), itemsSymbol = Symbol("items");
				const splitBy = (navigator.platform || navigator.userAgent).includes("Win") ? /\\|\// : /\//;
				for (const item of items) {
					const value = item.getAttribute("data-value");
					if (!value || value === "None") continue;
					const path = value.split(splitBy);
					item.textContent = path[path.length - 1];
					if (path.length > 1) item.prepend($el("span.zml-lora-prefix", { textContent: path.slice(0, -1).join("/") + "/" }));
					addImageHandler(item);
					if (path.length === 1) continue;
					item.remove();
					let currentLevel = folderMap;
					for (let i = 0; i < path.length - 1; i++) {
						if (!currentLevel.has(path[i])) currentLevel.set(path[i], new Map());
						currentLevel = currentLevel.get(path[i]);
					}
					if (!currentLevel.has(itemsSymbol)) currentLevel.set(itemsSymbol, []);
					currentLevel.get(itemsSymbol).push(item);
				}
				const insert = (parentEl, map, level = 0) => {
					for (const [folderName, content] of map.entries()) {
						if (folderName === itemsSymbol) continue;
						const folderEl = $el("div.litemenu-entry.zml-lora-folder", {
							innerHTML: `<span class="zml-lora-folder-arrow">▶</span> ${folderName}`,
							style: { paddingLeft: `${level * 10 + 5}px` },
						});
						parentEl.appendChild(folderEl);
						const container = $el("div.zml-lora-folder-contents", { style: { display: "none" } });
						const itemsInFolder = content.get(itemsSymbol) || [];
						for (const item of itemsInFolder) {
							item.style.paddingLeft = `${(level + 1) * 10 + 14}px`;
							container.appendChild(item);
						}
						insert(container, content, level + 1);
						parentEl.appendChild(container);
						folderEl.addEventListener("click", (e) => {
							e.stopPropagation();
							const arrow = folderEl.querySelector(".zml-lora-folder-arrow");
							const isHidden = container.style.display === "none";
							container.style.display = isHidden ? "block" : "none";
							arrow.textContent = isHidden ? "▼" : "▶";
						});
					}
				};
				insert(items[0]?.parentElement || menu, folderMap);
			};

			if (this.zmlLoraDisplaySetting.value == 1) createTree();
			else for (const item of items) addImageHandler(item);
		};

		// 5. 设置 MutationObserver 来监听 Lora 菜单的出现
		const mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const added of mutation.addedNodes) {
					if (added.classList?.contains("litecontextmenu")) {
						const widget = app.canvas.getWidgetAtCursor();
						const widgetName = widget?.name;
						if (TARGET_LORA_LOADERS.includes(app.canvas.current_node?.comfyClass) && (widgetName?.startsWith("lora_name") || widgetName?.startsWith("lora_"))) {
							requestAnimationFrame(() => updateMenu(added));
						}
						return;
					}
				}
			}
		});

		// 6. 启动观察者
		mutationObserver.observe(document.body, { childList: true });
	},

	async beforeRegisterNodeDef(nodeType, nodeData) {
        // This part is for other Lora Loaders, not the Power one. Left as is.
		if (TARGET_LORA_LOADERS.includes(nodeData.name)) {
			if (nodeData.name === "ZmlLoraLoader" || nodeData.name === "ZmlLoraLoaderModelOnly") {
				const onAdded = nodeType.prototype.onAdded;
				nodeType.prototype.onAdded = function () {
					onAdded?.apply(this, arguments);
					setTimeout(() => {
						const modelWidget = this.widgets.find(w => w.name === "lora_name");
						if (!modelWidget) return;
						const modelCb = modelWidget.callback;
						modelWidget.callback = function () {
							let ret = modelCb?.apply(this, arguments) ?? modelWidget.value;
							if (typeof ret === "object" && "content" in ret) {
								ret = ret.content;
								modelWidget.value = ret;
							}
							return ret;
						};
					}, 0);
				};
			}

			const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
			nodeType.prototype.getExtraMenuOptions = function (_, options) {
				getExtraMenuOptions?.apply(this, arguments);
				if (this.imgs && this.imgs.length > 0) {
					const otherLoraNodes = TARGET_LORA_LOADERS.flatMap(name => app.graph.findNodesByType(name))
						.filter(n => n.id !== this.id);

					const uniqueNodes = [...new Map(otherLoraNodes.map(item => [item.id, item])).values()];

					if (uniqueNodes.length) {
						options.unshift({
							content: "Update Lora Preview (ZML)",
							submenu: {
								options: uniqueNodes.flatMap(n => {
									if(n.comfyClass === "ZmlLoraLoader" || n.comfyClass === "ZmlLoraLoaderModelOnly") {
										const widget = n.widgets.find(w => w.name === "lora_name");
										if (!widget || !widget.value || widget.value === "None") return [];
										return {
											content: widget.value,
											callback: () => this.savePreviewForLora(widget.value),
										};
									}
									if(n.comfyClass === "ZmlLoraLoaderFive") {
										return n.widgets.filter(w => w.name.startsWith("lora_") && w.value && w.value !== "None").map(w => ({
											content: w.value,
											callback: () => this.savePreviewForLora(w.value),
										}));
									}
									return [];
								}).filter(Boolean),
								className: "zml-lora-save-submenu",
							},
						});
					}
				}
			};

			nodeType.prototype.savePreviewForLora = async function(loraName) {
				const img = this.imgs[0];
				if (!img || !img.src) return;
				const url = new URL(img.src);
				const filename = url.searchParams.get("filename");
				const subfolder = url.searchParams.get("subfolder");
				const type = url.searchParams.get("type") || "output";

				if (!filename) {
					console.warn("ZML_LoraLoader: Cannot save preview, filename is missing from image URL.");
					return;
				}

				await api.fetchApi(`${ZML_API_PREFIX}/save/loras/${encodeRFC3986URIComponent(loraName)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ filename, subfolder, type }),
				});
				await loadImageList();
			}
		}

        if (nodeData.name === "ZmlPowerLoraLoader") {
            if (!document.getElementById("zml-power-lora-loader-style")) {
                $el("style", {
                    id: "zml-power-lora-loader-style",
                    textContent: `
                        .zml-lora-tree-menu { position: absolute; background-color: #2e2e2e; border: 1px solid #555; border-radius: 4px; padding: 5px; z-index: 10000; max-height: 400px; overflow-y: auto; }
                        .zml-lora-tree-menu .zml-lora-folder, .zml-lora-tree-menu .zml-lora-file { padding: 5px 8px; cursor: pointer; border-radius: 2px; }
                        .zml-lora-tree-menu .zml-lora-folder:hover, .zml-lora-tree-menu .zml-lora-file:hover { background-color: #535353; }
                        .zml-lora-tree-menu .zml-lora-folder-arrow { display: inline-block; width: 1em; text-align: center; }
                        .zml-lora-tree-menu .zml-lora-folder-content { display: none; padding-left: 15px; }

                        .zml-pll-entry-card.zml-pll-dragging, .zml-pll-folder-card.zml-pll-dragging { opacity: 0.5; background: #555; }
                        /* .zml-pll-entry-card.zml-pll-drag-over, .zml-pll-folder-card.zml-pll-drag-over { border-top: 2px solid #5d99f2 !important; } */
                        .zml-pll-drag-over-line { border-top: 2px solid #5d99f2 !important; }
                        .zml-pll-drag-handle.locked { cursor: not-allowed !important; color: #666 !important; }
                        
                        /* Removed hardcoded background and border from .zml-pll-folder-card */
                        .zml-pll-folder-card { border-radius: 4px; margin-bottom: 4px; }
                        .zml-pll-folder-header { display: flex; align-items: center; padding: 4px; cursor: pointer; }
                        .zml-pll-folder-header.zml-pll-drag-over-folder { background-color: rgba(93, 153, 242, 0.3) !important; } /* Drop into folder highlight */

                        .zml-pll-folder-toggle { width: 20px; text-align: center; font-size: 14px; user-select: none; }
                        .zml-pll-folder-name-input { background: #2b2b2b; border: 1px solid #444; color: #ccc; border-radius: 2px; flex-grow: 1; padding: 4px; margin: 0 4px; }
                        .zml-pll-folder-delete { background: #444; color: #ccc; border: 1px solid #666; border-radius: 2px; width: 28px; height: 28px; cursor: pointer; }
                        .zml-pll-folder-content { padding: 4px; border-top: 1px solid #4a515a; display: flex; flex-direction: column; gap: 4px; }
                        .zml-pll-folder-content.hidden { display: none; }


                        .zml-pll-controls-top {
                            display: flex;
                            align-items: center;
                            justify-content: flex-start;
                            gap: 6px;
                            padding: 2px 0 6px 0;
                            border-bottom: 1px solid #444;
                            margin: 0 6px 6px 6px;
                        }

                        .zml-pll-controls-bottom {
                            display: flex;
                            align-items: center;
                            justify-content: flex-end;
                            gap: 6px;
                            margin: 0 6px 6px 6px;
                            padding-top: 6px;
                            border-top: 1px solid #444;
                        }
                        .zml-pll-button {
                            padding: 8px 16px;
                            height: 38px;
                            background: #444;
                            color: #ccc;
                            border: 1px solid #666;
                            border-radius: 2px;
                            cursor: pointer;
                            font-size: 12px;
                            font-weight: 500;
                            flex-shrink: 0;
                        }
                        .zml-pll-button:hover {
                            background-color: #555;
                        }
                        .zml-pll-button.locked {
                            background-color: #644;
                        }

                        .zml-pll-button-lg {
                            flex: 1;
                            min-width: 80px;
                            text-align: center;
                        }

                        .zml-control-btn-pll, .zml-control-input-pll {
                            height: 26px;
                            padding: 0;
                            border: 1px solid #555;
                            border-radius: 2px;
                            background: #333;
                            color: #ccc;
                            font-size: 12px;
                            box-sizing: border-box;
                            flex-shrink: 0;
                        }
                        .zml-control-input-pll {
                            padding: 4px 8px;
                            text-align: left;
                            width: 60px;
                        }
                        .zml-control-btn-pll {
                            cursor: pointer;
                            text-align: center;
                            font-size: 14px;
                            line-height: 1;
                            width: 26px;
                        }
                        .zml-control-btn-pll:hover {
                            background-color: #555;
                        }
                        .zml-control-btn-pll.locked {
                            background-color: #644;
                        }

                        .zml-control-label-pll {
                            font-size: 12px;
                            color: #ccc;
                            flex-shrink: 0;
                        }
                        .zml-control-group-pll {
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            flex-shrink: 0;
                        }

                        .zml-lora-display-name-input {
                            padding: var(--pll-current-input-padding);
                            height: var(--pll-current-input-height);
                            background: #2b2b2b;
                            border: 1px solid #444;
                            border-radius: 2px;
                            color: #ccc;
                            font-size: 12px;
                            margin-right: 4px;
                            box-sizing: border-box;
                            flex-shrink: 0;
                        }

                        .zml-lora-custom-text-input {
                            padding: var(--pll-current-input-padding);
                            height: var(--pll-current-input-height);
                            background: #2b2b2b;
                            border: 1px solid #444;
                            border-radius: 2px;
                            color: #ccc;
                            font-size: 12px;
                            margin-right: 4px;
                            box-sizing: border-box;
                            resize: none;
                            overflow: auto;
                            min-height: 26px;
                            flex-shrink: 0;
                        }

                        .zml-pll-entries-list {
                            overflow: auto;
                            flex: 1;
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            padding: 0;
                        }
                    `,
                    parent: document.body,
                });
            }
            const loraNamesFlat = nodeData.input.hidden.lora_names_hidden[0] || [];
            const loraTree = { files: [], folders: {} };
            loraNamesFlat.forEach(name => {
                if (name === "None") return;
                const parts = name.split(/[/\\]/);
                let currentLevel = loraTree;
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    if (!currentLevel.folders[part]) currentLevel.folders[part] = { files: [], folders: {} };
                    currentLevel = currentLevel.folders[part];
                }
                currentLevel.files.push({ name: parts[parts.length - 1], fullpath: name });
            });
            function createEl(tag, properties = {}, text = "") { const el = document.createElement(tag); Object.assign(el, properties); if (text) el.textContent = text; return el; }
            let activeLoraMenu = null;
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
                 try {
                     if (this.powerLoraLoader_initialized) return r;
                     this.powerLoraLoader_initialized = true;
                     this.loraTree = loraTree;

                     this.isLocked = this.isLocked ?? false;
                     this.compactView = this.compactView ?? false;
                     this.loraNameWidth = this.loraNameWidth ?? 65;
                     this.customTextWidth = this.customTextWidth ?? 80;
                     // New: Default folder color
                     this.folderColor = this.folderColor ?? "#30353c";


                     if (!this.powerLoraLoader_data) {
                         this.powerLoraLoader_data = { entries: [
                             { id: "lora1", item_type: "lora", display_name: "", custom_text: "", lora_name: "None", weight: 1.0, enabled: true }]
                         };
                     }
                     // Ensure old data has item_type
                     this.powerLoraLoader_data.entries.forEach(e => {
                         if (!e.item_type) e.item_type = 'lora';
                     });

                     const dataWidget = this.addWidget("text", "lora_loader_data", JSON.stringify(this.powerLoraLoader_data), (v) => { try { if(v) this.powerLoraLoader_data = JSON.parse(v); } catch(e){} }, { serialize: true });
                     dataWidget.hidden = true; dataWidget.computeSize = () => [0, 0];

                     const container = createEl("div");
                     container.style.cssText = `background: #2b2b2b; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; display: flex; flex-direction: column; padding: 6px;`;

                     const topControls = createEl("div", { className: "zml-pll-controls-top" });

                     const loraNameWidthGroup = createEl("div", { className: "zml-control-group-pll" });
                     const loraNameWidthLabel = createEl("span", { className: "zml-control-label-pll", textContent: "名称宽度" });
                     const loraNameWidthInput = createEl("input", { className: "zml-control-input-pll" });
                     loraNameWidthInput.type = "number";
                     loraNameWidthInput.min = "10";
                     loraNameWidthInput.max = "300";
                     loraNameWidthInput.value = this.loraNameWidth;
                     loraNameWidthInput.title = "LoRA 名称框宽度 (像素)";
                     loraNameWidthInput.oninput = (e) => {
                         let val = parseInt(e.target.value, 10);
                         if (isNaN(val)) val = 65;
                         val = Math.max(10, Math.min(300, val));
                         this.loraNameWidth = val;
                         e.target.value = val;
                         this.renderLoraEntries();
                         this.triggerSlotChanged();
                     };
                     loraNameWidthGroup.append(loraNameWidthLabel, loraNameWidthInput);
                     topControls.appendChild(loraNameWidthGroup);

                     const customTextWidthGroup = createEl("div", { className: "zml-control-group-pll" });
                     const customTextWidthLabel = createEl("span", { className: "zml-control-label-pll", textContent: "文本宽度" });
                     const customTextWidthInput = createEl("input", { className: "zml-control-input-pll" });
                     customTextWidthInput.type = "number";
                     customTextWidthInput.min = "10";
                     customTextWidthInput.max = "300";
                     customTextWidthInput.value = this.customTextWidth;
                     customTextWidthInput.title = "自定义文本框宽度 (像素)";
                     customTextWidthInput.oninput = (e) => {
                         let val = parseInt(e.target.value, 10);
                         if (isNaN(val)) val = 80;
                         val = Math.max(10, Math.min(300, val));
                         this.customTextWidth = val;
                         e.target.value = val;
                         this.renderLoraEntries();
                         this.triggerSlotChanged();
                     };
                     customTextWidthGroup.append(customTextWidthLabel, customTextWidthInput);
                     topControls.appendChild(customTextWidthGroup);
                     
                     // === 新建文件夹按钮 ===
                     const newFolderBtn = createEl("button", { className: "zml-control-btn-pll", textContent: "📁+" });
                     newFolderBtn.title = "新建文件夹";
                     newFolderBtn.onclick = () => {
                         this.powerLoraLoader_data.entries.push({
                             id: "folder" + Date.now(),
                             item_type: "folder",
                             name: "新建文件夹",
                             is_collapsed: false,
                             parent_id: null, // New folders are always top-level
                         });
                         this.renderLoraEntries();
                         this.triggerSlotChanged();
                     };
                     topControls.appendChild(newFolderBtn);
                     // =======================

                     // === 文件夹颜色按钮 (新增) ===
                     const folderColorInput = createEl("input", { type: "color", value: this.folderColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                     folderColorInput.onchange = (e) => {
                         this.folderColor = e.target.value;
                         this.renderLoraEntries(); // Re-render to apply new color
                         this.triggerSlotChanged();
                     };
                     const folderColorBtn = createEl("button", { className: "zml-control-btn-pll", textContent: "🎨" });
                     folderColorBtn.title = "自定义文件夹颜色";
                     folderColorBtn.onclick = () => folderColorInput.click();
                     topControls.appendChild(folderColorInput); // Hidden input
                     topControls.appendChild(folderColorBtn);    // Visible button
                     // =============================


                     const lockToggleButton = createEl("button", { className: "zml-control-btn-pll", textContent: this.isLocked ? "🔒" : "🔓" });
                     lockToggleButton.title = "锁定/解锁 LoRA 排序";
                     lockToggleButton.style.cssText += `${this.isLocked ? 'background: #644;' : 'background: #333;'}`;
                     lockToggleButton.onmouseenter = () => lockToggleButton.style.background = '#555';
                     lockToggleButton.onmouseleave = () => lockToggleButton.style.background = this.isLocked ? '#644' : '#333';
                     lockToggleButton.onclick = () => {
                         this.isLocked = !this.isLocked;
                         lockToggleButton.textContent = this.isLocked ? "🔒" : "🔓";
                         lockToggleButton.style.background = this.isLocked ? '#644' : '#333';
                         this.renderLoraEntries();
                         this.triggerSlotChanged();
                     };
                     topControls.appendChild(lockToggleButton);

                     const sizeToggleButton = createEl("button", { className: "zml-control-btn-pll", textContent: "↕" });
                     sizeToggleButton.title = "切换紧凑/普通视图";
                     sizeToggleButton.onmouseenter = () => sizeToggleButton.style.background = '#555';
                     sizeToggleButton.onmouseleave = () => sizeToggleButton.style.background = '#444';
                     sizeToggleButton.onclick = () => {
                         this.compactView = !this.compactView;
                         this.applySizeMode();
                         this.triggerSlotChanged();
                     };
                     topControls.appendChild(sizeToggleButton);

                     const entriesList = createEl("div", { className: "zml-pll-entries-list" });

                     const bottomControls = createEl("div", { className: "zml-pll-controls-bottom" });

                     const newLoraBtn = createEl("button", { className: "zml-pll-button zml-pll-button-lg", textContent: "＋ 添加 Lora" });
                     newLoraBtn.onclick = () => {
                        this.powerLoraLoader_data.entries.push({ 
                            id: "lora" + Date.now(),
                            item_type: "lora",
                            display_name: "",
                            custom_text: "",
                            lora_name: "None",
                            weight: 1.0,
                            enabled: true,
                            parent_id: null, // New Lora are always top-level by default
                        });
                        this.renderLoraEntries();
                        this.triggerSlotChanged();
                    };
                     bottomControls.appendChild(newLoraBtn);

                     this.stylesPLL = {
                        normal: {
                            cardPadding: "4px", inputPadding: "4px 8px", inputHeight: "28px", checkboxScale: "1.5",
                        },
                        compact: {
                            cardPadding: "2px", inputPadding: "2px 6px", inputHeight: "22px", checkboxScale: "1.2",
                        }
                    };

                     this.applySizeMode = () => {
                        const s = this.compactView ? this.stylesPLL.compact : this.stylesPLL.normal;
                        entriesList.style.setProperty('--pll-current-input-height', s.inputHeight);
                        entriesList.style.setProperty('--pll-current-input-padding', s.inputPadding);
                        this.renderLoraEntries();
                     };

                     this.createLoraEntryDOM = (entry) => { // Removed index parameter as it's not strictly needed for rendering
                         const s = this.compactView ? this.stylesPLL.compact : this.stylesPLL.normal;
                         const entryCard = createEl("div", {
                             className: "zml-pll-entry-card",
                             style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${entry.enabled ? '#3a3a3a' : '#2a2a2a'}; border-radius: 2px;`
                         });
                         entryCard.dataset.id = entry.id;
                         entryCard.dataset.type = "lora";

                         const checkbox = createEl("input", { type: "checkbox", checked: entry.enabled, style: `transform: scale(${s.checkboxScale}); flex-shrink: 0; margin-right: 4px;` });
                         checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderLoraEntries(); this.triggerSlotChanged(); };

                         const dragHandle = createEl("div", { className: "zml-pll-drag-handle", textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: 14px;` });
                         dragHandle.draggable = !this.isLocked;

                         const displayNameInput = createEl("input", { className: "zml-lora-display-name-input", type: "text", value: entry.display_name, placeholder: "输入名称...", title: "自定义此LoRA条目的显示名称", style: `width: ${this.loraNameWidth}px;` });
                         displayNameInput.oninput = (e) => { entry.display_name = e.target.value; this.triggerSlotChanged(); };

                         const loraSelectorBtn = createEl("button", { style: `flex-grow: 1; min-width: 100px; padding: ${s.inputPadding}; background: #222; border: 1px solid #555; border-radius: 2px; color: #ccc; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: ${s.inputHeight};`, textContent: entry.lora_name === "None" ? "None" : entry.lora_name.split(/[/\\]/).pop() });
                         loraSelectorBtn.onclick = () => { if (activeLoraMenu) activeLoraMenu.close(); activeLoraMenu = this.createLoraTreeMenu(loraSelectorBtn, entry, () => { loraSelectorBtn.textContent = entry.lora_name === "None" ? "None" : entry.lora_name.split(/[/\\]/).pop(); this.triggerSlotChanged(); }); };

                         const weightWidget = createEl("div", { style: `display: flex; align-items: center; justify-content: center; gap: 4px; background: #222; border: 1px solid #555; border-radius: 2px; padding: 2px 4px; height: ${s.inputHeight};` });
                         const decBtn = createEl("button", { style: "background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%;" }, "<");
                         const weightDisplay = createEl("span", { style: "min-width: 32px; text-align: center; color: #ddd;" }, entry.weight.toFixed(2));
                         const incBtn = createEl("button", { style: "background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%;" }, ">");
                         decBtn.onclick = () => { entry.weight = Math.max(-10, parseFloat((entry.weight - 0.05).toFixed(2))); weightDisplay.textContent = entry.weight.toFixed(2); this.triggerSlotChanged(); };
                         incBtn.onclick = () => { entry.weight = Math.min(10, parseFloat((entry.weight + 0.05).toFixed(2))); weightDisplay.textContent = entry.weight.toFixed(2); this.triggerSlotChanged(); };
                         weightWidget.append(decBtn, weightDisplay, incBtn);

                         const customTextInput = createEl("textarea", { className: "zml-lora-custom-text-input", value: entry.custom_text || "", placeholder: "输入文本", title: "LoRA 的自定义文本内容", style: `width: ${this.customTextWidth}px;` });
                         customTextInput.oninput = (e) => { entry.custom_text = e.target.value; this.triggerSlotChanged(); };

                         // === 移出文件夹按钮 (新增) ===
                         if (entry.parent_id) { // Only show if Lora is in a folder
                            const moveOutBtn = createEl("button", { 
                                style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #4a6a4a; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;`,
                                title: "移出文件夹"
                            }, "⬆️");
                            moveOutBtn.onclick = () => {
                                entry.parent_id = null; // Set parent_id to null to make it top-level
                                this.renderLoraEntries();
                                this.triggerSlotChanged();
                            };
                            entryCard.append(checkbox, dragHandle, displayNameInput, loraSelectorBtn, weightWidget, customTextInput, moveOutBtn);
                         } else {
                             entryCard.append(checkbox, dragHandle, displayNameInput, loraSelectorBtn, weightWidget, customTextInput);
                         }
                         // ===========================

                         const deleteBtn = createEl("button", {
                            style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;`
                         }, "X");
                         deleteBtn.onclick = () => {
                             const itemIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === entry.id);
                             if (itemIndex > -1) {
                                 this.powerLoraLoader_data.entries.splice(itemIndex, 1);
                                 this.renderLoraEntries();
                                 this.triggerSlotChanged();
                             }
                         };
                         entryCard.appendChild(deleteBtn);
                         
                         this.addDragDropHandlers(entryCard, entry);
                         return entryCard;
                     };

                     this.createFolderDOM = (entry) => { // Removed index parameter
                         const folderCard = createEl("div", { 
                            className: "zml-pll-folder-card",
                            style: `background: ${this.folderColor}; border: 1px solid ${adjustBrightness(this.folderColor, -15)};` // Apply custom color
                         });
                         folderCard.dataset.id = entry.id;
                         folderCard.dataset.type = "folder";

                         const header = createEl("div", { className: "zml-pll-folder-header" });
                         const toggle = createEl("div", { className: "zml-pll-folder-toggle", textContent: entry.is_collapsed ? "▶" : "▼" });
                         const nameInput = createEl("input", { className: "zml-pll-folder-name-input", type: "text", value: entry.name });
                         const deleteBtn = createEl("button", { className: "zml-pll-folder-delete", textContent: "🗑️" });
                         const dragHandle = createEl("div", { className: "zml-pll-drag-handle", textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; color: ${this.isLocked ? '#666' : '#ccc'}; user-select: none; font-size: 14px; padding: 0 5px;` });
                         dragHandle.draggable = !this.isLocked;

                         const content = createEl("div", { className: `zml-pll-folder-content ${entry.is_collapsed ? 'hidden' : ''}` });
                         // Apply the same border color as the folder card header for consistency
                         content.style.borderColor = adjustBrightness(this.folderColor, -15);


                         header.onclick = (e) => {
                             // Allow clicking on inputs/buttons inside header without toggling collapse
                             if (e.target === nameInput || e.target === deleteBtn || e.target === dragHandle) return;
                             // Check if the click happened directly on the header or the toggle button
                             if (e.target === header || e.target === toggle || e.target.parentElement === header) {
                                 entry.is_collapsed = !entry.is_collapsed;
                                 toggle.textContent = entry.is_collapsed ? "▶" : "▼";
                                 content.classList.toggle('hidden', entry.is_collapsed);
                                 this.triggerSlotChanged();
                             }
                         };
                         
                         nameInput.onchange = (e) => { entry.name = e.target.value; this.triggerSlotChanged(); };
                         
                         deleteBtn.onclick = (e) => {
                             e.stopPropagation();
                             const children = this.powerLoraLoader_data.entries.filter(it => it.parent_id === entry.id);
                             if (children.length > 0) {
                                 alert("文件夹内含有LoRA，无法删除！");
                                 return;
                             }
                             const itemIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === entry.id);
                             if (itemIndex > -1) {
                                 this.powerLoraLoader_data.entries.splice(itemIndex, 1);
                                 this.renderLoraEntries();
                                 this.triggerSlotChanged();
                             }
                         };

                         header.append(toggle, dragHandle, nameInput, deleteBtn);
                         folderCard.append(header, content);
                         this.addDragDropHandlers(folderCard, entry);
                         return folderCard;
                     };
                     
                     this.addDragDropHandlers = (element, entry) => {
                         if (this.isLocked) return;
                         
                         const handle = element.querySelector(".zml-pll-drag-handle");
                         if (!handle) return;
                         
                         handle.ondragstart = (e) => {
                             e.stopPropagation(); // Prevent drag from parent elements
                             e.dataTransfer.setData("text/plain", entry.id);
                             // To fix drag image transparency on some browsers
                             e.dataTransfer.setDragImage(element, e.offsetX, e.offsetY);
                             setTimeout(() => element.classList.add("zml-pll-dragging"), 0);
                         };
                         
                         element.ondragover = (e) => {
                             e.preventDefault(); // Allow drop
                             const draggingEl = document.querySelector(".zml-pll-dragging");
                             if (draggingEl && draggingEl !== element) {
                                 const draggingEntryId = e.dataTransfer.getData("text/plain");
                                 const draggingEntry = this.powerLoraLoader_data.entries.find(it => it.id === draggingEntryId);

                                 if (!draggingEntry) return;

                                 // Clear previous drag-over highlights
                                 document.querySelectorAll(".zml-pll-drag-over-line, .zml-pll-drag-over-folder").forEach(el => {
                                     el.classList.remove("zml-pll-drag-over-line", "zml-pll-drag-over-folder");
                                 });

                                 // Logic for dropping IN / BETWEEN
                                 if (entry.item_type === 'folder' && draggingEntry.item_type === 'lora') {
                                     // Dropping a Lora into a folder
                                     element.querySelector('.zml-pll-folder-header').classList.add("zml-pll-drag-over-folder");
                                 } else {
                                     // Dropping between items (this includes regular reordering and moving Lora out of folder)
                                     element.classList.add("zml-pll-drag-over-line");
                                 }
                             }
                         };
                         
                         element.ondragleave = (e) => {
                             element.classList.remove("zml-pll-drag-over-line");
                             if (entry.item_type === 'folder') {
                                element.querySelector('.zml-pll-folder-header').classList.remove("zml-pll-drag-over-folder");
                             }
                         };
                         
                         element.ondrop = (e) => {
                             e.preventDefault();
                             e.stopPropagation(); // Stop propagation to prevent parent containers from handling the drop
                             // Clean up all drag-over highlights
                             document.querySelectorAll(".zml-pll-drag-over-line, .zml-pll-drag-over-folder").forEach(el => {
                                 el.classList.remove("zml-pll-drag-over-line", "zml-pll-drag-over-folder");
                             });

                             const fromId = e.dataTransfer.getData("text/plain");
                             const toId = entry.id;
                             
                             const fromIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === fromId);
                             const toIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === toId);
                             const fromItem = this.powerLoraLoader_data.entries[fromIndex];
                             const toItem = this.powerLoraLoader_data.entries[toIndex];
                             
                             if (fromIndex === -1 || toIndex === -1 || fromId === toId) return;

                             // Move item within the flat array
                             const itemToMove = this.powerLoraLoader_data.entries.splice(fromIndex, 1)[0];
                             let newInsertIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === toId);

                             if (toItem.item_type === 'folder' && fromItem.item_type === 'lora') {
                                // Drop Lora INTO a folder
                                itemToMove.parent_id = toItem.id;
                                // For visual grouping, try to insert right after the target folder
                                this.powerLoraLoader_data.entries.splice(newInsertIndex + 1, 0, itemToMove);
                             } else {
                                // Drop between items (could be Lora, folders, or moving Lora out of folder)
                                // In this case, the dragged item inherits the parent of the item it's dropped *next to*.
                                itemToMove.parent_id = toItem.parent_id; 
                                this.powerLoraLoader_data.entries.splice(newInsertIndex, 0, itemToMove);
                             }

                             this.renderLoraEntries();
                             this.triggerSlotChanged();
                         };
                         
                         element.ondragend = (e) => {
                            element.classList.remove("zml-pll-dragging");
                            // Also clear any lingering drag-over highlights
                             document.querySelectorAll(".zml-pll-drag-over-line, .zml-pll-drag-over-folder").forEach(el => {
                                 el.classList.remove("zml-pll-drag-over-line", "zml-pll-drag-over-folder");
                             });
                         };
                     };
                     
                     this.renderLoraEntries = () => {
                         entriesList.innerHTML = "";
                         const itemMap = new Map(this.powerLoraLoader_data.entries.map(e => [e.id, { entry: e, dom: null }]));

                         // First pass: create all DOM elements
                         for (const [id, item] of itemMap) {
                            if (item.entry.item_type === 'folder') {
                                item.dom = this.createFolderDOM(item.entry);
                            } else {
                                item.dom = this.createLoraEntryDOM(item.entry);
                            }
                         }

                         // Second pass: append to correct parents in the correct order
                         // Filter out items that have a parent_id, they will be appended to their parent's content div
                         const topLevelItems = this.powerLoraLoader_data.entries.filter(e => !e.parent_id);
                         
                         const appendRecursive = (parentDom, itemsToAppend) => {
                             itemsToAppend.forEach(item => {
                                 const domInfo = itemMap.get(item.id);
                                 if (!domInfo) return; // Should not happen

                                 parentDom.appendChild(domInfo.dom);
                                 
                                 // If it's a folder, recursively append its children
                                 if (item.item_type === 'folder') {
                                     const folderContentArea = domInfo.dom.querySelector('.zml-pll-folder-content');
                                     if (folderContentArea) {
                                         const children = this.powerLoraLoader_data.entries.filter(e => e.parent_id === item.id);
                                         // Sort children based on their original order in powerLoraLoader_data.entries
                                         const sortedChildren = children.sort((a, b) => 
                                            this.powerLoraLoader_data.entries.indexOf(a) - this.powerLoraLoader_data.entries.indexOf(b)
                                         );
                                         appendRecursive(folderContentArea, sortedChildren);
                                     }
                                 }
                             });
                         };

                         // Sort top-level items based on their original order
                         const sortedTopLevelItems = topLevelItems.sort((a, b) => 
                            this.powerLoraLoader_data.entries.indexOf(a) - this.powerLoraLoader_data.entries.indexOf(b)
                         );

                         appendRecursive(entriesList, sortedTopLevelItems);

                         app.graph.setDirtyCanvas(true, true);
                     };

                     container.append(topControls, entriesList, bottomControls);
                     this.addDOMWidget("power_lora_loader_ui", "div", container, { serialize: false });

                     // 修改：调整初始最小高度的计算
                     // 确保至少有足够的空间容纳顶部的输入/输出插槽以及顶部控制区域
                     // (this.widgets_always_on_top?.[0]?.last_y || 0): 这是顶部输入连接点（model）的y坐标，基本上是节点最上方的内部Y值。
                     // 加上 POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST（例如 100或150）是为了给该点以下的内容预留初步空间。
                     const initialHeightFromWidgets = (this.widgets_always_on_top?.[0]?.last_y || 0) + POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST; 
                     this.size = [
                         Math.max(this.size[0] || 0, POWER_LORA_LOADER_MIN_WIDTH), 
                         Math.max(this.size[1] || 0, initialHeightFromWidgets) // 使用新的计算方式
                     ];
                     

                     const origOnResize = this.onResize;
                     this.onResize = function(size) {
                         size[0] = Math.max(size[0], POWER_LORA_LOADER_MIN_WIDTH);
                         // Dynamic height adjustment based on content height
                         let currentContentHeight = topControls.offsetHeight + bottomControls.offsetHeight + 12; // Controls + padding
                         
                         // 如果没有LoRA条目（包括文件夹），确保entriesList区域有一个最小高度
                         if (this.powerLoraLoader_data.entries.length === 0) {
                             currentContentHeight += 50; // 为空的LoRA列表预留一部分高度，避免过度压缩
                         } else {
                             // 否则使用实际的滚动高度或者客户端高度
                             currentContentHeight += Math.max(entriesList.scrollHeight, entriesList.clientHeight);
                         }

                         // 确保总高度不小于初始布局所需的高度，防止在内容很少时高度过小
                         currentContentHeight = Math.max(currentContentHeight, initialHeightFromWidgets);
                         
                         size[1] = Math.max(size[1], currentContentHeight); // 使用计算出的高度和当前用户拖动的高度中较大的值

                         this.size = size;

                         const domElement = this.domElement;
                         if (domElement) {
                            // 当节点大小不足以显示全部内容时，允许滚动
                            if (size[1] < domElement.scrollHeight || size[0] < domElement.scrollWidth) {
                                domElement.style.overflow = "auto";
                                entriesList.style.overflowY = "auto"; // Also ensure internal list scrolls
                            } else {
                                domElement.style.overflow = "hidden";
                                entriesList.style.overflowY = "visible"; // Allow it to push node size
                            }
                         }

                         if (origOnResize) origOnResize.call(this, size);
                     };


                     this.triggerSlotChanged = () => { dataWidget.value = JSON.stringify(this.powerLoraLoader_data); this.setDirtyCanvas(true, true); };

                     // 确保在初始化时就调用一次 onResize 来设置正确的大小
                     // 使用 next tick 确保 DOM 完全渲染后再计算尺寸
                     setTimeout(() => {
                        this.onResize(this.size); 
                        this.applySizeMode(); 
                     }, 0);

                     // 确保 onConfigure 也会触发正确的大小调整
                     const originalOnConfigure = nodeType.prototype.onConfigure;
                     nodeType.prototype.onConfigure = function(obj) {
                         originalOnConfigure?.apply(this, arguments);
                         // ... (现有 onConfigure 逻辑) ...
                         if (this.powerLoraLoader_initialized && this.applySizeMode) {
                             setTimeout(() => {
                                 const topControls = this.domElement.querySelector(".zml-pll-controls-top");
                                 if (topControls) {
                                      const lockButton = topControls.querySelector("button[title='锁定/解锁 LoRA 排序']");
                                      if (lockButton) {
                                          lockButton.textContent = this.isLocked ? "🔒" : "🔓";
                                          lockButton.style.background = this.isLocked ? '#644' : '#333';
                                      }
                                      const numberInputs = topControls.querySelectorAll("input[type='number']");
                                      if(numberInputs[0]) numberInputs[0].value = this.loraNameWidth;
                                      if(numberInputs[1]) numberInputs[1].value = this.customTextWidth;
                                      
                                      // Update color input value
                                      const folderColorInput = topControls.querySelector("input[type='color']");
                                      if (folderColorInput) {
                                          folderColorInput.value = this.folderColor;
                                      }
                                 }

                                 this.applySizeMode(); // This will call renderLoraEntries
                                 // 再次调用 onResize 确保重新配置后高度正确
                                 this.onResize(this.size); 
                             }, 10);
                         }
                     };


                 } catch (error) { console.error("ZML_PowerLoraLoader: UI初始化错误:", error); }
                 return r;
            };

            nodeType.prototype.createLoraTreeMenu = function(button, entry, onSelect) {
                // This function remains largely the same
                const menu = createEl("div", { className: "zml-lora-tree-menu" });
                const closeMenu = () => { menu.remove(); document.removeEventListener("click", clickOutside, true); activeLoraMenu = null; };

                const ext = app.extensions.find(e => e.name === "zml.LoraLoader.Final.v9");
                const imageHost = ext?.imageHost;
                const showImage = ext?.showImage;
                const hideImage = ext?.hideImage;

                const buildMenuLevel = (parent, treeLevel) => {
                    treeLevel.files.sort((a,b) => a.name.localeCompare(b.name)).forEach(file => {
                        const fileEl = createEl("div", { className: "zml-lora-file", textContent: file.name });
                        fileEl.onclick = () => { entry.lora_name = file.fullpath; onSelect(); hideImage?.(); closeMenu(); };

                        if (loraImages[file.fullpath] && imageHost && showImage && hideImage) {
                             fileEl.addEventListener("mouseover", () => {
                                const imagePath = loraImages[file.fullpath];
                                const fullViewPath = `loras/${imagePath}`;
                                imageHost.src = `${ZML_API_PREFIX}/view/${encodeRFC3986URIComponent(fullViewPath)}?${+new Date()}`;
                                showImage.call(ext, fileEl);
                            });
                            fileEl.addEventListener("mouseout", hideImage.bind(ext));
                        }

                        parent.appendChild(fileEl);
                    });

                    Object.keys(treeLevel.folders).sort().forEach(folderName => {
                        const folderEl = createEl("div", { className: "zml-lora-folder", innerHTML: `<span class="zml-lora-folder-arrow">▶</span> ${folderName}` });
                        const contentEl = createEl("div", { className: "zml-lora-folder-content" });
                        folderEl.onclick = (e) => { e.stopPropagation(); const isHidden = contentEl.style.display === "none"; contentEl.style.display = isHidden ? "block" : "none"; folderEl.querySelector('.zml-lora-folder-arrow').textContent = isHidden ? "▼" : "▶"; };
                        buildMenuLevel(contentEl, treeLevel.folders[folderName]);
                        parent.append(folderEl, contentEl);
                    });
                };

                const noneEl = createEl("div", { className: "zml-lora-file", textContent: "None" });
                noneEl.onclick = () => { entry.lora_name = "None"; onSelect(); hideImage?.(); closeMenu(); };
                menu.appendChild(noneEl);
                buildMenuLevel(menu, this.loraTree);
                const rect = button.getBoundingClientRect();
                menu.style.left = `${rect.left}px`; menu.style.top = `${rect.bottom}px`;
                menu.style.minWidth = `${rect.width}px`;
                document.body.appendChild(menu);
                const clickOutside = (e) => { if (!menu.contains(e.target) && e.target !== button) { hideImage?.(); closeMenu(); } };
                setTimeout(() => document.addEventListener("click", clickOutside, true), 0);

                return { close: closeMenu };
            };

            const origOnSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(obj) {
                origOnSerialize?.apply(this, arguments);
                obj.powerLoraLoader_data = this.powerLoraLoader_data;
                obj.isLocked = this.isLocked;
                obj.compactView = this.compactView;
                obj.loraNameWidth = this.loraNameWidth;
                obj.customTextWidth = this.customTextWidth;
                obj.folderColor = this.folderColor; // Save folder color
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(obj) {
                origOnConfigure?.apply(this, arguments);
                if (obj.powerLoraLoader_data) {
                    this.powerLoraLoader_data = obj.powerLoraLoader_data;
                    // Compatibility for old workflows: add item_type and parent_id for existing entries
                    this.powerLoraLoader_data.entries.forEach(e => {
                        if (!e.item_type) e.item_type = 'lora'; // Default to 'lora' if missing
                        if (e.parent_id === undefined && e.item_type === 'lora') e.parent_id = null; // Default to top-level for lora if missing
                        if (e.item_type === 'lora' && e.display_name === undefined) e.display_name = "";
                        if (e.item_type === 'lora' && e.custom_text === undefined) e.custom_text = "";
                    });
                }

                if (obj.isLocked !== undefined) this.isLocked = obj.isLocked;
                if (obj.compactView !== undefined) this.compactView = obj.compactView;

                this.loraNameWidth = Math.max(10, Math.min(300, obj.loraNameWidth ?? 65));
                this.customTextWidth = Math.max(10, Math.min(300, obj.customTextWidth ?? 80));
                this.folderColor = obj.folderColor ?? "#30353c"; // Load folder color, or use default

            };
        }
	},
});
