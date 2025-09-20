// 文件路径: ComfyUI-ZML-Image/zml_w/web/js/zml_ps_node.js
import { app } from "../../../scripts/app.js";

// ======================= 通用 JS 函数 =======================
// loadScript函数现在支持module类型，并使用import.meta.url确保路径正确
function loadScript(url, isModule = false) {
    return new Promise((resolve, reject) => {
        // 使用 new URL() 结合 import.meta.url 来确保生成正确的绝对路径
        const absoluteUrl = new URL(url, import.meta.url).href;
        
        // 检查脚本是否已存在
        if (document.querySelector(`script[src="${absoluteUrl}"]`)) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        if (isModule) {
            script.type = 'module';
        } else {
            script.type = 'text/javascript';
        }
        script.src = absoluteUrl;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script: ${absoluteUrl}`));
        document.head.appendChild(script);
    });
}

function createModal(htmlContent, id = 'zml-modal') {
    const modal = document.createElement('div');
    modal.id = id;
    modal.innerHTML = htmlContent;
    document.body.appendChild(modal);
    return modal;
}

function closeModal(modal) {
    if (modal) modal.remove();
}

// ======================= ZML_ImageDeform 节点前端逻辑=======================
app.registerExtension({
    name: "ZML.ImageDeform.V5_1", // 保持原来的命名，防止冲突
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
    // 确保PIXI.js库已加载
    if (typeof PIXI === 'undefined') {
        const pixiJsPath = new URL('../lib/pixi.min.js', import.meta.url).href;
        await loadScript(pixiJsPath);
    }

    const widget = node.widgets.find(w => w.name === "deformation_data");
    
    // 获取上游图像的URL
    const imageNode = node.getInputNode(0);
    if (!imageNode?.imgs?.[0]?.src) { return alert("错误：需要连接一个图像输入！"); }
    const imageUrl = imageNode.imgs[0].src;

    // 模态框 HTML 和 CSS（这里只保留了必要的，为了简洁，省略了大部分CSS，你需要将原来的CSS放回来）
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
            <style>
                .zml-modal {
                    font-family: Arial, sans-serif;
                    color: #e0e0e0;
                }
                .zml-modal button {
                    background-color: #555;
                    border: 1px solid #777;
                    padding: 5px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    color: white;
                }
                .zml-modal button.active {
                    background-color: #007bff;
                    border-color: #007bff;
                }
                .zml-modal button:hover:not(.active) {
                    background-color: #666;
                }
                .zml-mode-selector button {
                    margin-left: 5px;
                }
                .zml-tool-panel strong { margin-right: 5px; }
            </style>
        </div>`;

    const modal = createModal(modalHtml, 'zml-deform-editor-modal'); // 给模态框一个独特的ID
    
    // 加载图像
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    
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
            const vertices = new Float32Array(gridSize * gridSize * 2); // 存储X, Y坐标
            const uvs = new Float32Array(gridSize * gridSize * 2); // 存储U, V纹理坐标
            
            // --- 核心修复: 创建顶点索引 (indices) ---
            const indices = new Uint16Array((gridSize - 1) * (gridSize - 1) * 6); // 每个四边形2个三角形，每个三角形3个顶点

            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    const i = y * gridSize + x;
                    vertices[i*2] = (x / (gridSize-1)) * viewWidth; // Pixels X
                    vertices[i*2+1] = (y / (gridSize-1)) * viewHeight; // Pixels Y
                    uvs[i*2] = x / (gridSize-1); // UV X (Normalized: 0 to 1)
                    uvs[i*2+1] = y / (gridSize-1); // UV Y (Normalized: 0 to 1)
                }
            }

            // --- 核心修复: 填充顶点索引数据 ---
            let indicesIdx = 0;
            for (let y = 0; y < gridSize - 1; y++) {
                for (let x = 0; x < gridSize - 1; x++) {
                    const i = y * gridSize + x; // 左上角点的顶点索引
                    // 第一个三角形 (左上, 右上, 左下)
                    indices[indicesIdx++] = i;
                    indices[indicesIdx++] = i + 1;
                    indices[indicesIdx++] = i + gridSize;
                    // 第二个三角形 (右上, 右下, 左下)
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
        function onHandleDragStart(e) { draggingHandle = this; pixiApp.view.style.cursor = 'grabbing'; e.stopPropagation(); }
        function onHandleDragEnd() { if (draggingHandle) { pixiApp.view.style.cursor = 'default'; draggingHandle = null; } }
        function onHandleDragMove(e) {
            if (draggingHandle) {
                const newPos = e.data.getLocalPosition(draggingHandle.parent);
                draggingHandle.x = newPos.x; draggingHandle.y = newPos.y;
                const i = draggingHandle.vertexIndex;
                warpMesh.vertices[i*2] = newPos.x; warpMesh.vertices[i*2+1] = newPos.y;
                warpMesh.dirty = true; // 标记网格需要更新
                drawWarpGrid();
            }
        }

        function setupLiquify() {
            pixiApp.stage.removeChildren();
            
            liquifySprite = new PIXI.Sprite(imageTexture);
            liquifySprite.width = viewWidth; liquifySprite.height = viewHeight;
            
            displacementTexture = PIXI.RenderTexture.create({ width: viewWidth, height: viewHeight });
            const displacementSprite = new PIXI.Sprite(displacementTexture);
            
            // 填充位移贴图为灰色 (128, 128, 0) 表示无位移，对应后端 (value - 127.5) = 0
            // PIXI的颜色值 0xRRGGBB，所以0x808000是 RGB(128,128,0)
            const bgFill = new PIXI.Graphics().beginFill(0x808000).drawRect(0, 0, viewWidth, viewHeight).endFill();
            pixiApp.renderer.render(bgFill, { renderTexture: displacementTexture });

            displacementFilter = new PIXI.DisplacementFilter(displacementSprite);
            // 确保位移强度与UI设置匹配
            // PIXI 的 DisplacementFilter 默认是 `redX = 1`, `greenY = 1`，将 R/G 通道值减去 0.5 后作为位移系数
            // 所以后端 `(val - 127.5)` 意味着 0 ~ 255 的输入映射到 -127.5 ~ 127.5的位移
            // 前端 `scale.x`, `scale.y` 应该乘以一个补偿因子，将 PIXI 的 `(color_val - 0.5)` 转换回后端所需的位移量
            // 后端 (map_cv_resized[:, :, 2].astype(np.float32) - 127.5)
            // 前端 color (r_color) 对应 后端 map_cv_resized[:, :, 2]
            // 如果 r_color=128, 后端位移 = 0
            // 如果 r_color=255, 后端位移 = 127.5
            // 如果 r_color=0, 后端位移 = -127.5
            // PIXI filter: (r/255 - 0.5) * scale.x => (r - 127.5) / 255 * scale.x
            // 为了让这个等于后端的位移量，scale.x 应该设置为 255
            displacementFilter.scale.x = 255 * parseFloat(modal.querySelector('#zml-liquify-strength').value); 
            displacementFilter.scale.y = 255 * parseFloat(modal.querySelector('#zml-liquify-strength').value);

            pixiApp.stage.addChild(liquifySprite);
            liquifySprite.filters = [displacementFilter];
            
            let isLiquifying = false, lastPos = null;
            const brushGraphics = new PIXI.Graphics(); // Used for drawing on displacement map
            pixiApp.stage.interactive = true;
            pixiApp.stage.hitArea = new PIXI.Rectangle(0, 0, pixiApp.screen.width, pixiApp.screen.height);

            pixiApp.stage.on('pointerdown', (e) => { 
                if (currentMode !== 'liquify') return; 
                isLiquifying = true; 
                lastPos = e.data.getLocalPosition(pixiApp.stage);
                brushGraphics.lineStyle(0);
                e.stopPropagation(); // 阻止事件冒泡到其他处理程序
            });
            pixiApp.stage.on('pointerup', () => isLiquifying = false);
            pixiApp.stage.on('pointerupoutside', () => isLiquifying = false);
            modal.querySelector('#zml-liquify-strength').oninput = (e) => {
                const strength = parseFloat(e.target.value);
                displacementFilter.scale.x = 255 * strength; // 实时更新强度
                displacementFilter.scale.y = 255 * strength;
            };
            pixiApp.stage.on('pointermove', (e) => {
                if (!isLiquifying || currentMode !== 'liquify') return;
                const pos = e.data.getLocalPosition(pixiApp.stage);
                const dx = pos.x - lastPos.x;
                const dy = pos.y - lastPos.y;

                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { // 避免微小移动导致大量绘制，降低性能
                    lastPos = pos;
                    return; 
                } 

                const brushSize = parseInt(modal.querySelector('#zml-liquify-brush-size').value);
                
                // 将位移量 (dx, dy) 转换为 0-255 的颜色值，后端会减去 127.5
                // 为了避免值过于剧烈，可以对 dx, dy 进行一个软钳制或缩放
                const max_brush_displacement = 15; // 限制单次笔触的最大位移影响
                const clamped_dx = Math.max(-max_brush_displacement, Math.min(max_brush_displacement, dx));
                const clamped_dy = Math.max(-max_brush_displacement, Math.min(max_brush_displacement, dy));

                const r_color = Math.max(0, Math.min(255, 128 + clamped_dx)); // 红色通道
                const g_color = Math.max(0, Math.min(255, 128 + clamped_dy)); // 绿色通道
                // B通道通常用于Z轴位移，这里我们不使用，设为0
                const colorValue = (Math.round(r_color) << 16) | (Math.round(g_color) << 8) | 0x00; // RRGGBB

                brushGraphics.beginFill(colorValue, 1).drawCircle(pos.x, pos.y, brushSize / 2).endFill();
                pixiApp.renderer.render(brushGraphics, { renderTexture: displacementTexture, clear: false });
                
                lastPos = pos;
            });
        }
        
        const warpTools = modal.querySelector('#zml-warp-tools');
        const liquifyTools = modal.querySelector('#zml-liquify-tools');
        const warpButton = modal.querySelector('#zml-mode-warp');
        const liquifyButton = modal.querySelector('#zml-mode-liquify');

        // 初始化按钮状态
        warpButton.classList.add('active');
        warpTools.style.display = 'flex';
        liquifyTools.style.display = 'none';

        // 绑定模式切换事件
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
                 // 提取位移贴图
                 // 使用 extract.pixels() 获取原始像素数据
                 const pixels = pixiApp.renderer.extract.pixels(displacementTexture); // RGBA数组
                 const width = displacementTexture.width;
                 const height = displacementTexture.height;

                 // 创建一个新的Canvas，将像素数据绘制上去
                 const tempCanvas = document.createElement('canvas');
                 tempCanvas.width = width;
                 tempCanvas.height = height;
                 const ctx = tempCanvas.getContext('2d');
                 const imageData = ctx.createImageData(width, height);
                 
                 // PIXI.extract.pixels 返回的是一维数组 [R,G,B,A, R,G,B,A, ...]
                 // ImageData 也是类似的结构
                 for (let i = 0; i < pixels.length; i++) {
                    imageData.data[i] = pixels[i];
                 }
                 ctx.putImageData(imageData, 0, 0);

                 // 将Canvas内容转换为Base64 PNG
                 const mapBase64 = tempCanvas.toDataURL('image/png');
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
        
        setupWarp(); // 默认启动Warp模式

        // 确保模态框在PIXI应用准备好后才显示
        modal.style.display = 'flex';
    };

    image.onerror = () => {
        alert("无法加载图像进行形变编辑。请确保图像有效。");
        closeModal(modal);
    };
}


// 版本: 7.0 (优化 ZML_PanoViewer 节点，修复视角拖动控制方向，改进透视控制，添加相机距离调节，增加内外视角切换功能)
// ======================= ZML_ImageColorAdjust 节点前端逻辑=======================
app.registerExtension({
    name: "ZML.ImageColorAdjust",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_ImageColorAdjust") {
            // 移除节点上的所有参数控件，只保留按钮
            const origNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                origNodeCreated?.apply(this, arguments);
                // 确保color_data参数存在
                if (!this.widgets.find(w => w.name === "color_data")) {
                    this.addWidget("text", "color_data", "{}", () => {}, {"default": "{}", "visible": false});
                }
                // 添加一个按钮来触发调色模态框
                this.addWidget("button", "打开调色编辑器", null, () => showColorAdjustModal(this));
            };
        }
    },
});

async function showColorAdjustModal(node) {
    // 获取上游图像的URL
    const imageNode = node.getInputNode(0);
    if (!imageNode?.imgs?.[0]?.src) { return alert("错误：需要连接一个图像输入！"); }
    const imageUrl = imageNode.imgs[0].src;

    // 模态框 HTML 和 CSS
    const modalHtml = `
    <div id="zml-color-adjust-modal" class="zml-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 1001;">
        <div class="zml-color-adjust-container" style="display: flex; background: #222; border-radius: 8px; overflow: hidden; max-width: 90%; max-height: 90%;">
            <!-- 左侧工具面板 -->
            <div id="zml-color-toolbar" style="background: #333; padding: 10px; border-right: 1px solid #555; width: 180px; min-width: 180px; display: flex; flex-direction: column; gap: 10px;">
                <div style="font-weight: bold; text-align: center; margin-bottom: 5px; font-size: 14px;">ZML 可视化调色器</div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">亮度:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-brightness-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-brightness-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-brightness-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-brightness" min="-100" max="100" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">对比度:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-contrast-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-contrast-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-contrast-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-contrast" min="-100" max="100" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">饱和度:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-saturation-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-saturation-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-saturation-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-saturation" min="-100" max="100" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">色相:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-hue-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-hue-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-hue-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-hue" min="-180" max="180" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">锐化:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-sharpen-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-sharpen-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-sharpen-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-sharpen" min="0" max="100" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">伽马:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-gamma-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-gamma-input" value="1.0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-gamma-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-gamma" min="0.1" max="3" step="0.1" value="1" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">曝光:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-exposure-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-exposure-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-exposure-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-exposure" min="-100" max="100" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">模糊:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-blur-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-blur-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-blur-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-blur" min="0" max="20" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">噪点:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-noise-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-noise-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-noise-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-noise" min="0" max="100" value="0" style="width: 100%;">
                </div>
                
                <div class="zml-tool-panel" style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 11px;">暗角:</strong>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <button id="zml-vignette-minus" class="zml-adjust-btn minus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">-</button>
                            <input type="text" id="zml-vignette-input" value="0" style="width: 40px; text-align: center; background: #444; border: 1px solid #666; color: white; border-radius: 3px; padding: 1px 3px; font-size: 10px;">
                            <button id="zml-vignette-plus" class="zml-adjust-btn plus" style="width: 16px; height: 16px; background: #444; border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 8px; padding: 0; display: flex; align-items: center; justify-content: center;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-vignette" min="0" max="100" value="0" style="width: 100%;">
                </div>
                
                <div style="margin-top: auto; display: flex; flex-direction: column; gap: 5px;">
                    <button id="zml-reset-color-btn" style="padding: 6px; background-color: #555; border: 1px solid #777; border-radius: 4px; cursor: pointer; color: white; font-size: 12px;">重置</button>
                </div>
            </div>
            
            <!-- 右侧预览区域 -->
            <div style="display: flex; flex-direction: column; flex: 1;">
                <div id="zml-color-preview-container" style="background-color: #111; display: flex; align-items: center; justify-content: center; position: relative; flex: 1;">
                    <div style="text-align: center; color: white; position: relative;">
                        <canvas id="zml-original-preview" style="max-width: 100%; max-height: 100%; display: none;"></canvas>
                        <canvas id="zml-adjusted-preview" style="max-width: 100%; max-height: 100%;"></canvas>
                        <button id="zml-compare-btn" title="按住显示原图" style="position: absolute; bottom: 10px; left: 10px; background-color: rgba(0,0,0,0.7); color: white; border: 1px solid white; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; z-index: 10; display: flex; align-items: center; justify-content: center; font-size: 16px;">⇄</button>
                    </div>
                </div>
                
                <!-- 底部控制按钮 -->
                <div class="zml-editor-controls" style="background: #333; padding: 10px; display: flex; justify-content: flex-end; align-items: center; gap: 10px;">
                    <button id="zml-confirm-color-btn" style="padding: 8px 16px; color: white; background-color: #4CAF50; border: none; border-radius: 4px; cursor: pointer;">确认</button>
                    <button id="zml-cancel-color-btn" style="padding: 8px 16px; color: white; background-color: #f44336; border: none; border-radius: 4px; cursor: pointer;">取消</button>
                </div>
            </div>
        </div>
        
        <style>
            .zml-modal {
                font-family: Arial, sans-serif;
                color: #e0e0e0;
            }
            
            .zml-color-adjust-container {
                display: flex;
                max-width: 90vw;
                max-height: 90vh;
            }
            
            .zml-modal button:hover {
                opacity: 0.9;
            }
            
            .zml-tool-panel input[type="range"] {
                width: 50% !important;
                height: 3px;
                background: #555;
                outline: none;
                opacity: 0.7;
                transition: opacity 0.2s;
                -webkit-appearance: none;
            }
            
            .zml-tool-panel input[type="range"]:hover {
                opacity: 1;
            }
            
            .zml-tool-panel input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 8px;
                height: 8px;
                background: #4CAF50;
                cursor: pointer;
                border-radius: 50%;
            }
            
            .zml-tool-panel input[type="range"]::-moz-range-thumb {
                width: 8px;
                height: 8px;
                background: #4CAF50;
                cursor: pointer;
                border-radius: 50%;
                border: none;
            }
            
            .zml-tool-panel input[type="text"]:focus {
                outline: none;
                border-color: #4CAF50;
            }
            
            .zml-adjust-btn {
                transition: all 0.2s ease;
            }
            
            .zml-adjust-btn:hover {
                background-color: #555;
                border-color: #4CAF50;
            }
            
            .zml-adjust-btn:active {
                background-color: #666;
            }
            
            #zml-compare-btn:active {
                background-color: rgba(255,255,255,0.7);
                color: black;
            }
            
            /* 工具面板中的输入框样式微调 */
            .zml-tool-panel input[type="text"] {
                font-size: 10px;
                padding: 1px 3px;
            }
        </style>
    </div>`;

    const modal = createModal(modalHtml, 'zml-color-adjust-modal');
    
    // 获取UI元素
    const originalCanvas = modal.querySelector('#zml-original-preview');
    const adjustedCanvas = modal.querySelector('#zml-adjusted-preview');
    const brightnessSlider = modal.querySelector('#zml-brightness');
    const contrastSlider = modal.querySelector('#zml-contrast');
    const saturationSlider = modal.querySelector('#zml-saturation');
    const hueSlider = modal.querySelector('#zml-hue');
    const sharpenSlider = modal.querySelector('#zml-sharpen');
    const gammaSlider = modal.querySelector('#zml-gamma');
    const exposureSlider = modal.querySelector('#zml-exposure');
    const blurSlider = modal.querySelector('#zml-blur');
    const noiseSlider = modal.querySelector('#zml-noise');
    const vignetteSlider = modal.querySelector('#zml-vignette');
    const brightnessInput = modal.querySelector('#zml-brightness-input');
    const contrastInput = modal.querySelector('#zml-contrast-input');
    const saturationInput = modal.querySelector('#zml-saturation-input');
    const hueInput = modal.querySelector('#zml-hue-input');
    const sharpenInput = modal.querySelector('#zml-sharpen-input');
    const gammaInput = modal.querySelector('#zml-gamma-input');
    const exposureInput = modal.querySelector('#zml-exposure-input');
    const blurInput = modal.querySelector('#zml-blur-input');
    const noiseInput = modal.querySelector('#zml-noise-input');
    const vignetteInput = modal.querySelector('#zml-vignette-input');
    
    // 获取按钮元素
    const brightnessMinusBtn = modal.querySelector('#zml-brightness-minus');
    const brightnessPlusBtn = modal.querySelector('#zml-brightness-plus');
    const contrastMinusBtn = modal.querySelector('#zml-contrast-minus');
    const contrastPlusBtn = modal.querySelector('#zml-contrast-plus');
    const saturationMinusBtn = modal.querySelector('#zml-saturation-minus');
    const saturationPlusBtn = modal.querySelector('#zml-saturation-plus');
    const hueMinusBtn = modal.querySelector('#zml-hue-minus');
    const huePlusBtn = modal.querySelector('#zml-hue-plus');
    const sharpenMinusBtn = modal.querySelector('#zml-sharpen-minus');
    const sharpenPlusBtn = modal.querySelector('#zml-sharpen-plus');
    const gammaMinusBtn = modal.querySelector('#zml-gamma-minus');
    const gammaPlusBtn = modal.querySelector('#zml-gamma-plus');
    const exposureMinusBtn = modal.querySelector('#zml-exposure-minus');
    const exposurePlusBtn = modal.querySelector('#zml-exposure-plus');
    const blurMinusBtn = modal.querySelector('#zml-blur-minus');
    const blurPlusBtn = modal.querySelector('#zml-blur-plus');
    const noiseMinusBtn = modal.querySelector('#zml-noise-minus');
    const noisePlusBtn = modal.querySelector('#zml-noise-plus');
    const vignetteMinusBtn = modal.querySelector('#zml-vignette-minus');
    const vignettePlusBtn = modal.querySelector('#zml-vignette-plus');
    
    const resetBtn = modal.querySelector('#zml-reset-color-btn');
    const confirmBtn = modal.querySelector('#zml-confirm-color-btn');
    const cancelBtn = modal.querySelector('#zml-cancel-color-btn');

    // 加载图像并设置画布
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    
    let originalImageData = null;
    let currentImageData = null;
    
    image.onload = () => {
        // 设置画布大小
        const maxWidth = Math.min(image.width, 800);
        const maxHeight = Math.min(image.height, 600);
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = Math.floor(image.width * scale);
        const height = Math.floor(image.height * scale);
        
        originalCanvas.width = width;
        originalCanvas.height = height;
        adjustedCanvas.width = width;
        adjustedCanvas.height = height;
        
        // 绘制原图
        const originalCtx = originalCanvas.getContext('2d');
        originalCtx.drawImage(image, 0, 0, width, height);
        
        // 保存原始图像数据
        originalImageData = originalCtx.getImageData(0, 0, width, height);
        
        // 初始化调整后的图像
        updateAdjustedImage();
        
        // 设置对比按钮功能
        const compareBtn = modal.querySelector('#zml-compare-btn');
        compareBtn.addEventListener('mousedown', () => {
            // 显示原图
            originalCanvas.style.display = 'block';
            adjustedCanvas.style.display = 'none';
        });
        
        compareBtn.addEventListener('mouseup', () => {
            // 显示调整后的图像
            originalCanvas.style.display = 'none';
            adjustedCanvas.style.display = 'block';
        });
        
        compareBtn.addEventListener('mouseleave', () => {
            // 如果鼠标离开按钮时仍按下，也显示调整后的图像
            originalCanvas.style.display = 'none';
            adjustedCanvas.style.display = 'block';
        });
    };
    
    // 实时更新调整后的图像
    function updateAdjustedImage() {
        if (!originalImageData) return;
        
        const brightness = parseInt(brightnessSlider.value);
        const contrast = parseInt(contrastSlider.value);
        const saturation = parseInt(saturationSlider.value);
        const hue = parseInt(hueSlider.value);
        const sharpen = parseInt(sharpenSlider.value);
        const gamma = parseFloat(gammaSlider.value);
        const exposure = parseInt(exposureSlider.value);
        const blur = parseInt(blurSlider.value);
        const noise = parseInt(noiseSlider.value);
        const vignette = parseInt(vignetteSlider.value);
        
        // 更新输入框的值
        brightnessInput.value = brightness;
        contrastInput.value = contrast;
        saturationInput.value = saturation;
        hueInput.value = hue;
        sharpenInput.value = sharpen;
        gammaInput.value = gamma.toFixed(1);
        exposureInput.value = exposure;
        blurInput.value = blur;
        noiseInput.value = noise;
        vignetteInput.value = vignette;
        
        // 创建新的图像数据副本
        const adjustedCtx = adjustedCanvas.getContext('2d');
        const adjustedImageData = adjustedCtx.createImageData(originalImageData);
        const data = adjustedImageData.data;
        const originalData = originalImageData.data;
        
        // 应用颜色调整
        for (let i = 0; i < originalData.length; i += 4) {
            let r = originalData[i];
            let g = originalData[i + 1];
            let b = originalData[i + 2];
            
            // 亮度调整
            if (brightness !== 0) {
                r = Math.max(0, Math.min(255, r + brightness));
                g = Math.max(0, Math.min(255, g + brightness));
                b = Math.max(0, Math.min(255, b + brightness));
            }
            
            // 对比度调整
            if (contrast !== 0) {
                const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
                r = Math.max(0, Math.min(255, factor * (r - 128) + 128));
                g = Math.max(0, Math.min(255, factor * (g - 128) + 128));
                b = Math.max(0, Math.min(255, factor * (b - 128) + 128));
            }
            
            // 伽马调整
            if (gamma !== 1) {
                r = Math.max(0, Math.min(255, Math.pow(r / 255, 1 / gamma) * 255));
                g = Math.max(0, Math.min(255, Math.pow(g / 255, 1 / gamma) * 255));
                b = Math.max(0, Math.min(255, Math.pow(b / 255, 1 / gamma) * 255));
            }
            
            // HSL调整
            if (saturation !== 0 || hue !== 0) {
                // RGB转HSL
                let [h, s, l] = rgbToHsl(r, g, b);
                
                // 调整饱和度
                s = Math.max(0, Math.min(1, s * (1 + saturation / 100)));
                
                // 调整色相
                h = (h + hue) % 360;
                if (h < 0) h += 360;
                
                // HSL转RGB
                [r, g, b] = hslToRgb(h, s, l);
            }
            
            // 保存调整后的值
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = originalData[i + 3]; // 保持alpha不变
        }
        
        // 如果需要锐化，应用锐化滤镜
        let finalImageData = adjustedImageData;
        if (sharpen > 0) {
            finalImageData = applySharpen(finalImageData, sharpen);
        }
        
        // 应用曝光调整
        if (exposure !== 0) {
            finalImageData = applyExposure(finalImageData, exposure);
        }
        
        // 应用模糊效果
        if (blur > 0) {
            finalImageData = applyBlur(finalImageData, blur);
        }
        
        // 应用噪点效果
        if (noise > 0) {
            finalImageData = applyNoise(finalImageData, noise);
        }
        
        // 应用暗角效果
        if (vignette > 0) {
            finalImageData = applyVignette(finalImageData, vignette);
        }
        
        // 保存当前调整后的图像数据
            currentImageData = finalImageData;
            // 绘制调整后的图像
            adjustedCtx.putImageData(finalImageData, 0, 0);
    }
    
    // 锐化滤镜函数
        function applySharpen(imageData, amount) {
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;
            const result = new ImageData(width, height);
            const resultData = result.data;
            
            // 锐化卷积核
            const kernel = [
                0, -1, 0,
                -1, 5, -1,
                0, -1, 0
            ];
            
            // 应用卷积
            const scale = 1;
            const bias = 0;
            
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    let r = 0, g = 0, b = 0;
                    
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const kernelIdx = (ky + 1) * 3 + (kx + 1);
                            const imgIdx = ((y + ky) * width + (x + kx)) * 4;
                            const weight = kernel[kernelIdx] * (amount / 100);
                            
                            r += data[imgIdx] * weight;
                            g += data[imgIdx + 1] * weight;
                            b += data[imgIdx + 2] * weight;
                        }
                    }
                    
                    const idx = (y * width + x) * 4;
                    resultData[idx] = Math.max(0, Math.min(255, r / scale + bias));
                    resultData[idx + 1] = Math.max(0, Math.min(255, g / scale + bias));
                    resultData[idx + 2] = Math.max(0, Math.min(255, b / scale + bias));
                    resultData[idx + 3] = data[idx + 3]; // 保持alpha不变
                }
            }
            
            // 处理边缘像素（简单复制原图）
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                        const idx = (y * width + x) * 4;
                        resultData[idx] = data[idx];
                        resultData[idx + 1] = data[idx + 1];
                        resultData[idx + 2] = data[idx + 2];
                        resultData[idx + 3] = data[idx + 3];
                    }
                }
            }
            
            return result;
        }
        
        // 曝光调整函数
        function applyExposure(imageData, amount) {
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;
            const result = new ImageData(width, height);
            const resultData = result.data;
            
            // 曝光调整系数
            const exposureFactor = 1 + (amount / 100);
            
            for (let i = 0; i < data.length; i += 4) {
                resultData[i] = Math.max(0, Math.min(255, data[i] * exposureFactor));
                resultData[i + 1] = Math.max(0, Math.min(255, data[i + 1] * exposureFactor));
                resultData[i + 2] = Math.max(0, Math.min(255, data[i + 2] * exposureFactor));
                resultData[i + 3] = data[i + 3]; // 保持alpha不变
            }
            
            return result;
        }
        
        // 模糊效果函数 - 使用高斯模糊的简化版本
        function applyBlur(imageData, amount) {
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;
            const result = new ImageData(width, height);
            const resultData = result.data;
            
            // 计算模糊半径
            const radius = Math.max(1, Math.min(amount, 20));
            const kernelSize = radius * 2 + 1;
            
            // 创建高斯模糊核
            const kernel = [];
            let sum = 0;
            const sigma = radius / 3;
            
            for (let i = 0; i < kernelSize; i++) {
                const x = i - radius;
                const value = Math.exp(-(x * x) / (2 * sigma * sigma));
                kernel.push(value);
                sum += value;
            }
            
            // 归一化核
            for (let i = 0; i < kernelSize; i++) {
                kernel[i] /= sum;
            }
            
            // 横向模糊
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let r = 0, g = 0, b = 0;
                    
                    for (let k = -radius; k <= radius; k++) {
                        const px = Math.max(0, Math.min(width - 1, x + k));
                        const idx = (y * width + px) * 4;
                        const weight = kernel[k + radius];
                        
                        r += data[idx] * weight;
                        g += data[idx + 1] * weight;
                        b += data[idx + 2] * weight;
                    }
                    
                    const idx = (y * width + x) * 4;
                    resultData[idx] = r;
                    resultData[idx + 1] = g;
                    resultData[idx + 2] = b;
                    resultData[idx + 3] = data[idx + 3]; // 保持alpha不变
                }
            }
            
            // 纵向模糊
            const tempData = new Uint8ClampedArray(resultData);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let r = 0, g = 0, b = 0;
                    
                    for (let k = -radius; k <= radius; k++) {
                        const py = Math.max(0, Math.min(height - 1, y + k));
                        const idx = (py * width + x) * 4;
                        const weight = kernel[k + radius];
                        
                        r += tempData[idx] * weight;
                        g += tempData[idx + 1] * weight;
                        b += tempData[idx + 2] * weight;
                    }
                    
                    const idx = (y * width + x) * 4;
                    resultData[idx] = r;
                    resultData[idx + 1] = g;
                    resultData[idx + 2] = b;
                    resultData[idx + 3] = tempData[idx + 3]; // 保持alpha不变
                }
            }
            
            return result;
        }
        
        // 噪点效果函数
        function applyNoise(imageData, amount) {
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;
            const result = new ImageData(width, height);
            const resultData = result.data;
            
            // 使用PIXI.js生成噪点
            if (typeof PIXI !== 'undefined') {
                // 为每个像素生成随机噪点
                for (let i = 0; i < data.length; i += 4) {
                    // 生成随机值
                    const noiseValue = (Math.random() - 0.5) * 2 * (amount / 100) * 255;
                    
                    resultData[i] = Math.max(0, Math.min(255, data[i] + noiseValue));
                    resultData[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noiseValue));
                    resultData[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noiseValue));
                    resultData[i + 3] = data[i + 3]; // 保持alpha不变
                }
            } else {
                // 如果PIXI.js不可用，使用简单的JS随机数生成器
                for (let i = 0; i < data.length; i += 4) {
                    const noiseValue = (Math.random() - 0.5) * 2 * (amount / 100) * 255;
                    
                    resultData[i] = Math.max(0, Math.min(255, data[i] + noiseValue));
                    resultData[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noiseValue));
                    resultData[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noiseValue));
                    resultData[i + 3] = data[i + 3]; // 保持alpha不变
                }
            }
            
            return result;
        }
        
        // 暗角效果函数
        function applyVignette(imageData, amount) {
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;
            const result = new ImageData(width, height);
            const resultData = result.data;
            
            // 计算图像中心和最大距离
            const centerX = width / 2;
            const centerY = height / 2;
            const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
            
            // 暗角强度系数
            const vignetteStrength = amount / 100;
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    // 计算当前像素到中心的距离
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // 计算暗角因子 (距离越远，暗角越强)
                    const vignetteFactor = 1 - (distance / maxDistance) * vignetteStrength;
                    
                    const idx = (y * width + x) * 4;
                    resultData[idx] = Math.max(0, Math.min(255, data[idx] * vignetteFactor));
                    resultData[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] * vignetteFactor));
                    resultData[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] * vignetteFactor));
                    resultData[idx + 3] = data[idx + 3]; // 保持alpha不变
                }
            }
            
            return result;
        }
    
    // RGB转HSL
    function rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
            h = s = 0; // 灰度
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            
            h /= 6;
        }
        
        return [h * 360, s, l];
    }
    
    // HSL转RGB
    function hslToRgb(h, s, l) {
        h /= 360;
        
        let r, g, b;
        
        if (s === 0) {
            r = g = b = l; // 灰度
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
    
    // 绑定滑块事件监听器
    brightnessSlider.addEventListener('input', updateAdjustedImage);
    contrastSlider.addEventListener('input', updateAdjustedImage);
    saturationSlider.addEventListener('input', updateAdjustedImage);
    hueSlider.addEventListener('input', updateAdjustedImage);
    sharpenSlider.addEventListener('input', updateAdjustedImage);
    gammaSlider.addEventListener('input', updateAdjustedImage);
    exposureSlider.addEventListener('input', updateAdjustedImage);
    blurSlider.addEventListener('input', updateAdjustedImage);
    noiseSlider.addEventListener('input', updateAdjustedImage);
    vignetteSlider.addEventListener('input', updateAdjustedImage);
    
    // 绑定输入框事件监听器，实现精准调节
    brightnessInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(-100, Math.min(100, value));
        brightnessSlider.value = value;
        updateAdjustedImage();
    });
    
    contrastInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(-100, Math.min(100, value));
        contrastSlider.value = value;
        updateAdjustedImage();
    });
    
    saturationInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(-100, Math.min(100, value));
        saturationSlider.value = value;
        updateAdjustedImage();
    });
    
    hueInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(-180, Math.min(180, value));
        hueSlider.value = value;
        updateAdjustedImage();
    });
    
    sharpenInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(0, Math.min(100, value));
        sharpenSlider.value = value;
        updateAdjustedImage();
    });
    
    gammaInput.addEventListener('change', function() {
        let value = parseFloat(this.value);
        if (isNaN(value)) value = 1;
        value = Math.max(0.1, Math.min(3, value));
        gammaSlider.value = value;
        updateAdjustedImage();
    });
    
    exposureInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(-100, Math.min(100, value));
        exposureSlider.value = value;
        updateAdjustedImage();
    });
    
    blurInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(0, Math.min(20, value));
        blurSlider.value = value;
        updateAdjustedImage();
    });
    
    noiseInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(0, Math.min(100, value));
        noiseSlider.value = value;
        updateAdjustedImage();
    });
    
    vignetteInput.addEventListener('change', function() {
        let value = parseInt(this.value);
        if (isNaN(value)) value = 0;
        value = Math.max(0, Math.min(100, value));
        vignetteSlider.value = value;
        updateAdjustedImage();
    });
    
    // 重置按钮
    resetBtn.addEventListener('click', () => {
        brightnessSlider.value = 0;
        contrastSlider.value = 0;
        saturationSlider.value = 0;
        hueSlider.value = 0;
        sharpenSlider.value = 0;
        gammaSlider.value = 1;
        exposureSlider.value = 0;
        blurSlider.value = 0;
        noiseSlider.value = 0;
        vignetteSlider.value = 0;
        updateAdjustedImage();
    });
    
    // 确认按钮
    confirmBtn.addEventListener('click', () => {
        const widget = node.widgets.find(w => w.name === "color_data");
        if (widget) {
            const colorAdjustData = {
                brightness: parseInt(brightnessSlider.value),
                contrast: parseInt(contrastSlider.value),
                saturation: parseInt(saturationSlider.value),
                hue: parseInt(hueSlider.value),
                sharpen: parseInt(sharpenSlider.value),
                gamma: parseFloat(gammaSlider.value),
                exposure: parseInt(exposureSlider.value),
                blur: parseInt(blurSlider.value),
                noise: parseInt(noiseSlider.value),
                vignette: parseInt(vignetteSlider.value)
            };
            widget.value = JSON.stringify(colorAdjustData);
            // 确保数据变更被正确通知
            if (node.onWidgetValueChanged) {
                node.onWidgetValueChanged(widget, widget.value);
            } else if (node.onWidgetChanged) {
                node.onWidgetChanged(widget, widget.value);
            }
            // 显式通知画布更新
            app.graph.setDirtyCanvas(true, false);
        }
        closeModal(modal);
    });
    
    // 取消按钮
    cancelBtn.addEventListener('click', () => {
        closeModal(modal);
    });
    
    // 添加按钮点击事件监听器
    // 亮度加减按钮
    brightnessMinusBtn.addEventListener('click', () => {
        let value = parseInt(brightnessSlider.value) - 1;
        value = Math.max(-100, Math.min(100, value));
        brightnessSlider.value = value;
        brightnessInput.value = value;
        updateAdjustedImage();
    });
    
    brightnessPlusBtn.addEventListener('click', () => {
        let value = parseInt(brightnessSlider.value) + 1;
        value = Math.max(-100, Math.min(100, value));
        brightnessSlider.value = value;
        brightnessInput.value = value;
        updateAdjustedImage();
    });
    
    // 对比度加减按钮
    contrastMinusBtn.addEventListener('click', () => {
        let value = parseInt(contrastSlider.value) - 1;
        value = Math.max(-100, Math.min(100, value));
        contrastSlider.value = value;
        contrastInput.value = value;
        updateAdjustedImage();
    });
    
    contrastPlusBtn.addEventListener('click', () => {
        let value = parseInt(contrastSlider.value) + 1;
        value = Math.max(-100, Math.min(100, value));
        contrastSlider.value = value;
        contrastInput.value = value;
        updateAdjustedImage();
    });
    
    // 饱和度加减按钮
    saturationMinusBtn.addEventListener('click', () => {
        let value = parseInt(saturationSlider.value) - 1;
        value = Math.max(-100, Math.min(100, value));
        saturationSlider.value = value;
        saturationInput.value = value;
        updateAdjustedImage();
    });
    
    saturationPlusBtn.addEventListener('click', () => {
        let value = parseInt(saturationSlider.value) + 1;
        value = Math.max(-100, Math.min(100, value));
        saturationSlider.value = value;
        saturationInput.value = value;
        updateAdjustedImage();
    });
    
    // 色相加减按钮
    hueMinusBtn.addEventListener('click', () => {
        let value = parseInt(hueSlider.value) - 1;
        value = Math.max(-180, Math.min(180, value));
        hueSlider.value = value;
        hueInput.value = value;
        updateAdjustedImage();
    });
    
    huePlusBtn.addEventListener('click', () => {
        let value = parseInt(hueSlider.value) + 1;
        value = Math.max(-180, Math.min(180, value));
        hueSlider.value = value;
        hueInput.value = value;
        updateAdjustedImage();
    });
    
    // 锐化加减按钮
    sharpenMinusBtn.addEventListener('click', () => {
        let value = parseInt(sharpenSlider.value) - 1;
        value = Math.max(0, Math.min(100, value));
        sharpenSlider.value = value;
        sharpenInput.value = value;
        updateAdjustedImage();
    });
    
    sharpenPlusBtn.addEventListener('click', () => {
        let value = parseInt(sharpenSlider.value) + 1;
        value = Math.max(0, Math.min(100, value));
        sharpenSlider.value = value;
        sharpenInput.value = value;
        updateAdjustedImage();
    });
    
    // 伽马加减按钮
    gammaMinusBtn.addEventListener('click', () => {
        let value = parseFloat(gammaSlider.value) - 0.1;
        value = Math.max(0.1, Math.min(3, value));
        gammaSlider.value = value.toFixed(1);
        gammaInput.value = value.toFixed(1);
        updateAdjustedImage();
    });
    
    gammaPlusBtn.addEventListener('click', () => {
        let value = parseFloat(gammaSlider.value) + 0.1;
        value = Math.max(0.1, Math.min(3, value));
        gammaSlider.value = value.toFixed(1);
        gammaInput.value = value.toFixed(1);
        updateAdjustedImage();
    });
    
    // 曝光加减按钮
    exposureMinusBtn.addEventListener('click', () => {
        let value = parseInt(exposureSlider.value) - 1;
        value = Math.max(-100, Math.min(100, value));
        exposureSlider.value = value;
        exposureInput.value = value;
        updateAdjustedImage();
    });
    
    exposurePlusBtn.addEventListener('click', () => {
        let value = parseInt(exposureSlider.value) + 1;
        value = Math.max(-100, Math.min(100, value));
        exposureSlider.value = value;
        exposureInput.value = value;
        updateAdjustedImage();
    });
    
    // 模糊加减按钮
    blurMinusBtn.addEventListener('click', () => {
        let value = parseInt(blurSlider.value) - 1;
        value = Math.max(0, Math.min(20, value));
        blurSlider.value = value;
        blurInput.value = value;
        updateAdjustedImage();
    });
    
    blurPlusBtn.addEventListener('click', () => {
        let value = parseInt(blurSlider.value) + 1;
        value = Math.max(0, Math.min(20, value));
        blurSlider.value = value;
        blurInput.value = value;
        updateAdjustedImage();
    });
    
    // 噪点加减按钮
    noiseMinusBtn.addEventListener('click', () => {
        let value = parseInt(noiseSlider.value) - 1;
        value = Math.max(0, Math.min(100, value));
        noiseSlider.value = value;
        noiseInput.value = value;
        updateAdjustedImage();
    });
    
    noisePlusBtn.addEventListener('click', () => {
        let value = parseInt(noiseSlider.value) + 1;
        value = Math.max(0, Math.min(100, value));
        noiseSlider.value = value;
        noiseInput.value = value;
        updateAdjustedImage();
    });
    
    // 暗角加减按钮
    vignetteMinusBtn.addEventListener('click', () => {
        let value = parseInt(vignetteSlider.value) - 1;
        value = Math.max(0, Math.min(100, value));
        vignetteSlider.value = value;
        vignetteInput.value = value;
        updateAdjustedImage();
    });
    
    vignettePlusBtn.addEventListener('click', () => {
        let value = parseInt(vignetteSlider.value) + 1;
        value = Math.max(0, Math.min(100, value));
        vignetteSlider.value = value;
        vignetteInput.value = value;
        updateAdjustedImage();
    });
    
    // 确保模态框在图像加载后才显示
    modal.style.display = 'flex';
}

// ======================= ZML_PanoViewer 节点前端逻辑=======================  
app.registerExtension({  
    name: "ZML.PanoViewer",  
    async beforeRegisterNodeDef(nodeType, nodeData, app) {  
        if (nodeData.name === "ZML_PanoViewer") {  
            const onNodeCreated = nodeType.prototype.onNodeCreated;  
            nodeType.prototype.onNodeCreated = function () {  
                onNodeCreated?.apply(this, arguments);  
                
                // 添加预览方式选择框  
                this.addWidget("combo", "预览方式", "360全景", (v) => {  
                    // 当预览方式改变时，可以在这里添加任何必要的处理  
                    app.graph.setDirtyCanvas(true, true);  
                }, { values: ["360全景", "动图平面预览"] });  
                
                // 添加一个按钮来触发预览模态框  
                this.addWidget("button", "预览全景图", null, () => showPanoViewerModal(this));  
            };  
        }  
    },  
});

async function showPanoViewerModal(node) {
    // 1. 检查上游节点是否有图像输出
    const imageNode = node.getInputNode(0);
    if (!imageNode || !imageNode.imgs || imageNode.imgs.length === 0 || !imageNode.imgs[0].src) {
        alert("错误：请连接一个有效的全景图像输入！");
        return;
    }
    const imageUrl = imageNode.imgs[0].src;

    // 获取遮罩图像（如果有连接）
    let maskUrl = null;
    const maskNode = node.getInputNode(1);
    if (maskNode && maskNode.imgs && maskNode.imgs.length > 0 && maskNode.imgs[0].src) {
        maskUrl = maskNode.imgs[0].src;
    }
    
    // 2. 加载 Three.js 库 (只加载一次)
    if (typeof THREE === 'undefined') {
        const threeJsPath = new URL('../lib/three.min.js', import.meta.url).href;
        await loadScript(threeJsPath);
    }

    // 3. 获取用户选择的预览方式
    const previewModeWidget = node.widgets.find(w => w.name === "预览方式");
    const previewMode = previewModeWidget ? previewModeWidget.value : "360全景";

    // 4. 构建模态框 HTML (包含一个用于Three.js渲染的canvas)
    const modalHtml = `
        <div id="zml-pano-viewer-modal" class="zml-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; justify-content: center; align-items: center; z-index: 1002; flex-direction: column;">
            <p style="color: white; margin-bottom: 10px;">${previewMode === "360全景" ? '拖动鼠标左右旋转，滚轮缩放，按ESC关闭' : '拖动鼠标轻微移动视角，滚轮缩放，360°旋转，按ESC关闭'}</p>
            <div id="zml-pano-viewer-container" style="width: 80vw; height: 70vh; max-width: 1200px; max-height: 700px; background-color: #000; overflow: hidden; position: relative;
                /* 简约好看的边框样式 */
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                box-shadow: 0 0 20px rgba(255, 255, 255, 0.1);">
                <canvas id="zml-pano-canvas" style="display: block; width: 100%; height: 100%;"></canvas>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 15px;">
                ${previewMode === "360全景" ? '<button id="zml-view-toggle-btn" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;">切换为外部视角</button>' : ''}
                ${previewMode === "动图平面预览" ? '<button id="zml-rotate-360-btn" style="padding: 10px 20px; background-color: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer;">360°旋转</button>' : ''}
                <button id="zml-close-pano-viewer-btn" style="padding: 10px 20px; background-color: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer;">关闭预览</button>
            </div>
            <style>
                /* 基本的模态框和按钮样式 */
                .zml-modal button {
                    background-color: #555;
                    border: 1px solid #777;
                    padding: 5px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    color: white;
                }
                .zml-modal button:hover {
                    background-color: #666;
                }
                /* 使按钮在激活时有视觉反馈 */
                .zml-modal button.active {
                  background-color: #007bff;
                  border-color: #007bff;
                }
            </style>
        </div>
    `;
    const modal = createModal(modalHtml, 'zml-pano-viewer-modal');
    const container = modal.querySelector('#zml-pano-viewer-container');
    const canvas = modal.querySelector('#zml-pano-canvas');

    let renderer, scene, camera, mesh;
    let isDragging = false;
    let startX = 0, startY = 0;
    let phi = Math.PI / 2, theta = 0; // 初始视角：phi为PI/2 (水平方向), theta为0 (正前方)
    let fov = 60; // 降低初始视场角，减弱透视效果
    let isInsideView = true; // 初始为内部视角
    let cameraDistance = 1000; // 外部视角时的相机距离
    let currentCameraPosition = new THREE.Vector3(0, 0, 0); // 当前相机位置
    let resizeObserver;
    // 不再需要旋转控制变量，已默认完全不限制旋转
    // 平移控制变量
    let isPanning = false;
    let planePositionX = 0, planePositionY = 0; // 平面图像的平移位置
    let startPanX = 0, startPanY = 0; // 平移起始位置

    // 销毁 Three.js 实例的函数
    function disposeThreeJs() {
        if (mesh) {
            if (mesh.material) mesh.material.dispose();
            if (mesh.geometry) mesh.geometry.dispose();
            mesh = null;
        }
        if (renderer) {
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement = null; // 清除DOM引用
            renderer = null;
        }
        if (scene) scene = null;
        if (camera) camera = null;
        // 旋转相关的清理已移除，因为现在使用手动旋转模式
        // 移除所有事件监听器
        container.removeEventListener('mousedown', onMouseDown);
        container.removeEventListener('mousemove', onMouseMove);
        container.removeEventListener('mouseup', onMouseUp);
        container.removeEventListener('mouseleave', onMouseUp);
        container.removeEventListener('wheel', onMouseWheel);
        document.removeEventListener('keyup', onDocumentKeyUp);
        // 移除resizeObserver
        if (resizeObserver) resizeObserver.disconnect();
    }
    
    // 视角切换按钮事件处理（仅360全景模式）
    if (previewMode === "360全景") {
        const viewToggleBtn = modal.querySelector('#zml-view-toggle-btn');
        viewToggleBtn.onclick = () => {
            if (!camera || !mesh) return;
            
            // 切换视角模式
            isInsideView = !isInsideView;
            
            // 更新按钮文本
            viewToggleBtn.textContent = isInsideView ? '切换为外部视角' : '切换为内部视角';
            
            // 重新创建几何体并设置正确的面朝向
            const texture = mesh.material.map;
            const newGeometry = new THREE.SphereGeometry(500, 60, 40);
            
            if (isInsideView) {
                newGeometry.scale(-1, 1, 1); // 内部视角需要反转面朝向
                camera.position.set(0, 0, 0); // 移回中心
                currentCameraPosition.set(0, 0, 0);
            } else {
                // 外部视角不需要反转，且相机移到球体外部
                const x = cameraDistance * Math.sin(phi) * Math.sin(theta);
                const y = cameraDistance * Math.cos(phi);
                const z = cameraDistance * Math.sin(phi) * Math.cos(theta);
                camera.position.set(-x, -y, -z); // 移动到球体外部，与视角方向相反
                currentCameraPosition.set(-x, -y, -z);
            }
            
            // 移除旧网格并添加新网格
            scene.remove(mesh);
            mesh.geometry.dispose();
            
            const newMesh = new THREE.Mesh(newGeometry, mesh.material.clone());
            mesh = newMesh;
            scene.add(mesh);
            
            // 更新相机位置
            updateCameraPosition();
        };
    } else if (previewMode === "动图平面预览") {
        // 不再需要360度旋转按钮，已默认完全不限制旋转
        // 移除相关按钮或隐藏它
        const rotateBtn = modal.querySelector('#zml-rotate-360-btn');
        if (rotateBtn) {
            rotateBtn.style.display = 'none'; // 隐藏旋转控制按钮
        }
    }
    
    // 移除自动旋转相关函数，改为支持用户手动360度旋转
    
    // 关闭模态框并清理
    modal.querySelector('#zml-close-pano-viewer-btn').onclick = () => {
        disposeThreeJs();
        closeModal(modal);
    };

    // ESC 键关闭
    function onDocumentKeyUp(event) {
        if (event.key === 'Escape') {
            disposeThreeJs();
            closeModal(modal);
        }
    }
    document.addEventListener('keyup', onDocumentKeyUp);

    // 加载图像并初始化 Three.js 场景
    const loader = new THREE.TextureLoader();
    // 设置纹理参数以解决图像发白问题
    loader.load(imageUrl, async (texture) => {
        // 关键参数：设置纹理的encoding和其他属性
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        // 创建 Three.js 场景
        scene = new THREE.Scene();
        
        // 创建相机
        camera = new THREE.PerspectiveCamera(fov, container.clientWidth / container.clientHeight, 0.1, 2000);

        // 创建渲染器
        renderer = new THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: true, 
            alpha: true, 
            premultipliedAlpha: true // 重要：设置渲染器的预乘Alpha
        });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        // 设置渲染器色彩空间，确保正确的颜色显示
        renderer.outputEncoding = THREE.sRGBEncoding;

        if (previewMode === "360全景") {
            // 创建球体几何体（360全景模式）
            const geometry = new THREE.SphereGeometry(500, 60, 40);
            
            // 内部视角需要反转面朝向
            if (isInsideView) {
                geometry.scale(-1, 1, 1);
            }

            // 创建材质
            const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
            
            // 创建网格 (Mesh) 并添加到场景
            mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);

            // 初始化相机位置
            camera.position.set(0, 0, 0); // 相机在球体中心
        } else {
            // 动图平面预览模式 - 完整优化显示和交互体验
            // 计算图像宽高比
            const img = new Image();
            await new Promise((resolve) => {
                img.onload = resolve;
                img.src = imageUrl;
            });
            const aspectRatio = img.width / img.height;
            
            // 创建平面几何体
            const planeSize = 1000; // 使用足够大的尺寸，但保持清晰度
            const planeWidth = planeSize;
            const planeHeight = planeSize / aspectRatio;
            const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 1);
            
            // 根据图像比例调整相机的FOV，确保图像完全填充视口
            const containerAspect = container.clientWidth / container.clientHeight;
            let adjustedFov = fov;
            
            if (aspectRatio > containerAspect) {
                // 图像更宽，需要调整垂直视场角
                adjustedFov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * (containerAspect / aspectRatio)) * 180 / Math.PI;
            } else {
                // 图像更高，使用原始视场角
                adjustedFov = fov;
            }
            camera.fov = adjustedFov;
            
            // 创建材质 - 优化参数组合防止图像发白
            let material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true,
                premultiplyAlpha: true,
                toneMapped: false // 禁用色调映射，保持原始颜色
            });
            
            // 如果有遮罩图像，创建带遮罩的纹理
            if (maskUrl) {
                try {
                    const maskedTexture = await createMaskedTexture(imageUrl, maskUrl);
                    // 为遮罩材质也应用相同的优化参数
                    material = new THREE.MeshBasicMaterial({
                        map: maskedTexture,
                        side: THREE.DoubleSide,
                        transparent: true,
                        premultiplyAlpha: true,
                        toneMapped: false
                    });
                } catch (error) {
                    console.error("应用遮罩失败:", error);
                }
            }
            
            // 计算合适的Z轴位置，确保图像在视口中正确显示
            // 使用视场角计算所需距离
            const zDistance = - (planeWidth / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
            
            // 图像缩放系数（用于实现缩放功能）
            let zoomFactor = 1.0;
            
            // 创建网格并添加到场景
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.z = zDistance;
            scene.add(mesh);

            // 初始化相机位置
            camera.position.set(0, 0, 0);
            camera.lookAt(0, 0, zDistance);
            
            // 保存平面和缩放信息，供后续交互使用
            window.zmlPlaneMesh = mesh;
            window.zmlPlaneZoomFactor = zoomFactor;
            window.zmlPlaneOriginalZ = zDistance;
            window.zmlPlaneWidth = planeWidth;
            window.zmlPlaneHeight = planeHeight;
        }

        // 初始化相机视角
        updateCameraPosition();

        // 渲染循环
        const animate = () => {
            requestAnimationFrame(animate);
            if (renderer && camera && scene) { // 确保渲染器未被销毁
                renderer.render(scene, camera);
            }
        };
        animate();

    }, undefined, error => {
        console.error('Three.js: 无法加载全景图像', error);
        alert("无法加载全景图像。请检查源图像或控制台错误。");
        disposeThreeJs();
        closeModal(modal);
    });

    // --- 交互逻辑 ---
    
    function updateCameraPosition() {
        if (!camera || !mesh) return;
        
        // 将球坐标 (phi, theta) 转换为笛卡尔坐标，设置相机 Y 轴为向上
        const directionX = Math.sin(phi) * Math.sin(theta);
        const directionY = Math.cos(phi);
        const directionZ = Math.sin(phi) * Math.cos(theta);
        
        if (previewMode === "360全景") {
            // 对于360全景模式
            if (!isInsideView) {
                // 外部视角，更新相机位置
                const x = cameraDistance * directionX;
                const y = cameraDistance * directionY;
                const z = cameraDistance * directionZ;
                camera.position.set(-x, -y, -z); // 移动到球体外部，与视角方向相反
                currentCameraPosition.set(-x, -y, -z);
            }
            
            // 相机看向的方向
            const lookAtX = isInsideView ? directionX : 0;
            const lookAtY = isInsideView ? directionY : 0;
            const lookAtZ = isInsideView ? directionZ : 0;
            
            camera.lookAt(lookAtX, lookAtY, lookAtZ);
        } else {
            // 对于动图平面预览模式：完全不限制旋转
            // 移除所有旋转限制，允许360度自由旋转
            
            // 旋转网格而不是相机，以创建旋转效果
            mesh.rotation.y = theta;
            mesh.rotation.x = phi - Math.PI/2;
            
            // 应用平移
            mesh.position.x = planePositionX;
            mesh.position.y = planePositionY;
            
            // 相机始终看向平面中心
            camera.lookAt(mesh.position);
        }
        
        camera.updateProjectionMatrix(); // 更新投影矩阵以应用 FOV
    }

    function onMouseDown(event) {
        isDragging = true;
        startX = event.clientX;
        startY = event.clientY;
        
        // 如果按下了Ctrl键并且是鼠标左键，进入平移模式
        if (event.ctrlKey && event.button === 0) {
            isPanning = true;
            startPanX = planePositionX;
            startPanY = planePositionY;
            container.style.cursor = 'move';
        } else {
            isPanning = false;
            container.style.cursor = 'grabbing';
        }
    }

    function onMouseMove(event) {
        if (!isDragging) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;

        if (isPanning && previewMode !== "360全景") {
            // 平移模式
            const panSpeed = 5.0 / (window.zmlPlaneZoomFactor || 1); // 根据缩放调整平移速度
            planePositionX = startPanX + dx * panSpeed;
            planePositionY = startPanY - dy * panSpeed; // 注意这里是减去，因为Y轴在Three.js中是向上的
        } else {
            // 旋转模式
            if (previewMode === "360全景") {
                // 360全景模式：提高旋转灵敏度并修复方向问题
                theta -= dx * 0.004; // 提高灵敏度
                phi += dy * 0.004; // 提高灵敏度，phi使用相反符号，修复左下、右下方向问题
            } else {
                // 动图平面预览模式：降低旋转敏感度
                theta += dx * 0.002; // 调整水平旋转速度
                phi += dy * 0.002; // 调整垂直旋转速度
            }

            // 完全不限制旋转范围，允许360度自由旋转
        }

        startX = event.clientX;
        startY = event.clientY;
        
        updateCameraPosition();
    }

    function onMouseUp() {
        isDragging = false;
        isPanning = false;
        container.style.cursor = 'grab';
    }

    function onMouseWheel(event) {
        event.preventDefault(); // 阻止页面滚动
        
        if (previewMode === "360全景") {
            if (isInsideView) {
                // 内部视角：调整 FOV 进行缩放
                fov += event.deltaY * 0.05;
                fov = Math.max(40, Math.min(90, fov)); // 调整 FOV 范围，减弱透视效果
                camera.fov = fov;
            } else {
                // 外部视角：调整相机距离进行缩放
                cameraDistance += event.deltaY * 0.5;
                cameraDistance = Math.max(500, Math.min(4000, cameraDistance)); // 进一步扩大距离范围，允许更远的视角
            }
        } else {
            // 动图平面预览模式：实现缩放功能
            if (!window.zmlPlaneMesh) return;
            
            // 调整缩放系数
            let zoomSpeed = 0.1;
            if (event.deltaY > 0) {
                // 缩小
                window.zmlPlaneZoomFactor = Math.max(0.1, window.zmlPlaneZoomFactor - zoomSpeed);
            } else {
                // 放大
                window.zmlPlaneZoomFactor = Math.min(5, window.zmlPlaneZoomFactor + zoomSpeed);
            }
            
            // 应用缩放
            const scale = window.zmlPlaneZoomFactor;
            window.zmlPlaneMesh.scale.set(scale, scale, scale);
        }
        
        camera.updateProjectionMatrix();
        updateCameraPosition();
    }

    // 绑定事件监听器
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseUp); // 鼠标离开容器时也视为mouseup
    container.addEventListener('wheel', onMouseWheel, { passive: false }); // passive: false 允许 preventDefault

    // 初始鼠标样式
    container.style.cursor = 'grab';

    // 窗口大小调整处理
    const onWindowResize = () => {
        if (!renderer || !camera || !container) return;
        
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;

        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
    };

    // 监听容器大小变化
    resizeObserver = new ResizeObserver(onWindowResize);
    resizeObserver.observe(container);

    // 首次调用调整大小函数
    onWindowResize();

    // 创建带遮罩的纹理
    async function createMaskedTexture(imageUrl, maskUrl) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 加载原图和遮罩图
        const [originalImg, maskImg] = await Promise.all([
            loadImage(imageUrl),
            loadImage(maskUrl)
        ]);
        
        // 设置canvas大小
        canvas.width = originalImg.width;
        canvas.height = originalImg.height;
        
        // 绘制原图
        ctx.drawImage(originalImg, 0, 0);
        
        // 创建遮罩效果（使用黑色区域作为透明区域）
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
        
        // 转换为Three.js纹理
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        
        return texture;
    }

    // 辅助函数：加载图像
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`无法加载图像: ${src}`));
            img.src = src;
        });
    }
}

