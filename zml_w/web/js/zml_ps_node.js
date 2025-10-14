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
            </div>
            <div id="zml-warp-tools" class="zml-tool-panel" style="display: flex; align-items: center; gap: 5px;">
                <strong>网格密度:</strong>
                <select id="zml-warp-grid-size"><option value="3">3x3</option><option value="5" selected>5x5</option></select>
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
        let warpMesh, warpGridLines;
        let warpHandles = [];

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
                // 在3x3网格模式下，区分边缘点和中心点
                const is3x3EdgePoint = gridSize === 3 && i !== 4;
                const handleColor = is3x3EdgePoint ? 0xaaaaaa : 0xffdd00; // 边缘点使用灰色，中心点使用黄色
                const handleSize = is3x3EdgePoint ? 5 : 6; // 边缘点略小
                const handleCursor = is3x3EdgePoint ? 'not-allowed' : 'grab'; // 边缘点显示禁止光标
                
                const handle = new PIXI.Graphics().beginFill(handleColor, 0.9).drawCircle(0, 0, handleSize).endFill();
                handle.x = vertices[i*2]; handle.y = vertices[i*2+1];
                handle.interactive = true; 
                handle.cursor = handleCursor; 
                handle.vertexIndex = i;
                handle.on('pointerdown', onHandleDragStart).on('pointerup', onHandleDragEnd).on('pointerupoutside', onHandleDragEnd).on('pointermove', onHandleDragMove);
                pixiApp.stage.addChild(handle);
                warpHandles.push(handle);
            }
            drawWarpGrid();
            setupHandleHoverEffects(); // 启用操作点的鼠标悬停效果
        }
        
        let draggingHandle = null;
        function onHandleDragStart(e) { 
            draggingHandle = this; 
            pixiApp.view.style.cursor = 'grabbing'; 
            e.stopPropagation(); 
            // 拖动开始时增大操作点大小并改变颜色，提供视觉反馈
            this.clear().beginFill(0xff0000, 0.9).drawCircle(0, 0, 8).endFill();
        } 
        function onHandleDragEnd() { 
            if (draggingHandle) { 
                pixiApp.view.style.cursor = 'default'; 
                // 拖动结束时恢复操作点原始大小和颜色
                const gridSize = parseInt(modal.querySelector('#zml-warp-grid-size').value);
                const is3x3EdgePoint = gridSize === 3 && draggingHandle.vertexIndex !== 4;
                const handleColor = is3x3EdgePoint ? 0xaaaaaa : 0xffdd00; // 边缘点使用灰色，中心点使用黄色
                const handleSize = is3x3EdgePoint ? 5 : 6; // 边缘点略小
                
                draggingHandle.clear().beginFill(handleColor, 0.9).drawCircle(0, 0, handleSize).endFill();
                draggingHandle.cursor = is3x3EdgePoint ? 'not-allowed' : 'grab';
                draggingHandle = null; 
            } 
        } 
        function onHandleDragMove(e) { 
            if (draggingHandle) { 
                const gridSize = parseInt(modal.querySelector('#zml-warp-grid-size').value);
                const newPos = e.data.getLocalPosition(draggingHandle.parent);
                const i = draggingHandle.vertexIndex;
                
                // 检查是否是边缘点（在3x3网格模式下，除中心外的点都固定）
                const isEdgePoint = gridSize === 3 && i !== 4; // 3x3网格中心索引为4
                
                // 非边缘点才允许移动
                if (!isEdgePoint) {
                    const oldX = draggingHandle.x;
                    const oldY = draggingHandle.y;
                    const deltaX = newPos.x - oldX;
                    const deltaY = newPos.y - oldY;
                    
                    draggingHandle.x = newPos.x; 
                    draggingHandle.y = newPos.y;
                    warpMesh.vertices[i*2] = newPos.x; 
                    warpMesh.vertices[i*2+1] = newPos.y;
                    
                    // 添加平滑变形效果 - 让相邻的点也产生一定程度的移动
                    const influenceRadius = 1; // 影响范围（相邻的点数）
                    const falloff = 0.5; // 影响力衰减因子
                    
                    // 计算当前点的网格坐标
                    const gridX = i % gridSize;
                    const gridY = Math.floor(i / gridSize);
                    
                    // 遍历相邻的点并应用影响力
                    for (let dy = -influenceRadius; dy <= influenceRadius; dy++) {
                        for (let dx = -influenceRadius; dx <= influenceRadius; dx++) {
                            // 跳过中心点（已经处理过）
                            if (dx === 0 && dy === 0) continue;
                            
                            const neighborX = gridX + dx;
                            const neighborY = gridY + dy;
                            
                            // 检查是否在网格范围内
                            if (neighborX >= 0 && neighborX < gridSize && neighborY >= 0 && neighborY < gridSize) {
                                const neighborIndex = neighborY * gridSize + neighborX;
                                const distance = Math.sqrt(dx*dx + dy*dy); // 计算距离
                                
                                // 检查相邻点是否是边缘点，边缘点不应该被影响
                                const isNeighborEdgePoint = gridSize === 3 && neighborIndex !== 4;
                                
                                if (!isNeighborEdgePoint) {
                                    // 计算影响力因子，距离越远影响越小
                                    const influence = Math.max(0, (influenceRadius - distance + 1) / influenceRadius) * falloff;
                                    
                                    // 应用影响力到相邻点
                                    const neighborHandle = warpHandles[neighborIndex];
                                    if (neighborHandle && neighborHandle !== draggingHandle) {
                                        // 移动相邻操作点
                                        neighborHandle.x += deltaX * influence;
                                        neighborHandle.y += deltaY * influence;
                                        
                                        // 更新网格顶点
                                        warpMesh.vertices[neighborIndex*2] = neighborHandle.x;
                                        warpMesh.vertices[neighborIndex*2+1] = neighborHandle.y;
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // 提示用户边缘点不能移动
                    console.log('边缘点在3x3模式下已固定，无法移动');
                }
                
                warpMesh.dirty = true; // 标记网格需要更新
                drawWarpGrid();
            } 
        }
        
        // 设置处理操作点的函数
        function setupHandleHoverEffects() {
            warpHandles.forEach(handle => {
                // 检查是否是3x3模式下的边缘点
                const gridSize = parseInt(modal.querySelector('#zml-warp-grid-size').value);
                const is3x3EdgePoint = gridSize === 3 && handle.vertexIndex !== 4;
                
                // 边缘点不添加悬停效果
                if (!is3x3EdgePoint) {
                    handle
                        .on('pointerover', function() {
                            // 鼠标悬停时稍微增大操作点并改变颜色
                            if (!draggingHandle) {
                                this.clear().beginFill(0xffaa00, 0.9).drawCircle(0, 0, 7).endFill();
                            }
                        })
                        .on('pointerout', function() {
                            // 鼠标离开时恢复原始大小和颜色
                            if (!draggingHandle) {
                                this.clear().beginFill(0xffdd00, 0.9).drawCircle(0, 0, 6).endFill();
                            }
                        });
                }
            });
        }

        const warpTools = modal.querySelector('#zml-warp-tools');
        
        // 设置warp工具可见
        warpTools.style.display = 'flex';

        modal.querySelector('#zml-warp-grid-size').onchange = setupWarp;
        modal.querySelector('#zml-reset-btn').onclick = () => { setupWarp(); };
        modal.querySelector('#zml-confirm-btn').onclick = async () => {
            // 只保留warp模式的数据处理
            const finalPoints = warpHandles.map(h => [h.x / scale, h.y / scale]);
            const dataToSave = { mode: 'warp', gridSize: parseInt(modal.querySelector('#zml-warp-grid-size').value), points: finalPoints };
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
    <div id="zml-color-adjust-modal" class="zml-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 1001; animation: fadeIn 0.3s ease-out;">
        <div class="zml-color-adjust-container" style="display: flex; background: #222; border-radius: 16px; overflow: hidden; max-width: 90%; max-height: 90%; border: 3px solid #4CAF50; box-shadow: 0 8px 32px rgba(76, 175, 80, 0.3), 0 0 0 2px rgba(76, 175, 80, 0.1); position: relative; z-index: 1;">
        <!-- 卡通风格边框效果 -->
        <style>
            .zml-color-adjust-container::before {
                content: '';
                position: absolute;
                top: -6px;
                left: -6px;
                right: -6px;
                bottom: -6px;
                background: linear-gradient(135deg, #4CAF50, #FFD700, #FF5722, #2196F3);
                border-radius: 20px;
                z-index: -1;
                animation: borderGlow 4s ease-in-out infinite alternate;
            }
            
            @keyframes borderGlow {
                0% {
                    filter: blur(8px);
                    opacity: 0.6;
                }
                100% {
                    filter: blur(12px);
                    opacity: 0.8;
                }
            }
        </style>
            <!-- 左侧工具面板 -->
            <div id="zml-color-toolbar" style="background: #2a2a2a; padding: 15px; border-right: 3px solid #4CAF50; width: 220px; min-width: 220px; display: flex; flex-direction: column; gap: 12px;">
                <div style="font-weight: bold; text-align: center; margin-bottom: 10px; font-size: 16px; color: white; padding: 10px; background: linear-gradient(135deg, #4CAF50, #66BB6A); border-radius: 12px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); box-shadow: 0 4px 8px rgba(0,0,0,0.3), inset 0 2px 0 rgba(255,255,255,0.2); border: 2px solid #81C784; transform: perspective(100px) rotateX(2deg);">ZML 可视化调色</div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
                    <!-- 装饰元素 -->
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #4CAF50, #FFD700);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">亮度:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-brightness-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; overflow: hidden;">-</button>
                            <input type="text" id="zml-brightness-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold; transition: all 0.3s ease;">
                            <button id="zml-brightness-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; overflow: hidden;">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-brightness" min="-100" max="100" value="0" style="width: 100%; height: 6px; background: linear-gradient(to right, #555, #777, #555); outline: none; opacity: 0.7; transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1); -webkit-appearance: none; cursor: grab; border-radius: 3px;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #FF9800, #FF5722);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">对比度:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-contrast-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-contrast-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-contrast-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-contrast" min="-100" max="100" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #E91E63, #9C27B0);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">饱和度:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-saturation-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-saturation-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-saturation-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-saturation" min="-100" max="100" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #2196F3, #00BCD4);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">色相:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-hue-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-hue-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-hue-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-hue" min="-180" max="180" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #795548, #607D8B);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">锐化:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-sharpen-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-sharpen-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-sharpen-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-sharpen" min="0" max="100" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #FFEB3B, #FFC107);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">伽马:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-gamma-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-gamma-input" value="1.0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-gamma-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-gamma" min="0.1" max="3" step="0.1" value="1" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #3F51B5, #673AB7);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">曝光:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-exposure-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-exposure-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-exposure-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-exposure" min="-100" max="100" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #9E9E9E, #757575);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">模糊:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-blur-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-blur-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-blur-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-blur" min="0" max="20" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #607D8B, #455A64);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">噪点:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-noise-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-noise-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-noise-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-noise" min="0" max="100" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div class="zml-tool-panel" style="background: #3a3a3a; border: 2px solid #666; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 3px; background: linear-gradient(90deg, #4CAF50, #455A64);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 12px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">暗角:</strong>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="zml-vignette-minus" class="zml-adjust-btn minus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">-</button>
                            <input type="text" id="zml-vignette-input" value="0" style="width: 45px; text-align: center; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 6px; padding: 2px 4px; font-size: 11px; font-weight: bold;">
                            <button id="zml-vignette-plus" class="zml-adjust-btn plus" style="width: 20px; height: 20px; background: #4a4a4a; border: 2px solid #666; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">+</button>
                        </div>
                    </div>
                    <input type="range" id="zml-vignette" min="0" max="100" value="0" style="width: 100%;" class="zml-slider">
                </div>
                
                <div style="margin-top: auto;"></div>
            </div>
            
            <!-- 右侧预览区域 -->
            <div style="display: flex; flex-direction: column; flex: 1; background: #2a2a2a; border-radius: 0 16px 16px 0;">
                <div id="zml-color-preview-container" style="background-color: #1a1a1a; border: 3px solid #4CAF50; margin: 15px; border-radius: 16px; display: flex; align-items: center; justify-content: center; position: relative; flex: 1; box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.8), 0 6px 15px rgba(0, 0, 0, 0.4), 0 0 15px rgba(76, 175, 80, 0.3); overflow: hidden; transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
                    <div style="text-align: center; color: white; position: relative;">
                        <canvas id="zml-original-preview" style="max-width: 100%; max-height: 100%; display: none;"></canvas>
                        <canvas id="zml-adjusted-preview" style="max-width: 100%; max-height: 100%;"></canvas>
                        <button id="zml-compare-btn" title="按住显示原图" style="position: absolute; bottom: 15px; left: 15px; background-color: rgba(76, 175, 80, 0.95); color: white; border: 3px solid #66cc66; width: 45px; height: 45px; border-radius: 50%; cursor: pointer; z-index: 10; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 10px rgba(76, 175, 80, 0.5);">⇄</button>
                        <button id="zml-reset-view-btn" title="重置视角" style="position: absolute; bottom: 15px; left: 70px; background-color: rgba(66, 133, 244, 0.95); color: white; border: 3px solid #8ab4f8; width: 45px; height: 45px; border-radius: 50%; cursor: pointer; z-index: 10; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 10px rgba(66, 133, 244, 0.5);">⟳</button>
                    </div>
                </div>
                
                <!-- 底部控制按钮 -->
                <div class="zml-editor-controls" style="background: #2a2a2a; padding: 15px; margin-top: -15px; display: flex; justify-content: center; align-items: center; gap: 15px; border-top: 3px solid #4CAF50; border-radius: 0 0 16px 16px; position: relative; overflow: hidden;">
                    <!-- 装饰条 -->
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 2px; background: linear-gradient(90deg, #4CAF50, #FFD700, #FF9800, #2196F3);"></div>
                    <button id="zml-undo-btn" style="padding: 12px 22px; background-color: #5a5a5a; border: 3px solid #777; border-radius: 12px; cursor: pointer; color: white; font-size: 13px; font-weight: bold; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); text-shadow: 1px 1px 2px rgba(0,0,0,0.5); box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1); position: relative; overflow: hidden;">撤回</button>
                    <button id="zml-reset-color-btn" style="padding: 12px 22px; background-color: #5a5a5a; border: 3px solid #777; border-radius: 12px; cursor: pointer; color: white; font-size: 13px; font-weight: bold; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); text-shadow: 1px 1px 2px rgba(0,0,0,0.5); box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1); position: relative; overflow: hidden;">重置</button>
                    <div style="width: 30px;"></div>
                    <button id="zml-confirm-color-btn" style="padding: 12px 24px; color: white; background: linear-gradient(135deg, #4a90e2, #6aa9f8); border: 3px solid #5ba3f5; border-radius: 12px; cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); text-shadow: 1px 1px 2px rgba(0,0,0,0.5); box-shadow: 0 6px 12px rgba(74, 144, 226, 0.4), 0 0 15px rgba(74, 144, 226, 0.3); position: relative; overflow: hidden;">确认</button>
                    <button id="zml-cancel-color-btn" style="padding: 12px 24px; color: white; background: linear-gradient(135deg, #6a6a6a, #888888); border: 3px solid #888; border-radius: 12px; cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); text-shadow: 1px 1px 2px rgba(0,0,0,0.5); box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1); position: relative; overflow: hidden;">取消</button>
                </div>
            </div>
        </div>
        
        <style>
            .zml-modal {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                color: #e0e0e0;
            }
            
            .zml-color-adjust-container {
                display: flex;
                max-width: 90vw;
                max-height: 90vh;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            }
            
            .zml-modal button:hover {
                opacity: 0.9;
            }
            
            .zml-tool-panel input[type="range"] {
                width: 100% !important;
                height: 4px;
                background: #555;
                outline: none;
                opacity: 0.7;
                transition: all 0.3s ease;
                -webkit-appearance: none;
                cursor: grab;
                border-radius: 2px;
            }
            
            .zml-tool-panel input[type="range"]:hover {
                opacity: 1;
                cursor: grab;
            }
            
            .zml-tool-panel input[type="range"]:hover {
                opacity: 1;
            }
            
            .zml-tool-panel input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                background: #4CAF50;
                cursor: pointer;
                border-radius: 50%;
                transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                box-shadow: 0 0 8px rgba(76, 175, 80, 0.6), 0 2px 4px rgba(0,0,0,0.3);
                border: 2px solid white;
            }
            
            .zml-tool-panel input[type="range"]::-webkit-slider-thumb:hover {
                width: 18px;
                height: 18px;
                box-shadow: 0 0 12px rgba(76, 175, 80, 0.8), 0 2px 6px rgba(0,0,0,0.4);
                transform: scale(1.1);
            }
            
            .zml-tool-panel input[type="range"]::-moz-range-thumb {
                width: 12px;
                height: 12px;
                background: #4CAF50;
                cursor: pointer;
                border-radius: 50%;
                border: none;
                transition: all 0.2s ease;
            }
            
            .zml-tool-panel input[type="range"]::-moz-range-thumb:hover {
                width: 14px;
                height: 14px;
                box-shadow: 0 0 6px rgba(76, 175, 80, 0.6);
            }
            
            /* 平滑过渡动画 */
            .zml-slider {
                transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
            }
            
            .zml-tool-panel input[type="text"] {
                transition: all 0.3s ease;
            }
            
            .zml-tool-panel input[type="text"]:focus {
                outline: none;
                border-color: #4CAF50;
                box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
            }
            
            .zml-adjust-btn {
                transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                transform: scale(1);
                position: relative;
                overflow: hidden;
            }
            
            .zml-adjust-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.5s ease;
            }
            
            .zml-adjust-btn:hover::before {
                left: 100%;
            }
            
            .zml-adjust-btn:hover {
                background-color: #555;
                border-color: #4CAF50;
                transform: scale(1.1);
                box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
            }
            
            .zml-adjust-btn:active {
                background-color: #666;
                transform: scale(0.9);
                box-shadow: 0 0 5px rgba(76, 175, 80, 0.7);
            }
            
            .zml-tool-panel {
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            .zml-tool-panel:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 15px rgba(0,0,0,0.3);
                border-color: #888;
            }
            
            #zml-compare-btn {
                transition: all 0.2s ease;
                transform: scale(1);
            }
            
            #zml-compare-btn:hover {
                background-color: rgba(255,255,255,0.3);
                transform: scale(1.05);
            }
            
            #zml-compare-btn:active {
                background-color: rgba(255,255,255,0.7);
                color: black;
                transform: scale(0.95);
            }
            
            /* 工具面板中的输入框样式微调 */
            .zml-tool-panel input[type="text"] {
                font-size: 10px;
                padding: 1px 3px;
            }
            
            /* 底部控制按钮效果 */
            #zml-undo-btn:hover,
            #zml-reset-color-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0,0,0,0.4), 0 0 10px rgba(255,255,255,0.15);
                border-color: #999;
            }
            
            #zml-confirm-color-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(74, 144, 226, 0.5), 0 0 20px rgba(74, 144, 226, 0.4);
                border-color: #7ab3ff;
                background: linear-gradient(135deg, #5a9fff, #7aa9f8);
            }
            
            #zml-cancel-color-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0,0,0,0.4), 0 0 10px rgba(255,255,255,0.15);
                border-color: #aaa;
                background: linear-gradient(135deg, #7a7a7a, #999999);
            }
            
            #zml-undo-btn:active,
            #zml-reset-color-btn:active,
            #zml-cancel-color-btn:active {
                transform: translateY(0) scale(0.95);
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            
            #zml-confirm-color-btn:active {
                transform: translateY(0) scale(0.95);
                box-shadow: 0 4px 8px rgba(74, 144, 226, 0.4);
            }
            
            /* 按钮闪光效果 */
            button::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 5px;
                height: 5px;
                background: rgba(255, 255, 255, 0.5);
                opacity: 0;
                border-radius: 100%;
                transform: scale(1, 1) translate(-50%, -50%);
                transform-origin: 50% 50%;
            }
            
            button:active::after {
                animation: ripple 0.5s ease-out;
            }
            
            @keyframes ripple {
                0% {
                    transform: scale(0, 0);
                    opacity: 0.5;
                }
                100% {
                    transform: scale(20, 20);
                    opacity: 0;
                }
            }
            
            /* 预览按钮效果增强 */
            #zml-reset-view-btn {
                transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            #zml-reset-view-btn:hover {
                background-color: rgba(66, 133, 244, 1);
                transform: scale(1.1);
                box-shadow: 0 6px 12px rgba(0,0,0,0.4), 0 0 15px rgba(66, 133, 244, 0.6);
            }
            
            #zml-reset-view-btn:active {
                background-color: rgba(66, 133, 244, 0.8);
                transform: scale(0.9);
                box-shadow: 0 3px 6px rgba(0,0,0,0.3);
            }
            
            /* 更新比较按钮样式 */
            #zml-compare-btn {
                transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            #zml-compare-btn:hover {
                background-color: rgba(76, 175, 80, 1);
                transform: scale(1.1);
                box-shadow: 0 6px 12px rgba(0,0,0,0.4), 0 0 15px rgba(76, 175, 80, 0.6);
            }
            
            #zml-compare-btn:active {
                background-color: rgba(76, 175, 80, 0.8);
                transform: scale(0.9);
                box-shadow: 0 3px 6px rgba(0,0,0,0.3);
            }
            
            /* 模态框容器动画 */
            .zml-color-adjust-container:hover {
                box-shadow: 0 10px 30px rgba(76, 175, 80, 0.3), 0 0 25px rgba(76, 175, 80, 0.2);
            }
            
            /* 增强滑块的视觉反馈 */
            .zml-tool-panel input[type="range"]:active {
                cursor: grabbing;
            }
            
            /* 输入框获得焦点时的效果 */
            .zml-tool-panel input[type="text"]:focus {
                box-shadow: 0 0 8px rgba(76, 175, 80, 0.5);
                transform: scale(1.05);
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
    const undoBtn = modal.querySelector('#zml-undo-btn');
    const confirmBtn = modal.querySelector('#zml-confirm-color-btn');
    const cancelBtn = modal.querySelector('#zml-cancel-color-btn');
    
    // 创建历史记录数组，用于撤回功能
    let historyStack = [];
    const MAX_HISTORY_SIZE = 50; // 最大历史记录数量

    // 加载图像并设置画布
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    
    let originalImageData = null;
    let currentImageData = null;
    
    // 保存当前参数状态到历史记录
    function saveCurrentState() {
        const currentState = {
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
        
        // 限制历史记录大小
        if (historyStack.length >= MAX_HISTORY_SIZE) {
            historyStack.shift();
        }
        
        historyStack.push(currentState);
        
        // 更新撤回按钮状态
        undoBtn.disabled = historyStack.length <= 1;
        if (historyStack.length <= 1) {
            undoBtn.style.opacity = '0.5';
        } else {
            undoBtn.style.opacity = '1';
        }
    }
    
    // 撤回操作函数
    function undoLastChange() {
        if (historyStack.length > 1) {
            historyStack.pop(); // 移除当前状态
            const previousState = historyStack[historyStack.length - 1];
            
            // 恢复到上一个状态
            brightnessSlider.value = previousState.brightness;
            contrastSlider.value = previousState.contrast;
            saturationSlider.value = previousState.saturation;
            hueSlider.value = previousState.hue;
            sharpenSlider.value = previousState.sharpen;
            gammaSlider.value = previousState.gamma;
            exposureSlider.value = previousState.exposure;
            blurSlider.value = previousState.blur;
            noiseSlider.value = previousState.noise;
            vignetteSlider.value = previousState.vignette;
            
            // 更新UI并重新绘制图像
            updateAdjustedImage();
            
            // 更新撤回按钮状态
            undoBtn.disabled = historyStack.length <= 1;
            if (historyStack.length <= 1) {
                undoBtn.style.opacity = '0.5';
            }
        }
    }
    
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
        
        // 保存初始状态到历史记录
        saveCurrentState();
        
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
            
            // 重置视角按钮功能
            const resetViewBtn = modal.querySelector('#zml-reset-view-btn');
            resetViewBtn.addEventListener('click', () => {
                // 重置缩放和平移参数
                zoomScale = 1;
                offsetX = 0;
                offsetY = 0;
                
                // 应用变换
                applyTransform();
            });
        
        // ===== 添加Ctrl键控制的缩放和平移功能 =====
        const previewContainer = modal.querySelector('#zml-color-preview-container');
        const canvasContainer = originalCanvas.parentElement;
        
        // 缩放和平移相关变量
        let isCtrlKeyPressed = false;
        let zoomScale = 1;
        let offsetX = 0;
        let offsetY = 0;
        let isPanning = false;
        let lastX = 0;
        let lastY = 0;
        
        // 添加提示文本
        const tipElement = document.createElement('div');
        tipElement.className = 'zml-editor-tip';
        tipElement.textContent = '按住Ctrl+滚轮缩放, 按住Ctrl+左键拖拽平移';
        tipElement.style.position = 'absolute';
        tipElement.style.bottom = '15px';
        tipElement.style.right = '15px';
        tipElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        tipElement.style.padding = '4px 8px';
        tipElement.style.borderRadius = '4px';
        tipElement.style.fontSize = '12px';
        tipElement.style.zIndex = '10';
        previewContainer.appendChild(tipElement);
        
        // 键盘事件处理
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') {
                isCtrlKeyPressed = true;
                updateCursorStyle();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                isCtrlKeyPressed = false;
                isPanning = false;
                updateCursorStyle();
            }
        });
        
        // 更新光标样式
        function updateCursorStyle() {
            if (isCtrlKeyPressed) {
                canvasContainer.style.cursor = 'grab';
            } else {
                canvasContainer.style.cursor = 'default';
            }
        }
        
        // 鼠标滚轮事件处理 - 缩放
        previewContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            if (!isCtrlKeyPressed) return;
            
            // 计算鼠标位置相对于画布的坐标
            const rect = canvasContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // 计算缩放前鼠标在图像上的位置（相对于图像中心）
            const mouseXInImage = (mouseX - offsetX) / zoomScale;
            const mouseYInImage = (mouseY - offsetY) / zoomScale;
            
            // 计算新的缩放比例
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            zoomScale *= delta;
            
            // 限制缩放范围
            zoomScale = Math.max(0.1, Math.min(20, zoomScale));
            
            // 调整偏移量，使缩放围绕鼠标位置进行
            offsetX = mouseX - mouseXInImage * zoomScale;
            offsetY = mouseY - mouseYInImage * zoomScale;
            
            // 应用变换
            applyTransform();
        });
        
        // 鼠标按下事件处理 - 开始平移
        previewContainer.addEventListener('mousedown', (e) => {
            if (!isCtrlKeyPressed || e.button !== 0) return; // 仅在Ctrl+左键时开始平移
            
            e.preventDefault();
            isPanning = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvasContainer.style.cursor = 'grabbing';
        });
        
        // 鼠标移动事件处理 - 平移
        document.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            
            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            
            offsetX += deltaX;
            offsetY += deltaY;
            
            lastX = e.clientX;
            lastY = e.clientY;
            
            // 应用变换
            applyTransform();
        });
        
        // 鼠标释放事件处理 - 结束平移
        document.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                updateCursorStyle();
            }
        });
        
        // 应用变换到画布
        // 添加防抖和动画帧优化
        let transformRequestId = null;
        
        function applyTransform() {
            // 如果有 pending 的请求，取消它
            if (transformRequestId) {
                cancelAnimationFrame(transformRequestId);
            }
            // 立即安排新的动画帧请求
            transformRequestId = requestAnimationFrame(() => {
                doApplyTransform();
            });
        }
        
        function doApplyTransform() {
            // 获取预览容器和画布的尺寸
            const containerRect = previewContainer.getBoundingClientRect();
            const canvasWidth = originalCanvas.width;
            const canvasHeight = originalCanvas.height;
            
            // 计算缩放后的画布尺寸
            const scaledWidth = canvasWidth * zoomScale;
            const scaledHeight = canvasHeight * zoomScale;
            
            // 边界检查，确保图像始终在预览框内
            // 左右边界
            if (scaledWidth <= containerRect.width) {
                // 如果图像比容器小，居中显示
                offsetX = (containerRect.width - scaledWidth) / 2;
            } else {
                // 如果图像比容器大，限制偏移量
                offsetX = Math.max(offsetX, containerRect.width - scaledWidth);
                offsetX = Math.min(offsetX, 0);
            }
            
            // 上下边界
            if (scaledHeight <= containerRect.height) {
                // 如果图像比容器小，居中显示
                offsetY = (containerRect.height - scaledHeight) / 2;
            } else {
                // 如果图像比容器大，限制偏移量
                offsetY = Math.max(offsetY, containerRect.height - scaledHeight);
                offsetY = Math.min(offsetY, 0);
            }
            
            // 应用变换
            originalCanvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoomScale})`;
            originalCanvas.style.transformOrigin = '0 0';
            adjustedCanvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoomScale})`;
            adjustedCanvas.style.transformOrigin = '0 0';
        }
        
        // 窗口失焦时重置状态
        window.addEventListener('blur', () => {
            isCtrlKeyPressed = false;
            isPanning = false;
            updateCursorStyle();
        });
        
        // 当模态框关闭时清理事件监听器
        modal.addEventListener('beforeunload', () => {
            isCtrlKeyPressed = false;
            isPanning = false;
        });
        
        // ===== 缩放和平移功能结束 =====
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

    // 添加防抖功能，优化性能
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 创建防抖版本的图像更新函数
    const debouncedUpdateAdjustedImage = debounce(updateAdjustedImage, 50);
    
    // 锐化滤镜函数
        function applySharpen(imageData, amount) {
            const width = imageData.width;
            const height = imageData.height;
            const data = imageData.data;
            const result = new ImageData(width, height);
            const resultData = result.data;
            
            // 锐化卷积核 - 保持原始权重以维持亮度平衡
            const kernel = [
                0, -1, 0,
                -1, 5, -1,
                0, -1, 0
            ];
            
            // 应用卷积
            const scale = 1;
            const bias = 0;
            
            // 计算锐化强度因子，使用更合理的缩放方式
            const sharpenFactor = Math.max(0, Math.min(3, amount / 50)); // 限制最大强度为3，避免过度锐化
            
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    let r = 0, g = 0, b = 0;
                    
                    // 先应用标准锐化核
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const kernelIdx = (ky + 1) * 3 + (kx + 1);
                            const imgIdx = ((y + ky) * width + (x + kx)) * 4;
                            
                            // 保持原始权重以维持卷积核的平衡性
                            r += data[imgIdx] * kernel[kernelIdx];
                            g += data[imgIdx + 1] * kernel[kernelIdx];
                            b += data[imgIdx + 2] * kernel[kernelIdx];
                        }
                    }
                    
                    // 计算原图与锐化后的混合
                    const idx = (y * width + x) * 4;
                    const originalR = data[idx];
                    const originalG = data[idx + 1];
                    const originalB = data[idx + 2];
                    
                    // 使用混合方式应用锐化效果，避免直接相乘导致的亮度失衡
                    // 基本思想: 锐化结果 = 原图 + (锐化结果 - 原图) * 锐化因子
                    const sharpenedR = Math.max(0, Math.min(255, r / scale + bias));
                    const sharpenedG = Math.max(0, Math.min(255, g / scale + bias));
                    const sharpenedB = Math.max(0, Math.min(255, b / scale + bias));
                    
                    // 线性混合原图和锐化结果
                    resultData[idx] = Math.max(0, Math.min(255, originalR + (sharpenedR - originalR) * sharpenFactor));
                    resultData[idx + 1] = Math.max(0, Math.min(255, originalG + (sharpenedG - originalG) * sharpenFactor));
                    resultData[idx + 2] = Math.max(0, Math.min(255, originalB + (sharpenedB - originalB) * sharpenFactor));
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
    
    // 绑定滑块事件监听器 - 使用防抖优化性能
    brightnessSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    contrastSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    saturationSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    hueSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    sharpenSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    gammaSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    exposureSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    blurSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    noiseSlider.addEventListener('input', debouncedUpdateAdjustedImage);
    vignetteSlider.addEventListener('input', debouncedUpdateAdjustedImage);

    // 增强滑块交互体验 - 添加滑块拖动时的视觉反馈
    const allSliders = [brightnessSlider, contrastSlider, saturationSlider, hueSlider, sharpenSlider, gammaSlider, exposureSlider, blurSlider, noiseSlider, vignetteSlider];
    allSliders.forEach(slider => {
        // 添加滑块拖动开始事件
        slider.addEventListener('mousedown', function() {
            this.style.opacity = '1';
            this.style.cursor = 'grabbing';
        });
        
        // 添加滑块拖动结束事件
        slider.addEventListener('mouseup', function() {
            this.style.cursor = 'grab';
            // 确保最终状态的图像被正确更新
            updateAdjustedImage();
            // 保存状态到历史记录
            saveCurrentState();
        });
        
        // 添加滑块鼠标离开事件
        slider.addEventListener('mouseleave', function() {
            this.style.cursor = 'grab';
            // 确保最终状态的图像被正确更新
            updateAdjustedImage();
        });
        
        // 为滑块添加CSS类以支持平滑过渡
        slider.classList.add('zml-slider');
    });

    // 增强输入框交互体验
    const allInputs = [brightnessInput, contrastInput, saturationInput, hueInput, sharpenInput, gammaInput, exposureInput, blurInput, noiseInput, vignetteInput];
    allInputs.forEach(input => {
        // 添加输入框聚焦效果
        input.addEventListener('focus', function() {
            this.style.borderColor = '#4CAF50';
            this.style.boxShadow = '0 0 0 2px rgba(76, 175, 80, 0.2)';
        });
        
        // 添加输入框失焦效果
        input.addEventListener('blur', function() {
            this.style.borderColor = '#666';
            this.style.boxShadow = 'none';
        });
        
        // 添加输入框即时验证
        input.addEventListener('input', function() {
            // 实时更新滑块值和图像，但使用防抖避免频繁更新
            debouncedUpdateAdjustedImage();
        });
    });

    // 增强按钮交互体验
    const allButtons = [
        brightnessMinusBtn, brightnessPlusBtn,
        contrastMinusBtn, contrastPlusBtn,
        saturationMinusBtn, saturationPlusBtn,
        hueMinusBtn, huePlusBtn,
        sharpenMinusBtn, sharpenPlusBtn,
        gammaMinusBtn, gammaPlusBtn,
        exposureMinusBtn, exposurePlusBtn,
        blurMinusBtn, blurPlusBtn,
        noiseMinusBtn, noisePlusBtn,
        vignetteMinusBtn, vignettePlusBtn,
        resetBtn, confirmBtn, cancelBtn
    ];
    allButtons.forEach(button => {
        // 添加按钮按下效果
        button.addEventListener('mousedown', function() {
            this.style.transform = 'scale(0.95)';
            this.style.transition = 'transform 0.1s ease';
        });
        
        // 添加按钮释放效果
        button.addEventListener('mouseup', function() {
            this.style.transform = 'scale(1)';
        });
        
        // 添加按钮鼠标离开效果
        button.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
        });
    });
    
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
    
    // 撤回按钮
    undoBtn.addEventListener('click', undoLastChange);
    undoBtn.disabled = true;
    undoBtn.style.opacity = '0.5';
    
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
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
        saveCurrentState();
    });
    
    // 暗角加减按钮
    vignettePlusBtn.addEventListener('click', () => {
        let value = parseInt(vignetteSlider.value) + 1;
        value = Math.max(0, Math.min(100, value));
        vignetteSlider.value = value;
        vignetteInput.value = value;
        updateAdjustedImage();
        saveCurrentState();
    });

        // 暗角减按钮
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
    
    // 获取预览模式设置
    let previewMode = "360°预览";
    const modeWidget = node.widgets.find(w => w.name === "预览模式");
    if (modeWidget && modeWidget.value) {
        previewMode = modeWidget.value;
    }

    // 根据预览模式选择不同的预览方式
    if (previewMode === "平面预览") {
        showPlanePreview(imageUrl);
    } else {
        show360Preview(imageUrl);
    }
}

// 360度预览函数
async function show360Preview(imageUrl) {
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
        // 配置纹理参数
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        
        // 创建 Three.js 场景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000); // 纯黑色背景
        
        // 创建相机
        camera = new THREE.PerspectiveCamera(fov, container.clientWidth / container.clientHeight, 0.1, 2000);
        camera.position.set(0, 0, 0); // 相机在球体中心

        // 创建渲染器
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.outputEncoding = THREE.sRGBEncoding;

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

// 3D视角预览函数 - 允许在3D空间中旋转2D图像
async function showPlanePreview(imageUrl) {
    // 加载 Three.js 库 (只加载一次)
    if (typeof THREE === 'undefined') {
        const threeJsPath = new URL('../lib/three.min.js', import.meta.url).href;
        await loadScript(threeJsPath);
    }

    // 创建3D预览模态框
    const modalHtml = `
        <div id="zml-plane-viewer-modal" class="zml-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; justify-content: center; align-items: center; z-index: 1002; flex-direction: column;">
            <p style="color: white; margin-bottom: 10px;">拖动鼠标旋转视角，滚轮缩放，按ESC关闭</p>
            <div id="zml-plane-viewer-container" style="width: 80vw; height: 80vh; max-width: 1200px; max-height: 800px; background-color: #000000; overflow: hidden; position: relative;">
                <canvas id="zml-plane-canvas" style="display: block;"></canvas>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <button id="zml-plane-reset-btn" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;">重置视角</button>
                <button id="zml-plane-close-btn" style="padding: 10px 20px; background-color: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer;">关闭预览</button>
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
                .zml-modal button.active {
                    background-color: #007bff;
                    border-color: #007bff;
                }
            </style>
        </div>
    `;
    
    const modal = createModal(modalHtml, 'zml-plane-viewer-modal');
    const container = modal.querySelector('#zml-plane-viewer-container');
    const canvas = modal.querySelector('#zml-plane-canvas');
    
    // Three.js 变量
    let scene, camera, renderer;
    let planeMesh;
    let controls = {
        isDragging: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        targetRotationX: 0,
        targetRotationY: 0,
        scale: 1
    };
    
    // 初始化 Three.js 场景
    function init() {
        // 创建场景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000); // 纯黑色背景
        
        // 创建相机
        camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 0, 5); // 初始相机位置
        
        // 创建渲染器
        renderer = new THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: true
        });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.outputEncoding = THREE.sRGBEncoding;
        
        // 加载纹理并创建平面
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(imageUrl, (texture) => {
            // 设置纹理参数
            texture.encoding = THREE.sRGBEncoding;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            
            // 计算平面尺寸以保持图像比例
            const aspectRatio = texture.image.width / texture.image.height;
            const planeWidth = 3;
            const planeHeight = planeWidth / aspectRatio;
            
            // 创建平面几何体
            const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
            
            // 创建材质
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide
            });
            
            // 创建平面网格
            planeMesh = new THREE.Mesh(geometry, material);
            scene.add(planeMesh);
            
            // 更新相机位置，使平面在视图中合适大小
            updateCameraPosition();
        });
        
        // 启动渲染循环
        animate();
    }
    
    // 渲染循环
    function animate() {
        requestAnimationFrame(animate);
        
        // 更新平面旋转
        if (planeMesh) {
            // 使用缓动效果使旋转更平滑
            planeMesh.rotation.x += (controls.targetRotationX - planeMesh.rotation.x) * 0.1;
            planeMesh.rotation.y += (controls.targetRotationY - planeMesh.rotation.y) * 0.1;
            planeMesh.scale.set(controls.scale, controls.scale, controls.scale);
        }
        
        renderer.render(scene, camera);
    }
    
    // 更新相机位置以合适查看图像
    function updateCameraPosition() {
        if (!planeMesh) return;
        
        // 获取平面的边界框
        planeMesh.geometry.computeBoundingBox();
        const box = planeMesh.geometry.boundingBox;
        const size = new THREE.Vector3();
        box.getSize(size);
        
        // 计算相机距离，确保整个平面可见
        const maxDim = Math.max(size.x, size.y);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5; // 1.5倍的距离以留出空间
        
        camera.position.z = cameraZ;
        
        // 重置初始缩放
        controls.scale = 1;
    }
    
    // 重置视角
    function resetView() {
        if (planeMesh) {
            controls.targetRotationX = 0;
            controls.targetRotationY = 0;
            controls.scale = 1;
            
            // 更新相机位置
            updateCameraPosition();
        }
    }
    
    // 鼠标事件处理
    function onMouseDown(e) {
        controls.isDragging = true;
        controls.startX = e.clientX;
        controls.startY = e.clientY;
        container.style.cursor = 'grabbing';
        e.preventDefault();
    }
    
    function onMouseMove(e) {
        if (!controls.isDragging) return;
        
        const deltaX = e.clientX - controls.startX;
        const deltaY = e.clientY - controls.startY;
        
        // 根据鼠标移动更新目标旋转角度
        controls.targetRotationY += deltaX * 0.005; // 水平旋转 (Y轴)
        controls.targetRotationX += deltaY * 0.005; // 垂直旋转 (X轴)
        
        // 限制垂直旋转范围，避免过度翻转
        controls.targetRotationX = Math.max(-Math.PI/2, Math.min(Math.PI/2, controls.targetRotationX));
        
        controls.startX = e.clientX;
        controls.startY = e.clientY;
        
        e.preventDefault();
    }
    
    function onMouseUp() {
        controls.isDragging = false;
        container.style.cursor = 'grab';
    }
    
    // 滚轮缩放事件
    function onWheel(e) {
        e.preventDefault();
        
        // 根据滚轮方向调整缩放
        const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
        controls.scale = Math.max(0.1, Math.min(5, controls.scale * scaleFactor));
    }
    
    // ESC键关闭
    function onDocumentKeyUp(event) {
        if (event.key === 'Escape') {
            closeModal(modal);
            cleanup();
        }
    }
    
    // 清理函数
    function cleanup() {
        if (planeMesh) {
            if (planeMesh.material && planeMesh.material.map) {
                planeMesh.material.map.dispose(); // 释放纹理资源
            }
            if (planeMesh.material) planeMesh.material.dispose();
            if (planeMesh.geometry) planeMesh.geometry.dispose();
            scene.remove(planeMesh);
            planeMesh = null;
        }
        
        if (renderer) {
            renderer.dispose();
            renderer = null;
        }
        
        // 移除所有事件监听器
        container.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        container.removeEventListener('wheel', onWheel);
        document.removeEventListener('keyup', onDocumentKeyUp);
        window.removeEventListener('resize', onWindowResize);
    }
    
    // 窗口大小调整处理
    function onWindowResize() {
        if (!renderer || !camera) return;
        
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        renderer.setSize(width, height);
    }
    
    // 绑定事件监听器
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keyup', onDocumentKeyUp);
    window.addEventListener('resize', onWindowResize);
    
    // 关闭按钮事件
    modal.querySelector('#zml-plane-close-btn').onclick = () => {
        closeModal(modal);
        cleanup();
    };
    
    // 重置按钮事件
    modal.querySelector('#zml-plane-reset-btn').onclick = resetView;
    
    // 初始鼠标样式
    container.style.cursor = 'grab';
    
    // 初始化场景
    init();
}

