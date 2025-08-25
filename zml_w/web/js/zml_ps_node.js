// 文件路径: ComfyUI-ZML-Image/zml_w/web/js/zml_ps_node.js
// 版本: 5.1 (最终修复: 为Warp网格添补顶点索引，彻底修复渲染错误)

import { app } from "../../../scripts/app.js";

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const absoluteUrl = new URL(url, import.meta.url).href;
        if (document.querySelector(`script[src="${absoluteUrl}"]`)) {
            resolve(); return;
        }
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = absoluteUrl;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script: ${absoluteUrl}`));
        document.head.appendChild(script);
    });
}

app.registerExtension({
    name: "ZML.ImageDeform.V5_1",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_ImageDeform") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                this.widgets.find(w => w.name === "deformation_data") && this.addWidget("button", "打开形变编辑器", null, () => showDeformEditorModal(this));
            };
        }
    },
});

async function showDeformEditorModal(node) {
    await loadScript('../lib/pixi.min.js');
    const widget = node.widgets.find(w => w.name === "deformation_data");
    
    const imageNode = node.getInputNode(0);
    if (!imageNode?.imgs?.[0]?.src) { return alert("错误：需要连接一个图像输入！"); }

    const modalHtml = `
        <div class="zml-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 1001; flex-direction: column;">
            <div id="zml-editor-toolbar" style="background: #333; padding: 8px; border-radius: 8px 8px 0 0; display: flex; gap: 10px; align-items: center; color: white; flex-wrap: wrap;">
                <div class="zml-mode-selector">
                    <strong>模式:</strong>
                    <button id="zml-mode-warp" class="active">网格形变 (Warp)</button>
                    <button id="zml-mode-liquify">液化 (Liquify)</button>
                </div>
                <div id="zml-warp-tools" class="zml-tool-panel" style="display: flex; align-items: center; gap: 5px;">
                    <strong>网格密度:</strong>
                    <select id="zml-warp-grid-size"><option value="3">3x3</option><option value="5" selected>5x5</option></select>
                </div>
                <div id="zml-liquify-tools" class="zml-tool-panel" style="display: none; align-items: center; gap: 5px;">
                    <strong>笔刷大小:</strong> <input type="range" id="zml-liquify-brush-size" min="10" max="200" value="50">
                    <strong>强度:</strong> <input type="range" id="zml-liquify-strength" min="1" max="20" value="5">
                </div>
            </div>
            <div id="zml-pixi-container" style="border: 1px solid #555; background-color: #111; cursor: default;"></div>
            <div class="zml-editor-controls" style="background: #333; padding: 8px; border-radius: 0 0 8px 8px; display: flex; justify-content: flex-end; align-items: center; min-width: 500px;">
                <button id="zml-reset-btn">重置</button>
                <button id="zml-confirm-btn" style="color: white; background-color: #4CAF50; margin-left: 10px;">确认</button>
                <button id="zml-cancel-btn" style="color: white; background-color: #f44336; margin-left: 10px;">取消</button>
            </div>
            <style> /* ... CSS styles ... */ </style>
        </div>`;

    const modal = document.createElement('div');
    modal.id = 'zml-advanced-deform-modal';
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageNode.imgs[0].src;
    
    image.onload = () => {
        const container = modal.querySelector('#zml-pixi-container');
        const maxWidth = window.innerWidth * 0.8;
        const maxHeight = window.innerHeight * 0.75;
        const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
        const viewWidth = image.naturalWidth * scale;
        const viewHeight = image.naturalHeight * scale;

        const pixiApp = new PIXI.Application({ width: viewWidth, height: viewHeight, backgroundColor: 0x222222 });
        container.appendChild(pixiApp.view);
        
        const imageTexture = PIXI.Texture.from(image);
        let currentMode = 'warp';
        let warpMesh, liquifySprite, displacementFilter, displacementTexture;
        let warpHandles = [], warpGridLines;

        function drawWarpGrid() {
            if(!warpMesh || !warpGridLines) return;
            const vertices = warpMesh.vertices;
            const gridSize = parseInt(modal.querySelector('#zml-warp-grid-size').value);
            warpGridLines.clear().lineStyle(1, 0xFFD700, 0.7);
            for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize - 1; x++) {
                const i = y * gridSize + x;
                warpGridLines.moveTo(vertices[i*2], vertices[i*2+1]).lineTo(vertices[(i+1)*2], vertices[(i+1)*2+1]);
            }
            for (let x = 0; x < gridSize; x++) for (let y = 0; y < gridSize - 1; y++) {
                const i = y * gridSize + x;
                warpGridLines.moveTo(vertices[i*2], vertices[i*2+1]).lineTo(vertices[(i+gridSize)*2], vertices[(i+gridSize)*2+1]);
            }
        }
        
        function setupWarp() {
            pixiApp.stage.removeChildren();
            warpHandles = [];
            
            const gridSize = parseInt(modal.querySelector('#zml-warp-grid-size').value);
            const vertices = new Float32Array(gridSize * gridSize * 2);
            const uvs = new Float32Array(gridSize * gridSize * 2);
            
            // --- 核心修复: 创建顶点索引 (indices) ---
            const indices = new Uint16Array((gridSize - 1) * (gridSize - 1) * 6);

            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    const i = y * gridSize + x;
                    vertices[i*2] = (x / (gridSize-1)) * viewWidth;
                    vertices[i*2+1] = (y / (gridSize-1)) * viewHeight;
                    uvs[i*2] = x / (gridSize-1);
                    uvs[i*2+1] = y / (gridSize-1);
                }
            }

            // --- 核心修复: 填充顶点索引数据 ---
            let indicesIdx = 0;
            for (let y = 0; y < gridSize - 1; y++) {
                for (let x = 0; x < gridSize - 1; x++) {
                    const i = y * gridSize + x;
                    // Triangle 1
                    indices[indicesIdx++] = i;
                    indices[indicesIdx++] = i + 1;
                    indices[indicesIdx++] = i + gridSize;
                    // Triangle 2
                    indices[indicesIdx++] = i + 1;
                    indices[indicesIdx++] = i + gridSize + 1;
                    indices[indicesIdx++] = i + gridSize;
                }
            }
            
            // --- 核心修复: 在创建SimpleMesh时传入indices ---
            warpMesh = new PIXI.SimpleMesh(imageTexture, vertices, uvs, indices);
            pixiApp.stage.addChild(warpMesh);

            warpGridLines = new PIXI.Graphics();
            pixiApp.stage.addChild(warpGridLines);

            for (let i = 0; i < vertices.length / 2; i++) {
                const handle = new PIXI.Graphics().beginFill(0xffdd00, 0.9).drawCircle(0, 0, 6).endFill();
                handle.x = vertices[i*2]; handle.y = vertices[i*2+1];
                handle.interactive = true; handle.cursor = 'grab'; handle.vertexIndex = i;
                handle.on('pointerdown', onHandleDragStart).on('pointerup', onHandleDragEnd).on('pointerupoutside', onHandleDragEnd).on('pointermove', onHandleDragMove);
                pixiApp.stage.addChild(handle);
                warpHandles.push(handle);
            }
            drawWarpGrid();
        }
        
        let draggingHandle = null;
        function onHandleDragStart(e) { draggingHandle = this; pixiApp.view.style.cursor = 'grabbing'; }
        function onHandleDragEnd() { if (draggingHandle) { pixiApp.view.style.cursor = 'default'; draggingHandle = null; } }
        function onHandleDragMove(e) {
            if (draggingHandle) {
                const newPos = e.data.getLocalPosition(draggingHandle.parent);
                draggingHandle.x = newPos.x; draggingHandle.y = newPos.y;
                const i = draggingHandle.vertexIndex;
                warpMesh.vertices[i*2] = newPos.x; warpMesh.vertices[i*2+1] = newPos.y;
                drawWarpGrid();
            }
        }

        function setupLiquify() {
            pixiApp.stage.removeChildren();
            
            liquifySprite = new PIXI.Sprite(imageTexture);
            liquifySprite.width = viewWidth; liquifySprite.height = viewHeight;
            
            displacementTexture = PIXI.RenderTexture.create({ width: viewWidth, height: viewHeight });
            const displacementSprite = new PIXI.Sprite(displacementTexture);
            
            const bgFill = new PIXI.Graphics().beginFill(0x808080).drawRect(0, 0, viewWidth, viewHeight).endFill();
            pixiApp.renderer.render(bgFill, { renderTexture: displacementTexture });

            displacementFilter = new PIXI.DisplacementFilter(displacementSprite);
            
            pixiApp.stage.addChild(liquifySprite);
            liquifySprite.filters = [displacementFilter];
            
            let isLiquifying = false, lastPos = null;
            const brush = new PIXI.Graphics();
            pixiApp.stage.interactive = true;
            pixiApp.stage.on('pointerdown', (e) => { if (currentMode !== 'liquify') return; isLiquifying = true; lastPos = e.data.getLocalPosition(pixiApp.stage); });
            pixiApp.stage.on('pointerup', () => isLiquifying = false);
            pixiApp.stage.on('pointerupoutside', () => isLiquifying = false);
            pixiApp.stage.on('pointermove', (e) => {
                if (!isLiquifying || currentMode !== 'liquify') return;
                const pos = e.data.getLocalPosition(pixiApp.stage);
                const dx = pos.x - lastPos.x; const dy = pos.y - lastPos.y;
                const size = parseInt(modal.querySelector('#zml-liquify-brush-size').value);
                const strength = parseInt(modal.querySelector('#zml-liquify-strength').value);
                const r = (dx * strength + 127.5); const g = (dy * strength + 127.5);
                const color = (r << 16) | (g << 8);
                brush.clear().beginFill(color).drawCircle(lastPos.x, lastPos.y, size / 2).endFill();
                pixiApp.renderer.render(brush, { renderTexture: displacementTexture, clear: false });
                lastPos = pos;
            });
        }
        
        const warpTools = modal.querySelector('#zml-warp-tools');
        const liquifyTools = modal.querySelector('#zml-liquify-tools');
        const warpButton = modal.querySelector('#zml-mode-warp');
        const liquifyButton = modal.querySelector('#zml-mode-liquify');

        warpButton.onclick = () => {
            currentMode = 'warp';
            warpButton.classList.add('active'); liquifyButton.classList.remove('active');
            warpTools.style.display = 'flex'; liquifyTools.style.display = 'none';
            setupWarp();
        };
        liquifyButton.onclick = () => {
            currentMode = 'liquify';
            liquifyButton.classList.add('active'); warpButton.classList.remove('active');
            warpTools.style.display = 'none'; liquifyTools.style.display = 'flex';
            setupLiquify();
        };
        
        modal.querySelector('#zml-warp-grid-size').onchange = setupWarp;
        modal.querySelector('#zml-reset-btn').onclick = () => { currentMode === 'warp' ? setupWarp() : setupLiquify(); };
        modal.querySelector('#zml-confirm-btn').onclick = async () => {
            let dataToSave;
            if (currentMode === 'warp') {
                const finalPoints = warpHandles.map(h => [h.x / scale, h.y / scale]);
                dataToSave = { mode: 'warp', gridSize: parseInt(modal.querySelector('#zml-warp-grid-size').value), points: finalPoints };
            } else {
                 const mapBase64 = await pixiApp.renderer.extract.base64(displacementTexture);
                 dataToSave = { mode: 'liquify', map: mapBase64 };
            }
            widget.value = JSON.stringify(dataToSave);
            node.onWidgetValue_changed?.(widget.name, widget.value);
            pixiApp.destroy(true, {children:true, texture:true, baseTexture:true});
            modal.remove();
        };
        modal.querySelector('#zml-cancel-btn').onclick = () => {
            pixiApp.destroy(true, {children:true, texture:true, baseTexture:true});
            modal.remove();
        };
        
        setupWarp();
    };
}