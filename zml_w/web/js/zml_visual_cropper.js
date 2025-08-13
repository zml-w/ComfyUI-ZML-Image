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

    const imageUrl = upstreamNode.imgs[0].src;
    let initialDisplayScale = 1.0;

    const modalHtml = `
        <div class="zml-modal">
            <div class="zml-modal-content" style="width: auto; height: auto;">
                <style>
                    .zml-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1001; }
                    .zml-modal-content { background: #222; padding: 20px; border-radius: 8px; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; gap: 10px; }
                    .zml-editor-main { overflow: hidden; background: #111; position: relative; }
                    .zml-editor-tip { color: #ccc; text-align: center; font-size: 12px; margin: 5px 0; }
                    .zml-editor-controls { display: flex; justify-content: space-around; align-items: center; flex-wrap: wrap; gap: 10px;}
                    .zml-editor-btn { padding: 8px 12px; color: white; border: none; border-radius: 4px; cursor: pointer; }
                    #zml-color-picker { width: 40px; height: 30px; border: none; padding: 0; cursor: pointer; }
                    #zml-brush-size { width: 80px; }
                </style>
                <div class="zml-editor-main" id="zml-editor-main-container">
                    <canvas id="zml-fabric-canvas"></canvas>
                </div>
                <p id="zml-editor-tip" class="zml-editor-tip">滚轮缩放, 按住Ctrl+左键拖拽平移。画笔模式：按住鼠标左键绘制。</p>
                <div id="zml-editor-controls" class="zml-editor-controls">
                    <label for="zml-color-picker" style="color: white;">颜色:</label>
                    <input type="color" id="zml-color-picker" value="#FF0000">
                    <label for="zml-brush-size" style="color: white;">大小:</label>
                    <input type="range" id="zml-brush-size" min="1" max="50" value="5">
                    <button id="zml-reset-view-btn" class="zml-editor-btn" style="background-color: #888;">重置视角</button> 
                    <button id="zml-undo-paint-btn" class="zml-editor-btn" style="background-color: #f0ad4e;">撤销</button>
                    <button id="zml-clear-paint-btn" class="zml-editor-btn" style="background-color: #5bc0de;">清空</button>
                    <button id="zml-confirm-paint-btn" class="zml-editor-btn" style="background-color: #4CAF50;">确认</button>
                    <button id="zml-cancel-paint-btn" class="zml-editor-btn" style="background-color: #f44336;">取消</button>
                </div>
            </div>
        </div>
    `;

    const modal = createModal(modalHtml);
    const mainContainer = modal.querySelector('#zml-editor-main-container');
    const colorPicker = modal.querySelector('#zml-color-picker');
    const brushSizeSlider = modal.querySelector('#zml-brush-size');

    let drawPaths = [];

    loadScript('/extensions/ComfyUI-ZML-Image/lib/fabric.min.js').then(() => {
        const canvas = new fabric.Canvas(mainContainer.querySelector('canvas'), { stopContextMenu: true });
        let isPanning = false, lastPanPoint = null;

        const img = new Image();
        img.src = imageUrl;
        img.onload = () => {
            const V_PADDING = 150; const H_PADDING = 80;
            const maxWidth = window.innerWidth - H_PADDING;
            const maxHeight = window.innerHeight - V_PADDING;

            initialDisplayScale = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);

            const displayWidth = img.naturalWidth * initialDisplayScale;
            const displayHeight = img.naturalHeight * initialDisplayScale;

            mainContainer.style.width = `${displayWidth}px`;
            mainContainer.style.height = `${displayHeight}px`;

            canvas.setWidth(img.naturalWidth);
            canvas.setHeight(img.naturalHeight);

            fabric.Image.fromURL(imageUrl, (fImg) => {
                canvas.setBackgroundImage(fImg, canvas.renderAll.bind(canvas));
            });

            const resetView = () => {
                canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
                canvas.setZoom(initialDisplayScale);
                const vpt = canvas.viewportTransform;
                vpt[4] = (displayWidth - img.naturalWidth * initialDisplayScale) / 2;
                vpt[5] = (displayHeight - img.naturalHeight * initialDisplayScale) / 2;
                canvas.requestRenderAll();
            };
            resetView();

            try {
                const existingPaintData = JSON.parse(widget.data.value);
                if (existingPaintData && existingPaintData.draw_paths) {
                    drawPaths = existingPaintData.draw_paths;
                    renderExistingPaths();
                }
            } catch (e) { /* ignore */ }

            modal.querySelector('#zml-reset-view-btn').onclick = resetView;
        };

        const renderExistingPaths = () => {
             canvas.remove(...canvas.getObjects().filter(o => o.isNotBackground));
             drawPaths.forEach(pathData => {
                if (pathData.points.length > 1) {
                     const pathString = "M " + pathData.points.map(p => `${p[0]},${p[1]}`).join(" L ");
                     const fabricPath = new fabric.Path(pathString, { stroke: pathData.color, strokeWidth: pathData.width, fill: null, selectable: false, evented: false, objectCaching: false, strokeLineJoin: 'round', strokeLineCap: 'round', isNotBackground: true });
                     canvas.add(fabricPath);
                } else if(pathData.points.length === 1 ) {
                     const dot = new fabric.Circle({ left: pathData.points[0][0], top: pathData.points[0][1], radius: pathData.width / 2, fill: pathData.color, selectable: false, evented: false, objectCaching: false, originX: 'center', originY: 'center', isNotBackground: true });
                     canvas.add(dot);
                }
            });
            canvas.requestRenderAll();
        };

        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = colorPicker.value;
        canvas.freeDrawingBrush.width = parseInt(brushSizeSlider.value);
        canvas.freeDrawingBrush.decimate = 5;

        canvas.on('path:created', (e) => {
            const path = e.path;
            canvas.remove(path);
            const pathData = { points: path.path.map(p => [p[1], p[2]]), color: path.stroke, width: path.strokeWidth};
            drawPaths.push(pathData);
            renderExistingPaths();
        });

        canvas.on('mouse:wheel', function(opt) {
            const delta = opt.e.deltaY;
            let zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;

            if (zoom > 20) zoom = 20;

            if (zoom < initialDisplayScale) {
                zoom = initialDisplayScale;
            }

            canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        canvas.on('mouse:down', function(opt) {
            if (opt.e.ctrlKey) {
                isPanning = true;
                canvas.isDrawingMode = false;
                lastPanPoint = new fabric.Point(opt.e.clientX, opt.e.clientY);
                this.defaultCursor = 'grab';
            }
        });

        canvas.on('mouse:move', function(opt) {
            if (isPanning) {
                this.defaultCursor = 'grabbing';
                const currentPoint = new fabric.Point(opt.e.clientX, opt.e.clientY);
                const delta = currentPoint.subtract(lastPanPoint);
                this.relativePan(delta);
                lastPanPoint = currentPoint;
            }
        });

        canvas.on('mouse:up', function() {
            if (isPanning) {
                isPanning = false;
                canvas.isDrawingMode = true;
                this.defaultCursor = 'crosshair';
            }
        });

        modal.querySelector('#zml-undo-paint-btn').onclick = () => { 
            if(drawPaths.length > 0) { 
                drawPaths.pop();
                renderExistingPaths();
            } 
        };

        modal.querySelector('#zml-clear-paint-btn').onclick = () => { 
            drawPaths = []; 
            renderExistingPaths();
        };

        colorPicker.onchange = (e) => { canvas.freeDrawingBrush.color = e.target.value; };
        brushSizeSlider.oninput = (e) => { canvas.freeDrawingBrush.width = parseInt(e.target.value); };

        modal.querySelector('#zml-confirm-paint-btn').onclick = () => {
            widget.data.value = JSON.stringify({ draw_paths: drawPaths });
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
