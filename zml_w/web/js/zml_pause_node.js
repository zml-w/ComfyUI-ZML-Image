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