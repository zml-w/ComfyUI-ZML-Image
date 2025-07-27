// ComfyUI-ZML-Image/zml_w/js/zml_visual_cropper.js

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
    const cropperUrl = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js';
    const cropperCss = document.createElement('link');
    cropperCss.rel = 'stylesheet';
    cropperCss.href = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css';
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
            if (cropMode === '圆形') {
                cropperOptions.aspectRatio = 1;
                tipElement.textContent = "圆形模式：当前为等比例缩放。";
                cropperOptions.ready = function () {
                    const cropBox = this.cropper.cropper.querySelector('.cropper-crop-box');
                    const viewBox = this.cropper.cropper.querySelector('.cropper-view-box');
                    if (cropBox) cropBox.style.borderRadius = '50%';
                    if (viewBox) viewBox.style.borderRadius = '50%';
                };
            } else {
                tipElement.textContent = "提示：比例和分辨率选项禁用时，可自由缩放。";
                const { ratio, width, height } = widgets;
                let isFixedSize = false;
                if (ratio.value !== "禁用") {
                    const parts = ratio.value.split(':');
                    cropperOptions.aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                } else if (width.value > 0 && height.value > 0 && width.value <= image.naturalWidth && height.value <= image.naturalHeight) {
                    cropperOptions.aspectRatio = width.value / height.value;
                    cropperOptions.cropBoxResizable = false;
                    cropperOptions.dragMode = 'move';
                    isFixedSize = true;
                }
                if (isFixedSize) {
                    cropperOptions.ready = function () { this.cropper.setData({ width: width.value, height: height.value }); };
                }
            }
            cropper = new Cropper(image, cropperOptions);
        };
        if(image.complete) image.onload();

        if (cropMode === '圆形') {
            modal.querySelector('#zml-toggle-aspect-btn').onclick = () => {
                const currentRatio = cropper.getOptions().aspectRatio;
                const isLocked = !isNaN(currentRatio);
                cropper.setAspectRatio(isLocked ? NaN : 1);
                modal.querySelector('#zml-toggle-aspect-btn').textContent = isLocked ? '锁定宽高比' : '解锁宽高比';
                tipElement.textContent = isLocked ? "椭圆模式：当前可自由拉伸。" : "圆形模式：当前为等比例缩放。";
            };
        }
        
        modal.querySelector('#zml-confirm-btn').onclick = () => {
            widgets.data.value = JSON.stringify(cropper.getData(true));
            node.onWidgetValue_changed?.(widgets.data, widgets.data.value);
            closeModal(modal, cropperCss);
        };
        modal.querySelector('#zml-cancel-btn').onclick = () => closeModal(modal, cropperCss);
    });
}

function setupFabric(mainContainer, controlsContainer, widgets, imageUrl, node, modal) {
    const fabricUrl = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js';
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
            canvas.setWidth(img.naturalWidth * scale).setHeight(img.naturalHeight * scale);
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

// ======================= ZML_MergeImages 节点 (新) =======================
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

    if (!bgNode || !bgNode.imgs) {
        alert("请连接“底图”的图像输入！");
        return;
    }
     if (!fgNode1 || !fgNode1.imgs) {
        alert("请至少连接“前景图_1”的图像输入！");
        return;
    }

    const bgUrl = bgNode.imgs[0].src;
    const fgSources = [];
    if (fgNode1 && fgNode1.imgs) fgSources.push({ index: 0, name: 1, url: fgNode1.imgs[0].src, image: fgNode1.imgs[0] });
    if (fgNode2 && fgNode2.imgs) fgSources.push({ index: 1, name: 2, url: fgNode2.imgs[0].src, image: fgNode2.imgs[0] });
    if (fgNode3 && fgNode3.imgs) fgSources.push({ index: 2, name: 3, url: fgNode3.imgs[0].src, image: fgNode3.imgs[0] });

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
                 <p class="zml-editor-tip">自由移动、缩放、旋转前景图层。点击图像或下方按钮可将其置顶。</p>
                 <div class="zml-editor-controls" id="zml-merge-controls">
                    <button id="zml-reset-btn" class="zml-editor-btn" style="background-color: #5bc0de;">重置当前层</button>
                    <button id="zml-confirm-btn" class="zml-editor-btn" style="background-color: #4CAF50;">确认</button>
                    <button id="zml-cancel-btn" class="zml-editor-btn" style="background-color: #f44336;">取消</button>
                 </div>
            </div>
        </div>`;
    
    const modal = createModal(modalHtml);
    const mainContainer = modal.querySelector('#zml-editor-main-container');

    loadScript('https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js').then(() => {
        let uiCanvas, uiCanvasScale = 1.0;
        let fabricLayers = [];
        let allLayerParams = [];
        let layerButtons = [];

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
            try {
                const data = JSON.parse(widget.data.value);
                if(data && data.layers && data.layers.length > 0) {
                   loadedParams = data.layers;
                }
            } catch (e) { /* 忽略解析错误，使用默认位置 */ }
            
            fgArray.forEach((fgData, index) => {
                 fabric.Image.fromURL(fgData.url, (fFg) => {
                    fFg.set({ id: fgData.index, borderColor: 'yellow', cornerColor: '#f0ad4e', cornerStrokeColor: 'black', cornerStyle: 'circle', transparentCorners: false, borderScaleFactor: 2 });
                    
                    let transformParams = loadedParams.find(p => p.original_index === fgData.index)?.params;

                    if (!transformParams || transformParams.left === undefined) {
                        const fgImg = fgData.image;
                        const initialScale = (bgImg.naturalWidth * (0.3 + index*0.1)) / fgImg.naturalWidth;
                        transformParams = { left: bgImg.naturalWidth / 2, top: bgImg.naturalHeight / 2, scaleX: initialScale, scaleY: initialScale, angle: 0, originX: 'center', originY: 'center' };
                    }
                    allLayerParams[fgData.index] = transformParams;
                    
                    const displayParams = { ...transformParams };
                    displayParams.left *= uiCanvasScale;
                    displayParams.top *= uiCanvasScale;
                    displayParams.scaleX *= uiCanvasScale;
                    displayParams.scaleY *= uiCanvasScale;
                    fFg.set(displayParams);
                    
                    uiCanvas.add(fFg);
                    fabricLayers[fgData.index] = fFg;

                    if(index === 0) uiCanvas.setActiveObject(fFg);
                    uiCanvas.renderAll();
                });
            });
            
            if (loadedParams.length > 0) {
                setTimeout(() => {
                    const sortedObjects = loadedParams.map(p => fabricLayers[p.original_index]).filter(Boolean);
                    sortedObjects.forEach(obj => uiCanvas.bringToFront(obj));
                    if(sortedObjects.length > 0) uiCanvas.setActiveObject(sortedObjects[sortedObjects.length-1]);
                    uiCanvas.renderAll();
                }, 200);
            }


            uiCanvas.on('object:modified', (e) => {
                if(!e.target) return;
                const obj = e.target;
                const layerIndex = obj.id;
                allLayerParams[layerIndex] = {
                    left: obj.left / uiCanvasScale, top: obj.top / uiCanvasScale,
                    scaleX: obj.scaleX / uiCanvasScale, scaleY: obj.scaleY / uiCanvasScale,
                    angle: obj.angle, originX: 'center', originY: 'center',
                };
            });
             
            // --- [MODIFICATION START] ---
            const updateActiveButton = (activeObj) => {
                if(!activeObj) return;
                layerButtons.forEach((btn) => {
                    // 使用按钮上存储的索引进行比较
                    if (btn.layerIndex === activeObj.id) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            };

            // [NEW] 监听鼠标按下事件，实现点击图像置顶
            uiCanvas.on('mouse:down', function(options) {
                if (options.target && options.target.id !== undefined) {
                    const targetLayer = options.target;
                    uiCanvas.bringToFront(targetLayer);
                    // 不需要手动设置active object，fabric会自动处理
                    // uiCanvas.setActiveObject(targetLayer); 
                    uiCanvas.renderAll();
                    updateActiveButton(targetLayer);
                }
            });

            // 监听选择事件，确保按钮状态同步
            uiCanvas.on('selection:created', (e) => updateActiveButton(e.selected[0]));
            uiCanvas.on('selection:updated', (e) => updateActiveButton(e.selected[0]));
            // --- [MODIFICATION END] ---

            if (fgSources.length > 1) {
                const layerControls = modal.querySelector('#zml-layer-controls');
                fgSources.forEach((fg) => {
                    const btn = document.createElement('button');
                    btn.textContent = `前景 ${fg.name}`;
                    btn.className = 'zml-editor-btn zml-layer-btn';
                    btn.style.backgroundColor = '#337ab7';
                    btn.layerIndex = fg.index; // 在按钮上存储它对应的图层索引
                    btn.onclick = () => {
                        const targetLayer = fabricLayers[fg.index];
                        if(targetLayer) {
                           uiCanvas.setActiveObject(targetLayer);
                           uiCanvas.bringToFront(targetLayer);
                           uiCanvas.renderAll();
                           updateActiveButton(targetLayer);
                        }
                    };
                    layerControls.appendChild(btn);
                    layerButtons.push(btn);
                });
                
                if(layerButtons.length > 0) {
                    setTimeout(() => updateActiveButton(uiCanvas.getActiveObject() || fabricLayers[0]), 200);
                }
            }
        };

        const bgImg = new Image();
        bgImg.src = bgUrl;
        bgImg.onload = () => {
            const fgImageObjects = fgSources.map(s => {
                const img = new Image();
                img.src = s.url;
                return { ...s, image: img };
            });
            
            let loadedCount = 0;
            const totalToLoad = fgImageObjects.length;
            if (totalToLoad === 0) {
                 setupMergeCanvas(bgImg, []);
                 return;
            }
            fgImageObjects.forEach(fg => {
                fg.image.onload = () => {
                    loadedCount++;
                    if(loadedCount === totalToLoad) {
                        setupMergeCanvas(bgImg, fgImageObjects);
                    }
                }
                 if(fg.image.complete) fg.image.onload();
            });
        };
        
        modal.querySelector('#zml-reset-btn').onclick = () => {
            const activeObj = uiCanvas.getActiveObject();
            if (activeObj && bgImg.naturalWidth > 0) {
                 const layerIndex = activeObj.id;
                 const originalFgImg = fgSources.find(f => f.index === layerIndex).image;
                 const initialScale = (bgImg.naturalWidth * 0.5) / originalFgImg.naturalWidth;
                 const initialUiScale = initialScale * uiCanvasScale;

                 activeObj.set({
                    left: uiCanvas.width / 2, top: uiCanvas.height / 2,
                    scaleX: initialUiScale, scaleY: initialUiScale, angle: 0,
                 });
                 activeObj.setCoords();
                 uiCanvas.renderAll();
                 uiCanvas.fire('object:modified', { target: activeObj });
            }
        };

        modal.querySelector('#zml-confirm-btn').onclick = () => {
            const orderedObjects = uiCanvas.getObjects().filter(o => o.id !== undefined);
            
            const orderedLayerData = orderedObjects.map(obj => {
                return {
                    original_index: obj.id,
                    params: allLayerParams[obj.id]
                };
            });

            const final_data = {
                layers: orderedLayerData
            };
            
            widget.data.value = JSON.stringify(final_data);
            node.onWidgetValue_changed?.(widget.data, widget.data.value);
            closeModal(modal);
        };
        
        modal.querySelector('#zml-cancel-btn').onclick = () => closeModal(modal);
    });
}
