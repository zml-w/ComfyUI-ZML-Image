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
const POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST = 300; // 根据实际测试调整，确保底部按钮不被裁切

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
    try {
        console.log("[ZML] Loading lora image list...");
        loraImages = await (await api.fetchApi(`${ZML_API_PREFIX}/images/loras`)).json();
        // console.log("[ZML] loraImages loaded:", loraImages); // 调试用
    } catch (e) {
        console.error("[ZML] Error loading lora images:", e);
        loraImages = {}; // 确保在加载失败时清空，避免无效缓存
    }
};

/**
 * 调整颜色的亮度。
 * @param {string} hex - 十六进制颜色字符串 (e.g., "#RRGGBB").
 * @param {number} percent - 调整百分比 (-100 到 100).
 * @param {number} saturationBoost - 调整饱和度百分比 (-100 到 100).
 * @returns {string} 调整后的十六进制颜色字符串.
 */
function adjustBrightness(hex, percent, saturationBoost = 0) {
    hex = hex.replace(/^#/, '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // Convert RGB to HSL for saturation adjustment
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    // Adjust brightness (l)
    l = Math.max(0, Math.min(1, l + percent / 100)); // Clamp L to [0, 1]
    // Adjust saturation (s)
    s = Math.max(0, Math.min(1, s + saturationBoost / 100)); // Clamp S to [0, 1]


    // Convert HSL back to RGB
    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    let p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);

    const toHex = (c) => ('0' + Math.round(c * 255).toString(16)).slice(-2);
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
				.litecontextmenu:has(input:not(:placeholder-shown)) .zml-lora-folder-contents { display: block !important; }
				.litecontextmenu:has(input:not(:placeholder-shown)) .zml-lora-folder { display: none; } .litecontextmenu:has(input:not(:placeholder-shown)) .zml-lora-prefix { display: inline; }
				.litecontextmenu:has(input:not(:placeholder-shown)) .litemenu-entry { padding-left: 2px !important; }

                /* === 按钮视觉反馈 CSS 样式 (新增/修改) === */
                /* 通用按钮基础样式 */
                .zml-control-btn-pll, .zml-pll-button,
                .zml-pll-folder-delete, .zml-lora-entry-delete, /* Added .zml-lora-entry-delete class */
                .zml-batch-lora-modal-container button,
                .zml-weight-btn, /* New class for weight buttons */
                .zml-batch-lora-fetch-from-civitai-btn, /* Civitai fetch button */
                .zml-batch-lora-all-loras-btn /* "全部" Lora button */
                {
                    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.05s ease, box-shadow 0.15s ease;
                }
                /* 通用按钮 hover 状态 */
                .zml-control-btn-pll:hover, .zml-pll-button:hover,
                .zml-batch-lora-modal-container button:hover,
                .zml-weight-btn:hover, /* Weight buttons hover */
                .zml-batch-lora-fetch-from-civitai-btn:hover, /* Civitai fetch button hover */
                .zml-batch-lora-all-loras-btn:hover /* "全部" Lora button hover */
                {
                    background-color: #555 !important;
                    border-color: #777 !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                /* 通用按钮 active 状态 */
                .zml-control-btn-pll:active, .zml-pll-button:active,
                .zml-batch-lora-modal-container button:active,
                .zml-weight-btn:active, /* Weight buttons active */
                .zml-batch-lora-all-loras-btn:active /* "全部" Lora button active */
                {
                    transform: translateY(1px);
                    box-shadow: 0 1px 4px rgba(0,0,0,0.2) inset;
                }
                /* Lock button specific feedback */
                .zml-control-btn-pll[title*="锁定"]:hover { background-color: #754 !important; } /* If locked, hover is darker red */
                .zml-control-btn-pll[title*="锁定"]:active { background-color: #865 !important; } 

                /* Delete buttons specific feedback */
                .zml-pll-folder-delete:hover, .zml-lora-entry-delete:hover { 
                    background-color: #f44336 !important; /* Red background on hover */
                    border-color: #da190b !important; 
                    color: white !important; 
                    box-shadow: 0 2px 8px rgba(244, 67, 54, 0.4);
                }
                .zml-pll-folder-delete:active, .zml-lora-entry-delete:active { 
                    background-color: #da190b !important; /* Darker red on click */
                    transform: translateY(1px);
                    box-shadow: 0 1px 4px rgba(244, 67, 54, 0.3) inset;
                }

                /* Civitai fetch button (specific style) */
                .zml-batch-lora-fetch-from-civitai-btn {
                    position: absolute;
                    top: 5px; /* Adjust as needed */
                    left: 5px; /* Adjust as needed */
                    width: 24px;
                    height: 24px;
                    background-color: rgba(60, 100, 170, 0.8); /* Darker blue color */
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    font-weight: bold;
                    cursor: pointer;
                    z-index: 10; /* Ensure it's above image */
                    border: 1px solid rgba(40, 80, 140, 0.8);
                }
                .zml-batch-lora-fetch-from-civitai-btn.fetching {
                    background-color: rgba(100, 100, 100, 0.8); /* Grey out during fetching */
                    cursor: wait;
                }
                .zml-batch-lora-fetch-from-civitai-btn:hover:not(.fetching) {
                    background-color: rgba(70, 110, 180, 0.9) !important;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.4);
                }
                .zml-batch-lora-fetch-from-civitai-btn:active:not(.fetching) {
                    transform: translateY(1px);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3) inset;
                }


                /* Checkbox visual feedback */
                input[type="checkbox"] {
                    cursor: pointer;
                    --checkbox-background: #444;
                    --checkbox-border: #666;
                    --checkbox-checkmark: white;
                    appearance: none;
                    width: 1.25em;
                    height: 1.25em;
                    border-radius: 3px;
                    border: 1px solid var(--checkbox-border);
                    background-color: var(--checkbox-background);
                    display: inline-grid;
                    place-content: center;
                    transition: all 0.15s ease;
                    position: relative;
                }
                input[type="checkbox"]::before {
                    content: "";
                    width: 0.65em;
                    height: 0.65em;
                    transform: scale(0);
                    transition: transform 0.15s ease;
                    box-shadow: inset 1em 1em var(--checkbox-checkmark);
                    clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
                }
                input[type="checkbox"]:checked::before {
                    transform: scale(1);
                }
                input[type="checkbox"]:hover {
                    border-color: #5d99f2;
                    box-shadow: 0 0 5px rgba(93, 153, 242, 0.4);
                }
                input[type="checkbox"]:checked:hover {
                    border-color: #4CAF50;
                    box-shadow: 0 0 5px rgba(76, 175, 80, 0.4);
                }
                input[type="checkbox"]:checked {
                    background-color: #4CAF50;
                    border-color: #4CAF50;
                }
                /* End Checkbox */

                .zml-lora-display-name-input, .zml-lora-weight-input, .zml-lora-custom-text-input {
                    transition: border-color 0.2s, box-shadow 0.2s;
                    border: 1px solid #444; /* Ensure inputs have consistent border */
                    background-color: #2b2b2b; /* Ensure inputs have consistent background */
                }
                .zml-lora-display-name-input:focus, .zml-lora-weight-input:focus, .zml-lora-custom-text-input:focus {
                    border-color: #5d99f2 !important;
                    box-shadow: 0 0 5px rgba(93, 153, 242, 0.4);
                    outline: none;
                }
            /* End of new CSS styles */
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
            // console.log("app.refreshComboInNodes called, refreshing lora list and images..."); // 调试用
            // 确保先更新 LoRA 列表，然后再加载图片，因为图片路径可能依赖于最新的 LoRA 列表
			// 由于 loadImageList是独立获取的，与 refreshComboInNodes 可能不完全同步，这里await确保了图片列表会得到更新
			const r = await Promise.all([ refreshComboInNodes.apply(this, arguments), loadImageList().catch((e) => console.error("Error loading lora images:", e)) ]);
			return r[0]; // 返回原始 refreshComboInNodes 的结果
		};
		// 保存首次加载的 Promise，以便在 setup 中等待
		this.zmlLoraInitialLoad = loadImageList(); // 首次加载 LoRA 图片

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
				// The image path structure for /view API: /zml/lora/view/loras/subdir/image.ext
				// loraImages[text] would store "subdir/image.ext" if it exists.
				if (text && loraImages[text]) {
					item.addEventListener("mouseover", () => {
						const imagePath = loraImages[text]; // This is like "subdir/zml/lora_name.png"
						// The /view API expects "loras/subdir/image.ext" from the client.
						// The imagePath from loraImages might already be adjusted by the backend (e.g. from get_images)
						// So we remove "zml/" prefix if it's there for accurate path.
						const cleanedImagePath = imagePath.startsWith('zml/') ? imagePath.substring(loraImages['zml/'.length]) : imagePath;
						const fullViewPath = `loras/${cleanedImagePath}`; // Ensure correct path for /view API
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
				await loadImageList(); // 重新加载图片列表以更新缓存
			}
		}

        if (nodeData.name === "ZmlPowerLoraLoader") {
            // --- 修复：重新添加 createEl 函数以确保局部作用域可见性 ---
            // 注意：这个 createEl 只有两个参数（tag, properties），与文件顶部全局的 createEl 不同
            // 但这符合 ZmlPowerLoraLoader 内部原有的使用方式。
            function createEl(tag, properties = {}, text = "") {
                const el = document.createElement(tag);
                Object.assign(el, properties);
                if (text) el.textContent = text;
                return el;
            }
            // --- 修复结束 ---

            let zmlPllModalOverlay = null;
            let zmlPllModalTextarea = null;
            let zmlPllModalTitle = null;
            let zmlPllCurrentEditingEntry = null; // 存储当前正在编辑的LoRA条目对象引用
            let zmlPllCurrentNodeInstance = null; // 存储当前正在编辑的节点实例引用

            function createPllEditContentModal() {
                if (zmlPllModalOverlay) return; // 确保只创建一次

                zmlPllModalOverlay = createEl("div", {
                    className: "zml-st3-modal-overlay", // 使用与文本节点相同的类名，保持样式一致
                    style: `
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background-color: rgba(0, 0, 0, 0.75);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10000;
                        display: none; /* 默认隐藏 */
                        backdrop-filter: blur(3px);
                    `
                });

                const modalContainer = createEl("div", {
                    className: "zml-st3-modal-container", // 使用与文本节点相同的类名
                    style: `
                        background-color: #31353a;
                        border: 1px solid #4a515a;
                        border-radius: 8px;
                        padding: 20px;
                        min-width: 550px;
                        max-width: 80vw;
                        max-height: 80vh;
                        display: flex;
                        flex-direction: column;
                        gap: 15px;
                        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6);
                        position: relative;
                    `
                });

                zmlPllModalTitle = createEl("h3", {
                    className: "zml-st3-modal-title", // 使用与文本节点相同的类名
                    style: `
                        color: #e0e0e0;
                        margin: 0;
                        font-size: 1.3em;
                        border-bottom: 2px solid #4a515a;
                        padding-bottom: 15px;
                        text-align: center;
                        font-weight: 600;
                    `,
                    textContent: "LoRA 自定义文本" // 默认标题，将在 showPllEditContentModal 中更新
                });

                zmlPllModalTextarea = createEl("textarea", {
                    className: "zml-st3-modal-textarea", // 使用与文本节点相同的类名
                    style: `
                        width: 100%;
                        height: 350px;
                        resize: vertical;
                        background-color: #1a1a1a;
                        border: 1px solid #4a4a4a;
                        color: #f0f0f0;
                        padding: 12px;
                        font-family: 'Segoe UI Mono', 'Consolas', monospace;
                        font-size: 14px;
                        border-radius: 4px;
                        box-sizing: border-box;
                        outline: none;
                        transition: border-color 0.2s, box-shadow 0.2s;
                    `
                });
                zmlPllModalTextarea.onfocus = (e) => {
                    e.target.style.borderColor = '#5d99f2';
                    e.target.style.boxShadow = '0 0 8px rgba(93, 153, 242, 0.4)';
                };
                zmlPllModalTextarea.onblur = (e) => {
                    e.target.style.borderColor = '#4a4a4a';
                    e.target.style.boxShadow = 'none';
                };

                const buttonGroup = createEl("div", {
                    className: "zml-st3-modal-buttons", // 使用与文本节点相同的类名
                    style: `
                        display: flex;
                        justify-content: flex-end;
                        gap: 12px;
                        padding-top: 10px;
                    `
                });

                const baseButtonStyle = `
                    height: 38px;
                    padding: 0 25px;
                    text-align: center;
                    text-decoration: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 15px;
                    font-weight: 500;
                    border-radius: 5px;
                    cursor: pointer;
                    white-space: nowrap;
                `;

                const saveButton = createEl("button", {
                    className: "zml-control-btn zml-st3-modal-save",
                    textContent: "保存",
                    style: `
                        ${baseButtonStyle}
                        background-color: #4CAF50;
                        border: 1px solid #3e8e41;
                        color: white;
                    `
                });
                
                const cancelButton = createEl("button", {
                    className: "zml-control-btn zml-st3-modal-cancel",
                    textContent: "取消",
                    style: `
                        ${baseButtonStyle}
                        background-color: #f44336;
                        border: 1px solid #da190b;
                        color: white;
                    `
                });

                buttonGroup.append(cancelButton, saveButton);
                modalContainer.append(zmlPllModalTitle, zmlPllModalTextarea, buttonGroup);
                zmlPllModalOverlay.appendChild(modalContainer);
                document.body.appendChild(zmlPllModalOverlay);

                // 绑定事件
                saveButton.onclick = () => {
                    if (zmlPllCurrentEditingEntry && zmlPllCurrentNodeInstance) {
                        zmlPllCurrentEditingEntry.custom_text = zmlPllModalTextarea.value; // 保存到 custom_text
                        zmlPllCurrentNodeInstance.triggerSlotChanged(); // 触发当前节点的更新
                    }
                    hidePllEditContentModal();
                };

                cancelButton.onclick = () => {
                    hidePllEditContentModal();
                };
                
                // 点击背景关闭
                zmlPllModalOverlay.onclick = (e) => {
                    if (e.target === zmlPllModalOverlay) {
                        hidePllEditContentModal();
                    }
                };
            }

            function showPllEditContentModal(entry, nodeInstance) {
                if (!zmlPllModalOverlay) createPllEditContentModal();
                
                zmlPllCurrentEditingEntry = entry;
                // 确保我们引用的是 LoRA 条目本身，而不是整个 Entries 数组
                zmlPllCurrentNodeInstance = nodeInstance;
                zmlPllModalTextarea.value = entry.custom_text; // 加载 custom_text
                // 标题显示 LoRA 名称 (display_name 或者 lora_name)
                // 确保 lora_name 在切割路径前是字符串
                const loraNameForTitle = entry.lora_name === "None" ? "" : (entry.lora_name || "").split(/[/\\]/).pop();
                zmlPllModalTitle.textContent = `LoRA 自定义文本: ${entry.display_name || loraNameForTitle || "(未命名 LoRA)"}`;
                zmlPllModalOverlay.style.display = 'flex';
                zmlPllModalTextarea.focus();
            }

            function hidePllEditContentModal() {
                if (zmlPllModalOverlay) {
                    zmlPllModalOverlay.style.display = 'none';
                    zmlPllCurrentEditingEntry = null;
                    zmlPllCurrentNodeInstance = null;
                }
            }
            // --- 结束：新增独立弹窗变量和函数 ---

            // --- 新增：批量添加 LoRA 弹窗的变量和函数 ---
            let zmlBatchLoraModalOverlay = null;
            let zmlBatchLoraParentPathDisplay = null; // 显示当前路径
            let zmlBatchLoraFoldersPanel = null; // 文件夹显示面板
            let zmlBatchLoraGridContainer = null;
            let zmlBatchLoraSelectedCountDisplay = null; // 用于显示选中数量
            let zmlBatchLoraCurrentNodeInstance = null;
            
            // 使用特殊字符串作为“显示所有”的路径标识
            const ALL_LORAS_VIEW_PATH = '__ALL_LORAS_VIEW__'; 
            let zmlBatchLoraCurrentPath = []; 
            let zmlBatchLoraSelected = new Set(); // 存储选中的 LoRA 的 fullpath

            function createBatchLoraModal() {
                if (zmlBatchLoraModalOverlay) return;

                zmlBatchLoraModalOverlay = createEl("div", {
                    className: "zml-batch-lora-modal-overlay",
                    style: `
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background-color: rgba(0, 0, 0, 0.75);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10001; /* 确保高于其他模态框 */
                        display: none;
                        backdrop-filter: blur(3px);
                    `
                });

                const modalContainer = createEl("div", {
                    className: "zml-batch-lora-modal-container",
                    style: `
                        background-color: #31353a;
                        border: 1px solid #4a515a;
                        border-radius: 8px;
                        padding: 15px;
                        min-width: 700px;
                        max-width: 90vw;
                        height: 80vh; /* 固定高度 */
                        display: flex;
                        flex-direction: column;
                        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6);
                        position: relative;
                    `
                });

                const modalHeader = createEl("h3", {
                    textContent: "批量添加 LoRA",
                    style: `color: #e0e0e0; margin: 0 0 15px 0; font-size: 1.4em; text-align: center; border-bottom: 1px solid #4a515a; padding-bottom: 10px;`
                });

                zmlBatchLoraParentPathDisplay = createEl("div", { // 用于显示面包屑导航
                    style: `
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 5px;
                        color: #888;
                        min-height: 24px; /* 保证高度，避免内容为空时塌陷 */
                    `
                });

                zmlBatchLoraFoldersPanel = createEl("div", { // 用于显示子文件夹列表
                    style: `
                        display: flex;
                        flex-wrap: wrap;
                        gap: 8px;
                        min-height: 30px; /* 保证高度 */
                        padding: 5px 0 10px 0;
                        border-bottom: 1px solid #3c3c3c;
                        margin-bottom: 15px;
                        align-items: center;
                        max-width: 100%; /* 确保在小窗口下也正常换行 */
                        overflow-x: auto; /* 如果文件夹过多，允许水平滚动 */
                    `
                });

                zmlBatchLoraGridContainer = createEl("div", {
                    className: "zml-batch-lora-grid",
                    style: `
                        flex: 1; /* 占据剩余空间 */
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); /* 响应式网格 */
                        gap: 10px;
                        overflow-y: auto; /* 允许滚动 */
                        padding: 5px;
                        border: 1px solid #444;
                        border-radius: 4px;
                        background-color: #2b2b2b;
                    `
                });

                const modalFooter = createEl("div", {
                    style: `display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 15px; border-top: 1px solid #4a515a; margin-top: 15px;`
                });

                // 选中数量显示
                zmlBatchLoraSelectedCountDisplay = createEl("span", {
                    textContent: `已选择 0 个 LoRA`,
                    style: `color: #e0e0e0; font-size: 14px;`
                });
                modalFooter.appendChild(zmlBatchLoraSelectedCountDisplay);

                const buttonGroupRight = createEl("div", {
                    style: `display: flex; gap: 12px;`
                });

                const addSelectedBtn = createEl("button", {
                    textContent: "添加选中 LoRA",
                    className: "zml-control-btn zml-st3-modal-save", // 复用样式
                    style: `height: 38px; padding: 0 25px; font-size: 15px;`
                });
                addSelectedBtn.onclick = () => {
                    handleBatchAddLora(); // 调用新的处理函数
                };

                const closeBtn = createEl("button", {
                    textContent: "关闭",
                    className: "zml-control-btn zml-st3-modal-cancel", // 复用样式
                    style: `height: 38px; padding: 0 25px; font-size: 15px;`
                });
                closeBtn.onclick = hideBatchLoraModal;

                buttonGroupRight.append(addSelectedBtn, closeBtn);
                modalFooter.appendChild(buttonGroupRight);

                modalContainer.append(modalHeader, zmlBatchLoraParentPathDisplay, zmlBatchLoraFoldersPanel, zmlBatchLoraGridContainer, modalFooter);
                zmlBatchLoraModalOverlay.appendChild(modalContainer);
                document.body.appendChild(zmlBatchLoraModalOverlay);

                zmlBatchLoraModalOverlay.onclick = (e) => {
                    if (e.target === zmlBatchLoraModalOverlay) {
                        hideBatchLoraModal();
                    }
                };
            }

            // 递归函数来遍历树，获取某个路径下的内容
            function getLoraContentByPath(loraTree, pathParts) {
                let currentLevel = loraTree;
                for (const part of pathParts) {
                    if (currentLevel.folders && currentLevel.folders[part]) {
                        currentLevel = currentLevel.folders[part];
                    } else {
                        // console.warn("Invalid path part:", part, "in", pathParts); // 调试
                        return null; // 路径无效
                    }
                }
                return currentLevel;
            }

            /**
             * 递归收集所有 LoRA 文件
             * @param {object} treeNode 包含 files 和 folders 的树节点
             * @returns {Array<{name: string, fullpath: string}>} 所有 LoRA 文件的扁平列表
             */
            function collectAllLoraFiles(treeNode) {
                let allFiles = [];
                if (treeNode.files) {
                    allFiles = allFiles.concat(treeNode.files);
                }
                if (treeNode.folders) {
                    for (const folderName in treeNode.folders) {
                        allFiles = allFiles.concat(collectAllLoraFiles(treeNode.folders[folderName]));
                    }
                }
                return allFiles;
            }

            // 更新选中 LoRA 数量显示
            function updateSelectedCountDisplay() {
                if (zmlBatchLoraSelectedCountDisplay) {
                    zmlBatchLoraSelectedCountDisplay.textContent = `已选择 ${zmlBatchLoraSelected.size} 个 LoRA`;
                }
            }

            function renderBatchLoraContent() {
                if (!zmlBatchLoraCurrentNodeInstance) return;

                zmlBatchLoraParentPathDisplay.innerHTML = "";
                zmlBatchLoraFoldersPanel.innerHTML = "";
                zmlBatchLoraGridContainer.innerHTML = "";

                // 判断是否是“全部显示”模式
                const isShowingAllLoras = zmlBatchLoraCurrentPath.length === 1 && zmlBatchLoraCurrentPath[0] === ALL_LORAS_VIEW_PATH;

                // --- 渲染面包屑导航 (路径) ---
                if (!isShowingAllLoras && zmlBatchLoraCurrentPath.length > 0) { // 在非“全部显示”模式且不在根目录时显示返回按钮
                    const backButton = createEl("a", {
                        textContent: "↩︎",
                        href: "#",
                        title: "返回上一级",
                        style: `color: #e0e0e0; text-decoration: none; padding: 4px; border-radius: 3px; background-color: #4a515a; cursor: pointer; transition: background-color 0.2s; font-size: 13px;`
                    });
                    backButton.onmouseenter = (e) => e.target.style.backgroundColor = '#5d6773';
                    backButton.onmouseleave = (e) => e.target.style.backgroundColor = '#4a515a';
                    backButton.onclick = (e) => {
                        e.preventDefault();
                        zmlBatchLoraCurrentPath.pop();
                        renderBatchLoraContent();
                    };
                    zmlBatchLoraParentPathDisplay.appendChild(backButton);
                    const separator = createEl("span", { textContent: " | ", style: "color:#4a515a;" });
                    zmlBatchLoraParentPathDisplay.appendChild(separator);
                }

                const rootLink = createEl("a", {
                    textContent: "Root",
                    href: "#",
                    style: `color: ${zmlBatchLoraCurrentPath.length === 0 && !isShowingAllLoras ? '#e0e0e0' : '#5d99f2'}; text-decoration: none; cursor: pointer;`
                });
                rootLink.onmouseenter = (e) => e.target.style.textDecoration = 'underline';
                rootLink.onmouseleave = (e) => e.target.style.textDecoration = 'none';
                rootLink.onclick = (e) => {
                    e.preventDefault();
                    zmlBatchLoraCurrentPath = []; // 返回根目录
                    renderBatchLoraContent();
                };
                zmlBatchLoraParentPathDisplay.appendChild(rootLink);

                let currentPathAccumulate = [];
                if (!isShowingAllLoras) { // 仅在非“全部显示”模式下渲染路径面包屑
                    zmlBatchLoraCurrentPath.forEach((part, index) => {
                        currentPathAccumulate.push(part);
                        const separator = createEl("span", { textContent: " > ", style: "color:#888;" });
                        zmlBatchLoraParentPathDisplay.appendChild(separator);

                        const pathLink = createEl("a", {
                            textContent: part,
                            href: "#",
                            style: `color: ${index === zmlBatchLoraCurrentPath.length - 1 ? '#e0e0e0' : '#5d99f2'}; text-decoration: none; cursor: pointer;`
                        });
                        pathLink.onmouseenter = (e) => e.target.style.textDecoration = 'underline';
                        pathLink.onmouseleave = (e) => e.target.style.textDecoration = 'none';
                        const pathCopy = Array.from(currentPathAccumulate); // 复制一份
                        pathLink.onclick = (e) => {
                            e.preventDefault();
                            zmlBatchLoraCurrentPath = pathCopy;
                            renderBatchLoraContent();
                        };
                        zmlBatchLoraParentPathDisplay.appendChild(pathLink);
                    });
                } else {
                    const separator = createEl("span", { textContent: " > ", style: "color:#888;" });
                    zmlBatchLoraParentPathDisplay.appendChild(separator);
                    const allLorasText = createEl("span", { textContent: "全部 LoRA", style: "color:#e0e0e0;" });
                    zmlBatchLoraParentPathDisplay.appendChild(allLorasText);
                }

                // 获取当前要显示的内容
                let foldersToDisplay = [];
                let filesToDisplay = [];
                let currentContent = null;

                if (isShowingAllLoras) {
                    filesToDisplay = collectAllLoraFiles(zmlBatchLoraCurrentNodeInstance.loraTree);
                    zmlBatchLoraFoldersPanel.style.display = 'none'; // 全部LoRA模式下不显示文件夹行
                    zmlBatchLoraParentPathDisplay.style.borderBottom = '1px solid #3c3c3c'; // 路径底部加线
                } else {
                    currentContent = getLoraContentByPath(zmlBatchLoraCurrentNodeInstance.loraTree, zmlBatchLoraCurrentPath);
                    if (!currentContent) {
                        zmlBatchLoraGridContainer.textContent = "无效的LoRA路径。";
                        return;
                    }
                    foldersToDisplay = Object.keys(currentContent.folders).sort();
                    filesToDisplay = (currentContent.files || []).sort((a,b) => a.name.localeCompare(b.name));

                     // 仅在非“全部显示”模式下且存在子文件夹时才显示文件夹面板
                    if(foldersToDisplay.length > 0) {
                        zmlBatchLoraFoldersPanel.style.display = 'flex'; // 显示文件夹面板
                        zmlBatchLoraParentPathDisplay.style.borderBottom = 'none'; // 路径底部不需要线
                    } else {
                        zmlBatchLoraFoldersPanel.style.display = 'none'; // 如果没有文件夹，则隐藏这一行
                        zmlBatchLoraParentPathDisplay.style.borderBottom = '1px solid #3c3c3c'; // 如果隐藏文件夹栏，则路径底部加线
                    }
                }
                
                // --- “全部” LoRA 按钮 ---
                // 仅当不在“全部显示”模式时，才在文件夹列表中添加此按钮
                if (!isShowingAllLoras) {
                    const allLorasBtn = createEl("button", {
                        className: "zml-batch-lora-all-loras-btn zml-batch-lora-folder-item", // 复用文件夹item样式
                        textContent: "全部",
                        title: "展示所有 LoRA 文件",
                        style: `
                            display: flex;
                            align-items: center;
                            gap: 3px;
                            cursor: pointer;
                            padding: 3px 6px;
                            border-radius: 4px;
                            background-color: #3f454d; /* 稍亮的背景 */
                            border: 1px solid #555;
                            color: #ccc;
                            font-size: 13px;
                            white-space: nowrap;
                            transition: background-color 0.2s, border-color 0.2s;
                        `
                    });
                    // allLorasBtn.innerHTML = `<span style="font-size: 14px;">☰</span><span>全部</span>`; // 可以用☰图标
                    allLorasBtn.onclick = (e) => {
                        e.stopPropagation();
                        zmlBatchLoraCurrentPath = [ALL_LORAS_VIEW_PATH]; // 设置为“全部显示”模式
                        renderBatchLoraContent();
                    };
                    zmlBatchLoraFoldersPanel.appendChild(allLorasBtn); // 放在文件夹列表的前面
                }


                // --- 渲染子文件夹列表 (在路径下面) ---
                if (!isShowingAllLoras) { // 仅在非“全部显示”模式下渲染子文件夹
                    foldersToDisplay.forEach(folderName => {
                        const folderEl = createEl("div", {
                            className: "zml-batch-lora-folder-item",
                            style: `
                                display: flex;
                                align-items: center;
                                gap: 3px;
                                cursor: pointer;
                                padding: 3px 6px;
                                border-radius: 4px;
                                background-color: #3f454d; /* 稍亮的背景 */
                                border: 1px solid #555;
                                color: #ccc;
                                font-size: 13px;
                                white-space: nowrap;
                                transition: background-color 0.2s, border-color 0.2s;
                            `
                        });
                        folderEl.onmouseenter = (e) => e.target.style.backgroundColor = '#5a626d';
                        folderEl.onmouseleave = (e) => e.target.style.backgroundColor = '#3f454d';
                        folderEl.onclick = () => {
                            zmlBatchLoraCurrentPath.push(folderName);
                            renderBatchLoraContent();
                        };
                        folderEl.innerHTML = `<span style="font-size: 14px;">📁</span><span>${folderName}</span>`;
                        zmlBatchLoraFoldersPanel.appendChild(folderEl);
                    });
                }
                


                // 渲染 LoRA 文件
                filesToDisplay.forEach(file => {
                    const loraPath = file.fullpath; // This is the relative path, e.g., "Char/Char1.safetensors"
                    const hasPreview = !!loraImages[loraPath];
                    const isSelected = zmlBatchLoraSelected.has(loraPath);
                    // The /view API expects "loras/subdir/image.ext" from the client.
                    const civitaiPreviewUrl = loraImages[loraPath] ? `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(loraImages[loraPath])}?${+new Date()}` : '';

                    const itemEl = createEl("div", {
                        className: `zml-batch-lora-item ${isSelected ? 'selected' : ''}`,
                        style: `
                            position: relative;
                            width: 120px;
                            height: 120px;
                            border: 1px solid ${isSelected ? '#4CAF50' : '#555'};
                            border-radius: 4px;
                            overflow: hidden;
                            cursor: pointer;
                            background-color: #222;
                            transition: border-color 0.2s, background-color 0.2s;
                        `
                    });
                    itemEl.onmouseenter = () => itemEl.style.borderColor = isSelected ? '#4CAF50' : '#5d99f2';
                    itemEl.onmouseleave = () => itemEl.style.borderColor = isSelected ? '#4CAF50' : '#555';


                    const imageWrapper = createEl("div", {
                        className: "zml-batch-lora-image-wrapper",
                        style: `
                            width: 100%;
                            height: 100%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-direction: column; /* 确保文字也在中间 */
                            color: #888;
                            font-size: 11px;
                            text-align: center;
                            background-color: ${hasPreview ? 'transparent' : '#333'};
                        `
                    });

                    if (hasPreview) {
                        const img = createEl("img", {
                            src: civitaiPreviewUrl, // Use the dynamically constructed URL
                            className: "zml-batch-lora-item-image",
                            style: `
                                width: 100%;
                                height: 100%;
                                object-fit: cover;
                            `
                        });
                        imageWrapper.appendChild(img);
                    } else {
                        imageWrapper.textContent = "LoRA暂无预览图";
                    }

                    // --- 新增：Civitai获取元数据按钮 ---
                    if (!hasPreview) { // 只有在没有预览图时才显示此按钮
                        const fetchMetadataBtn = createEl("button", {
                            className: "zml-batch-lora-fetch-from-civitai-btn",
                            textContent: "☰", // Hamburger icon
                            title: `从Civitai获取 '${file.name}' 的预览图和元数据`,
                        });
                        fetchMetadataBtn.onclick = async (e) => {
                            e.stopPropagation(); // 阻止事件冒泡，避免触发LoRA选择
                            const confirmFetch = confirm(`您确定要从Civitai获取LoRA '${file.name}' 的信息吗？这可能需要一些时间，并将下载文件到您的本地。`);
                            if (confirmFetch) {
                                fetchMetadataBtn.classList.add('fetching');
                                fetchMetadataBtn.textContent = '...'; // Loading indicator
                                fetchMetadataBtn.disabled = true;

                                try {
                                    const response = await api.fetchApi(`${ZML_API_PREFIX}/fetch_civitai_metadata`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ "lora_filename": loraPath }), // Send the relative lora filename
                                    });
                                    const result = await response.json();

                                    if (result.status === "success") {
                                        alert(`LoRA '${file.name}' 信息获取成功！\n${result.message}`);
                                        await loadImageList(); // 重新加载图片列表以显示新预览图
                                        renderBatchLoraContent(); // 重新渲染当前内容，更新UI
                                    } else {
                                        alert(`LoRA '${file.name}' 信息获取失败！\n${result.message}`);
                                    }
                                } catch (error) {
                                    console.error("Error fetching Civitai metadata:", error);
                                    alert(`LoRA '${file.name}' 信息获取时发生网络错误或服务器错误。请检查控制台。`);
                                } finally {
                                    fetchMetadataBtn.classList.remove('fetching');
                                    fetchMetadataBtn.textContent = '☰';
                                    fetchMetadataBtn.disabled = false;
                                }
                            }
                        };
                        itemEl.appendChild(fetchMetadataBtn);
                    }
                    // --- 结束：Civitai获取元数据按钮 ---


                    const overlay = createEl("div", {
                        className: "zml-batch-lora-item-overlay",
                        style: `
                            position: absolute;
                            top: 0; left: 0; width: 100%; height: 100%;
                            background-color: rgba(0,0,0,0.5); /* 覆盖并变暗 */
                            display: ${isSelected ? 'flex' : 'none'}; /* 选中时显示，取消时隐藏 */
                            align-items: center;
                            justify-content: center;
                            transition: opacity 0.2s;
                        `
                    });

                    const checkmark = createEl("div", {
                        className: "zml-batch-lora-checkmark",
                        textContent: "✓",
                        style: `
                            font-size: 50px;
                            color: #4CAF50; /* 绿色 */
                            font-weight: bold;
                            text-shadow: 0 0 5px rgba(0,0,0,0.7);
                        `
                    });
                    overlay.appendChild(checkmark);
                    
                    const addIcon = createEl("div", {
                        className: "zml-batch-lora-add-icon",
                        textContent: "+",
                        style: `
                            position: absolute;
                            top: 5px; right: 5px;
                            width: 24px; height: 24px;
                            background-color: rgba(0, 128, 0, 0.8);
                            color: white;
                            border-radius: 50%;
                            display: ${isSelected ? 'none' : 'flex'}; /* 选中时隐藏，取消时显示 */
                            align-items: center;
                            justify-content: center;
                            font-size: 18px;
                            font-weight: bold;
                            z-index: 10; /*确保在最上层*/
                        `
                    });

                    // LoRA 名称显示在底部
                    const nameDisplay = createEl("div", {
                        style: `
                            position: absolute;
                            bottom: 0; left: 0;
                            width: 100%;
                            background-color: rgba(0,0,0,0.7);
                            color: #fff;
                            font-size: 11px;
                            padding: 3px;
                            text-align: center;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            z-index: 5;
                        `,
                        textContent: file.name
                    });


                    itemEl.append(imageWrapper, overlay, addIcon, nameDisplay);

                    itemEl.onclick = (e) => {
                        // 阻止事件冒泡到父元素，特别是如果 addIcon 也在 itemEl 边界内
                        e.stopPropagation();

                        if (zmlBatchLoraSelected.has(loraPath)) {
                            zmlBatchLoraSelected.delete(loraPath);
                            itemEl.classList.remove("selected");
                            overlay.style.display = 'none';
                            addIcon.style.display = 'flex';
                            itemEl.style.borderColor = '#555';
                            // console.log(`Removed ${loraPath} from selection. Total: ${zmlBatchLoraSelected.size}`); // 调试用
                        } else {
                            zmlBatchLoraSelected.add(loraPath);
                            itemEl.classList.add("selected");
                            overlay.style.display = 'flex';
                            addIcon.style.display = 'none';
                            itemEl.style.borderColor = '#4CAF50';
                            // console.log(`Added ${loraPath} to selection. Total: ${zmlBatchLoraSelected.size}`); // 调试用
                        }
                        updateSelectedCountDisplay(); // 更新显示
                    };
                    zmlBatchLoraGridContainer.appendChild(itemEl);
                });
                updateSelectedCountDisplay(); // 初始渲染后更新显示
            }

            // 新增处理批量添加 LoRA 的函数
            async function handleBatchAddLora() {
                if (!zmlBatchLoraCurrentNodeInstance || zmlBatchLoraSelected.size === 0) {
                    hideBatchLoraModal();
                    return;
                }

                const lorasToAdd = Array.from(zmlBatchLoraSelected);
                const existingLoraNames = new Set(zmlBatchLoraCurrentNodeInstance.powerLoraLoader_data.entries.map(e => e.lora_name));
                const duplicates = lorasToAdd.filter(loraPath => existingLoraNames.has(loraPath));

                let finalLorasToAdd = lorasToAdd;

                // 如果有重复的 LoRA
                if (duplicates.length > 0) {
                    const confirmMessage = `检测到此次选择的 ${duplicates.length} 个 LoRA (共 ${lorasToAdd.length} 个) 在节点里已经添加，是否跳过它们？\n\n点击“是”跳过重复项，只添加新的。\n点击“否”添加所有选中的LoRA，包括重复项。`;
                    const shouldSkip = await new Promise(resolve => {
                        const overlay = createEl("div", {
                            style: `
                                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                                background-color: rgba(0, 0, 0, 0.8);
                                display: flex; align-items: center; justify-content: center;
                                z-index: 10002;
                                backdrop-filter: blur(2px);
                            `
                        });
                        const modal = createEl("div", {
                            style: `
                                background-color: #31353a; border: 1px solid #4a515a; border-radius: 8px;
                                padding: 20px; max-width: 400px; text-align: center;
                                display: flex; flex-direction: column; gap: 20px;
                                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5);
                            `
                        });
                        const text = createEl("p", {
                            textContent: confirmMessage,
                            style: `color: #e0e0e0; font-size: 14px; line-height: 1.5; margin:0;`
                        });
                        const buttonWrapper = createEl("div", {
                            style: `display: flex; justify-content: center; gap: 15px;`
                        });

                        const yesButton = createEl("button", {
                            textContent: "是 (跳过重复)",
                            className: "zml-control-btn zml-st3-modal-save",
                            style: `padding: 8px 15px;` // 调整按钮样式
                        });
                        yesButton.onclick = () => { overlay.remove(); resolve(true); };

                        const noButton = createEl("button", {
                            textContent: "否 (添加所有)",
                            className: "zml-control-btn zml-st3-modal-cancel",
                            style: `padding: 8px 15px;` // 调整按钮样式
                        });
                        noButton.onclick = () => { overlay.remove(); resolve(false); };

                        buttonWrapper.append(yesButton, noButton);
                        modal.append(text, buttonWrapper);
                        overlay.appendChild(modal);
                        document.body.appendChild(overlay);
                    });

                    if (shouldSkip) {
                        finalLorasToAdd = lorasToAdd.filter(loraPath => !existingLoraNames.has(loraPath));
                    }
                }

                if (finalLorasToAdd.length > 0) {
                    finalLorasToAdd.forEach(loraPath => {
                        const newEntry = {
                            id: "lora" + Date.now() + Math.random().toString(36).substring(2, 8),
                            item_type: "lora",
                            display_name: "", // 默认不填充
                            custom_text: "",
                            lora_name: loraPath,
                            weight: 1.0,
                            enabled: true,
                            parent_id: null,
                        };
                        zmlBatchLoraCurrentNodeInstance.powerLoraLoader_data.entries.push(newEntry);
                    });
                    zmlBatchLoraCurrentNodeInstance.triggerSlotChanged();
                } else if (lorasToAdd.length > 0) {
                     alert("所有选中的 LoRA 都已存在且你选择了跳过。");
                }
                
                hideBatchLoraModal();
            }


            function showBatchLoraModal(nodeInstance, loraRootTree) {
                if (!zmlBatchLoraModalOverlay) createBatchLoraModal();

                zmlBatchLoraCurrentNodeInstance = nodeInstance;
                zmlBatchLoraCurrentPath = []; // 重置路径到根
                zmlBatchLoraSelected.clear(); // 清空上次选择

                // 首次打开或者图片列表为空时尝试重新加载图片列表
                if (!loraImages || Object.keys(loraImages).length === 0) {
                    loadImageList().then(() => {
                        renderBatchLoraContent(); // 重新渲染内容
                        zmlBatchLoraModalOverlay.style.display = 'flex';
                    }).catch(e => {
                        console.error("Failed to load lora images for batch modal:", e);
                        alert("无法加载 LoRA 预览图，请检查后端服务日志。");
                        hideBatchLoraModal(); // 加载失败则关闭
                    });
                } else {
                    renderBatchLoraContent(); // 渲染内容
                    zmlBatchLoraModalOverlay.style.display = 'flex';
                }
            }

            function hideBatchLoraModal() {
                if (zmlBatchLoraModalOverlay) {
                    zmlBatchLoraModalOverlay.style.display = 'none';
                    zmlBatchLoraCurrentNodeInstance = null;
                    zmlBatchLoraCurrentPath = [];
                    zmlBatchLoraSelected.clear();
                    updateSelectedCountDisplay(); // 清空后更新计数显示
                }
            }
            // --- 结束：批量添加 LoRA 弹窗的变量和函数 ---


            // --- 新增：颜色选择器菜单的变量和函数 ---
            let zmlColorChooseMenu = null;
            // zmlColorCallback 变量不再需要，因为我们直接触发颜色 input 的点击事件

            function createColorChooseMenu(x, y, onSelectFolder, onSelectLoraEntry) {
                if (zmlColorChooseMenu) zmlColorChooseMenu.remove(); // 移除旧菜单

                zmlColorChooseMenu = createEl("div", {
                    className: "zml-color-choose-menu",
                    style: `
                        position: absolute;
                        left: ${x}px;
                        top: ${y}px;
                        background-color: #2e2e2e;
                        border: 1px solid #555;
                        border-radius: 4px;
                        padding: 5px;
                        z-index: 10000;
                        display: flex;
                        flex-direction: column;
                        gap: 5px;
                    `
                });

                const folderColorOption = createEl("div", {
                    textContent: "文件夹颜色",
                    className: "zml-color-choose-option",
                    style: `
                        padding: 5px 10px;
                        cursor: pointer;
                        border-radius: 2px;
                        color: #ccc;
                        transition: background-color 0.2s;
                    `
                });
                folderColorOption.onmouseenter = (e) => e.target.style.backgroundColor = '#535353';
                folderColorOption.onmouseleave = (e) => e.target.style.backgroundColor = 'transparent';
                folderColorOption.onclick = () => { onSelectFolder(); zmlColorChooseMenu.remove(); zmlColorChooseMenu = null; };

                const loraEntryColorOption = createEl("div", {
                    textContent: "LoRA 框颜色",
                    className: "zml-color-choose-option",
                    style: `
                        padding: 5px 10px;
                        cursor: pointer;
                        border-radius: 2px;
                        color: #ccc;
                        transition: background-color 0.2s;
                    `
                });
                loraEntryColorOption.onmouseenter = (e) => e.target.style.backgroundColor = '#535353';
                loraEntryColorOption.onmouseleave = (e) => e.target.style.backgroundColor = 'transparent';
                loraEntryColorOption.onclick = () => { onSelectLoraEntry(); zmlColorChooseMenu.remove(); zmlColorChooseMenu = null; };

                zmlColorChooseMenu.append(folderColorOption, loraEntryColorOption);
                document.body.appendChild(zmlColorChooseMenu);

                const clickOutside = (e) => {
                    // 确保点击调色板按钮外部或菜单外部时才关闭
                    if (zmlColorChooseMenu && !zmlColorChooseMenu.contains(e.target) && !e.target.classList.contains("zml-color-btn-trigger")) {
                        zmlColorChooseMenu.remove();
                        zmlColorChooseMenu = null;
                        document.removeEventListener("click", clickOutside, true);
                    }
                };
                setTimeout(() => document.addEventListener("click", clickOutside, true), 0);
            }
            // --- 结束：颜色选择器菜单的变量和函数 ---


            if (!document.getElementById("zml-power-lora-loader-style")) { // 这段CSS只在第一次加载时注入，如果已经存在就跳过
                $el("style", {
                    id: "zml-power-lora-loader-style",
                    textContent: `
                        .zml-lora-tree-menu { position: absolute; background-color: #2e2e2e; border: 1px solid #555; border-radius: 4px; padding: 5px; z-index: 10000; max-height: 400px; overflow-y: auto; }
                        .zml-lora-tree-menu .zml-lora-folder, .zml-lora-tree-menu .zml-lora-file { padding: 5px 8px; cursor: pointer; border-radius: 2px; }
                        .zml-lora-tree-menu .zml-lora-folder:hover, .zml-lora-tree-menu .zml-lora-file:hover { background-color: #535353; }
                        .zml-lora-tree-menu .zml-lora-folder-arrow { display: inline-block; width: 1em; text-align: center; }
                        .zml-lora-tree-menu .zml-lora-folder-content { display: none; padding-left: 15px; }

                        .zml-pll-entry-card.zml-pll-dragging, .zml-pll-folder-card.zml-pll-dragging { opacity: 0.5; background: #555; }
                        .zml-pll-drag-over-line { border-top: 2px solid #5d99f2 !important; }
                        .zml-pll-drag-over-folder { background-color: rgba(93, 153, 242, 0.3) !important; }
                        .zml-pll-drag-handle.locked { cursor: not-allowed !important; color: #666 !important; }
                        
                        .zml-pll-folder-card { border-radius: 4px; margin-bottom: 4px; }
                        .zml-pll-folder-header { display: flex; align-items: center; padding: 4px; cursor: pointer; }

                        .zml-pll-folder-toggle { width: 20px; text-align: center; font-size: 14px; user-select: none; }
                        .zml-pll-folder-name-input { background: #2b2b2b; border: 1px solid #444; color: #ccc; border-radius: 2px; flex-grow: 1; padding: 4px; margin: 0 4px; }
                        /* 删除按钮已经有全局的反馈样式了，这里可以移除重复的hover/active */
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
                            justify-content: space-between; /* 新增 */
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
                        /* .zml-pll-button:hover 已通过通用样式覆盖 */
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
                        /* .zml-control-btn-pll:hover 已通过通用样式覆盖 */
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
                            /* background: #2b2b2b; border: 1px solid #444; 已经通过通用样式设置了 */
                            border-radius: 2px;
                            color: #ccc;
                            font-size: 12px;
                            margin-right: 4px;
                            box-sizing: border-box;
                            flex-shrink: 0;
                        }
                        .zml-lora-weight-input { /* 新增样式 */
                            background: none; /* 透明背景由父元素控制 */
                            border: none; /* 无边框由父元素控制 */
                            color: #ddd;
                            height: 100%;
                            padding: 0;
                            margin: 0;
                            text-align: center;
                            font-size: 12px; /* 字体大小保持一致 */
                        }


                        .zml-lora-custom-text-input {
                            padding: var(--pll-current-input-padding);
                            height: var(--pll-current-input-height);
                            /* background: #2b2b2b; border: 1px solid #444; 已经通过通用样式设置了 */
                            border-radius: 2px;
                            color: #ccc;
                            font-size: 12px;
                            margin-right: 4px;
                            box-sizing: border-box;
                            resize: none;
                            overflow: hidden; /* 防止原生滚动条出现 */
                            min-height: 26px;
                            flex-shrink: 0;
                            cursor: pointer; /* 表示可点击 */
                        }
                        /* customTextInput 悬停效果 (已通过通用样式设置) */
                        /* .zml-lora-custom-text-input:hover {
                            border-color: #5d99f2 !important;
                            box-shadow: 0 0 5px rgba(93, 153, 242, 0.4);
                        } */


                        .zml-pll-entries-list {
                            overflow: auto;
                            flex: 1;
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            padding: 0;
                        }

                        /* 复用 SelectTextV3 的弹窗样式 */
                        .zml-st3-modal-overlay { /* 可以在此覆盖或补充样式 */ }
                        .zml-st3-modal-container { /* 可以在此覆盖或补充样式 */ }
                        .zml-st3-modal-title { /* 可以在此覆盖或补充样式 */ }
                        .zml-st3-modal-textarea { /* 可以在此覆盖或补充样式 */ }
                        .zml-st3-modal-buttons { /* 可以在此覆盖或补充样式 */ }
                        .zml-st3-modal-save {} /* 可以在此覆盖或补充样式 */
                        .zml-st3-modal-cancel {} /* 可以在此覆盖或补充样式 */

                        /* 批量添加 LoRA 弹窗的额外样式 */
                        .zml-batch-lora-modal-container {
                            /* 注意：这里已经定义了min-width, max-width, height, flex-direction, box-shadow等 */
                            /* 如果需要调整，请在这里修改或添加 */
                        }
                        .zml-batch-lora-folder-nav > a:hover {
                            text-decoration: underline !important;
                        }
                        .zml-batch-lora-item {
                            position: relative;
                            width: 120px;
                            height: 120px;
                            box-sizing: border-box;
                            transition: border-color 0.2s, transform 0.1s;
                        }
                        .zml-batch-lora-item.selected {
                            border-color: #4CAF50 !important;
                        }
                        .zml-batch-lora-item-image {
                            display: block;
                        }
                        .zml-batch-lora-item-overlay {
                            pointer-events: none; /* 允许点击穿透到下面的 itemEl */
                            backdrop-filter: blur(1px); /* 轻微模糊背景 */
                        }
                        .zml-batch-lora-add-icon {
                            pointer-events: auto; /* 确保图标可点击 */
                            transition: background-color 0.15s ease, transform 0.05s ease, box-shadow 0.15s ease;
                        }
                        .zml-batch-lora-add-icon:hover {
                            background-color: rgba(0, 150, 0, 0.9) !important;
                            box-shadow: 0 2px 5px rgba(0,0,0,0.4);
                        }
                        .zml-batch-lora-add-icon:active {
                            transform: translateY(1px);
                            box-shadow: 0 1px 3px rgba(0,0,0,0.3) inset;
                        }
                        /* 调色板选择菜单样式 */
                        .zml-color-choose-menu {
                            /* 基础样式在js中定义 */
                        }
                        .zml-color-choose-option:active {
                            transform: translateY(1px);
                        }
                        /* 新增：LoRA 条目删除按钮的样式 */
                        .zml-lora-entry-delete { /* 对应 LoRA 条目右侧的 X 按钮 */
                            padding: 0;
                            border: 1px solid #666;
                            border-radius: 2px;
                            background: #444;
                            color: #ccc;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        /* “全部”LoRA按钮样式，复用文件夹 item 的基础视觉 */
                        .zml-batch-lora-all-loras-btn {
                            margin-right: 10px; /* 与其他文件夹项保持距离 */
                        }
                    `,
                    parent: document.body,
                });
            }
            const loraNamesFlat = nodeData.input.hidden.lora_names_hidden[0] || [];
            const loraTree = { files: [], folders: {} };
            loraNamesFlat.forEach(name => {
                if (name === "None") return;
                const splitBy = (navigator.platform || navigator.userAgent).includes("Win") ? /\\|\// : /\//;
                const parts = name.split(splitBy);
                let currentLevel = loraTree;
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    if (!currentLevel.folders[part]) currentLevel.folders[part] = { files: [], folders: {} };
                    currentLevel = currentLevel.folders[part];
                }
                currentLevel.files.push({ name: parts[parts.length - 1], fullpath: name });
            });
            let activeLoraMenu = null;
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
                 try {
                     if (this.powerLoraLoader_initialized) return r;
                     this.powerLoraLoader_initialized = true;
                     this.loraTree = loraTree; // 将 loraTree 存储在节点实例上

                     this.isLocked = this.isLocked ?? false;
                     this.compactView = this.compactView ?? false;
                     this.loraNameWidth = this.loraNameWidth ?? 65;
                     this.customTextWidth = this.customTextWidth ?? 80;
                     // New: Default folder color
                     this.folderColor = this.folderColor ?? "#30353c";
                     this.loraEntryColor = this.loraEntryColor ?? "#3a3a3a"; // 新增 LoRA 条目背景色


                     if (!this.powerLoraLoader_data) {
                         this.powerLoraLoader_data = { entries: [
                             { id: "lora1", item_type: "lora", display_name: "", custom_text: "", lora_name: "None", weight: 1.0, enabled: true }]
                         };
                     }
                     // Ensure old data has item_type
                     this.powerLoraLoader_data.entries.forEach(e => {
                         if (!e.item_type) e.item_type = 'lora';
                         // 兼容旧数据添加 display_name 和 custom_text
                         if (e.display_name === undefined) e.display_name = "";
                         if (e.custom_text === undefined) e.custom_text = "";
                     });

                     const dataWidget = this.addWidget("text", "lora_loader_data", JSON.stringify(this.powerLoraLoader_data), (v) => { try { if(v) this.powerLoraLoader_data = JSON.parse(v); } catch(e){} }, { serialize: true });
                     dataWidget.hidden = true; dataWidget.computeSize = () => [0, 0];

                     const container = createEl("div"); // <-- 这里会调用到局部定义的 createEl
                     container.style.cssText = `background: #2b2b2b; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; display: flex; flex-direction: column; padding: 6px;`;

                     const topControls = createEl("div", { className: "zml-pll-controls-top" }); // <-- 这里会调用到局部定义的 createEl

                     const loraNameWidthGroup = createEl("div", { className: "zml-control-group-pll" });// <-- 这里会调用到局部定义的 createEl
                     const loraNameWidthLabel = createEl("span", { className: "zml-control-label-pll", textContent: "名称宽度" });// <-- 这里会调用到局部定义的 createEl
                     const loraNameWidthInput = createEl("input", { className: "zml-control-input-pll" });// <-- 这里会调用到局部定义的 createEl
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

                     const customTextWidthGroup = createEl("div", { className: "zml-control-group-pll" });// <-- 这里会调用到局部定义的 createEl
                     const customTextWidthLabel = createEl("span", { className: "zml-control-label-pll", textContent: "文本宽度" });// <-- 这里会调用到局部定义的 createEl
                     const customTextWidthInput = createEl("input", { className: "zml-control-input-pll" });// <-- 这里会调用到局部定义的 createEl
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
                     const newFolderBtn = createEl("button", { className: "zml-control-btn-pll", textContent: "📁+" });// <-- 这里会调用到局部定义的 createEl
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

                     // === 文件夹/LoRA 颜色按钮 (修改) ===
                     const folderColorInput = createEl("input", { type: "color", value: this.folderColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                     const loraEntryColorInput = createEl("input", { type: "color", value: this.loraEntryColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                    
                     folderColorInput.onchange = (e) => {
                         this.folderColor = e.target.value;
                         this.renderLoraEntries(); // Re-render to apply new color
                         this.triggerSlotChanged();
                     };
                     loraEntryColorInput.onchange = (e) => {
                         this.loraEntryColor = e.target.value;
                         this.renderLoraEntries(); // Re-render to apply new color
                         this.triggerSlotChanged();
                     };

                     const colorPickerBtn = createEl("button", { 
                        className: "zml-control-btn-pll zml-color-btn-trigger", 
                        textContent: "🎨" 
                     });
                     colorPickerBtn.title = "自定义文件夹和LoRA框颜色";
                     colorPickerBtn.onclick = (e) => {
                        const rect = e.target.getBoundingClientRect();
                        createColorChooseMenu(rect.left, rect.bottom + 5,
                            () => folderColorInput.click(),  // 选择文件夹颜色
                            () => loraEntryColorInput.click() // 选择 LoRA 框颜色
                        );
                     };
                     topControls.appendChild(folderColorInput); // Hidden input
                     topControls.appendChild(loraEntryColorInput); // Hidden input
                     topControls.appendChild(colorPickerBtn);    // Visible button
                     // =============================


                     const lockToggleButton = createEl("button", { className: "zml-control-btn-pll", textContent: this.isLocked ? "🔒" : "🔓" });// <-- 这里会调用到局部定义的 createEl
                     lockToggleButton.title = "锁定/解锁 LoRA 排序";
                     lockToggleButton.style.cssText += `${this.isLocked ? 'background: #644;' : 'background: #333;'}`;
                     lockToggleButton.onmouseenter = (e) => e.target.style.background = this.isLocked ? '#754' : '#555'; // 悬停反馈
                     lockToggleButton.onmouseleave = (e) => e.target.style.background = this.isLocked ? '#644' : '#333'; // 离开反馈
                     lockToggleButton.onclick = () => {
                         this.isLocked = !this.isLocked;
                         lockToggleButton.textContent = this.isLocked ? "🔒" : "🔓";
                         lockToggleButton.style.background = this.isLocked ? '#644' : '#333';
                         this.renderLoraEntries();
                         this.triggerSlotChanged();
                     };
                     topControls.appendChild(lockToggleButton);

                     const sizeToggleButton = createEl("button", { className: "zml-control-btn-pll", textContent: "↕" });// <-- 这里会调用到局部定义的 createEl
                     sizeToggleButton.title = "切换紧凑/普通视图";
                     sizeToggleButton.onmouseenter = (e) => e.target.style.background = '#555';
                     sizeToggleButton.onmouseleave = (e) => e.target.style.background = '#444';
                     sizeToggleButton.onclick = () => {
                         this.compactView = !this.compactView;
                         this.applySizeMode();
                         this.triggerSlotChanged();
                     };
                     topControls.appendChild(sizeToggleButton);

                     const entriesList = createEl("div", { className: "zml-pll-entries-list" });// <-- 这里会调用到局部定义的 createEl

                     const bottomControls = createEl("div", { className: "zml-pll-controls-bottom" });// <-- 这里会调用到局部定义的 createEl

                     // --- 新增：批量添加 LoRA 按钮 ---
                     const batchAddLoraBtn = createEl("button", { className: "zml-pll-button zml-pll-button-lg", textContent: "批量添加 LoRA" });
                     batchAddLoraBtn.title = "从文件系统批量选择 LoRA";
                     batchAddLoraBtn.onclick = async () => {
                         // 在每次打开批量添加模态框前确保 loraImages 是最新的
                         await loadImageList().catch(e => console.error("Error reloading lora images for batch add:", e));
                         showBatchLoraModal(this, this.loraTree); // 传递节点实例和 loraTree
                         // console.log("Current loraTree:", this.loraTree); // Debugging
                     };
                     bottomControls.appendChild(batchAddLoraBtn);
                     // --- 结束：批量添加 LoRA 按钮 ---
                     
                     const newLoraBtn = createEl("button", { className: "zml-pll-button zml-pll-button-lg", textContent: "＋ 添加 Lora" });// <-- 这里会调用到局部定义的 createEl
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
                         const entryCard = createEl("div", { // <-- 这里会调用到局部定义的 createEl
                             className: "zml-pll-entry-card",
                             style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${entry.enabled ? this.loraEntryColor : adjustBrightness(this.loraEntryColor, -10, -15)}; border-radius: 2px;` // Adjust disabled color
                         });
                         entryCard.dataset.id = entry.id;
                         entryCard.dataset.type = "lora";

                         const checkbox = createEl("input", { type: "checkbox", checked: entry.enabled, style: `transform: scale(${s.checkboxScale}); flex-shrink: 0; margin-right: 4px;` });// <-- 这里会调用到局部定义的 createEl
                         checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderLoraEntries(); this.triggerSlotChanged(); };

                         const dragHandle = createEl("div", { className: "zml-pll-drag-handle", textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: 14px;` });// <-- 这里会调用到局部定义的 createEl
                         dragHandle.draggable = !this.isLocked;

                         const displayNameInput = createEl("input", { className: "zml-lora-display-name-input", type: "text", value: entry.display_name, placeholder: "输入名称...", title: "自定义此LoRA条目的显示名称", style: `width: ${this.loraNameWidth}px;` });// <-- 这里会调用到局部定义的 createEl
                         // --- 修改开始：oninput 不再触发 triggerSlotChanged，改为 onblur 触发 ---
                         displayNameInput.oninput = (e) => {
                             entry.display_name = e.target.value;
                             // 不再在此处调用 this.triggerSlotChanged()
                         };
                         displayNameInput.onblur = () => {
                             this.triggerSlotChanged(); // 在输入框失去焦点时触发更新
                         };
                         // --- 修改结束 ---

                         const loraSelectorBtn = createEl("button", { style: `flex-grow: 1; min-width: 100px; padding: ${s.inputPadding}; background: #222; border: 1px solid #555; border-radius: 2px; color: #ccc; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: ${s.inputHeight};`, textContent: entry.lora_name === "None" ? "None" : (entry.lora_name || "").split(/[/\\]/).pop() });// <-- 这里会调用到局部定义的 createEl
                         loraSelectorBtn.onclick = () => { if (activeLoraMenu) activeLoraMenu.close(); activeLoraMenu = this.createLoraTreeMenu(loraSelectorBtn, entry, () => { loraSelectorBtn.textContent = entry.lora_name === "None" ? "None" : (entry.lora_name || "").split(/[/\\]/).pop(); this.triggerSlotChanged(); }); };

                         const weightWidget = createEl("div", { style: `display: flex; align-items: center; background: #222; border: 1px solid #555; border-radius: 2px; height: ${s.inputHeight};` });// <-- 这里会调用到局部定义的 createEl
                         
                         // 实心三角形按钮 (新增 class)
                         const decBtn = createEl("button", { 
                             className: "zml-weight-btn", // New class
                             style: `background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%; display: flex; align-items: center; justify-content: center;`
                         }, "◀");
                         const incBtn = createEl("button", { 
                             className: "zml-weight-btn", // New class
                             style: `background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%; display: flex; align-items: center; justify-content: center;`
                         }, "▶");

                         // 权重输入框 (宽度改为 25px)
                         const weightInput = createEl("input", {
                            className: "zml-lora-weight-input",
                            type: "text", // 改为文本输入，允许任意字符，失去焦点时再校验
                            value: entry.weight.toFixed(2),
                            title: "LoRA 权重 (点击可直接输入数值)",
                            style: `width: 25px;` // 宽度改为25px
                         });
                         
                         weightInput.onfocus = (e) => e.target.select(); // 选中全部内容方便修改
                         weightInput.onblur = (e) => {
                             let val = parseFloat(e.target.value);
                             if (isNaN(val)) {
                                 val = 1.0; // 非法输入恢复默认值1
                                 console.warn("LoRA 权重输入无效，已重置为 1.0");
                             }
                             // 限制范围
                             val = Math.max(-10, Math.min(10, val));
                             entry.weight = val;
                             e.target.value = val.toFixed(2);
                             this.triggerSlotChanged();
                         };
                         weightInput.onkeydown = (e) => {
                             if (e.key === "Enter") {
                                 e.target.blur(); // 按下回车键时失去焦点，触发校验
                             }
                         }

                         decBtn.onclick = () => { 
                             entry.weight = parseFloat((entry.weight - 0.05).toFixed(2)); 
                             entry.weight = Math.max(-10, entry.weight);
                             weightInput.value = entry.weight.toFixed(2); 
                             this.triggerSlotChanged(); 
                         };
                         incBtn.onclick = () => { 
                             entry.weight = parseFloat((entry.weight + 0.05).toFixed(2)); 
                             entry.weight = Math.min(10, entry.weight);
                             weightInput.value = entry.weight.toFixed(2); 
                             this.triggerSlotChanged(); 
                         };
                         weightWidget.append(decBtn, weightInput, incBtn);


                         const customTextInput = createEl("textarea", { // <-- 这里会调用到局部定义的 createEl
                            className: "zml-lora-custom-text-input",
                            value: entry.custom_text || "",
                            placeholder: "输入文本",
                            title: "点击编辑 LoRA 的自定义文本内容", // 更新提示文字
                            readOnly: true, // 设置为只读
                            style: `width: ${this.customTextWidth}px;`
                         });
                         // 监听点击事件，弹出编辑弹窗，传递当前节点实例
                         const currentNodeInstance = this;
                         customTextInput.onclick = () => {
                            showPllEditContentModal(entry, currentNodeInstance);
                         };


                         // === 移出文件夹按钮 (新增) ===
                         if (entry.parent_id) { // Only show if Lora is in a folder
                            const moveOutBtn = createEl("button", { // <-- 这里会调用到局部定义的 createEl
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

                         const deleteBtn = createEl("button", { // <-- 这里会调用到局部定义的 createEl
                            className: "zml-lora-entry-delete", // 添加新 class
                            style: `width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;` // 简化的行内样式
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
                         const folderCard = createEl("div", {  // <-- 这里会调用到局部定义的 createEl
                            className: "zml-pll-folder-card",
                            style: `background: ${this.folderColor}; border: 1px solid ${adjustBrightness(this.folderColor, -15)};` // Apply custom color
                         });
                         folderCard.dataset.id = entry.id;
                         folderCard.dataset.type = "folder";

                         const header = createEl("div", { className: "zml-pll-folder-header" }); // <-- 这里会调用到局部定义的 createEl
                         const toggle = createEl("div", { className: "zml-pll-folder-toggle", textContent: entry.is_collapsed ? "▶" : "▼" });// <-- 这里会调用到局部定义的 createEl
                         const nameInput = createEl("input", { className: "zml-pll-folder-name-input", type: "text", value: entry.name });// <-- 这里会调用到局部定义的 createEl
                         const deleteBtn = createEl("button", { className: "zml-pll-folder-delete", textContent: "🗑️" });// <-- 这里会调用到局部定义的 createEl
                         const dragHandle = createEl("div", { className: "zml-pll-drag-handle", textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; color: ${this.isLocked ? '#666' : '#ccc'}; user-select: none; font-size: 14px; padding: 0 5px;` });// <-- 这里会调用到局部定义的 createEl
                         dragHandle.draggable = !this.isLocked;

                         const content = createEl("div", { className: `zml-pll-folder-content ${entry.is_collapsed ? 'hidden' : ''}` });// <-- 这里会调用到局部定义的 createEl
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
                                 alert("文件夹内含有LoRA，无法删除！\n请先将LoRA移出文件夹或删除。");
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
							 
							// Logic adjustment for drag and drop to ensure correct target index for insertion
							let effectiveToIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === toId);

							// Corrected logic: determine if dropping "into" a folder or "next to" an item.
							if (toItem.item_type === 'folder' && fromItem.item_type === 'lora') {
								// Dropping a Lora INTO a folder
								itemToMove.parent_id = toItem.id;
								// Insert after the folder itself
								this.powerLoraLoader_data.entries.splice(effectiveToIndex + 1, 0, itemToMove);
							} else {
								// Dropping between items (could be Lora, folders, or moving Lora out of folder)
								itemToMove.parent_id = toItem.parent_id; 
								this.powerLoraLoader_data.entries.splice(effectiveToIndex, 0, itemToMove);
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

                     const initialHeightFromWidgets = (this.widgets_always_on_top?.[0]?.last_y || 0) + POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST; 
                     this.size = [
                         Math.max(this.size[0] || 0, POWER_LORA_LOADER_MIN_WIDTH), 
                         Math.max(this.size[1] || 0, initialHeightFromWidgets)
                     ];
                     

                     const origOnResize = this.onResize;
                     this.onResize = function(size) {
                         size[0] = Math.max(size[0], POWER_LORA_LOADER_MIN_WIDTH);
                         let currentContentHeight = topControls.offsetHeight + bottomControls.offsetHeight + 12;
                         
                         if (this.powerLoraLoader_data.entries.length === 0) {
                             currentContentHeight += 50;
                         } else {
                             currentContentHeight += Math.max(entriesList.scrollHeight, entriesList.clientHeight);
                         }

                         currentContentHeight = Math.max(currentContentHeight, initialHeightFromWidgets);
                         
                         size[1] = Math.max(size[1] || 0, currentContentHeight); // 确保高度不会小于0

                         this.size = size;

                         const domElement = this.domElement;
                         if (domElement) {
                            // Only add scroll if content overflows, otherwise visible
                            if (size[1] < domElement.scrollHeight || size[0] < domElement.scrollWidth) { // 修改这里，如果是domElement.scrollWidth 则出现横向滚动条
                                domElement.style.overflow = "auto";
                                entriesList.style.overflowY = "auto"; // 垂直滚动条
                            } else {
                                domElement.style.overflow = "hidden";
                                entriesList.style.overflowY = "visible";
                            }
                         }

                         if (origOnResize) origOnResize.call(this, size);
                     };

                     // --- 修改：triggerSlotChanged 保持不变，因为它需要调用 renderLoraEntries ---
                     this.triggerSlotChanged = () => {
                         dataWidget.value = JSON.stringify(this.powerLoraLoader_data);
                         this.renderLoraEntries(); // 确保UI立即刷新
                         setTimeout(() => this.onResize(this.size), 0); // 确保在渲染后重新计算大小
                         this.setDirtyCanvas(true, true);
                     };
                     // --- 结束修改 ---

                     // 确保在初始化时就调用一次 onResize 来设置正确的大小
                     // 使用 next tick 确保 DOM 完全渲染后再计算尺寸
                     setTimeout(() => {
                        this.onResize(this.size);
                        this.applySizeMode();
                        // --- 新增：确保弹窗的DOM在节点创建时就存在 ---
                        createPllEditContentModal();
                        createBatchLoraModal(); // 新增：创建批量添加 LoRA 弹窗的 DOM
                        // --- 结束新增 ---
                     }, 0);

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
                                 }

                                 this.applySizeMode(); // This will call renderLoraEntries
                                 this.onResize(this.size);
                             }, 10);
                         }
                     };


                 } catch (error) { console.error("ZML_PowerLoraLoader: UI初始化错误:", error); }
                 return r;
            };

            nodeType.prototype.createLoraTreeMenu = function(button, entry, onSelect) {
                // This function remains largely the same
                const menu = createEl("div", { className: "zml-lora-tree-menu" }); // <-- 这里会调用到局部定义的 createEl
                const closeMenu = () => { menu.remove(); document.removeEventListener("click", clickOutside, true); activeLoraMenu = null; };

                const ext = app.extensions.find(e => e.name === "zml.LoraLoader.Final.v9");
                const imageHost = ext?.imageHost;
                const showImage = ext?.showImage;
                const hideImage = ext?.hideImage;

                const buildMenuLevel = (parent, treeLevel) => {
                    treeLevel.files.sort((a,b) => a.name.localeCompare(b.name)).forEach(file => {
                        const fileEl = createEl("div", { className: "zml-lora-file", textContent: file.name }); // <-- 这里会调用到局部定义的 createEl
                        fileEl.onclick = () => { entry.lora_name = file.fullpath; onSelect(); hideImage?.(); closeMenu(); };

                        if (loraImages[file.fullpath] && imageHost && showImage && hideImage) {
                             fileEl.addEventListener("mouseover", () => {
                                const imagePath = loraImages[file.fullpath];
                                const fullViewPath = `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(imagePath)}?${+new Date()}`;
                                imageHost.src = fullViewPath;
                                showImage.call(ext, fileEl);
                            });
                            fileEl.addEventListener("mouseout", hideImage.bind(ext));
                        }

                        parent.appendChild(fileEl);
                    });

                    Object.keys(treeLevel.folders).sort().forEach(folderName => {
                        const folderEl = createEl("div", { className: "zml-lora-folder", innerHTML: `<span class="zml-lora-folder-arrow">▶</span> ${folderName}` }); // <-- 这里会调用到局部定义的 createEl
                        const contentEl = createEl("div", { className: "zml-lora-folder-content" }); // <-- 这里会调用到局部定义的 createEl
                        folderEl.onclick = (e) => { e.stopPropagation(); const isHidden = contentEl.style.display === "none"; contentEl.style.display = isHidden ? "block" : "none"; folderEl.querySelector('.zml-lora-folder-arrow').textContent = isHidden ? "▼" : "▶"; };
                        buildMenuLevel(contentEl, treeLevel.folders[folderName]);
                        parent.append(folderEl, contentEl);
                    });
                };

                const noneEl = createEl("div", { className: "zml-lora-file", textContent: "None" }); // <-- 这里会调用到局部定义的 createEl
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
                obj.loraEntryColor = this.loraEntryColor; // Save LoRA entry color
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
                        // 确保加载旧工作流时存在 is_collapsed, name 字段
                        if (e.item_type === 'folder' && e.is_collapsed === undefined) e.is_collapsed = false;
                        if (e.item_type === 'folder' && e.name === undefined) e.name = "新建文件夹";
                    });
                }

                if (obj.isLocked !== undefined) this.isLocked = obj.isLocked;
                if (obj.compactView !== undefined) this.compactView = obj.compactView;

                this.loraNameWidth = Math.max(10, Math.min(300, obj.loraNameWidth ?? 65));
                this.customTextWidth = Math.max(10, Math.min(300, obj.customTextWidth ?? 80));
                this.folderColor = obj.folderColor ?? "#30353c"; // Load folder color, or use default
                this.loraEntryColor = obj.loraEntryColor ?? "#3a3a3a"; // Load LoRA entry color, or use default

            };
        }
	},
});
