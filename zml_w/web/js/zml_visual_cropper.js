import { app } from "../../../scripts/app.js";

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

function setupCropper(mainContainer, controlsContainer, widgets, imageUrl, node, modal) {
    const cropperUrl = '/extensions/ComfyUI-ZML-Image/lib/cropper.min.js';
    const cropperCss = document.createElement('link');
    cropperCss.rel = 'stylesheet';
    cropperCss.href = '/extensions/ComfyUI-ZML-Image/lib/cropper.min.css';
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
    const fabricUrl = '/extensions/ComfyUI-ZML-Image/lib/fabric.min.js';
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

    loadScript('/extensions/ComfyUI-ZML-Image/lib/fabric.min.js').then(() => {
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
    if (!upstreamNode || !upstreamNode.imgs || upstreamNode.imgs.length === 0) {
        alert("请先连接一个有预览图的图像节点！");
        return;
    }

    // 检查画笔图像输入
    const brushInput = node.inputs.find(i => i.name === "画笔图像");
    let hasBrushImage = false;
    if (brushInput && brushInput.link) {
        const upstreamBrushNode = node.getInputNode(node.inputs.indexOf(brushInput));
        if (upstreamBrushNode && upstreamBrushNode.imgs && upstreamBrushNode.imgs.length > 0) {
            hasBrushImage = true;
        }
    }

    const imageUrl = upstreamNode.imgs[0].src;
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

                    /* 侧边功能面板基类 */
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
                        display: flex; flex-direction: column; gap: 7px;
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
                
                <!-- 左侧快速颜色球 -->
                <div class="zml-side-panel">
                    <div class="zml-quick-colors">
                        <button class="zml-color-ball" data-color="#FFFFFF" style="background-color: #FFFFFF;" title="白色"></button>
                        <button class="zml-color-ball" data-color="#000000" style="background-color: #000000;" title="黑色"></button>
                        <button class="zml-color-ball" data-color="#FF0000" style="background-color: #FF0000;" title="红色"></button>
                        <button class="zml-color-ball" data-color="#00FF00" style="background-color: #00FF00;" title="绿色"></button>
                        <button class="zml-color-ball" data-color="#0000FF" style="background-color: #0000FF;" title="蓝色"></button>
                        <button class="zml-color-ball" data-color="#FFFF00" style="background-color: #FFFF00;" title="黄色"></button>
                    </div>
                </div>

                <!-- 中间主内容区 -->
                <div class="zml-main-content-area">
                    <div class="zml-editor-main" id="zml-editor-main-container">
                        <canvas id="zml-fabric-canvas" class="zml-hidden-canvas"></canvas>
                    </div>
                    <p id="zml-editor-tip" class="zml-editor-tip">滚轮缩放, 按住Ctrl+左键拖拽平移。画笔模式：按住鼠标左键绘制。</p>
                    
                    <div id="zml-painter-bottom-panel" class="zml-painter-bottom-panel">
                        <div class="zml-control-group">
                            <label for="zml-color-picker" class="zml-control-label">颜色:</label>
                            <input type="color" id="zml-color-picker" class="zml-styled-input" value="#FF0000">
                        </div>
                        <div class="zml-control-group">
                            <label for="zml-brush-size" class="zml-control-label">大小:</label>
                            <input type="range" id="zml-brush-size" class="zml-styled-input" min="1" max="100" value="10">
                        </div>
                        <div class="zml-control-group zml-action-buttons">
                            <button id="zml-reset-view-btn" class="zml-editor-btn zml-option-btn">重置视角</button> 
                            <button id="zml-undo-paint-btn" class="zml-editor-btn zml-option-btn">撤销</button>
                            <button id="zml-clear-paint-btn" class="zml-editor-btn zml-option-btn">清空</button>
                            <button id="zml-confirm-paint-btn" class="zml-editor-btn zml-confirm-btn">确认</button>
                            <button id="zml-cancel-paint-btn" class="zml-editor-btn zml-cancel-btn">取消</button>
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
    const quickColorBalls = modal.querySelectorAll('.zml-color-ball');
    const bottomPanel = modal.querySelector('#zml-painter-bottom-panel');
    const tipElement = modal.querySelector('#zml-editor-tip');


    loadScript('/extensions/ComfyUI-ZML-Image/lib/fabric.min.js').then(() => {
        // Initialize canvas
        const canvas = new fabric.Canvas(canvasElement, { stopContextMenu: true });
        let isPanning = false, lastPanPoint = null;
        
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
        const imageStampBtn = modal.querySelector('#zml-image-stamp-tool');
        const arrowBtn = modal.querySelector('#zml-arrow-tool');
        const fillBtn = modal.querySelector('#zml-fill-tool');
        const toolBtns = [brushBtn, rectBtn, triangleBtn, htriangleBtn, circleBtn, starBtn, heartBtn, mosaicBtn, imageStampBtn, arrowBtn];

        // --- Window Dragging Logic ---
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let currentTranslate = { x: 0, y: 0 };
        moveBtn.addEventListener('mousedown', (e) => { isDragging = true; dragStart.x = e.clientX; dragStart.y = e.clientY; moveBtn.style.cursor = 'grabbing'; e.preventDefault(); });
        window.addEventListener('mousemove', (e) => { if (!isDragging) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; modalContent.style.transform = `translate(${currentTranslate.x + dx}px, ${currentTranslate.y + dy}px)`; });
        window.addEventListener('mouseup', (e) => { if (!isDragging) return; isDragging = false; moveBtn.style.cursor = 'pointer'; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; currentTranslate.x += dx; currentTranslate.y += dy; });

        // --- Tool Selection Logic ---
        function setActiveTool(activeBtn) {
            toolBtns.forEach(btn => btn.classList.remove('active'));
            if(activeBtn) activeBtn.classList.add('active');
            const modeMap = {
                'zml-brush-tool': 'brush', 'zml-rect-tool': 'rect', 'zml-triangle-tool': 'triangle',
                'zml-htriangle-tool': 'htriangle', 'zml-circle-tool': 'circle', 'zml-star-tool': 'star',
                'zml-heart-tool': 'heart', 'zml-arrow-tool': 'arrow', 'zml-mosaic-tool': 'mosaic', 'zml-image-stamp-tool': 'imageStamp'
            };
            drawingMode = modeMap[activeBtn.id] || 'brush';
            canvas.isDrawingMode = (drawingMode === 'brush');
            let tipText = `滚轮缩放, 按住Ctrl+左键拖拽平移。当前模式：${activeBtn.title}。`;
            if (drawingMode === 'imageStamp') tipText += " “大小”滑块可控制图章缩放。";
            if (drawingMode === 'mosaic') tipText += " “大小”滑块可控制像素颗粒度。";
            tipElement.textContent = tipText;
        }
        toolBtns.forEach(btn => btn.onclick = () => setActiveTool(btn));
        fillBtn.onclick = () => { isFillMode = !isFillMode; fillBtn.classList.toggle('active', isFillMode); };

        // --- Undo/Redo and Data Management ---
        function saveStateForUndo() {
            undoStack.push({
                paths: JSON.parse(JSON.stringify(drawPaths)),
                mosaics: JSON.parse(JSON.stringify(mosaicRects)),
                stamps: JSON.parse(JSON.stringify(imageStamps))
            });
        }
        function restoreState(state) {
            drawPaths = state.paths;
            mosaicRects = state.mosaics;
            imageStamps = state.stamps;
            renderAllDrawings();
        }

        const img = new Image();
        img.src = imageUrl;
        
        const setupCanvasAndImage = () => {
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
                const existingData = JSON.parse(widget.data.value);
                drawPaths = existingData.draw_paths || [];
                mosaicRects = existingData.mosaic_rects || [];
                imageStamps = existingData.image_stamps || [];
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

        // 为了响应窗口大小变化 (可选但推荐)
        const resizeObserver = new ResizeObserver(() => {
            if (modal.isConnected) { // 确保模态框仍然在DOM中
                setupCanvasAndImage(); // 重新计算并设置尺寸
                canvas.renderAll(); // 重新渲染以适应新尺寸
            } else {
                resizeObserver.disconnect(); // 如果模态框已关闭，断开Observer
            }
        });
        resizeObserver.observe(modalContent); // 监听模态框内容区尺寸变化

        
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
                // 确保路径点的坐标也按当前 initialDisplayScale 缩放
                const scaledPathPoints = pathData.points.map(p => `${p[0] * initialDisplayScale},${p[1] * initialDisplayScale}`);
                const pathString = "M " + scaledPathPoints.join(" L ");
                const fabricPath = new fabric.Path(pathString, { 
                    stroke: pathData.color, 
                    strokeWidth: pathData.width, 
                    fill: isFill ? pathData.color : null, 
                    selectable: false, evented: false, objectCaching: false, 
                    strokeLineJoin: 'round', strokeLineCap: 'round', isNotBackground: true 
                });
                canvas.add(fabricPath);
            });
            canvas.requestRenderAll();
        }

        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = colorPicker.value;
        canvas.freeDrawingBrush.width = parseInt(brushSizeSlider.value);
        canvas.freeDrawingBrush.decimate = 5;

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
            saveStateForUndo();
            const path = e.path;
            canvas.remove(path); // 移除临时 Fabric.js 路径，因为我们要存储原始坐标
            // 将 Fabric.js 路径点从当前画布坐标反向缩放回原始图像坐标
            const scaledPathPoints = path.path.map(p => [((p[1] - path.left) / canvas.getZoom() + path.left) / initialDisplayScale, ((p[2] - path.top) / canvas.getZoom() + path.top) / initialDisplayScale]);
            const pathData = { points: scaledPathPoints, color: path.stroke, width: path.strokeWidth, isFill: false};
            drawPaths.push(pathData);
            renderAllDrawings(); // 重新渲染所有绘制，包括新路径
        });
        
        canvas.on('mouse:wheel', function(opt) { 
            if (opt.e.ctrlKey) { // Ctrl + 滚轮实现缩放
                const delta = opt.e.deltaY; 
                let zoom = canvas.getZoom(); 
                zoom *= 0.999 ** delta; 
                // 限制缩放范围，防止过大或过小
                if (zoom > 20) zoom = 20; 
                if (zoom < 0.1) zoom = 0.1; // 允许缩小到更小比例
                
                canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom); 
                opt.e.preventDefault(); 
                opt.e.stopPropagation(); 
            } else { // 非Ctrl滚轮进行垂直滚动
                const vpt = this.viewportTransform;
                let newPositionY = vpt[5] - opt.e.deltaY;
                // 限制滚动范围，防止滚动出界
                const maxPositionX = (canvas.width * (canvas.getZoom() - 1)) / 2;
                const minPositionX = (canvas.width * (1 - canvas.getZoom())) / 2;;
                
                const maxPositionY = (canvas.height * (canvas.getZoom() - 1)) / 2;
                const minPositionY = (canvas.height * (1 - canvas.getZoom())) / 2;

                if (newPositionY > maxPositionY) newPositionY = maxPositionY;
                if (newPositionY < minPositionY) newPositionY = minPositionY;


                 // 可以根据需要调整，让画布内容保持在中心
                // const bounds = canvas.getCenterPoint();
                // canvas.viewportTransform[5] = bounds.y - newPositionY / canvas.getZoom(); // Rough vertical pan
                this.setViewportTransform([vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], newPositionY]);
                this.requestRenderAll();
                opt.e.preventDefault();
                opt.e.stopPropagation();
            }
        });

        canvas.on('mouse:down', function(opt) {
            if (opt.e.ctrlKey) { isPanning = true; canvas.isDrawingMode = false; lastPanPoint = new fabric.Point(opt.e.clientX, opt.e.clientY); this.defaultCursor = 'grab'; return; }
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
            if (isPanning) { this.defaultCursor = 'grabbing'; const currentPoint = new fabric.Point(opt.e.clientX, opt.e.clientY); const delta = currentPoint.subtract(lastPanPoint); this.relativePan(delta); lastPanPoint = currentPoint; return; }
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
            if (isPanning) { isPanning = false; canvas.isDrawingMode = (drawingMode === 'brush'); this.defaultCursor = 'crosshair'; return; }
            if (isDrawingShape && currentShape) {
                isDrawingShape = false;
                saveStateForUndo();
                // 存储原始坐标，反向缩放所有坐标
                if (drawingMode === 'mosaic') {
                    mosaicRects.push({ 
                        x: currentShape.left / initialDisplayScale, 
                        y: currentShape.top / initialDisplayScale, 
                        w: currentShape.width / initialDisplayScale, 
                        h: currentShape.height / initialDisplayScale, 
                        pixelSize: parseInt(brushSizeSlider.value) 
                    });
                } else {
                    let pathData = { points: [], color: currentShape.stroke, width: currentShape.strokeWidth, isFill: isFillMode };
                    if (drawingMode === 'rect') { 
                        pathData.points = [ 
                            [currentShape.left, currentShape.top], 
                            [currentShape.left + currentShape.width, currentShape.top], 
                            [currentShape.left + currentShape.width, currentShape.top + currentShape.height], 
                            [currentShape.left, currentShape.top + currentShape.height], 
                            [currentShape.left, currentShape.top]
                        ].map(p => [ // 将绘制后的点反向缩放
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
                canvas.remove(currentShape); currentShape = null;
                renderAllDrawings();
            }
        });

        modal.querySelector('#zml-undo-paint-btn').onclick = () => { if (undoStack.length > 1) { undoStack.pop(); restoreState(undoStack[undoStack.length - 1]); } };
        modal.querySelector('#zml-clear-paint-btn').onclick = () => { saveStateForUndo(); drawPaths = []; mosaicRects = []; imageStamps = []; renderAllDrawings(); };
        colorPicker.onchange = (e) => { // 当主颜色选择器改变时
            const newColor = e.target.value;
            canvas.freeDrawingBrush.color = newColor;
            updateActiveColorBall(newColor); // 更新颜色球的激活状态
            updateDisplayBorderColor(newColor); // 更新图像显示区域的边框颜色
        };
        brushSizeSlider.oninput = (e) => { canvas.freeDrawingBrush.width = parseInt(e.target.value); };

        quickColorBalls.forEach(ball => { // 为每个颜色球添加点击事件
            ball.onclick = () => {
                const selectedColor = ball.dataset.color;
                colorPicker.value = selectedColor; // 更新主颜色选择器
                canvas.freeDrawingBrush.color = selectedColor; // 更新画笔颜色
                updateActiveColorBall(selectedColor); // 更新颜色球的激活状态
                updateDisplayBorderColor(selectedColor); // 更新图像显示区域的边框颜色
            };
        });

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
