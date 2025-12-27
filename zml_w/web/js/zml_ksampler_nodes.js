import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const LAST_SEED_BUTTON_LABEL = '🎲 随机 / ♻️ 上次';

const NODE_WIDGET_MAP = {
    "ZML_KSampler": "种子",
    "ZML_KSampler_Advanced": "随机种子"
};

const SPECIFIC_WIDTH = 325;

function setNodeWidthForMappedTitles(node) {
     if (NODE_WIDGET_MAP[node.comfyClass]) {
        node.setSize([SPECIFIC_WIDTH, node.size[1]]);
    }
}

class SeedControl {
    constructor(node, seedName) {
        this.lastSeed = -1;
        this.serializedCtx = {};
        this.node = node;

        let seedIndex;
        for (const [i, w] of this.node.widgets.entries()) {
            if (w.name === seedName) {
                this.seedWidget = w;
                seedIndex = i;
            }
        }

        if (!this.seedWidget) {
            throw new Error('Something\'s wrong; expected seed widget');
        }

        this.lastSeedButton = this.node.addWidget("button", LAST_SEED_BUTTON_LABEL, null, () => {
            if (this.seedWidget.value === -1 && this.lastSeed !== -1) {
                this.seedWidget.value = this.lastSeed;
                this.lastSeedButton.name = `🎲 随机 / ♻️ ${this.lastSeed}`;
            } else {
                this.lastSeed = this.seedWidget.value;
                this.seedWidget.value = -1;
                this.lastSeedButton.name = `🎲 随机 / ♻️ ${this.lastSeed === -1 ? "上次" : this.lastSeed}`;
            }
        }, { width: 50, serialize: false });

        // Insert button right after seed widget
        this.node.widgets.splice(seedIndex + 1, 0, this.lastSeedButton);
        this.node.widgets.pop(); // Remove the button from the end

        setNodeWidthForMappedTitles(node);

        this.seedWidget.serializeValue = async (node, index) => {
            const currentSeed = this.seedWidget.value;
            this.serializedCtx = {
                wasSpecial: currentSeed == -1,
            };

            if (this.serializedCtx.wasSpecial) {
                // Generate a proper 64-bit integer seed
                const max = 1125899906842624;
                const min = 0;
                this.serializedCtx.seedUsed = Math.floor(Math.random() * (max - min + 1)) + min;
            } else {
                this.serializedCtx.seedUsed = this.seedWidget.value;
            }

            if (node && node.widgets_values) {
                node.widgets_values[index] = this.serializedCtx.seedUsed;
            } else {
                // Update the last seed value and the button's label to show the current seed value
                this.lastSeed = this.serializedCtx.seedUsed;
                this.updateButtonLabel();
            }

            this.seedWidget.value = this.serializedCtx.seedUsed;

            if (this.serializedCtx.wasSpecial) {
                this.lastSeed = this.serializedCtx.seedUsed;
                this.updateButtonLabel();
            }

            return this.serializedCtx.seedUsed;
        };

        this.seedWidget.afterQueued = () => {
            if (this.serializedCtx.wasSpecial) {
                this.seedWidget.value = -1;
            }

            if (this.seedWidget.value !== -1) {
                this.lastSeed = this.seedWidget.value;
            }

            this.updateButtonLabel();
            this.serializedCtx = {};
        };
    }

    updateButtonLabel() {
        this.lastSeedButton.name = `🎲 随机 / ♻️ ${this.lastSeed === -1 ? "上次" : this.lastSeed}`;
    }
}

let previewImagesDict = {};
let animateIntervals = {};
let latentPreviewNodes = new Set();

function getLatentPreviewCtx(id, width, height) {
    const nodeId = parseInt(id.split(':').pop());
    const node = app.graph.getNodeById(nodeId);
    if (!node) return undefined;

    let previewWidget = node.widgets?.find(w => w.name === "zml_latentpreview");
    if (!previewWidget) {
        const nativeIndex = node.widgets?.findIndex(w => w.name === '$$canvas-image-preview');
        if (nativeIndex >= 0) {
            node.imgs = [];
            node.widgets.splice(nativeIndex, 1);
        }

        const canvasEl = document.createElement("canvas");
        canvasEl.style.width = "100%";
        canvasEl.style.imageRendering = "pixelated";

        previewWidget = node.addDOMWidget("zml_latentpreview", "zmlcanvas", canvasEl, {
            serialize: false,
            hideOnZoom: false,
        });
        previewWidget.serialize = false;

        const events = ['contextmenu', 'pointerdown', 'mousewheel', 'pointermove', 'pointerup'];
        events.forEach(ev => {
            canvasEl.addEventListener(ev, e => {
                e.preventDefault();
                const cb = ev === 'mousewheel' ? '_mousewheel_callback' : `_${ev}_callback`;
                if (app.canvas[cb]) app.canvas[cb](e);
            }, true);
        });

        previewWidget.computeSize = function(width) {
            if (this.aspectRatio && this.aspectRatio > 0) {
                const height = (node.size[0] - 20) / this.aspectRatio + 10;
                this.computedHeight = height > 0 ? height + 10 : 0;
                return [width, height];
            }
            return [width, -4];
        };
    }

    const canvasEl = previewWidget.element;
    if (!previewWidget.ctx || canvasEl.width !== width || canvasEl.height !== height) {
        previewWidget.aspectRatio = width / height;
        canvasEl.width = width;
        canvasEl.height = height;
    }

    return canvasEl.getContext("2d");
}

function cleanupNodePreview(nodeId) {
    const node = app.graph.getNodeById(nodeId);
    if (!node) return;

    // 移除预览widget
    const previewIndex = node.widgets?.findIndex(w => w.name === "zml_latentpreview");
    if (previewIndex >= 0) {
        const widget = node.widgets[previewIndex];
        
        // 使用onRemove()方法移除DOM元素
        widget?.onRemove?.();
        
        // 从widgets数组中移除
        node.widgets.splice(previewIndex, 1);
        
        // 触发重绘
        if (app.canvas) {
            app.canvas.setDirty(true);
        }
    }

    // 清理相关数据
    const fullId = nodeId.toString();
    if (animateIntervals[fullId]) {
        clearInterval(animateIntervals[fullId]);
        delete animateIntervals[fullId];
    }
    delete previewImagesDict[fullId];
    latentPreviewNodes.delete(fullId);
}

function beginLatentPreview(id, previewImages, rate) {
    latentPreviewNodes.add(id);
    if (animateIntervals[id]) clearInterval(animateIntervals[id]);

    let displayIndex = 0;
    const nodeId = parseInt(id.split(':').pop());
    const node = app.graph.getNodeById(nodeId);
    if (node) node.progress = 0;

    animateIntervals[id] = setInterval(() => {
        const currentNode = app.graph.getNodeById(nodeId);
        if (!currentNode || app.canvas.graph.rootGraph !== currentNode?.graph?.rootGraph) {
            clearInterval(animateIntervals[id]);
            delete animateIntervals[id];
            latentPreviewNodes.delete(id);
            return;
        }

        const img = previewImages[displayIndex];
        if (img) {
            getLatentPreviewCtx(id, img.width, img.height)?.drawImage(img, 0, 0);
        }
        displayIndex = (displayIndex + 1) % previewImages.length;
    }, 1000 / rate);
}

api.addEventListener('VHS_latentpreview', ({ detail }) => {
    if (detail.id == null) return;
    const previewImages = previewImagesDict[detail.id] = new Array(detail.length);

    const idParts = detail.id.split(':');
    for (let i = 1; i <= idParts.length; i++) {
        const layeredId = idParts.slice(0, i).join(':');
        beginLatentPreview(layeredId, previewImages, detail.rate);
    }
});

// 监听清理事件
api.addEventListener('VHS_cleanup_preview', ({ detail }) => {
    if (detail.id == null) return;
    const nodeId = parseInt(detail.id);
    cleanupNodePreview(nodeId);
});

const td = new TextDecoder();
api.addEventListener('b_preview', async (e) => {
    if (Object.keys(animateIntervals).length === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    const arrayBuffer = await e.detail.slice(0, 24).arrayBuffer();
    const dv = new DataView(arrayBuffer);
    const index = dv.getUint32(4);
    const idlen = dv.getUint8(8);
    const id = td.decode(dv.buffer.slice(9, 9 + idlen));

    if (!previewImagesDict[id]) return;

    const bitmap = await createImageBitmap(e.detail.slice(24));
    previewImagesDict[id][index] = bitmap;

    return false;
}, true);

api.addEventListener('executing', ({ detail }) => {
    if (detail === null) {
        Object.keys(animateIntervals).forEach(id => clearInterval(animateIntervals[id]));
        animateIntervals = {};
        previewImagesDict = {};
        latentPreviewNodes.clear();
    }
});

app.registerExtension({
    name: "ZML.SeedControl",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        const seedName = NODE_WIDGET_MAP[nodeData.name];
        if (seedName) {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                try {
                    this.seedControl = new SeedControl(this, seedName);
                } catch (e) {
                }
                return r;
            };
        }
    },
});

app.registerExtension({
    name: "ZML.DynamicPreview",
    nodeCreated(node) {
        // 检查是否是 ZML 的采样器节点
        if (node.comfyClass === "ZML_KSampler" || node.comfyClass === "ZML_KSampler_Advanced") {
            const videoPreviewWidget = node.widgets?.find(w => w.name === "视频预览");
            // 获取初始状态下的帧率组件
            const frameRateWidget = node.widgets?.find(w => w.name === "视频预览帧率");
            
            // 备份帧率组件引用，防止从 widgets 数组移除后丢失
            if (frameRateWidget && !node._zml_framerate_widget) {
                node._zml_framerate_widget = frameRateWidget;
            }

            // 定义更新可见性的函数
            const updateVisibility = (value) => {
                const targetWidget = node._zml_framerate_widget;
                if (!targetWidget) return; // 如果找不到备份的组件，则跳过

                const isEnabled = value === "enable";
                const currentIdx = node.widgets.indexOf(targetWidget);
                const previewIdx = node.widgets.findIndex(w => w.name === "视频预览");

                if (isEnabled) {
                    // 如果选择启用，且组件当前不在数组中，则把它加回来
                    if (currentIdx === -1 && previewIdx !== -1) {
                        // 插入到"视频预览"组件的下一个位置
                        node.widgets.splice(previewIdx + 1, 0, targetWidget);
                    }
                } else {
                    // 如果选择禁用
                    
                    // 1. 如果组件在数组中，把它移除（隐藏）
                    if (currentIdx !== -1) {
                        node.widgets.splice(currentIdx, 1);
                    }
                    
                    // 2. 同时执行预览画布的清理逻辑
                    cleanupNodePreview(node.id);
                }
            };

            if (videoPreviewWidget) {
                // 保存原始回调
                const origCallback = videoPreviewWidget.callback;
                
                // 重写回调函数
                videoPreviewWidget.callback = function(value) {
                    updateVisibility(value);
                    return origCallback ? origCallback.apply(this, arguments) : undefined;
                };

                // 在节点初始化稍后执行一次，以同步当前状态（处理加载工作流时的初始状态）
                setTimeout(() => {
                    updateVisibility(videoPreviewWidget.value);
                }, 100);
            }
        }
    }
});