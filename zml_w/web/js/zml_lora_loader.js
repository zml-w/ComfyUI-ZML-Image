import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";
import { api } from "/scripts/api.js";

// ZML 关键改动: 将所有目标节点名称加入数组
const TARGET_LORA_LOADERS = ["ZmlLoraLoader", "ZmlLoraLoaderModelOnly", "ZmlLoraLoaderFive"];
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
	name: "zml.LoraLoader.Final.v9", // Renamed to ensure it's fresh
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

		const imageHost = $el("img.zml-lora-image-preview");
		const observerConfig = { childList: true };
		const mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const added of mutation.addedNodes) {
					if (added.classList?.contains("litecontextmenu")) {
						const widget = app.canvas.getWidgetAtCursor();
						// ZML 关键改动: 检查当前节点的 comflyClass 和 widget 名称
						const widgetName = widget?.name;
						if (TARGET_LORA_LOADERS.includes(app.canvas.current_node?.comfyClass) && (widgetName?.startsWith("lora_name") || widgetName?.startsWith("lora_"))) {
							requestAnimationFrame(() => updateMenu(added));
						}
						return;
					}
				}
			}
		});

		const showImage = (relativeToEl) => {
			const bodyRect = document.body.getBoundingClientRect();
			if (!bodyRect) return;
			const { left, top, isLeft } = calculateImagePosition(relativeToEl, bodyRect);
			imageHost.style.left = `${left}px`; imageHost.style.top = `${top}px`;
			imageHost.classList.toggle("left", isLeft);
			mutationObserver.disconnect();
			document.body.appendChild(imageHost);
			mutationObserver.observe(document.body, observerConfig);
		};
		const hideImage = () => {
			mutationObserver.disconnect();
			imageHost.remove();
			mutationObserver.observe(document.body, observerConfig);
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
						imageHost.src = `${ZML_API_PREFIX}/view/${encodeRFC3986URIComponent(fullViewPath)}?${+new Date()}`;
						showImage(item);
					});
					item.addEventListener("mouseout", hideImage);
					item.addEventListener("click", hideImage);
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
		mutationObserver.observe(document.body, observerConfig);
	},
	async beforeRegisterNodeDef(nodeType, nodeData) {
        // ZML 关键改动: 检查节点名称是否在我们的目标数组中
		if (TARGET_LORA_LOADERS.includes(nodeData.name)) {
			// This logic is for the original loaders
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

			// This applies the "Save as Lora Preview" to all target nodes
			const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
			nodeType.prototype.getExtraMenuOptions = function (_, options) {
				getExtraMenuOptions?.apply(this, arguments);
				if (this.imgs && this.imgs.length > 0) {
					// ZML 关键改动: 使用 flatMap 查找所有类型的 lora 加载器节点
					const otherLoraNodes = TARGET_LORA_LOADERS.flatMap(name => app.graph.findNodesByType(name))
						.filter(n => n.id !== this.id); 
					
					const uniqueNodes = [...new Map(otherLoraNodes.map(item => [item.id, item])).values()];

					if (uniqueNodes.length) {
						options.unshift({
							content: "Save as Lora Preview (ZML)",
							submenu: {
								options: uniqueNodes.flatMap(n => {
									// Handle single lora loaders
									if(n.comfyClass === "ZmlLoraLoader" || n.comfyClass === "ZmlLoraLoaderModelOnly") {
										const widget = n.widgets.find(w => w.name === "lora_name");
										if (!widget || !widget.value || widget.value === "None") return [];
										return {
											content: widget.value,
											callback: () => this.savePreviewForLora(widget.value),
										};
									}
									// Handle 5-in-1 lora loader
									if(n.comfyClass === "ZmlLoraLoaderFive") {
										return n.widgets.filter(w => w.name.startsWith("lora_") && w.value && w.value !== "None").map(w => ({
											content: w.value,
											callback: () => this.savePreviewForLora(w.value),
										}));
									}
									return [];
								}).filter(Boolean), // Filter out any empty results
								className: "zml-lora-save-submenu",
							},
						});
					}
				}
			};
			
			// Helper function to save previews
			nodeType.prototype.savePreviewForLora = async function(loraName) {
				const img = this.imgs[0];
				const url = new URL(img.src);
				await api.fetchApi(`${ZML_API_PREFIX}/save/loras/${encodeRFC3986URIComponent(loraName)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						filename: url.searchParams.get("filename"),
						subfolder: url.searchParams.get("subfolder"),
						type: url.searchParams.get("type") || "output",
					}),
				});
				await loadImageList();
			}
		}
	},
});