import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// 布尔开关节点的最小尺寸常量
const ZML_BOOLEAN_SWITCH_MIN_WIDTH = 270;
const ZML_BOOLEAN_SWITCH_MIN_HEIGHT = 180;

// 暂停节点的最小尺寸常量
const ZML_PAUSE_NODE_MIN_WIDTH = 265;
const ZML_PAUSE_NODE_MIN_HEIGHT = 350;

// =================================================================
// ZML_AudioPlayerNode: HELPER FUNCTION AND GLOBAL STATE
// =================================================================

let zmlCurrentAudio = null; // Global reference to the currently playing audio
let zmlNotificationContainer = null; // Global notification container

/**
 * Shows a system notification using the Notification API.
 * @param {string} title The main title of the notification.
 * @param {string} subtitle The subtitle/body of the notification.
 */
async function showSystemNotification(title, subtitle) {
    // Check if Notification API is supported
    if (!("Notification" in window)) {
        console.log("[ZML] This browser does not support system notifications.");
        return false;
    }

    // Request permission if not granted
    if (Notification.permission === "default") {
        await Notification.requestPermission();
    }

    if (Notification.permission === "granted") {
        const notification = new Notification(title, {
            body: subtitle || "",
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            tag: "zml-notification",
            requireInteraction: false,
        });

        // Auto close after 5 seconds
        setTimeout(() => notification.close(), 5000);
        return true;
    } else {
        console.log("[ZML] Notification permission denied.");
        return false;
    }
}

/**
 * Shows a notification popup with the specified style, content and position.
 * @param {string} title The main title of the notification.
 * @param {string} subtitle The subtitle of the notification.
 * @param {string} style The style of the notification: "卡通" or "简约".
 * @param {string} position The position of the notification: "左上", "右上", "左下", "右下".
 */
function showNotification(title, subtitle, style, position) {
    // Remove existing container if position changed
    if (zmlNotificationContainer) {
        zmlNotificationContainer.remove();
        zmlNotificationContainer = null;
    }

    // Create notification container
    zmlNotificationContainer = document.createElement("div");
    zmlNotificationContainer.id = "zml-notification-container";

    // Set position styles based on position parameter
    const positionStyles = {
        "左上": { top: "20px", left: "20px", right: "auto", bottom: "auto" },
        "右上": { top: "20px", right: "20px", left: "auto", bottom: "auto" },
        "左下": { bottom: "20px", left: "20px", right: "auto", top: "auto" },
        "右下": { bottom: "20px", right: "20px", left: "auto", top: "auto" },
    };

    const posStyle = positionStyles[position] || positionStyles["右下"];

    Object.assign(zmlNotificationContainer.style, {
        position: "fixed",
        zIndex: "99999",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        pointerEvents: "none",
        ...posStyle,
    });
    document.body.appendChild(zmlNotificationContainer);

    // Create notification element
    const notification = document.createElement("div");
    const isCartoon = style === "卡通";

    // Adjust animation based on position
    const enterAnimation = position.startsWith("左")
        ? "zml-notification-slide-left 0.4s ease-out"
        : "zml-notification-slide-right 0.4s ease-out";

    if (isCartoon) {
        // Enhanced Cartoon style with bell icon
        Object.assign(notification.style, {
            background: "linear-gradient(135deg, #FF6B6B 0%, #FFE66D 50%, #4ECDC4 100%)",
            borderRadius: "24px",
            padding: "0",
            boxShadow: "0 15px 35px rgba(255, 107, 107, 0.4), 0 5px 15px rgba(0,0,0,0.2), inset 0 2px 0 rgba(255,255,255,0.3)",
            color: "#333",
            minWidth: "300px",
            maxWidth: "380px",
            animation: enterAnimation,
            pointerEvents: "auto",
            position: "relative",
            overflow: "hidden",
            border: "4px solid #fff",
        });

        // Add decorative elements for cartoon style with bell icon
        notification.innerHTML = `
            <div style="position: absolute; top: -30px; right: -30px; width: 100px; height: 100px; background: radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%); border-radius: 50%;"></div>
            <div style="position: absolute; bottom: -40px; left: -40px; width: 120px; height: 120px; background: radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%); border-radius: 50%;"></div>
            <div style="position: absolute; top: 10px; left: 15px; font-size: 40px; animation: zml-bell-ring 2s ease-in-out infinite; transform-origin: top center;">🔔</div>
            <div style="position: relative; z-index: 1; padding: 25px 25px 25px 70px;">
                <div style="font-size: 20px; font-weight: bold; margin-bottom: 6px; color: #2c3e50; text-shadow: 1px 1px 0 rgba(255,255,255,0.5);">${title}</div>
                ${subtitle ? `<div style="font-size: 14px; color: #555; line-height: 1.5;">${subtitle}</div>` : ""}
            </div>
            <div style="position: absolute; top: 5px; right: 5px; width: 15px; height: 15px; background: #FF6B6B; border-radius: 50%; animation: zml-blink 1.5s ease-in-out infinite;"></div>
            <div style="position: absolute; bottom: 10px; left: 10px; width: 8px; height: 8px; background: #4ECDC4; border-radius: 50%;"></div>
            <div style="position: absolute; bottom: 20px; right: 20px; width: 6px; height: 6px; background: #FFE66D; border-radius: 50%;"></div>
        `;
    } else if (style === "自定义") {
        // Custom style with Notice.ico - pink-green color scheme
        Object.assign(notification.style, {
            background: "linear-gradient(145deg, #fff0f5 0%, #ffe4ec 30%, #f0fff4 70%, #e8f5e9 100%)",
            borderRadius: "20px",
            padding: "0",
            boxShadow: "0 15px 35px rgba(255, 182, 193, 0.3), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.8)",
            color: "#333",
            minWidth: "340px",
            maxWidth: "420px",
            animation: enterAnimation,
            pointerEvents: "auto",
            position: "relative",
            overflow: "hidden",
            border: "2px solid rgba(255, 182, 193, 0.3)",
        });

        // Pink-green color scheme with Notice.ico
        notification.innerHTML = `
            <!-- 顶部装饰线 -->
            <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #ff69b4 0%, #ffb6c1 30%, #98fb98 70%, #90ee90 100%);"></div>

            <!-- 左侧图标区域 -->
            <div style="position: absolute; top: 0; left: 0; bottom: 0; width: 130px; background: linear-gradient(180deg, rgba(255, 182, 193, 0.25) 0%, rgba(144, 238, 144, 0.15) 100%); display: flex; align-items: center; justify-content: center;">
                <img src="/zml/get_notice_icon" style="width: 90px; height: 90px; object-fit: contain; border-radius: 16px;" />
            </div>

            <!-- 内容区域 -->
            <div style="position: relative; z-index: 1; padding: 28px 28px 28px 150px;">
                <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px; color: #d63384; letter-spacing: 0.5px;">${title}</div>
                ${subtitle ? `<div style="font-size: 14px; color: #6b8e6b; line-height: 1.5; font-weight: 400;">${subtitle}</div>` : ""}
            </div>

            <!-- 右下角装饰 -->
            <div style="position: absolute; bottom: 12px; right: 12px; display: flex; gap: 6px; align-items: center;">
                <div style="width: 6px; height: 6px; background: #ff69b4; border-radius: 50%;"></div>
                <div style="width: 4px; height: 4px; background: #98fb98; border-radius: 50%;"></div>
                <div style="width: 4px; height: 4px; background: #ffb6c1; border-radius: 50%;"></div>
            </div>

            <!-- 背景装饰图案 -->
            <div style="position: absolute; top: -40px; right: -40px; width: 120px; height: 120px; background: radial-gradient(circle, rgba(255, 182, 193, 0.15) 0%, transparent 70%); border-radius: 50%; pointer-events: none;"></div>
            <div style="position: absolute; bottom: -20px; left: 60px; width: 80px; height: 80px; background: radial-gradient(circle, rgba(144, 238, 144, 0.12) 0%, transparent 70%); border-radius: 50%; pointer-events: none;"></div>
        `;
    } else {
        // Minimalist style
        Object.assign(notification.style, {
            background: "rgba(30, 30, 30, 0.95)",
            borderRadius: "8px",
            padding: "16px 20px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            color: "white",
            minWidth: "260px",
            maxWidth: "320px",
            animation: enterAnimation,
            pointerEvents: "auto",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(10px)",
        });

        notification.innerHTML = `
            <div style="font-size: 16px; font-weight: 600; margin-bottom: ${subtitle ? "4px" : "0"}; letter-spacing: 0.3px;">${title}</div>
            ${subtitle ? `<div style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.4;">${subtitle}</div>` : ""}
        `;
    }

    // Add close button
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&times;";
    const isCustom = style === "自定义";
    Object.assign(closeBtn.style, {
        position: "absolute",
        top: isCartoon ? "12px" : (isCustom ? "15px" : "8px"),
        right: isCartoon ? "15px" : (isCustom ? "20px" : "10px"),
        background: isCartoon ? "rgba(255,255,255,0.3)" : (isCustom ? "rgba(255,255,255,0.2)" : "none"),
        border: "none",
        color: isCartoon ? "#333" : (isCustom ? "#fff" : "rgba(255,255,255,0.7)"),
        fontSize: "20px",
        cursor: "pointer",
        padding: "0",
        width: "28px",
        height: "28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        transition: "all 0.2s",
        zIndex: "10",
    });
    closeBtn.onmouseover = () => {
        closeBtn.style.color = isCartoon ? "#000" : "white";
        closeBtn.style.background = isCartoon ? "rgba(255,255,255,0.5)" : (isCustom ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)");
        closeBtn.style.transform = "scale(1.1)";
    };
    closeBtn.onmouseout = () => {
        closeBtn.style.color = isCartoon ? "#333" : (isCustom ? "#fff" : "rgba(255,255,255,0.7)");
        closeBtn.style.background = isCartoon ? "rgba(255,255,255,0.3)" : (isCustom ? "rgba(255,255,255,0.2)" : "none");
        closeBtn.style.transform = "scale(1)";
    };
    closeBtn.onclick = () => {
        const exitAnimation = position.startsWith("左")
            ? "zml-notification-fade-out-left 0.3s ease-out forwards"
            : "zml-notification-fade-out-right 0.3s ease-out forwards";
        notification.style.animation = exitAnimation;
        setTimeout(() => notification.remove(), 300);
    };
    notification.appendChild(closeBtn);

    zmlNotificationContainer.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            const exitAnimation = position.startsWith("左")
                ? "zml-notification-fade-out-left 0.3s ease-out forwards"
                : "zml-notification-fade-out-right 0.3s ease-out forwards";
            notification.style.animation = exitAnimation;
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Add CSS animations
if (!document.getElementById("zml-notification-styles")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "zml-notification-styles";
    styleSheet.textContent = `
        @keyframes zml-notification-slide-right {
            0% { transform: translateX(100%); opacity: 0; }
            100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes zml-notification-slide-left {
            0% { transform: translateX(-100%); opacity: 0; }
            100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes zml-notification-fade-out-right {
            0% { transform: translateX(0); opacity: 1; }
            100% { transform: translateX(100%); opacity: 0; }
        }
        @keyframes zml-notification-fade-out-left {
            0% { transform: translateX(0); opacity: 1; }
            100% { transform: translateX(-100%); opacity: 0; }
        }
        @keyframes zml-bell-ring {
            0%, 100% { transform: rotate(0deg); }
            10%, 30%, 50%, 70%, 90% { transform: rotate(15deg); }
            20%, 40%, 60%, 80% { transform: rotate(-15deg); }
        }
        @keyframes zml-blink {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
        }
    `;
    document.head.appendChild(styleSheet);
}

/**
 * Plays the audio file selected in a ZML_AudioPlayerNode or ZML_PureAudioPlayerNode.
 * @param {object} node The audio player node instance from the graph.
 */
async function playAudioForNode(node) {
    // Stop any previously playing audio
    if (zmlCurrentAudio) {
        zmlCurrentAudio.pause();
        zmlCurrentAudio.currentTime = 0;
    }

    const audioFileWidget = node.widgets.find(w => w.name === "音频文件");
    const volumeWidget = node.widgets.find(w => w.name === "播放音量");

    // Play audio
    if (audioFileWidget && audioFileWidget.value && !audioFileWidget.value.startsWith("(")) {
        const filename = audioFileWidget.value;
        const audioUrl = `/zml/get_audio?filename=${encodeURIComponent(filename)}`;

        zmlCurrentAudio = new Audio(audioUrl);
        // Set volume (0-1 range)
        const volume = volumeWidget ? volumeWidget.value : 1.0;
        zmlCurrentAudio.volume = Math.max(0, Math.min(1, volume));
        
        zmlCurrentAudio.play().catch(e => {
            console.error(`[ZML_AudioPlayer] Failed to play audio: ${filename}`, e);
        });
    }
}

/**
 * Handles both audio player and notification nodes.
 * @param {object} node The node instance from the graph.
 */
async function handleAudioPlayerNode(node) {
    // Check if it's a notification node (has enablePopup widget)
    const enablePopupWidget = node.widgets.find(w => w.name === "启用弹窗");
    
    if (enablePopupWidget) {
        // It's a notification node - play audio and show notification
        await playAudioForNode(node);
        
        const titleWidget = node.widgets.find(w => w.name === "主标题");
        const subtitleWidget = node.widgets.find(w => w.name === "副标题");
        const styleWidget = node.widgets.find(w => w.name === "风格");
        const positionWidget = node.widgets.find(w => w.name === "弹窗位置");
        const notificationTypeWidget = node.widgets.find(w => w.name === "通知类型");

        const enablePopup = enablePopupWidget.value;
        if (enablePopup) {
            const title = titleWidget ? titleWidget.value : "任务完成";
            const subtitle = subtitleWidget ? subtitleWidget.value : "";
            const style = styleWidget ? styleWidget.value : "卡通";
            const position = positionWidget ? positionWidget.value : "右下";
            const notificationType = notificationTypeWidget ? notificationTypeWidget.value : "页面通知";

            if (notificationType === "系统通知") {
                // Try system notification first
                const systemNotificationSuccess = await showSystemNotification(title, subtitle);
                // Fall back to page notification if system notification fails
                if (!systemNotificationSuccess) {
                    showNotification(title, subtitle, style, position);
                }
            } else {
                // Page notification
                showNotification(title, subtitle, style, position);
            }
        }
    } else {
        // It's a pure audio player node - just play audio
        await playAudioForNode(node);
    }
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
        // --- Add "Play" button to ZML_AudioPlayerNode and ZML_PureAudioPlayerNode ---
        if (nodeData.name === "ZML_AudioPlayerNode" || nodeData.name === "ZML_PureAudioPlayerNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                // Add the manual play button
                this.addWidget("button", "播放", null, () => {
                   handleAudioPlayerNode(this); 
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
        // --- Add image preview to ZML_PauseNode ---
        else if (nodeData.name === "ZML_PauseNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                
                // 检查是否已经有预览图像容器，如果有则不重复添加
                if (this.widgets && this.widgets.find(w => w.name === "预览")) {
                    return;
                }
                
                // 预先定义CSS样式
                if (!document.getElementById('zml-pause-preview-styles')) {
                    const styleSheet = document.createElement('style');
                    styleSheet.id = 'zml-pause-preview-styles';
                    styleSheet.textContent = `
                        .zml-node-image-container {
                            border: 1px solid #444;
                            border-radius: 8px;
                            background-color: #2a2a2a;
                            padding: 8px;
                            width: 100%;
                            box-sizing: border-box;
                            margin-top: -5px;
                            overflow: hidden;
                            position: relative;
                        }
                        .zml-node-preview-image {
                            max-width: 100%;
                            max-height: 200px;
                            object-fit: contain;
                            border-radius: 4px;
                            display: block;
                            margin: 0 auto;
                        }
                        .zml-node-image-loading {
                            padding: 16px;
                            color: #ccc;
                            text-align: center;
                            font-size: 12px;
                        }
                        .zml-image-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                            grid-auto-rows: min-content;
                            gap: 8px;
                            margin-top: 8px;
                            max-height: 400px;
                            overflow-y: auto;
                        }
                        .zml-grid-image-item {
                            border: 1px solid #555;
                            border-radius: 4px;
                            overflow: hidden;
                            position: relative;
                            cursor: pointer;
                        }
                        .zml-grid-image {
                            width: 100%;
                            height: auto;
                            object-fit: contain;
                            max-height: 100%;
                        }
                        .zml-grid-image-item:hover {
                            border-color: #4a90e2;
                        }
                        .zml-grid-image-item.selected {
                            border-color: #4a90e2;
                            box-shadow: 0 0 8px rgba(74, 144, 226, 0.5);
                        }
                        .zml-image-mark {
                            position: absolute;
                            bottom: 4px;
                            left: 4px;
                            background-color: rgba(74, 144, 226, 0.9);
                            color: white;
                            padding: 2px 6px;
                            border-radius: 3px;
                            font-size: 10px;
                            font-weight: bold;
                            z-index: 10;
                            min-width: 20px;
                            text-align: center;
                        }
                        .zml-channel-effect {
                            animation: pulse 0.3s ease-in-out;
                        }
                        @keyframes pulse {
                            0% { transform: scale(1); }
                            50% { transform: scale(1.1); background: linear-gradient(45deg, #ff6b6b, #ee5a24); }
                            100% { transform: scale(1); }
                        }
                        /* 按钮按下状态样式 */
                        .zml-refresh-button:active {
                            transform: scale(0.95);
                            background-color: #333 !important;
                        }
                        .zml-channel-button:active {
                            transform: scale(0.95) !important;
                            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3) !important;
                        }
                        /* 全部按钮样式 */
                        .zml-single-image-button {
                            padding: 4px 12px;
                            background: linear-gradient(45deg, #ff9800, #ffb74d);
                            color: white;
                            border: 2px solid #ff9800;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                            font-weight: bold;
                            transition: all 0.2s ease;
                            height: 32px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            z-index: 20;
                        }
                        .zml-single-image-button:hover {
                            transform: scale(1.05);
                            background: linear-gradient(45deg, #f57c00, #ffa726);
                            box-shadow: 0 2px 8px rgba(255, 152, 0, 0.4);
                        }
                        .zml-single-image-button:active {
                            transform: scale(0.95) !important;
                            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3) !important;
                        }
                        /* 全部显示模式样式 */
                        .zml-single-image-container {
                            display: none;
                            position: relative;
                            margin-top: 12px;
                            width: 100%;
                            height: 300px;
                            background-color: #1a1a1a;
                            border-radius: 8px;
                            overflow: hidden;
                            box-sizing: border-box;
                            z-index: 10;
                        }
                        .zml-single-image-container.active {
                            display: block;
                        }
                        .zml-main-image {
                            width: 100%;
                            height: 100%;
                            object-fit: contain;
                            border: none;
                        }
                        /* 通道序号显示样式 */
                        .zml-channel-number {
                            position: absolute;
                            top: 8px;
                            left: 8px;
                            background-color: rgba(0, 0, 0, 0.8);
                            color: white;
                            padding: 4px 8px;
                            border-radius: 4px;
                            font-size: 12px;
                            font-weight: bold;
                            z-index: 20;
                        }
                        /* 确保全部容器在按钮下方 */
                        .zml-image-grid {
                            margin-top: 8px;
                        }
                        .zml-nav-button {
                            position: absolute;
                            top: 50%;
                            transform: translateY(-50%);
                            width: 40px;
                            height: 40px;
                            background-color: rgba(0, 0, 0, 0.7);
                            color: white;
                            border: none;
                            border-radius: 50%;
                            font-size: 20px;
                            font-weight: bold;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s ease;
                            z-index: 10;
                        }
                        .zml-nav-button:hover {
                            background-color: rgba(0, 0, 0, 0.9);
                            transform: translateY(-50%) scale(1.1);
                        }
                        .zml-nav-button.prev {
                            left: 10px;
                        }
                        .zml-nav-button.next {
                            right: 10px;
                        }
                    `;
                    document.head.appendChild(styleSheet);
                }
                
                // 创建主容器
                const mainContainer = document.createElement("div");
                mainContainer.className = "zml-node-image-container";
                
                mainContainer.style.cssText = "display: block;";
                // 创建按钮容器（包含刷新按钮和通道按钮）
                const buttonsContainer = document.createElement("div");
                buttonsContainer.style.cssText = "display: flex; gap: 8px; margin-bottom: 12px; width: 100%; align-items: center;";
                
                // 创建刷新按钮
                const refreshButton = document.createElement("button");
                refreshButton.textContent = "刷新";
                refreshButton.className = "zml-refresh-button";
                refreshButton.style.cssText = `
                    padding: 4px 8px;
                    background-color: #444;
                    color: #ccc;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 10px;
                    height: 32px;
                    transition: all 0.1s ease;
                `;
                
                // 创建倒计时显示元素
                const countdownElement = document.createElement("div");
                countdownElement.className = "zml-countdown-timer";
                countdownElement.style.cssText = `
                    padding: 4px 8px;
                    background-color: #2a2a2a;
                    color: #ffcc00;
                    border: 1px solid #444;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    height: 32px;
                    width: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                countdownElement.textContent = "60s";
                
                buttonsContainer.appendChild(refreshButton);
                buttonsContainer.appendChild(countdownElement);
                
                // 添加三个通道选择按钮
                for (let i = 0; i < 3; i++) {
                    const channelButton = document.createElement("button");
                    channelButton.textContent = `${i + 1}`;
                    channelButton.dataset.channel = i;
                    channelButton.className = "zml-channel-button";
                    channelButton.style.cssText = `
                        padding: 4px 8px;
                        background: linear-gradient(45deg, #4a90e2, #7aaee0);
                        color: white;
                        border: 2px solid #4a90e2;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        font-weight: bold;
                        transition: all 0.2s ease;
                        min-width: 32px;
                        height: 32px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    `;
                    
                    // 添加通道按钮点击状态样式
                    const channelButtonStyle = document.createElement('style');
                    channelButtonStyle.textContent = `
                        .zml-channel-button.clicked {
                            background: linear-gradient(45deg, #28a745, #4caf50) !important;
                            border-color: #218838 !important;
                            color: white !important;
                            box-shadow: 0 2px 8px rgba(40, 167, 69, 0.4);
                        }
                    `;
                    document.head.appendChild(channelButtonStyle);
                    
                    channelButton.onmouseover = () => {
                        channelButton.style.transform = "scale(1.05)";
                        channelButton.style.background = "linear-gradient(45deg, #3a7bd5, #6aa0de)";
                        channelButton.style.boxShadow = "0 2px 8px rgba(74, 144, 226, 0.4)";
                    };
                    
                    channelButton.onmouseout = () => {
                        channelButton.style.transform = "scale(1)";
                        channelButton.style.background = "linear-gradient(45deg, #4a90e2, #7aaee0)";
                        channelButton.style.boxShadow = "none";
                    };
                    
                    channelButton.onclick = async (e) => {
                        e.stopPropagation();
                        const channelNum = i + 1;
                        
                        // 为按钮1添加特效
                        if (channelNum === 1) {
                            channelButton.classList.add('zml-channel-effect');
                            setTimeout(() => {
                                channelButton.classList.remove('zml-channel-effect');
                            }, 300);
                        }
                        
                        // 标记当前活动的通道按钮
                        document.querySelectorAll('.zml-channel-button').forEach(btn => {
                            btn.classList.remove('clicked');
                        });
                        channelButton.classList.add('clicked');
                        
                        // 存储当前活动的通道编号到图像网格容器
                        imageGrid.dataset.activeChannel = channelNum;
                        
                        // 不再修改已选中图像的通道标记，保留它们的原始通道
                        // 只需确保所有带标记的图像都有正确的显示
                        document.querySelectorAll('.zml-grid-image-item.selected').forEach(imgItem => {
                            const channel = imgItem.dataset.channel || channelNum;
                            let mark = imgItem.querySelector('.zml-image-mark');
                            if (!mark) {
                                mark = document.createElement('div');
                                mark.className = 'zml-image-mark';
                                imgItem.appendChild(mark);
                            }
                            mark.textContent = channel;
                        });
                    };
                    
                    buttonsContainer.appendChild(channelButton);
                }
                
                // 添加单图按钮
                const singleImageButton = document.createElement("button");
                singleImageButton.textContent = "全部";
                singleImageButton.className = "zml-single-image-button";
                singleImageButton.style.cssText = `
                    padding: 4px 12px;
                    background: linear-gradient(45deg, #28a745, #4caf50);
                    color: white;
                    border: 2px solid #28a745;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: bold;
                    transition: all 0.2s ease;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                singleImageButton.onmouseover = () => {
                    singleImageButton.style.transform = "scale(1.05)";
                    singleImageButton.style.background = "linear-gradient(45deg, #218838, #388e3c)";
                    singleImageButton.style.boxShadow = "0 2px 8px rgba(40, 167, 69, 0.4)";
                };
                
                singleImageButton.onmouseout = () => {
                    singleImageButton.style.transform = "scale(1)";
                    singleImageButton.style.background = "linear-gradient(45deg, #28a745, #4caf50)";
                    singleImageButton.style.boxShadow = "none";
                    // 如果按钮未处于激活状态，恢复原始颜色
                    if (!isSingleImageMode) {
                        singleImageButton.style.background = "linear-gradient(45deg, #28a745, #4caf50)";
                        singleImageButton.style.borderColor = "#28a745";
                    }
                };
                
                // 添加全部显示容器
                const singleImageContainer = document.createElement("div");
                singleImageContainer.className = "zml-single-image-container";
                
                // 创建主图元素
                const mainImage = document.createElement("img");
                mainImage.className = "zml-main-image";
                singleImageContainer.appendChild(mainImage);
                
                // 变量声明
                let isSingleImageMode = false;
                
                // 创建放大镜按钮
                const zoomButton = document.createElement("button");
                zoomButton.className = "zml-zoom-button";
                zoomButton.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    width: 32px;
                    height: 32px;
                    background-color: rgba(0, 0, 0, 0.7);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    font-weight: bold;
                    z-index: 20;
                    transition: all 0.2s ease;
                `;
                zoomButton.textContent = "🔍";
                zoomButton.onmouseover = () => {
                    zoomButton.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
                    zoomButton.style.transform = "scale(1.1)";
                };
                zoomButton.onmouseout = () => {
                    zoomButton.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
                    zoomButton.style.transform = "scale(1)";
                };
                singleImageContainer.appendChild(zoomButton);
                
                // 创建图像查看弹窗
                const createImageViewerModal = () => {
                    // 检查弹窗是否已存在
                    let modal = document.getElementById('zml-image-viewer-modal');
                    if (!modal) {
                        modal = document.createElement('div');
                        modal.id = 'zml-image-viewer-modal';
                        modal.style.cssText = `
                            position: fixed;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            background-color: rgba(0, 0, 0, 0.9);
                            display: none;
                            z-index: 1000;
                            margin: 0;
                            box-sizing: border-box;
                            overflow: auto;
                        `;
                        
                        const modalContent = document.createElement('div');
                        modalContent.style.cssText = `
                            position: relative;
                            width: 100%;
                            height: 100%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            box-sizing: border-box;
                            padding: 20px;
                        `;
                        
                        const modalImage = document.createElement('img');
                        modalImage.style.cssText = `
                            max-width: 100%;
                            max-height: calc(100vh - 60px); /* 为关闭按钮留出空间 */
                            width: auto;
                            height: auto;
                            object-fit: contain;
                            display: block;
                            margin: 0 auto;
                        `;
                        
                        const closeButton = document.createElement('button');
                        closeButton.style.cssText = `
                            position: fixed;
                            top: 50px;
                            right: 50px;
                            background-color: #ff4d4d;
                            color: white;
                            border: 2px solid white;
                            border-radius: 4px;
                            padding: 10px 20px;
                            cursor: pointer;
                            font-size: 18px;
                            z-index: 10001;
                            min-width: 80px;
                            text-align: center;
                        `;
                        closeButton.textContent = '关闭';
                        closeButton.onclick = () => {
                            modal.style.display = 'none';
                        };
                        
                        // 点击模态框背景关闭
                        modal.onclick = (e) => {
                            if (e.target === modal) {
                                modal.style.display = 'none';
                            }
                        };
                        
                        modalContent.appendChild(modalImage);
                        modalContent.appendChild(closeButton);
                        modal.appendChild(modalContent);
                        document.body.appendChild(modal);
                    }
                    return modal;
                };
                
                // 放大镜按钮点击事件
                zoomButton.onclick = () => {
                    if (isSingleImageMode && mainImage.src) {
                        const modal = createImageViewerModal();
                        const modalImage = modal.querySelector('img');
                        modalImage.src = mainImage.src;
                        modal.style.display = 'flex';
                    }
                };
                
                // 创建左切换按钮
                const prevButton = document.createElement("button");
                prevButton.textContent = "‹";
                prevButton.className = "zml-nav-button prev";
                singleImageContainer.appendChild(prevButton);
                
                // 创建右切换按钮
                const nextButton = document.createElement("button");
                nextButton.textContent = "›";
                nextButton.className = "zml-nav-button next";
                singleImageContainer.appendChild(nextButton);
                
                let currentImageIndex = 0;
                let allImages = [];
                let channelNumberElement = null;
                
                // 创建通道序号元素
                function createChannelNumberElement() {
                    channelNumberElement = document.createElement('div');
                    channelNumberElement.className = 'zml-channel-number';
                    channelNumberElement.style.display = 'none';
                    singleImageContainer.appendChild(channelNumberElement);
                }
                
                // 更新通道序号显示
                function updateChannelNumber() {
                    if (!channelNumberElement) {
                        createChannelNumberElement();
                    }
                    
                    if (currentImageIndex >= 0 && currentImageIndex < allImages.length) {
                        const currentGridItem = allImages[currentImageIndex].closest('.zml-grid-image-item');
                        if (currentGridItem && currentGridItem.classList.contains('selected')) {
                            // 只有当图像被选中时才显示通道号，并且仅使用图像自身的通道信息
                            const channel = currentGridItem.dataset.channel;
                            if (channel) {
                                channelNumberElement.textContent = `通道 ${channel}`;
                                channelNumberElement.style.display = 'block';
                            } else {
                                channelNumberElement.style.display = 'none';
                            }
                        } else {
                            channelNumberElement.style.display = 'none';
                        }
                    } else {
                        channelNumberElement.style.display = 'none';
                    }
                }
                
                // 创建通道序号元素
                createChannelNumberElement();
                
                singleImageButton.onclick = () => {
                    // 切换全部模式
                    isSingleImageMode = !isSingleImageMode;
                    singleImageContainer.classList.toggle("active");
                    
                    // 更新按钮文字
                    singleImageButton.textContent = isSingleImageMode ? "单图" : "全部";
                    
                    // 添加按下反馈
                    singleImageButton.style.background = isSingleImageMode 
                        ? "linear-gradient(45deg, #1e7e34, #388e3c)" 
                        : "linear-gradient(45deg, #28a745, #4caf50)";
                    singleImageButton.style.borderColor = isSingleImageMode ? "#1e7e34" : "#28a745";
                    
                    // 显示或隐藏图像网格
                    if (imageGrid) {
                        imageGrid.style.display = isSingleImageMode ? "none" : "grid";
                    }
                    
                    // 如果开启全部模式，显示第一张图
                    if (isSingleImageMode) {
                        // 获取所有图像
                        allImages = Array.from(document.querySelectorAll('.zml-grid-image'));
                        if (allImages.length > 0) {
                            currentImageIndex = 0;
                            mainImage.src = allImages[currentImageIndex].src;
                            
                            // 检查当前图像是否被选中
                            updateImageSelectionState();
                            
                            // 更新通道序号显示
                            updateChannelNumber();
                        }
                    }
                };
                
                // 更新图像选择状态
                function updateImageSelectionState() {
                    if (isSingleImageMode && allImages.length > 0) {
                        const currentGridItem = allImages[currentImageIndex].closest('.zml-grid-image-item');
                        if (currentGridItem) {
                            // 添加选中状态的视觉反馈
                            mainImage.style.border = currentGridItem.classList.contains('selected') ? '3px solid #4a90e2' : 'none';
                            // 更新通道序号显示
                            updateChannelNumber();
                        }
                    }
                }
                
                // 点击主图切换选择状态
                mainImage.onclick = () => {
                    if (isSingleImageMode && allImages.length > 0) {
                        const currentGridItem = allImages[currentImageIndex].closest('.zml-grid-image-item');
                        if (currentGridItem) {
                            // 切换选中状态
                            currentGridItem.classList.toggle('selected');
                            
                            // 同步通道信息（修复关键点：移到updateImageSelectionState之前）
                            const activeChannel = imageGrid.dataset.activeChannel || '1';
                            currentGridItem.dataset.channel = activeChannel;
                            
                            // 更新或添加通道标记
                            let mark = currentGridItem.querySelector('.zml-image-mark');
                            if (!mark) {
                                mark = document.createElement('div');
                                mark.className = 'zml-image-mark';
                                currentGridItem.appendChild(mark);
                            }
                            mark.textContent = activeChannel;
                            
                            // 更新选中状态的视觉反馈
                            updateImageSelectionState();
                        }
                    }
                }
                
                // 左切换按钮点击事件
                prevButton.onclick = () => {
                    if (allImages.length === 0) return;
                    currentImageIndex = (currentImageIndex - 1 + allImages.length) % allImages.length;
                    mainImage.src = allImages[currentImageIndex].src;
                    // 更新选择状态的视觉反馈
                    updateImageSelectionState();
                    // 更新通道序号显示
                    updateChannelNumber();
                };
                
                // 右切换按钮点击事件
                nextButton.onclick = () => {
                    if (allImages.length === 0) return;
                    currentImageIndex = (currentImageIndex + 1) % allImages.length;
                    mainImage.src = allImages[currentImageIndex].src;
                    // 更新选择状态的视觉反馈
                    updateImageSelectionState();
                    // 更新通道序号显示
                    updateChannelNumber();
                };
                
                buttonsContainer.appendChild(singleImageButton);
                
                // 添加输出按钮
                const outputButton = document.createElement("button");
                outputButton.textContent = "输出";
                outputButton.style.cssText = `
                    padding: 4px 12px;
                    background: linear-gradient(45deg, #28a745, #4caf50);
                    color: white;
                    border: 2px solid #28a745;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: bold;
                    transition: all 0.2s ease;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                outputButton.onmouseover = () => {
                    outputButton.style.transform = "scale(1.05)";
                    outputButton.style.background = "linear-gradient(45deg, #218838, #388e3c)";
                    outputButton.style.boxShadow = "0 2px 8px rgba(40, 167, 69, 0.4)";
                };
                
                outputButton.onmouseout = () => {
                    outputButton.style.transform = "scale(1)";
                    outputButton.style.background = "linear-gradient(45deg, #28a745, #4caf50)";
                    outputButton.style.boxShadow = "none";
                };
                
                outputButton.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        // 获取选中的图像并按通道分组
                        const selectedImages = document.querySelectorAll('.zml-grid-image-item.selected');
                        
                        // 按通道分组图像
                        const imagesByChannel = {};
                        
                        // 如果有选中的图像，按通道分组
                        if (selectedImages.length > 0) {
                            selectedImages.forEach(img => {
                                const channel = img.dataset.channel || '1'; // 默认通道1
                                if (!imagesByChannel[channel]) {
                                    imagesByChannel[channel] = [];
                                }
                                imagesByChannel[channel].push(parseInt(img.dataset.index));
                            });
                        }
                        
                        // 无论是否有选中图像，都发送请求以继续流程
                        await api.fetchApi("/zml/unpause", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                node_id: this.id, 
                                // 发送所有通道的图像映射，空对象表示没有选择任何图像
                                channels_images_map: imagesByChannel
                            }),
                        });
                        
                        // 点击输出后重置倒计时
                        // 先清除现有的计时器
                        if (countdownTimer) {
                            clearInterval(countdownTimer);
                            countdownTimer = null;
                        }
                        // 重置时间并更新显示
                        remainingTime = 60;
                        updateCountdownDisplay();
                        
                        // 按钮点击后添加视觉反馈
                        outputButton.style.background = "linear-gradient(45deg, #1e7e34, #388e3c)";
                        outputButton.style.borderColor = "#1e7e34";
                        setTimeout(() => {
                            outputButton.style.background = "linear-gradient(45deg, #28a745, #4caf50)";
                            outputButton.style.borderColor = "#28a745";
                        }, 500);
                    } catch (error) {
                        console.error("[ZML_PauseNode] Failed to output selected images:", error);
                        // 错误时的视觉反馈
                        outputButton.style.background = "linear-gradient(45deg, #dc3545, #f44336)";
                        outputButton.style.borderColor = "#dc3545";
                        setTimeout(() => {
                            outputButton.style.background = "linear-gradient(45deg, #28a745, #4caf50)";
                            outputButton.style.borderColor = "#28a745";
                        }, 1000);
                    }
                };
                
                buttonsContainer.appendChild(outputButton);
                
                // 先将按钮容器添加到主容器（确保按钮在顶部）
                mainContainer.appendChild(buttonsContainer);
                
                // 再将全部容器添加到主容器（全部在按钮下方）
                mainContainer.appendChild(singleImageContainer);
                
                // 创建加载指示器
                const loadingIndicator = document.createElement("div");
                loadingIndicator.className = "zml-node-image-loading";
                loadingIndicator.textContent = "暂无预览图像";
                mainContainer.appendChild(loadingIndicator);
                
                // 创建图像网格容器
                const imageGrid = document.createElement("div");
                imageGrid.className = "zml-image-grid";
                imageGrid.style.display = "none";
                mainContainer.appendChild(imageGrid);
                
                // 加载预览图像的函数 - 支持多张图像
                const loadNodePreviewImages = (nodeId) => {
                    loadingIndicator.textContent = "加载预览中...";
                    imageGrid.style.display = "none";
                    
                    let retryCount = 0;
                    const maxRetries = 5;
                    const retryInterval = 300;
                    
                    function tryLoadImages() {
                        // 清空现有图像
                        imageGrid.innerHTML = '';
                        
                        // 尝试加载多张图像
                        const maxImages = 100; // 设置一个较大的上限
                        const imagePromises = [];
                        
                        for (let i = 0; i < maxImages; i++) {
                            imagePromises.push(
                                fetch(`/zml_pause_node/preview/${nodeId}?index=${i}`)
                                    .then(response => {
                                        if (!response.ok) {
                                            throw new Error(`Image ${i} not found`);
                                        }
                                        return response.blob();
                                    })
                                    .then(blob => {
                                        return { index: i, blob: blob };
                                    })
                                    .catch(() => null)
                            );
                            
                            // 为了避免一次请求过多图像，每5个图像添加一个短暂延迟
                            if ((i + 1) % 5 === 0 && i + 1 < maxImages) {
                                const delayPromise = new Promise(resolve => {
                                    setTimeout(() => resolve(null), 100);
                                });
                                imagePromises.push(delayPromise);
                            }
                        }
                        
                        Promise.all(imagePromises)
                            .then(results => {
                                // 过滤掉失败的图像和延迟promise
                                const validImages = results.filter(img => img !== null);
                                
                                if (validImages.length === 0) {
                                    throw new Error("没有可显示的图像");
                                }
                                
                                // 创建图像元素并添加到网格
                                validImages.forEach(({ index, blob }) => {
                                    const imageItem = document.createElement("div");
                                    imageItem.className = "zml-grid-image-item";
                                    imageItem.dataset.index = index;
                                    
                                    const image = document.createElement("img");
                                    image.className = "zml-grid-image";
                                    image.src = URL.createObjectURL(blob);
                                    
                                    // 添加点击事件，允许用户选择图像
                                    imageItem.onclick = () => {
                                        // 切换选中状态（而不是移除其他选中项）
                                        if (imageItem.classList.contains('selected')) {
                                            imageItem.classList.remove('selected');
                                            // 移除标记和通道信息
                                            const existingMark = imageItem.querySelector('.zml-image-mark');
                                            if (existingMark) existingMark.remove();
                                            delete imageItem.dataset.channel;
                                        } else {
                                            imageItem.classList.add('selected');
                                            // 获取当前活动通道
                                            const activeChannel = imageGrid.dataset.activeChannel || '1'; // 默认使用通道1
                                            
                                            // 为图像存储其通道信息
                                            imageItem.dataset.channel = activeChannel;
                                            
                                            // 添加对应通道的标记
                                            const mark = document.createElement('div');
                                            mark.className = 'zml-image-mark';
                                            mark.textContent = activeChannel;
                                            imageItem.appendChild(mark);
                                        }
                                        
                                        // 更新左上角通道号显示
                                        updateChannelNumber();
                                    };
                                    
                                    imageItem.appendChild(image);
                                    imageGrid.appendChild(imageItem);
                                });
                                
                                // 显示网格或单图，隐藏加载指示器
                                // 只有在非单图模式下才显示网格
                                imageGrid.style.display = isSingleImageMode ? "none" : "grid";
                                
                                // 如果处于单图模式，更新单图显示
                                if (isSingleImageMode) {
                                    allImages = Array.from(document.querySelectorAll('.zml-grid-image'));
                                    if (allImages.length > 0) {
                                        currentImageIndex = 0;
                                        mainImage.src = allImages[currentImageIndex].src;
                                        // 检查当前图像是否被选中
                                        updateImageSelectionState();
                                        // 更新通道序号显示
                                        updateChannelNumber();
                                    }
                                }
                                
                                loadingIndicator.style.display = "none";
                            })
                            .catch(error => {
                                if (retryCount < maxRetries) {
                                    retryCount++;
                                    setTimeout(tryLoadImages, retryInterval);
                                } else {
                                    loadingIndicator.textContent = "无法加载预览图像";
                                }
                            });
                    }
                    
                    tryLoadImages();
                };
                
                // 倒计时变量
                let countdownTimer = null;
                let remainingTime = 60;
                
                // 更新倒计时显示
                const updateCountdownDisplay = () => {
                    countdownElement.textContent = `${remainingTime}s`;
                    // 当剩余时间少于10秒时，改变颜色以示警告
                    if (remainingTime < 10) {
                        countdownElement.style.color = "#ff6b6b";
                        countdownElement.style.fontWeight = "bold";
                    } else {
                        countdownElement.style.color = "#ffcc00";
                        countdownElement.style.fontWeight = "bold";
                    }
                };
                
                // 开始倒计时
                const startCountdown = () => {
                    // 重置时间
                    remainingTime = 60;
                    updateCountdownDisplay();
                    
                    // 清除现有的计时器
                    if (countdownTimer) {
                        clearInterval(countdownTimer);
                    }
                    
                    // 启动新的倒计时
                    countdownTimer = setInterval(() => {
                        remainingTime--;
                        updateCountdownDisplay();
                        
                        // 当倒计时结束时
                        if (remainingTime <= 0) {
                            clearInterval(countdownTimer);
                            countdownTimer = null;
                            
                            // 自动点击输出按钮，选择第一张图像
                            // 获取第一张图像并选中
                            const firstImageItem = document.querySelector('.zml-grid-image-item');
                            if (firstImageItem) {
                                // 清除所有已选中的图像
                                document.querySelectorAll('.zml-grid-image-item.selected').forEach(item => {
                                    item.classList.remove('selected');
                                    const existingMark = item.querySelector('.zml-image-mark');
                                    if (existingMark) existingMark.remove();
                                    delete item.dataset.channel;
                                });
                                
                                // 选中第一张图像
                                firstImageItem.classList.add('selected');
                                firstImageItem.dataset.channel = '1';
                                firstImageItem.dataset.index = firstImageItem.dataset.index || '0';
                                
                                // 添加标记
                                const mark = document.createElement('div');
                                mark.className = 'zml-image-mark';
                                mark.textContent = '1';
                                firstImageItem.appendChild(mark);
                            }
                            
                            // 触发输出按钮点击事件
                            outputButton.click();
                        }
                    }, 1000);
                };
                
                // 绑定刷新按钮事件
                refreshButton.addEventListener("click", () => {
                    loadNodePreviewImages(this.id);
                    // 刷新时重新开始倒计时
                    startCountdown();
                });
                
                // 监听节点执行事件，自动加载预览
                const nodeId = this.id;
                const handleNodeExecuting = (event) => {
                    if (event.detail === nodeId) {
                        loadNodePreviewImages(nodeId);
                    }
                };
                
                api.addEventListener("executing", handleNodeExecuting);
                
                // 组件销毁时清理
                this.onRemoved = () => {
                    api.removeEventListener("executing", handleNodeExecuting);
                    // 清除倒计时器
                    if (countdownTimer) {
                        clearInterval(countdownTimer);
                        countdownTimer = null;
                    }
                };
                
                // 使用addDOMWidget将自定义UI挂载到节点
                this.addDOMWidget(
                    "pause_preview",
                    "预览",
                    mainContainer,
                    {}
                );
                
                // 设置节点的最小尺寸
                this.size = [
                    Math.max(this.size[0] || 0, ZML_PAUSE_NODE_MIN_WIDTH),
                    Math.max(this.size[1] || 0, ZML_PAUSE_NODE_MIN_HEIGHT)
                ];
                
                // 重写onResize方法以确保最小尺寸限制
                const origOnResize = this.onResize;
                this.onResize = function(size) {
                    // 确保最小宽度
                    size[0] = Math.max(size[0], ZML_PAUSE_NODE_MIN_WIDTH);
                    // 确保最小高度
                    size[1] = Math.max(size[1], ZML_PAUSE_NODE_MIN_HEIGHT);
                    
                    this.size = size;
                    
                    if (origOnResize) origOnResize.call(this, size);
                };
            };
        }
        // --- Add custom toggle UI to ZML_BooleanSwitch ---
        else if (nodeData.name === "ZML_BooleanSwitch") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                
                // 找到布尔值widget
                const booleanWidget = this.widgets.find(w => w.name === "启用");
                if (!booleanWidget) return;
                
                // 隐藏所有默认widgets
                this.widgets.forEach(widget => {
                    if (widget.element) {
                        widget.element.style.display = 'none';
                    }
                });
                
                // 预先定义CSS动画和样式
                if (!document.getElementById('zml-toggle-styles')) {
                    const styleSheet = document.createElement('style');
                    styleSheet.id = 'zml-toggle-styles';
                    styleSheet.textContent = `
                        .zml-toggle-ripple {
                            position: absolute;
                            border-radius: 50%;
                            background: rgba(255,255,255,0.3);
                            transform: scale(0);
                            animation: zml-ripple-animation 0.6s ease-out forwards;
                            pointer-events: none;
                        }
                        @keyframes zml-ripple-animation {
                            0% { transform: scale(0); opacity: 1; }
                            100% { transform: scale(2); opacity: 0; }
                        }
                        .zml-checkbox-check {
                            position: absolute;
                            left: 50%;
                            top: 50%;
                            width: 0;
                            height: 0;
                            transform: translate(-50%, -50%) scale(0);
                            transition: transform 0.2s ease;
                        }
                        .zml-checkbox-check.checked {
                            transform: translate(-50%, -50%) scale(1);
                        }
                        .zml-node-container {
                            border: 1px solid #444;
                            border-radius: 8px;
                            background-color: #2a2a2a;
                            padding: 12px;
                            width: 100%;
                            box-sizing: border-box;
                        }
                    `;
                    document.head.appendChild(styleSheet);
                }
                
                // 创建主容器 - 模拟右侧节点的框式布局
                const mainContainer = document.createElement("div");
                mainContainer.className = "zml-node-container";
                mainContainer.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    padding: 6px 16px 10px 16px;
                    box-sizing: border-box;
                    margin-top: -8px;
                `;
                
                // 移除标题行，不再显示开关状态和值
                
                // 创建开关容器
                const toggleContainer = document.createElement("div");
                toggleContainer.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 10px;
                    width: 100%;
                    padding-left: 5px;
                `;
                
                // 添加样式选择器和尺寸控制容器
                const controlsRow = document.createElement("div");
                controlsRow.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    width: 100%;
                    padding-left: 0;
                `;
                
                // 添加样式选择器
                const styleSelectorContainer = document.createElement("div");
                styleSelectorContainer.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 10px;
                    color: #ccc;
                    margin-left: -16px;
                    white-space: nowrap;
                    padding-left: 0;
                `;
                
                const styleLabel = document.createElement("span");
                styleLabel.textContent = "样式:";
                styleSelectorContainer.appendChild(styleLabel);
                
                // 创建样式选择按钮组
                const styleGroup = document.createElement("div");
                styleGroup.style.cssText = `
                    display: flex;
                    border: 1px solid #555;
                    border-radius: 4px;
                    overflow: hidden;
                `;
                
                // 创建样式选择状态变量
                let currentStyle = 'slider'; // 默认样式为滑块
                
                // 滑块样式按钮
                const sliderStyleBtn = document.createElement("button");
                sliderStyleBtn.textContent = "滑块";
                sliderStyleBtn.style.cssText = `
                    padding: 3px 6px;
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-size: 9px;
                    transition: background-color 0.2s ease;
                    min-width: 28px;
                    text-align: center;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                // 方框样式按钮
                const checkboxStyleBtn = document.createElement("button");
                checkboxStyleBtn.textContent = "方框";
                checkboxStyleBtn.style.cssText = `
                    padding: 3px 6px;
                    background-color: #444;
                    color: #ccc;
                    border: none;
                    cursor: pointer;
                    font-size: 9px;
                    transition: background-color 0.2s ease;
                    min-width: 28px;
                    text-align: center;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                styleGroup.appendChild(sliderStyleBtn);
                styleGroup.appendChild(checkboxStyleBtn);
                styleSelectorContainer.appendChild(styleGroup);
                controlsRow.appendChild(styleSelectorContainer);
                
                // 添加尺寸控制
                const sizeControlsContainer = document.createElement("div");
                sizeControlsContainer.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 10px;
                    color: #ccc;
                    margin-right: 5px;
                `;
                
                // 宽度控制
                const widthContainer = document.createElement("div");
                widthContainer.style.display = 'flex';
                widthContainer.style.alignItems = 'center';
                widthContainer.style.gap = '3px';
                
                const widthLabel = document.createElement("span");
                widthLabel.textContent = "宽:";
                
                const widthInput = document.createElement("input");
                widthInput.type = "number";
                widthInput.min = "40";
                widthInput.max = "300";
                widthInput.value = "160";
                widthInput.style.cssText = `
                    width: 54px;
                    height: 30px;
                    font-size: 14px;
                    padding: 4px 3px;
                    background-color: #333;
                    color: #ccc;
                    border: 1px solid #555;
                    border-radius: 3px;
                    text-align: center;
                `;
                
                widthContainer.appendChild(widthLabel);
                widthContainer.appendChild(widthInput);
                
                // 高度控制
                const heightContainer = document.createElement("div");
                heightContainer.style.display = 'flex';
                heightContainer.style.alignItems = 'center';
                heightContainer.style.gap = '3px';
                
                const heightLabel = document.createElement("span");
                heightLabel.textContent = "高:";
                
                const heightInput = document.createElement("input");
                heightInput.type = "number";
                heightInput.min = "20";
                heightInput.max = "200";
                heightInput.value = "40";
                heightInput.style.cssText = `
                    width: 54px;
                    height: 30px;
                    font-size: 14px;
                    padding: 4px 3px;
                    background-color: #333;
                    color: #ccc;
                    border: 1px solid #555;
                    border-radius: 3px;
                    text-align: center;
                `;
                
                heightContainer.appendChild(heightLabel);
                heightContainer.appendChild(heightInput);
                
                sizeControlsContainer.appendChild(widthContainer);
                sizeControlsContainer.appendChild(heightContainer);
                controlsRow.appendChild(sizeControlsContainer);
                
                toggleContainer.appendChild(controlsRow);
                
                // 创建实际开关的容器
                const switchContainer = document.createElement("div");
                switchContainer.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    margin-top: 5px;
                `;
                toggleContainer.appendChild(switchContainer);
                
                // 将开关容器添加到主容器
                mainContainer.appendChild(toggleContainer);
                
                // 滑块样式开关元素
                const sliderToggleButton = document.createElement("div");
                const isEnabled = booleanWidget.value;
                sliderToggleButton.style.cssText = `
                    width: ${parseInt(widthInput.value)}px;
                    height: ${parseInt(heightInput.value)}px;
                    background-color: ${isEnabled ? '#4CAF50' : '#ccc'};
                    border-radius: ${parseInt(heightInput.value) / 2}px;
                    position: relative;
                    cursor: pointer;
                    transition: background-color 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    user-select: none;
                    box-shadow: inset 0 2px 4px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.05);
                    overflow: hidden;
                    will-change: background-color;
                `;
                
                // 添加内部光晕效果
                const innerGlow = document.createElement("div");
                innerGlow.style.cssText = `
                    position: absolute;
                    width: 30%;
                    height: 100%;
                    background: linear-gradient(to right, transparent, rgba(255,255,255,0.3), transparent);
                    left: -30%;
                    top: 0;
                    opacity: 0;
                    transition: all 0.6s ease;
                    pointer-events: none;
                `;
                sliderToggleButton.appendChild(innerGlow);
                
                // 创建滑块元素
                const toggleSlider = document.createElement("div");
                toggleSlider.style.cssText = `
                    position: absolute;
                    width: ${parseInt(heightInput.value)}px;
                    height: ${parseInt(heightInput.value)}px;
                    background: linear-gradient(145deg, #ffffff, #f0f0f0);
                    border-radius: 50%;
                    top: 0;
                    left: 0;
                    right: auto;
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    font-size: 12px;
                    user-select: none;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.2);
                    will-change: transform;
                `;
                
                // 方框样式开关元素
                const checkboxToggleButton = document.createElement("div");
                checkboxToggleButton.style.cssText = `
                    width: ${parseInt(widthInput.value)}px;
                    height: ${parseInt(heightInput.value)}px;
                    background-color: ${isEnabled ? '#4CAF50' : '#ccc'};
                    border-radius: 8px;
                    position: relative;
                    cursor: pointer;
                    transition: background-color 0.3s ease, transform 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    user-select: none;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                `;
                
                // 更新尺寸的函数
                function updateSwitchDimensions() {
                    const width = parseInt(widthInput.value) || 54;
                    const height = parseInt(heightInput.value) || 36;
                    
                    if (currentStyle === 'slider') {
                        // 设置滑块模式下的尺寸
                        sliderToggleButton.style.width = `${width}px`;
                        sliderToggleButton.style.height = `${height}px`;
                        
                        toggleSlider.style.width = `${height}px`;
                        toggleSlider.style.height = `${height}px`;
                        toggleSlider.style.fontSize = `${Math.max(10, height * 0.3)}px`;
                    } else {
                        // 设置方框模式下的尺寸
                        checkboxToggleButton.style.width = `${width}px`;
                        checkboxToggleButton.style.height = `${height}px`;
                    }
                }
                
                // 监听尺寸输入变化
                widthInput.addEventListener('change', updateSwitchDimensions);
                heightInput.addEventListener('change', updateSwitchDimensions);
                
                // 创建对号元素
                const checkMark = document.createElement("div");
                checkMark.className = isEnabled ? "zml-checkbox-check checked" : "zml-checkbox-check";
                checkboxToggleButton.appendChild(checkMark);
                
                // 初始只显示滑块样式
                switchContainer.appendChild(sliderToggleButton);
                sliderToggleButton.appendChild(toggleSlider);
                
                // 滑块样式的位置更新函数
                function updateSliderPosition(isOn) {
                    if (isOn) {
                        // 开启状态：滑块移到右侧
                        toggleSlider.style.transform = `translateX(calc(100% - ${parseInt(heightInput.value)}px)) scale(1.05)`;
                        toggleSlider.style.left = 'auto';
                        toggleSlider.style.right = '0';
                        toggleSlider.textContent = ''; // 删除开启状态的提示文本
                        toggleSlider.style.color = '#4CAF50';
                        toggleSlider.style.background = 'linear-gradient(145deg, #ffffff, #e6e6e6)';
                        // 添加开启时的发光效果
                        toggleSlider.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.6)';
                    } else {
                        // 关闭状态：滑块在左侧
                        toggleSlider.style.transform = 'translateX(0) scale(1)';
                        toggleSlider.style.left = '0';
                        toggleSlider.style.right = 'auto';
                        toggleSlider.textContent = 'OFF';
                        toggleSlider.style.color = '#666';
                        toggleSlider.style.background = 'linear-gradient(145deg, #ffffff, #f0f0f0)';
                        toggleSlider.style.boxShadow = '0 3px 8px rgba(0,0,0,0.2)';
                    }
                }
                
                // 方框样式的更新函数
                function updateCheckboxStyle(isOn) {
                    checkboxToggleButton.style.backgroundColor = isOn ? '#4CAF50' : '#ccc';
                    if (isOn) {
                        checkMark.classList.add('checked');
                    } else {
                        checkMark.classList.remove('checked');
                    }
                }
                
                // 样式切换函数
                function switchStyle(style) {
                    currentStyle = style;
                    
                    // 更新按钮状态
                    if (style === 'slider') {
                        sliderStyleBtn.style.backgroundColor = '#4CAF50';
                        sliderStyleBtn.style.color = 'white';
                        checkboxStyleBtn.style.backgroundColor = '#444';
                        checkboxStyleBtn.style.color = '#ccc';
                        
                        // 显示滑块样式，隐藏方框样式
                        switchContainer.innerHTML = '';
                        switchContainer.appendChild(sliderToggleButton);
                        sliderToggleButton.appendChild(toggleSlider);
                        
                        // 更新滑块状态和尺寸
                        sliderToggleButton.style.backgroundColor = booleanWidget.value ? '#4CAF50' : '#ccc';
                        updateSwitchDimensions();
                        updateSliderPosition(booleanWidget.value);
                    } else {
                        checkboxStyleBtn.style.backgroundColor = '#4CAF50';
                        checkboxStyleBtn.style.color = 'white';
                        sliderStyleBtn.style.backgroundColor = '#444';
                        sliderStyleBtn.style.color = '#ccc';
                        
                        // 显示方框样式，隐藏滑块样式
                        switchContainer.innerHTML = '';
                        switchContainer.appendChild(checkboxToggleButton);
                        checkboxToggleButton.appendChild(checkMark);
                        
                        // 更新方框状态和尺寸
                        updateSwitchDimensions();
                        updateCheckboxStyle(booleanWidget.value);
                    }
                }
                
                // 初始化滑块位置
                updateSliderPosition(isEnabled);
                updateCheckboxStyle(isEnabled);
                
                // 滑块样式的点击事件
                sliderToggleButton.addEventListener('click', (e) => {
                    // 显示光晕效果
                    innerGlow.style.opacity = '1';
                    innerGlow.style.left = '130%';
                    setTimeout(() => {
                        innerGlow.style.opacity = '0';
                        innerGlow.style.left = '-30%';
                    }, 600);
                    
                    // 创建波纹效果 - 使用预定义的CSS类
                    const ripple = document.createElement("span");
                    const rect = sliderToggleButton.getBoundingClientRect();
                    const size = Math.max(rect.width, rect.height);
                    const x = e.clientX - rect.left - size / 2;
                    const y = e.clientY - rect.top - size / 2;
                    
                    ripple.className = 'zml-toggle-ripple';
                    ripple.style.cssText += `
                        width: ${size}px;
                        height: ${size}px;
                        transform: translate(${x}px, ${y}px) scale(0);
                    `;
                    
                    sliderToggleButton.appendChild(ripple);
                    
                    // 清理波纹元素
                    setTimeout(() => {
                        ripple.remove();
                    }, 600);
                    
                    // 更新状态
                    updateState();
                });
                
                // 方框样式的点击事件
                checkboxToggleButton.addEventListener('click', () => {
                    // 添加点击反馈动画
                    checkboxToggleButton.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        checkboxToggleButton.style.transform = 'scale(1)';
                    }, 100);
                    
                    // 更新状态
                    updateState();
                });
                
                // 通用状态更新函数
                function updateState() {
                    booleanWidget.value = !booleanWidget.value;
                    const newValue = booleanWidget.value;
                    
                    // 根据当前样式更新UI
                    if (currentStyle === 'slider') {
                        sliderToggleButton.style.backgroundColor = newValue ? '#4CAF50' : '#ccc';
                        updateSliderPosition(newValue);
                    } else {
                        updateCheckboxStyle(newValue);
                    }
                    
                    // 通知应用程序节点数据已更改
                    app.graph.setDirtyCanvas(true, false);
                }
                
                // 样式选择按钮事件
                sliderStyleBtn.addEventListener('click', () => switchStyle('slider'));
                checkboxStyleBtn.addEventListener('click', () => switchStyle('checkbox'));
                
                // 使用ResizeObserver监听节点大小变化，以确保开关按钮大小合适
                const resizeObserver = new ResizeObserver(entries => {
                    for (let entry of entries) {
                        const { width } = entry.contentRect;
                        if (currentStyle === 'slider') {
                            // 重新计算滑块位置以适应新宽度
                            updateSliderPosition(booleanWidget.value);
                        }
                    }
                });
                
                // 观察节点容器
                if (this.parentElement) {
                    resizeObserver.observe(this.parentElement);
                }
                
                // 组件销毁时清理
                this.onRemoved = () => {
                    resizeObserver.disconnect();
                    // 移除事件监听器
                    widthInput.removeEventListener('change', updateSwitchDimensions);
                    heightInput.removeEventListener('change', updateSwitchDimensions);
                };
                
                // 使用addDOMWidget将自定义UI挂载到节点
                this.addDOMWidget(
                    "toggle_switch", // widget ID
                    "", // 空名称，避免显示额外标题
                    mainContainer, // 使用主容器作为DOM元素
                    {
                        serializeValue: () => {
                            // 只保存布尔值，这是Python节点定义中唯一的参数
                            return booleanWidget.value;
                        },
                        loadValue: (data) => {
                            // 设置开关状态
                            booleanWidget.value = data;
                            
                            // 更新UI状态
                            updateSwitchDimensions();
                        }
                    }
                );
                
                // 使用localStorage保存UI特定配置（样式、尺寸等）
                // 生成唯一的节点实例ID
                const nodeInstanceId = `${nodeData.name}_${this.id}`;
                
                // 加载保存的UI配置
                const loadUIConfig = () => {
                    try {
                        const savedConfig = localStorage.getItem(`zml_ui_config_${nodeInstanceId}`);
                        if (savedConfig) {
                            const config = JSON.parse(savedConfig);
                            if (config.style) {
                                currentStyle = config.style;
                            }
                            if (config.width) {
                                widthInput.value = config.width;
                            }
                            if (config.height) {
                                heightInput.value = config.height;
                            }
                            // 应用加载的样式
                            switchStyle(currentStyle);
                        }
                    } catch (e) {
                        console.error('Failed to load ZML UI config:', e);
                    }
                };
                
                // 保存UI配置到localStorage
                const saveUIConfig = () => {
                    try {
                        const config = {
                            style: currentStyle,
                            width: parseInt(widthInput.value),
                            height: parseInt(heightInput.value)
                        };
                        localStorage.setItem(`zml_ui_config_${nodeInstanceId}`, JSON.stringify(config));
                    } catch (e) {
                        console.error('Failed to save ZML UI config:', e);
                    }
                };
                
                // 初始加载UI配置
                loadUIConfig();
                
                // 监听样式和尺寸变化，自动保存
                sliderStyleBtn.addEventListener('click', saveUIConfig);
                checkboxStyleBtn.addEventListener('click', saveUIConfig);
                widthInput.addEventListener('change', () => {
                    updateSwitchDimensions();
                    saveUIConfig();
                });
                heightInput.addEventListener('change', () => {
                    updateSwitchDimensions();
                    saveUIConfig();
                });
                
                // 设置节点的最小尺寸
                this.size = [
                    Math.max(this.size[0] || 0, ZML_BOOLEAN_SWITCH_MIN_WIDTH),
                    Math.max(this.size[1] || 0, ZML_BOOLEAN_SWITCH_MIN_HEIGHT)
                ];
                
                // 重写onResize方法以确保最小尺寸限制
                const origOnResize = this.onResize;
                this.onResize = function(size) {
                    // 确保最小宽度
                    size[0] = Math.max(size[0], ZML_BOOLEAN_SWITCH_MIN_WIDTH);
                    // 确保最小高度
                    size[1] = Math.max(size[1], ZML_BOOLEAN_SWITCH_MIN_HEIGHT);
                    
                    this.size = size;
                    
                    if (origOnResize) origOnResize.call(this, size);
                };
            };
        }
    },

    setup() {
        // Listen for when any node starts executing
        api.addEventListener("executing", ({ detail: nodeId }) => {
            if (!nodeId) return;
            const node = app.graph.getNodeById(nodeId);
            if (!node) return;

            // --- Logic for ZML_AudioPlayerNode (workflow trigger) ---
            if (node.type === "ZML_AudioPlayerNode") {
                // Automatically play audio when the node is executed by the workflow
                playAudioForNode(node);
            }
        });
    }
});