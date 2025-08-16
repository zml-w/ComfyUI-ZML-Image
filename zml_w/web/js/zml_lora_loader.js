// 文件路径: ComfyUI-ZML-Image\zml_w\web\js\zml_lora_loader.js

import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";
import { api } from "/scripts/api.js";

const TARGET_LORA_LOADERS = ["ZmlLoraLoader", "ZmlLoraLoaderModelOnly", "ZmlLoraLoaderFive", "ZmlLoraMetadataParser"];
const ZML_API_PREFIX = "/zml/lora";
const IMAGE_WIDTH = 384;
const IMAGE_HEIGHT = 384;

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

app.registerExtension({
	name: "zml.LoraLoader.Final.v9", 
	init() {
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
		const displayOptions = { "树状(子文件夹)": 1, "列表(原始)": 0 };
		const displaySetting = app.ui.settings.addSetting({
			id: "zml.LoraLoader.DisplayMode", name: "LORA文件夹显示样式", defaultValue: 1, type: "combo",
			options: (value) => Object.entries(displayOptions).map(([k, v]) => ({ value: v, text: k, selected: v === +value })),
		});
		const initialLoad = loadImageList();
		const refreshComboInNodes = app.refreshComboInNodes;
		app.refreshComboInNodes = async function () {
			const r = await Promise.all([ refreshComboInNodes.apply(this, arguments), loadImageList().catch(() => {}) ]);
			return r[0];
		};

        this.imageHost = $el("img.zml-lora-image-preview");

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

		this.showImage = (relativeToEl) => {
			const bodyRect = document.body.getBoundingClientRect();
			if (!bodyRect) return;
			const { left, top, isLeft } = calculateImagePosition(relativeToEl, bodyRect);
			this.imageHost.style.left = `${left}px`; this.imageHost.style.top = `${top}px`;
			this.imageHost.classList.toggle("left", isLeft);
			mutationObserver.disconnect();
			document.body.appendChild(this.imageHost);
			mutationObserver.observe(document.body, { childList: true });
		};
		this.hideImage = () => {
			mutationObserver.disconnect();
			this.imageHost.remove();
			mutationObserver.observe(document.body, { childList: true });
		};

		const updateMenu = async (menu) => {
			await initialLoad.catch(console.error);
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
			if (displaySetting.value == 1) createTree();
			else for (const item of items) addImageHandler(item);
		};
		mutationObserver.observe(document.body, { childList: true });
	},
	async beforeRegisterNodeDef(nodeType, nodeData) {
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
                        
                        .zml-pll-entry-card.zml-pll-dragging { opacity: 0.5; background: #555; }
                        .zml-pll-entry-card.zml-pll-drag-over { border-top: 2px solid #5d99f2 !important; }
                        .zml-pll-drag-handle.locked { cursor: not-allowed !important; color: #666 !important; }
                        
                        .zml-pll-controls-top {
                            display: flex;
                            align-items: center;
                            justify-content: flex-start; /* 控件靠左对齐 */
                            gap: 6px; /* 控件之间间距 */
                            padding: 2px 0 6px 0; /* 调整顶部和底部内边距 */
                            border-bottom: 1px solid #444; /* 与列表分隔线 */
                            margin: 0 6px 6px 6px; /* 控制和节点外框的距离 */
                        }

                        .zml-pll-controls-bottom {
                            display: flex;
                            align-items: center;
                            justify-content: flex-end; /* 按钮靠右对齐 */
                            gap: 6px; 
                            margin: 0 6px 6px 6px; 
                            padding-top: 6px; 
                            border-top: 1px solid #444; 
                        }
                        .zml-pll-button {
                            padding: 8px 16px; 
                            height: 38px; /* 底部添加按钮高度 */
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

                        /* 顶部控制按钮和输入框的通用样式 */
                        .zml-control-btn-pll, .zml-control-input-pll {
                            height: 26px; /* 固定高度 */
                            padding: 0;
                            border: 1px solid #555;
                            border-radius: 2px;
                            background: #333;
                            color: #ccc;
                            font-size: 12px;
                            box-sizing: border-box; /* 包含padding和border在内 */
                            flex-shrink: 0; 
                        }
                        .zml-control-input-pll {
                            padding: 4px 8px; /* 内部填充 */
                            text-align: left;
                            width: 60px; /* 输入框固定宽度 */
                        }
                        .zml-control-btn-pll {
                            cursor: pointer;
                            text-align: center;
                            font-size: 14px; /* 图标稍大一点 */
                            line-height: 1;
                            width: 26px; /* 【 ZML 关键修改 】: 明确设置宽度为26px，使其成为正方形 */
                        }
                        .zml-control-btn-pll:hover {
                            background-color: #555;
                        }
                        .zml-control-btn-pll.locked {
                            background-color: #644; 
                        }

                        /* 统一标签样式 */
                        .zml-control-label-pll {
                            font-size: 12px; 
                            color: #ccc; 
                            flex-shrink: 0; 
                        }
                        /* 组合控件的容器 */
                        .zml-control-group-pll {
                            display: flex;
                            align-items: center;
                            gap: 4px; /* 标签和输入框之间的小间隔 */
                            flex-shrink: 0; 
                        } 

                        /* 【 ZML 修改 】: LoRA条目内部的名称输入框 */
                        .zml-lora-display-name-input {
                            /* min-width由外部调节器控制 */
                            padding: var(--pll-current-input-padding); 
                            height: var(--pll-current-input-height); 
                            background: #2b2b2b;
                            border: 1px solid #444;
                            border-radius: 2px;
                            color: #ccc;
                            font-size: 12px;
                            margin-right: 4px;
                            box-sizing: border-box;
                            flex-shrink: 0; /* 【 ZML 新增 】: 强制不缩小 */
                        }

                        /* 【 ZML 修改 】: LoRA条目内部的自定义文本输入框 */
                        .zml-lora-custom-text-input {
                            padding: var(--pll-current-input-padding);
                            /* width由外部调节器控制 */
                            height: var(--pll-current-input-height); 
                            background: #2b2b2b;
                            border: 1px solid #444;
                            border-radius: 2px;
                            color: #ccc;
                            font-size: 12px;
                            margin-right: 4px; 
                            box-sizing: border-box;
                            resize: none; 
                            overflow: auto; /* 【 ZML 修改 】: 允许文本框内部滚动 */
                            min-height: 26px; 
                            flex-shrink: 0; /* 【 ZML 新增 】: 强制不缩小 */
                        }
                        
                        /* 【 ZML 新增 】: 强力lora加载器列表容器的滚动条 */
                        .zml-pll-entries-list {
                            overflow: auto; /* 同时处理y和x轴的滚动 */
                            flex: 1; /* 保持 flex */
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            padding: 0; /* 由内部卡片处理padding */
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


                     if (!this.powerLoraLoader_data) {
                         this.powerLoraLoader_data = { entries: [
                             { id: "lora1", display_name: "", custom_text: "", lora_name: "None", weight: 1.0, enabled: true }] 
                         };
                     }
                     const dataWidget = this.addWidget("text", "lora_loader_data", JSON.stringify(this.powerLoraLoader_data), (v) => { try { if(v) this.powerLoraLoader_data = JSON.parse(v); } catch(e){} }, { serialize: true });
                     dataWidget.hidden = true; dataWidget.computeSize = () => [0, 0];
                     
                     const container = createEl("div"); 
                     container.style.cssText = `background: #2b2b2b; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; display: flex; flex-direction: column; padding: 6px;`; 

                     const topControls = createEl("div", { className: "zml-pll-controls-top" });
                     
                     // 名称宽度控件组
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

                     // 文本宽度控件组
                     const customTextWidthGroup = createEl("div", { className: "zml-control-group-pll" });
                     const customTextWidthLabel = createEl("span", { className: "zml-control-label-pll", textContent: "文本宽度" });
                     const customTextWidthInput = createEl("input", { className: "zml-control-input-pll" });
                     customTextWidthInput.type = "number";
                     customTextWidthInput.min = "10"; // 【 ZML 修改 】: 最小值为10
                     customTextWidthInput.max = "300"; 
                     customTextWidthInput.value = this.customTextWidth;
                     customTextWidthInput.title = "自定义文本框宽度 (像素)";
                     customTextWidthInput.oninput = (e) => {
                         let val = parseInt(e.target.value, 10);
                         if (isNaN(val)) val = 80;
                         val = Math.max(10, Math.min(300, val)); // 【 ZML 修改 】: 限制范围10-300
                         this.customTextWidth = val;
                         e.target.value = val; 
                         this.renderLoraEntries(); 
                         this.triggerSlotChanged();
                     };
                     customTextWidthGroup.append(customTextWidthLabel, customTextWidthInput);
                     topControls.appendChild(customTextWidthGroup); 

                     // 锁定按钮
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

                     // 尺寸切换按钮
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

                     // 【 ZML 修改 】: 添加 zml-pll-entries-list 类名
                     const entriesList = createEl("div", { className: "zml-pll-entries-list" }); 
                     
                     const bottomControls = createEl("div", { className: "zml-pll-controls-bottom" });

                     const newLoraBtn = createEl("button", { className: "zml-pll-button zml-pll-button-lg", textContent: "＋ 添加 Lora" });
                     newLoraBtn.onclick = () => { 
                        this.powerLoraLoader_data.entries.push({ id: "lora" + Date.now(), display_name: "", custom_text: "", lora_name: "None", weight: 1.0, enabled: true }); 
                        this.renderLoraEntries(); 
                        this.triggerSlotChanged(); 
                    };
                     bottomControls.appendChild(newLoraBtn); 

                     this.stylesPLL = {
                        normal: {
                            cardPadding: "4px",
                            inputPadding: "4px 8px", 
                            inputHeight: "28px", 
                            checkboxScale: "1.5",
                        },
                        compact: {
                            cardPadding: "2px",
                            inputPadding: "2px 6px",
                            inputHeight: "22px", 
                            checkboxScale: "1.2",
                        }
                    };

                     this.applySizeMode = () => {
                        const s = this.compactView ? this.stylesPLL.compact : this.stylesPLL.normal;
                        entriesList.style.setProperty('--pll-current-input-height', s.inputHeight);
                        entriesList.style.setProperty('--pll-current-input-padding', s.inputPadding);
                        this.renderLoraEntries();
                     };

                     this.renderLoraEntries = () => {
                         const s = this.compactView ? this.stylesPLL.compact : this.stylesPLL.normal; 

                         entriesList.innerHTML = "";
                         this.powerLoraLoader_data.entries.forEach((entry, index) => {
                             const entryCard = createEl("div", { 
                                className: "zml-pll-entry-card",
                                style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${entry.enabled ? '#3a3a3a' : '#2a2a2a'}; border-radius: 2px;`
                             });
                             entryCard.dataset.index = index;

                             const checkbox = createEl("input", { type: "checkbox", checked: entry.enabled, style: `transform: scale(${s.checkboxScale}); flex-shrink: 0; margin-right: 4px;` });
                             checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderLoraEntries(); this.triggerSlotChanged(); };
                             
                             const dragHandle = createEl("div", { 
                                 className: "zml-pll-drag-handle",
                                 textContent: "☰",
                                 style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: 14px;`
                             });
                             dragHandle.draggable = !this.isLocked; 
                             if (this.isLocked) {
                                 dragHandle.classList.add("locked");
                             } else {
                                 dragHandle.classList.remove("locked");
                             }

                             const displayNameInput = createEl("input", { className: "zml-lora-display-name-input" });
                             displayNameInput.type = "text";
                             displayNameInput.value = entry.display_name;
                             displayNameInput.placeholder = "输入名称...";
                             displayNameInput.title = "自定义此LoRA条目的显示名称";
                             displayNameInput.style.cssText += `width: ${this.loraNameWidth}px;`;
                             displayNameInput.oninput = (e) => { entry.display_name = e.target.value; this.triggerSlotChanged(); };

                             const loraSelectorBtn = createEl("button", {
                                 style: `flex-grow: 1; min-width: 100px; padding: ${s.inputPadding}; background: #222; border: 1px solid #555; border-radius: 2px; color: #ccc; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: ${s.inputHeight};`,
                                 textContent: entry.lora_name === "None" ? "None" : entry.lora_name.split(/[/\\]/).pop(),
                             });
                              loraSelectorBtn.onclick = () => { if (activeLoraMenu) activeLoraMenu.close(); activeLoraMenu = this.createLoraTreeMenu(loraSelectorBtn, entry, () => { 
                                 loraSelectorBtn.textContent = entry.lora_name === "None" ? "None" : entry.lora_name.split(/[/\\]/).pop(); 
                                 this.triggerSlotChanged(); 
                              }); };
                             
                              const weightWidget = createEl("div", { 
                                style: `display: flex; align-items: center; justify-content: center; gap: 4px; background: #222; border: 1px solid #555; border-radius: 2px; padding: 2px 4px; height: ${s.inputHeight};` 
                             });
                             const decBtn = createEl("button", { style: "background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%;"}, "<");
                             const weightDisplay = createEl("span", { style: "min-width: 32px; text-align: center; color: #ddd;" }, entry.weight.toFixed(2));
                             const incBtn = createEl("button", { style: "background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%;"}, ">");
                             decBtn.onclick = () => { entry.weight = Math.max(-10, parseFloat((entry.weight - 0.05).toFixed(2))); weightDisplay.textContent = entry.weight.toFixed(2); this.triggerSlotChanged(); };
                             incBtn.onclick = () => { entry.weight = Math.min(10, parseFloat((entry.weight + 0.05).toFixed(2))); weightDisplay.textContent = entry.weight.toFixed(2); this.triggerSlotChanged(); };
                             weightWidget.append(decBtn, weightDisplay, incBtn);

                             const customTextInput = createEl("textarea", { className: "zml-lora-custom-text-input" });
                             customTextInput.value = entry.custom_text || ""; 
                             customTextInput.placeholder = "输入文本";
                             customTextInput.title = "LoRA 的自定义文本内容";
                             customTextInput.style.cssText += `width: ${this.customTextWidth}px;`;
                             customTextInput.oninput = (e) => { entry.custom_text = e.target.value; this.triggerSlotChanged(); };

                             const deleteBtn = createEl("button", { 
                                style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;`
                             }, "X");
                             deleteBtn.onclick = () => { this.powerLoraLoader_data.entries.splice(index, 1); this.renderLoraEntries(); this.triggerSlotChanged(); };
                             
                             if (!this.isLocked) {
                                 entryCard.ondragstart = (e) => {
                                     // 确保只有拖动手柄开始的拖动才有效，并且不是在文本框内拖动
                                     if (e.target !== dragHandle && !e.target.classList.contains('zml-lora-display-name-input') && !e.target.classList.contains('zml-lora-custom-text-input')) { 
                                         e.preventDefault(); 
                                         return; 
                                     }
                                     e.dataTransfer.setData("text/plain", index);
                                     setTimeout(() => e.currentTarget.classList.add("zml-pll-dragging"), 0);
                                 };
                                 entryCard.ondragover = (e) => {
                                     e.preventDefault();
                                     if (document.querySelector(".zml-pll-dragging") && document.querySelector(".zml-pll-dragging") !== e.currentTarget) {
                                         e.currentTarget.classList.add("zml-pll-drag-over");
                                     }
                                 };
                                 entryCard.ondragleave = (e) => { e.currentTarget.classList.remove("zml-pll-drag-over"); };
                                 entryCard.ondrop = (e) => {
                                     e.preventDefault();
                                     e.currentTarget.classList.remove("zml-pll-drag-over");
                                     const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                                     const toIndex = index;
                                     if (fromIndex !== toIndex) {
                                         const itemToMove = this.powerLoraLoader_data.entries.splice(fromIndex, 1)[0];
                                         this.powerLoraLoader_data.entries.splice(toIndex, 0, itemToMove);
                                         this.renderLoraEntries();
                                         this.triggerSlotChanged();
                                     }
                                 };
                                 entryCard.ondragend = (e) => { e.currentTarget.classList.remove("zml-pll-dragging"); };
                             } else { 
                                 entryCard.ondragstart = entryCard.ondragover = entryCard.ondragleave = entryCard.ondrop = entryCard.ondragend = null;
                             }

                             entryCard.append(checkbox, dragHandle, displayNameInput, loraSelectorBtn, weightWidget, customTextInput, deleteBtn);
                             entriesList.appendChild(entryCard);
                         });
                         app.graph.setDirtyCanvas(true, true);
                     };
                     
                     container.append(topControls, entriesList, bottomControls); 
                     this.addDOMWidget("power_lora_loader_ui", "div", container, { serialize: false });
                     
                     const topAreaContentHeight = 26; 
                     const topControlPadding = 2 + 6; 
                     const topControlTotalHeight = topAreaContentHeight + topControlPadding; 
                     const bottomControlTotalHeight = 38 + 6; 
                     const minEntryHeight = this.stylesPLL.normal.inputHeight.replace('px','') * 1 + this.stylesPLL.normal.cardPadding.replace('px','') * 2; 
                     const initialMinHeight = (this.widgets_always_on_top?.[0]?.last_y || 0) + topControlTotalHeight + minEntryHeight + bottomControlTotalHeight + 12; 

                     this.size = [Math.max(this.size[0] || 0, 350), Math.max(this.size[1] || 0, initialMinHeight)]; 

                     const origOnResize = this.onResize;
                     this.onResize = function(size) { 
                         size[0] = Math.max(size[0], 350); 
                         const currentMinEntryHeight = (this.compactView ? this.stylesPLL.compact : this.stylesPLL.normal).inputHeight.replace('px','') * Math.min(this.powerLoraLoader_data.entries.length, 1) + 
                                                      (this.compactView ? this.stylesPLL.compact : this.stylesPLL.normal).cardPadding.replace('px','') * 2;
                         const dynamicMinHeight = (this.widgets_always_on_top?.[0]?.last_y || 0) + topControlTotalHeight + currentMinEntryHeight + bottomControlTotalHeight + 12; 
                         size[1] = Math.max(size[1], dynamicMinHeight); 
                         this.size = size; 
                         // 【 ZML 新增 】：节点整体的滚动条
                         // 对于节点而言，它的内容就是它所包含的widget，包括这个自定义DOMWidget
                         // 这里通过调整 `overflow` 属性来控制DOM元素的滚动条
                         const domElement = this.domElement; // 获取到实际的DOM元素
                         if (domElement) {
                            if (size[1] < domElement.scrollHeight || size[0] < domElement.scrollWidth) {
                                domElement.style.overflow = "auto";
                            } else {
                                domElement.style.overflow = "hidden"; // 或者 'visible'
                            }
                         }

                         if (origOnResize) origOnResize.call(this, size); 
                     };

                     this.triggerSlotChanged = () => { dataWidget.value = JSON.stringify(this.powerLoraLoader_data); this.setDirtyCanvas(true, true); };
                     
                     this.applySizeMode(); 

                 } catch (error) { console.error("ZML_PowerLoraLoader: UI初始化错误:", error); }
                 return r;
            };
            
            nodeType.prototype.createLoraTreeMenu = function(button, entry, onSelect) {
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
            };
            
            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(obj) {
                origOnConfigure?.apply(this, arguments);
                if (obj.powerLoraLoader_data) {
                    this.powerLoraLoader_data = obj.powerLoraLoader_data;
                } else if (obj.widgets_values?.[0] && typeof obj.widgets_values[0] === 'string') { 
                    try { 
                        const data = JSON.parse(obj.widgets_values[0]); 
                        if (data && Array.isArray(data.entries)) {
                            // 兼容旧数据，添加缺失的字段
                            data.entries.forEach(entry => {
                                if (entry.display_name === undefined) {
                                    entry.display_name = "";
                                }
                                if (entry.custom_text === undefined) { 
                                    entry.custom_text = "";
                                }
                            });
                        }
                        if (data) this.powerLoraLoader_data = data; 
                    } catch(e) {} 
                }

                if (obj.isLocked !== undefined) this.isLocked = obj.isLocked;
                if (obj.compactView !== undefined) this.compactView = obj.compactView;
                
                // 加载时最小值为10
                if (obj.loraNameWidth !== undefined) {
                     this.loraNameWidth = Math.max(10, Math.min(300, obj.loraNameWidth)); 
                } else {
                     this.loraNameWidth = 65;
                }
                if (obj.customTextWidth !== undefined) {
                    this.customTextWidth = Math.max(10, Math.min(300, obj.customTextWidth));
                } else {
                    this.customTextWidth = 80; // Default remains 80 as per last request
                }

                if (this.powerLoraLoader_initialized && this.applySizeMode) { 
                    setTimeout(() => {
                        // 更新锁定按钮的显示
                        const lockButton = this.domElement.querySelector("button.zml-control-btn-pll[title='锁定/解锁 LoRA 排序']");
                        if (lockButton) {
                            lockButton.textContent = this.isLocked ? "🔒" : "🔓";
                            lockButton.style.background = this.isLocked ? '#644' : '#333';
                        }
                        // 更新名称宽度输入框的显示
                        const loraNameWidthInputElement = this.domElement.querySelector("input.zml-control-input-pll[type='number']");
                        if (loraNameWidthInputElement) {
                            loraNameWidthInputElement.value = this.loraNameWidth;
                        }
                        // 更新自定义文本宽度输入框的显示
                        const allNumberInputs = this.domElement.querySelectorAll("input.zml-control-input-pll[type='number']");
                        const customTextWidthInputElement = allNumberInputs[1]; 
                        if (customTextWidthInputElement) {
                            customTextWidthInputElement.value = this.customTextWidth;
                        }

                        this.applySizeMode(); 
                    }, 10);
                }
            };
        }
	},
});
