import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// FINAL & COMPLETE JS with Custom Styling (DEBUG VERSION)
let currentlyPausedNodeId = null, countdownIntervalId = null, isDragging = false;
let dragStartPos = { x: 0, y: 0 }, elementStartPos = { x: 0, y: 0 };
const floatingContainer = document.createElement("div");

// 计算并设置悬浮球的默认中心位置
Object.assign(floatingContainer.style, {
    position: "fixed",
    // 初始不显示，后续通过JS计算居中
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
    zIndex: "9999", // 确保在最上层
    // 将 bottom 和 right 设为 auto，方便通过 top/left 居中
    bottom: "auto",
    right: "auto",
});

const mainButton = document.createElement("button");
// 将文本更名为“选择输出的管道”
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
            stopAndHide();
        }
    });
    choicePanel.appendChild(choiceButton);
}
floatingContainer.append(mainButton, countdownText, choicePanel);
document.body.appendChild(floatingContainer);

// 辅助函数：将悬浮球居中
function centerFloatingContainer() {
    // 确保容器已添加到DOM并可见，才能正确获取其尺寸
    floatingContainer.style.visibility = "hidden"; // 临时隐藏，避免闪烁
    floatingContainer.style.display = "flex"; // 临时显示以获取尺寸

    const containerWidth = floatingContainer.offsetWidth;
    const containerHeight = floatingContainer.offsetHeight;

    floatingContainer.style.left = `${(window.innerWidth - containerWidth) / 2}px`;
    floatingContainer.style.top = `${(window.innerHeight - containerHeight) / 2}px`;

    floatingContainer.style.visibility = "visible"; // 恢复可见
}


// --- 核心逻辑 (拖动、显示/隐藏等) ---
mainButton.addEventListener("click", (e) => {
    if (isDragging) return;
    choicePanel.style.display = choicePanel.style.display === "flex" ? "none" : "flex";
});

floatingContainer.addEventListener("mousedown", (e) => {
    // 拖动时，取消自动居中定位，使用 top/left 定位
    floatingContainer.style.bottom = "auto";
    floatingContainer.style.right = "auto";

    dragStartPos = { x: e.clientX, y: e.clientY };
    // 使用 getBoundingClientRect 来获取准确的当前位置，因为它考虑了所有CSS变换
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

// 当窗口大小改变时重新居中
window.addEventListener("resize", () => {
    if (floatingContainer.style.display === "flex" && !isDragging) { // 仅当显示且未在拖动时才自动居中
        centerFloatingContainer();
    }
});

function stopAndHide() {
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    countdownIntervalId = null;
    floatingContainer.style.display = "none";
    choicePanel.style.display = "none";
    currentlyPausedNodeId = null;
}

app.registerExtension({
    name: "ZML.PauseNodeGlobalListener",
    setup() {
        api.addEventListener("executing", ({ detail: nodeId }) => {
            if (!nodeId) return;
            const node = app.graph.getNodeById(nodeId);
            if (node && node.type === "ZML_PauseNode") {
                currentlyPausedNodeId = nodeId;
                const durationWidget = node.widgets.find(w => w.name === "暂停时长");
                let duration = durationWidget ? durationWidget.value : 30;
                countdownText.textContent = `${duration}s`;
                countdownIntervalId = setInterval(() => {
                    duration--;
                    countdownText.textContent = `${duration}s`;
                    if (duration <= 0) stopAndHide();
                }, 1000);
                // 每次显示时居中
                centerFloatingContainer();
                floatingContainer.style.display = "flex";
            }
        });
        api.addEventListener("executed", ({ detail: nodeId }) => {
            if (nodeId && nodeId === currentlyPausedNodeId) stopAndHide();
        });
    }
});