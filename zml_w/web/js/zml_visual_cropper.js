import { app } from "../../../scripts/app.js";

// ======================= 全局变量和缓存 =======================
// 存储图像尺寸缓存，key为图像URL，value为缓存的尺寸信息
const zml_painter_size_cache = {};

// ======================= 通用函数 =======================
function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
}

function createModal(htmlContent) {
    const modal = document.createElement('div');
    modal.id = 'zml-editor-modal';
    modal.innerHTML = htmlContent;
    document.body.appendChild(modal);
    return modal;
}

function closeModal(modal, stylesheet) {
    if (modal) modal.remove();
    if (stylesheet) stylesheet.remove();
}

// ======================= ZML_VisualCropImage 节点 =======================
app.registerExtension({
    name: "ZML.VisualCropImage",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_VisualCropImage") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                const node = this;
                const allWidgets = {
                    mode: this.widgets.find(w => w.name === "模式"),
                    data: this.widgets.find(w => w.name === "crop_data"),
                    ratio: this.widgets.find(w => w.name === "裁剪比例"),
                    width: this.widgets.find(w => w.name === "裁剪宽度"),
                    height: this.widgets.find(w => w.name === "裁剪高度"),
                };
                this.addWidget("button", "裁剪图像", null, () => showVisualEditorModal(node, allWidgets));
            };
        }
    },
});

function showVisualEditorModal(node, widgets) {
    const upstreamNode = node.getInputNode(0);
    if (!upstreamNode || !upstreamNode.imgs || upstreamNode.imgs.length === 0) {
        alert("请先连接一个有预览图的图像节点！");
        return;
    }

    const imageUrl = upstreamNode.imgs[0].src;
    const cropMode = widgets.mode.value;

    const modalHtml = `
        <div class="zml-modal">
            <div class="zml-modal-content">
                <style>
                    .zml-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1001; }
                    .zml-modal-content { background: #222; padding: 20px; border-radius: 8px; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; gap: 10px; }
                    .zml-editor-main { flex-grow: 1; overflow: hidden; display: flex; justify-content: center; align-items: center; }
                    .zml-editor-tip { color: #ccc; text-align: center; font-size: 12px; margin: 5px 0; }
                    .zml-editor-controls { display: flex; justify-content: space-around; align-items: center; flex-wrap: wrap; gap: 10px;}
                    .zml-editor-btn { padding: 8px 12px; color: white; border: none; border-radius: 4px; cursor: pointer; }
                </style>
                <div class="zml-editor-main" id="zml-editor-main-container"></div>
                <p id="zml-editor-tip" class="zml-editor-tip"></p>
                <div id="zml-editor-controls" class="zml-editor-controls"></div>
            </div>
        </div>
    `;

    const modal = createModal(modalHtml);
    const mainContainer = modal.querySelector('#zml-editor-main-container');
    const controlsContainer = modal.querySelector('#zml-editor-controls');

    if (cropMode === '矩形' || cropMode === '圆形') {
        setupCropper(mainContainer, controlsContainer, widgets, imageUrl, node, modal);
    } else if (cropMode === '路径选择' || cropMode === '画笔') {
        setupFabric(mainContainer, controlsContainer, widgets, imageUrl, node, modal);
    }
}

// 获取当前扩展的基础路径
function get_extension_base_path() {
    const scriptUrl = import.meta.url;
    const parts = scriptUrl.split('/');
    const extensionsIndex = parts.indexOf('extensions');
    if (extensionsIndex !== -1 && parts.length > extensionsIndex + 1) {
        return '/' + parts.slice(extensionsIndex, extensionsIndex + 2).join('/') + '/';
    }
    console.error('ZML Visual Cropper: 无法自动推断扩展基础路径');
    // 尝试从全局变量获取，防止完全失败
    if (window.zmlExtensionBasePath) {
        return window.zmlExtensionBasePath;
    }
    return '/extensions/ComfyUI-ZML-Image/'; // 最后的回退
}

const extensionBasePath = get_extension_base_path();

function setupCropper(mainContainer, controlsContainer, widgets, imageUrl, node, modal) {
    const cropperUrl = extensionBasePath + 'lib/cropper.min.js';
    const cropperCss = document.createElement('link');
    cropperCss.rel = 'stylesheet';
    cropperCss.href = extensionBasePath + 'lib/cropper.min.css';
    document.head.appendChild(cropperCss);

    mainContainer.innerHTML = `<img id="zml-cropper-image" src="${imageUrl}" style="display: block; max-width: 100%; max-height: 75vh;">`;

    const cropMode = widgets.mode.value;
    controlsContainer.innerHTML = `
        ${cropMode === '圆形' ? `<button id="zml-toggle-aspect-btn" class="zml-editor-btn" style="background-color: #f0ad4e;">解锁宽高比</button>` : ''}
        <button id="zml-confirm-btn" class="zml-editor-btn" style="background-color: #4CAF50;">确认</button>
        <button id="zml-cancel-btn" class="zml-editor-btn" style="background-color: #f44336;">取消</button>
    `;

    loadScript(cropperUrl).then(() => {
        const image = mainContainer.querySelector('img');
        const tipElement = modal.querySelector('#zml-editor-tip');
        let cropper;

        image.onload = () => {
            const cropperOptions = { viewMode: 1, autoCropArea: 0.8, background: false, cropBoxResizable: true, dragMode: 'crop' };

            cropperOptions.ready = function () {
                cropper = this.cropper;

                if (cropMode === '圆形') {
                    const cropBox = this.cropper.cropper.querySelector('.cropper-crop-box');
                    const viewBox = this.cropper.cropper.querySelector('.cropper-view-box');
                    if (cropBox) cropBox.style.borderRadius = '50%';
                    if (viewBox) viewBox.style.borderRadius = '50%';
                    modal.querySelector('#zml-toggle-aspect-btn').onclick = () => {
                        const currentRatio = cropper.getOptions().aspectRatio;
                        const isLocked = !isNaN(currentRatio);
                        cropper.setAspectRatio(isLocked ? NaN : 1);
                        modal.querySelector('#zml-toggle-aspect-btn').textContent = isLocked ? '锁定宽高比' : '解锁宽高比';
                        tipElement.textContent = isLocked ? "椭圆模式：当前可自由拉伸。" : "圆形模式：当前为等比例缩放。";
                    };
                } else {
                    const { ratio, width, height } = widgets;
                    let isFixedSize = false;
                    if (ratio.value !== "禁用") {
                        const parts = ratio.value.split(':');
                        cropper.setAspectRatio(parseFloat(parts[0]) / parseFloat(parts[1]));
                    } else if (width.value > 0 && height.value > 0 && width.value <= image.naturalWidth && height.value <= image.naturalHeight) {
                        cropper.setAspectRatio(width.value / height.value);
                        cropper.setCropBoxResizable(false);
                        cropper.setDragMode('move');
                        isFixedSize = true;
                    }
                    if (isFixedSize) {
                        cropper.setData({ width: width.value, height: height.value });
                    }
                }

                modal.querySelector('#zml-confirm-btn').onclick = () => {
                    widgets.data.value = JSON.stringify(cropper.getData(true));
                    node.onWidgetValue_changed?.(widgets.data, widgets.data.value);
                    closeModal(modal, cropperCss);
                };
            };

            cropper = new Cropper(image, cropperOptions);
        };
        if(image.complete) image.onload();

        modal.querySelector('#zml-cancel-btn').onclick = () => closeModal(modal, cropperCss);
    });
}

function setupFabric(mainContainer, controlsContainer, widgets, imageUrl, node, modal) {
    const fabricUrl = extensionBasePath + 'lib/fabric.min.js';
    mainContainer.innerHTML = `<canvas id="zml-fabric-canvas"></canvas>`;

    const cropMode = widgets.mode.value;
    const isPathMode = cropMode === '路径选择';

    controlsContainer.innerHTML = `
        ${isPathMode ? `<button id="zml-undo-btn" class="zml-editor-btn" style="background-color: #f0ad4e;">撤回</button>` : ''}
        <button id="zml-reset-btn" class="zml-editor-btn" style="background-color: #5bc0de;">重置</button>
        <button id="zml-confirm-btn" class="zml-editor-btn" style="background-color: #4CAF50;">确认</button>
        <button id="zml-cancel-btn" class="zml-editor-btn" style="background-color: #f44336;">取消</button>
    `;

    const tipElement = modal.querySelector('#zml-editor-tip');
    tipElement.textContent = isPathMode ? "路径选择模式：单击左键添加锚点。" : "画笔模式：按住鼠标左键绘制选区。";

    loadScript(fabricUrl).then(() => {
        const canvas = new fabric.Canvas(mainContainer.querySelector('canvas'));
        let pathPoints = [], tempShape = null;

        const img = new Image();
        img.src = imageUrl;
        img.onload = () => {
            const maxWidth = window.innerWidth * 0.85, maxHeight = window.innerHeight * 0.75;
            const scale = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
            canvas.setWidth(img.naturalWidth * scale);
            canvas.setHeight(img.naturalHeight * scale);
            fabric.Image.fromURL(imageUrl, (fImg) => {
                canvas.setBackgroundImage(fImg, canvas.renderAll.bind(canvas), { scaleX: scale, scaleY: scale });
            });

            if (isPathMode) {
                canvas.on('mouse:down', (opt) => {
                    const pointer = canvas.getPointer(opt.e);
                    pathPoints.push({ x: pointer.x, y: pointer.y });
                    if (tempShape) canvas.remove(tempShape);
                    tempShape = new fabric.Polygon(pathPoints, { fill: 'rgba(255,0,0,0.3)', stroke: 'red', strokeWidth: 1, selectable: false, evented: false });
                    canvas.add(tempShape).renderAll();
                });
            } else { // 画笔模式
                canvas.isDrawingMode = true;
                canvas.freeDrawingBrush.color = 'rgba(255,0,0,0.75)';
                canvas.freeDrawingBrush.width = 2;
            }
        };

        if (isPathMode) {
            modal.querySelector('#zml-undo-btn').onclick = () => {
                if(pathPoints.length > 0) {
                    pathPoints.pop();
                    if(tempShape) canvas.remove(tempShape);
                    if(pathPoints.length > 0) {
                       tempShape = new fabric.Polygon(pathPoints, { fill: 'rgba(255,0,0,0.3)', stroke: 'red', strokeWidth: 1, selectable: false, evented: false });
                       canvas.add(tempShape);
                    } else { tempShape = null; }
                    canvas.renderAll();
                }
            };
        }

        modal.querySelector('#zml-reset-btn').onclick = () => {
            canvas.remove(...canvas.getObjects().filter(o => o !== canvas.backgroundImage));
            pathPoints = [], tempShape = null;
            if(cropMode === '画笔') canvas.isDrawingMode = true;
        };

        modal.querySelector('#zml-confirm-btn').onclick = () => {
            let finalPoints;
            if(isPathMode) {
                if (pathPoints.length < 3) { alert("请至少点击三个点构成一个面！"); return; }
                finalPoints = pathPoints;
            } else {
                const path = canvas.getObjects().find(o => o.type === 'path');
                if (!path) { alert("请先绘制选区！"); return; }
                finalPoints = path.path.map(p => ({ x: p[1], y: p[2] })).filter(p=>p.x !== undefined);
            }

            if(!finalPoints || finalPoints.length === 0) { alert("未能获取选区。"); return; }

            const scale = canvas.backgroundImage.scaleX;
            const originalPoints = finalPoints.map(p => ({ x: p.x / scale, y: p.y / scale }));
            const xs = originalPoints.map(p => p.x), ys = originalPoints.map(p => p.y);
            const bbox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };

            widgets.data.value = JSON.stringify({ points: originalPoints, bbox: bbox });
            node.onWidgetValue_changed?.(widgets.data, widgets.data.value);
            closeModal(modal);
        };
        modal.querySelector('#zml-cancel-btn').onclick = () => closeModal(modal);
    });
}
// ======================= ZML_MergeImages 节点 (使用旧版逻辑) =======================
app.registerExtension({
    name: "ZML.MergeImages",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_MergeImages") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                const node = this;
                const widget = {
                    data: this.widgets.find(w => w.name === "transform_data"),
                };
                this.addWidget("button", "打开合成器", null, () => showMergeModal(node, widget));
            };
        }
    },
});

function showMergeModal(node, widget) {
    const bgNode = node.getInputNode(0);
    const fgNode1 = node.getInputNode(1);
    const fgNode2 = node.getInputNode(2);
    const fgNode3 = node.getInputNode(3);

    if (!bgNode || !bgNode.imgs) { alert("请连接“底图”的图像输入！"); return; }
    if (!fgNode1 || !fgNode1.imgs) { alert("请至少连接“前景图_1”的图像输入！"); return; }

    const bgUrl = bgNode.imgs[0].src;
    const fgSources = [];
    if (fgNode1 && fgNode1.imgs) fgSources.push({ index: 0, name: 1, url: fgNode1.imgs[0].src, image: fgNode1.imgs[0] });
    if (fgNode2 && fgNode2.imgs) fgSources.push({ index: 1, name: 2, url: fgNode2.imgs[0].src, image: fgNode2.imgs[0] });
    if (fgNode3 && fgNode3.imgs) fgSources.push({ index: 2, name: 3, url: fgNode3.imgs[0].src, image: fgNode3.imgs[0] });

    // MODIFICATION START: Add opacity slider to the modal HTML
    const modalHtml = `
        <div class="zml-modal">
            <div class="zml-modal-content">
                 <style>
                    .zml-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1001; }
                    .zml-modal-content { background: #222; padding: 20px; border-radius: 8px; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; gap: 10px; }
                    .zml-editor-main { flex-grow: 1; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 10px; box-sizing: border-box; }
                    #zml-layer-controls { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
                    .zml-editor-tip { color: #ccc; text-align: center; font-size: 12px; margin: 5px 0; }
                    .zml-editor-controls { display: flex; justify-content: space-around; align-items: center; flex-wrap: wrap; gap: 10px;}
                    .zml-editor-btn { padding: 8px 12px; color: white; border: none; border-radius: 4px; cursor: pointer; }
                    .zml-layer-btn.active { background-color: #f0ad4e !important; }
                 </style>
                 <div class="zml-editor-main" id="zml-editor-main-container"></div>
                 <div id="zml-layer-controls"></div>
                 <p class="zml-editor-tip">自由移动、缩放、旋转前景图层。</p>
                 <div class="zml-editor-controls" id="zml-merge-controls">
                    <label for="zml-opacity-slider" style="color: white; display: flex; align-items: center; gap: 5px;">
                        不透明度: <input type="range" id="zml-opacity-slider" min="0" max="1" step="0.01" value="1" disabled>
                    </label>
                    <button id="zml-reset-btn" class="zml-editor-btn" style="background-color: #5bc0de;">重置当前层</button>
                    <button id="zml-confirm-btn" class="zml-editor-btn" style="background-color: #4CAF50;">确认</button>
                    <button id="zml-cancel-btn" class="zml-editor-btn" style="background-color: #f44336;">取消</button>
                 </div>
            </div>
        </div>`;
    // MODIFICATION END

    const modal = createModal(modalHtml);
    const mainContainer = modal.querySelector('#zml-editor-main-container');
    // MODIFICATION START: Get the opacity slider element
    const opacitySlider = modal.querySelector('#zml-opacity-slider');
    // MODIFICATION END

    loadScript(extensionBasePath + 'lib/fabric.min.js').then(() => {
        let uiCanvas, uiCanvasScale = 1.0;
        let fabricLayers = [];
        let allLayerParams = [];
        let layerButtons = [];

        // MODIFICATION START: Helper function to sync slider with active layer
        function syncUIWithActiveLayer() {
            const activeObj = uiCanvas.getActiveObject();
            if (activeObj) {
                opacitySlider.value = activeObj.opacity;
                opacitySlider.disabled = false;
            } else {
                opacitySlider.value = 1;
                opacitySlider.disabled = true;
            }
        }
        // MODIFICATION END

        const setupMergeCanvas = (bgImg, fgArray) => {
            mainContainer.innerHTML = `<canvas id="zml-merge-canvas-ui"></canvas>`;
            uiCanvas = new fabric.Canvas(mainContainer.querySelector('canvas'));
            const maxWidth = window.innerWidth * 0.85, maxHeight = window.innerHeight * 0.7;
            uiCanvasScale = Math.min(1, maxWidth / bgImg.naturalWidth, maxHeight / bgImg.naturalHeight);

            uiCanvas.setWidth(bgImg.naturalWidth * uiCanvasScale).setHeight(bgImg.naturalHeight * uiCanvasScale);

            fabric.Image.fromURL(bgImg.src, (fBg) => {
                uiCanvas.setBackgroundImage(fBg, uiCanvas.renderAll.bind(uiCanvas), { scaleX: uiCanvasScale, scaleY: uiCanvasScale });
            });

            let loadedParams = [];
            try { loadedParams = JSON.parse(widget.data.value); if (!Array.isArray(loadedParams)) { loadedParams = []; } } catch (e) { /* ignore */ }

            fgArray.forEach((fgData, index) => {
                 fabric.Image.fromURL(fgData.url, (fFg) => {
                    fFg.set({ id: index, borderColor: 'yellow', cornerColor: '#f0ad4e', cornerStrokeColor: 'black', cornerStyle: 'circle', transparentCorners: false, borderScaleFactor: 2 });

                    // MODIFICATION START: Load parameters including opacity, with defaults
                    let transformParams = loadedParams[index];
                    if (!transformParams || transformParams.left === undefined) {
                        const fgImg = fgData.image;
                        const initialScale = (bgImg.naturalWidth * (0.3 + index*0.1)) / fgImg.naturalWidth;
                        transformParams = { 
                            left: bgImg.naturalWidth / 2, 
                            top: bgImg.naturalHeight / 2, 
                            scaleX: initialScale, 
                            scaleY: initialScale, 
                            angle: 0, 
                            opacity: 1.0,  // Add default opacity
                            originX: 'center', 
                            originY: 'center' 
                        };
                    }
                    if (transformParams.opacity === undefined) {
                        transformParams.opacity = 1.0; // Ensure older data gets opacity
                    }
                    allLayerParams[index] = transformParams;
                    // MODIFICATION END
                    
                    const displayParams = { ...transformParams };
                    displayParams.left *= uiCanvasScale;
                    displayParams.top *= uiCanvasScale;
                    displayParams.scaleX *= uiCanvasScale;
                    displayParams.scaleY *= uiCanvasScale;
                    // Opacity is not scaled, so it's applied directly from transformParams
                    fFg.set(displayParams);

                    uiCanvas.add(fFg);
                    fabricLayers[index] = fFg;

                    if(index === 0) {
                        uiCanvas.setActiveObject(fFg);
                    }
                    uiCanvas.renderAll();
                 }, { crossOrigin: 'anonymous' }); // Added crossOrigin for safety
            });

            // MODIFICATION START: Update param storage on modification to include opacity
            uiCanvas.on('object:modified', (e) => {
                if(!e.target) return;
                const obj = e.target;
                const layerIndex = obj.id;
                allLayerParams[layerIndex] = {
                    left: obj.left / uiCanvasScale, 
                    top: obj.top / uiCanvasScale,
                    scaleX: obj.scaleX / uiCanvasScale, 
                    scaleY: obj.scaleY / uiCanvasScale,
                    angle: obj.angle, 
                    originX: 'center', 
                    originY: 'center',
                    opacity: obj.opacity, // Save the current opacity
                };
            });
            // MODIFICATION END
            
            // MODIFICATION START: Sync UI when selection changes
            uiCanvas.on('selection:created', syncUIWithActiveLayer);
            uiCanvas.on('selection:updated', syncUIWithActiveLayer);
            uiCanvas.on('selection:cleared', syncUIWithActiveLayer);
            // MODIFICATION END
             
            if (fgSources.length > 1) {
                const layerControls = modal.querySelector('#zml-layer-controls');
                fgSources.forEach((fg, index) => {
                    const btn = document.createElement('button');
                    btn.textContent = `前景 ${fg.name}`;
                    btn.className = 'zml-editor-btn zml-layer-btn';
                    btn.style.backgroundColor = '#337ab7';
                    btn.onclick = () => {
                        const targetLayer = fabricLayers[index];
                        if(targetLayer) {
                           uiCanvas.setActiveObject(targetLayer);
                           uiCanvas.bringToFront(targetLayer);
                           uiCanvas.renderAll();
                           layerButtons.forEach(b => b.classList.remove('active'));
                           btn.classList.add('active');
                           syncUIWithActiveLayer(); // Sync slider on button click
                        }
                    };
                    layerControls.appendChild(btn);
                    layerButtons.push(btn);
                });
                if(layerButtons.length > 0) layerButtons[0].classList.add('active');
            }
            
            // MODIFICATION START: Sync UI for the first time after a short delay
            // to ensure the first object is properly set as active.
            setTimeout(() => {
                syncUIWithActiveLayer();
            }, 100);
            // MODIFICATION END
        };

        const bgImg = new Image();
        bgImg.crossOrigin = "anonymous"; // Handle potential CORS issues
        bgImg.src = bgUrl;
        bgImg.onload = () => {
            const fgImageObjects = fgSources.map(s => { const img = new Image(); img.crossOrigin="anonymous"; img.src = s.url; return { ...s, image: img }; });
            let loadedCount = 0; const totalToLoad = fgImageObjects.length;
            if (totalToLoad === 0) { setupMergeCanvas(bgImg, []); return; }
            fgImageObjects.forEach(fg => {
                fg.image.onload = () => { loadedCount++; if(loadedCount === totalToLoad) { setupMergeCanvas(bgImg, fgImageObjects); } }
                if(fg.image.complete) fg.image.onload();
                fg.image.onerror = () => { loadedCount++; if(loadedCount === totalToLoad) { setupMergeCanvas(bgImg, fgImageObjects); } alert(`Failed to load foreground image ${fg.name}.`) }
            });
        };
        bgImg.onerror = () => alert("Failed to load background image.");
        
        // MODIFICATION START: Add event listener for the opacity slider
        opacitySlider.oninput = () => {
            const activeObj = uiCanvas.getActiveObject();
            if (activeObj) {
                const newOpacity = parseFloat(opacitySlider.value);
                activeObj.set({ opacity: newOpacity });
                uiCanvas.renderAll();
                
                // Update the stored parameters immediately
                const layerIndex = activeObj.id;
                if (allLayerParams[layerIndex]) {
                    allLayerParams[layerIndex].opacity = newOpacity;
                }
            }
        };
        // MODIFICATION END

        modal.querySelector('#zml-reset-btn').onclick = () => {
            const activeObj = uiCanvas.getActiveObject();
            if (activeObj && bgImg.naturalWidth > 0) {
                 const layerIndex = activeObj.id;
                 const originalFgImg = fgSources.find(f => f.index === layerIndex).image;
                 const initialScale = (bgImg.naturalWidth * 0.5) / originalFgImg.naturalWidth;
                 const initialUiScale = initialScale * uiCanvasScale;
                 // Also reset opacity
                 activeObj.set({ left: uiCanvas.width / 2, top: uiCanvas.height / 2, scaleX: initialUiScale, scaleY: initialUiScale, angle: 0, opacity: 1.0 });
                 activeObj.setCoords();
                 uiCanvas.renderAll();
                 syncUIWithActiveLayer(); // Sync slider after reset
                 uiCanvas.fire('object:modified', { target: activeObj });
            }
        };

        modal.querySelector('#zml-confirm-btn').onclick = () => {
            // No changes needed here, allLayerParams now includes opacity
            widget.data.value = JSON.stringify(allLayerParams);
            node.onWidgetValue_changed?.(widget.data, widget.data.value);
            closeModal(modal);
        };
        
        modal.querySelector('#zml-cancel-btn').onclick = () => closeModal(modal);
    });
}
// ======================= ZML_ImagePainter 节点 =======================
app.registerExtension({
    name: "ZML.ImagePainter",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_ImagePainter") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                const node = this;
                const widget = {
                    data: this.widgets.find(w => w.name === "paint_data"),
                };
                this.addWidget("button", "画画", null, () => showPainterModal(node, widget));
            };
        }
    },
});

function showPainterModal(node, widget) {
    const upstreamNode = node.getInputNode(0);
    let imageUrl = null;
    
    // 获取默认宽和默认高参数值
    let defaultWidth = 1024;
    let defaultHeight = 1024;
    // 获取启用自适应动画参数值，默认为true
    let enableAdaptiveAnimation = true;
    const widthWidget = node.widgets.find(w => w.name === '默认宽');
    const heightWidget = node.widgets.find(w => w.name === '默认高');
    const animationWidget = node.widgets.find(w => w.name === '启用自适应动画');
    if (widthWidget) defaultWidth = widthWidget.value || defaultWidth;
    if (heightWidget) defaultHeight = heightWidget.value || defaultHeight;
    if (animationWidget !== undefined) enableAdaptiveAnimation = animationWidget.value;
    
    // 检查是否有上游图像节点连接
    if (upstreamNode && upstreamNode.imgs && upstreamNode.imgs.length > 0) {
        imageUrl = upstreamNode.imgs[0].src;
    } else {
        // 如果没有上游图像，创建一个用户指定尺寸的黑色图像
        const canvas = document.createElement('canvas');
        canvas.width = defaultWidth;
        canvas.height = defaultHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000'; // 黑色
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        imageUrl = canvas.toDataURL('image/png');
    }
    
    // 为这个节点创建一个唯一标识符，用于缓存
    const nodeId = node.id;
    const cacheKey = `${nodeId}_${imageUrl}`;

    // 检查画笔图像输入
    const brushInput = node.inputs.find(i => i.name === "画笔图像");
    let hasBrushImage = false;
    if (brushInput && brushInput.link) {
        const upstreamBrushNode = node.getInputNode(node.inputs.indexOf(brushInput));
        if (upstreamBrushNode && upstreamBrushNode.imgs && upstreamBrushNode.imgs.length > 0) {
            hasBrushImage = true;
        }
    }
    let initialDisplayScale = 1.0;

    const modalHtml = `
        <div class="zml-modal">
            <div class="zml-modal-content"> <!-- Removed style="width: auto; height: auto;" -->
                <style>
                    /* 通用模态框样式 */
                    .zml-modal { 
                        position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                        background: rgba(0,0,0,0.7); 
                        display: flex; justify-content: center; align-items: center; 
                        z-index: 1001; 
                    }
                    .zml-modal-content { 
                        background: #2b2b2b; /* 略深色背景 */
                        padding: 15px;      /* 略减内边距 */
                        border-radius: 10px; /* 更圆润的边角 */
                        box-shadow: 0 5px 15px rgba(0,0,0,0.5); /* 增加阴影 */
                        min-width: 600px;  /* 最小宽度 */
                        min-height: 450px; /* 最小高度 */
                        max-width: 95vw; /* 允许更宽 */
                        max-height: 95vh; /* 允许更高 */
                        display: flex; /* 使用flex布局，方便水平排列 */
                        gap: 12px; /* 元素间距 */
                        border: 1px solid #444; /* 微妙的边框 */
                        color: #E0E0E0; /* 默认字体颜色 */
                        flex-direction: row; /* 主轴方向为行 */
                        align-items: flex-start; /* 顶部对齐 */
                        position: relative; /* For resize handle */
                        overflow: hidden; /* Hide overflow, let content handle it */
                    }
                    /* Resize Handle Style */
                    .zml-resize-handle {
                        position: absolute;
                        bottom: 0;
                        right: 0;
                        width: 20px;
                        height: 20px;
                        cursor: se-resize;
                        z-index: 20; /* Above other content */
                    }
                    .zml-resize-handle::after {
                        content: '';
                        position: absolute;
                        right: 3px;
                        bottom: 3px;
                        width: 8px;
                        height: 8px;
                        border-right: 2px solid #888;
                        border-bottom: 2px solid #888;
                        box-sizing: border-box;
                    }
                    /* 主内容区: 包含图像, 提示和底部控制面板 */
                    .zml-main-content-area {
                        flex-grow: 1; /* 占据剩余空间 */
                        display: flex;
                        flex-direction: column;
                        gap: 12px; /* 内部元素垂直间距 */
                        align-items: center; /* 内部元素水平居中 */
                        flex-shrink: 1; /* 允许缩小 */
                        min-width: 0; /* 允许内容缩小 */
                    }

                    /* 图像显示区域 */
                    .zml-editor-main { 
                        overflow: hidden; 
                        background: #111; 
                        position: relative;
                        border: 4px solid #FF0000; /* 默认红色边框，将被JS更新 */
                        box-sizing: border-box; /* 边框不增加内容区域大小 */
                        border-radius: 8px; /* 与模态框风格一致 */
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        /* 移除 flex-grow/shrink/min-height, 改为JS精确设置宽高 */
                        /* flex-grow: 1; */ 
                        /* flex-shrink: 1; */
                        /* min-height: 0; */
                    }
                    .zml-editor-main canvas {
                        display: block; /* 确保canvas不带额外边距 */
                        max-width: 100%; /* 确保canvas在容器内, 尽管js会直接设置宽高 */
                        max-height: 100%; /* 确保canvas在容器内 */
                        /* Fabric.js 会直接设置 width/height 属性，也会影响渲染尺寸 */
                    }

                    .zml-editor-tip { 
                        color: #a0a0a0; /* 更柔和的提示颜色 */
                        text-align: center; 
                        font-size: 11px; /* 略小字体 */
                        margin: 0; /* 移除默认margin */
                        flex-shrink: 0; /* 防止提示文本缩小 */
                    }

                    /* 控制按钮通用样式 */
                    .zml-editor-btn { 
                        padding: 7px 12px; /* 调整内边距 */
                        color: white; 
                        border: none; 
                        border-radius: 5px; /* 圆润按钮 */
                        cursor: pointer; 
                        font-size: 13px; /* 统一字体大小 */
                        transition: background-color 0.2s ease, transform 0.1s ease; /* 动画效果 */
                        min-width: 70px; /* 最小宽度 */
                    }
                    .zml-editor-btn:hover {
                        transform: translateY(-1px); /* 悬停微抬 */
                    }
                    .zml-editor-btn:active {
                        transform: translateY(0); /* 点击下压 */
                    }
                    /* 各类按钮颜色 */
                    .zml-option-btn { background-color: #555; }
                    .zml-option-btn:hover { background-color: #666; }
                    .zml-confirm-btn { background-color: #4CAF50; }
                    .zml-confirm-btn:hover { background-color: #5cb85c; }
                    .zml-cancel-btn { background-color: #f44336; }
                    .zml-cancel-btn:hover { background-color: #e57373; }
                    
                    /* Color Picker and Brush Size Slider */
                    .zml-control-group {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        color: #E0E0E0;
                        font-size: 13px;
                    }
                    .zml-control-label {
                        white-space: nowrap; /* 防止换行 */
                    }

                    #zml-color-picker { 
                        width: 40px; height: 30px; 
                        border: 1px solid #666; /* 边框 */
                        border-radius: 4px; /* 圆角 */
                        padding: 0; 
                        background: none; /* 移除默认背景 */
                        cursor: pointer; 
                        -webkit-appearance: none; /* 移除默认外观 */
                        -moz-appearance: none;
                        appearance: none;
                    }
                    #zml-color-picker::-webkit-color-swatch-wrapper { padding: 0; }
                    #zml-color-picker::-webkit-color-swatch { border: none; border-radius: 3px; }
                    #zml-color-picker::-moz-color-swatch-wrapper { padding: 0; }
                    #zml-color-picker::-moz-color-swatch { border: none; border-radius: 3px; }

                    #zml-brush-size { 
                        width: 100px; /* 适当增加宽度 */
                        -webkit-appearance: none; /* 移除默认外观 */
                        appearance: none;
                        height: 6px; /* 细滑块 */
                        background: #555; /* 滑轨背景 */
                        border-radius: 3px;
                        cursor: pointer;
                        outline: none;
                    }
                    #zml-brush-size::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        appearance: none;
                        width: 16px; height: 16px;
                        border-radius: 50%;
                        background: #f0ad4e; /* 滑块颜色 */
                        cursor: pointer;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                        margin-top: -5px; /* 居中滑块 */
                        border: solid 1px #d58512;
                    }
                    #zml-brush-size::-moz-range-thumb {
                        width: 16px; height: 16px;
                        border-radius: 50%;
                        background: #f0ad4e;
                        cursor: pointer;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                        border: solid 1px #d58512;
                    }

                    /* 不透明度滑块样式 */
                #zml-opacity-slider {
                    width: 100px;
                    -webkit-appearance: none;
                    appearance: none;
                    height: 6px;
                    background: #555;
                    border-radius: 3px;
                    cursor: pointer;
                    outline: none;
                }
                #zml-opacity-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 16px; height: 16px;
                    border-radius: 50%;
                    background: #0080ff;
                    cursor: pointer;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                    margin-top: -5px;
                    border: solid 1px #0066cc;
                }
                #zml-opacity-slider::-moz-range-thumb {
                    width: 16px; height: 16px;
                    border-radius: 50%;
                    background: #0080ff;
                    cursor: pointer;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                    border: solid 1px #0066cc;
                }
                    .zml-side-panel {
                        background: #3a3a3a; /* 工具栏背景 */
                        padding: 8px; border-radius: 8px; /* 工具栏圆角和内边距 */
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        z-index: 10;
                        max-height: 100%; /* 确保能占据所有可用父容器高度 */
                        overflow-y: auto; /* 溢出时自动滚动 */
                        -ms-overflow-style: none; /* IE和Edge隐藏滚动条 */
                        scrollbar-width: none; /* Firefox隐藏滚动条 */
                        flex-shrink: 0; /* 不缩小宽度 */
                    }
                    /* 隐藏滚动条 */
                    .zml-side-panel::-webkit-scrollbar {
                        display: none;
                    }

                    /* 快速颜色球样式 */
                    .zml-quick-colors {
                         display: flex; 
                         flex-direction: column; 
                         gap: 7px;
                         align-items: center; /* 水平居中 */
                         width: 100%; /* 确保占满容器宽度 */
                      }
                    .zml-color-ball {
                        width: 24px; height: 24px;
                        border-radius: 50%; 
                        border: 2px solid #555; 
                        cursor: pointer;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.3); 
                        transition: transform 0.1s ease-in-out, border-color 0.1s ease-in-out;
                        padding: 0; 
                    }
                    /* 特殊处理黑色边框，防止颜色球与边框融合 */
                    .zml-color-ball[data-color="#000000"] { border-color: #888; } 
                    .zml-color-ball:hover { transform: scale(1.1); border-color: #AAA; }
                    .zml-color-ball.active { border-color: #f0ad4e; box-shadow: 0 0 5px #f0ad4e; }

                    /* 工具栏样式 */
                    .zml-painter-toolbar { 
                        display: flex; flex-direction: column; gap: 7px; /* 调整间距 */
                    }
                    .zml-tool-btn { 
                        width: 32px; height: 32px; padding: 4px; 
                        background-color: #4a4a4a; /* 工具按钮背景 */
                        border: 1px solid #666; 
                        border-radius: 6px; /* 更圆润 */
                        cursor: pointer; 
                        display: flex; justify-content: center; align-items: center; 
                        color: white; 
                        transition: background-color 0.2s ease, border-color 0.2s ease;
                    }
                    .zml-tool-btn:hover { background-color: #5a5a5a; border-color: #888; }
                    .zml-tool-btn:disabled { background-color: #333; cursor: not-allowed; opacity: 0.5; }
                    .zml-tool-btn.active { background-color: #FFA500; border-color: #FF8C00; box-shadow: 0 0 5px rgba(255,165,0,0.5); } /* 激活颜色更亮 */
                    .zml-tool-btn svg { width: 100%; height: 100%; fill: currentColor; } /* SVG颜色跟随按钮文本色 */
                    .zml-tool-btn#zml-move-tool:active { cursor: grabbing; }
                    
                    /* 底部控制面板 */
                    .zml-painter-bottom-panel {
                        display: flex;
                        justify-content: space-between; /* 元素间距平均分布 */
                        align-items: center;
                        flex-wrap: wrap; /* 适应小屏 */
                        gap: 15px; /* 组间距 */
                        background: #3a3a3a; /* 背景 */
                        padding: 10px 15px; /* 内边距 */
                        border-radius: 8px;
                        box-shadow: inset 0 1px 3px rgba(0,0,0,0.3); /* 内阴影 */
                        width: 100%; /* 占据父容器的全部宽度 */
                        flex-shrink: 0; /* 防止底部面板缩小 */
                    }
                    .zml-action-buttons {
                        display: flex;
                        gap: 8px; /* 按钮间距 */
                        flex-wrap: wrap;
                        justify-content: center; /* 按钮居中 */
                    }
                </style>
                
                <!-- 左侧面板 - 包含颜色球和功能按钮 -->
                <div class="zml-side-panel">
                    <!-- 快速颜色球 -->
                    <div class="zml-quick-colors" style="display: flex; justify-content: center;">
                        <button class="zml-color-ball" data-color="#FFFFFF" style="background-color: #FFFFFF;" title="白色"></button>
                        <button class="zml-color-ball" data-color="#000000" style="background-color: #000000;" title="黑色"></button>
                        <button class="zml-color-ball" data-color="#FF0000" style="background-color: #FF0000;" title="红色"></button>
                        <button class="zml-color-ball" data-color="#00FF00" style="background-color: #00FF00;" title="绿色"></button>
                        <button class="zml-color-ball" data-color="#0000FF" style="background-color: #0000FF;" title="蓝色"></button>
                        <button class="zml-color-ball" data-color="#FFFF00" style="background-color: #FFFF00;" title="黄色"></button>
                    </div>
                    
                    <!-- 分隔线 -->
                     <div style="height: 1px; background-color: #555; margin: 20px 0;"></div>
                    
                    <!-- 功能按钮 - 竖向排列 -->
                    <style>
                        /* 1:1方形按钮样式 */
                        .zml-square-btn {
                            width: 40px;
                            height: 40px;
                            padding: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            background-color: #555555;
                            border: 1px solid #777777;
                            border-radius: 4px;
                            color: white;
                            font-size: 14px;
                            cursor: pointer;
                            transition: all 0.2s ease;
                            box-sizing: border-box;
                            text-align: center;
                            margin-bottom: 8px;
                            margin-left: auto;
                            margin-right: auto;
                        }
                        .zml-square-btn:hover {
                            background-color: #666666;
                            border-color: #999999;
                        }
                        .zml-square-btn:active {
                            background-color: #444444;
                        }
                    </style>
                    <button id="zml-reset-view-btn" class="zml-square-btn" title="重置视角">重置</button>
                    <button id="zml-undo-paint-btn" class="zml-square-btn" title="撤销上一次操作">撤销</button>
                    <button id="zml-clear-paint-btn" class="zml-square-btn" title="清空画面">清空</button>
                </div>

                <!-- 中间主内容区 -->
                <div class="zml-main-content-area">
                    <div class="zml-editor-main" id="zml-editor-main-container">
                        <canvas id="zml-fabric-canvas" class="zml-hidden-canvas"></canvas>
                    <div id="zml-painter-brush-preview" style="position: absolute; pointer-events: none; display: none; z-index: 1000; border-radius: 50%; box-sizing: border-box;"></div>
                    </div>
                    <p id="zml-editor-tip" class="zml-editor-tip">按住Ctrl+滚轮缩放, 按住Ctrl+左键拖拽平移，Ctrl+Z撤回。画笔模式：按住鼠标左键绘制。</p>
                    
                    <div id="zml-painter-bottom-panel" class="zml-painter-bottom-panel" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap; gap: 15px;">
                        <div style="display: flex; gap: 15px; flex: 1; min-width: 0;">
                            <div class="zml-control-group" style="white-space: nowrap;">
                                <label for="zml-color-picker" class="zml-control-label">颜色:</label>
                                <input type="color" id="zml-color-picker" class="zml-styled-input" value="#FF0000">
                            </div>
                            <div class="zml-control-group" style="white-space: nowrap; flex: 1; min-width: 120px;">
                                <label for="zml-opacity-slider" class="zml-control-label">不透明度:</label>
                                <input type="range" id="zml-opacity-slider" class="zml-styled-input" min="1" max="100" value="100" style="width: 100%;">
                            </div>
                            <div class="zml-control-group" style="white-space: nowrap; flex: 1; min-width: 120px;">
                                <label for="zml-brush-size" class="zml-control-label">大小:</label>
                                <input type="range" id="zml-brush-size" class="zml-styled-input" min="1" max="100" value="10" style="width: 100%;">
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px; white-space: nowrap;">
                            <button id="zml-confirm-paint-btn" class="zml-editor-btn zml-confirm-btn" style="padding: 8px 16px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">确认</button>
                            <button id="zml-cancel-paint-btn" class="zml-editor-btn zml-cancel-btn" style="padding: 8px 16px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">取消</button>
                        </div>
                    </div>
                </div>

                <!-- 右侧工具栏 -->
                <div class="zml-side-panel">
                    <div id="zml-painter-toolbar" class="zml-painter-toolbar">
                        <button id="zml-move-tool" class="zml-tool-btn" title="长按拖拽窗口">
                            <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
                        </button>
                        <button id="zml-brush-tool" class="zml-tool-btn active" title="画笔">
                            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </button>
                        <button id="zml-eraser-tool" class="zml-tool-btn" title="橡皮擦">
                            <svg viewBox="0 0 24 24"><path d="M16.24 3.56l-1.42 1.42 2.82 2.82 1.42-1.42c.39-.39.39-1.02 0-1.41l-1.41-1.41c-.39-.39-1.02-.39-1.41 0zm-12.66 8.61L14.59 21H21v-6.41L9.59 3.56l-6.01 6.01c-.39.39-.39 1.02 0 1.41l1.41 1.41c.39.39 1.02.39 1.41 0z"/></svg>
                        </button>
                        <button id="zml-rect-tool" class="zml-tool-btn" title="绘制矩形">
                            <svg viewBox="0 0 24 24"><path d="M3 3v18h18V3H3zm16 16H5V5h14v14z"/></svg>
                        </button>
                        <button id="zml-triangle-tool" class="zml-tool-btn" title="绘制三角形(垂直)">
                            <svg viewBox="0 0 24 24"><path d="m12 7.77 6.39 11.23H5.61L12 7.77M12 2 1 21h22L12 2z"/></svg>
                        </button>
                        <button id="zml-htriangle-tool" class="zml-tool-btn" title="绘制三角形(水平)">
                            <svg viewBox="0 0 24 24" style="transform: rotate(90deg);"><path d="m12 7.77 6.39 11.23H5.61L12 7.77M12 2 1 21h22L12 2z"></path></svg>
                        </button>
                        <button id="zml-circle-tool" class="zml-tool-btn" title="绘制圆形">
                            <svg viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
                        </button>
                        <button id="zml-star-tool" class="zml-tool-btn" title="绘制五角星">
                            <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>
                        </button>
                        <button id="zml-heart-tool" class="zml-tool-btn" title="绘制爱心">
                            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
                        </button>
                        <button id="zml-mosaic-tool" class="zml-tool-btn" title="马赛克">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h6v6H2z m8 0h6v6h-6z m8 0h6v6h-6z M2 10h6v6H2z m8 0h6v6h-6z m8 0h6v6h-6z M2 18h6v6H2z m8 0h6v6h-6z m8 0h6v6h-6z" /></svg>
                        </button>
                        <button id="zml-image-stamp-tool" class="zml-tool-btn" title="图像笔刷 (需连接画笔图像)" ${!hasBrushImage ? 'disabled' : ''}>
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                        </button>
                        <button id="zml-arrow-tool" class="zml-tool-btn" title="绘制箭头">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 11v2h12l-5.5 5.5 1.42 1.42L19.84 12l-7.92-7.92L10.5 5.5 16 11H4z"></path></svg>
                        </button>
                        <button id="zml-fill-tool" class="zml-tool-btn" title="填充形状 (切换)">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 12H5v-2h14v2zm-7 6.72L5.72 12H11v6.72zm1-6.72h5.28L13 18.72V12z" transform="rotate(45 12 12)"></path><path d="M22 2H2v20h20V2zm-2 18H4V4h16v16z"></path></svg>
                        </button>
                    </div>
                </div>

                <!-- Resize Handle -->
                <div class="zml-resize-handle"></div>
            </div>
        </div>
    `;

    const modal = createModal(modalHtml);
    const modalContent = modal.querySelector('.zml-modal-content'); // 获取模态框内容区
    const mainContentArea = modal.querySelector('.zml-main-content-area'); // 获取主内容区
    const imageDisplayArea = modal.querySelector('#zml-editor-main-container'); // 获取图像显示区域
    const canvasElement = modal.querySelector('#zml-fabric-canvas'); // 获取canvas元素
    const colorPicker = modal.querySelector('#zml-color-picker');
    const brushSizeSlider = modal.querySelector('#zml-brush-size');
    const opacitySlider = modal.querySelector('#zml-opacity-slider'); // 不透明度滑块
    const quickColorBalls = modal.querySelectorAll('.zml-color-ball');
    const bottomPanel = modal.querySelector('#zml-painter-bottom-panel');
    const tipElement = modal.querySelector('#zml-editor-tip');

    // --- Window Resizing Logic ---
    const resizeHandle = modal.querySelector('.zml-resize-handle');
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = modalContent.offsetWidth;
            const startHeight = modalContent.offsetHeight;

            const onMouseMove = (moveE) => {
                const newWidth = startWidth + (moveE.clientX - startX);
                const newHeight = startHeight + (moveE.clientY - startY);
                
                const minWidth = parseInt(getComputedStyle(modalContent).minWidth, 10) || 0;
                const minHeight = parseInt(getComputedStyle(modalContent).minHeight, 10) || 0;

                modalContent.style.width = `${Math.max(minWidth, newWidth)}px`;
                modalContent.style.height = `${Math.max(minHeight, newHeight)}px`;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    loadScript(extensionBasePath + 'lib/fabric.min.js').then(() => {
        // Initialize canvas
        const canvas = new fabric.Canvas(canvasElement, { stopContextMenu: true });
        let isPanning = false, lastPanPoint = null;

        // MODIFICATION START: 获取画笔预览元素
        const brushPreview = modal.querySelector('#zml-painter-brush-preview');
        // MODIFICATION END
        
        // --- State Management ---
        let undoStack = [];
        let drawPaths = [];
        let mosaicRects = [];
        let imageStamps = [];
        let isFillMode = false;

        // --- Toolbar and Shape Drawing Logic ---
        let drawingMode = 'brush'; 
        let isDrawingShape = false;
        let shapeStartPoint = null;
        let currentShape = null;

        const moveBtn = modal.querySelector('#zml-move-tool');
        const brushBtn = modal.querySelector('#zml-brush-tool');
        const rectBtn = modal.querySelector('#zml-rect-tool');
        const triangleBtn = modal.querySelector('#zml-triangle-tool');
        const htriangleBtn = modal.querySelector('#zml-htriangle-tool');
        const circleBtn = modal.querySelector('#zml-circle-tool');
        const starBtn = modal.querySelector('#zml-star-tool');
        const heartBtn = modal.querySelector('#zml-heart-tool');
        const mosaicBtn = modal.querySelector('#zml-mosaic-tool');
        const eraserBtn = modal.querySelector('#zml-eraser-tool'); // 获取橡皮擦按钮
        const imageStampBtn = modal.querySelector('#zml-image-stamp-tool');
        const arrowBtn = modal.querySelector('#zml-arrow-tool');
        const fillBtn = modal.querySelector('#zml-fill-tool');
        const toolBtns = [moveBtn, brushBtn, eraserBtn, rectBtn, triangleBtn, htriangleBtn, circleBtn, starBtn, heartBtn, mosaicBtn, imageStampBtn, arrowBtn]; // 更新工具按钮列表

        // 辅助函数：将十六进制颜色转换为带透明度的RGBA格式
        function hexToRgba(hex, alpha) {
            // 移除可能的#前缀
            hex = hex.replace(/^#/, '');
            
            // 解析十六进制颜色值
            let r = 0, g = 0, b = 0;
            if (hex.length === 6) {
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
            } else if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            }
            
            // 返回RGBA格式字符串
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        // --- 全局Ctrl键监听 --- 
        let isCtrlKeyPressed = false;
        let isHandToolMode = false; // 抓手模式标志
        
        // MODIFICATION START: 添加画笔预览更新函数
        function updateBrushCursorPreview(e) {
            if (!brushPreview) return;

            // 如果在平移/拖拽窗口，隐藏预览并设置光标
            if (isPanning || isDragging || isHandToolMode) {
                brushPreview.style.display = 'none';
                canvas.defaultCursor = isPanning ? 'grabbing' : 'grab';
                canvas.freeDrawingCursor = isPanning ? 'grabbing' : 'grab';
                return;
            }

            // 仅在画笔或橡皮擦模式下显示预览
            if (drawingMode === 'brush' || drawingMode === 'eraser') {
                const zoom = canvas.getZoom();
                // 画笔大小需要乘以画布的当前缩放级别
                const displaySize = parseInt(brushSizeSlider.value) * zoom;
                
                brushPreview.style.width = `${displaySize}px`;
                brushPreview.style.height = `${displaySize}px`;

                const opacity = parseInt(opacitySlider.value) / 100;
                
                if (drawingMode === 'eraser') {
                    // 橡皮擦预览：使用反色混合模式的白色圆圈
                    brushPreview.style.background = 'rgba(255, 255, 255, 0.3)';
                    brushPreview.style.border = '1px solid white';
                    brushPreview.style.mixBlendMode = 'difference';
                } else {
                    // 画笔预览：匹配颜色和不透明度
                    const rgbaColor = hexToRgba(colorPicker.value, opacity);
                    brushPreview.style.background = rgbaColor;
                    brushPreview.style.border = `1px solid ${colorPicker.value}`;
                    brushPreview.style.mixBlendMode = 'normal'; // 正常混合
                }

                // 根据鼠标事件 'e' (如果提供了) 来定位
                if (e) {
                    // MODIFICATION START: 修复坐标计算
                    // 我们需要鼠标相对于 imageDisplayArea (即 zml-editor-main-container) 的位置
                    const rect = imageDisplayArea.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    // const x = e.offsetX; // [旧代码] 这是错误的，因为 offsetX 是相对于 canvas 的
                    // const y = e.offsetY; // [旧代码] 这是错误的
                    // MODIFICATION END
                    
                    // 将预览的中心对准鼠标指针
                    brushPreview.style.left = `${x - displaySize / 2}px`;
                    brushPreview.style.top = `${y - displaySize / 2}px`;
                }
                
                brushPreview.style.display = 'block';
                canvas.defaultCursor = 'none'; // 隐藏默认的十字光标
                canvas.freeDrawingCursor = 'none';
            } else {
                // 形状工具、移动工具等，隐藏预览并恢复默认光标
                brushPreview.style.display = 'none';
                canvas.defaultCursor = 'default';
                canvas.freeDrawingCursor = 'default';
            }
        }
                // MODIFICATION END

        function onCtrlKeyChange() {
            // Ctrl键释放时，无论当前是什么模式，都退出抓手模式
            if (!isCtrlKeyPressed && !isPanning) {
                if (drawingMode === 'brush' || drawingMode === 'eraser') { // 橡皮擦也使用freeDrawingBrush
                    canvas.isDrawingMode = true;
                    if (!canvas.freeDrawingBrush) {
                        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
                    }
                    const opacityValue = parseInt(opacitySlider.value) / 100;
                    canvas.freeDrawingBrush.width = parseInt(brushSizeSlider.value);
                    if (drawingMode === 'brush') {
                        canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, opacityValue);
                        canvas.freeDrawingBrush.globalCompositeOperation = 'source-over';
                    } else { // eraser
                        canvas.freeDrawingBrush.color = 'rgba(0,0,0,1)'; // 橡皮擦颜色不重要
                        canvas.freeDrawingBrush.globalCompositeOperation = 'destination-out';
                    }
                    canvas.freeDrawingBrush.strokeLineJoin = 'round';
                    canvas.freeDrawingBrush.strokeLineCap = 'round';
                    canvas.defaultCursor = 'crosshair';
                } else {
                    // 如果不是画笔模式，恢复相应的光标
                    canvas.defaultCursor = 'default';
                }
                isHandToolMode = false;
            }
            // MODIFICATION START: 在Ctrl状态改变时更新光标/预览
            updateBrushCursorPreview();
            // MODIFICATION END
        }
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control' && !isCtrlKeyPressed) {
                isCtrlKeyPressed = true;
                isHandToolMode = true;
                // 进入抓手模式：更改光标并禁用画笔
                canvas.defaultCursor = 'grab';
                if (drawingMode === 'brush' || drawingMode === 'eraser') { // 橡皮擦也需要禁用
                    canvas.isDrawingMode = false;
                    if (canvas.freeDrawingBrush) {
                        canvas.freeDrawingBrush = null;
                    }
                }
                // MODIFICATION START: 更新光标/预览
                updateBrushCursorPreview();
                // MODIFICATION END
            }
        });
        
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control' && isCtrlKeyPressed) {
                isCtrlKeyPressed = false;
                onCtrlKeyChange();
            }
        });
        
        // --- Window Dragging Logic ---
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let currentTranslate = { x: 0, y: 0 };
        moveBtn.addEventListener('mousedown', (e) => { isDragging = true; dragStart.x = e.clientX; dragStart.y = e.clientY; moveBtn.style.cursor = 'grabbing'; e.preventDefault(); updateBrushCursorPreview(); });
        window.addEventListener('mousemove', (e) => { if (!isDragging) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; modalContent.style.transform = `translate(${currentTranslate.x + dx}px, ${currentTranslate.y + dy}px)`; });
        window.addEventListener('mouseup', (e) => { if (!isDragging) return; isDragging = false; moveBtn.style.cursor = 'pointer'; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; currentTranslate.x += dx; currentTranslate.y += dy; updateBrushCursorPreview(); });

        // --- Tool Selection Logic ---
        function setActiveTool(activeBtn) {
            toolBtns.forEach(btn => btn.classList.remove('active'));
            if(activeBtn) activeBtn.classList.add('active');
            const modeMap = {
                'zml-move-tool': 'move', // 添加移动工具模式
                'zml-brush-tool': 'brush', 
                'zml-eraser-tool': 'eraser', // 添加橡皮擦模式
                'zml-rect-tool': 'rect', 
                'zml-triangle-tool': 'triangle',
                'zml-htriangle-tool': 'htriangle', 
                'zml-circle-tool': 'circle', 
                'zml-star-tool': 'star',
                'zml-heart-tool': 'heart', 
                'zml-arrow-tool': 'arrow', 
                'zml-mosaic-tool': 'mosaic', 
                'zml-image-stamp-tool': 'imageStamp'
            };
            drawingMode = modeMap[activeBtn.id] || 'brush';
            canvas.isDrawingMode = (drawingMode === 'brush' || drawingMode === 'eraser'); // 橡皮擦也使用freeDrawingBrush
            
            if (drawingMode === 'eraser') {
                canvas.freeDrawingBrush.color = 'rgba(0,0,0,1)'; // 橡皮擦颜色不重要，但需要设置
                canvas.freeDrawingBrush.globalCompositeOperation = 'destination-out'; // 擦除模式
                colorPicker.disabled = true; // 禁用颜色选择器
                opacitySlider.disabled = true; // 禁用不透明度选择器
                quickColorBalls.forEach(ball => ball.disabled = true); // 禁用快速颜色球
            } else if (drawingMode === 'brush') {
                canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, parseInt(opacitySlider.value) / 100);
                canvas.freeDrawingBrush.globalCompositeOperation = 'source-over'; // 正常绘制模式
                colorPicker.disabled = false; // 启用颜色选择器
                opacitySlider.disabled = false; // 启用不透明度选择器
                quickColorBalls.forEach(ball => ball.disabled = false); // 启用快速颜色球
            } else {
                // 其他形状工具
                canvas.freeDrawingBrush.globalCompositeOperation = 'source-over'; // 确保其他工具是正常绘制模式
                colorPicker.disabled = false; // 启用颜色选择器
                opacitySlider.disabled = false; // 启用不透明度选择器
                quickColorBalls.forEach(ball => ball.disabled = false); // 启用快速颜色球
            }

            let tipText = `按住Ctrl+滚轮缩放, 按住Ctrl+左键拖拽平移。当前模式：${activeBtn.title}。`;
            if (drawingMode === 'imageStamp') tipText += " “大小”滑块可控制图章缩放。";
            if (drawingMode === 'mosaic') tipText += " “大小”滑块可控制像素颗粒度。";
            tipElement.textContent = tipText;
            // MODIFICATION START: 在切换工具后更新光标/预览
            updateBrushCursorPreview();
            // MODIFICATION END
        }
        toolBtns.forEach(btn => btn.onclick = () => {
            if (btn.id === 'zml-move-tool') { // 移动工具不设置active状态，因为它不是绘制工具
                toolBtns.forEach(b => b.classList.remove('active'));
                drawingMode = 'move';
                canvas.isDrawingMode = false;
                tipElement.textContent = `当前模式：长按拖拽窗口。`;
            } else {
                setActiveTool(btn);
            }
        });
        fillBtn.onclick = () => { isFillMode = !isFillMode; fillBtn.classList.toggle('active', isFillMode); };

        // --- Undo/Redo and Data Management ---        
        function saveStateForUndo() {
            // 创建当前状态的深拷贝
            const currentState = {
                paths: JSON.parse(JSON.stringify(drawPaths)),
                mosaics: JSON.parse(JSON.stringify(mosaicRects)),
                stamps: JSON.parse(JSON.stringify(imageStamps))
            };
            
            // 限制撤销栈的大小，防止内存占用过大
            const MAX_UNDO_STACK_SIZE = 50;
            if (undoStack.length >= MAX_UNDO_STACK_SIZE) {
                undoStack.shift(); // 移除最旧的状态
            }
            
            // 将状态添加到撤销栈
            undoStack.push(currentState);
        }
        // 优化恢复状态函数，确保在恢复过程中不会显示中间状态
        function restoreState(state) {
            // 在更新数据前先隐藏画布，避免中间状态显示
            const canvasElement = canvas.getElement();
            const originalDisplay = canvasElement.style.display;
            canvasElement.style.display = 'none';
            
            // 更新数据
            drawPaths = state.paths;
            mosaicRects = state.mosaics;
            imageStamps = state.stamps;
            
            // 使用requestAnimationFrame确保在下一帧渲染，避免视觉闪烁
            requestAnimationFrame(() => {
                // 重新渲染
                renderAllDrawings();
                
                // 重新显示画布
                canvasElement.style.display = originalDisplay;
            });
        }
        
        // 初始化时添加一个空状态
        undoStack = [{
            paths: [],
            mosaics: [],
            stamps: []
        }];

        const img = new Image();
        img.src = imageUrl;
        
        const setupCanvasAndImage = () => {
            if (enableAdaptiveAnimation) {
                // 检查是否有缓存的尺寸信息
                if (zml_painter_size_cache[cacheKey]) {
                    const cachedSize = zml_painter_size_cache[cacheKey];
                    // 应用缓存的尺寸
                    modalContent.style.width = `${cachedSize.modalWidth}px`;
                    modalContent.style.height = `${cachedSize.modalHeight}px`;
                    initialDisplayScale = cachedSize.initialDisplayScale;
                } else {
                    // 获取模态框内容区的实际尺寸
                    const modalContentRect = modalContent.getBoundingClientRect();
                    const modalContentStyle = getComputedStyle(modalContent);
                    const modalContentPaddingX = parseFloat(modalContentStyle.paddingLeft) + parseFloat(modalContentStyle.paddingRight);
                    const modalContentPaddingY = parseFloat(modalContentStyle.paddingTop) + parseFloat(modalContentStyle.paddingBottom);
                    const modalContentGap = parseFloat(modalContentStyle.columnGap || modalContentStyle.gap);

                    const sidePanels = modal.querySelectorAll('.zml-side-panel');
                    let totalSidePanelWidth = 0;
                    if (sidePanels.length > 0) {
                        totalSidePanelWidth = Array.from(sidePanels).reduce((sum, panel) => sum + panel.offsetWidth, 0);
                    }

                    // 计算主内容区可用的水平空间
                    const availableMainContentAreaWidth = modalContentRect.width - modalContentPaddingX - totalSidePanelWidth - (modalContentGap * (sidePanels.length > 0 ? sidePanels.length : 0));

                    // 获取底部面板和提示的高度
                    const bottomPanelHeight = bottomPanel.offsetHeight + parseFloat(getComputedStyle(bottomPanel).marginTop) + parseFloat(getComputedStyle(bottomPanel).marginBottom);
                    const tipHeight = tipElement.offsetHeight + parseFloat(getComputedStyle(tipElement).marginTop) + parseFloat(getComputedStyle(tipElement).marginBottom);
                    const mainContentAreaStyle = getComputedStyle(mainContentArea);
                    const mainContentAreaGap = parseFloat(mainContentAreaStyle.rowGap || mainContentAreaStyle.gap);

                    // 计算图像区域可用的垂直空间
                    const availableImageHeightForScaler = modalContentRect.height - modalContentPaddingY - bottomPanelHeight - tipHeight - (mainContentAreaGap * 2);

                    // 计算初始缩放比例
                    initialDisplayScale = Math.min(1, 
                        availableMainContentAreaWidth / img.naturalWidth, 
                        availableImageHeightForScaler / img.naturalHeight
                    );
                    
                    // 可以设置一个最小缩放比例，防止图像过小（可选）
                    const MIN_SCALE = 0.05; 
                    if (initialDisplayScale < MIN_SCALE && (img.naturalWidth * MIN_SCALE) > 100) { // 避免超小图被放大到无意义的尺寸
                        initialDisplayScale = Math.min(1, MIN_SCALE);
                    } else if (initialDisplayScale * img.naturalWidth < 100) { // 确保图像至少有100px宽
                         initialDisplayScale = 100 / img.naturalWidth;
                         if (initialDisplayScale * img.naturalHeight > availableImageHeightForScaler) { // 如果按宽放大后高溢出
                            initialDisplayScale = availableImageHeightForScaler / img.naturalHeight;
                         }
                         initialDisplayScale = Math.min(1, initialDisplayScale); // 避免放大到大于原始尺寸
                    }
                }
            } else {
                // 不启用自适应动画时，使用默认大小但仍然计算合适的缩放比例
                // 设置模态框宽度固定，但高度根据内容自适应
                modalContent.style.minWidth = 'auto';
                modalContent.style.minHeight = 'auto';
                modalContent.style.width = '850px';
                modalContent.style.height = 'auto'; // 改为auto让高度自适应内容
                modalContent.style.maxHeight = '80vh'; // 添加最大高度限制，避免内容过长时溢出屏幕
                
                // 计算合适的缩放比例，确保图像完全可见
                // 先获取默认尺寸
                const defaultCanvasWidth = 600;
                const defaultCanvasHeight = 450;
                
                // 计算缩放比例，确保图像完全适应画布
                const scaleX = defaultCanvasWidth / img.naturalWidth;
                const scaleY = defaultCanvasHeight / img.naturalHeight;
                initialDisplayScale = Math.min(scaleX, scaleY, 1.0); // 最大不超过1:1
                
                // 确保缩放比例不会太小，图像至少有100px宽
                if (initialDisplayScale * img.naturalWidth < 100) {
                    initialDisplayScale = 100 / img.naturalWidth;
                }
            }


            const displayWidth = img.naturalWidth * initialDisplayScale;
            const displayHeight = img.naturalHeight * initialDisplayScale;
            
            // 确保imageDisplayArea (zml-editor-main) 容器的尺寸和canvas的尺寸一致
            imageDisplayArea.style.width = `${displayWidth}px`;
            imageDisplayArea.style.height = `${displayHeight}px`;

            // Fabric.js canvas 自身的尺寸 (内部绘制尺寸)
            canvas.setWidth(displayWidth);
            canvas.setHeight(displayHeight);

            // 确保canvas元素在DOM中的CSS尺寸也一致
            canvasElement.style.width = `${displayWidth}px`;
            canvasElement.style.height = `${displayHeight}px`;

            fabric.Image.fromURL(imageUrl, (fImg) => {
                canvas.setBackgroundImage(fImg, canvas.renderAll.bind(canvas), {
                    scaleX: initialDisplayScale,
                    scaleY: initialDisplayScale,
                });
                canvasElement.classList.remove('zml-hidden-canvas'); // 图像加载和设置背景后显示 Canvas
            }, { crossOrigin: 'anonymous' });

            // 重置视图函数 (用于按钮)
            const resetView = () => {
                canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); // 重置平移和旋转
                canvas.setZoom(1); // 将Fabric.js的缩放重置为1，因为它已经适应了容器大小
                canvas.renderAll();
            };
            modal.querySelector('#zml-reset-view-btn').onclick = resetView;

            try {
                // 检查节点是否有'清空绘制内容'参数且值为true
                const clearContentWidget = node.widgets.find(w => w.name === "清空绘制内容");
                const shouldClearContent = clearContentWidget && clearContentWidget.value;
                
                if (shouldClearContent) {
                    // 如果启用了清空绘制内容，则使用空数据
                    drawPaths = [];
                    mosaicRects = [];
                    imageStamps = [];
                } else {
                    // 否则尝试加载已保存的数据
                    const existingData = JSON.parse(widget.data.value);
                    drawPaths = existingData.draw_paths || [];
                    mosaicRects = existingData.mosaic_rects || [];
                    imageStamps = existingData.image_stamps || [];
                }
            } catch (e) { /* ignore */ }
            
            // 确保在背景图加载且canvas已正确设置尺寸后，再渲染之前的绘制
            if (canvas.backgroundImage) {
                saveStateForUndo(); 
                renderAllDrawings();
            } else {
                canvas.on('background:added', () => { 
                    saveStateForUndo();
                    renderAllDrawings();
                });
            }
        };

        img.onload = setupCanvasAndImage;
        img.onerror = () => {
            alert("加载图像失败，请检查图像源。");
            closeModal(modal);
        };

        // 根据是否启用自适应动画来决定是否添加ResizeObserver
        let resizeObserver = null;
        if (enableAdaptiveAnimation) {
            // 为了响应窗口大小变化 (可选但推荐)
            resizeObserver = new ResizeObserver(() => {
                if (modal.isConnected) { // 确保模态框仍然在DOM中
                    setupCanvasAndImage(); // 重新计算并设置尺寸
                    canvas.renderAll(); // 重新渲染以适应新尺寸
                } else {
                    resizeObserver.disconnect(); // 如果模态框已关闭，断开Observer
                }
            });
            resizeObserver.observe(modalContent); // 监听模态框内容区尺寸变化
        }

        
        function renderAllDrawings() {
             // 移除所有非背景的绘制对象，以便重新绘制
             canvas.remove(...canvas.getObjects().filter(o => o.isNotBackground)); 
             
             // 渲染马赛克
             mosaicRects.forEach(rect => {
                const fabricRect = new fabric.Rect({ 
                    left: rect.x * initialDisplayScale, 
                    top: rect.y * initialDisplayScale, 
                    width: rect.w * initialDisplayScale, 
                    height: rect.h * initialDisplayScale, 
                    fill: 'rgba(128,128,128,0.5)', 
                    stroke: '#888', 
                    strokeWidth: 1, 
                    selectable: false, evented: false, isNotBackground: true 
                });
                canvas.add(fabricRect);
             });
             // 渲染图章
             imageStamps.forEach(stamp => {
                const radius = (brushSizeSlider.max / 2) * stamp.scale * initialDisplayScale; 
                const placeholder = new fabric.Circle({ 
                    left: stamp.x * initialDisplayScale, 
                    top: stamp.y * initialDisplayScale, 
                    radius: radius, 
                    fill: 'rgba(128,0,128,0.5)', 
                    stroke: '#800080', 
                    strokeWidth: 1, 
                    originX: 'center', originY: 'center', selectable: false, evented: false, isNotBackground: true 
                });
                canvas.add(placeholder);
             });
             // 渲染路径
            drawPaths.forEach(pathData => {
                const isFill = pathData.isFill || false;
                
                // 关键点：不要在渲染时应用视图变换，让Fabric.js自己处理缩放和平移
                // 我们只需要将原始图像坐标转换为画布初始尺寸的坐标
                const scaledPathPoints = pathData.points.map(p => `${p[0] * initialDisplayScale},${p[1] * initialDisplayScale}`);
                const pathString = "M " + scaledPathPoints.join(" L ");
                
                const fabricPath = new fabric.Path(pathString, { 
                    stroke: pathData.color, 
                    strokeWidth: pathData.width * initialDisplayScale, 
                    fill: isFill ? pathData.color : null, 
                    selectable: false, 
                    evented: false, 
                    objectCaching: false, 
                    strokeLineJoin: 'round', 
                    strokeLineCap: 'round', 
                    isNotBackground: true,
                    globalCompositeOperation: pathData.isEraser ? 'destination-out' : 'source-over' // 根据isEraser设置混合模式
                });
                
                canvas.add(fabricPath);
            });
            canvas.requestRenderAll();
        }

        canvas.isDrawingMode = true;
        const initialOpacity = parseInt(opacitySlider.value) / 100; // 获取初始不透明度
        canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, initialOpacity);
        canvas.freeDrawingBrush.width = parseInt(brushSizeSlider.value);
        canvas.freeDrawingBrush.decimate = 1;

        // --- 更新图像显示区域边框颜色的函数 ---
        function updateDisplayBorderColor(color) {
            if (imageDisplayArea) {
                const hex = color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                imageDisplayArea.style.borderColor = brightness < 80 ? '#f0ad4e' : color;
            }
        }

        // 初始化当前激活的颜色球 (如果当前颜色与某个颜色球匹配)
        function updateActiveColorBall(currentColor) {
            quickColorBalls.forEach(ball => {
                ball.classList.remove('active');
                if (ball.dataset.color.toLowerCase() === currentColor.toLowerCase()) {
                    ball.classList.add('active');
                }
            });
        }
        updateActiveColorBall(colorPicker.value);
        updateDisplayBorderColor(colorPicker.value); // 初始化边框颜色

        canvas.on('path:created', (e) => {
            const path = e.path;
            canvas.remove(path); // 移除临时 Fabric.js 路径，因为我们要存储原始图像坐标
            
            // 重新思考坐标转换：我们需要确保保存的是相对于原始图像的正确坐标
            // 关键点：Fabric.js 的 path 对象已经包含了考虑当前视图变换的坐标
            // 我们不需要再次应用复杂的变换，只需将其转换回原始图像尺寸即可
            
            // 这里简化坐标转换逻辑，直接从路径对象获取正确的坐标
            const scaledPathPoints = path.path.map(p => {
                // 确保我们只处理有效的路径点
                if (p.length < 3 || typeof p[1] !== 'number' || typeof p[2] !== 'number') {
                    return [0, 0]; // 提供默认值以避免错误
                }
                
                // 简单直接的转换：从画布显示坐标转换回原始图像坐标
                // 这应该已经考虑了视图变换，因为path对象是在当前视图状态下创建的
                const originalX = p[1] / initialDisplayScale;
                const originalY = p[2] / initialDisplayScale;
                
                // 确保坐标值合理，避免极端情况
                const clampedX = Math.max(0, Math.min(img.naturalWidth, originalX));
                const clampedY = Math.max(0, Math.min(img.naturalHeight, originalY));
                
                return [clampedX, clampedY];
            }).filter(p => p[0] !== 0 || p[1] !== 0); // 过滤掉无效点
            
            // 确保路径数据完整
            if (scaledPathPoints.length > 0) {
                const pathData = { 
                    points: scaledPathPoints, 
                    color: path.stroke || '#ff0000', 
                    width: Math.max(0.1, path.strokeWidth / initialDisplayScale), 
                    isFill: false,
                    isEraser: (drawingMode === 'eraser') // 添加isEraser标志
                };
                drawPaths.push(pathData);
                // 在这里保存状态，而不是在其他地方重复保存
                saveStateForUndo();
                renderAllDrawings(); // 重新渲染所有绘制，包括新路径
            }
        });
        
        canvas.on('mouse:wheel', function(opt) { 
            if (isHandToolMode) { // 抓手模式下，滚轮可以缩放（无需额外按Ctrl键）
                const delta = opt.e.deltaY; 
                let zoom = canvas.getZoom(); 
                // 保存当前画笔大小和模式
                const currentBrushWidth = canvas.freeDrawingBrush ? canvas.freeDrawingBrush.width : parseInt(brushSizeSlider.value);
                const currentBrushColor = canvas.freeDrawingBrush ? canvas.freeDrawingBrush.color : '#ff0000';
                
                zoom *= 0.999 ** delta; 
                // 限制缩放范围，防止过大或过小
                if (zoom > 20) zoom = 20; 
                if (zoom < 0.1) zoom = 0.1; // 允许缩小到更小比例
                
                canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom); 

                // MODIFICATION START: 缩放后更新预览大小
                updateBrushCursorPreview();
                // MODIFICATION END

                // 更彻底地重置画笔状态，确保它适应新的缩放
                if (canvas.freeDrawingBrush && (drawingMode === 'brush' || drawingMode === 'eraser')) {
                    // 临时关闭再重新打开画笔模式，强制重新初始化
                    canvas.isDrawingMode = false;
                    // 完全重置画笔属性
                    const opacityValue = parseInt(opacitySlider.value) / 100;
                    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
                    canvas.freeDrawingBrush.width = currentBrushWidth;
                    if (drawingMode === 'brush') {
                        canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, opacityValue);
                        canvas.freeDrawingBrush.globalCompositeOperation = 'source-over';
                    } else { // eraser
                        canvas.freeDrawingBrush.color = 'rgba(0,0,0,1)';
                        canvas.freeDrawingBrush.globalCompositeOperation = 'destination-out';
                    }
                    canvas.freeDrawingBrush.strokeLineJoin = 'round';
                    canvas.freeDrawingBrush.strokeLineCap = 'round';
                    canvas.isDrawingMode = true;
                }
                
                opt.e.preventDefault(); 
                opt.e.stopPropagation(); 
            } else { // 不按Ctrl键时滚轮无效果
                // 不执行任何操作，仅阻止默认行为
                
                // 保留原始垂直平移功能的代码注释，如需恢复可以取消注释
                /*
                const vpt = this.viewportTransform;
                let newPositionY = vpt[5] - opt.e.deltaY;
                // 限制滚动范围，防止滚动出界
                const maxPositionX = (canvas.width * (canvas.getZoom() - 1)) / 2;
                const minPositionX = (canvas.width * (1 - canvas.getZoom())) / 2;;
                
                const maxPositionY = (canvas.height * (canvas.getZoom() - 1)) / 2;
                const minPositionY = (canvas.height * (1 - canvas.getZoom())) / 2;

                if (newPositionY > maxPositionY) newPositionY = maxPositionY;
                if (newPositionY < minPositionY) newPositionY = minPositionY;

                this.setViewportTransform([vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], newPositionY]);
                this.requestRenderAll();
                */
                opt.e.preventDefault();
                opt.e.stopPropagation();
            }
        });

        canvas.on('mouse:down', function(opt) {
            if (isHandToolMode) { // 抓手模式下，按下鼠标左键进行平移
                isPanning = true; 
                // 强制禁用画笔模式
                canvas.isDrawingMode = false;
                // 确保freeDrawingBrush也被禁用
                if (canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush = null;
                }
                lastPanPoint = new fabric.Point(opt.e.clientX, opt.e.clientY); 
                this.defaultCursor = 'grabbing'; 

                // MODIFICATION START: 更新光标/预览
                updateBrushCursorPreview();
                // MODIFICATION END

                return; 
            }
            if (drawingMode === 'imageStamp') {
                saveStateForUndo();
                const pointer = canvas.getPointer(opt.e);
                const scale = (parseInt(brushSizeSlider.value) / 50.0); // Scale from 0.02 to 2.0 based on slider
                imageStamps.push({ x: pointer.x / initialDisplayScale, y: pointer.y / initialDisplayScale, scale: scale }); // 存储原始坐标
                renderAllDrawings();
                return;
            }
            if (drawingMode !== 'brush') {
                isDrawingShape = true;
                shapeStartPoint = canvas.getPointer(opt.e);
                if (currentShape) canvas.remove(currentShape);
                const commonProps = { left: shapeStartPoint.x, top: shapeStartPoint.y, originX: 'left', originY: 'top', fill: isFillMode ? colorPicker.value : 'transparent', stroke: colorPicker.value, strokeWidth: parseInt(brushSizeSlider.value), selectable: false, evented: false, objectCaching: false, };
                const points = [{x: shapeStartPoint.x, y: shapeStartPoint.y}, {x: shapeStartPoint.x, y: shapeStartPoint.y}, {x: shapeStartPoint.x, y: shapeStartPoint.y}];
                
                if (drawingMode === 'rect' || drawingMode === 'mosaic') currentShape = new fabric.Rect({ ...commonProps, width: 0, height: 0, fill: drawingMode === 'mosaic' ? 'rgba(128,128,128,0.5)' : commonProps.fill });
                else if (drawingMode === 'circle') currentShape = new fabric.Ellipse({ ...commonProps, rx: 0, ry: 0 });
                else if (['triangle', 'htriangle', 'arrow', 'star', 'heart'].includes(drawingMode)) currentShape = new fabric.Polygon(points, { ...commonProps });
                
                if (currentShape) canvas.add(currentShape);
            }
        });
        canvas.on('mouse:move', function(opt) {
            // 检查是否在抓手模式下
            if (isHandToolMode) {
                // 在抓手模式下，显示合适的光标
                if (isPanning) {
                    this.defaultCursor = 'grabbing';
                } else {
                    this.defaultCursor = 'grab';
                }
            }
            
            updateBrushCursorPreview(opt.e);

            // 只有在isPanning为true时才进行平移，确保需要按住鼠标左键
            if (isPanning) { 
                // 仍然检查Ctrl键状态，确保在平移过程中必须按住Ctrl键
                if (!opt.e.ctrlKey) {
                    // 如果在平移过程中释放了Ctrl键，退出平移模式
                    isPanning = false;
                    isHandToolMode = false;
                    // 恢复画笔模式
                    if (drawingMode === 'brush') {
                        canvas.isDrawingMode = true;
                        if (!canvas.freeDrawingBrush) {
                            const opacityValue = parseInt(opacitySlider.value) / 100;
                            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
                            canvas.freeDrawingBrush.width = parseInt(brushSizeSlider.value);
                            canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, opacityValue);
                            canvas.freeDrawingBrush.strokeLineJoin = 'round';
                            canvas.freeDrawingBrush.strokeLineCap = 'round';
                        }
                    }
                    this.defaultCursor = 'crosshair';
                    return;
                }
                
                const currentPoint = new fabric.Point(opt.e.clientX, opt.e.clientY); 
                const delta = currentPoint.subtract(lastPanPoint); 
                this.relativePan(delta); 
                lastPanPoint = currentPoint; 
                return; 
            }

            if (!isDrawingShape || !currentShape) return;
            const pointer = canvas.getPointer(opt.e);
            switch(drawingMode) {
                case 'rect': case 'mosaic': currentShape.set({ width: pointer.x - shapeStartPoint.x, height: pointer.y - shapeStartPoint.y }); break;
                case 'circle': currentShape.set({ rx: Math.abs(pointer.x - shapeStartPoint.x) / 2, ry: Math.abs(pointer.y - shapeStartPoint.y) / 2, originX: 'center', originY: 'center', left: shapeStartPoint.x + (pointer.x - shapeStartPoint.x) / 2, top: shapeStartPoint.y + (pointer.y - shapeStartPoint.y) / 2 }); break;
                case 'triangle': currentShape.points[1].x = pointer.x; currentShape.points[1].y = pointer.y; currentShape.points[2].x = shapeStartPoint.x - (pointer.x - shapeStartPoint.x); currentShape.points[2].y = pointer.y; break;
                case 'htriangle': currentShape.points[1].x = pointer.x; currentShape.points[1].y = pointer.y; currentShape.points[2].x = pointer.x; currentShape.points[2].y = shapeStartPoint.y - (pointer.y - shapeStartPoint.y); break;
                case 'arrow':
                    const x1 = shapeStartPoint.x, y1 = shapeStartPoint.y, x2 = pointer.x, y2 = pointer.y; const dx = x2 - x1, dy = y2 - y1; const angle = Math.atan2(dy, dx); const length = Math.sqrt(dx*dx + dy*dy); if (length < 5) break;
                    const headLength = Math.min(length * 0.2, 20); const headAngle = Math.PI / 6;
                    const p_head_base_x = x2 - headLength * Math.cos(angle); const p_head_base_y = y2 - headLength * Math.sin(angle); const p_wing1 = { x: x2 - headLength * Math.cos(angle - headAngle), y: y2 - headLength * Math.sin(angle - headAngle) }; const p_wing2 = { x: x2 - headLength * Math.cos(angle + headAngle), y: y2 - headLength * Math.sin(angle + headAngle) };
                    currentShape.points = [ {x:x1, y:y1}, {x: p_head_base_x, y: p_head_base_y}, p_wing1, {x:x2, y:y2}, p_wing2, {x: p_head_base_x, y: p_head_base_y} ];
                    break;
                case 'star': case 'heart':
                    const w = Math.abs(pointer.x - shapeStartPoint.x); const h = Math.abs(pointer.y - shapeStartPoint.y); if (w < 2 || h < 2) break;
                    const cx = shapeStartPoint.x + w / 2 * Math.sign(pointer.x - shapeStartPoint.x); const cy = shapeStartPoint.y + h / 2 * Math.sign(pointer.y - shapeStartPoint.y); let points = [];
                    if (drawingMode === 'star') {
                        const outerRadius = Math.min(w, h) / 2; const innerRadius = outerRadius * 0.4;
                        for (let i = 0; i < 10; i++) { const radius = (i % 2 === 0) ? outerRadius : innerRadius; const ang = i * Math.PI / 5; points.push({ x: cx + radius * Math.sin(ang), y: cy - radius * Math.cos(ang) }); }
                    } else { const numPoints = 30; for (let i = 0; i < numPoints; i++) { const t = (i / (numPoints - 1)) * 2 * Math.PI; const hx = 0.5 * w * 1.1 * Math.pow(Math.sin(t), 3); const hy = -h * ( (13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t)) / 22 ); points.push({ x: cx + hx, y: cy + hy }); } }
                    currentShape.points = points;
                    break;
            }
            canvas.requestRenderAll();
        });
        canvas.on('mouse:up', function() {
            if (isPanning) { 
                isPanning = false; 
                // 完整恢复画笔模式和属性，但仅在Ctrl键未按下时
                if ((drawingMode === 'brush' || drawingMode === 'eraser') && !isCtrlKeyPressed) {
                    canvas.isDrawingMode = true;
                    // 重新创建画笔对象，确保画笔功能完全恢复
                    if (!canvas.freeDrawingBrush) {
                        const opacityValue = parseInt(opacitySlider.value) / 100;
                        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
                        canvas.freeDrawingBrush.width = parseInt(brushSizeSlider.value);
                        if (drawingMode === 'brush') {
                            canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, opacityValue);
                            canvas.freeDrawingBrush.globalCompositeOperation = 'source-over';
                        } else { // eraser
                            canvas.freeDrawingBrush.color = 'rgba(0,0,0,1)';
                            canvas.freeDrawingBrush.globalCompositeOperation = 'destination-out';
                        }
                        canvas.freeDrawingBrush.strokeLineJoin = 'round';
                        canvas.freeDrawingBrush.strokeLineCap = 'round';
                    }
                } else {
                    canvas.isDrawingMode = false;
                }
                // 只有在Ctrl键未按下时才恢复为十字光标
                this.defaultCursor = isCtrlKeyPressed ? 'grab' : 'crosshair'; 
                // MODIFICATION START: 停止平移后更新光标/预览
                updateBrushCursorPreview();
                // MODIFICATION END
                return; 
            }
            if (isDrawingShape && currentShape) {
                isDrawingShape = false;
                // 先存储路径数据，然后再保存状态
                if (drawingMode === 'mosaic') {
                    mosaicRects.push({ 
                        x: currentShape.left / initialDisplayScale, 
                        y: currentShape.top / initialDisplayScale, 
                        w: currentShape.width / initialDisplayScale, 
                        h: currentShape.height / initialDisplayScale, 
                        pixelSize: parseInt(brushSizeSlider.value) 
                    });
                } else {
                    let pathData = { points: [], color: currentShape.stroke, width: currentShape.strokeWidth, isFill: isFillMode, isEraser: (drawingMode === 'eraser') }; // 添加isEraser标志
                    if (drawingMode === 'rect') { 
                        pathData.points = [ 
                            [currentShape.left, currentShape.top], 
                            [currentShape.left + currentShape.width, currentShape.top], 
                            [currentShape.left + currentShape.width, currentShape.top + currentShape.height], 
                            [currentShape.left, currentShape.top + currentShape.height], 
                            [currentShape.left, currentShape.top]
                        ].map(p => [ 
                            (p[0] / initialDisplayScale), 
                            (p[1] / initialDisplayScale)
                        ]);
                    }
                    else if (['triangle', 'htriangle', 'arrow', 'star', 'heart'].includes(drawingMode)) { 
                        pathData.points = currentShape.points.map(p => [p.x / initialDisplayScale, p.y / initialDisplayScale]); 
                        if (drawingMode !== 'arrow') pathData.points.push([currentShape.points[0].x / initialDisplayScale, currentShape.points[0].y / initialDisplayScale]); 
                    } 
                    else if (drawingMode === 'circle') { 
                        const { rx, ry, left: cx, top: cy } = currentShape; 
                        const numPoints = 36; 
                        for (let i = 0; i < numPoints; i++) { 
                            const angle = (i / numPoints) * 2 * Math.PI; 
                            pathData.points.push([ 
                                (cx + rx * Math.cos(angle)) / initialDisplayScale, 
                                (cy + ry * Math.sin(angle)) / initialDisplayScale 
                            ]); 
                        } 
                        pathData.points.push(pathData.points[0]); 
                    }
                    if (pathData.points.length > 1) drawPaths.push(pathData);
                }
                saveStateForUndo(); // 现在才保存状态，确保包含最新绘制的数据
                canvas.remove(currentShape); currentShape = null;
                renderAllDrawings();
            }
        });

        // MODIFICATION START: 添加 mouse:over 和 mouse:out 事件
        canvas.on('mouse:over', function(opt) {
            updateBrushCursorPreview(opt.e);
        });

        canvas.on('mouse:out', function() {
            if (brushPreview) {
                brushPreview.style.display = 'none';
            }
        });
        // MODIFICATION END

        modal.querySelector('#zml-undo-paint-btn').onclick = () => { 
            if (undoStack.length > 1) { 
                // 一次性完成撤销操作，避免中间状态被显示
                const previousState = undoStack[undoStack.length - 2];
                
                // 复制一份完整的状态，确保状态一致性
                const stateToRestore = {
                    paths: JSON.parse(JSON.stringify(previousState.paths)),
                    mosaics: JSON.parse(JSON.stringify(previousState.mosaics)),
                    stamps: JSON.parse(JSON.stringify(previousState.stamps))
                };
                
                // 移除当前状态
                undoStack.pop();
                
                // 恢复到上一个状态
                restoreState(stateToRestore);
            }
        };
        modal.querySelector('#zml-clear-paint-btn').onclick = () => { saveStateForUndo(); drawPaths = []; mosaicRects = []; imageStamps = []; renderAllDrawings(); };
        colorPicker.onchange = (e) => { // 当主颜色选择器改变时
            const newColor = e.target.value;
            const opacityValue = parseInt(opacitySlider.value) / 100;
            canvas.freeDrawingBrush.color = hexToRgba(newColor, opacityValue);
            updateActiveColorBall(newColor); // 更新颜色球的激活状态
            updateDisplayBorderColor(newColor); // 更新图像显示区域的边框颜色
            // MODIFICATION START: 更新预览
            updateBrushCursorPreview(e);
            // MODIFICATION END
        };
        brushSizeSlider.oninput = (e) => { canvas.freeDrawingBrush.width = parseInt(e.target.value); updateBrushCursorPreview(); };
        // 不透明度滑块事件监听
        opacitySlider.oninput = (e) => {
            const opacityValue = parseInt(e.target.value) / 100; // 将0-100转换为0-1
            if (canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.color = hexToRgba(colorPicker.value, opacityValue);
            }
        };
        quickColorBalls.forEach(ball => { // 为每个颜色球添加点击事件
            ball.onclick = () => {
                const selectedColor = ball.dataset.color;
                const opacityValue = parseInt(opacitySlider.value) / 100;
                colorPicker.value = selectedColor; // 更新主颜色选择器
                canvas.freeDrawingBrush.color = hexToRgba(selectedColor, opacityValue); // 更新画笔颜色
                updateActiveColorBall(selectedColor); // 更新颜色球的激活状态
                updateDisplayBorderColor(selectedColor); // 更新图像显示区域的边框颜色
                // MODIFICATION START: 更新预览
                updateBrushCursorPreview();
                // MODIFICATION END
            };
        });

        // 添加键盘事件监听器以支持Ctrl+z撤销操作
        function handleKeyDown(e) {
            // 只有在模态框打开时才处理快捷键
            if (document.body.contains(modal) && (e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault(); // 阻止默认浏览器行为
                // 与撤销按钮使用相同的优化撤销逻辑
                if (undoStack.length > 1) {
                    const previousState = undoStack[undoStack.length - 2];
                    
                    // 复制一份完整的状态，确保状态一致性
                    const stateToRestore = {
                        paths: JSON.parse(JSON.stringify(previousState.paths)),
                        mosaics: JSON.parse(JSON.stringify(previousState.mosaics)),
                        stamps: JSON.parse(JSON.stringify(previousState.stamps))
                    };
                    
                    // 移除当前状态
                    undoStack.pop();
                    
                    // 恢复到上一个状态
                    restoreState(stateToRestore);
                }
            }
        }
        
        // 在模态框打开时添加事件监听器
        document.addEventListener('keydown', handleKeyDown);
        
        // 确保在模态框关闭时移除事件监听器，防止内存泄漏
        const originalCloseModal = closeModal;
        closeModal = function(modalElement) {
            // 保存当前窗口尺寸到缓存
            if (enableAdaptiveAnimation && modalElement === modal) {
                zml_painter_size_cache[cacheKey] = {
                    modalWidth: modalContent.offsetWidth,
                    modalHeight: modalContent.offsetHeight,
                    initialDisplayScale: initialDisplayScale
                };
            }
            document.removeEventListener('keydown', handleKeyDown);
            originalCloseModal(modalElement);
        };

        modal.querySelector('#zml-confirm-paint-btn').onclick = () => {
            widget.data.value = JSON.stringify({ draw_paths: drawPaths, mosaic_rects: mosaicRects, image_stamps: imageStamps });
            node.onWidgetValue_changed?.(widget.data, widget.data.value);
            closeModal(modal);
        };
        modal.querySelector('#zml-cancel-paint-btn').onclick = () => closeModal(modal);
    });
}


// ======================= ZML_ColorPicker 节点 (已修正) =======================
app.registerExtension({
    name: "ZML.ColorPicker",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_ColorPicker") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                const node = this;
                const widget = {
                    data: this.widgets.find(w => w.name === "颜色代码"),
                };
                this.addWidget("button", "选择颜色", null, () => showColorPickerModal(node, widget));
            };
        }
    },
});

function showColorPickerModal(node, widget) {
    const modalHtml = `
        <div class="zml-modal" id="zml-color-picker-modal">
            <div class="zml-modal-content" style="max-width: 400px; padding: 20px;">
                <style>
                    .zml-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1001; }
                    .zml-modal-content { background: #222; padding: 20px; border-radius: 8px; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; gap: 10px; }
                    .zml-color-controls { display: flex; flex-direction: column; gap: 15px; align-items: center; }
                    .zml-color-picker-input { width: 100px; height: 100px; border: none; padding: 0; background: none; cursor: pointer; }
                    .zml-editor-btn { padding: 8px 12px; color: white; border: none; border-radius: 4px; cursor: pointer; }
                    .zml-output-preview { font-family: monospace; font-size: 14px; text-align: center; color: white; background-color: #333; padding: 5px; border-radius: 4px; }
                    .zml-button-group { display: flex; justify-content: center; width: 100%; gap: 10px; }
                </style>
                <div class="zml-color-controls">
                    <label for="zml-color-picker-input" style="color: white; font-size: 16px;">选择颜色:</label>
                    <input type="color" id="zml-color-picker-input" class="zml-color-picker-input" value="${widget.data.value || '#FFFFFF'}">
                    <div id="zml-output-preview" class="zml-output-preview">${widget.data.value || '#FFFFFF'}</div>
                    <div class="zml-button-group">
                        <button id="zml-eyedropper-btn" class="zml-editor-btn" style="background-color: #5bc0de;">吸管</button>
                        <button id="zml-confirm-color-btn" class="zml-editor-btn" style="background-color: #4CAF50;">确认</button>
                        <button id="zml-cancel-color-btn" class="zml-editor-btn" style="background-color: #f44336;">取消</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const modal = createModal(modalHtml);
    const colorInput = modal.querySelector('#zml-color-picker-input');
    const confirmBtn = modal.querySelector('#zml-confirm-color-btn');
    const cancelBtn = modal.querySelector('#zml-cancel-color-btn');
    const outputPreview = modal.querySelector('#zml-output-preview');
    const eyedropperBtn = modal.querySelector('#zml-eyedropper-btn');

    if (!window.EyeDropper) {
        eyedropperBtn.textContent = "浏览器不支持吸管";
        eyedropperBtn.disabled = true;
    } else {
        eyedropperBtn.onclick = async () => {
            const eyeDropper = new EyeDropper();
            try {
                modal.style.display = 'none';
                const result = await eyeDropper.open();
                const selectedColor = result.sRGBHex.toUpperCase();
                colorInput.value = selectedColor;
                outputPreview.textContent = selectedColor;
            } catch (e) { console.log("吸管工具已取消。"); } 
            finally { modal.style.display = 'flex'; }
        };
    }

    colorInput.oninput = (e) => { outputPreview.textContent = e.target.value.toUpperCase(); };
    confirmBtn.onclick = () => {
        widget.data.value = colorInput.value.toUpperCase();
        if (node.onWidgetValue_changed) { node.onWidgetValue_changed(widget.data.name, widget.data.value); }
        closeModal(modal);
    };
    cancelBtn.onclick = () => { closeModal(modal); };
}
