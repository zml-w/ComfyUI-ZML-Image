import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";
import { api } from "/scripts/api.js";

const TARGET_LORA_LOADERS = ["ZmlLoraLoader", "ZmlLoraLoaderModelOnly", "ZmlLoraLoaderFive", "ZmlLoraMetadataParser"];
const ZML_API_PREFIX = "/zml/lora";
const IMAGE_WIDTH = 384;
const IMAGE_HEIGHT = 384;
// 定义强力LORA加载器推荐的最小宽度
const POWER_LORA_LOADER_MIN_WIDTH = 460;

// 定义强力LORA加载器推荐的最小高度
const POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST = 300;

// 特殊路径标识符，用于表示“全部显示”模式
const ALL_LORAS_VIEW_PATH_IDENTIFIER = '__ALL_LORAS_VIEW__';

function encodeRFC3986URIComponent(str) {
	return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
const calculateImagePosition = (el, bodyRect) => {
	let { top, left, right } = el.getBoundingClientRect();
	const { width: bodyWidth, height: bodyRectHeight } = bodyRect; // Changed from bodyHeight to bodyRectHeight to avoid conflict
	const isSpaceRight = right + IMAGE_WIDTH <= bodyWidth;
	if (isSpaceRight) left = right;
	else left -= IMAGE_WIDTH;
	top = Math.max(0, top - IMAGE_HEIGHT / 2);
	if (top + IMAGE_HEIGHT > bodyRectHeight) top = bodyRectHeight - IMAGE_HEIGHT; // Use bodyRectHeight here
	return { left: Math.round(left), top: Math.round(top), isLeft: !isSpaceRight };
};
let loraImages = {};
// 新增：存储MP4预览视频路径
globalThis.zmlMp4Previews = {};
// 新增：控制MP4预览模式的全局变量
globalThis.zmlBatchLoraPreviewMp4Mode = false;
// 新增：控制添加文本模式的全局变量（默认开启）
globalThis.zmlBatchLoraAddTextMode = true;
// 新增：每个LoRA独立的视频播放状态对象
globalThis.zmlLoraVideoPlayStates = {};

const loadImageList = async () => {
    try {
        console.log("[ZML] Loading lora image list...");
        // 修改API调用，添加参数以获取MP4格式视频
        loraImages = await (await api.fetchApi(`${ZML_API_PREFIX}/images/loras?include_mp4=true`)).json();
        // 提取并存储MP4预览视频路径
        if (loraImages && typeof loraImages === 'object') {
            // 清空现有MP4预览视频缓存
            globalThis.zmlMp4Previews = {};
            // 遍历所有LoRA文件
            for (const [loraPath, imagePath] of Object.entries(loraImages)) {
                // 检查是否有对应的MP4文件
                if (imagePath && typeof imagePath === 'string') {
                    const basePath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '');
                    const mp4Path = `${basePath}.mp4`;
                    // 存储MP4路径（即使不存在，后续使用时会处理）
                    globalThis.zmlMp4Previews[loraPath] = mp4Path;
                }
            }
        }
        console.log("[ZML] loraImages loaded, including MP4 previews support");
    } catch (e) {
        console.error("[ZML] Error loading lora images:", e);
        loraImages = {}; // 确保在加载失败时清空，避免无效缓存
        globalThis.zmlGifPreviews = {}; // 同时清空GIF预览图缓存
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
				.zml-lora-image-preview { position: absolute; left: 0; top: 0; width: ${IMAGE_WIDTH}px; height: ${IMAGE_HEIGHT}px; object-fit: contain; object-position: top left; z-index: 20000; pointer-events: none; }
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
                .zml-control-btn-pll:hover:not(:disabled), .zml-pll-button:hover:not(:disabled),
                .zml-batch-lora-modal-container button:hover:not(:disabled),
                .zml-weight-btn:hover:not(:disabled), /* Weight buttons hover */
                .zml-batch-lora-fetch-from-civitai-btn:hover:not(.fetching):not(:disabled), /* Civitai fetch button hover */
                .zml-batch-lora-all-loras-btn:hover:not(:disabled) /* "全部" Lora button hover */
                {
                    background-color: #555 !important;
                    border-color: #777 !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                /* 通用按钮 active 状态 */
                .zml-control-btn-pll:active:not(:disabled), .zml-pll-button:active:not(:disabled),
                .zml-batch-lora-modal-container button:active:not(:disabled),
                .zml-weight-btn:active:not(:disabled), /* Weight buttons active */
                .zml-batch-lora-all-loras-btn:active:not(:disabled) /* "全部" Lora button active */
                {
                    transform: translateY(1px);
                    box-shadow: 0 1px 4px rgba(0,0,0,0.2) inset;
                }
                /* Lock button specific feedback */
                .zml-control-btn-pll[title*="锁定"]:hover:not(:disabled) { background-color: #754 !important; } /* If locked, hover is darker red */
                .zml-control-btn-pll[title*="锁定"]:active:not(:disabled) { background-color: #865 !important; } 

                /* Delete buttons specific feedback */
                .zml-pll-folder-delete:hover:not(:disabled), .zml-lora-entry-delete:hover:not(:disabled) { 
                    background-color: #f44336 !important; /* Red background on hover */
                    border-color: #da190b !important; 
                    color: white !important; 
                    box-shadow: 0 2px 8px rgba(244, 67, 54, 0.4);
                }
                .zml-pll-folder-delete:active:not(:disabled), .zml-lora-entry-delete:active:not(:disabled) { 
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
                    background-color: rgba(100, 100, 100, 0.8) !important; /* Grey out during fetching */
                    cursor: wait;
                    pointer-events: none; /* Disable clicks during fetch */
                }
                .zml-batch-lora-fetch-from-civitai-btn:hover:not(.fetching):not(:disabled) {
                    background-color: rgba(70, 110, 180, 0.9) !important;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.4);
                }
                .zml-batch-lora-fetch-from-civitai-btn:active:not(.fetching):not(:disabled) {
                    transform: translateY(1px);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3) inset;
                }

                /* --- 修正后的 Checkbox visual feedback: 选择器前添加 .zml-power-lora-loader-container 限制作用域 --- */
                .zml-power-lora-loader-container input[type="checkbox"] {
                    cursor: pointer;
                    --checkbox-background: #444;
                    --checkbox-border: #666;
                    --checkbox-checkmark: white;
                    appearance: none;
                    width: var(--pll-current-input-height);
                    height: var(--pll-current-input-height);
                    border-radius: 3px;
                    border: 1px solid var(--checkbox-border);
                    background-color: var(--checkbox-background);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                    position: relative;
                    margin-right: 4px;
                    flex-shrink: 0;
                }
                .zml-power-lora-loader-container input[type="checkbox"]::after {
                    content: "✓";
                    font-size: 100%;
                    font-weight: 900;
                    color: var(--checkbox-checkmark);
                    opacity: 0;
                    transition: opacity 0.15s ease;
                    line-height: 1;
                    -webkit-text-stroke: 0.5px white;
                    text-rendering: geometricPrecision;
                    text-shadow: 0 0 1px rgba(255, 255, 255, 0.8);
                }
                
                /* 为常规布局(normal)设置更大的对号 */
                [data-layout="normal"] input[type="checkbox"]::after {
                    font-size: 110% !important;
                }
                
                /* 为精简模式(simple)设置更大的对号和权重字体 */
                [data-layout="simple"] input[type="checkbox"]::after {
                    font-size: 160% !important;
                }
                /* 合并并增强权重输入框样式 */
                [data-layout="simple"] .zml-lora-weight-input {
                    font-size: 14px;
                    font-weight: bold;
                    margin-left: 0px; /* 减少左移避免与按钮重叠 */
                    width: 35px !important; /* 进一步减小输入框宽度 */
                    padding: 0 0px !important; /* 完全移除内边距 */
                    text-align: center !important; /* 使文本居中显示 */
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                }
                /* 将精简模式下的权重控制部分左移 */
                [data-layout="simple"] .zml-pll-entry-card > div:last-child {
                    margin-left: -4px;
                    min-width: 70px; /* 调整最小宽度以适配更紧凑的布局 */
                }
                /* 调整精简模式下权重控制按钮的样式 */
                [data-layout="simple"] .zml-weight-btn {
                    padding: 0 0 !important; /* 完全移除内边距 */
                    margin: 0 -2px !important; /* 进一步减小按钮间距离 */
                    font-size: 12px !important; /* 适当减小按钮字体 */
                    width: 16px !important; /* 固定按钮宽度 */
                    min-width: 16px !important;
                }
                .zml-power-lora-loader-container input[type="checkbox"]:hover {
                    border-color: #5d99f2;
                    box-shadow: 0 0 5px rgba(93, 153, 242, 0.4);
                }
                .zml-power-lora-loader-container input[type="checkbox"]:checked:hover {
                    border-color: #4CAF50;
                    box-shadow: 0 0 5px rgba(76, 175, 80, 0.4);
                }
                .zml-power-lora-loader-container input[type="checkbox"]:checked {
                    background-color: #4CAF50;
                    border-color: #4CAF50;
                }
                .zml-power-lora-loader-container input[type="checkbox"]:checked::after {
                    opacity: 1;
                }
                /* End Checkbox */

                /* Input Styles */
                .zml-lora-display-name-input, .zml-lora-weight-input, .zml-lora-custom-text-input {
                    transition: border-color 0.2s, box-shadow 0.2s;
                    border: 1px solid #444;
                    background-color: #2b2b2b;
                }
                .zml-lora-display-name-input:focus, .zml-lora-weight-input:focus, .zml-lora-custom-text-input:focus {
                    border-color: #5d99f2 !important;
                    box-shadow: 0 0 5px rgba(93, 153, 242, 0.4);
                    outline: none;
                }
                .zml-lora-weight-input { /* Weight input specific style */
                    background: none; /* Inherit from parent */
                    border: none; /* Inherit from parent */
                    color: #ddd;
                    height: 100%;
                    padding: 0;
                    margin: 0;
                    text-align: center;
                    font-size: 12px;
                }


                .zml-lora-weight-btn {
                    /* default styles merged with general button styles */
                    background: none;
                    border: none;
                    color: #ccc;
                    cursor: pointer;
                    padding: 0 2px;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .zml-lora-weight-btn:hover { background-color: rgba(255,255,255,0.1); }
                .zml-lora-weight-btn:active { background-color: rgba(255,255,255,0.2); transform: translateY(0); box-shadow: none; }


                .zml-lora-custom-text-input {
                    padding: var(--pll-current-input-padding);
                    height: var(--pll-current-input-height);
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
                /* DND list for entries */
                .zml-pll-entries-list {
                    overflow-y: auto; /* Allow vertical scrolling within the list */
                    flex: 1; /* Make it take available vertical space */
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 0;
                    /* Consider a minimal height for the list if it could be empty,
                       but flex:1 often handles this sufficiently when parent has min-height. */
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
                    /* 避免 margin-right 与其他文件夹 item 影响布局，现在应该与文件夹item统一 */
                }

                /* 主题样式变量 */
                :root {
                    --zml-primary-bg: #31353a;
                    --zml-secondary-bg: #2b2b2b;
                    --zml-border-color: #4a515a;
                    --zml-text-color: #e0e0e0;
                    --zml-button-bg: #444;
                    --zml-button-border: #666;
                    --zml-button-hover-bg: #555;
                    --zml-button-hover-border: #777;
                    --zml-input-bg: #1a1a1a;
                    --zml-input-border: #4a4a4a;
                    --zml-input-focus-border: #5d99f2;
                    --zml-folder-bg: #30353c;
                    --zml-lora-entry-bg: #3a3a3a;
                }

                /* 浅蓝色主题 */
                .theme-light-blue {
                    --zml-primary-bg: #E0F2F7; /* 浅蓝色背景 */
                    --zml-secondary-bg: #F0F8FF; /* 更浅的背景 */
                    --zml-border-color: #A7D9ED;
                    --zml-text-color: #333;
                    --zml-button-bg: #B0E0E6;
                    --zml-button-border: #87CEEB;
                    --zml-button-hover-bg: #ADD8E6;
                    --zml-button-hover-border: #6495ED;
                    --zml-input-bg: #FFFFFF;
                    --zml-input-border: #B0E0E6;
                    --zml-input-focus-border: #6495ED;
                    --zml-folder-bg: #C6E2FF;
                    --zml-lora-entry-bg: #D6EEFF;
                }

                /* 浅绿色主题 */
                .theme-light-green {
                    --zml-primary-bg: #E6F7E6; /* 浅绿色背景 */
                    --zml-secondary-bg: #F0FFF0; /* 更浅的背景 */
                    --zml-border-color: #B3E0B3;
                    --zml-text-color: #333;
                    --zml-button-bg: #C1E1C1;
                    --zml-button-border: #98FB98;
                    --zml-button-hover-bg: #A2D1A2;
                    --zml-button-hover-border: #7CFC00;
                    --zml-input-bg: #FFFFFF;
                    --zml-input-border: #B3E0B3;
                    --zml-input-focus-border: #7CFC00;
                    --zml-folder-bg: #C1FFC1;
                    --zml-lora-entry-bg: #D1FFD1;
                }
            `,
			parent: document.body,
		});

		// 2. 注册设置项
		const displayOptions = {"树状(子文件夹)": 1, "列表(原始)": 0};
		const displaySetting = app.ui.settings.addSetting({
			id: "zml.LoraLoader.DisplayMode", name: "LORA文件夹显示样式", defaultValue: 1, type: "combo",
			options: (value) => Object.entries(displayOptions).map(([k, v]) => ({ value: v, text: k, selected: v === +value})),
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
						const imagePath = loraImages[text]; // This is like "subdir/lora_name.png"
						const fullViewPath = `loras/${imagePath}`; // Ensure correct path for /view API
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
						folderEl.addEventListener("mousedown", (e) => {
							e.stopImmediatePropagation(); // 阻止所有其他事件监听器
							e.preventDefault(); // 阻止默认的 mousedown 行为
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
            function zmlCreateEl(tag, properties = {}, text = "") { // 重命名为 zmlCreateEl
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

                zmlPllModalOverlay = zmlCreateEl("div", { // 使用 zmlCreateEl
                    className: "zml-st3-modal-overlay", // 使用与文本节点相同的类名，保持样式一致
                    style: `
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background-color: rgba(0, 0, 0, 0.75);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10003;
                        display: none; /* 默认隐藏 */
                        backdrop-filter: blur(3px);
                    `
                });

                const modalContainer = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                zmlPllModalTitle = zmlCreateEl("h3", { // 使用 zmlCreateEl
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

                // 创建文本区域包装器
                const textWrapper = zmlCreateEl("div", {
                    style: `
                        position: relative;
                        width: 100%;
                        height: 350px;
                    `
                });
                
                zmlPllModalTextarea = zmlCreateEl("textarea", { // 使用 zmlCreateEl
                    className: "zml-st3-modal-textarea", // 使用与文本节点相同的类名
                    style: `
                        width: 100%;
                        height: 100%;
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
                
                // 将文本区域添加到包装器
                textWrapper.appendChild(zmlPllModalTextarea);

                const buttonGroup = zmlCreateEl("div", { // 使用 zmlCreateEl
                    className: "zml-st3-modal-buttons", // 使用与文本节点相同的类名
                    style: `
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding-top: 10px;
                    `
                });
                
                // 添加注释文本
                const textComment = zmlCreateEl("div", {
                    style: `
                        color: #888;
                        font-size: 14px;
                        padding: 4px 8px;
                    `
                });
                textComment.textContent = "这里的文本从'自定义文本'接口进行输出";
                
                const buttonContainer = zmlCreateEl("div", {
                    style: `
                        display: flex;
                        gap: 12px;
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

                const saveButton = zmlCreateEl("button", { // 使用 zmlCreateEl
                    className: "zml-control-btn zml-st3-modal-save",
                    textContent: "保存",
                    style: `
                        ${baseButtonStyle}
                        background-color: #4CAF50;
                        border: 1px solid #3e8e41;
                        color: white;
                    `
                });
                
                const cancelButton = zmlCreateEl("button", { // 使用 zmlCreateEl
                    className: "zml-control-btn zml-st3-modal-cancel",
                    textContent: "取消",
                    style: `
                        ${baseButtonStyle}
                        background-color: #f44336;
                        border: 1px solid #da190b;
                        color: white;
                    `
                });

                // 将按钮添加到按钮容器
                buttonContainer.append(cancelButton, saveButton);
                // 将按钮容器和注释添加到按钮组
                buttonGroup.append(textComment, buttonContainer);
                modalContainer.append(zmlPllModalTitle, textWrapper, buttonGroup);
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

            // --- 新增：LoRA内容编辑弹窗的变量和函数 ---
            let zmlLoraContentEditModalOverlay = null;
            let zmlLoraContentEditTxtTextarea = null;
            let zmlLoraContentEditLogTextarea = null;
            let zmlLoraContentEditModalTitle = null;
            let zmlLoraContentEditCurrentLoraPath = null;
            let zmlLoraContentEditCurrentLoraName = null;
            // 新增：跟踪已删除的LoRA文件路径
            let zmlDeletedLoraFiles = new Set();

            function createLoraContentEditModal() {
                if (zmlLoraContentEditModalOverlay) return; // 确保只创建一次

                zmlLoraContentEditModalOverlay = zmlCreateEl("div", {
                    className: "zml-st3-modal-overlay",
                    style: `
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background-color: rgba(0, 0, 0, 0.75);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10003;
                        display: none;
                        backdrop-filter: blur(3px);
                    `
                });

                const modalContainer = zmlCreateEl("div", {
                    className: "zml-st3-modal-container",
                    style: `
                        background-color: #31353a;
                        border: 1px solid #4a515a;
                        border-radius: 8px;
                        padding: 20px;
                        min-width: 700px;
                        max-width: 80vw;
                        max-height: 80vh;
                        display: flex;
                        flex-direction: column;
                        gap: 15px;
                        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6);
                        position: relative;
                    `
                });

                // 创建标题和删除按钮的容器
                const titleContainer = zmlCreateEl("div", {
                    style: `
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 2px solid #4a515a;
                        padding-bottom: 15px;
                    `
                });

                zmlLoraContentEditModalTitle = zmlCreateEl("h3", {
                    className: "zml-st3-modal-title",
                    style: `
                        color: #e0e0e0;
                        margin: 0;
                        font-size: 1.3em;
                        font-weight: 600;
                    `,
                    textContent: "编辑 LoRA 内容"
                });

                // 创建删除按钮
                const deleteButton = zmlCreateEl("button", {
                    className: "zml-control-btn zml-st3-modal-delete",
                    textContent: "删除",
                    style: `
                        height: 32px;
                        padding: 0 15px;
                        text-align: center;
                        text-decoration: none;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 13px;
                        font-weight: 500;
                        border-radius: 5px;
                        cursor: pointer;
                        white-space: nowrap;
                        background-color: #ff5252;
                        border: 1px solid #d32f2f;
                        color: white;
                    `
                });

                titleContainer.appendChild(zmlLoraContentEditModalTitle);
                titleContainer.appendChild(deleteButton);

                // 创建标签页容器
                const tabContainer = zmlCreateEl("div", {
                    style: `
                        display: flex;
                        border-bottom: 1px solid #4a515a;
                        margin-bottom: 10px;
                    `
                });

                // 创建txt文件标签
                const txtTab = zmlCreateEl("button", {
                    textContent: "触发词文件 (txt)",
                    style: `
                        padding: 8px 16px;
                        background-color: #4a515a;
                        color: white;
                        border: none;
                        border-top-left-radius: 4px;
                        border-top-right-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                    `
                });

                // 创建log文件标签
                const logTab = zmlCreateEl("button", {
                    textContent: "介绍文件 (log)",
                    style: `
                        padding: 8px 16px;
                        background-color: #31353a;
                        color: #aaa;
                        border: none;
                        border-top-left-radius: 4px;
                        border-top-right-radius: 4px;
                        cursor: pointer;
                    `
                });

                tabContainer.appendChild(txtTab);
                tabContainer.appendChild(logTab);

                // 创建txt文本编辑区域
                zmlLoraContentEditTxtTextarea = zmlCreateEl("textarea", {
                    className: "zml-st3-modal-textarea",
                    style: `
                        width: 100%;
                        height: 400px;
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

                // 创建log文本编辑区域 (默认隐藏)
                zmlLoraContentEditLogTextarea = zmlCreateEl("textarea", {
                    className: "zml-st3-modal-textarea",
                    style: `
                        width: 100%;
                        height: 400px;
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
                        display: none;
                    `
                });

                // 文本框焦点样式
                zmlLoraContentEditTxtTextarea.onfocus = (e) => {
                    e.target.style.borderColor = '#5d99f2';
                    e.target.style.boxShadow = '0 0 8px rgba(93, 153, 242, 0.4)';
                };
                zmlLoraContentEditTxtTextarea.onblur = (e) => {
                    e.target.style.borderColor = '#4a4a4a';
                    e.target.style.boxShadow = 'none';
                };

                zmlLoraContentEditLogTextarea.onfocus = (e) => {
                    e.target.style.borderColor = '#5d99f2';
                    e.target.style.boxShadow = '0 0 8px rgba(93, 153, 242, 0.4)';
                };
                zmlLoraContentEditLogTextarea.onblur = (e) => {
                    e.target.style.borderColor = '#4a4a4a';
                    e.target.style.boxShadow = 'none';
                };

                // 标签切换功能
                txtTab.onclick = () => {
                    zmlLoraContentEditTxtTextarea.style.display = 'block';
                    zmlLoraContentEditLogTextarea.style.display = 'none';
                    txtTab.style.backgroundColor = '#4a515a';
                    txtTab.style.color = 'white';
                    logTab.style.backgroundColor = '#31353a';
                    logTab.style.color = '#aaa';
                    txtComment.style.display = 'block';
                    zmlLoraContentEditTxtTextarea.focus();
                };

                logTab.onclick = () => {
                    zmlLoraContentEditTxtTextarea.style.display = 'none';
                    zmlLoraContentEditLogTextarea.style.display = 'block';
                    txtTab.style.backgroundColor = '#31353a';
                    txtTab.style.color = '#aaa';
                    logTab.style.backgroundColor = '#4a515a';
                    logTab.style.color = 'white';
                    txtComment.style.display = 'none';
                    zmlLoraContentEditLogTextarea.focus();
                };

                const buttonGroup = zmlCreateEl("div", { // 使用 zmlCreateEl
                    className: "zml-st3-modal-buttons", // 使用与文本节点相同的类名
                    style: `
                        display: flex;
                        justify-content: flex-end;
                        padding-top: 10px;
                    `
                });
                
                // 添加注释文本
                const txtComment = zmlCreateEl("div", {
                    style: `
                        position: absolute;
                        bottom: 20px;
                        left: 20px;
                        color: #888;
                        font-size: 14px;
                        z-index: 10;
                        pointer-events: none;
                    `
                });
                txtComment.textContent = "这里的文本从\"触发词\"接口进行输出";
                
                const buttonContainer = zmlCreateEl("div", {
                    style: `
                        display: flex;
                        gap: 12px;
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

                const saveButton = zmlCreateEl("button", {
                    className: "zml-control-btn zml-st3-modal-save",
                    textContent: "保存",
                    style: `
                        ${baseButtonStyle}
                        background-color: #4CAF50;
                        border: 1px solid #3e8e41;
                        color: white;
                    `
                });

                const cancelButton = zmlCreateEl("button", {
                    className: "zml-control-btn zml-st3-modal-cancel",
                    textContent: "取消",
                    style: `
                        ${baseButtonStyle}
                        background-color: #f44336;
                        border: 1px solid #da190b;
                        color: white;
                    `
                });

                // 将按钮添加到按钮容器
                buttonContainer.append(cancelButton, saveButton);
                // 将按钮容器添加到按钮组
                buttonGroup.append(buttonContainer);
                
                modalContainer.append(titleContainer, tabContainer, zmlLoraContentEditTxtTextarea, zmlLoraContentEditLogTextarea, txtComment, buttonGroup);
                zmlLoraContentEditModalOverlay.appendChild(modalContainer);
                document.body.appendChild(zmlLoraContentEditModalOverlay);

                // 绑定事件
                saveButton.onclick = async () => {
                    if (zmlLoraContentEditCurrentLoraPath) {
                        try {
                            // 保存txt文件
                            const txtResponse = await api.fetchApi(`${ZML_API_PREFIX}/save_lora_file`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    "lora_filename": zmlLoraContentEditCurrentLoraPath,
                                    "file_type": "txt",
                                    "content": zmlLoraContentEditTxtTextarea.value
                                })
                            });
                            const txtResult = await txtResponse.json();

                            // 保存log文件
                            const logResponse = await api.fetchApi(`${ZML_API_PREFIX}/save_lora_file`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    "lora_filename": zmlLoraContentEditCurrentLoraPath,
                                    "file_type": "log",
                                    "content": zmlLoraContentEditLogTextarea.value
                                })
                            });
                            const logResult = await logResponse.json();

                            if (txtResult.status === "success" && logResult.status === "success") {
                                alert(`LoRA '${zmlLoraContentEditCurrentLoraName}' 的内容保存成功！`);
                            } else {
                                alert(`保存失败：\n${txtResult.message || ''}\n${logResult.message || ''}`);
                            }
                        } catch (error) {
                            console.error("Error saving lora content:", error);
                            alert(`保存时发生网络错误或服务器错误。请检查控制台。`);
                        }
                    }
                    hideLoraContentEditModal();
                };

                cancelButton.onclick = () => {
                    hideLoraContentEditModal();
                };

                // 删除按钮点击事件
                deleteButton.onclick = async () => {
                    if (zmlLoraContentEditCurrentLoraPath && zmlLoraContentEditCurrentLoraName) {
                        // 显示确认对话框
                        const confirmDelete = confirm(`确定要删除LoRA '${zmlLoraContentEditCurrentLoraName}'及其所有相关文件吗？\n此操作不可撤销！`);
                        if (!confirmDelete) return;

                        try {
                            // 调用API删除文件
                            const response = await api.fetchApi(`${ZML_API_PREFIX}/delete_lora_file`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    "lora_filename": zmlLoraContentEditCurrentLoraPath
                                })
                            });
                            const result = await response.json();

                            if (result.status === "success") {
                                alert(`LoRA '${zmlLoraContentEditCurrentLoraName}' 及其相关文件已成功删除！`);
                                // 添加到已删除列表
                                zmlDeletedLoraFiles.add(zmlLoraContentEditCurrentLoraPath);
                                // 刷新LoRA列表显示
                                if (zmlBatchLoraModalOverlay && zmlBatchLoraModalOverlay.style.display !== 'none') {
                                    renderBatchLoraContent();
                                }
                                hideLoraContentEditModal();
                            } else {
                                alert(`删除失败：\n${result.message || ''}`);
                            }
                        } catch (error) {
                            console.error("Error deleting lora files:", error);
                            alert(`删除时发生网络错误或服务器错误。请检查控制台。`);
                        }
                    }
                };

                // 点击背景关闭
                zmlLoraContentEditModalOverlay.onclick = (e) => {
                    if (e.target === zmlLoraContentEditModalOverlay) {
                        hideLoraContentEditModal();
                    }
                };
            }

            async function showLoraContentEditModal(loraPath, loraName) {
                if (!zmlLoraContentEditModalOverlay) createLoraContentEditModal();

                zmlLoraContentEditCurrentLoraPath = loraPath;
                zmlLoraContentEditCurrentLoraName = loraName;
                zmlLoraContentEditModalTitle.textContent = `编辑 LoRA 内容: ${loraName}`;

                try {
                    // 加载txt文件内容
                    const txtResponse = await api.fetchApi(`${ZML_API_PREFIX}/get_lora_file`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            "lora_filename": loraPath,
                            "file_type": "txt"
                        })
                    });
                    const txtResult = await txtResponse.json();
                    zmlLoraContentEditTxtTextarea.value = txtResult.content || "";

                    // 加载log文件内容
                    const logResponse = await api.fetchApi(`${ZML_API_PREFIX}/get_lora_file`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            "lora_filename": loraPath,
                            "file_type": "log"
                        })
                    });
                    const logResult = await logResponse.json();
                    zmlLoraContentEditLogTextarea.value = logResult.content || "";

                } catch (error) {
                    console.error("Error loading lora content:", error);
                    alert(`加载文件内容时发生网络错误或服务器错误。请检查控制台。`);
                }

                zmlLoraContentEditModalOverlay.style.display = 'flex';
                zmlLoraContentEditTxtTextarea.focus();
            }

            function hideLoraContentEditModal() {
                if (zmlLoraContentEditModalOverlay) {
                    zmlLoraContentEditModalOverlay.style.display = 'none';
                    zmlLoraContentEditCurrentLoraPath = null;
                    zmlLoraContentEditCurrentLoraName = null;
                }
            }
            // --- 结束：LoRA内容编辑弹窗的变量和函数 ---
            let zmlBatchLoraFoldersPanel = null; // 文件夹显示面板
            let zmlBatchLoraGridContainer = null;
            let zmlBatchLoraSelectedCountDisplay = null; // 用于显示选中数量
            let zmlBatchLoraCurrentNodeInstance = null;
            
            // 使用特殊字符串作为“显示所有”的路径标识
            const ALL_LORAS_VIEW_PATH_IDENTIFIER = '__ALL_LORAS_VIEW__'; 
            let zmlBatchLoraCurrentPath = []; 
            let zmlBatchLoraSelected = new Set(); // 存储选中的 LoRA 的 fullpath

            // 全局变量存储当前的展示样式
            let zmlBatchLoraDisplayStyle = 'vertical'; // 默认为竖向
            let zmlBatchLoraPreviewGifMode = false; // GIF预览模式开关
            let zmlBatchLoraPreviewGifButton = null; // GIF预览按钮
            
            
            function createBatchLoraModal() {
                if (zmlBatchLoraModalOverlay) return;

                zmlBatchLoraModalOverlay = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                const modalContainer = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                // 创建头部容器，用于放置标题和样式切换按钮
                const headerContainer = zmlCreateEl("div", { // 使用 zmlCreateEl
                    style: `
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin: 0 0 15px 0;
                        padding-bottom: 10px;
                        border-bottom: 1px solid #4a515a;
                        cursor: move;
                        user-select: none;
                    `
                });
                
                // 创建标题
                const modalHeader = zmlCreateEl("h3", { // 使用 zmlCreateEl
                    textContent: "批量添加 LoRA",
                    style: `color: #e0e0e0; margin: 0; font-size: 1.4em;`
                });
                headerContainer.appendChild(modalHeader);
                
                // 创建显示样式切换控制区域
                const displayStyleControl = zmlCreateEl("div", { // 使用 zmlCreateEl
                    style: `
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 3px 8px;
                        background-color: #2b2b2b;
                        border-radius: 4px;
                    `
                });
                headerContainer.appendChild(displayStyleControl);
                
                const styleLabel = zmlCreateEl("span", { // 使用 zmlCreateEl
                    textContent: "展示样式: ",
                    style: `color: #888; font-size: 12px;`
                });
                displayStyleControl.appendChild(styleLabel);
                
                // 竖向矩形样式按钮 (移到第一位)
                const verticalBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                    textContent: "竖向矩形",
                    style: `
                        padding: 3px 10px;
                        border: 1px solid ${zmlBatchLoraDisplayStyle === 'vertical' ? '#4CAF50' : '#555'};
                        background-color: ${zmlBatchLoraDisplayStyle === 'vertical' ? '#4CAF50' : '#333'};
                        color: #fff;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.2s;
                    `
                });
                verticalBtn.onclick = function() {
                            zmlBatchLoraDisplayStyle = 'vertical';
                            updateStyleButtons([verticalBtn, horizontalBtn, squareBtn]);
                            refreshBatchLoraGrid();
                        };
                displayStyleControl.appendChild(verticalBtn);
                
                // 横向矩形样式按钮 (移到第二位)
                const horizontalBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                    textContent: "横向矩形",
                    style: `
                        padding: 3px 10px;
                        border: 1px solid ${zmlBatchLoraDisplayStyle === 'horizontal' ? '#4CAF50' : '#555'};
                        background-color: ${zmlBatchLoraDisplayStyle === 'horizontal' ? '#4CAF50' : '#333'};
                        color: #fff;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.2s;
                    `
                });
                horizontalBtn.onclick = function() {
                    zmlBatchLoraDisplayStyle = 'horizontal';
                    updateStyleButtons([verticalBtn, horizontalBtn, squareBtn]);
                    refreshBatchLoraGrid();
                };
                displayStyleControl.appendChild(horizontalBtn);

                        // 方形样式按钮
                        const squareBtn = zmlCreateEl("button", {
                            textContent: "方形",
                            style: `
                                padding: 3px 10px;
                                border: 1px solid ${zmlBatchLoraDisplayStyle === 'square' ? '#4CAF50' : '#555'};
                                background-color: ${zmlBatchLoraDisplayStyle === 'square' ? '#4CAF50' : '#333'};
                                color: #fff;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 12px;
                                transition: all 0.2s;
                            `
                        });
                        squareBtn.onclick = function() {
                            zmlBatchLoraDisplayStyle = 'square';
                            updateStyleButtons([verticalBtn, horizontalBtn, squareBtn]);
                            refreshBatchLoraGrid();
                        };
                        displayStyleControl.appendChild(squareBtn);

                        // 创建添加文本控制容器，与展示样式有间隔
                        const addTextContainer = zmlCreateEl("div", {
                            style: `
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                margin-left: 15px; /* 添加间隔 */
                            `
                        });
                        displayStyleControl.appendChild(addTextContainer);

                        // 添加文本标签
                        const addTextLabel = zmlCreateEl("span", {
                            textContent: "添加文本",
                            style: `
                                color: #fff;
                                font-size: 12px;
                                white-space: nowrap;
                            `
                        });
                        addTextContainer.appendChild(addTextLabel);

                        // 添加文本开关
                        globalThis.zmlBatchLoraAddTextToggle = zmlCreateEl("label", {
                            className: "zml-toggle-switch",
                            style: `
                                position: relative;
                                display: inline-block;
                                width: 36px;
                                height: 20px;
                                cursor: pointer;
                            `
                        });

                        // 创建隐藏的input作为开关
                        const toggleInput = zmlCreateEl("input", {
                            type: "checkbox",
                            style: `
                                opacity: 0;
                                width: 0;
                                height: 0;
                            `
                        });
                        toggleInput.checked = zmlBatchLoraAddTextMode;
                        zmlBatchLoraAddTextToggle.appendChild(toggleInput);

                        // 创建开关滑块
                        const toggleSlider = zmlCreateEl("span", {
                            style: `
                                position: absolute;
                                cursor: pointer;
                                top: 0;
                                left: 0;
                                right: 0;
                                bottom: 0;
                                background-color: ${zmlBatchLoraAddTextMode ? '#4CAF50' : '#666'};
                                transition: .3s;
                                border-radius: 20px;
                            `
                        });
                        toggleSlider.innerHTML = `
                            <span style="
                                position: absolute;
                                height: 16px;
                                width: 16px;
                                left: 2px;
                                bottom: 2px;
                                background-color: white;
                                transition: .3s;
                                border-radius: 50%;
                                transform: translateX(${zmlBatchLoraAddTextMode ? '16px' : '0'});
                            "></span>
                        `;
                        zmlBatchLoraAddTextToggle.appendChild(toggleSlider);
                        addTextContainer.appendChild(zmlBatchLoraAddTextToggle);

                        // 统一处理开关的点击事件
                        const toggleAddText = function() {
                            zmlBatchLoraAddTextMode = !zmlBatchLoraAddTextMode;

                            // 更新开关样式
                            toggleInput.checked = zmlBatchLoraAddTextMode;
                            toggleSlider.style.backgroundColor = zmlBatchLoraAddTextMode ? '#4CAF50' : '#666';
                            toggleSlider.querySelector('span').style.transform = `translateX(${zmlBatchLoraAddTextMode ? '16px' : '0'})`;
                            
                            // 添加CSS反馈效果到开关
                            zmlBatchLoraAddTextToggle.style.transform = "scale(1.05)";
                            setTimeout(() => {
                                zmlBatchLoraAddTextToggle.style.transform = "scale(1)";
                            }, 200);
                        };

                        // 重新绑定点击事件，确保生效
                        zmlBatchLoraAddTextToggle.onclick = toggleAddText;
                        toggleInput.onchange = toggleAddText;
                
                // 更新样式按钮状态的函数
                function updateStyleButtons(buttons) {
                            buttons.forEach(btn => {
                                const isActive = btn.textContent === '竖向矩形' && zmlBatchLoraDisplayStyle === 'vertical' ||
                                                btn.textContent === '横向矩形' && zmlBatchLoraDisplayStyle === 'horizontal' ||
                                                btn.textContent === '方形' && zmlBatchLoraDisplayStyle === 'square';
                                                 
                                btn.style.borderColor = isActive ? '#4CAF50' : '#555';
                                btn.style.backgroundColor = isActive ? '#4CAF50' : '#333';
                            });
                        }

                zmlBatchLoraParentPathDisplay = zmlCreateEl("div", { // 使用 zmlCreateEl
                    style: `
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 5px;
                        color: #888;
                        min-height: 24px; /* 保证高度，避免内容为空时塌陷 */
                    `
                });

                zmlBatchLoraFoldersPanel = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                zmlBatchLoraGridContainer = zmlCreateEl("div", { // 使用 zmlCreateEl
                    className: "zml-batch-lora-grid",
                    style: `
                        flex: 1; /* 占据剩余空间 */
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(${zmlBatchLoraDisplayStyle === 'horizontal' ? '200px' : '120px'}, 1fr)); /* 根据显示样式调整网格列宽 */
                        row-gap: 0 !important;
                        column-gap: 0 !important;
                        gap: 0 !important; /* 移除所有间隙 */
                        border-collapse: collapse; /* 确保边框合并，无间隙 */
                        background-clip: padding-box; /* 确保背景不延伸到边框 */
                        border-spacing: 0; /* 确保单元格间距为0 */
                        box-sizing: border-box !important;
                        overflow-y: auto; /* 允许滚动 */
                        padding: 0 !important;
                        border: 1px solid #444;
                        border-radius: 4px;
                        background-color: #2b2b2b;
                    `
                });
                
                // 全局变量存储当前列宽，方便其他函数访问
                let currentColumnWidth = '120px';

                // 初始化时调用一次刷新函数
                refreshBatchLoraGrid();

                // 刷新网格函数
                function refreshBatchLoraGrid() {
                    // 保存当前的网格样式设置
                    const currentStyle = zmlBatchLoraDisplayStyle;

                    // 更新网格容器的列宽
                // 根据不同显示样式设置不同的列宽和行高
                let columnWidthValue;
                let rowHeightValue;

                if (currentStyle === 'horizontal') {
                    columnWidthValue = '200px';
                    rowHeightValue = '100px'; // 横向模式，高度更低
                } else if (currentStyle === 'square') {
                    columnWidthValue = '120px'; // 方形模式，宽高一致
                    rowHeightValue = '120px';
                } else { // vertical
                    columnWidthValue = '120px';
                    rowHeightValue = '200px'; // 竖向模式，高度更高
                }

                zmlBatchLoraGridContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${columnWidthValue}, 1fr))`;
                zmlBatchLoraGridContainer.style.gridAutoRows = rowHeightValue; // 确保行高与计算值一致

                // 根据不同显示样式添加/移除类
                if (currentStyle === 'square') {
                    zmlBatchLoraGridContainer.classList.add('square-mode');
                    zmlBatchLoraGridContainer.classList.remove('horizontal-mode', 'vertical-mode');
                } else if (currentStyle === 'horizontal') {
                    zmlBatchLoraGridContainer.classList.add('horizontal-mode');
                    zmlBatchLoraGridContainer.classList.remove('square-mode', 'vertical-mode');
                } else { // vertical
                    zmlBatchLoraGridContainer.classList.add('vertical-mode');
                    zmlBatchLoraGridContainer.classList.remove('square-mode', 'horizontal-mode');
                }

                    // 更新网格间隙，明确设置行间距和列间距为0以确保无间隙
                    zmlBatchLoraGridContainer.style.rowGap = '0 !important';
                    zmlBatchLoraGridContainer.style.columnGap = '0 !important';
                    zmlBatchLoraGridContainer.style.gap = '0 !important'; // 作为后备

                    // 确保网格项对齐方式不会导致间隙
                    zmlBatchLoraGridContainer.style.alignItems = 'start';
                    zmlBatchLoraGridContainer.style.justifyItems = 'stretch';
                    
                    // 添加额外样式确保无间隙
                    zmlBatchLoraGridContainer.style.borderSpacing = '0 !important';
                    zmlBatchLoraGridContainer.style.borderCollapse = 'collapse !important';
                    
                    // 重新渲染网格
                    renderBatchLoraContent(zmlBatchLoraCurrentNodeInstance);
                }

                const modalFooter = zmlCreateEl("div", { // 使用 zmlCreateEl
                    style: `display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 15px; border-top: 1px solid #4a515a; margin-top: 15px;`
                });

                // 选中数量显示
                zmlBatchLoraSelectedCountDisplay = zmlCreateEl("span", { // 使用 zmlCreateEl
                    textContent: `已选择 0 个 LoRA`,
                    style: `color: #e0e0e0; font-size: 14px;`
                });
                modalFooter.appendChild(zmlBatchLoraSelectedCountDisplay);

                // 主题切换按钮组
                const themeSwitcher = zmlCreateEl("div", {
                    style: `display: flex; align-items: center; gap: 8px; margin-left: 15px;`
                });

                // 主题颜色选项
                const themes = [
                    { id: 'none', color: '#31353a', name: '无色' },
                    { id: 'white', color: '#ffffff', name: '白色' },
                    { id: 'lightblue', color: '#e3f2fd', name: '浅蓝色' },
                    { id: 'lightgreen', color: '#e8f5e9', name: '浅绿色' },
                    { id: 'pink', color: '#fce4ec', name: '粉色' }
                ];

                // 创建颜色主题球按钮
                themes.forEach(theme => {
                    const themeBall = zmlCreateEl("button", {
                        title: theme.name,
                        style: `
                            width: 20px;
                            height: 20px;
                            border-radius: 50%;
                            border: 2px solid ${theme.id === 'none' ? '#4CAF50' : '#555'};
                            background-color: ${theme.color};
                            cursor: pointer;
                            padding: 0;
                            transition: all 0.2s;
                        `
                    });

                    themeBall.onclick = function() {
                        // 更新所有主题按钮的边框颜色
                        themeSwitcher.querySelectorAll('button').forEach(btn => {
                            btn.style.borderColor = '#555';
                        });
                        // 高亮当前选中的主题按钮
                        themeBall.style.borderColor = '#4CAF50';
                        
                        // 更新UI主题
                        applyTheme(theme.id);
                    };

                    themeSwitcher.appendChild(themeBall);
                });

                modalFooter.appendChild(themeSwitcher);

                // 存储当前主题的全局变量
                globalThis.zmlCurrentTheme = 'none';

                // 应用主题的函数
                function applyTheme(themeId) {
                    globalThis.zmlCurrentTheme = themeId;
                    // 获取主要的UI元素
                    const modalContainer = document.querySelector('.zml-batch-lora-modal-container');
                    const foldersPanel = zmlBatchLoraFoldersPanel;
                    const gridContainer = zmlBatchLoraGridContainer;
                    const headerContainer = document.querySelector('.zml-batch-lora-modal-container > div:first-child');
                    const displayStyleControl = document.querySelector('.zml-batch-lora-modal-container > div:first-child > div:last-child');
                    const headerTitle = headerContainer?.querySelector('h3');
                    const styleLabel = displayStyleControl?.querySelector('span');
                    const folderButtons = foldersPanel?.querySelectorAll('button');
                    const addSelectedBtn = document.querySelector('.zml-batch-lora-modal-container button:first-of-type');
                    const closeBtn = document.querySelector('.zml-batch-lora-modal-container button:last-of-type');
                    const styleButtons = displayStyleControl?.querySelectorAll('button');
                    const loraGridItems = gridContainer?.querySelectorAll('.zml-lora-item');
                    const loraItemTexts = gridContainer?.querySelectorAll('.zml-lora-item-text');
                    const imageWrappers = gridContainer?.querySelectorAll('.zml-batch-lora-image-wrapper');
                    const addIcons = gridContainer?.querySelectorAll('.zml-batch-lora-add-icon');
                    const nameDisplays = gridContainer?.querySelectorAll('.zml-batch-lora-item > div:last-child');
                    const pathLinks = zmlBatchLoraParentPathDisplay?.querySelectorAll('a');
                    const pathSeparators = zmlBatchLoraParentPathDisplay?.querySelectorAll('span');
                    const fetchMetadataBtns = gridContainer?.querySelectorAll('.zml-batch-lora-fetch-from-civitai-btn');
                    const overlays = gridContainer?.querySelectorAll('.zml-batch-lora-item-overlay');
                    const deletedOverlays = gridContainer?.querySelectorAll('.zml-batch-lora-deleted-overlay');
                    const deletedTexts = gridContainer?.querySelectorAll('.zml-batch-lora-deleted-text');
                    
                    if (!modalContainer || !foldersPanel || !gridContainer || !headerContainer) return;

                    // 根据主题ID应用不同的样式
                    if (themeId === 'none') {
                        // 无色主题（默认样式）- 降低亮度
                        modalContainer.style.backgroundColor = '#25292d';
                        modalContainer.style.borderColor = '#4a515a';
                        foldersPanel.style.backgroundColor = '#25292d';
                        foldersPanel.style.borderBottomColor = '#3c3c3c';
                        gridContainer.style.backgroundColor = '#1f1f1f';
                        gridContainer.style.borderColor = '#444';
                        headerContainer.style.backgroundColor = '#1a1a1a';
                        headerContainer.style.borderBottomColor = '#333333';
                        if (displayStyleControl) {
                            displayStyleControl.style.backgroundColor = '#121212';
                        }
                        
                        // 降低其他元素亮度
                        modalContainer.style.backgroundColor = '#121212';
                        modalContainer.style.borderColor = '#333333';
                        foldersPanel.style.backgroundColor = '#121212';
                        foldersPanel.style.borderBottomColor = '#333333';
                        gridContainer.style.backgroundColor = '#121212';
                        gridContainer.style.borderColor = '#333333';
                        
                        // 文本颜色
                        if (headerTitle) headerTitle.style.color = '#e0e0e0';
                        if (styleLabel) styleLabel.style.color = '#888';
                        zmlBatchLoraSelectedCountDisplay.style.color = '#e0e0e0';
                        
                        // 路径链接和分隔符颜色
                        if (pathLinks) {
                            pathLinks.forEach(link => {
                                link.style.color = '#e0e0e0';
                            });
                        }
                        if (pathSeparators) {
                            pathSeparators.forEach(sep => {
                                sep.style.color = '#4a515a';
                            });
                        }
                        
                        // 按钮颜色
                        if (addSelectedBtn) {
                            addSelectedBtn.style.backgroundColor = '#4CAF50';
                            addSelectedBtn.style.borderColor = '#3e8e41';
                            addSelectedBtn.style.color = 'white';
                        }
                        if (closeBtn) {
                            closeBtn.style.backgroundColor = '#f44336';
                            closeBtn.style.borderColor = '#da190b';
                            closeBtn.style.color = 'white';
                        }
                        
                        // 样式按钮颜色
                        if (styleButtons) {
                            styleButtons.forEach(btn => {
                                const isActive = btn.textContent === '竖向矩形' && zmlBatchLoraDisplayStyle === 'vertical' ||
                                              btn.textContent === '横向矩形' && zmlBatchLoraDisplayStyle === 'horizontal' ||
                                              btn.textContent === '方形' && zmlBatchLoraDisplayStyle === 'square' ||
                                              btn.textContent === 'MP4预览' && zmlBatchLoraPreviewMp4Mode;
                                              
                                btn.style.borderColor = isActive ? '#4CAF50' : '#555';
                                btn.style.backgroundColor = isActive ? '#4CAF50' : '#333';
                                btn.style.color = '#fff';
                            });
                        }
                        
                        // 文件夹按钮颜色
                        if (folderButtons) {
                            folderButtons.forEach(btn => {
                                btn.style.color = '#888';
                            });
                        }
                        
                        // LoRA网格项文本颜色
                        if (loraItemTexts) {
                            loraItemTexts.forEach(text => {
                                text.style.color = '#ddd';
                            });
                        }
                        
                        // 无预览图样式
                        if (imageWrappers) {
                            imageWrappers.forEach(wrapper => {
                                if (wrapper.style.backgroundColor === 'transparent' || !wrapper.style.backgroundColor) return;
                                wrapper.style.backgroundColor = '#252525';
                                wrapper.style.color = '#888';
                            });
                        }
                        
                        // 添加LoRA按钮样式
                        if (addIcons) {
                            addIcons.forEach(icon => {
                                icon.style.backgroundColor = 'rgba(0, 128, 0, 0.8)';
                                icon.style.color = 'white';
                            });
                        }
                        
                        // LoRA名称显示样式
                        if (nameDisplays) {
                            nameDisplays.forEach(display => {
                                display.style.backgroundColor = 'rgba(0,0,0,0.7)';
                                display.style.color = '#fff';
                            });
                        }
                        
                        // 元数据获取按钮样式
                        if (fetchMetadataBtns) {
                            fetchMetadataBtns.forEach(btn => {
                                btn.style.backgroundColor = 'rgba(0,0,0,0.5)';
                                btn.style.color = '#888';
                            });
                        }
                        
                        // 选中覆盖层样式
                        if (overlays) {
                            overlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
                            });
                        }
                        
                        // 删除标记样式
                        if (deletedOverlays) {
                            deletedOverlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
                            });
                        }
                        if (deletedTexts) {
                            deletedTexts.forEach(text => {
                                text.style.color = '#ff0000';
                                text.style.backgroundColor = 'rgba(0,0,0,0.5)';
                            });
                        }
                    } else if (themeId === 'lightblue') {
                        // 浅蓝色主题 - 降低亮度，确保文本清晰
                        modalContainer.style.backgroundColor = '#8fa8c1';
                        modalContainer.style.borderColor = '#5a7a9a';
                        foldersPanel.style.backgroundColor = '#8fa8c1';
                        foldersPanel.style.borderBottomColor = '#5a7a9a';
                        gridContainer.style.backgroundColor = '#7298bc';
                        gridContainer.style.borderColor = '#5a7a9a';
                        headerContainer.style.backgroundColor = '#8fa8c1';
                        headerContainer.style.borderBottomColor = '#5a7a9a';
                        if (displayStyleControl) {
                            displayStyleControl.style.backgroundColor = '#7298bc';
                        }
                        
                        // 文本颜色 - 使用更深的颜色确保可读性
                        if (headerTitle) headerTitle.style.color = '#0d1b2a';
                        if (styleLabel) styleLabel.style.color = '#1a237e';
                        zmlBatchLoraSelectedCountDisplay.style.color = '#0d1b2a';
                        
                        // 按钮颜色
                        if (addSelectedBtn) {
                            addSelectedBtn.style.backgroundColor = '#4CAF50';
                            addSelectedBtn.style.borderColor = '#3e8e41';
                            addSelectedBtn.style.color = 'white';
                        }
                        if (closeBtn) {
                            closeBtn.style.backgroundColor = '#f44336';
                            closeBtn.style.borderColor = '#da190b';
                            closeBtn.style.color = 'white';
                        }
                        
                        // 样式按钮颜色
                        if (styleButtons) {
                            styleButtons.forEach(btn => {
                                const isActive = btn.textContent === '竖向矩形' && zmlBatchLoraDisplayStyle === 'vertical' ||
                                              btn.textContent === '横向矩形' && zmlBatchLoraDisplayStyle === 'horizontal' ||
                                              btn.textContent === '方形' && zmlBatchLoraDisplayStyle === 'square' ||
                                              btn.textContent === 'MP4预览' && zmlBatchLoraPreviewMp4Mode;
                                              
                                btn.style.borderColor = isActive ? '#1a237e' : '#90caf9';
                                btn.style.backgroundColor = isActive ? '#283593' : '#90caf9';
                                btn.style.color = '#fff';
                            });
                        }
                        
                        // 文件夹按钮颜色
                        if (folderButtons) {
                            folderButtons.forEach(btn => {
                                btn.style.color = '#1a237e';
                            });
                        }
                        
                        // LoRA网格项文本颜色
                        if (loraItemTexts) {
                            loraItemTexts.forEach(text => {
                                text.style.color = '#0d1b2a';
                            });
                        }
                        
                        // 路径链接和分隔符颜色
                        if (pathLinks) {
                            pathLinks.forEach(link => {
                                link.style.color = '#0d1b2a';
                            });
                        }
                        if (pathSeparators) {
                            pathSeparators.forEach(sep => {
                                sep.style.color = '#78a5cd';
                            });
                        }
                        
                        // 无预览图样式
                        if (imageWrappers) {
                            imageWrappers.forEach(wrapper => {
                                if (wrapper.style.backgroundColor === 'transparent' || !wrapper.style.backgroundColor) return;
                                wrapper.style.backgroundColor = '#78a5cd';
                                wrapper.style.color = '#0d1b2a';
                            });
                        }
                        
                        // 添加LoRA按钮样式
                        if (addIcons) {
                            addIcons.forEach(icon => {
                                icon.style.backgroundColor = 'rgba(33, 150, 243, 0.8)';
                                icon.style.color = 'white';
                            });
                        }
                        
                        // LoRA名称显示样式
                        if (nameDisplays) {
                            nameDisplays.forEach(display => {
                                display.style.backgroundColor = 'rgba(120, 165, 205, 0.7)';
                                display.style.color = '#0d1b2a';
                            });
                        }
                        
                        // 元数据获取按钮样式
                        if (fetchMetadataBtns) {
                            fetchMetadataBtns.forEach(btn => {
                                btn.style.backgroundColor = 'rgba(120, 165, 205, 0.5)';
                                btn.style.color = '#0d1b2a';
                            });
                        }
                        
                        // 选中覆盖层样式
                        if (overlays) {
                            overlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(120, 165, 205, 0.5)';
                            });
                        }
                        
                        // 删除标记样式
                        if (deletedOverlays) {
                            deletedOverlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(211, 47, 47, 0.3)';
                            });
                        }
                        if (deletedTexts) {
                            deletedTexts.forEach(text => {
                                text.style.color = '#d32f2f';
                                text.style.backgroundColor = 'rgba(120, 165, 205, 0.5)';
                            });
                        }
                    } else if (themeId === 'white') {
                        // 白色主题 - 明亮背景，深色文本
                        modalContainer.style.backgroundColor = '#ffffff';
                        modalContainer.style.borderColor = '#e0e0e0';
                        foldersPanel.style.backgroundColor = '#f5f5f5';
                        foldersPanel.style.borderBottomColor = '#e0e0e0';
                        gridContainer.style.backgroundColor = '#fafafa';
                        gridContainer.style.borderColor = '#e0e0e0';
                        headerContainer.style.backgroundColor = '#ffffff';
                        headerContainer.style.borderBottomColor = '#e0e0e0';
                        if (displayStyleControl) {
                            displayStyleControl.style.backgroundColor = '#fafafa';
                        }

                        // 文本颜色 - 深色确保可读性
                        if (headerTitle) headerTitle.style.color = '#333333';
                        if (styleLabel) styleLabel.style.color = '#555555';
                        zmlBatchLoraSelectedCountDisplay.style.color = '#333333';

                        // 按钮颜色
                        if (addSelectedBtn) {
                            addSelectedBtn.style.backgroundColor = '#4285f4';
                            addSelectedBtn.style.borderColor = '#2b71d9';
                            addSelectedBtn.style.color = 'white';
                        }
                        if (closeBtn) {
                            closeBtn.style.backgroundColor = '#c62828';
                            closeBtn.style.borderColor = '#8e0000';
                            closeBtn.style.color = 'white';
                        }

                        // 样式按钮颜色
                        if (styleButtons) {
                            styleButtons.forEach(btn => {
                                const isActive = btn.textContent === '竖向矩形' && zmlBatchLoraDisplayStyle === 'vertical' ||
                                              btn.textContent === '横向矩形' && zmlBatchLoraDisplayStyle === 'horizontal' ||
                                              btn.textContent === '方形' && zmlBatchLoraDisplayStyle === 'square' ||
                                              btn.textContent === '关闭视频预览' && zmlBatchLoraPreviewMp4Mode;

                                btn.style.borderColor = isActive ? '#4285f4' : '#e0e0e0';
                                btn.style.backgroundColor = isActive ? '#4285f4' : '#ffffff';
                                btn.style.color = isActive ? '#fff' : '#555555';
                            });
                        }

                        // 文件夹按钮颜色
                        if (folderButtons) {
                            folderButtons.forEach(btn => {
                                btn.style.color = '#4285f4';
                            });
                        }

                        // LoRA网格项文本颜色
                        if (loraItemTexts) {
                            loraItemTexts.forEach(text => {
                                text.style.color = '#333333';
                            });
                        }

                        // 路径链接和分隔符颜色
                        if (pathLinks) {
                            pathLinks.forEach(link => {
                                link.style.color = '#4285f4';
                            });
                        }
                        if (pathSeparators) {
                            pathSeparators.forEach(sep => {
                                sep.style.color = '#e0e0e0';
                            });
                        }

                        // 无预览图样式
                        if (imageWrappers) {
                            imageWrappers.forEach(wrapper => {
                                if (wrapper.style.backgroundColor === 'transparent' || !wrapper.style.backgroundColor) return;
                                wrapper.style.backgroundColor = '#e0e0e0';
                                wrapper.style.color = '#333333';
                            });
                        }

                        // 添加LoRA按钮样式
                        if (addIcons) {
                            addIcons.forEach(icon => {
                                icon.style.backgroundColor = 'rgba(66, 133, 244, 0.8)';
                                icon.style.color = 'white';
                            });
                        }

                        // LoRA名称显示样式
                        if (nameDisplays) {
                            nameDisplays.forEach(display => {
                                display.style.backgroundColor = 'rgba(224, 224, 224, 0.7)';
                                display.style.color = '#333333';
                            });
                        }

                        // 元数据获取按钮样式
                        if (fetchMetadataBtns) {
                            fetchMetadataBtns.forEach(btn => {
                                btn.style.backgroundColor = 'rgba(224, 224, 224, 0.5)';
                                btn.style.color = '#333333';
                            });
                        }

                        // 选中覆盖层样式
                        if (overlays) {
                            overlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(66, 133, 244, 0.3)';
                            });
                        }

                        // 删除标记样式
                        if (deletedOverlays) {
                            deletedOverlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(211, 47, 47, 0.3)';
                            });
                        }
                        if (deletedTexts) {
                            deletedTexts.forEach(text => {
                                text.style.color = '#d32f2f';
                                text.style.backgroundColor = 'rgba(224, 224, 224, 0.5)';
                            });
                        }
                    } else if (themeId === 'lightgreen') {
                        // 浅绿色主题 - 降低亮度，确保文本清晰
                        modalContainer.style.backgroundColor = '#a5c09c';
                        modalContainer.style.borderColor = '#4d9a51';
                        foldersPanel.style.backgroundColor = '#a5c09c';
                        foldersPanel.style.borderBottomColor = '#4d9a51';
                        gridContainer.style.backgroundColor = '#7dac58';
                        gridContainer.style.borderColor = '#4d9a51';
                        headerContainer.style.backgroundColor = '#a5c09c';
                        headerContainer.style.borderBottomColor = '#4d9a51';
                        if (displayStyleControl) {
                            displayStyleControl.style.backgroundColor = '#7dac58';
                        }
                        
                        // 文本颜色 - 使用更深的颜色确保可读性
                        if (headerTitle) headerTitle.style.color = '#1b5e20';
                        if (styleLabel) styleLabel.style.color = '#2e7d32';
                        zmlBatchLoraSelectedCountDisplay.style.color = '#1b5e20';
                        
                        // 按钮颜色
                        if (addSelectedBtn) {
                            addSelectedBtn.style.backgroundColor = '#2e7d32';
                            addSelectedBtn.style.borderColor = '#1b5e20';
                            addSelectedBtn.style.color = 'white';
                        }
                        if (closeBtn) {
                            closeBtn.style.backgroundColor = '#c62828';
                            closeBtn.style.borderColor = '#8e0000';
                            closeBtn.style.color = 'white';
                        }
                        
                        // 样式按钮颜色
                        if (styleButtons) {
                            styleButtons.forEach(btn => {
                                const isActive = btn.textContent === '竖向矩形' && zmlBatchLoraDisplayStyle === 'vertical' ||
                                              btn.textContent === '横向矩形' && zmlBatchLoraDisplayStyle === 'horizontal' ||
                                              btn.textContent === '方形' && zmlBatchLoraDisplayStyle === 'square' ||
                                              btn.textContent === 'MP4预览' && zmlBatchLoraPreviewMp4Mode;
                                              
                                btn.style.borderColor = isActive ? '#1b5e20' : '#81c784';
                                btn.style.backgroundColor = isActive ? '#2e7d32' : '#81c784';
                                btn.style.color = '#fff';
                            });
                        }
                        
                        // 文件夹按钮颜色
                        if (folderButtons) {
                            folderButtons.forEach(btn => {
                                btn.style.color = '#2e7d32';
                            });
                        }
                        
                        // LoRA网格项文本颜色
                        if (loraItemTexts) {
                            loraItemTexts.forEach(text => {
                                text.style.color = '#1b5e20';
                            });
                        }
                        
                        // 路径链接和分隔符颜色
                        if (pathLinks) {
                            pathLinks.forEach(link => {
                                link.style.color = '#1b5e20';
                            });
                        }
                        if (pathSeparators) {
                            pathSeparators.forEach(sep => {
                                sep.style.color = '#66bb6a';
                            });
                        }
                        
                        // 无预览图样式
                        if (imageWrappers) {
                            imageWrappers.forEach(wrapper => {
                                if (wrapper.style.backgroundColor === 'transparent' || !wrapper.style.backgroundColor) return;
                                wrapper.style.backgroundColor = '#66bb6a';
                                wrapper.style.color = '#1b5e20';
                            });
                        }
                        
                        // 添加LoRA按钮样式
                        if (addIcons) {
                            addIcons.forEach(icon => {
                                icon.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
                                icon.style.color = 'white';
                            });
                        }
                        
                        // LoRA名称显示样式
                        if (nameDisplays) {
                            nameDisplays.forEach(display => {
                                display.style.backgroundColor = 'rgba(102, 187, 106, 0.7)';
                                display.style.color = '#1b5e20';
                            });
                        }
                        
                        // 元数据获取按钮样式
                        if (fetchMetadataBtns) {
                            fetchMetadataBtns.forEach(btn => {
                                btn.style.backgroundColor = 'rgba(102, 187, 106, 0.5)';
                                btn.style.color = '#1b5e20';
                            });
                        }
                        
                        // 选中覆盖层样式
                        if (overlays) {
                            overlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(102, 187, 106, 0.5)';
                            });
                        }
                        
                        // 删除标记样式
                        if (deletedOverlays) {
                            deletedOverlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(220, 0, 0, 0.3)';
                            });
                        }
                        if (deletedTexts) {
                            deletedTexts.forEach(text => {
                                text.style.color = '#dc0000';
                                text.style.backgroundColor = 'rgba(102, 187, 106, 0.5)';
                            });
                        }
                    } else if (themeId === 'pink') {
                        // 粉色主题 - 柔和粉色背景，深色文本
                        modalContainer.style.backgroundColor = '#ffebee';
                        modalContainer.style.borderColor = '#f48fb1';
                        foldersPanel.style.backgroundColor = '#ffebee';
                        foldersPanel.style.borderBottomColor = '#f48fb1';
                        gridContainer.style.backgroundColor = '#fce4ec';
                        gridContainer.style.borderColor = '#f48fb1';
                        headerContainer.style.backgroundColor = '#ffebee';
                        headerContainer.style.borderBottomColor = '#f48fb1';
                        if (displayStyleControl) {
                            displayStyleControl.style.backgroundColor = '#fce4ec';
                        }

                        // 文本颜色 - 深色确保可读性
                        if (headerTitle) headerTitle.style.color = '#880e4f';
                        if (styleLabel) styleLabel.style.color = '#ad1457';
                        zmlBatchLoraSelectedCountDisplay.style.color = '#880e4f';

                        // 按钮颜色
                        if (addSelectedBtn) {
                            addSelectedBtn.style.backgroundColor = '#e91e63';
                            addSelectedBtn.style.borderColor = '#c2185b';
                            addSelectedBtn.style.color = 'white';
                        }
                        if (closeBtn) {
                            closeBtn.style.backgroundColor = '#c62828';
                            closeBtn.style.borderColor = '#8e0000';
                            closeBtn.style.color = 'white';
                        }

                        // 样式按钮颜色
                        if (styleButtons) {
                            styleButtons.forEach(btn => {
                                const isActive = btn.textContent === '竖向矩形' && zmlBatchLoraDisplayStyle === 'vertical' ||
                                              btn.textContent === '横向矩形' && zmlBatchLoraDisplayStyle === 'horizontal' ||
                                              btn.textContent === '方形' && zmlBatchLoraDisplayStyle === 'square' ||
                                              btn.textContent === '关闭视频预览' && zmlBatchLoraPreviewMp4Mode;

                                btn.style.borderColor = isActive ? '#c2185b' : '#f8bbd0';
                                btn.style.backgroundColor = isActive ? '#e91e63' : '#f8bbd0';
                                btn.style.color = '#fff';
                            });
                        }

                        // 文件夹按钮颜色
                        if (folderButtons) {
                            folderButtons.forEach(btn => {
                                btn.style.color = '#ad1457';
                            });
                        }

                        // LoRA网格项文本颜色
                        if (loraItemTexts) {
                            loraItemTexts.forEach(text => {
                                text.style.color = '#880e4f';
                            });
                        }

                        // 路径链接和分隔符颜色
                        if (pathLinks) {
                            pathLinks.forEach(link => {
                                link.style.color = '#e91e63';
                            });
                        }
                        if (pathSeparators) {
                            pathSeparators.forEach(sep => {
                                sep.style.color = '#f8bbd0';
                            });
                        }

                        // 无预览图样式
                        if (imageWrappers) {
                            imageWrappers.forEach(wrapper => {
                                if (wrapper.style.backgroundColor === 'transparent' || !wrapper.style.backgroundColor) return;
                                wrapper.style.backgroundColor = '#f8bbd0';
                                wrapper.style.color = '#880e4f';
                            });
                        }

                        // 添加LoRA按钮样式
                        if (addIcons) {
                            addIcons.forEach(icon => {
                                icon.style.backgroundColor = 'rgba(233, 30, 99, 0.8)';
                                icon.style.color = 'white';
                            });
                        }

                        // LoRA名称显示样式
                        if (nameDisplays) {
                            nameDisplays.forEach(display => {
                                display.style.backgroundColor = 'rgba(248, 187, 208, 0.7)';
                                display.style.color = '#880e4f';
                            });
                        }

                        // 元数据获取按钮样式
                        if (fetchMetadataBtns) {
                            fetchMetadataBtns.forEach(btn => {
                                btn.style.backgroundColor = 'rgba(248, 187, 208, 0.5)';
                                btn.style.color = '#880e4f';
                            });
                        }

                        // 选中覆盖层样式
                        if (overlays) {
                            overlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(233, 30, 99, 0.3)';
                            });
                        }

                        // 删除标记样式
                        if (deletedOverlays) {
                            deletedOverlays.forEach(overlay => {
                                overlay.style.backgroundColor = 'rgba(211, 47, 47, 0.3)';
                            });
                        }
                        if (deletedTexts) {
                            deletedTexts.forEach(text => {
                                text.style.color = '#d32f2f';
                                text.style.backgroundColor = 'rgba(248, 187, 208, 0.5)';
                            });
                        }
                    }
                }

                const buttonGroupRight = zmlCreateEl("div", { // 使用 zmlCreateEl
                    style: `display: flex; gap: 12px;`
                });

                const addSelectedBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                    textContent: "添加选中 LoRA",
                    className: "zml-control-btn zml-st3-modal-save", // 复用样式
                    style: `height: 38px; padding: 0 25px; font-size: 15px;`
                });
                addSelectedBtn.onclick = () => {
                    handleBatchAddLora(); // 调用新的处理函数
                };

                const closeBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                    textContent: "关闭",
                    className: "zml-control-btn zml-st3-modal-cancel", // 复用样式
                    style: `height: 38px; padding: 0 25px; font-size: 15px;`
                });
                closeBtn.onclick = hideBatchLoraModal;

                buttonGroupRight.append(addSelectedBtn, closeBtn);
                modalFooter.appendChild(buttonGroupRight);

                modalContainer.append(headerContainer, zmlBatchLoraParentPathDisplay, zmlBatchLoraFoldersPanel, zmlBatchLoraGridContainer, modalFooter);
                zmlBatchLoraModalOverlay.appendChild(modalContainer);
                document.body.appendChild(zmlBatchLoraModalOverlay);

                // 添加窗口拖动功能
                let isDragging = false;
                let offsetX, offsetY;
                let originalPosition;
                
                headerContainer.onmousedown = function(e) {
                    // 防止在点击按钮时触发拖动
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') {
                        return;
                    }
                    
                    isDragging = true;
                    
                    // 获取模态框当前位置
                    const modalRect = modalContainer.getBoundingClientRect();
                    
                    // 计算鼠标相对于模态框的位置
                    offsetX = e.clientX - modalRect.left;
                    offsetY = e.clientY - modalRect.top;
                    
                    // 记录初始位置
                    originalPosition = {
                        left: modalRect.left,
                        top: modalRect.top
                    };
                    
                    // 提升模态框层级，防止拖动时被其他元素覆盖
                    modalContainer.style.zIndex = 10002;
                };
                
                document.onmousemove = function(e) {
                    if (!isDragging) return;
                    
                    // 计算新位置
                    let newLeft = e.clientX - offsetX;
                    let newTop = e.clientY - offsetY;
                    
                    // 限制在视口内
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    const modalWidth = modalContainer.offsetWidth;
                    const modalHeight = modalContainer.offsetHeight;
                    
                    newLeft = Math.max(0, Math.min(newLeft, viewportWidth - modalWidth));
                    newTop = Math.max(0, Math.min(newTop, viewportHeight - modalHeight));
                    
                    // 应用新位置
                    modalContainer.style.left = `${newLeft}px`;
                    modalContainer.style.top = `${newTop}px`;
                    modalContainer.style.transform = 'none'; // 禁用transform以确保left和top生效
                };
                
                document.onmouseup = function() {
                    if (isDragging) {
                        isDragging = false;
                        modalContainer.style.zIndex = ''; // 恢复默认层级
                    }
                };
                
                // 添加样式，确保模态框可以被定位
                modalContainer.style.position = 'fixed';
                modalContainer.style.left = '50%';
                modalContainer.style.top = '50%';
                modalContainer.style.transform = 'translate(-50%, -50%)';

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
                if (!zmlBatchLoraParentPathDisplay || !zmlBatchLoraFoldersPanel || !zmlBatchLoraGridContainer) return;

                zmlBatchLoraParentPathDisplay.innerHTML = "";
                zmlBatchLoraFoldersPanel.innerHTML = "";
                zmlBatchLoraGridContainer.innerHTML = "";

                // 判断是否是“全部显示”模式
                const isShowingAllLoras = zmlBatchLoraCurrentPath.length === 1 && zmlBatchLoraCurrentPath[0] === ALL_LORAS_VIEW_PATH_IDENTIFIER;

                // --- 渲染面包屑导航 (路径) ---
                if (!isShowingAllLoras && zmlBatchLoraCurrentPath.length > 0) { // 在非“全部显示”模式且不在根目录时显示返回按钮
                    const backButton = zmlCreateEl("a", { // 使用 zmlCreateEl
                        textContent: "返回", // ✅ 修正：添加缺失的引号
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
                    const separator = zmlCreateEl("span", { textContent: " | ", style: "color:#4a515a;" }); // 使用 zmlCreateEl
                    zmlBatchLoraParentPathDisplay.appendChild(separator);
                }
                
                // “全部” LoRA 按钮（放置在Root旁边）
                const allLorasBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                    className: "zml-batch-lora-all-loras-btn zml-batch-lora-folder-item", // 复用文件夹item样式
                    textContent: "全部",
                    title: "展示所有 LoRA 文件，无论所在文件夹",
                    style: `
                        display: flex;
                        align-items: center;
                        justify-content: center; /* 居中显示文本 */
                        gap: 3px;
                        cursor: pointer;
                        padding: 3px 6px;
                        border-radius: 4px;
                        background-color: ${isShowingAllLoras ? '#5d99f2' : '#3f454d'}; /* 选中时高亮 */
                        border: 1px solid ${isShowingAllLoras ? '#5d99f2' : '#555'};
                        color: #ccc;
                        font-size: 13px;
                        white-space: nowrap;
                        flex-shrink: 0; /* 防止被挤压 */
                        transition: background-color 0.2s, border-color 0.2s;
                    `
                });
                allLorasBtn.onmouseenter = (e) => e.target.style.backgroundColor = isShowingAllLoras ? '#5d99f2' : '#5a626d';
                allLorasBtn.onmouseleave = (e) => e.target.style.backgroundColor = isShowingAllLoras ? '#5d99f2' : '#3f454d';
                allLorasBtn.onclick = (e) => {
                    e.stopPropagation();
                    zmlBatchLoraCurrentPath = [ALL_LORAS_VIEW_PATH_IDENTIFIER]; // 设置为“全部显示”模式
                    renderBatchLoraContent();
                };
                zmlBatchLoraParentPathDisplay.appendChild(allLorasBtn); // 放在Root链接后，面包屑分隔符前

                const separatorAfterAll = zmlCreateEl("span", { textContent: " | ", style: "color:#4a515a;" }); // 使用 zmlCreateEl
                zmlBatchLoraParentPathDisplay.appendChild(separatorAfterAll);


                const rootLink = zmlCreateEl("a", { // 使用 zmlCreateEl
                    textContent: "Root",
                    href: "#",
                    style: `color: ${zmlBatchLoraCurrentPath.length === 0 && !isShowingAllLoras ? '#ffffff' : '#4da6ff'}; text-decoration: none; cursor: pointer; font-weight: 500;`
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
                        // All LORAS view identifier should not be part of the navigable path breadcrumbs
                        if (part === ALL_LORAS_VIEW_PATH_IDENTIFIER) return; 

                        currentPathAccumulate.push(part);
                        // 增强路径显示样式，使用更鲜明的颜色
                        const separator = zmlCreateEl("span", { textContent: " > ", style: "color:#ccc; font-weight: bold;" }); // 使用 zmlCreateEl
                        zmlBatchLoraParentPathDisplay.appendChild(separator);

                        const pathLink = zmlCreateEl("a", { // 使用 zmlCreateEl
                            textContent: part,
                            href: "#",
                            style: `color: ${index === zmlBatchLoraCurrentPath.length - 1 ? '#ffffff' : '#4da6ff'}; text-decoration: none; cursor: pointer; font-weight: 500;`
                        });
                        pathLink.onmouseenter = (e) => e.target.style.textDecoration = 'underline';
                        pathLink.onmouseleave = (e) => e.target.style.textDecoration = 'none';
                        const pathCopy = Array.from(currentPathAccumulate); // 复制一份，防止闭包问题
                        pathLink.onclick = (e) => {
                            e.preventDefault();
                            zmlBatchLoraCurrentPath = pathCopy;
                            renderBatchLoraContent();
                        };
                        zmlBatchLoraParentPathDisplay.appendChild(pathLink);
                    });
                }
                
                // 获取当前要显示的内容
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
                    const foldersToDisplay = Object.keys(currentContent.folders).sort();
                    filesToDisplay = (currentContent.files || []).sort((a,b) => a.name.localeCompare(b.name));

                     // 仅在非“全部显示”模式下且存在子文件夹时才显示文件夹面板
                    if(foldersToDisplay.length > 0) {
                        zmlBatchLoraFoldersPanel.style.display = 'flex'; // 显示文件夹面板
                        zmlBatchLoraParentPathDisplay.style.borderBottom = 'none'; // 路径底部不需要线
                        foldersToDisplay.forEach(folderName => { // 渲染子文件夹
                            const folderEl = zmlCreateEl("div", { // 使用 zmlCreateEl
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
                                // 正常进入子文件夹
                                zmlBatchLoraCurrentPath.push(folderName);
                                renderBatchLoraContent();
                            };
                            folderEl.innerHTML = `<span style="font-size: 14px;">📁</span><span>${folderName}</span>`;
                            zmlBatchLoraFoldersPanel.appendChild(folderEl);
                        });
                        

                    } else {
                        zmlBatchLoraFoldersPanel.style.display = 'none'; // 如果没有文件夹，则隐藏这一行
                        zmlBatchLoraParentPathDisplay.style.borderBottom = '1px solid #3c3c3c'; // 如果隐藏文件夹栏，则路径底部加线
                    }
                }
                
                // 渲染 LoRA 文件
                filesToDisplay.forEach(file => {
                    const loraPath = file.fullpath; // This is the relative path, e.g., "Char/Char1.safetensors"
                    const hasPreview = !!loraImages[loraPath];
                    const isSelected = zmlBatchLoraSelected.has(loraPath);
                    const isDeleted = zmlDeletedLoraFiles.has(loraPath);
                    // The /view API expects "loras/subdir/image.ext" from the client.
                    const civitaiPreviewUrl = loraImages[loraPath] ? `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(loraImages[loraPath])}?${+new Date()}` : '';
                    // 新增：MP4预览模式处理
                    let previewUrl = civitaiPreviewUrl;
                    let isMp4Preview = false;
                    // 初始化播放状态对象（如果不存在）
                    if (!globalThis.zmlLoraVideoPlayStates) {
                        globalThis.zmlLoraVideoPlayStates = {};
                    }
                    // 检查是否启用了MP4预览模式，并且存在对应的MP4文件
                    if (globalThis.zmlLoraVideoPlayStates[loraPath] && globalThis.zmlMp4Previews && globalThis.zmlMp4Previews[loraPath]) {
                        const mp4Path = globalThis.zmlMp4Previews[loraPath];
                        previewUrl = `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(mp4Path)}?${+new Date()}`;
                        isMp4Preview = true;
                    }

                    const itemEl = zmlCreateEl("div", { // 使用 zmlCreateEl
                        className: `zml-batch-lora-item ${isSelected ? 'selected' : ''} ${zmlBatchLoraDisplayStyle === 'horizontal' ? 'horizontal' : ''} ${zmlBatchLoraDisplayStyle === 'vertical' ? 'vertical' : ''} ${zmlBatchLoraDisplayStyle === 'square' ? 'square' : ''} ${isDeleted ? 'deleted' : ''}`,
                        style: `
                            position: relative;
                        width: 100%;
                        height: 100%; /* 让 itemEl 占据网格单元格的全部高度 */
                        border: 1px solid ${isDeleted ? '#ff5252' : (isSelected ? '#4CAF50' : '#555')};
                        border-radius: 4px;
                        overflow: hidden;
                        cursor: ${isDeleted ? 'not-allowed' : 'pointer'};
                        background-color: ${isDeleted ? '#331a1a' : '#222'};
                        transition: border-color 0.2s, background-color 0.2s;
                        box-sizing: border-box !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        display: block; /* 确保是块级元素 */
                        `
                    });
                    itemEl.onmouseenter = () => {
                        if (!isDeleted) {
                            itemEl.style.borderColor = isSelected ? '#4CAF50' : '#5d99f2';
                        }
                    };
                    itemEl.onmouseleave = () => {
                        itemEl.style.borderColor = isDeleted ? '#ff5252' : (isSelected ? '#4CAF50' : '#555');
                    };


                    // 根据当前主题获取无预览图的样式
                    let noPreviewBgColor = '#252525';
                    let noPreviewTextColor = '#888';
                    if (globalThis.zmlCurrentTheme === 'none') {
                        noPreviewBgColor = '#252525';
                        noPreviewTextColor = '#888';
                    } else if (globalThis.zmlCurrentTheme === 'white') {
                        noPreviewBgColor = '#f5f5f5';
                        noPreviewTextColor = '#333';
                    } else if (globalThis.zmlCurrentTheme === 'lightblue') {
                        noPreviewBgColor = '#d1e3f0';
                        noPreviewTextColor = '#1a237e';
                    } else if (globalThis.zmlCurrentTheme === 'lightgreen') {
                        noPreviewBgColor = '#d6e9d6';
                        noPreviewTextColor = '#1b5e20';
                    } else if (globalThis.zmlCurrentTheme === 'pink') {
                        noPreviewBgColor = '#f8d7da';
                        noPreviewTextColor = '#721c24';
                    }

                    const imageWrapper = zmlCreateEl("div", { // 使用 zmlCreateEl
                        className: "zml-batch-lora-image-wrapper",
                        style: `
                            width: 100%;
                            height: 100%;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            overflow: hidden;
                            position: relative;
                            background-color: ${noPreviewBgColor};
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-direction: column; /* 确保文字也在中间 */
                            color: ${hasPreview ? '#888' : noPreviewTextColor};
                            font-size: 11px;
                            text-align: center;
                            background-color: ${hasPreview ? 'transparent' : noPreviewBgColor};
                        `
                    });

                    if (previewUrl) {
                        if (isMp4Preview) {
                            // 创建视频元素
                            const video = zmlCreateEl("video", {
                                className: "zml-batch-lora-item-video",
                                style: `
                                    width: 100%;
                                    height: 100%;
                                    object-fit: cover;
                                `,
                                autoplay: true,
                                loop: true,
                                muted: true,
                                playsinline: true
                            });
                            // 创建视频源
                            const source = zmlCreateEl("source", {
                                src: previewUrl,
                                type: "video/mp4"
                            });
                            video.appendChild(source);
                            // 添加视频加载错误处理
                            video.onerror = function() {
                                console.warn(`[ZML] Failed to load MP4 preview: ${previewUrl}`);
                                // 如果是MP4预览模式且加载失败，则尝试使用原始图片
                                if (globalThis.zmlBatchLoraPreviewMp4Mode && civitaiPreviewUrl) {
                                    console.log(`[ZML] Falling back to original image: ${civitaiPreviewUrl}`);
                                    const img = zmlCreateEl("img", {
                                        src: civitaiPreviewUrl,
                                        className: "zml-batch-lora-item-image",
                                        style: `
                                            width: 100%;
                                            height: 100%;
                                            object-fit: cover;
                                        `
                                    });
                                    imageWrapper.innerHTML = '';
                                    imageWrapper.appendChild(img);
                                } else {
                                    imageWrapper.textContent = "预览视频加载失败";
                                }
                            };
                            imageWrapper.appendChild(video);
                        } else {
                            // 创建图片元素
                            const img = zmlCreateEl("img", {
                                src: previewUrl,
                                className: "zml-batch-lora-item-image",
                                style: `
                                    width: 100%;
                                    height: 100%;
                                    object-fit: cover;
                                `
                            });
                            // 添加图片加载错误处理
                            img.onerror = function() {
                                console.warn(`[ZML] Failed to load image preview: ${previewUrl}`);
                                imageWrapper.textContent = "预览图加载失败";
                            };
                            imageWrapper.appendChild(img);
                        }
                    } else {
                        imageWrapper.textContent = "LoRA暂无预览图";
                    }

                    // --- 新增：Civitai获取元数据按钮 ---
                    // 为所有LoRA显示三个横杠按钮，根据是否有预览图设置不同功能
                    const isNoPreviewAndFetch = !hasPreview; // 保留原始功能的状态标记
                    const fetchMetadataBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                        className: "zml-batch-lora-fetch-from-civitai-btn",
                        textContent: "☰", // Hamburger icon
                        title: isNoPreviewAndFetch ? `从Civitai获取 '${file.name}' 的预览图和元数据` : `编辑 '${file.name}' 的txt和log文件`,
                    });
                    fetchMetadataBtn.onclick = async (e) => {
                        e.stopPropagation(); // 阻止事件冒泡，避免触发LoRA选择
                        
                        if (isNoPreviewAndFetch) {
                            // 自定义对话框替代confirm
                            const confirmDialog = zmlCreateEl("div", {
                                style: `
                                    position: fixed;
                                    top: 50%;
                                    left: 50%;
                                    transform: translate(-50%, -50%);
                                    background-color: #1a1a1a;
                                    border: 1px solid #4a4a4a;
                                    border-radius: 8px;
                                    padding: 20px;
                                    min-width: 350px;
                                    z-index: 20202; /* 使用最大z-index值确保显示在最上层 */
                                    color: #f0f0f0;
                                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8);
                                `
                            });
                            
                            const overlay = zmlCreateEl("div", {
                                style: `
                                    position: fixed;
                                    top: 0;
                                    left: 0;
                                    width: 100%;
                                    height: 100%;
                                    background-color: rgba(0, 0, 0, 0.1);
                                    z-index: 20201;
                                `
                            });
                            
                            const dialogMessage = zmlCreateEl("p", {
                                style: `
                                    margin: 0 0 20px 0;
                                    color: #ccc;
                                    line-height: 1.5;
                                `,
                                textContent: `您确定要从Civitai获取LoRA '${file.name}' 的信息吗？这可能需要一些时间，并将下载文件到您的本地。`
                            });
                            
                            const buttonsContainer = zmlCreateEl("div", {
                                style: `
                                    display: flex;
                                    gap: 12px;
                                    justify-content: flex-end;
                                `
                            });
                            
                            const fetchBtn = zmlCreateEl("button", {
                                style: `
                                    padding: 8px 16px;
                                    background-color: #4CAF50;
                                    color: white;
                                    border: none;
                                    border-radius: 4px;
                                    cursor: pointer;
                                    font-size: 14px;
                                `,
                                textContent: "爬取信息"
                            });
                            
                            const editBtn = zmlCreateEl("button", {
                                style: `
                                    padding: 8px 16px;
                                    background-color: #2196F3;
                                    color: white;
                                    border: none;
                                    border-radius: 4px;
                                    cursor: pointer;
                                    font-size: 14px;
                                `,
                                textContent: "编辑文件"
                            });
                            
                            const cancelBtn = zmlCreateEl("button", {
                                style: `
                                    padding: 8px 16px;
                                    background-color: #666;
                                    color: white;
                                    border: none;
                                    border-radius: 4px;
                                    cursor: pointer;
                                    font-size: 14px;
                                `,
                                textContent: "取消"
                            });
                            
                            const closeDialog = () => {
                                document.body.removeChild(confirmDialog);
                                document.body.removeChild(overlay);
                            };
                            
                            // 阻止点击遮罩层关闭对话框，避免误操作
                            overlay.onclick = function(e) {
                                e.stopPropagation();
                            };
                            
                            fetchBtn.onclick = async () => {
                                closeDialog();
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
                            };
                            
                            editBtn.onclick = () => {
                                closeDialog();
                                // 打开编辑窗口编辑txt和log文件
                                showLoraContentEditModal(loraPath, file.name);
                            };
                            
                            cancelBtn.onclick = closeDialog;
                            
                            buttonsContainer.appendChild(fetchBtn);
                            buttonsContainer.appendChild(editBtn);
                            buttonsContainer.appendChild(cancelBtn);
                            
                            confirmDialog.appendChild(dialogMessage);
                            confirmDialog.appendChild(buttonsContainer);
                            
                            document.body.appendChild(overlay);
                            document.body.appendChild(confirmDialog);
                        } else {
                            // 新功能：打开编辑窗口编辑txt和log文件
                            showLoraContentEditModal(loraPath, file.name);
                        }
                    };
                    itemEl.appendChild(fetchMetadataBtn);
                    // --- 结束：Civitai获取元数据按钮 ---


                    const overlay = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                    const checkmark = zmlCreateEl("div", { // 使用 zmlCreateEl
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
                    
                    // 默认显示绿色播放按钮
                    const playIcon = zmlCreateEl("div", { // 使用 zmlCreateEl
                        className: "zml-batch-lora-play-icon",
                        textContent: "▶",
                        style: `
                            position: absolute;
                            top: 5px; right: 5px;
                            width: 24px; height: 24px;
                            background-color: rgba(76, 175, 80, 0.8); /* 绿色 */
                            color: white;
                            border-radius: 50%;
                            display: ${isDeleted || isSelected ? 'none' : 'flex'}; /* 已删除或选中时隐藏 */
                            align-items: center;
                            justify-content: center;
                            font-size: 12px;
                            font-weight: bold;
                            z-index: 10; /*确保在最上层*/
                            cursor: pointer;
                            transition: all 0.2s ease;
                        `
                    });
                    
                    // 检查当前LoRA是否处于视频播放状态
                    const isCurrentlyPlaying = globalThis.zmlLoraVideoPlayStates && globalThis.zmlLoraVideoPlayStates[loraPath];
                    if (isCurrentlyPlaying) {
                        playIcon.textContent = "⏸";
                        playIcon.style.backgroundColor = "rgba(255, 140, 0, 0.8)"; /* 视频模式时变为橙色 */
                    } else {
                        playIcon.textContent = "▶";
                        playIcon.style.backgroundColor = "rgba(76, 175, 80, 0.8)"; /* 图像模式时恢复绿色 */
                    }
                    
                    // 添加点击事件，实现视频预览切换功能
                    playIcon.onclick = (e) => {
                        e.stopPropagation(); // 阻止事件冒泡
                        
                        // 检查是否有对应的MP4文件
                        const hasMp4 = globalThis.zmlMp4Previews && globalThis.zmlMp4Previews[loraPath];
                        
                        if (hasMp4) {
                            // 初始化播放状态对象（如果不存在）
                            if (!globalThis.zmlLoraVideoPlayStates) {
                                globalThis.zmlLoraVideoPlayStates = {};
                            }
                            // 切换当前LoRA的MP4预览模式
                            globalThis.zmlLoraVideoPlayStates[loraPath] = !globalThis.zmlLoraVideoPlayStates[loraPath];
                            
                            // 更新按钮图标
                            if (globalThis.zmlLoraVideoPlayStates[loraPath]) {
                                playIcon.textContent = "⏸";
                                playIcon.style.backgroundColor = "rgba(255, 140, 0, 0.8)"; /* 视频模式时变为橙色 */
                            } else {
                                playIcon.textContent = "▶";
                                playIcon.style.backgroundColor = "rgba(76, 175, 80, 0.8)"; /* 图像模式时恢复绿色 */
                            }
                            
                            // 只重新渲染当前项目，避免重新渲染整个列表
                            // 重新创建imageWrapper内容
                            imageWrapper.innerHTML = '';
                            
                            // 根据新的状态重新创建视频或图片
                            if (globalThis.zmlLoraVideoPlayStates[loraPath]) {
                                // 创建视频元素
                                const video = zmlCreateEl("video", {
                                    className: "zml-batch-lora-item-video",
                                    style: `
                                        width: 100%;
                                        height: 100%;
                                        object-fit: cover;
                                    `,
                                    autoplay: true,
                                    loop: true,
                                    muted: true,
                                    playsinline: true
                                });
                                const source = zmlCreateEl("source", {
                                    src: `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(globalThis.zmlMp4Previews[loraPath])}?${+new Date()}`,
                                    type: "video/mp4"
                                });
                                video.appendChild(source);
                                video.onerror = function() {
                                    console.warn(`[ZML] Failed to load MP4 preview: ${previewUrl}`);
                                    imageWrapper.textContent = "预览视频加载失败";
                                };
                                imageWrapper.appendChild(video);
                            } else {
                                // 创建图片元素
                                const img = zmlCreateEl("img", {
                                    src: civitaiPreviewUrl,
                                    className: "zml-batch-lora-item-image",
                                    style: `
                                        width: 100%;
                                        height: 100%;
                                        object-fit: cover;
                                    `
                                });
                                img.onerror = function() {
                                    console.warn(`[ZML] Failed to load image preview: ${previewUrl}`);
                                    imageWrapper.textContent = "预览图加载失败";
                                };
                                imageWrapper.appendChild(img);
                            }
                        } else {
                            // 没有视频时显示提示消息
                            // 检查是否存在showNotification函数，如果不存在则创建
                            if (typeof showNotification === 'function') {
                                showNotification("当前LoRA没有视频预览", 'info', 2000);
                            } else {
                                // 如果没有showNotification函数，则尝试创建一个简单的通知系统
                                const notification = zmlCreateEl("div", {
                                    style: `
                                        position: fixed;
                                        top: 20px;
                                        right: 20px;
                                        background-color: rgba(0, 0, 0, 0.8);
                                        color: white;
                                        padding: 12px 20px;
                                        border-radius: 4px;
                                        z-index: 10000;
                                        font-size: 14px;
                                        opacity: 0;
                                        transform: translateY(-20px);
                                        transition: opacity 0.3s, transform 0.3s;
                                    `,
                                    textContent: "当前LoRA没有视频预览"
                                });
                                document.body.appendChild(notification);
                                setTimeout(() => {
                                    notification.style.opacity = "1";
                                    notification.style.transform = "translateY(0)";
                                }, 10);
                                setTimeout(() => {
                                    notification.style.opacity = "0";
                                    notification.style.transform = "translateY(-20px)";
                                    setTimeout(() => {
                                        if (notification.parentNode) {
                                            notification.parentNode.removeChild(notification);
                                        }
                                    }, 300);
                                }, 2000);
                            }
                        }
                    };

                    // 已删除标记
                    if (isDeleted) {
                        const deletedOverlay = zmlCreateEl("div", {
                            className: "zml-batch-lora-deleted-overlay",
                            style: `
                                position: absolute;
                                top: 0; left: 0; width: 100%; height: 100%;
                                background-color: rgba(255, 0, 0, 0.3); /* 红色半透明覆盖 */
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                z-index: 20;
                            `
                        });

                        const deletedText = zmlCreateEl("div", {
                            className: "zml-batch-lora-deleted-text",
                            textContent: "已删除",
                            style: `
                                font-size: 30px;
                                color: #ff0000;
                                font-weight: bold;
                                text-shadow: 0 0 5px rgba(0,0,0,0.7);
                                transform: rotate(-15deg);
                                background-color: rgba(0,0,0,0.5);
                                padding: 5px 15px;
                                border-radius: 5px;
                            `
                        });

                        deletedOverlay.appendChild(deletedText);
                        itemEl.appendChild(deletedOverlay);
                    }

                    // LoRA 名称显示在底部
                    const nameDisplay = zmlCreateEl("div", { // 使用 zmlCreateEl
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


                    itemEl.append(imageWrapper, overlay, playIcon, nameDisplay);

                    // 已删除的文件不允许选择
                    if (!isDeleted) {
                        itemEl.onclick = (e) => {
                            // 阻止事件冒泡到父元素，特别是如果 playIcon 也在 itemEl 边界内
                            e.stopPropagation();

                            if (zmlBatchLoraSelected.has(loraPath)) {
                                zmlBatchLoraSelected.delete(loraPath);
                                itemEl.classList.remove("selected");
                                overlay.style.display = 'none';
                                playIcon.style.display = 'flex';
                                itemEl.style.borderColor = '#555';
                                // console.log(`Removed ${loraPath} from selection. Total: ${zmlBatchLoraSelected.size}`); // 调试用
                            } else {
                                zmlBatchLoraSelected.add(loraPath);
                                itemEl.classList.add("selected");
                                overlay.style.display = 'flex';
                                playIcon.style.display = 'none';
                                itemEl.style.borderColor = '#4CAF50';
                                // console.log(`Added ${loraPath} to selection. Total: ${zmlBatchLoraSelected.size}`); // 调试用
                            }
                            updateSelectedCountDisplay(); // 更新显示
                        };
                    } else {
                        // 已删除的文件点击时提示
                        itemEl.onclick = (e) => {
                            e.stopPropagation();
                            alert(`LoRA '${file.name}' 已被删除，无法添加。`);
                        };
                    }
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
                        const overlay = zmlCreateEl("div", { // 使用 zmlCreateEl
                            style: `
                                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                                background-color: rgba(0, 0, 0, 0.8);
                                display: flex; align-items: center; justify-content: center;
                                z-index: 10002;
                                backdrop-filter: blur(2px);
                            `
                        });
                        const modal = zmlCreateEl("div", { // 使用 zmlCreateEl
                            style: `
                                background-color: #31353a; border: 1px solid #4a515a; border-radius: 8px;
                                padding: 20px; max-width: 400px; text-align: center;
                                display: flex; flex-direction: column; gap: 20px;
                                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5);
                            `
                        });
                        const text = zmlCreateEl("p", { // 使用 zmlCreateEl
                            textContent: confirmMessage,
                            style: `color: #e0e0e0; font-size: 14px; line-height: 1.5; margin:0;`
                        });
                        const buttonWrapper = zmlCreateEl("div", { // 使用 zmlCreateEl
                            style: `display: flex; justify-content: center; gap: 15px;`
                        });

                        const yesButton = zmlCreateEl("button", { // 使用 zmlCreateEl
                            textContent: "是 (跳过重复)",
                            className: "zml-control-btn zml-st3-modal-save",
                            style: `padding: 8px 15px;` // 调整按钮样式
                        });
                        yesButton.onclick = () => { overlay.remove(); resolve(true); };

                        const noButton = zmlCreateEl("button", { // 使用 zmlCreateEl
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
                    // 处理每个要添加的 LoRA
                    for (const loraPath of finalLorasToAdd) {
                        // 创建新的条目
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

                        // 当"添加文本"模式开启时，尝试读取同名txt文件内容
                        if (zmlBatchLoraAddTextMode) {
                            try {
                                // 获取LoRA文件名（不含扩展名）
                                const loraNameWithoutExt = loraPath.split('/').pop().split('.').slice(0, -1).join('.');
                                // 构建txt文件路径
                                const txtFilePath = loraPath.replace(/\\.[^/.]+$/, '.txt');
                                
                                // 发送请求到后端获取txt文件内容
                                const response = await api.fetchApi(`${ZML_API_PREFIX}/get_lora_file`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        "lora_filename": loraPath,
                                        "file_type": "txt"
                                    })
                                });
                                const result = await response.json();
                                if (result.status === "success" && result.content.trim()) {
                                    newEntry.custom_text = result.content.trim();
                                }
                            } catch (error) {
                                console.warn(`无法读取LoRA的txt文件: ${loraPath}`, error);
                                // 继续处理，不中断整个流程
                            }
                        }

                        // 添加到节点数据中
                        zmlBatchLoraCurrentNodeInstance.powerLoraLoader_data.entries.push(newEntry);
                    }
                    
                    // 触发节点更新
                    zmlBatchLoraCurrentNodeInstance.triggerSlotChanged();
                } else if (lorasToAdd.length > 0) {
                     alert("所有选中的 LoRA 都已存在且你选择了跳过。");
                }
                
                hideBatchLoraModal();
            }


            function showBatchLoraModal(nodeInstance, loraRootTree) {
                if (!zmlBatchLoraModalOverlay) createBatchLoraModal();

                zmlBatchLoraCurrentNodeInstance = nodeInstance;
                zmlBatchLoraCurrentPath = []; // 重置路径到根目录
                zmlBatchLoraSelected.clear(); // 清空上次选择
                
                // 确保模态框完全显示后再更新开关状态
                const updateToggleState = () => {
                    // 尝试通过两种方式获取开关元素：全局变量和DOM查询
                    let toggleEl = globalThis.zmlBatchLoraAddTextToggle;
                    
                    if (!toggleEl && zmlBatchLoraModalOverlay) {
                        toggleEl = zmlBatchLoraModalOverlay.querySelector('.zml-toggle-switch');
                    }
                    
                    if (toggleEl) {
                        const toggleInput = toggleEl.querySelector('input[type="checkbox"]');
                        const toggleSlider = toggleEl.querySelector('span');
                        const innerSpan = toggleSlider?.querySelector('span');
                        
                        if (toggleInput) toggleInput.checked = zmlBatchLoraAddTextMode;
                        if (toggleSlider) toggleSlider.style.backgroundColor = zmlBatchLoraAddTextMode ? '#4CAF50' : '#666';
                        if (innerSpan) innerSpan.style.transform = `translateX(${zmlBatchLoraAddTextMode ? '16px' : '0'})`;
                    }
                };

                // 首次打开或者图片列表为空时尝试重新加载图片列表
                if (!loraImages || Object.keys(loraImages).length === 0) {
                    loadImageList().then(() => {
                        renderBatchLoraContent(); // 重新渲染内容
                        zmlBatchLoraModalOverlay.style.display = 'flex';
                        // 模态框显示后更新开关状态
                        setTimeout(updateToggleState, 100);
                    }).catch(e => {
                        console.error("Failed to load lora images for batch modal:", e);
                        alert("无法加载 LoRA 预览图，请检查后端服务日志。");
                        hideBatchLoraModal(); // 加载失败则关闭
                    });
                } else {
                    renderBatchLoraContent(); // 渲染内容
                    zmlBatchLoraModalOverlay.style.display = 'flex';
                    // 模态框显示后更新开关状态
                    setTimeout(updateToggleState, 100);
                }
            }

            function hideBatchLoraModal() {
                if (zmlBatchLoraModalOverlay) {
                    zmlBatchLoraModalOverlay.style.display = 'none';
                    zmlBatchLoraCurrentNodeInstance = null;
                    zmlBatchLoraCurrentPath = [];
                    zmlBatchLoraSelected.clear();
                    updateSelectedCountDisplay(); // 清空后更新计数显示
                    // 保留添加文本模式状态，不再重置
                    
                    // 重置MP4预览模式
                    if (typeof zmlBatchLoraPreviewMp4Mode !== 'undefined') {
                        zmlBatchLoraPreviewMp4Mode = false;
                        // 检查updateStyleButtons是否存在，如果存在则调用
                        if (typeof updateStyleButtons === 'function') {
                            // 获取所有样式按钮
                            const styleButtons = Array.from(zmlBatchLoraModalOverlay.querySelectorAll('button'));
                            updateStyleButtons(styleButtons);
                        }
                    }
                }
            }
            // --- 结束：批量添加 LoRA 弹窗的变量和函数 ---


            // --- 新增：颜色选择器菜单的变量和函数 ---
            let zmlColorChooseMenu = null;
            // zmlColorCallback 变量不再需要，因为我们直接触发颜色 input 的点击事件

            function createColorChooseMenu(x, y, onSelectFolder, onSelectLoraEntry, onSelectEnabledState, onResetColors) {
                if (zmlColorChooseMenu) zmlColorChooseMenu.remove(); // 移除旧菜单

                zmlColorChooseMenu = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                const folderColorOption = zmlCreateEl("div", { // 使用 zmlCreateEl
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

                const loraEntryColorOption = zmlCreateEl("div", { // 使用 zmlCreateEl
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
                
                // 开启状态颜色选项
                const enabledStateColorOption = zmlCreateEl("div", { // 使用 zmlCreateEl
                    textContent: "开启状态",
                    className: "zml-color-choose-option",
                    style: `
                        padding: 5px 10px;
                        cursor: pointer;
                        border-radius: 2px;
                        color: #ccc;
                        transition: background-color 0.2s;
                    `
                });
                enabledStateColorOption.onmouseenter = (e) => e.target.style.backgroundColor = '#535353';
                enabledStateColorOption.onmouseleave = (e) => e.target.style.backgroundColor = 'transparent';
                enabledStateColorOption.onclick = () => { onSelectEnabledState(); zmlColorChooseMenu.remove(); zmlColorChooseMenu = null; };

                // 分割线
                const separator = zmlCreateEl("div", {
                    style: `
                        height: 1px;
                        background-color: #555;
                        margin: 2px 0;
                    `
                });

                // 恢复默认颜色选项（红色字体）
                const resetColorsOption = zmlCreateEl("div", { // 使用 zmlCreateEl
                    textContent: "恢复默认颜色",
                    className: "zml-color-choose-option",
                    style: `
                        padding: 5px 10px;
                        cursor: pointer;
                        border-radius: 2px;
                        color: #ff4444;
                        transition: background-color 0.2s;
                    `
                });
                resetColorsOption.onmouseenter = (e) => e.target.style.backgroundColor = '#535353';
                resetColorsOption.onmouseleave = (e) => e.target.style.backgroundColor = 'transparent';
                resetColorsOption.onclick = () => { onResetColors(); zmlColorChooseMenu.remove(); zmlColorChooseMenu = null; };

                zmlColorChooseMenu.append(folderColorOption, loraEntryColorOption, enabledStateColorOption, separator, resetColorsOption);
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
                            overflow-y: auto;
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
                        }
                        .zml-batch-lora-folder-nav > a:hover {
                            text-decoration: underline !important;
                        }
                        .zml-batch-lora-item {
                            position: relative;
                            box-sizing: border-box;
                            transition: border-color 0.2s, transform 0.1s;
                            /* 默认样式，会被 .horizontal, .vertical, .square 覆盖 */
                            width: 100%;
                            height: 100%;
                        }
                        /* 横向矩形展示样式 */
                        .zml-batch-lora-item.horizontal {
                            /* 宽度由 grid-template-columns 控制，高度由 grid-auto-rows 控制 */
                        }
                        /* 竖向矩形展示样式 */
                        .zml-batch-lora-item.vertical {
                            /* 宽度由 grid-template-columns 控制，高度由 grid-auto-rows 控制 */
                        }
                        /* 方形展示样式 */
                        .zml-batch-lora-item.square {
                            /* 宽度由 grid-template-columns 控制，高度由 grid-auto-rows 控制 */
                        }
                        /* 确保图片在不同尺寸容器中正确显示 */
                        .zml-batch-lora-item-image {
                            display: block;
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
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
                     // 初始化viewMode属性，默认为normal
                     this.viewMode = this.viewMode || "normal";
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

                     // *** 修改：为 container 添加 className，使其 CSS 样式被限定作用域 ***
                     const container = zmlCreateEl("div", { className: "zml-power-lora-loader-container" }); 
                     container.style.cssText = `background: #2b2b2b; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; display: flex; flex-direction: column; padding: 6px;`;

                     const topControls = zmlCreateEl("div", { className: "zml-pll-controls-top" }); // <-- 这里会调用到局部定义的 zmlCreateEl

                     const loraNameWidthGroup = zmlCreateEl("div", { className: "zml-control-group-pll" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     const loraNameWidthLabel = zmlCreateEl("span", { className: "zml-control-label-pll", textContent: "名称宽度" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     const loraNameWidthInput = zmlCreateEl("input", { className: "zml-control-input-pll" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     loraNameWidthInput.type = "number";
                     loraNameWidthInput.min = "10";
                     loraNameWidthInput.max = "300";
                     loraNameWidthInput.value = this.loraNameWidth;
                     loraNameWidthInput.title = "LoRA 名称框宽度 (像素)";
                     loraNameWidthInput.oninput = (e) => {
                         // 实时更新值，并立即触发渲染
                         this.loraNameWidth = parseInt(e.target.value, 10);
                         this.renderLoraEntries(); // 添加实时渲染
                     };
                     loraNameWidthInput.onblur = (e) => {
                         let val = parseInt(e.target.value, 10);
                         if (isNaN(val)) val = 65;
                         val = Math.max(10, Math.min(300, val));
                         this.loraNameWidth = val;
                         e.target.value = val; // 纠正显示值
                         this.renderLoraEntries(); // 失去焦点时重新渲染
                         this.triggerSlotChanged(); // 失去焦点时触发保存
                     };
                     loraNameWidthGroup.append(loraNameWidthLabel, loraNameWidthInput);
                     topControls.appendChild(loraNameWidthGroup);

                     const customTextWidthGroup = zmlCreateEl("div", { className: "zml-control-group-pll" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     const customTextWidthLabel = zmlCreateEl("span", { className: "zml-control-label-pll", textContent: "文本宽度" });// <-- 这里会调用到局部定义 的 zmlCreateEl
                     const customTextWidthInput = zmlCreateEl("input", { className: "zml-control-input-pll" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     customTextWidthInput.type = "number";
                     customTextWidthInput.min = "10";
                     customTextWidthInput.max = "300";
                     customTextWidthInput.value = this.customTextWidth;
                     customTextWidthInput.title = "自定义文本框宽度 (像素)";
                     customTextWidthInput.oninput = (e) => {
                         // 实时更新值，并立即触发渲染
                         this.customTextWidth = parseInt(e.target.value, 10);
                         this.renderLoraEntries(); // 添加实时渲染
                     };
                     customTextWidthInput.onblur = (e) => {
                         let val = parseInt(e.target.value, 10);
                         if (isNaN(val)) val = 80;
                         val = Math.max(10, Math.min(300, val));
                         this.customTextWidth = val;
                         e.target.value = val; // 纠正显示值
                         this.renderLoraEntries(); // 失去焦点时重新渲染
                         this.triggerSlotChanged(); // 失去焦点时触发保存
                     };
                     customTextWidthGroup.append(customTextWidthLabel, customTextWidthInput);
                     topControls.appendChild(customTextWidthGroup);
                     
                     // === 新建文件夹按钮 ===
                     const newFolderBtn = zmlCreateEl("button", { className: "zml-control-btn-pll", textContent: "📁+" });// <-- 这里会调用到局部定义的 zmlCreateEl
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

                     // 初始化默认颜色值（如果不存在）
                     this.folderColor = this.folderColor ?? "#30353c";
                     this.loraEntryColor = this.loraEntryColor ?? "#3a3a3a";
                     this.enabledStateColor = this.enabledStateColor ?? "#4CAF50"; // 开启状态默认绿色

                     // === 文件夹/LoRA 颜色按钮 (修改) ===
                     const folderColorInput = zmlCreateEl("input", { type: "color", value: this.folderColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden; position:absolute;" }); // 使用 zmlCreateEl
                     const loraEntryColorInput = zmlCreateEl("input", { type: "color", value: this.loraEntryColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden; position:absolute;" }); // 使用 zmlCreateEl
                     const enabledStateColorInput = zmlCreateEl("input", { type: "color", value: this.enabledStateColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden; position:absolute;" }); // 使用 zmlCreateEl
                    
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
                     enabledStateColorInput.onchange = (e) => {
                         this.enabledStateColor = e.target.value;
                         this.renderLoraEntries(); // Re-render to apply new color
                         this.triggerSlotChanged();
                     };

                     const colorPickerBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                        className: "zml-control-btn-pll zml-color-btn-trigger", 
                        textContent: "🎨" 
                     });
                     colorPickerBtn.title = "自定义文件夹和LoRA框颜色";
                     colorPickerBtn.onclick = (e) => {
                        const rect = e.target.getBoundingClientRect();
                        createColorChooseMenu(rect.left, rect.bottom + 5,
                            () => folderColorInput.click(),  // 选择文件夹颜色
                            () => loraEntryColorInput.click(), // 选择 LoRA 框颜色
                            () => enabledStateColorInput.click(), // 选择开启状态颜色
                            () => { // 恢复默认颜色
                                this.folderColor = "#30353c";
                                this.loraEntryColor = "#3a3a3a";
                                this.enabledStateColor = "#4CAF50";
                                
                                // 更新颜色输入框的值
                                folderColorInput.value = this.folderColor;
                                loraEntryColorInput.value = this.loraEntryColor;
                                enabledStateColorInput.value = this.enabledStateColor;
                                
                                // 重新渲染和触发更新
                                this.renderLoraEntries();
                                this.triggerSlotChanged();
                            }
                        );
                     };
                     topControls.appendChild(colorPickerBtn);    // Visible button
                     // 将隐藏的输入框移到容器末尾，不影响按钮间距
                     topControls.appendChild(folderColorInput); // Hidden input
                     topControls.appendChild(loraEntryColorInput); // Hidden input
                     topControls.appendChild(enabledStateColorInput); // Hidden input
                     // =============================


                     const lockToggleButton = zmlCreateEl("button", { className: "zml-control-btn-pll", textContent: this.isLocked ? "🔒" : "🔓" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     lockToggleButton.title = "锁定/解锁 LoRA 框";
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

                     const sizeToggleButton = zmlCreateEl("button", { className: "zml-control-btn-pll", textContent: "💕" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     sizeToggleButton.title = "切换布局模式";
                     sizeToggleButton.style.position = 'relative';
                     sizeToggleButton.onmouseenter = (e) => e.target.style.background = '#555';
                     sizeToggleButton.onmouseleave = (e) => e.target.style.background = '#444';
                     
                     // 创建下拉菜单
                     const dropdownMenu = zmlCreateEl("div", {
                         style: `position: absolute; top: 100%; left: 0; background: #333; border: 1px solid #555; border-radius: 4px; display: none; z-index: 1000; min-width: 100px;`
                     });
                     
                     // 添加下拉菜单项
                     const modes = [
                         { id: 'compact', label: '紧凑布局' },
                         { id: 'normal', label: '常规布局' },
                         { id: 'simple', label: '精简布局' }
                     ];
                     
                     modes.forEach(mode => {
                         const menuItem = zmlCreateEl("div", {
                             style: `padding: 6px 12px; cursor: pointer; color: #ccc; ${this.viewMode === mode.id ? 'background: #555;' : ''}`,
                             textContent: mode.label
                         });
                         menuItem.onclick = () => {
                             this.viewMode = mode.id;
                             this.applySizeMode();
                             this.triggerSlotChanged();
                             // 更新菜单项高亮
                             Array.from(dropdownMenu.children).forEach(item => {
                                 item.style.background = item.textContent === mode.label ? '#555' : 'transparent';
                             });
                             dropdownMenu.style.display = 'none';
                         };
                         dropdownMenu.appendChild(menuItem);
                     });
                     
                     sizeToggleButton.appendChild(dropdownMenu);
                     
                     // 点击按钮切换下拉菜单显示/隐藏
                     sizeToggleButton.onclick = (e) => {
                         e.stopPropagation();
                         dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
                     };
                     
                     // 点击页面其他地方关闭下拉菜单
                     document.addEventListener('click', () => {
                         dropdownMenu.style.display = 'none';
                     });
                     
                     // 阻止下拉菜单内部点击事件冒泡
                     dropdownMenu.onclick = (e) => {
                         e.stopPropagation();
                     };
                     topControls.appendChild(sizeToggleButton);
                      
                     // === 预设按钮 ===
                     const presetButton = zmlCreateEl("button", { className: "zml-control-btn-pll", textContent: "预设" });// <-- 这里会调用到局部定义的 zmlCreateEl
                     presetButton.title = "打开预设面板";
                     presetButton.style.position = 'relative';
                     presetButton.style.minWidth = '55px'; // 增加宽度1.2倍
                     presetButton.onmouseenter = (e) => e.target.style.background = '#555';
                     presetButton.onmouseleave = (e) => e.target.style.background = '#444';                      
                     // 预设面板 - 改为模态对话框
                     let presetPanel = null;
                     let overlay = null;
                      
                     // 预设面板内容加载函数
                     const loadPresetPanel = () => {
                         // 确保面板只创建一次
                         if (presetPanel) {
                             // 显示面板
                             overlay.style.display = 'block';
                             presetPanel.style.display = 'block';
                             return;
                         }
                          
                         // 创建背景遮罩
                         overlay = zmlCreateEl("div", {
                             style: `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); z-index: 999; display: block;`
                         });
                           
                         // 创建预设面板 - 模态对话框形式
                         presetPanel = zmlCreateEl("div", {
                             style: `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #333; border: 1px solid #555; border-radius: 4px; display: block; z-index: 1000; width: 400px; height: 500px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.5);`
                         });
                         
                         // 加载保存的面板状态
                         const loadSavedPanelState = () => {
                             try {
                                 const savedState = localStorage.getItem('zml_lora_preset_panel_state');
                                 if (savedState) {
                                     const state = JSON.parse(savedState);
                                     
                                     // 应用保存的尺寸
                                     presetPanel.style.width = `${state.width}px`;
                                     presetPanel.style.height = `${state.height}px`;
                                     
                                     // 如果保存了位置信息，应用它
                                     if (state.left !== undefined && state.top !== undefined) {
                                         presetPanel.style.transform = 'none';
                                         presetPanel.style.left = `${state.left}px`;
                                         presetPanel.style.top = `${state.top}px`;
                                     }
                                 }
                             } catch (e) {
                                 console.error('Failed to load saved panel state:', e);
                             }
                         };
                         
                         // 保存面板状态
                         const savePanelState = () => {
                             try {
                                 const rect = presetPanel.getBoundingClientRect();
                                 const state = {
                                     width: rect.width,
                                     height: rect.height,
                                     left: presetPanel.style.transform === 'none' ? rect.left : undefined,
                                     top: presetPanel.style.transform === 'none' ? rect.top : undefined
                                 };
                                 localStorage.setItem('zml_lora_preset_panel_state', JSON.stringify(state));
                             } catch (e) {
                                 console.error('Failed to save panel state:', e);
                             }
                         };
                           
                         // 添加缩放控制手柄
                         const resizeHandle = zmlCreateEl("div", {
                             style: `position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; background: #555; border-top: 1px solid #666; border-left: 1px solid #666; cursor: se-resize; z-index: 1;`
                         });
                         presetPanel.appendChild(resizeHandle);
                         
                         // 加载保存的面板状态
                         loadSavedPanelState();
                         
                         // 预设面板头部
                         const panelHeader = zmlCreateEl("div", {
                             style: `padding: 10px 15px; background: #444; border-bottom: 1px solid #555; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none;`
                         });
                         
                         // 拖拽功能实现
                         let isDragging = false;
                         let offsetX, offsetY;
                         
                         panelHeader.onmousedown = (e) => {
                             if (e.target.tagName === 'BUTTON') return; // 如果点击的是按钮，不触发拖拽
                             
                             isDragging = true;
                             
                             // 获取鼠标相对于面板的位置
                             const panelRect = presetPanel.getBoundingClientRect();
                             offsetX = e.clientX - panelRect.left;
                             offsetY = e.clientY - panelRect.top;
                             
                             // 移除transform属性，改用直接定位
                             presetPanel.style.transform = 'none';
                             presetPanel.style.left = panelRect.left + 'px';
                             presetPanel.style.top = panelRect.top + 'px';
                             
                             // 为拖拽时的面板添加样式
                             panelHeader.style.cursor = 'grabbing';
                             presetPanel.style.zIndex = '1001';
                         };
                         
                         // 使用addEventListener避免覆盖其他事件监听器
                         const handleDragMove = (e) => {
                             if (!isDragging) return;
                             
                             // 计算新位置
                             let newLeft = e.clientX - offsetX;
                             let newTop = e.clientY - offsetY;
                             
                             // 限制面板在视口内
                             const viewportWidth = window.innerWidth;
                             const viewportHeight = window.innerHeight;
                             const panelWidth = presetPanel.offsetWidth;
                             const panelHeight = presetPanel.offsetHeight;
                             
                             newLeft = Math.max(0, Math.min(viewportWidth - panelWidth, newLeft));
                             newTop = Math.max(0, Math.min(viewportHeight - panelHeight, newTop));
                             
                             // 更新面板位置
                             presetPanel.style.left = newLeft + 'px';
                             presetPanel.style.top = newTop + 'px';
                         };
                         
                         const handleDragEnd = () => {
                             if (isDragging) {
                                 isDragging = false;
                                 panelHeader.style.cursor = 'move';
                                 presetPanel.style.zIndex = '1000';
                                 // 保存面板状态
                                 savePanelState();
                             }
                         };
                         
                         document.addEventListener('mousemove', handleDragMove);
                         document.addEventListener('mouseup', handleDragEnd);
                         
                         // 防止拖拽时文本选中
                         panelHeader.onselectstart = () => false;
                         
                         // 拖拽时防止右键菜单
                         panelHeader.oncontextmenu = (e) => e.preventDefault();
                         
                         // 缩放功能实现
                         let isResizing = false;
                         let startX, startY, startWidth, startHeight;
                         
                         // 最小尺寸限制
                         const minWidth = 300;
                         const minHeight = 400;
                         
                         resizeHandle.onmousedown = (e) => {
                             e.stopPropagation(); // 防止触发拖拽
                             isResizing = true;
                             
                             // 获取初始尺寸和位置
                             const panelRect = presetPanel.getBoundingClientRect();
                             startX = e.clientX;
                             startY = e.clientY;
                             startWidth = panelRect.width;
                             startHeight = panelRect.height;
                             
                             // 为调整大小时的光标添加样式
                             document.body.style.cursor = 'se-resize';
                             presetPanel.style.zIndex = '1001';
                         };
                         
                         // 分离调整大小的鼠标移动事件，避免与拖拽冲突
                         document.addEventListener('mousemove', (e) => {
                             if (!isResizing) return;
                             
                             // 计算新尺寸
                             const deltaX = e.clientX - startX;
                             const deltaY = e.clientY - startY;
                             
                             let newWidth = startWidth + deltaX;
                             let newHeight = startHeight + deltaY;
                             
                             // 限制最小尺寸
                             newWidth = Math.max(minWidth, newWidth);
                             newHeight = Math.max(minHeight, newHeight);
                             
                             // 限制最大尺寸（视口的90%）
                             const maxWidth = window.innerWidth * 0.9;
                             const maxHeight = window.innerHeight * 0.9;
                             
                             newWidth = Math.min(maxWidth, newWidth);
                             newHeight = Math.min(maxHeight, newHeight);
                             
                             // 更新面板尺寸
                             presetPanel.style.width = newWidth + 'px';
                             presetPanel.style.height = newHeight + 'px';
                             
                             // 如果面板使用transform居中定位，需要调整以适应新尺寸
                             if (presetPanel.style.transform === 'translate(-50%, -50%)') {
                                 // 保持居中
                                 presetPanel.style.left = '50%';
                                 presetPanel.style.top = '50%';
                             }
                         });
                         
                         document.addEventListener('mouseup', () => {
                             if (isResizing) {
                                 isResizing = false;
                                 document.body.style.cursor = '';
                                 presetPanel.style.zIndex = '1000';
                                 // 保存面板状态
                                 savePanelState();
                             }
                         });
                          
                         const panelTitle = zmlCreateEl("span", { textContent: "LoRA预设", style: "font-weight: bold; color: #fff; font-size: 16px;" });
                         const closeButton = zmlCreateEl("button", { 
                             textContent: "×", 
                             style: "background: #555; border: 1px solid #666; color: #fff; border-radius: 3px; padding: 5px 10px; cursor: pointer; font-size: 16px; transition: all 0.2s ease;" 
                         });
                         
                         closeButton.onmouseenter = () => {
                             closeButton.style.background = '#666';
                             closeButton.style.borderColor = '#777';
                             closeButton.style.transform = 'scale(1.05)';
                         };
                         
                         closeButton.onmouseleave = () => {
                             closeButton.style.background = '#555';
                             closeButton.style.borderColor = '#666';
                             closeButton.style.transform = 'scale(1)';
                         };
                         
                         closeButton.onmousedown = () => {
                             closeButton.style.background = '#444';
                             closeButton.style.transform = 'scale(0.98)';
                         };
                         
                         closeButton.onmouseup = () => {
                             closeButton.style.background = '#555';
                             closeButton.style.transform = 'scale(1)';
                         };
                          
                         closeButton.onclick = () => {
                             closePresetPanel();
                         };
                          
                         // 点击遮罩关闭面板
                         overlay.onclick = () => {
                             closePresetPanel();
                         };
                         
                         // 阻止面板内部点击事件关闭面板
                         presetPanel.onclick = (e) => {
                             e.stopPropagation();
                         };
                         
                         // 添加刷新按钮
                         const refreshButton = zmlCreateEl("button", { 
                             textContent: "刷新", 
                             style: "background: #555; border: 1px solid #666; color: #fff; border-radius: 3px; padding: 5px 10px; margin-right: 10px; cursor: pointer; font-size: 14px; transition: all 0.2s ease;",
                             title: "刷新预设列表"
                         });
                         
                         refreshButton.onmouseenter = () => {
                             refreshButton.style.background = '#666';
                             refreshButton.style.borderColor = '#777';
                             refreshButton.style.transform = 'scale(1.05)';
                         };
                         
                         refreshButton.onmouseleave = () => {
                             refreshButton.style.background = '#555';
                             refreshButton.style.borderColor = '#666';
                             refreshButton.style.transform = 'scale(1)';
                         };
                         
                         refreshButton.onmousedown = () => {
                             refreshButton.style.background = '#444';
                             refreshButton.style.transform = 'scale(0.98)';
                         };
                         
                         refreshButton.onmouseup = () => {
                             refreshButton.style.background = '#555';
                             refreshButton.style.transform = 'scale(1)';
                         };
                         
                         refreshButton.onclick = () => {
                             loadPresets();
                         };
                         
                         // 创建右侧按钮容器
                         const rightSection = zmlCreateEl("div", {
                             style: "display: flex; align-items: center;"
                         });
                         
                         // 将刷新按钮放在关闭按钮左侧
                         rightSection.appendChild(refreshButton);
                         rightSection.appendChild(closeButton);
                         
                         // 组装头部
                         panelHeader.appendChild(panelTitle);
                         panelHeader.appendChild(rightSection);
                          
                         // 预设内容区域
                         const contentArea = zmlCreateEl("div", {
                             style: `height: calc(100% - 50px); overflow-y: auto; padding: 10px;`
                         });
                         
                         // 确保内容区域高度随面板动态调整
                         const updateContentAreaHeight = () => {
                             contentArea.style.height = `calc(100% - 50px)`;
                         };
                         
                         // 监听面板尺寸变化时更新内容区域高度
                         const resizeObserver = new ResizeObserver(updateContentAreaHeight);
                         resizeObserver.observe(presetPanel);
                          
                         // 加载预设函数
                         const loadPresets = () => {
                             // 清空内容区域
                             contentArea.innerHTML = '';
                             
                             // 显示加载状态
                             const loadingEl = zmlCreateEl("div", { textContent: "加载预设中...", style: "text-align: center; color: #aaa; padding: 20px;" });
                             contentArea.appendChild(loadingEl);
                             
                             // 尝试从API获取预设
                             api.fetchApi("/zml/lora/get_lora_presets", {
                                 method: "GET"
                             })
                             .then(response => response.json())
                             .then(data => {
                                 // 移除加载状态
                                 contentArea.innerHTML = '';
                                 
                                 if (data.status === "success" && data.presets && data.presets.length > 0) {
                                     // 以文件夹形式展示预设
                                     data.presets.forEach(preset => {
                                         createPresetFolder(preset);
                                     });
                                 } else {
                                     const noPresetsEl = zmlCreateEl("div", { 
                                         textContent: "暂无保存的预设", 
                                         style: "text-align: center; color: #aaa; padding: 20px; font-style: italic;"
                                     });
                                     contentArea.appendChild(noPresetsEl);
                                 }
                             })
                             .catch(error => {
                                 console.error("加载预设失败:", error);
                                 contentArea.innerHTML = '';
                                 
                                 // 尝试从localStorage获取备选预设
                                 const localStoragePresets = [];
                                 for (let i = 0; i < localStorage.length; i++) {
                                     const key = localStorage.key(i);
                                     if (key.startsWith("zml_lora_preset_")) {
                                         try {
                                             const presetData = JSON.parse(localStorage.getItem(key));
                                             if (presetData && presetData.loras) {
                                                 localStoragePresets.push(presetData);
                                             }
                                         } catch (e) {
                                             console.error("解析localStorage预设失败:", e);
                                         }
                                     }
                                 }
                                 
                                 if (localStoragePresets.length > 0) {
                                     localStoragePresets.forEach(preset => {
                                         createPresetFolder(preset);
                                     });
                                 } else {
                                     const errorEl = zmlCreateEl("div", { 
                                         textContent: "加载预设失败，暂无可用预设", 
                                         style: "text-align: center; color: #ff6666; padding: 20px;"
                                     });
                                     contentArea.appendChild(errorEl);
                                 }
                             });
                         };
                          
                         // 创建预设文件夹
                         const createPresetFolder = (preset) => {
                             const folder = zmlCreateEl("div", { style: "margin-bottom: 15px; border: 1px solid #555; border-radius: 4px; overflow: hidden;" });
                             
                             // 文件夹标题栏
                             const folderHeader = zmlCreateEl("div", {
                                 style: "background: #444; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.2s ease;"
                             });
                              
                             folderHeader.onmouseenter = () => {
                                 folderHeader.style.background = '#4a4a4a';
                                 folderHeader.style.transform = 'translateY(-1px)';
                             };
                              
                             folderHeader.onmouseleave = () => {
                                 folderHeader.style.background = '#444';
                                 folderHeader.style.transform = 'translateY(0)';
                             };
                             
                             folderHeader.onmousedown = () => {
                                 folderHeader.style.background = '#3a3a3a';
                                 folderHeader.style.transform = 'translateY(0)';
                             };
                             
                             folderHeader.onmouseup = () => {
                                 folderHeader.style.background = '#4a4a4a';
                             };
                             
                             const folderTitle = zmlCreateEl("div", { 
                                 style: "display: flex; align-items: center; gap: 10px; font-weight: bold; color: #ddd;"
                             });
                             
                             const folderIcon = zmlCreateEl("span", { textContent: "📁", style: "font-size: 16px;" });
                             const presetName = zmlCreateEl("span", { textContent: preset.name || "未命名预设" });
                             const presetInfo = zmlCreateEl("span", {
                                 textContent: `(${preset.loras ? preset.loras.length : 0}个LoRA)`,
                                 style: "font-size: 13px; color: #aaa; margin-left: 5px;"
                             });
                             
                             folderTitle.appendChild(folderIcon);
                             folderTitle.appendChild(presetName);
                             folderTitle.appendChild(presetInfo);
                             
                             // 文件夹操作按钮
                             const folderActions = zmlCreateEl("div", { style: "display: flex; gap: 8px;" });
                             
                             const sendButton = zmlCreateEl("button", {
                                 textContent: "发送到节点",
                                 style: "background: #2a4a2a; border: 1px solid #446644; color: #ccc; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 13px; transition: all 0.2s ease;"
                             });
                              
                             sendButton.onmouseenter = () => {
                                 sendButton.style.background = '#355a35';
                                 sendButton.style.borderColor = '#557755';
                                 sendButton.style.transform = 'scale(1.05)';
                             };
                              
                             sendButton.onmouseleave = () => {
                                 sendButton.style.background = '#2a4a2a';
                                 sendButton.style.borderColor = '#446644';
                                 sendButton.style.transform = 'scale(1)';
                             };
                             
                             sendButton.onmousedown = () => {
                                 sendButton.style.background = '#254525';
                                 sendButton.style.transform = 'scale(0.98)';
                             };
                             
                             sendButton.onmouseup = () => {
                                 sendButton.style.background = '#2a4a2a';
                                 sendButton.style.transform = 'scale(1)';
                             };
                             
                             sendButton.onclick = (e) => {
                                 e.stopPropagation();
                                 // 添加确认对话框
                                 if (confirm(`确定要添加预设 '${preset.name || "未命名预设"}' 吗？\n此操作将添加 ${preset.loras ? preset.loras.length : 0} 个LoRA到您的节点中。`)) {
                                     applyPreset(preset);
                                 }
                             };
                             
                             folderActions.appendChild(sendButton);
                             
                             // 删除按钮
                             const deleteButton = zmlCreateEl("button", {
                                 textContent: "删除",
                                 style: "background: #5a2a2a; border: 1px solid #664444; color: #ccc; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 13px; transition: all 0.2s ease;"
                             });
                              
                             deleteButton.onmouseenter = () => {
                                 deleteButton.style.background = '#6a3a3a';
                                 deleteButton.style.borderColor = '#775555';
                                 deleteButton.style.transform = 'scale(1.05)';
                             };
                              
                             deleteButton.onmouseleave = () => {
                                 deleteButton.style.background = '#5a2a2a';
                                 deleteButton.style.borderColor = '#664444';
                                 deleteButton.style.transform = 'scale(1)';
                             };
                             
                             deleteButton.onmousedown = () => {
                                 deleteButton.style.background = '#502525';
                                 deleteButton.style.transform = 'scale(0.98)';
                             };
                             
                             deleteButton.onmouseup = () => {
                                 deleteButton.style.background = '#5a2a2a';
                                 deleteButton.style.transform = 'scale(1)';
                             };
                             
                             deleteButton.onclick = (e) => {
                                 e.stopPropagation();
                                 if (confirm(`确定要删除预设 '${preset.name || "未命名预设"}' 吗？此操作不可恢复。`)) {
                                     deletePreset(preset.name);
                                 }
                             };
                             
                             folderActions.appendChild(deleteButton);
                             folderHeader.appendChild(folderTitle);
                             folderHeader.appendChild(folderActions);
                             
                             // 文件夹内容
                             const folderContent = zmlCreateEl("div", {
                                 style: "background: #3a3a3a; padding: 10px; display: none; max-height: 200px; overflow-y: auto;"
                             });
                             
                             // 切换文件夹展开/折叠
                             let isExpanded = false;
                             folderHeader.onclick = () => {
                                 isExpanded = !isExpanded;
                                 folderContent.style.display = isExpanded ? 'block' : 'none';
                                 
                                 // 如果展开且内容为空，加载内容
                                 if (isExpanded && folderContent.children.length === 0 && preset.loras) {
                                     preset.loras.forEach((lora, index) => {
                                         const loraItem = zmlCreateEl("div", { style: `padding: 8px; border-bottom: 1px solid #444; ${index === preset.loras.length - 1 ? 'border-bottom: none;' : ''}` });
                                         
                                         const loraName = zmlCreateEl("div", { 
                                             textContent: lora.name || "未命名LoRA", 
                                             style: "font-weight: bold; color: #ddd;"
                                         });
                                          
                                         const loraInfo = zmlCreateEl("div", { 
                                             textContent: `${lora.display_name ? '名称：' + lora.display_name + ' | ' : ''}权重: ${lora.weight || 1.0} | 启用: ${lora.enabled ? '是' : '否'}`, 
                                             style: "font-size: 13px; color: #aaa; margin-top: 4px;"
                                         });
                                          
                                         loraItem.appendChild(loraName);
                                         loraItem.appendChild(loraInfo);
                                          
                                         if (lora.custom_text) {
                                             const loraText = zmlCreateEl("div", { 
                                                 textContent: `自定义文本: ${lora.custom_text}`, 
                                                 style: "font-size: 13px; color: #aaa; margin-top: 4px;"
                                             });
                                             loraItem.appendChild(loraText);
                                         }
                                         folderContent.appendChild(loraItem);
                                     });
                                 }
                             };
                             
                             folder.appendChild(folderHeader);
                             folder.appendChild(folderContent);
                             contentArea.appendChild(folder);
                         };
                          
                         // 应用预设函数
                         const applyPreset = (preset) => {
                             if (!preset.loras || preset.loras.length === 0) {
                                 alert("预设中没有LoRA配置！");
                                 return;
                             }
                             
                             // 简单的UUID生成函数
                             const generateUUID = () => {
                                 return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                                     const r = Math.random() * 16 | 0;
                                     const v = c === 'x' ? r : (r & 0x3 | 0x8);
                                     return v.toString(16);
                                 });
                             };
                              
                             // 创建文件夹映射，用于快速查找文件夹ID
                             const folderMap = new Map();
                               
                             // 获取当前已有文件夹并添加到映射中
                             this.powerLoraLoader_data.entries.forEach(entry => {
                                 if (entry.item_type === 'folder') {
                                     folderMap.set(entry.name, entry.id);
                                 }
                             });
                              
                             // 处理预设中的文件夹（如果有）
                             if (preset.folders && Array.isArray(preset.folders)) {
                                 preset.folders.forEach(folderData => {
                                     const folderId = folderData.id || generateUUID();
                                     const newFolder = {
                                    id: folderId,
                                    item_type: 'folder',
                                    parent_id: folderData.parent_id || null,
                                    name: folderData.name || "未命名文件夹",
                                    order: this.powerLoraLoader_data.entries.length
                                };
                                     
                                    this.powerLoraLoader_data.entries.push(newFolder);
                                     folderMap.set(folderData.name, folderId);
                                 });
                             }
                              
                             // 如果预设中没有文件夹信息，创建一个与预设同名的文件夹
                             if (!preset.folders || preset.folders.length === 0) {
                                 const presetFolderName = preset.name || "未命名预设";
                                 const presetFolderId = generateUUID();
                                  
                                 const presetFolder = {
                                     id: presetFolderId,
                                     item_type: 'folder',
                                     parent_id: null,
                                     name: presetFolderName,
                                     order: this.powerLoraLoader_data.entries.length
                                 };
                                      
                                 this.powerLoraLoader_data.entries.push(presetFolder);
                                 folderMap.set(presetFolderName, presetFolderId);
                             }
                              
                             // 添加预设中的LoRA条目，并将其关联到对应的文件夹
                             preset.loras.forEach((loraData, index) => {
                                 // 确定LoRA应该放入哪个文件夹
                                 let parentFolderId = null;
                                  
                                 if (loraData.folder_id) {
                                     // 如果LoRA指定了文件夹ID，直接使用
                                     parentFolderId = loraData.folder_id;
                                 } else if (loraData.folder_name && folderMap.has(loraData.folder_name)) {
                                     // 如果LoRA指定了文件夹名称且该文件夹存在
                                     parentFolderId = folderMap.get(loraData.folder_name);
                                 } else if (folderMap.size === 1) {
                                     // 如果只有一个文件夹，默认使用它
                                     parentFolderId = folderMap.values().next().value;
                                 }
                                  
                                 const newLoraEntry = {
                                     id: generateUUID(), // 使用本地函数而不是this.generateUUID
                                     item_type: 'lora',
                                     parent_id: parentFolderId,
                                     lora_name: loraData.name || "",
                                     display_name: loraData.display_name || "",
                                     weight: loraData.weight || 1.0,
                                     custom_text: loraData.custom_text || "",
                                     enabled: loraData.enabled !== undefined ? loraData.enabled : true,
                                     order: this.powerLoraLoader_data.entries.length
                                 };
                                  
                                 this.powerLoraLoader_data.entries.push(newLoraEntry);
                             });
                             
                             // 重新渲染
                             this.renderLoraEntries();
                             this.triggerSlotChanged();
                             
                             alert(`成功添加预设: ${preset.name || "未命名预设"}，包含${folderMap.size}个文件夹和${preset.loras.length}个LoRA`);
                             closePresetPanel();
                         };
                          
                         // 关闭面板函数
                         const closePresetPanel = () => {
                             if (overlay) {
                                 overlay.style.display = 'none';
                             }
                             if (presetPanel) {
                                 presetPanel.style.display = 'none';
                             }
                         };
                          
                         // 删除预设函数
                         const deletePreset = (presetName) => {
                             if (!presetName) {
                                 alert("预设名称无效，无法删除！");
                                 return;
                             }
                              
                             // 显示加载状态
                             const loadingIndicator = document.createElement('div');
                             loadingIndicator.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 10px 20px; border-radius: 4px; z-index: 2000;';
                             loadingIndicator.textContent = '删除预设中...';
                             document.body.appendChild(loadingIndicator);
                              
                             // 调用删除API
                             api.fetchApi("/zml/lora/delete_lora_preset", {
                                 method: "POST",
                                 headers: {
                                     "Content-Type": "application/json"
                                 },
                                 body: JSON.stringify({ name: presetName })
                             })
                             .then(response => response.json())
                             .then(data => {
                                 document.body.removeChild(loadingIndicator);
                                  
                                 if (data.status === "success") {
                                     alert(data.message);
                                     // 重新加载预设列表
                                     loadPresets();
                                 } else {
                                     alert(`删除失败: ${data.message || "未知错误"}`);
                                 }
                             })
                             .catch(error => {
                                 document.body.removeChild(loadingIndicator);
                                 console.error("删除预设失败:", error);
                                 alert(`删除预设时出错: ${error.message}`);
                             });
                         };
                          
                         // 添加面板头部和内容区域
                         presetPanel.appendChild(panelHeader);
                         presetPanel.appendChild(contentArea);
                         
                         // 添加到document body
                         document.body.appendChild(overlay);
                         document.body.appendChild(presetPanel);
                         
                         // 初始加载预设
                         loadPresets();
                         
                         // 添加ESC键关闭面板
                         const handleEscKey = (e) => {
                             if (e.key === 'Escape' && presetPanel && presetPanel.style.display === 'block') {
                                 closePresetPanel();
                             }
                         };
                         
                         document.addEventListener('keydown', handleEscKey);
                         
                         // 保存对handleEscKey的引用，以便后续移除监听器
                         presetPanel._escKeyHandler = handleEscKey;
                     };
                     
                     // 点击按钮打开预设面板
                     presetButton.onclick = (e) => {
                         e.stopPropagation();
                         loadPresetPanel();
                     };
                     
                     topControls.appendChild(presetButton);

                     const entriesList = zmlCreateEl("div", { className: "zml-pll-entries-list" });// <-- 这里会调用到局部定义的 zmlCreateEl

                     const bottomControls = zmlCreateEl("div", { className: "zml-pll-controls-bottom" });// <-- 这里会调用到局部定义的 zmlCreateEl

                     // --- 新增：批量添加 LoRA 按钮 ---
                     const batchAddLoraBtn = zmlCreateEl("button", { className: "zml-pll-button zml-pll-button-lg", textContent: "批量添加 LoRA" }); // 使用 zmlCreateEl
                     batchAddLoraBtn.title = "从文件系统批量选择 LoRA";
                     batchAddLoraBtn.onclick = async () => {
                         // 在每次打开批量添加模态框前确保 loraImages 是最新的
                         await loadImageList().catch(e => console.error("Error reloading lora images for batch add:", e));
                         showBatchLoraModal(this, this.loraTree); // 传递节点实例和 loraTree
                         // console.log("Current loraTree:", this.loraTree); // Debugging
                     };
                     bottomControls.appendChild(batchAddLoraBtn);
                     // --- 结束：批量添加 LoRA 按钮 ---
                     
                     const newLoraBtn = zmlCreateEl("button", { className: "zml-pll-button zml-pll-button-lg", textContent: "＋ 添加 Lora" });// <-- 这里会调用到局部定义的 zmlCreateEl
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
                        },
                        simple: {
                            cardPadding: "3px", inputPadding: "3px 6px", inputHeight: "35px", checkboxScale: "1.8", // 进一步降低高度
                        }
                    };

                     this.applySizeMode = () => {
                        const s = this.stylesPLL[this.viewMode] || this.stylesPLL.normal;
                        entriesList.style.setProperty('--pll-current-input-height', s.inputHeight);
                        entriesList.style.setProperty('--pll-current-input-padding', s.inputPadding);
                        // 添加布局模式数据属性，用于CSS选择器
                        entriesList.dataset.layout = this.viewMode;
                        this.renderLoraEntries();
                     };

                     this.createLoraEntryDOM = (entry) => { // Removed index parameter as it's not strictly needed for rendering
                         const s = this.stylesPLL[this.viewMode] || this.stylesPLL.normal;
                         const entryCard = zmlCreateEl("div", { // <-- 这里会调用到局部定义的 zmlCreateEl
                             className: "zml-pll-entry-card",
                             style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${this.loraEntryColor}; border-radius: 2px; ${entry.enabled && this.isLocked ? `border: 3px solid ${this.enabledStateColor};` : 'border: 1px solid transparent;'} cursor: pointer;` // 只在锁定模式且启用时显示边框
                         });
                         entryCard.dataset.id = entry.id;
                         entryCard.dataset.type = "lora";
                          
                         // 添加点击事件来切换启用/禁用状态
                         entryCard.onclick = (e) => {
                             // 如果点击的是输入框或按钮等交互元素，不触发切换
                             if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.classList.contains('zml-pll-drag-handle') || e.target.parentElement?.classList.contains('zml-lora-entry-delete')) {
                                 return;
                             }
                             entry.enabled = !entry.enabled;
                             this.renderLoraEntries();
                             this.triggerSlotChanged();
                         };

                         const checkbox = zmlCreateEl("input", { type: "checkbox", checked: entry.enabled });// <-- 这里会调用到局部定义的 zmlCreateEl
                        // 移除默认样式，使用自定义样式
                        checkbox.style.appearance = 'none';
                        checkbox.style.webkitAppearance = 'none';
                        checkbox.style.mozAppearance = 'none';
                        checkbox.style.width = '18px';
                        checkbox.style.height = '18px';
                        checkbox.style.cursor = 'pointer';
                        checkbox.style.borderRadius = '3px';
                        checkbox.style.display = 'flex';
                        checkbox.style.alignItems = 'center';
                        checkbox.style.justifyContent = 'center';
                        checkbox.style.fontSize = '14px';
                        checkbox.style.fontWeight = 'bold';
                        
                        // 更新复选框样式函数
                        const updateCheckboxStyle = () => {
                            checkbox.checked = entry.enabled;
                            checkbox.style.backgroundColor = entry.enabled ? this.enabledStateColor : 'transparent';
                            checkbox.style.border = `2px solid ${entry.enabled ? this.enabledStateColor : '#555'}`;
                            checkbox.style.color = entry.enabled ? '#fff' : 'transparent';
                            checkbox.textContent = entry.enabled ? '✓' : '';
                        };
                        
                        // 初始设置样式
                        updateCheckboxStyle();
                        
                        // 监听状态变化并更新样式
                        checkbox.onchange = (e) => { 
                            e.stopPropagation(); // 阻止事件冒泡
                            entry.enabled = e.target.checked; 
                            updateCheckboxStyle(); // 更新复选框样式
                            this.renderLoraEntries(); 
                            this.triggerSlotChanged(); 
                        };

                         const dragHandle = zmlCreateEl("div", { className: "zml-pll-drag-handle", textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: 14px;` });// <-- 这里会调用到局部定义的 zmlCreateEl
                         dragHandle.draggable = !this.isLocked;
                         dragHandle.onclick = (e) => e.stopPropagation(); // 阻止事件冒泡

                         const displayNameInput = zmlCreateEl("input", { 
                             className: "zml-lora-display-name-input", 
                             type: "text", 
                             value: entry.display_name, 
                             placeholder: "输入名称...", 
                             title: "自定义此LoRA条目的显示名称", 
                             style: `width: ${this.loraNameWidth}px; ${this.isLocked ? 'pointer-events: none; background: #333;' : ''}` // 锁定状态下禁用交互但保持正常亮度
                         });// <-- 这里会调用到局部定义的 zmlCreateEl
                         
                         // 只在非锁定状态下添加事件处理
                         if (!this.isLocked) {
                             // --- 修改开始：oninput 不再触发 triggerSlotChanged，改为 onblur 触发 ---
                             displayNameInput.oninput = (e) => {
                                 e.stopPropagation(); // 阻止事件冒泡
                                 entry.display_name = e.target.value;
                                 // 不再在此处调用 this.triggerSlotChanged()
                             };
                             displayNameInput.onblur = () => {
                                 this.triggerSlotChanged(); // 在输入框失去焦点时触发更新
                             };
                             // --- 修改结束 ---
                         }
                         displayNameInput.onclick = (e) => e.stopPropagation(); // 阻止事件冒泡

                         const loraSelectorBtn = zmlCreateEl("button", { 
                             style: `flex-grow: 1; min-width: 100px; padding: ${s.inputPadding}; background: #222; border: 1px solid #555; border-radius: 2px; color: #ccc; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: ${s.inputHeight}; ${this.isLocked ? 'pointer-events: none;' : ''}` // 锁定状态下禁用交互但保持正常亮度
                         }, entry.lora_name === "None" ? "None" : (entry.lora_name || "").split(/[/\\]/).pop());// <-- 这里会调用到局部定义的 zmlCreateEl
                         
                         // 只在非锁定状态下添加点击事件
                         if (!this.isLocked) {
                             loraSelectorBtn.onclick = (e) => {
                                 e.stopPropagation(); // 阻止事件冒泡
                                 if (activeLoraMenu) activeLoraMenu.close(); 
                                 activeLoraMenu = this.createLoraTreeMenu(loraSelectorBtn, entry, () => { 
                                     loraSelectorBtn.textContent = entry.lora_name === "None" ? "None" : (entry.lora_name || "").split(/[/\\]/).pop(); 
                                     this.triggerSlotChanged(); 
                                 }); 
                             };
                         } else {
                             loraSelectorBtn.onclick = (e) => e.stopPropagation(); // 阻止事件冒泡
                         }

                         const weightWidget = zmlCreateEl("div", { style: `display: flex; align-items: center; background: #222; border: 1px solid #555; border-radius: 2px; height: ${s.inputHeight};` });// <-- 这里会调用到局部定义的 zmlCreateEl
                         
                         // 实心三角形按钮 (新增 class)
                         const decBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                             className: "zml-weight-btn", // New class
                             style: `background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%; display: flex; align-items: center; justify-content: center;`
                         }, "◀");
                         const incBtn = zmlCreateEl("button", { // 使用 zmlCreateEl
                             className: "zml-weight-btn", // New class
                             style: `background: none; border: none; color: #ccc; cursor: pointer; padding: 0 2px; height: 100%; display: flex; align-items: center; justify-content: center;`
                         }, "▶");

                         // 权重输入框 (恢复默认宽度，通过CSS为精简布局单独设置)
                         const weightInput = zmlCreateEl("input", { // 使用 zmlCreateEl
                            className: "zml-lora-weight-input",
                            type: "text", // 改为文本输入，允许任意字符，失去焦点时再校验
                            value: entry.weight.toFixed(2),
                            title: "LoRA 权重 (点击可直接输入数值)",
                            style: `width: 25px;` // 恢复默认宽度
                         });
                         
                         weightInput.onfocus = (e) => {
                             e.stopPropagation(); // 阻止事件冒泡
                             e.target.select(); // 选中全部内容方便修改
                         };
                         weightInput.onblur = (e) => {
                             e.stopPropagation(); // 阻止事件冒泡
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
                             e.stopPropagation(); // 阻止事件冒泡
                             if (e.key === "Enter") {
                                 e.target.blur(); // 按下回车键时失去焦点，触发校验
                             }
                         };

                         decBtn.onclick = (e) => { 
                             e.stopPropagation(); // 阻止事件冒泡
                             entry.weight = parseFloat((entry.weight - 0.05).toFixed(2)); 
                             entry.weight = Math.max(-10, entry.weight);
                             weightInput.value = entry.weight.toFixed(2); 
                             this.triggerSlotChanged(); 
                         };
                         incBtn.onclick = (e) => { 
                             e.stopPropagation(); // 阻止事件冒泡
                             entry.weight = parseFloat((entry.weight + 0.05).toFixed(2)); 
                             entry.weight = Math.min(10, entry.weight);
                             weightInput.value = entry.weight.toFixed(2); 
                             this.triggerSlotChanged(); 
                         };
                         weightWidget.append(decBtn, weightInput, incBtn);


                         const customTextInput = zmlCreateEl("textarea", { // <-- 这里会调用到局部定义的 zmlCreateEl
                            className: "zml-lora-custom-text-input",
                            value: entry.custom_text || "",
                            placeholder: "输入文本",
                            title: "点击编辑 LoRA 的自定义文本内容",
                            readOnly: this.isLocked, // 在锁定状态下设置为只读
                            style: `width: ${this.customTextWidth}px; ${this.isLocked ? 'pointer-events: none; background: #333;' : ''}` // 锁定状态下禁用交互但保持正常亮度
                         });
                         
                         // 只在非锁定状态下添加点击事件
                         if (!this.isLocked) {
                             // 监听点击事件，弹出编辑弹窗，传递当前节点实例
                             const currentNodeInstance = this;
                             customTextInput.onclick = (e) => {
                                e.stopPropagation(); // 阻止事件冒泡
                                showPllEditContentModal(entry, currentNodeInstance);
                             };
                         } else {
                             customTextInput.onclick = (e) => e.stopPropagation(); // 阻止事件冒泡
                         }


                         // === 移出文件夹按钮 (新增) ===
                         if (this.viewMode === 'simple') {
                             // 在精简模式下，不显示自定义名称和自定义文本输入框
                             if (entry.parent_id) { // Only show if Lora is in a folder
                                const moveOutBtn = zmlCreateEl("button", { // <-- 这里会调用到局部定义的 zmlCreateEl
                                    style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #4a6a4a; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0;`,
                                    title: "移出文件夹"
                                }, "⬆️");
                                moveOutBtn.onclick = () => {
                                    entry.parent_id = null; // Set parent_id to null to make it top-level
                                    this.renderLoraEntries();
                                    this.triggerSlotChanged();
                                };
                                entryCard.append(checkbox, dragHandle, loraSelectorBtn, weightWidget, moveOutBtn);
                             } else {
                                 entryCard.append(checkbox, dragHandle, loraSelectorBtn, weightWidget);
                             }
                         } else {
                             // 常规模式下，显示所有元素
                             if (entry.parent_id) { // Only show if Lora is in a folder
                                const moveOutBtn = zmlCreateEl("button", { // <-- 这里会调用到局部定义的 zmlCreateEl
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
                         }
                         // ===========================

                         const deleteBtn = zmlCreateEl("button", { // <-- 这里会调用到局部定义的 zmlCreateEl
                            className: "zml-lora-entry-delete", // 添加新 class
                            style: `width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0; ${this.isLocked ? 'pointer-events: none; color: #666;' : ''}` // 在锁定状态下禁用删除按钮但保持正常亮度
                         }, "X");
                         
                         // 只在非锁定状态下添加点击事件
                         if (!this.isLocked) {
                             deleteBtn.onclick = (e) => {
                                 e.stopPropagation(); // 阻止事件冒泡
                                 const itemIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === entry.id);
                                 if (itemIndex > -1) {
                                     this.powerLoraLoader_data.entries.splice(itemIndex, 1);
                                     this.renderLoraEntries();
                                     this.triggerSlotChanged();
                                 }
                             };
                         } else {
                             deleteBtn.onclick = (e) => e.stopPropagation(); // 阻止事件冒泡
                         }
                         entryCard.appendChild(deleteBtn);
                         
                         this.addDragDropHandlers(entryCard, entry);
                         return entryCard;
                     };

                     this.createFolderDOM = (entry) => { // Removed index parameter
                         const folderCard = zmlCreateEl("div", {  // <-- 这里会调用到局部定义的 zmlCreateEl
                            className: "zml-pll-folder-card",
                            style: `background: ${this.folderColor}; border: 1px solid ${this.folderColor};` // 保持边框与背景相同颜色
                         });
                         folderCard.dataset.id = entry.id;
                         folderCard.dataset.type = "folder";

                         const header = zmlCreateEl("div", { className: "zml-pll-folder-header" }); // <-- 这里会调用到局部定义的 zmlCreateEl
                         const toggle = zmlCreateEl("div", { className: "zml-pll-folder-toggle", textContent: entry.is_collapsed ? "▶" : "▼" });// <-- 这里会调用到局部定义的 zmlCreateEl
                         const dragHandle = zmlCreateEl("div", { className: "zml-pll-drag-handle", textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; color: ${this.isLocked ? '#666' : '#ccc'}; user-select: none; font-size: 14px; padding: 0 5px;` });// <-- 这里会调用到局部定义的 zmlCreateEl
                          
                         // 添加一键启用/禁用所有LoRA的左右滑动开关
                         const allLoraToggle = zmlCreateEl("label", { 
                             className: "zml-pll-folder-toggle-switch",
                             style: `position: relative; display: inline-block; width: 40px; height: 20px; margin: 0 5px; cursor: ${this.isLocked ? 'not-allowed' : 'pointer'}; opacity: 1;` // 移除锁定状态下的透明度调整
                         });
                         
                         const toggleInput = zmlCreateEl("input", { 
                             type: "checkbox",
                             style: "opacity: 0; width: 0; height: 0;"
                         });
                         
                         const toggleSlider = zmlCreateEl("span", { 
                             className: "zml-pll-folder-toggle-slider",
                             style: `position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: .4s; border-radius: 20px;`
                         });
                         
                         // 在滑块内部添加一个小圆点
                         const toggleDot = zmlCreateEl("span", { 
                             style: `position: absolute; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%;`
                         });
                         
                         toggleSlider.appendChild(toggleDot);
                         allLoraToggle.appendChild(toggleInput);
                         allLoraToggle.appendChild(toggleSlider);
                         
                         // 检查文件夹内的LoRA是否全部启用，用于初始化开关状态
                         const folderLoras = this.powerLoraLoader_data.entries.filter(it => it.parent_id === entry.id && it.type !== 'folder');
                         const allEnabled = folderLoras.length > 0 && folderLoras.every(lora => lora.enabled);
                         toggleInput.checked = allEnabled;
                         
                         // 更新滑块样式 - 使用箭头函数以保持this上下文
                         const updateSliderStyle = () => {
                             if (toggleInput.checked) {
                                 toggleSlider.style.backgroundColor = this.enabledStateColor; // 使用自定义的开启状态颜色
                                 toggleDot.style.transform = "translateX(20px)";
                             } else {
                                 toggleSlider.style.backgroundColor = "#333";
                                 toggleDot.style.transform = "translateX(0)";
                             }
                         };
                         
                         // 初始化滑块样式
                         updateSliderStyle();
                         
                         // 绑定开关事件 - 移除锁定检查，允许在锁定模式下操作文件夹开关
                         toggleInput.onchange = (e) => {
                             const isEnabled = e.target.checked;
                             // 遍历文件夹内所有LoRA并设置启用/禁用状态
                             const folderLoras = this.powerLoraLoader_data.entries.filter(it => it.parent_id === entry.id && it.type !== 'folder');
                             folderLoras.forEach(lora => {
                                 lora.enabled = isEnabled;
                             });
                              
                             updateSliderStyle();
                             this.renderLoraEntries();
                             this.triggerSlotChanged();
                         };
                         
                         // 当鼠标点击开关时阻止事件冒泡，避免触发文件夹折叠
                         allLoraToggle.addEventListener("mousedown", (e) => {
                             e.stopPropagation();
                         });
                         
                         const nameInput = zmlCreateEl("input", { className: "zml-pll-folder-name-input", type: "text", value: entry.name });// <-- 这里会调用到局部定义的 zmlCreateEl
                         
                         // 添加保存预设按钮
                         const savePresetBtn = zmlCreateEl("button", { 
                             className: "zml-pll-folder-save-preset", 
                             textContent: "💾",
                             title: "保存文件夹内的LoRA预设",
                             style: `margin: 0 5px; padding: 5px 8px; border: 1px solid #555; border-radius: 3px; background: #2a4a2a; color: #ccc; cursor: pointer; ${this.isLocked ? 'pointer-events: none; opacity: 0.5;' : ''}`
                         });
                         
                         savePresetBtn.onclick = (e) => {
                             e.stopPropagation(); // 阻止事件冒泡，防止触发文件夹折叠
                             
                             // 弹出确认对话框
                             if (!confirm(`确定要保存"${entry.name}"文件夹中的所有LoRA到预设吗？`)) {
                                 return;
                             }
                             
                             // 获取文件夹内所有LoRA条目
                             const folderLoras = this.powerLoraLoader_data.entries.filter(
                                 it => it.parent_id === entry.id && it.item_type === 'lora'
                             );
                             
                             if (folderLoras.length === 0) {
                                 alert("文件夹内没有LoRA，无法保存预设！");
                                 return;
                             }
                             
                             // 准备保存的数据格式
                             const presetData = {
                                 name: entry.name,
                                 timestamp: new Date().toISOString(),
                                 loras: folderLoras.map(lora => ({
                                     name: lora.lora_name,
                                     display_name: lora.display_name,
                                     weight: lora.weight,
                                     custom_text: lora.custom_text || "",
                                     enabled: lora.enabled
                                 }))
                             };
                             
                             try {
                                 // 调用我们新创建的专用API端点
                                 api.fetchApi("/zml/lora/save_lora_preset", {
                                     method: "POST",
                                     headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify(presetData)
                                 })
                                 .then(response => response.json())
                                 .then(data => {
                                     if (data.status === "success") {
                                         alert(`成功保存预设到: ComfyUI-ZML-Image/zml_w/txt/Preset LoRA/Preset LoRA.json\n预设名称: ${entry.name}`);
                                     } else {
                                         console.error("API返回错误:", data.message);
                                         alert(`保存预设失败: ${data.message || "未知错误"}`);
                                     }
                                 })
                                 .catch(error => {
                                     console.error("保存预设时出错:", error);
                                     // 如果API调用失败，尝试保存到localStorage作为备选方案
                                     localStorage.setItem(`zml_lora_preset_${entry.id}`, JSON.stringify(presetData));
                                     alert(`API调用失败，已将预设保存到浏览器本地存储。预设名称: ${entry.name}`);
                                 });
                             } catch (e) {
                                 console.error("保存预设时发生异常:", e);
                                 alert(`保存预设失败: ${e.message || "未知错误"}`);
                             }
                         };
                          
                         const deleteBtn = zmlCreateEl("button", { className: "zml-pll-folder-delete", textContent: "🗑️" });// <-- 这里会调用到局部定义的 zmlCreateEl
                         dragHandle.draggable = !this.isLocked;

                         const content = zmlCreateEl("div", { className: `zml-pll-folder-content ${entry.is_collapsed ? 'hidden' : ''}` });// <-- 这里会调用到局部定义的 zmlCreateEl
                         // Apply the same border color as the folder card header for consistency
                         content.style.borderColor = adjustBrightness(this.folderColor, -15);


                         header.addEventListener("mousedown", (e) => {
                             e.stopImmediatePropagation(); // 阻止所有其他事件监听器
                             // 先检查目标元素是否是输入框、删除按钮、拖动句柄或保存预设按钮
                             if (e.target === nameInput || e.target === deleteBtn || e.target === dragHandle || e.target === savePresetBtn) {
                                 return; // 不阻止这些元素的默认行为
                             }
                             e.preventDefault(); // 阻止默认的 mousedown 行为
                             // Check if the click happened directly on the header or the toggle button
                             if (e.target === header || e.target === toggle || e.target.parentElement === header) {
                                 entry.is_collapsed = !entry.is_collapsed;
                                 toggle.textContent = entry.is_collapsed ? "▶" : "▼";
                                 content.classList.toggle('hidden', entry.is_collapsed);
                                 this.triggerSlotChanged();
                             }
                         });
                         
                         nameInput.onchange = (e) => { entry.name = e.target.value; this.triggerSlotChanged(); };
                         
                         deleteBtn.onclick = (e) => {
                             e.stopPropagation();
                             const children = this.powerLoraLoader_data.entries.filter(it => it.parent_id === entry.id);
                             if (children.length > 0) {
                                 if (!confirm("文件夹内含有LoRA！\n确定要强制删除此文件夹及其所有内容吗？")) {
                                     return;
                                 }
                                 // 强制删除时，同时删除所有子项
                                 for (const child of children) {
                                     const childIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === child.id);
                                     if (childIndex > -1) {
                                         this.powerLoraLoader_data.entries.splice(childIndex, 1);
                                     }
                                 }
                             }
                             const itemIndex = this.powerLoraLoader_data.entries.findIndex(it => it.id === entry.id);
                             if (itemIndex > -1) {
                                 this.powerLoraLoader_data.entries.splice(itemIndex, 1);
                                 this.renderLoraEntries();
                                 this.triggerSlotChanged();
                             }
                         };

                         header.append(toggle, dragHandle, allLoraToggle, nameInput, savePresetBtn, deleteBtn);
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
                                 if (item.item_type === 'folder' && domInfo.dom) {
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
                        // Ensure minimum width
                         size[0] = Math.max(size[0], POWER_LORA_LOADER_MIN_WIDTH);
                         
                         // Apply a fixed minimum height for the node, allowing content scroll independently
                         const minNodeHeight = POWER_LORA_LOADER_MIN_HEIGHT_EMPTY_LIST; // Or a slightly smaller absolute value if controls are compact
                         size[1] = Math.max(size[1] || minNodeHeight, minNodeHeight);

                         this.size = size;

                         const domElement = this.domElement;
                         if (domElement) {
                             // Handle horizontal overflow for the entire domElement if content grows too wide
                             if (this.content && size[0] < this.content.scrollWidth) { // Check if internal content (`container` element) overflows horizontally
                                domElement.style.overflowX = 'auto';
                             } else {
                                domElement.style.overflowX = 'hidden';
                             }
                             // `entriesList` already has `overflow-y: auto` and `flex: 1`
                             // so it will manage its own vertical scrolling within the space allocated by the node's current height.
                           
                             // For debugging (optional):
                             // console.log(`[onResize] Node ID: ${this.id}, Current Size: [${this.size[0]}, ${this.size[1]}]`);
                             // console.log(`[onResize] entriesList scrollHeight: ${entriesList.scrollHeight}, clientHeight: ${entriesList.clientHeight}`);
                         }

                         if (origOnResize) origOnResize.call(this, size);
                     };

                     // --- 修改：triggerSlotChanged 保持不变，因为它需要调用 renderLoraEntries ---
                     this.triggerSlotChanged = () => {
                         dataWidget.value = JSON.stringify(this.powerLoraLoader_data);
                         this.renderLoraEntries(); // 确保UI立即刷新
                         this.onResize(this.size); // 立即重新计算并应用尺寸
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
                                 if (!this.domElement) return;
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
                // 创建菜单容器
                const menu = zmlCreateEl("div", { className: "zml-lora-tree-menu" });
                const closeMenu = () => { menu.remove(); document.removeEventListener("click", clickOutside, true); activeLoraMenu = null; };

                const ext = app.extensions.find(e => e.name === "zml.LoraLoader.Final.v9");
                const imageHost = ext?.imageHost;
                const showImage = ext?.showImage;
                const hideImage = ext?.hideImage;

                // 设置菜单样式为flex布局
                menu.style.display = "flex";
                menu.style.flexDirection = "column";
                menu.style.minWidth = "480px";
                menu.style.maxWidth = "1000px";
                menu.style.minHeight = "300px";
                menu.style.maxHeight = "700px";
                menu.style.backgroundColor = "#1e1e1e";
                menu.style.border = "1px solid #444";
                menu.style.borderRadius = "4px";
                menu.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.5)";
                menu.style.zIndex = "10000";

                // 添加搜索框（在顶部）
                const searchInput = zmlCreateEl("input", {
                    className: "zml-lora-search-input",
                    placeholder: "搜索模型...",
                    type: "text"
                });
                searchInput.style.width = "100%";
                searchInput.style.boxSizing = "border-box";
                searchInput.style.padding = "8px 12px";
                searchInput.style.margin = "0";
                searchInput.style.backgroundColor = "#2b2b2b";
                searchInput.style.border = "none";
                searchInput.style.borderBottom = "1px solid #444";
                searchInput.style.color = "#ccc";
                searchInput.style.fontSize = "14px";
                menu.appendChild(searchInput);

                // 创建内容区域容器（使用flex布局实现左右分栏）
                const contentContainer = zmlCreateEl("div", { style: "display: flex; flex: 1; overflow: hidden;" });
                menu.appendChild(contentContainer);

                // 创建左侧文件夹树容器
                const folderTreeContainer = zmlCreateEl("div", { 
                    className: "zml-lora-folder-tree", 
                    style: "width: 180px; border-right: 1px solid #444; overflow-y: auto; padding: 8px; max-height: 600px; flex-shrink: 0;"
                });
                folderTreeContainer.style.backgroundColor = "#1a1a1a";
                
                // 创建右侧文件列表容器
                const fileListContainer = zmlCreateEl("div", { 
                    className: "zml-lora-file-list", 
                    style: "flex: 1; overflow-x: auto; overflow-y: auto; padding: 8px; min-width: 350px; max-width: none; width: 600px; white-space: nowrap;"
                });
                
                contentContainer.appendChild(folderTreeContainer);
                contentContainer.appendChild(fileListContainer);
                
                // 创建搜索结果容器（覆盖整个内容区域）
                const searchResults = zmlCreateEl("div", { 
                    className: "zml-lora-menu-search-results", 
                    style: "display: none; position: absolute; top: 40px; left: 0; right: 0; bottom: 0; background: #1e1e1e; padding: 8px; overflow-y: auto;"
                });
                menu.appendChild(searchResults);

                // 构建文件夹树
                const buildFolderTree = (parent, treeLevel, currentPath = '') => {
                    Object.keys(treeLevel.folders).sort().forEach(folderName => {
                        const folderEl = zmlCreateEl("div", { 
                            className: "zml-lora-folder", 
                            innerHTML: `<span class="zml-lora-folder-arrow">▶</span> ${folderName}`,
                            style: "padding: 3px 5px; margin-bottom: 1px; border-radius: 3px; cursor: pointer;"
                        });
                        
                        // 文件夹点击事件 - 显示内容
                        folderEl.onclick = (e) => {
                            e.stopPropagation();
                            
                            // 更新所有文件夹的样式
                            const allFolders = folderTreeContainer.querySelectorAll('.zml-lora-folder');
                            allFolders.forEach(f => {
                                f.style.backgroundColor = '';
                                f.style.fontWeight = '';
                            });
                            
                            // 高亮当前文件夹
                            folderEl.style.backgroundColor = '#333';
                            folderEl.style.fontWeight = 'bold';
                            
                            // 查找并显示文件夹内容
                            const findFolderContent = (treeLevel, pathParts, currentIndex = 0) => {
                                if (currentIndex >= pathParts.length) {
                                    return treeLevel;
                                }
                                const name = pathParts[currentIndex];
                                if (treeLevel.folders && treeLevel.folders[name]) {
                                    return findFolderContent(treeLevel.folders[name], pathParts, currentIndex + 1);
                                }
                                return null;
                            };
                            
                            const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];
                            pathParts.push(folderName);
                            const folderContent = findFolderContent(this.loraTree, pathParts);
                            
                            // 显示文件夹内容
                            if (folderContent) {
                                showFolderContent(folderContent);
                            }
                            
                            // 展开/收起子文件夹
                            const contentEl = folderEl.nextElementSibling;
                            if (contentEl && contentEl.className.includes('zml-lora-folder-content')) {
                                const isHidden = contentEl.style.display === "none" || contentEl.style.display === "";
                                contentEl.style.display = isHidden ? "block" : "none";
                                folderEl.querySelector('.zml-lora-folder-arrow').textContent = isHidden ? "▼" : "▶";
                            }
                        };
                        
                        parent.appendChild(folderEl);
                        
                        // 创建子文件夹内容容器
                        const contentEl = zmlCreateEl("div", { 
                            className: "zml-lora-folder-content", 
                            style: "display: none; margin-left: 15px;"
                        });
                        parent.appendChild(contentEl);
                        
                        // 递归构建子文件夹树
                        buildFolderTree(contentEl, treeLevel.folders[folderName], currentPath + folderName + '/');
                    });
                };
                
                // 显示文件夹内容
                const showFolderContent = (folderContent) => {
                    // 清空文件列表
                    fileListContainer.innerHTML = '';
                    
                    // 添加None选项
                    const noneEl = zmlCreateEl("div", { 
                        className: "zml-lora-file", 
                        textContent: "None",
                        style: "padding: 5px; margin-bottom: 1px; border-radius: 3px; cursor: pointer; border: 1px solid transparent; font-size: 13.5px;"
                    });
                    noneEl.onclick = () => { 
                        entry.lora_name = "None"; 
                        onSelect(); 
                        hideImage?.(); 
                        closeMenu(); 
                    };
                    noneEl.onmouseenter = () => { noneEl.style.backgroundColor = '#2a2a2a'; noneEl.style.borderColor = '#555'; };
                    noneEl.onmouseleave = () => { noneEl.style.backgroundColor = ''; noneEl.style.borderColor = 'transparent'; };
                    fileListContainer.appendChild(noneEl);
                    
                    // 添加分隔线
                    const separator = zmlCreateEl("div", { style: "height: 1px; background-color: #444; margin: 3px 0;" });
                    fileListContainer.appendChild(separator);
                    
                    // 显示文件列表
                    if (folderContent.files && folderContent.files.length > 0) {
                        folderContent.files.sort((a,b) => a.name.localeCompare(b.name)).forEach(file => {
                            const fileEl = zmlCreateEl("div", { 
                                className: "zml-lora-file", 
                                textContent: file.name,
                                style: "padding: 5px; margin-bottom: 1px; border-radius: 3px; cursor: pointer; border: 1px solid transparent; font-size: 13.5px;"
                            });
                            
                            fileEl.onclick = () => { 
                                entry.lora_name = file.fullpath; 
                                onSelect(); 
                                hideImage?.(); 
                                closeMenu(); 
                            };
                            
                            fileEl.onmouseenter = () => { fileEl.style.backgroundColor = '#2a2a2a'; fileEl.style.borderColor = '#555'; };
                            fileEl.onmouseleave = () => { fileEl.style.backgroundColor = ''; fileEl.style.borderColor = 'transparent'; };
                            
                            if (loraImages[file.fullpath] && imageHost && showImage && hideImage) {
                                fileEl.addEventListener("mouseover", () => {
                                    const imagePath = loraImages[file.fullpath];
                                    const fullViewPath = `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(imagePath)}?${+new Date()}`;
                                    imageHost.src = fullViewPath;
                                    showImage.call(ext, fileEl);
                                });
                                fileEl.addEventListener("mouseout", hideImage.bind(ext));
                            }
                            
                            fileListContainer.appendChild(fileEl);
                        });
                    } else {
                        // 空文件夹提示
                        const emptyText = zmlCreateEl("div", { 
                            textContent: "此文件夹为空",
                            style: "padding: 10px; color: #888; text-align: center; font-style: italic;"
                        });
                        fileListContainer.appendChild(emptyText);
                    }
                };
                
                // 显示根目录内容
                const showRootContent = () => {
                    // 更新所有文件夹的样式
                    const allFolders = folderTreeContainer.querySelectorAll('.zml-lora-folder, .zml-lora-root-button, .zml-lora-all-button');
                    allFolders.forEach(f => {
                        f.style.backgroundColor = '';
                        f.style.fontWeight = '';
                    });
                    
                    // 显示根目录内容
                    showFolderContent(this.loraTree);
                };
                
                // 显示所有文件
                const showAllFiles = () => {
                    // 更新所有文件夹的样式
                    const allFolders = folderTreeContainer.querySelectorAll('.zml-lora-folder, .zml-lora-root-button, .zml-lora-all-button');
                    allFolders.forEach(f => {
                        f.style.backgroundColor = '';
                        f.style.fontWeight = '';
                    });
                    
                    // 高亮全部按钮
                    allButton.style.backgroundColor = '#333';
                    allButton.style.fontWeight = 'bold';
                    
                    // 收集所有文件
                    const collectAllFiles = (treeLevel) => {
                        let allFiles = [];
                        
                        // 收集当前级别文件
                        if (treeLevel.files) {
                            allFiles = [...allFiles, ...treeLevel.files];
                        }
                        
                        // 递归收集子文件夹中的文件
                        if (treeLevel.folders) {
                            Object.values(treeLevel.folders).forEach(folder => {
                                allFiles = [...allFiles, ...collectAllFiles(folder)];
                            });
                        }
                        
                        return allFiles;
                    };
                    
                    const allFiles = collectAllFiles(this.loraTree);
                    
                    // 清空文件列表
                    fileListContainer.innerHTML = '';
                    
                    // 添加None选项
                    const noneEl = zmlCreateEl("div", { 
                        className: "zml-lora-file", 
                        textContent: "None",
                        style: "padding: 5px; margin-bottom: 3px; border-radius: 3px; cursor: pointer; border: 1px solid transparent;"
                    });
                    noneEl.onclick = () => { 
                        entry.lora_name = "None"; 
                        onSelect(); 
                        hideImage?.(); 
                        closeMenu(); 
                    };
                    noneEl.onmouseenter = () => { noneEl.style.backgroundColor = '#2a2a2a'; noneEl.style.borderColor = '#555'; };
                    noneEl.onmouseleave = () => { noneEl.style.backgroundColor = ''; noneEl.style.borderColor = 'transparent'; };
                    fileListContainer.appendChild(noneEl);
                    
                    // 添加分隔线
                    const separator = zmlCreateEl("div", { style: "height: 1px; background-color: #444; margin: 5px 0;" });
                    fileListContainer.appendChild(separator);
                    
                    // 显示所有文件列表
                    if (allFiles.length > 0) {
                        allFiles.sort((a,b) => a.name.localeCompare(b.name)).forEach(file => {
                            const fileEl = zmlCreateEl("div", { 
                                className: "zml-lora-file", 
                                textContent: file.name,
                                style: "padding: 5px; margin-bottom: 3px; border-radius: 3px; cursor: pointer; border: 1px solid transparent;"
                            });
                            
                            fileEl.onclick = () => { 
                                entry.lora_name = file.fullpath; 
                                onSelect(); 
                                hideImage?.(); 
                                closeMenu(); 
                            };
                            
                            fileEl.onmouseenter = () => { fileEl.style.backgroundColor = '#2a2a2a'; fileEl.style.borderColor = '#555'; };
                            fileEl.onmouseleave = () => { fileEl.style.backgroundColor = ''; fileEl.style.borderColor = 'transparent'; };
                            
                            if (loraImages[file.fullpath] && imageHost && showImage && hideImage) {
                                fileEl.addEventListener("mouseover", () => {
                                    const imagePath = loraImages[file.fullpath];
                                    const fullViewPath = `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(imagePath)}?${+new Date()}`;
                                    imageHost.src = fullViewPath;
                                    showImage.call(ext, fileEl);
                                });
                                fileEl.addEventListener("mouseout", hideImage.bind(ext));
                            }
                            
                            fileListContainer.appendChild(fileEl);
                        });
                    } else {
                        // 没有文件提示
                        const emptyText = zmlCreateEl("div", { 
                            textContent: "没有找到任何文件",
                            style: "padding: 10px; color: #888; text-align: center; font-style: italic;"
                        });
                        fileListContainer.appendChild(emptyText);
                    }
                };
                
                // 添加全部按钮
                const allButton = zmlCreateEl("div", { 
                    className: "zml-lora-all-button", 
                    textContent: "📁 全部",
                    style: "padding: 5px; margin-bottom: 8px; border-radius: 3px; cursor: pointer;"
                });
                allButton.onclick = () => {
                    showAllFiles();
                    allButton.style.backgroundColor = '#333';
                    allButton.style.fontWeight = 'bold';
                    rootButton.style.backgroundColor = '';
                    rootButton.style.fontWeight = '';
                };
                allButton.onmouseenter = () => { if (allButton.style.backgroundColor !== '#333') allButton.style.backgroundColor = '#2a2a2a'; };
                allButton.onmouseleave = () => { if (allButton.style.backgroundColor !== '#333') allButton.style.backgroundColor = ''; };
                folderTreeContainer.appendChild(allButton);
                
                // 添加根目录按钮
                const rootButton = zmlCreateEl("div", { 
                    className: "zml-lora-root-button", 
                    textContent: "📁 根目录",
                    style: "padding: 5px; margin-bottom: 8px; border-radius: 3px; cursor: pointer; font-weight: bold;"
                });
                rootButton.onclick = () => {
                    showRootContent();
                    rootButton.style.backgroundColor = '#333';
                    if (allButton) allButton.style.backgroundColor = '';
                };
                rootButton.onmouseenter = () => { if (rootButton.style.backgroundColor !== '#333') rootButton.style.backgroundColor = '#2a2a2a'; };
                rootButton.onmouseleave = () => { if (rootButton.style.backgroundColor !== '#333') rootButton.style.backgroundColor = ''; };
                folderTreeContainer.appendChild(rootButton);
                
                // 构建文件夹树
                buildFolderTree(folderTreeContainer, this.loraTree);
                
                // 默认显示根目录内容
                showRootContent();
                rootButton.style.backgroundColor = '#333';

                // 搜索功能实现
                searchInput.addEventListener("input", () => {
                    const searchTerm = searchInput.value.toLowerCase().trim();
                    
                    if (searchTerm === "") {
                        // 搜索框为空，显示原始内容
                        contentContainer.style.display = "flex";
                        searchResults.style.display = "none";
                        return;
                    }

                    // 清空搜索结果
                    searchResults.innerHTML = "";

                    // 搜索所有文件和文件夹
                    const allItems = [];
                    const collectItems = (treeLevel, currentPath = '') => {
                        // 收集文件
                        treeLevel.files.forEach(file => {
                            allItems.push({
                                type: 'file',
                                name: file.name,
                                fullpath: file.fullpath,
                                path: currentPath
                            });
                        });
                        
                        // 收集文件夹
                        for (const folderName in treeLevel.folders) {
                            allItems.push({
                                type: 'folder',
                                name: folderName,
                                fullpath: currentPath + folderName,
                                path: currentPath
                            });
                            // 递归收集子文件夹和文件
                            collectItems(treeLevel.folders[folderName], currentPath + folderName + '/');
                        }
                    };
                    collectItems(this.loraTree);

                    // 过滤匹配的项目
                    const matchedItems = allItems.filter(item => 
                        item.name.toLowerCase().includes(searchTerm)
                    );

                    // 显示搜索结果
                    if (matchedItems.length > 0) {
                        // 按类型排序：文件夹优先，然后按名称排序
                        matchedItems.sort((a, b) => {
                            if (a.type !== b.type) {
                                return a.type === 'folder' ? -1 : 1;
                            }
                            return a.name.localeCompare(b.name);
                        }).forEach(item => {
                            if (item.type === 'file') {
                                const fileEl = zmlCreateEl("div", { 
                                    className: "zml-lora-file", 
                                    textContent: item.name,
                                    style: "padding: 5px; margin-bottom: 3px; border-radius: 3px; cursor: pointer; border: 1px solid transparent;"
                                });
                                fileEl.onclick = () => { 
                                    entry.lora_name = item.fullpath; 
                                    onSelect(); 
                                    hideImage?.(); 
                                    closeMenu(); 
                                };
                                
                                fileEl.onmouseenter = () => { fileEl.style.backgroundColor = '#2a2a2a'; fileEl.style.borderColor = '#555'; };
                                fileEl.onmouseleave = () => { fileEl.style.backgroundColor = ''; fileEl.style.borderColor = 'transparent'; };

                                if (loraImages[item.fullpath] && imageHost && showImage && hideImage) {
                                    fileEl.addEventListener("mouseover", () => {
                                        const imagePath = loraImages[item.fullpath];
                                        const fullViewPath = `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(imagePath)}?${+new Date()}`;
                                        imageHost.src = fullViewPath;
                                        showImage.call(ext, fileEl);
                                    });
                                    fileEl.addEventListener("mouseout", hideImage.bind(ext));
                                }

                                searchResults.appendChild(fileEl);
                            } else {
                                // 显示文件夹
                                const folderEl = zmlCreateEl("div", { 
                                    className: "zml-lora-folder", 
                                    innerHTML: `<span class="zml-lora-folder-arrow">▶</span> 📁 ${item.name}`,
                                    style: "padding: 5px; margin-bottom: 3px; border-radius: 3px; cursor: pointer; font-weight: bold; color: #8ab4f8;"
                                });
                                
                                // 创建文件夹内容容器
                                const contentEl = zmlCreateEl("div", { 
                                    className: "zml-lora-folder-content", 
                                    style: "display: none; margin-left: 20px;"
                                });
                                
                                // 实现文件夹展开/收起功能
                                folderEl.onclick = (e) => {
                                    e.stopPropagation();
                                    const isHidden = contentEl.style.display === "none" || contentEl.style.display === "";
                                    contentEl.style.display = isHidden ? "block" : "none";
                                    folderEl.querySelector('.zml-lora-folder-arrow').textContent = isHidden ? "▼" : "▶";
                                    
                                    // 如果是第一次展开，加载文件夹内容
                                    if (isHidden && contentEl.innerHTML === "") {
                                        // 查找该文件夹的实际内容
                                        const findFolderContent = (treeLevel, pathParts, currentIndex = 0) => {
                                            if (currentIndex >= pathParts.length) {
                                                return treeLevel;
                                            }
                                            const folderName = pathParts[currentIndex];
                                            if (treeLevel.folders && treeLevel.folders[folderName]) {
                                                return findFolderContent(treeLevel.folders[folderName], pathParts, currentIndex + 1);
                                            }
                                            return null;
                                        };
                                        
                                        const pathParts = item.path ? item.path.split('/').filter(Boolean) : [];
                                        pathParts.push(item.name); // 添加当前文件夹名称
                                        const folderContent = findFolderContent(this.loraTree, pathParts);
                                        
                                        // 如果找到文件夹内容，渲染它
                                        if (folderContent) {
                                            // 渲染子文件
                                            if (folderContent.files && folderContent.files.length > 0) {
                                                folderContent.files.forEach(file => {
                                                    const fileEl = zmlCreateEl("div", { 
                                                        className: "zml-lora-file", 
                                                        textContent: file.name,
                                                        style: "padding: 5px; margin-bottom: 3px; border-radius: 3px; cursor: pointer; border: 1px solid transparent;"
                                                    });
                                                    fileEl.onclick = () => { 
                                                        entry.lora_name = file.fullpath; 
                                                        onSelect(); 
                                                        hideImage?.(); 
                                                        closeMenu(); 
                                                    };
                                                    
                                                    fileEl.onmouseenter = () => { fileEl.style.backgroundColor = '#2a2a2a'; fileEl.style.borderColor = '#555'; };
                                                    fileEl.onmouseleave = () => { fileEl.style.backgroundColor = ''; fileEl.style.borderColor = 'transparent'; };
                                                    
                                                    if (loraImages[file.fullpath] && imageHost && showImage && hideImage) {
                                                        fileEl.addEventListener("mouseover", () => {
                                                            const imagePath = loraImages[file.fullpath];
                                                            const fullViewPath = `${ZML_API_PREFIX}/view/loras/${encodeRFC3986URIComponent(imagePath)}?${+new Date()}`;
                                                            imageHost.src = fullViewPath;
                                                            showImage.call(ext, fileEl);
                                                        });
                                                        fileEl.addEventListener("mouseout", hideImage.bind(ext));
                                                    }
                                                    
                                                    contentEl.appendChild(fileEl);
                                                });
                                            }
                                            
                                            // 渲染子文件夹
                                            if (folderContent.folders && Object.keys(folderContent.folders).length > 0) {
                                                Object.keys(folderContent.folders).sort().forEach(subFolderName => {
                                                    const subFolderEl = zmlCreateEl("div", { 
                                                        className: "zml-lora-folder", 
                                                        innerHTML: `<span class="zml-lora-folder-arrow">▶</span> 📁 ${subFolderName}`,
                                                        style: "padding: 3px 5px; margin-bottom: 1px; border-radius: 3px; cursor: pointer; font-weight: bold; color: #8ab4f8;"
                                                    });
                                                    
                                                    // 递归应用同样的逻辑到子文件夹
                                                    const subContentEl = zmlCreateEl("div", { 
                                                        className: "zml-lora-folder-content", 
                                                        style: "display: none; margin-left: 15px;"
                                                    });
                                                    
                                                    subFolderEl.onclick = (e) => {
                                                        e.stopPropagation();
                                                        const isSubHidden = subContentEl.style.display === "none" || subContentEl.style.display === "";
                                                        subContentEl.style.display = isSubHidden ? "block" : "none";
                                                        subFolderEl.querySelector('.zml-lora-folder-arrow').textContent = isSubHidden ? "▼" : "▶";
                                                    };
                                                    
                                                    contentEl.appendChild(subFolderEl);
                                                    contentEl.appendChild(subContentEl);
                                                });
                                            }
                                        }
                                    }
                                };
                                
                                searchResults.appendChild(folderEl);
                                searchResults.appendChild(contentEl);
                            }
                        });
                    } else {
                        const noResults = zmlCreateEl("div", { 
                            className: "zml-lora-no-results", 
                            textContent: "未找到匹配的模型或文件夹"
                        });
                        noResults.style.padding = "20px";
                        noResults.style.color = "#888";
                        noResults.style.textAlign = "center";
                        searchResults.appendChild(noResults);
                    }

                    // 切换显示
                    contentContainer.style.display = "none";
                    searchResults.style.display = "block";
                });

                const rect = button.getBoundingClientRect();
                menu.style.left = `${rect.left}px`; 
                menu.style.top = `${rect.bottom}px`;
                
                // 确保菜单不会超出视口
                const menuRect = menu.getBoundingClientRect();
                if (menuRect.right > window.innerWidth) {
                    menu.style.left = `${Math.max(0, window.innerWidth - menuRect.width)}px`;
                }
                if (menuRect.bottom > window.innerHeight) {
                    menu.style.top = `${Math.max(0, window.innerHeight - menuRect.height)}px`;
                }
                
                document.body.appendChild(menu);
                const clickOutside = (e) => { 
                    if (!menu.contains(e.target) && e.target !== button) { 
                        hideImage?.(); 
                        closeMenu(); 
                    } 
                };
                setTimeout(() => document.addEventListener("click", clickOutside, true), 0);

                // 自动聚焦搜索框
                setTimeout(() => searchInput.focus(), 10);

                return { close: closeMenu };
            };

            const origOnSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(obj) {
                origOnSerialize?.apply(this, arguments);
                obj.powerLoraLoader_data = this.powerLoraLoader_data;
                obj.isLocked = this.isLocked;
                obj.viewMode = this.viewMode; // 保存当前布局模式
                obj.loraNameWidth = this.loraNameWidth;
                obj.customTextWidth = this.customTextWidth;
                obj.folderColor = this.folderColor; // Save folder color
                obj.loraEntryColor = this.loraEntryColor; // Save LoRA entry color
                obj.enabledStateColor = this.enabledStateColor; // Save enabled state color
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
                // 使用viewMode替代compactView，提供向后兼容性
                if (obj.viewMode !== undefined) {
                    // 如果是旧的'expanded'值，转换为'simple'
                    this.viewMode = obj.viewMode === 'expanded' ? 'simple' : obj.viewMode;
                } else if (obj.compactView !== undefined) {
                    // 向后兼容：如果没有viewMode但有compactView，根据compactView设置默认viewMode
                    this.viewMode = obj.compactView ? 'compact' : 'normal';
                }

                this.loraNameWidth = Math.max(10, Math.min(300, obj.loraNameWidth ?? 65));
                this.customTextWidth = Math.max(10, Math.min(300, obj.customTextWidth ?? 80));
                this.folderColor = obj.folderColor ?? "#30353c"; // Load folder color, or use default
                this.loraEntryColor = obj.loraEntryColor ?? "#3a3a3a"; // Load LoRA entry color, or use default
                this.enabledStateColor = obj.enabledStateColor ?? "#4CAF50"; // Load enabled state color, or use default

            };
        }
	},
});
