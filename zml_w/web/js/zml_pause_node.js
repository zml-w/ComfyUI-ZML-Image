import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// =================================================================
// ZML_PauseNode: FLOATING UI AND LOGIC
// =================================================================


let currentlyPausedNodeId = null, countdownIntervalId = null, isDragging = false;
let dragStartPos = { x: 0, y: 0 }, elementStartPos = { x: 0, y: 0 };
const floatingContainer = document.createElement("div");

// Calculate and set the default center position for the floating ball
Object.assign(floatingContainer.style, {
    position: "fixed",
    display: "none",
    flexDirection: "column",
    alignItems: "center",
    backgroundColor: "rgba(40, 40, 40, 0.85)",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    backdropFilter: "blur(8px)",
    userSelect: "none",
    transition: "transform 0.2s ease",
    padding: "8px",
    zIndex: "9999", 
    bottom: "auto",
    right: "auto",
});

const mainButton = document.createElement("button");
mainButton.textContent = "选择输出的管道";
Object.assign(mainButton.style, {
    padding: "6px 12px",
    background: "linear-gradient(45deg, #4a90e2, #7aaee0)",
    color: "white",
    border: "none",
    borderRadius: "40px",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "1",
    width: "auto",
    height: "auto",
    backgroundImage: "none",
    transition: "background 0.3s ease, transform 0.2s ease",
});
mainButton.onmouseover = () => { mainButton.style.background = "linear-gradient(45deg, #3a7bd5, #6aa0de)"; };
mainButton.onmouseout = () => { mainButton.style.background = "linear-gradient(45deg, #4a90e2, #7aaee0)"; };


const countdownText = document.createElement("div");
countdownText.style.cssText = "color: white; font-size: 16px; font-weight: bold; text-align: center; padding: 6px 0; padding-top:2px;";
const choicePanel = document.createElement("div");
choicePanel.style.cssText = "display: none; flex-direction: column; padding-top: 6px; gap: 6px; width: 100%;";
for (let i = 0; i < 3; i++) {
    const choiceButton = document.createElement("button");
    choiceButton.textContent = `执行路径 ${i + 1}`;
    Object.assign(choiceButton.style, { padding: "8px", backgroundColor: "#4a90e2", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px" });
    choiceButton.addEventListener("click", async () => {
        if (!currentlyPausedNodeId) return;
        try {
            await api.fetchApi("/zml/unpause", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ node_id: currentlyPausedNodeId, selected_output: i }),
            });
        } catch (error) {
            console.error(`[ZML_PauseNode] Failed to unpause with path ${i}:`, error);
        } finally {
            stopAndHidePauseUI();
        }
    });
    choicePanel.appendChild(choiceButton);
}
floatingContainer.append(mainButton, countdownText, choicePanel);
document.body.appendChild(floatingContainer);

function centerFloatingContainer() {
    floatingContainer.style.visibility = "hidden";
    floatingContainer.style.display = "flex";
    const containerWidth = floatingContainer.offsetWidth;
    const containerHeight = floatingContainer.offsetHeight;
    floatingContainer.style.left = `${(window.innerWidth - containerWidth) / 2}px`;
    floatingContainer.style.top = `${(window.innerHeight - containerHeight) / 2}px`;
    floatingContainer.style.visibility = "visible";
}

mainButton.addEventListener("click", (e) => {
    if (isDragging) return;
    choicePanel.style.display = choicePanel.style.display === "flex" ? "none" : "flex";
});

floatingContainer.addEventListener("mousedown", (e) => {
    floatingContainer.style.bottom = "auto";
    floatingContainer.style.right = "auto";
    dragStartPos = { x: e.clientX, y: e.clientY };
    const rect = floatingContainer.getBoundingClientRect();
    elementStartPos = { x: rect.left, y: rect.top };
    isDragging = false;
    function onMouseMove(e) {
        const dx = e.clientX - dragStartPos.x, dy = e.clientY - dragStartPos.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
        if (isDragging) {
            floatingContainer.style.cursor = "move";
            floatingContainer.style.left = `${elementStartPos.x + dx}px`;
            floatingContainer.style.top = `${elementStartPos.y + dy}px`;
        }
    }
    function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        floatingContainer.style.cursor = "default";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
});

window.addEventListener("resize", () => {
    if (floatingContainer.style.display === "flex" && !isDragging) {
        centerFloatingContainer();
    }
});

function stopAndHidePauseUI() {
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    countdownIntervalId = null;
    floatingContainer.style.display = "none";
    choicePanel.style.display = "none";
    currentlyPausedNodeId = null;
}

// =================================================================
// ZML_AudioPlayerNode: HELPER FUNCTION AND GLOBAL STATE
// =================================================================

let zmlCurrentAudio = null; // Global reference to the currently playing audio

/**
 * Plays the audio file selected in a ZML_AudioPlayerNode.
 * @param {object} node The ZML_AudioPlayerNode instance from the graph.
 */
function playAudioForNode(node) {
    // Stop any previously playing audio
    if (zmlCurrentAudio) {
        zmlCurrentAudio.pause();
        zmlCurrentAudio.currentTime = 0;
    }

    const audioFileWidget = node.widgets.find(w => w.name === "音频文件");
    if (!audioFileWidget || !audioFileWidget.value || audioFileWidget.value.startsWith("(")) {
        console.log("[ZML_AudioPlayer] No valid audio file selected.");
        return;
    }
    const filename = audioFileWidget.value;
    const audioUrl = `/zml/get_audio?filename=${encodeURIComponent(filename)}`;

    zmlCurrentAudio = new Audio(audioUrl);
    zmlCurrentAudio.play().catch(e => {
        console.error(`[ZML_AudioPlayer] Failed to play audio: ${filename}`, e);
        // We avoid alert() here for workflow-triggered plays to prevent spam.
        // The button click can have its own alert if needed.
    });
}

// =================================================================
// ZML_ColorToMask: COLOR PICKER UI AND LOGIC
// =================================================================

// 创建颜色选择器UI元素
const colorPickerContainer = document.createElement("div");
Object.assign(colorPickerContainer.style, {
    position: "fixed",
    display: "none",
    flexDirection: "column",
    alignItems: "center",
    backgroundColor: "rgba(40, 40, 40, 0.95)",
    borderRadius: "12px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    backdropFilter: "blur(12px)",
    padding: "16px",
    zIndex: "10000",
    minWidth: "280px",
    // 强制使用固定位置居中
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    margin: 0,
    bottom: "auto",
    right: "auto",
});

const colorPickerTitle = document.createElement("h3");
colorPickerTitle.textContent = "选择颜色";
colorPickerTitle.style.cssText = "color: white; margin: 0 0 16px 0; font-size: 16px; font-weight: 600;";

const colorOptionsContainer = document.createElement("div");
colorOptionsContainer.style.cssText = "display: flex; flex-direction: column; gap: 12px; width: 100%; margin-bottom: 16px;";

const colorButtons = [
    { id: 0, name: "颜色一", defaultColor: "#FF0000" },
    { id: 1, name: "颜色二", defaultColor: "#0000FF" },
    { id: 2, name: "颜色三", defaultColor: "#00FF00" }
];

colorButtons.forEach(button => {
    const colorOption = document.createElement("div");
    colorOption.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const colorButton = document.createElement("button");
    colorButton.textContent = button.name;
    colorButton.dataset.colorId = button.id;
    Object.assign(colorButton.style, {
        flex: 1,
        padding: "8px 12px",
        backgroundColor: button.defaultColor,
        color: button.defaultColor === "#FFFFFF" ? "#000000" : "#FFFFFF",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "500",
        transition: "all 0.2s ease",
    });
    colorButton.onmouseover = () => {
        colorButton.style.transform = "translateY(-1px)";
        colorButton.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
    };
    colorButton.onmouseout = () => {
        colorButton.style.transform = "translateY(0)";
        colorButton.style.boxShadow = "none";
    };
    
    colorOption.appendChild(colorButton);
    colorOptionsContainer.appendChild(colorOption);
});

const confirmButton = document.createElement("button");
confirmButton.textContent = "关闭";
Object.assign(confirmButton.style, {
    padding: "8px 24px",
    backgroundColor: "#6c757d",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "14px",
    transition: "background-color 0.2s ease",
});
confirmButton.onmouseover = () => { confirmButton.style.backgroundColor = "#5a6268"; };
confirmButton.onmouseout = () => { confirmButton.style.backgroundColor = "#6c757d"; };
confirmButton.addEventListener("click", () => {
    colorPickerContainer.style.display = "none";
});

// 创建隐藏的颜色输入元素
const hiddenColorInput = document.createElement("input");
hiddenColorInput.type = "color";
// 默认情况下使用opacity: 0隐藏，但保持DOM存在以便可以触发点击
Object.assign(hiddenColorInput.style, {
    position: "fixed",
    zIndex: "10001",
    opacity: "0", // 默认完全透明
    pointerEvents: "none", // 默认不可交互
    width: "0",
    height: "0",
    padding: "0",
    border: "none",
    outline: "none",
    WebkitAppearance: "none",
    appearance: "none",
    background: "transparent"
});

document.body.appendChild(hiddenColorInput);
colorPickerContainer.append(colorPickerTitle, colorOptionsContainer, confirmButton);
document.body.appendChild(colorPickerContainer);

// 当前操作的节点和颜色索引
let currentColorToMaskNode = null;
let currentColorIndex = -1;

// 显示颜色选择器
function showColorPicker(node) {
    currentColorToMaskNode = node;
    
    // 强制在画面中央显示（直接设置所有位置属性以确保覆盖）
    colorPickerContainer.style.display = "flex";
    colorPickerContainer.style.position = "fixed";
    colorPickerContainer.style.top = "50%";
    colorPickerContainer.style.left = "50%";
    colorPickerContainer.style.transform = "translate(-50%, -50%)";
    colorPickerContainer.style.margin = "0";
    colorPickerContainer.style.bottom = "auto";
    colorPickerContainer.style.right = "auto";
    colorPickerContainer.style.zIndex = "10000";
    
    // 初始化颜色按钮的背景色
    colorButtons.forEach((button, index) => {
        const colorButton = colorOptionsContainer.querySelector(`button[data-color-id="${index}"]`);
        if (colorButton) {
            const widgetName = `颜色代码${index + 1}`;
            const widget = node.widgets.find(w => w.name === widgetName);
            if (widget && widget.value) {
                colorButton.style.backgroundColor = widget.value;
                // 根据背景色调整文字颜色
                const isLight = isLightColor(widget.value);
                colorButton.style.color = isLight ? "#000000" : "#FFFFFF";
            }
        }
    });
}

// 检查颜色是否为亮色
function isLightColor(color) {
    // 移除#号
    const hex = color.replace("#", "");
    // 转换为RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    // 计算亮度 (YIQ公式)
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128;
}

// 添加颜色按钮点击事件
colorButtons.forEach((button, index) => {
    const colorButton = colorOptionsContainer.querySelector(`button[data-color-id="${index}"]`);
    if (colorButton) {
        colorButton.addEventListener("click", (e) => {
            currentColorIndex = index;
            // 设置初始颜色为按钮当前背景色
            hiddenColorInput.value = colorButton.style.backgroundColor;
            
            // 临时显示隐藏的颜色输入框并触发点击
            hiddenColorInput.style.opacity = "1";
            hiddenColorInput.style.pointerEvents = "auto";
            hiddenColorInput.style.width = "22px";
            hiddenColorInput.style.height = "22px";
            
            // 定位在颜色选择器容器的中心
            const rect = colorPickerContainer.getBoundingClientRect();
            hiddenColorInput.style.top = `${rect.top + rect.height/2}px`;
            hiddenColorInput.style.left = `${rect.left + rect.width/2}px`;
            
            // 触发点击事件以打开颜色选择器
            setTimeout(() => {
                hiddenColorInput.click();
                
                // 点击后立即隐藏，避免一直显示
                setTimeout(() => {
                    hiddenColorInput.style.opacity = "0";
                    hiddenColorInput.style.pointerEvents = "none";
                    hiddenColorInput.style.width = "0";
                    hiddenColorInput.style.height = "0";
                }, 10);
            }, 10);
        });
    }
});

// 监听颜色输入变化
hiddenColorInput.addEventListener("input", () => {
    if (currentColorToMaskNode && currentColorIndex !== -1) {
        const selectedColor = hiddenColorInput.value;
        const widgetName = `颜色代码${currentColorIndex + 1}`;
        const widget = currentColorToMaskNode.widgets.find(w => w.name === widgetName);
        
        if (widget) {
            widget.value = selectedColor;
            // 更新节点UI
            app.graph.setDirtyCanvas(true, false);
            
            // 更新颜色按钮背景
            const colorButton = colorOptionsContainer.querySelector(`button[data-color-id="${currentColorIndex}"]`);
            if (colorButton) {
                colorButton.style.backgroundColor = selectedColor;
                const isLight = isLightColor(selectedColor);
                colorButton.style.color = isLight ? "#000000" : "#FFFFFF";
            }
        }
    }
    
    // 选择颜色后确保隐藏输入框
    setTimeout(() => {
        hiddenColorInput.style.opacity = "0";
        hiddenColorInput.style.pointerEvents = "none";
        hiddenColorInput.style.width = "0";
        hiddenColorInput.style.height = "0";
    }, 10);
});

// 窗口大小改变时重新居中
window.addEventListener("resize", () => {
    if (colorPickerContainer.style.display === "flex") {
        // 使用CSS transform方式确保始终居中，不需要重新计算位置
    }
});

// =================================================================
// COMFYUI EXTENSION REGISTRATION (Handles all ZML nodes)
// =================================================================

app.registerExtension({
    name: "ZML.PauseAndAudioPlayer",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // --- Add "Play" button to ZML_AudioPlayerNode ---
        if (nodeData.name === "ZML_AudioPlayerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                // Add the manual play button
                this.addWidget("button", "播放", null, () => {
                   playAudioForNode(this); 
                });
            };
        }
        
        // --- Add "获取颜色代码" button to ZML_ColorToMask ---
        else if (nodeData.name === "ZML_ColorToMask") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                
                // 添加"获取颜色代码"按钮
                this.addWidget("button", "获取颜色代码", null, () => {
                    showColorPicker(this);
                });
            };
        }
    },

    setup() {
        // Listen for when any node starts executing
        api.addEventListener("executing", ({ detail: nodeId }) => {
            if (!nodeId) return;
            const node = app.graph.getNodeById(nodeId);
            if (!node) return;

            // --- Logic for ZML_PauseNode ---
            if (node.type === "ZML_PauseNode") {
                currentlyPausedNodeId = nodeId;
                const durationWidget = node.widgets.find(w => w.name === "暂停时长");
                let duration = durationWidget ? durationWidget.value : 30;
                countdownText.textContent = `${duration}s`;
                countdownIntervalId = setInterval(() => {
                    duration--;
                    countdownText.textContent = `${duration}s`;
                    if (duration <= 0) stopAndHidePauseUI();
                }, 1000);
                centerFloatingContainer();
                floatingContainer.style.display = "flex";
            }
            // --- Logic for ZML_AudioPlayerNode (workflow trigger) ---
            else if (node.type === "ZML_AudioPlayerNode") {
                // Automatically play audio when the node is executed by the workflow
                playAudioForNode(node);
            }
        });

        // Listen for when a node finishes execution to hide the pause UI
        api.addEventListener("executed", ({ detail: { node } }) => {
            if (node && node === currentlyPausedNodeId) {
                stopAndHidePauseUI();
            }
        });
    }
});