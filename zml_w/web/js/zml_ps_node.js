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
// ======================= ZML_PanoViewer 节点前端逻辑=======================
app.registerExtension({
    name: "ZML.PanoViewer",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_PanoViewer") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
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

    // 2. 加载 Three.js 库 (只加载一次)
    if (typeof THREE === 'undefined') {
        const threeJsPath = new URL('../lib/three.min.js', import.meta.url).href;
        await loadScript(threeJsPath);
    }

    // 3. 构建模态框 HTML (包含一个用于Three.js渲染的canvas)
    const modalHtml = `
        <div id="zml-pano-viewer-modal" class="zml-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 1002; flex-direction: column;">
            <p style="color: white; margin-bottom: 10px;">拖动鼠标左右旋转，滚轮缩放，按ESC关闭</p>
            <div id="zml-pano-viewer-container" style="width: 80vw; height: 80vh; max-width: 1200px; max-height: 800px; background-color: #000; overflow: hidden; position: relative;">
                <canvas id="zml-pano-canvas" style="display: block;"></canvas>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <button id="zml-view-toggle-btn" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;">切换为外部视角</button>
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
    let fov = 75; // 初始视场角 (Field of View)
    let isInsideView = true; // 初始为内部视角
    let cameraDistance = 1000; // 外部视角时的相机距离
    let currentCameraPosition = new THREE.Vector3(0, 0, 0); // 当前相机位置

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
    
    // 视角切换按钮事件处理
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
        updateCameraPostion();
    };
    
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
    loader.load(imageUrl, texture => {
        // 创建 Three.js 场景
        scene = new THREE.Scene();
        
        // 创建相机
        camera = new THREE.PerspectiveCamera(fov, container.clientWidth / container.clientHeight, 0.1, 2000);
        camera.position.set(0, 0, 0); // 相机在球体中心

        // 创建渲染器
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);

        // 创建球体几何体
        // THREE.SphereGeometry(radius, widthSegments, heightSegments)
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        
        // 内部视角需要反转面朝向
        if (isInsideView) {
            geometry.scale(-1, 1, 1);
        }

        // 创建材质
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }); // 使用DoubleSide确保内外都能看到纹理
        
        // 创建网格 (Mesh) 并添加到场景
        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // 初始化相机视角
        updateCameraPostion();

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
    
    function updateCameraPostion() {
        // 将球坐标 (phi, theta) 转换为笛卡尔坐标，设置相机 Y 轴为向上
        // phi: 垂直角度 (0到PI，0是正上方，PI是正下方，PI/2是水平)
        // theta: 水平角度 (0到2*PI，决定了水平方向)
        const directionX = Math.sin(phi) * Math.sin(theta);
        const directionY = Math.cos(phi);
        const directionZ = Math.sin(phi) * Math.cos(theta);
        
        // 对于外部视角，更新相机位置
        if (!isInsideView) {
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
        camera.updateProjectionMatrix(); // 更新投影矩阵以应用 FOV
    }

    function onMouseDown(event) {
        isDragging = true;
        startX = event.clientX;
        startY = event.clientY;
        container.style.cursor = 'grabbing';
    }

    function onMouseMove(event) {
        if (!isDragging) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;

        // 调整方向，使拖动方向与视角移动方向一致
        theta -= dx * 0.005; // 水平拖动 (左/右) => 视角跟随移动 (左/右)
        phi += dy * 0.005;   // 垂直拖动 (上/下) => 视角跟随移动 (上/下)

        // 限制 phi (上下视角) 在合理范围，防止翻转
        // phi 从 0 (正上方) 到 PI (正下方)
        // 限制在 0.1 到 PI - 0.1 之间，避免极点问题
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi)); 

        startX = event.clientX;
        startY = event.clientY;
        
        updateCameraPostion();
    }

    function onMouseUp() {
        isDragging = false;
        container.style.cursor = 'grab';
    }

    function onMouseWheel(event) {
        event.preventDefault(); // 阻止页面滚动
        
        if (isInsideView) {
            // 内部视角：调整 FOV 进行缩放
            fov += event.deltaY * 0.05;
            fov = Math.max(10, Math.min(100, fov)); // 限制 FOV 范围 (10度到100度)
            camera.fov = fov;
        } else {
            // 外部视角：调整相机距离进行缩放
            cameraDistance += event.deltaY * 0.5;
            cameraDistance = Math.max(600, Math.min(1500, cameraDistance)); // 限制距离范围
        }
        
        camera.updateProjectionMatrix();
        updateCameraPostion();
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
    const resizeObserver = new ResizeObserver(onWindowResize);
    resizeObserver.observe(container);

    // 首次调用调整大小函数
    onWindowResize();
}

