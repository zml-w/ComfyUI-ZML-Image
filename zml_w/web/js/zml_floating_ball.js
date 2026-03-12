import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el } from "/scripts/ui.js";

// === 辅助函数：获取当前扩展的 basePath ===
function get_extension_base_path() {
    const scriptUrl = import.meta.url;
    const parts = scriptUrl.split('/');
    const extensionsIndex = parts.indexOf("extensions");
    if (extensionsIndex !== -1 && parts.length > extensionsIndex + 1) {
        return "/" + parts.slice(extensionsIndex, extensionsIndex + 2).join('/') + "/";
    }
    console.error("ZML Floating Ball: 无法自动推断扩展基础路径。脚本URL:", scriptUrl);
    if (window.zmlExtensionBasePath) {
        return window.zmlExtensionBasePath;
    }
    return "/extensions/ComfyUI-ZML-Image/"; 
}
// ===========================================

app.registerExtension({
	name: "ZML.FunFloatingBall.V37_CopyOnly", 
	async setup(app) {
		// --- 设置项 ---
		const visibilitySetting = app.ui.settings.addSetting({ id: "zml.floatingBall.show", name: "悬浮球 - 显示/隐藏", type: "boolean", defaultValue: true });
		const rememberPositionSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.rememberPosition", name: "悬浮球 - 记住上次位置", type: "boolean", defaultValue: true });
		const idleSizeSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.idleSize", name: "悬浮球 - 空闲尺寸 (px)", type: "slider", attrs: { min: 20, max: 300, step: 1 }, defaultValue: 100 });
		const runningSizeSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.runningSize", name: "悬浮球 - 运行尺寸 (px)", type: "slider", attrs: { min: 20, max: 500, step: 1 }, defaultValue: 200 });
		const dblClickAudioSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.dblClickAudio", name: "悬浮球 - 启用双击音频", type: "boolean", defaultValue: true });
		const runtimeAudioSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.runtimeAudioMode", name: "悬浮球 - 运行时音频", type: "combo",
			options: (v) => ["disable", "start", "end"].map(val => ({ value: val, text: {disable:"禁用",start:"开始时",end:"结束时"}[val], selected: v === val })),
			defaultValue: "disable",
		});
		const dblClickAnimationSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.dblClickAnimation", name: "悬浮球 - 启用双击动画", type: "boolean", defaultValue: true });
		const animationDurationSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.animationDuration", name: "悬浮球 - 动画显示时间 (秒)", type: "slider", attrs: { min: 0.1, max: 10, step: 0.1 }, defaultValue: 2 });
		const animationEffectSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.animationEffect", name: "悬浮球 - 双击动画效果", type: "combo",
			options: (v) => {
				const map = {
					"none": "无",
					"fade": "淡入淡出",
					"pop": "弹出",
					"slide": "滑动",
					"shake": "震动",
					"pulse": "脉冲"
				};
				return ["none", "fade", "pop", "slide", "shake", "pulse"].map(val => ({ value: val, text: map[val], selected: v === val }));
			},
			defaultValue: "fade",
		});
		const hoverEffectSetting = app.ui.settings.addSetting({ id: "zml.floatingBall.hoverEffect", name: "悬浮球 - 启用悬停呼吸效果", type: "boolean", defaultValue: true });
		const gifDelaySetting = app.ui.settings.addSetting({ id: "zml.floatingBall.gifDelay", name: "悬浮球 - GIF延迟显示 (秒)", type: "slider", attrs: { min: 0, max: 3, step: 0.1 }, defaultValue: 0.5 });

		// --- 资源路径 ---
		const extensionBasePath = get_extension_base_path();
		const baseImagePath = extensionBasePath + "images/"; 

		const idleImagePath = baseImagePath + "ZML.png";
		const runningGifPath = baseImagePath + "ZML.gif";
		const audioPath = baseImagePath + "ZML.wav";
		const animationImagePath = baseImagePath + "ZML2.png";
		const aiAvatarPath = baseImagePath + "A.png";
        const timerAudioPath = baseImagePath + "A.wav"; 
        const eatSubfolderPath = baseImagePath + "eat/";
        const eatGifPath = eatSubfolderPath + "eat.gif";
        const heartImagePath = eatSubfolderPath + "heart.png";
        
        const eatSoundPaths = [
            eatSubfolderPath + "A.wav",
            eatSubfolderPath + "B.wav",
            eatSubfolderPath + "C.wav"
        ];
        const eatSounds = eatSoundPaths.map(path => new Audio(path + "?t=" + new Date().getTime()));


		const audio = new Audio(audioPath);
        const timerAudio = new Audio(timerAudioPath + "?t=" + new Date().getTime()); 
		let animationTimeout = null;
		let gifDisplayTimeout = null;

		const floatingImage = $el("img", {
			src: idleImagePath,
			style: { width: "100%", height: "100%", borderRadius: "12px", display: "block", border: "none", outline: "none", pointerEvents: "none" }
		});

		const floatingBall = $el("div.zml-floating-ball", {
			style: {
				position: "fixed", bottom: "20px", left: "20px", width: "auto", height: "auto", borderRadius: "12px",
				backgroundColor: "transparent", border: "none", cursor: "pointer", zIndex: 9998,
				transition: "transform 0.2s ease-out, max-width 0.3s ease-out, max-height 0.3s ease-out, filter 0.3s ease-out",
				filter: "drop-shadow(0px 2px 5px rgba(0,0,0,0.5))"
			}
		}, [floatingImage]);

		// ================= CSS 样式 =================
		$el("style", {
			textContent: `
				/* 原有样式 */
				.zml-floating-ball.hidden { display: none; }
				.zml-floating-ball.breathing-effect { animation: zml-breathing 2.5s ease-in-out infinite; }
				@keyframes zml-breathing { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
				
				.zml-animation-fade, 
                .zml-animation-pop, 
                .zml-animation-slide, 
                .zml-animation-shake, 
                .zml-animation-pulse { 
                    animation-duration: 0.5s; 
                    animation-timing-function: ease-out; 
                }
                .zml-animation-fade { animation-name: zml-fade-in; } 
                .zml-animation-pop { animation-name: zml-pop-in; } 
                .zml-animation-slide { animation-name: zml-slide-up; } 
                .zml-animation-shake { animation-name: zml-shake; } 
                @keyframes zml-pulse-effect { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
                .zml-animation-pulse { animation-name: zml-pulse-effect; } 

				/* 聊天窗口样式 */
                .zml-chat-window {
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    width: 500px; max-width: 90vw; 
                    height: 750px; max-height: 90vh; 
                    background-color: #f7f9fc; border-radius: 24px;
                    border: 2px solid #d1d9e6;
                    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.15), 0 4px 10px rgba(0,0,0,0.1);
                    display: flex; flex-direction: column; z-index: 10000;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
                }
                .zml-chat-header {
                    padding: 12px 24px; background: linear-gradient(135deg, #81c784, #4caf50);
                    color: white; border-top-left-radius: 22px; border-top-right-radius: 22px;
                    display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none;
                }
                .zml-chat-header h3 { margin: 0; font-weight: 600; text-shadow: 1px 1px 2px rgba(0,0,0,0.2); }
                .zml-chat-header .zml-chat-controls { display: flex; gap: 12px; }
                .zml-chat-header .zml-chat-icon { cursor: pointer; font-size: 22px; opacity: 0.9; transition: all 0.2s ease; }
                .zml-chat-header .zml-chat-icon:hover { opacity: 1; transform: scale(1.2) rotate(10deg); }
                .zml-chat-messages { flex-grow: 1; padding: 10px 20px; overflow-y: auto; background-color: transparent; }
				.zml-chat-message-wrapper { display: flex; margin-bottom: 15px; align-items: flex-start; }
				.zml-chat-message-wrapper.user { justify-content: flex-end; }
				.zml-chat-message-wrapper.bot { justify-content: flex-start; }
				.zml-chat-bubble { 
					position: relative; max-width: 85%; padding: 12px 18px; 
					border-radius: 20px; line-height: 1.6; font-size: 15px;
					border: 2px solid #444; box-shadow: 3px 3px 0px #444;
					transition: transform 0.1s ease-out;
					color: #1a1a1a;
				}
				.zml-chat-bubble:hover { transform: translateY(-2px); }
                .zml-chat-bubble.user { background-color: #a5d6a7; border-top-right-radius: 8px; }
                .zml-chat-bubble.bot { background-color: #90caf9; border-top-left-radius: 8px; }
				.zml-chat-bubble.bot.typing, .zml-chat-bubble.error { 
					background-color: #fce68a; border-color: #c4a944; box-shadow: 3px 3px 0px #c4a944;
					color: #333; font-style: italic;
				}
				.zml-chat-message-actions { display: flex; align-items: center; gap: 8px; opacity: 0; transition: opacity 0.2s; flex-shrink: 0; }
				.zml-chat-message-wrapper:hover .zml-chat-message-actions { opacity: 1; }
				.zml-chat-message-wrapper.user .zml-chat-message-actions { order: -1; margin-right: 8px; }
				.zml-chat-message-wrapper.bot .zml-chat-message-actions { order: 1; margin-left: 8px; }
				.zml-chat-message-action-btn {
					background: #fff; border: 2px solid #444; border-radius: 50%;
					width: 28px; height: 28px; font-size: 14px;
					display: flex; align-items: center; justify-content: center;
					cursor: pointer; transition: all 0.2s;
				}
				.zml-chat-message-action-btn:hover { background: #f0f0f0; transform: scale(1.1); }
                .zml-chat-input-area { padding: 15px; border-top: 2px solid #d1d9e6; display: flex; gap: 10px; }
                .zml-chat-input-area input { flex-grow: 1; padding: 12px 18px; border: 2px solid #444; border-radius: 30px; outline: none; font-size: 15px; box-shadow: inset 2px 2px 0px rgba(0,0,0,0.1); }
                .zml-chat-input-area button { padding: 10px 24px; border: 2px solid #444; background-color: #ffc107; color: #444; border-radius: 30px; cursor: pointer; font-weight: bold; box-shadow: 3px 3px 0px #444; transition: all 0.1s ease-out; }
                .zml-chat-input-area button:hover { background-color: #ffca28; transform: translateY(-2px); box-shadow: 5px 5px 0px #444; }
				.zml-chat-input-area button:active { transform: translateY(1px); box-shadow: 2px 2px 0px #444; }
				.zml-chat-settings {
                    width: 300px; 
                    position: absolute; top: 60px; left: 15px; background: rgba(255,255,255,0.98);
                    border: 2px solid #444; border-radius: 12px; padding: 15px;
                    box-shadow: 4px 4px 0px #444; backdrop-filter: blur(4px);
                    display: none; flex-direction: column; gap: 10px; z-index: 10001;
                }
                .zml-chat-settings.show { display: flex; }
                .zml-chat-settings label { font-size: 12px; color: #555; margin-bottom: 4px; font-weight: 500;}
                .zml-chat-settings input, .zml-chat-settings textarea { font-size: 12px; padding: 5px; border-radius: 5px; border: 1px solid #ccc; }
				.zml-chat-settings textarea { resize: vertical; min-height: 60px; }
				.zml-chat-settings .zml-chat-help-container { position: absolute; top: 8px; right: 8px; }
				.zml-chat-help-icon { width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 2px solid #444; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #444; cursor: help; }
				.zml-chat-help-tooltip {
					display: none;
					position: absolute; top: 28px; right: 0;
					background: #444; color: #fff; padding: 5px 10px;
					border-radius: 6px; font-size: 12px; z-index: 1;
                    white-space: pre-wrap;
				}
				.zml-prompt-editor-overlay {
					position: fixed; top: 0; left: 0; width: 100%; height: 100%;
					background: rgba(0,0,0,0.6); z-index: 10002;
					display: flex; align-items: center; justify-content: center;
				}
				.zml-prompt-editor-window {
					width: 60vw; max-width: 800px; height: 70vh;
					background: #f7f9fc; border-radius: 18px;
					border: 2px solid #444; box-shadow: 6px 6px 0px #444;
					display: flex; flex-direction: column; padding: 20px;
				}
				.zml-prompt-editor-window h4 { 
					margin: 0 0 15px 0; font-size: 18px; color: #333;
					text-align: center;
				}
				.zml-prompt-editor-window textarea {
					flex-grow: 1; resize: none; font-size: 14px;
					padding: 10px; border: 2px solid #444; border-radius: 8px;
					box-shadow: inset 2px 2px 0px rgba(0,0,0,0.1); outline: none;
				}
				.zml-prompt-editor-buttons {
					margin-top: 15px; display: flex; justify-content: flex-end; gap: 12px;
				}
				.zml-prompt-editor-buttons button {
					padding: 8px 20px; border: 2px solid #444; border-radius: 20px;
					font-weight: bold; cursor: pointer; transition: all 0.1s ease-out;
				}
				.zml-prompt-editor-buttons .save-btn {
					background-color: #ffc107; color: #444; box-shadow: 3px 3px 0px #444;
				}
				.zml-prompt-editor-buttons .save-btn:hover {
					background-color: #ffca28; transform: translateY(-2px); box-shadow: 5px 5px 0px #444;
				}
				.zml-prompt-editor-buttons .cancel-btn {
					background-color: #e0e0e0; color: #444;
				}
				.zml-prompt-editor-buttons .cancel-btn:hover { background-color: #eee; }
				.zml-chat-avatar {
					width: 40px; height: 40px;
					border-radius: 50%;
					object-fit: cover;
					border: 2px solid #444;
					box-shadow: 2px 2px 0px #444;
					margin-right: 10px; 
					flex-shrink: 0; 
				}
				.zml-chat-message-wrapper.bot .zml-chat-avatar { order: -1; }
				.zml-chat-settings .reset-button {
					background-color: #f44336; color: white; border: 2px solid #c62828;
					padding: 8px 12px; border-radius: 8px; cursor: pointer;
					font-size: 12px; font-weight: bold; margin-top: 10px;
					box-shadow: 2px 2px 0px #c62828; transition: all 0.1s ease-out;
					width: fit-content; align-self: flex-end;
				}
				.zml-chat-settings .reset-button:hover {
					background-color: #e53935; transform: translateY(-1px); box-shadow: 3px 3px 0px #c62828;
				}
				.zml-chat-settings .reset-button:active {
					transform: translateY(1px); box-shadow: 1px 1px 0px #c62828;
				}
                .zml-timer-window {
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    width: 380px; background: #fdfbf0; border-radius: 20px;
                    border: 2px solid #444; box-shadow: 5px 5px 0 #444;
                    padding: 20px; z-index: 10001; display: flex; flex-direction: column;
                }
                .zml-timer-header { cursor: move; user-select: none; padding-bottom: 15px;
                    display: flex; justify-content: space-between; align-items: center; }
                .zml-timer-header h3 { margin: 0; font-size: 20px; color: #444; }
                .zml-timer-close-btn { font-size: 24px; cursor: pointer; color: #888; transition: color 0.2s; }
                .zml-timer-close-btn:hover { color: #444; }
                .zml-timer-display {
                    font-size: 4rem; font-weight: bold; color: #444;
                    text-align: center; padding: 20px 0; letter-spacing: 4px;
                    background: #fff; border-radius: 12px; border: 2px solid #444;
                    margin-bottom: 20px;
                }
                .zml-timer-controls { display: flex; justify-content: space-around; gap: 10px; margin-bottom: 20px; }
                .zml-timer-controls button {
                    flex-grow: 1; padding: 10px; font-size: 16px; font-weight: bold;
                    border-radius: 20px; border: 2px solid #444; cursor: pointer;
                    box-shadow: 3px 3px 0 #444; transition: all 0.1s ease-out;
                }
                .zml-timer-controls button:hover { transform: translateY(-2px); box-shadow: 5px 5px 0 #444; }
                .zml-timer-controls button:active { transform: translateY(1px); box-shadow: 2px 2px 0 #444; }
                .zml-timer-btn-start { background-color: #81c784; color: #fff; }
                .zml-timer-btn-pause { background-color: #ffc107; color: #444; }
                .zml-timer-btn-reset { background-color: #f44336; color: #fff; }
                .zml-timer-settings-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px; }
                .zml-timer-settings-grid div { display: flex; flex-direction: column; }
                .zml-timer-settings-grid label { font-size: 12px; margin-bottom: 5px; color: #666; }
                .zml-timer-settings-grid input[type="number"] {
                    width: 100%; padding: 8px; border-radius: 8px; border: 2px solid #444;
                    box-shadow: inset 2px 2px 0 rgba(0,0,0,0.1);
                }
                .zml-timer-settings label { font-size: 12px; color: #666; margin-bottom: 5px; }
                .zml-timer-settings input[type="text"] { width: 100%; padding: 8px; border-radius: 8px; border: 2px solid #444; margin-bottom: 10px; box-shadow: inset 2px 2px 0 rgba(0,0,0,0.1); }
                .zml-timer-settings .audio-toggle { display: flex; align-items: center; gap: 8px; font-size: 14px; }
                .zml-timer-notification {
                    position: fixed; bottom: 20px; right: 20px;
                    width: 320px; background-color: #ffeb3b; color: #444;
                    padding: 20px; border-radius: 12px; border: 2px solid #444;
                    box-shadow: 4px 4px 0 #444; z-index: 10002;
                    font-size: 16px; animation: zml-slide-in 0.5s ease-out;
                }
                .zml-timer-notification-close {
                    position: absolute; top: 8px; right: 8px;
                    font-size: 20px; cursor: pointer; color: #888;
                }
                @keyframes zml-slide-in { from { transform: translateX(120%); } to { transform: translateX(0); } }

                /* 喂养游戏样式 */
                .zml-feeding-window {
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    width: 500px; height: 600px; background: #fff5e1;
                    border: 2px solid #5d4037; border-radius: 20px;
                    box-shadow: 6px 6px 0 #5d4037;
                    z-index: 10003; display: flex; flex-direction: column;
                }
                .zml-feeding-header {
                    padding: 10px 20px; background-color: #8d6e63; color: #fff;
                    border-top-left-radius: 18px; border-top-right-radius: 18px;
                    display: flex; justify-content: space-between; align-items: center;
                    cursor: move; user-select: none;
                }
                .zml-feeding-header h3 { margin: 0; }
                .zml-feeding-close-btn { font-size: 24px; cursor: pointer; }
                .zml-feeding-main { flex-grow: 1; position: relative; display: flex; flex-direction: column; }
                .zml-shop-button {
                    position: absolute; top: 15px; right: 15px;
                    background: #ffc107; color: #444; border: 2px solid #444; border-radius: 12px;
                    padding: 8px 16px; font-weight: bold; cursor: pointer; z-index: 2;
                    box-shadow: 3px 3px 0 #444;
                }
                .zml-eat-gif-container {
                    flex-grow: 1; display: flex; align-items: center; justify-content: center;
                    position: relative; overflow: hidden; 
                }
                .zml-eat-gif-container img { max-width: 80%; max-height: 80%; }
                .zml-inventory-bar {
                    height: 100px; background: rgba(0,0,0,0.1);
                    border-top: 2px solid #5d4037;
                    display: flex; align-items: center; justify-content: center;
                    gap: 15px; padding: 10px;
                }
                .zml-inventory-item {
                    width: 70px; height: 70px; background: #fff; border: 2px solid #444;
                    border-radius: 12px; display: flex; align-items: center; justify-content: center;
                    box-shadow: 3px 3px 0 #444; cursor: grab; transition: transform 0.2s;
                }
                .zml-inventory-item:active { cursor: grabbing; transform: scale(1.1); }
                .zml-inventory-item img { width: 50px; height: 50px; object-fit: contain; pointer-events: none; }
                .zml-food-shop {
                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(255, 245, 225, 0.95);
                    z-index: 1; display: none; flex-direction: column; padding: 20px;
                    backdrop-filter: blur(4px);
                }
                .zml-food-shop.show { display: flex; }
                .zml-food-shop h4 { text-align: center; margin-top: 0; color: #444; }
                .zml-shop-grid {
                    flex-grow: 1; display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 15px; overflow-y: auto; padding-right: 10px;
                }
                .zml-shop-item {
                    background: #fff; border: 2px solid #444; border-radius: 12px;
                    padding: 10px; text-align: center; position: relative;
                }
                .zml-shop-item img { width: 50px; height: 50px; object-fit: contain; }
                .zml-shop-item p { margin: 5px 0 0; font-size: 12px; color: #444; }
                .zml-shop-item-add-btn {
                    position: absolute; top: -8px; right: -8px;
                    width: 28px; height: 28px; border-radius: 50%;
                    background: #81c784; color: #fff; border: 2px solid #444;
                    font-size: 20px; font-weight: bold; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; line-height: 28px;
                }
                .zml-shop-item-add-btn.clicked {
                    animation: zml-plus-pop 0.2s ease-out;
                }
                @keyframes zml-plus-pop {
                    50% { transform: scale(1.4); }
                }
                
                .zml-heart-effect {
                    position: absolute; top: 50%; left: 50%;
                    pointer-events: none;
                    animation: zml-heart-beat var(--duration, 0.8s) var(--delay, 0s) ease-out forwards;
                }
                @keyframes zml-heart-beat {
                    0% { transform: translate(var(--start-x, -50%), -50%) scale(0); opacity: 1; }
                    50% { transform: translate(var(--start-x, -50%), var(--end-y, -100%)) scale(1.2); opacity: 1; }
                    100% { transform: translate(var(--start-x, -50%), calc(var(--end-y, -100%) - 50%)) scale(0.5); opacity: 0; }
                }

                .zml-feeding-subtitle {
                    position: absolute;
                    top: 25%;
                    left: 50%;
                    transform: translateX(-50%);
                    background-color: rgba(0, 0, 0, 0.6);
                    color: white;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 18px;
                    font-weight: bold;
                    text-shadow: 1px 1px 2px black;
                    white-space: nowrap; 
                    pointer-events: none;
                    animation: zml-subtitle-float 1.5s ease-out forwards;
                }
                @keyframes zml-subtitle-float {
                    0% { opacity: 0; transform: translate(-50%, 20px); }
                    20% { opacity: 1; transform: translate(-50%, 0); }
                    80% { opacity: 1; transform: translate(-50%, 0); }
                    100% { opacity: 0; transform: translate(-50%, -20px); }
                }
			`,
			parent: document.body
		});
		document.body.appendChild(floatingBall);

		// --- 基础功能函数 ---
		const loadPosition = () => { if (rememberPositionSetting.value) { const pLeft = localStorage.getItem("zml.floatingBall.position.left"), pTop = localStorage.getItem("zml.floatingBall.position.top"); if(pLeft && pTop) { floatingBall.style.left = pLeft; floatingBall.style.top = pTop; floatingBall.style.bottom = 'auto'; floatingBall.style.right = 'auto'; } } };
		const savePosition = () => { if (rememberPositionSetting.value) { localStorage.setItem("zml.floatingBall.position.left", floatingBall.style.left); localStorage.setItem("zml.floatingBall.position.top", floatingBall.style.top); } };
		loadPosition();
		const applySize = (isIdle) => { const s = `${isIdle ? idleSizeSetting.value : runningSizeSetting.value}px`; floatingBall.style.maxWidth = s; floatingBall.style.maxHeight = s; floatingImage.style.maxWidth = s; floatingImage.style.maxHeight = s; };
		const createContextMenu = (e) => {
			const oldMenu = document.querySelector('.zml-ball-context-menu'); if (oldMenu) oldMenu.remove();
			const menu = $el("div.zml-ball-context-menu", { style: { position: 'absolute', left: `${e.clientX}px`, top: `${e.clientY}px`, backgroundColor: '#333', border: '1px solid #555', borderRadius: '5px', padding: '5px', zIndex: '10000', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' } });
			const createButton = (text, onclick) => { const btn = $el("button", { textContent: text, style: { background: 'none', border: 'none', color: '#eee', padding: '8px 12px', cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left' } }); btn.onmouseover = () => btn.style.backgroundColor = '#555'; btn.onmouseout = () => btn.style.backgroundColor = 'transparent'; btn.onclick = () => { onclick(); menu.remove(); }; return btn; };
            menu.append(
                createButton("聊天", () => openChatWindow()),
                createButton("投喂", () => openFeedingWindow()),
                createButton("设置倒计时", () => openTimerWindow()),
                createButton(dblClickAudioSetting.value ? "禁用双击音频" : "启用双击音频", () => { dblClickAudioSetting.value = !dblClickAudioSetting.value; }),
                createButton("隐藏悬浮球", () => { floatingBall.classList.add("hidden"); visibilitySetting.value = false; })
            );
			document.body.appendChild(menu);
			setTimeout(() => { const closeMenu = () => menu.remove(); document.addEventListener("click", closeMenu, { once: true }); document.addEventListener("contextmenu", closeMenu, { once: true }); }, 0);
		};

		// ================= 拖拽逻辑 =================
        function setupDraggable(element, header) {
            let offsetX, offsetY;
            
            const onMouseMove = (e) => {
                element.style.left = `${e.clientX - offsetX}px`;
                element.style.top = `${e.clientY - offsetY}px`;
                element.style.transform = 'none';
            };
        
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
            };
        
            header.addEventListener("mousedown", (e) => {
                if (e.target.closest('button, span, input, textarea, a, select, option, label')) return; 
                
                const rect = element.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
        
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'move';
            });
        }

		// ================= 聊天窗口功能区 =================
		let chatWindow = null;
		let chatHistory = JSON.parse(localStorage.getItem("zml.chat.history") || "[]").filter(msg => msg.parts && msg.parts[0] && msg.parts[0].text);
		let chatDisplayHistory = chatHistory.map((msg, index) => ({ id: `msg-${Date.now()}-${index}`, role: msg.role, text: msg.parts[0].text }));
		let messagesContainer;
		let chatInput;
        const defaultChatSettings = {
            apiKey: "",
            apiUrl: "https://api.deepseek.com",
            modelId: "deepseek-chat",
            systemPrompt: "你是一只猫娘。你是用户的乖妹妹，你要称呼用户为哥哥。", 
            temperature: 0.7,
            contextCount: 5,
        };
		const chatSettings = {
			apiKey: localStorage.getItem("zml.chat.apiKey") || defaultChatSettings.apiKey,
			apiUrl: localStorage.getItem("zml.chat.apiUrl") || defaultChatSettings.apiUrl,
			modelId: localStorage.getItem("zml.chat.modelId") || defaultChatSettings.modelId,
			systemPrompt: localStorage.getItem("zml.chat.systemPrompt") || defaultChatSettings.systemPrompt,
			temperature: parseFloat(localStorage.getItem("zml.chat.temperature")) || defaultChatSettings.temperature,
			contextCount: parseInt(localStorage.getItem("zml.chat.contextCount")) || defaultChatSettings.contextCount,
		};
		function saveChatSetting(key, value) { chatSettings[key] = value; localStorage.setItem(`zml.chat.${key}`, value); }
		function saveChatHistory() { localStorage.setItem("zml.chat.history", JSON.stringify(chatHistory)); }

        // === 修改重点：移除了编辑按钮，只保留复制和删除 ===
		function renderMessages() {
			if (!messagesContainer) return;
			messagesContainer.innerHTML = '';
			chatDisplayHistory.forEach((msg) => {
				const bubble = $el("div", { className: `zml-chat-bubble ${msg.role} ${msg.isError ? 'error' : ''}`, dataset: { messageId: msg.id } });
				bubble.textContent = msg.text;
				
				const actionsDiv = $el("div.zml-chat-message-actions");

                // 1. 复制按钮 (通用，所有消息和报错都可以复制)
				const copyButton = $el("button.zml-chat-message-action-btn", { textContent: "📋", title: "复制" });
				copyButton.onclick = (e) => {
					e.stopPropagation();
					const textToCopy = msg.text;

                    // 兼容性复制逻辑
                    const fallbackCopy = (text) => {
                        const textArea = document.createElement("textarea");
                        textArea.value = text;
                        document.body.appendChild(textArea);
                        textArea.select();
                        try {
                            document.execCommand('copy');
                            copyButton.textContent = '✓';
                            setTimeout(() => { copyButton.textContent = '📋'; }, 1500);
                        } catch (err) {
                            console.error('复制失败', err);
                        }
                        document.body.removeChild(textArea);
                    };

					if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            copyButton.textContent = '✓';
                            setTimeout(() => { copyButton.textContent = '📋'; }, 1500);
                        }).catch(() => fallbackCopy(textToCopy)); // API 失败则回退
                    } else {
                        fallbackCopy(textToCopy);
                    }
				};
				actionsDiv.appendChild(copyButton);

                // 2. 删除按钮 (通用)
				const deleteButton = $el("button.zml-chat-message-action-btn", { textContent: "❌", title: "删除" });
				deleteButton.onclick = (e) => { e.stopPropagation(); deleteMessage(msg.id); };
				actionsDiv.appendChild(deleteButton);

				const wrapper = $el("div", { className: `zml-chat-message-wrapper ${msg.role}` });
				if (msg.role === "bot") {
					const avatar = $el("img.zml-chat-avatar", { src: aiAvatarPath + "?t=" + new Date().getTime() });
					wrapper.append(avatar, bubble, actionsDiv);
				} else { 
					wrapper.append(actionsDiv, bubble);
				}
				messagesContainer.appendChild(wrapper);
			});
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}

		function deleteMessage(messageId) {
			const displayIndex = chatDisplayHistory.findIndex(msg => msg.id === messageId);
			if (displayIndex !== -1) {
				chatDisplayHistory.splice(displayIndex, 1);
				chatHistory.splice(displayIndex, 1);
				saveChatHistory();
				renderMessages();
			}
		}
		function editMessage(messageId) {
            // 保留函数定义但UI中不再调用
			const msgToEdit = chatDisplayHistory.find(msg => msg.id === messageId);
			if (msgToEdit && msgToEdit.role === "user") {
				chatInput.value = msgToEdit.text;
				deleteMessage(messageId);
				chatInput.focus();
			}
		}
		function clearAllMessages() {
			if (confirm("确定要清空所有聊天记录吗？")) {
				chatHistory = []; chatDisplayHistory = [];
				saveChatHistory(); renderMessages();
			}
		}
		function openSystemPromptEditor(displayTextArea) {
			const existingEditor = document.querySelector('.zml-prompt-editor-overlay');
			if (existingEditor) existingEditor.remove();
			const editorTextarea = $el("textarea", { textContent: chatSettings.systemPrompt });
			const closeEditor = () => overlay.remove();
			const saveButton = $el("button.save-btn", { textContent: "保存", onclick: () => {
				const newValue = editorTextarea.value;
				saveChatSetting("systemPrompt", newValue);
				displayTextArea.value = newValue; 
				closeEditor();
			}});
			const cancelButton = $el("button.cancel-btn", { textContent: "取消", onclick: closeEditor });
			const editorWindow = $el("div.zml-prompt-editor-window", {}, [
				$el("h4", { textContent: "编辑角色提示词" }),
				editorTextarea,
				$el("div.zml-prompt-editor-buttons", {}, [cancelButton, saveButton])
			]);
			const overlay = $el("div.zml-prompt-editor-overlay", {
				onclick: (e) => { if (e.target === overlay) closeEditor(); }
			}, [editorWindow]);
			document.body.appendChild(overlay);
			editorTextarea.focus();
		}
        function resetChatSettingsToDefault() {
            if (!confirm("确定要将所有聊天设置恢复到默认值吗？这将清空您所有自定义的API密钥、模型ID和提示词！")) {
                return;
            }
            for (const key in defaultChatSettings) {
                if (defaultChatSettings.hasOwnProperty(key)) {
                    saveChatSetting(key, defaultChatSettings[key]);
                }
            }
            const settingsInputs = {
                apiKey: document.querySelector('.zml-chat-settings input[type="password"]'),
                apiUrl: document.querySelector('.zml-chat-settings input[type="text"][value^="http"]'),
                modelId: document.querySelector('.zml-chat-settings input[type="text"][value*="deepseek"]'),
                systemPrompt: document.querySelector('.zml-chat-settings textarea'),
                temperature: document.querySelector('.zml-chat-settings input[type="range"][oninput*="温度"]'),
                contextCount: document.querySelector('.zml-chat-settings input[type="range"][oninput*="上下文数"]'),
            };
            if (settingsInputs.apiKey) settingsInputs.apiKey.value = defaultChatSettings.apiKey;
            if (settingsInputs.apiUrl) settingsInputs.apiUrl.value = defaultChatSettings.apiUrl;
            if (settingsInputs.modelId) settingsInputs.modelId.value = defaultChatSettings.modelId;
            if (settingsInputs.systemPrompt) settingsInputs.systemPrompt.value = defaultChatSettings.systemPrompt;
            if (settingsInputs.temperature) {
                settingsInputs.temperature.value = defaultChatSettings.temperature;
                const label = settingsInputs.temperature.previousSibling;
                if (label) label.textContent = `温度 (${defaultChatSettings.temperature})`;
            }
            if (settingsInputs.contextCount) {
                settingsInputs.contextCount.value = defaultChatSettings.contextCount;
                const label = settingsInputs.contextCount.previousSibling;
                if (label) label.textContent = `上下文数 (${defaultChatSettings.contextCount})`;
            }
            alert("聊天设置已恢复为默认值！");
        }
		function openChatWindow() {
			if (chatWindow) {
				chatWindow.style.display = 'flex';
				renderMessages();
				return;
			}
			messagesContainer = $el("div.zml-chat-messages");
			chatInput = $el("input", { type: "text", placeholder: "输入消息..." });
			const sendButton = $el("button", { textContent: "发送" });
			const helpTooltip = $el("div.zml-chat-help-tooltip", { innerHTML: "现在已经有了专门的LLM类节点，并且功能更丰富。" });
			const helpIcon = $el("div.zml-chat-help-icon", { textContent: "?" });
			helpIcon.onmouseenter = () => { helpTooltip.style.display = 'block'; };
			helpIcon.onmouseleave = () => { helpTooltip.style.display = 'none'; };
			const helpContainer = $el("div.zml-chat-help-container", {}, [helpIcon, helpTooltip]);
			const systemPromptDisplay = $el("textarea", {
				textContent: chatSettings.systemPrompt,
				readOnly: true,
				title: "点击编辑角色提示词",
				style: { cursor: "pointer", height: "60px" }
			});
			systemPromptDisplay.onclick = () => openSystemPromptEditor(systemPromptDisplay);
            const resetButton = $el("button.reset-button", {
                textContent: "恢复默认设置",
                onclick: resetChatSettingsToDefault
            });
			const settingsPanel = $el("div.zml-chat-settings", {}, [
				$el("div", {}, [$el("label", { textContent: "API 地址" }), $el("input", { type: "text", value: chatSettings.apiUrl, onchange: (e) => saveChatSetting("apiUrl", e.target.value) })]),
				$el("div", {}, [$el("label", { textContent: "API 密钥" }), $el("input", { type: "password", value: chatSettings.apiKey, onchange: (e) => saveChatSetting("apiKey", e.target.value) })]),
				$el("div", {}, [$el("label", { textContent: "模型 ID" }), $el("input", { type: "text", value: chatSettings.modelId, onchange: (e) => saveChatSetting("modelId", e.target.value) })]),
				$el("div", {}, [$el("label", { textContent: "角色提示词" }), systemPromptDisplay]),
				$el("div", {}, [ $el("label", { textContent: `温度 (${chatSettings.temperature})` }), $el("input", { type: "range", min: 0, max: 1, step: 0.1, value: chatSettings.temperature, oninput: (e) => { e.target.previousSibling.textContent = `温度 (${e.target.value})`; }, onchange: (e) => saveChatSetting("temperature", parseFloat(e.target.value)) }) ]),
				$el("div", {}, [ $el("label", { textContent: `上下文数 (${chatSettings.contextCount})` }), $el("input", { type: "range", min: 1, max: 20, step: 1, value: chatSettings.contextCount, oninput: (e) => { e.target.previousSibling.textContent = `上下文数 (${e.target.value})`; }, onchange: (e) => saveChatSetting("contextCount", parseInt(e.target.value)) }) ]),
				helpContainer,
                resetButton,
			]);
			const header = $el("div.zml-chat-header", {}, [
				$el("h3", { textContent: "妹妹助手" }),
				$el("div.zml-chat-controls", {}, [
					$el("span.zml-chat-icon", { textContent: "⚙️", title: "设置", onclick: () => settingsPanel.classList.toggle("show") }),
					$el("span.zml-chat-icon", { textContent: "🗑️", title: "清空记录", onclick: clearAllMessages }),
					$el("span.zml-chat-icon", { textContent: "❌", title: "关闭", onclick: () => chatWindow.style.display = 'none' }),
				])
			]);
			chatWindow = $el("div.zml-chat-window", {}, [ header, settingsPanel, messagesContainer, $el("div.zml-chat-input-area", {}, [chatInput, sendButton]) ]);
			function addMessageToDisplay(text, role, isError = false) {
				const msg = { id: `msg-${Date.now()}-${chatDisplayHistory.length}`, role, text, isError };
				chatDisplayHistory.push(msg);
				renderMessages();
				return msg;
			}
			async function handleSend() {
				const userMessageText = chatInput.value.trim();
				if (!userMessageText) return;
				if (!chatSettings.apiKey) { addMessageToDisplay("错误: 请先在设置中输入API密钥。", "bot", true); return; }
				chatInput.value = "";
				addMessageToDisplay(userMessageText, "user");
				chatHistory.push({ role: "user", parts: [{ text: userMessageText }] });
				saveChatHistory();
				const typingIndicator = addMessageToDisplay("思考中...", "bot");
				try {
					const context = chatHistory.slice(0, -1).slice(-chatSettings.contextCount * 2);
					const response = await fetch("/zml/chat", {
						method: "POST", headers: { "Content-Type": "application-json" },
						body: JSON.stringify({ messages: [...context, chatHistory[chatHistory.length - 1]], ...chatSettings })
					});
					deleteMessage(typingIndicator.id);
					if (!response.ok) { throw new Error(`服务器错误 (${response.status}): ${await response.text()}`); }
					const data = await response.json();
					addMessageToDisplay(data.reply, "bot");
					chatHistory.push({ role: "model", parts: [{ text: data.reply }] });
					saveChatHistory();
				} catch (error) {
					console.error("ZML Chat Error:", error);
					deleteMessage(typingIndicator.id);
					addMessageToDisplay(`出错了: ${error.message}`, "bot", true);
				}
			}
			sendButton.onclick = handleSend;
			chatInput.onkeydown = (e) => { if (e.key === 'Enter') handleSend(); };
            setupDraggable(chatWindow, header);
			document.body.appendChild(chatWindow);
			renderMessages();
		}

        // ================= 计时器功能区=================
        let timerWindow = null;
        let timerInterval = null;
        let remainingTime = 0;
        let isPaused = false;
        const timerSettings = {
            totalSeconds: 0,
            message: "hiyohiyo~倒计时结束啦！",
            playSound: true,
        };
        function formatTime(seconds) {
            const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
            const s = String(seconds % 60).padStart(2, '0');
            return `${h}:${m}:${s}`;
        }
        function showTimerNotification(message) {
            const oldNotification = document.querySelector('.zml-timer-notification');
            if(oldNotification) oldNotification.remove();
            const closeBtn = $el("span.zml-timer-notification-close", { textContent: "✖", onclick: (e) => e.target.parentElement.remove() });
            const notification = $el("div.zml-timer-notification", { textContent: message }, [ closeBtn ]);
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 10000);
        }
        function updateTimerDisplay() {
            if(timerWindow) {
                const display = timerWindow.querySelector('.zml-timer-display');
                if (display) display.textContent = formatTime(remainingTime);
            }
        }
        function stopTimer(isReset = false) {
            if(timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            if(isReset) {
                remainingTime = timerSettings.totalSeconds;
                isPaused = false;
                updateTimerDisplay();
            }
        }
        function startTimer() {
            if (timerInterval) return;
            isPaused = false;
            timerInterval = setInterval(() => {
                if (remainingTime > 0) {
                    remainingTime--;
                    updateTimerDisplay();
                } else {
                    stopTimer();
                    if(timerSettings.playSound) timerAudio.play().catch(e => console.error("计时器音频播放失败", e));
                    showTimerNotification(timerSettings.message);
                }
            }, 1000);
        }
        function pauseTimer() {
            if(!timerInterval) return;
            isPaused = true;
            clearInterval(timerInterval);
            timerInterval = null;
        }
        function openTimerWindow() {
            if (timerWindow) {
                timerWindow.style.display = 'flex';
                return;
            }
            const timeDisplay = $el("div.zml-timer-display", { textContent: formatTime(remainingTime) });
            const hoursInput = $el("input", { type: "number", min: 0, max: 2, value: 0 });
            const minutesInput = $el("input", { type: "number", min: 0, max: 59, value: 0 });
            const secondsInput = $el("input", { type: "number", min: 0, max: 59, value: 0 });
            const messageInput = $el("input", { type: "text", value: timerSettings.message });
            const audioCheckbox = $el("input", { type: "checkbox", checked: timerSettings.playSound });
            const startButton = $el("button.zml-timer-btn-start", { textContent: "开始", onclick: () => {
                if(isPaused) {
                    startTimer();
                } else {
                    const h = parseInt(hoursInput.value) || 0;
                    const m = parseInt(minutesInput.value) || 0;
                    const s = parseInt(secondsInput.value) || 0;
                    const total = h * 3600 + m * 60 + s;
                    if (total > 10 * 3600) {
                        alert("倒计时不能超过10小时！");
                        return;
                    }
                    timerSettings.totalSeconds = total;
                    timerSettings.message = messageInput.value || "hiyohiyo~倒计时结束啦！";
                    timerSettings.playSound = audioCheckbox.checked;
                    remainingTime = total;
                    updateTimerDisplay();
                    startTimer();
                }
            }});
            const pauseButton = $el("button.zml-timer-btn-pause", { textContent: "暂停", onclick: pauseTimer });
            const resetButton = $el("button.zml-timer-btn-reset", { textContent: "重置", onclick: () => stopTimer(true) });
            timerWindow = $el("div.zml-timer-window", {}, [
                $el("div.zml-timer-header", {}, [
                    $el("h3", { textContent: "倒计时" }),
                    $el("span.zml-timer-close-btn", { textContent: "✖", onclick: () => timerWindow.style.display = 'none' })
                ]),
                timeDisplay,
                $el("div.zml-timer-controls", {}, [startButton, pauseButton, resetButton]),
                $el("div.zml-timer-settings", {}, [
                    $el("div.zml-timer-settings-grid", {}, [
                        $el("div", {}, [$el("label", {textContent: "小时"}), hoursInput]),
                        $el("div", {}, [$el("label", {textContent: "分钟"}), minutesInput]),
                        $el("div", {}, [$el("label", {textContent: "秒"}), secondsInput]),
                    ]),
                    $el("label", { textContent: "结束提示消息" }),
                    messageInput,
                    $el("label.audio-toggle", {}, [
                        audioCheckbox,
                        $el("span", { textContent: "播放提示音" })
                    ])
                ])
            ]);
            const header = timerWindow.querySelector('.zml-timer-header');
            setupDraggable(timerWindow, header);
            document.body.appendChild(timerWindow);
        }

		// ================= 喂养游戏功能区 =================
        const foodData = [
            { name: "棒棒糖", fileName: "棒棒糖.png" }, { name: "爆米花", fileName: "爆米花.png" },
            { name: "冰淇淋", fileName: "冰淇淋.png" }, { name: "蛋糕", fileName: "蛋糕.png" },
            { name: "蜂蜜", fileName: "蜂蜜.png" }, { name: "拐杖糖", fileName: "拐杖糖.png" },
            { name: "汉堡", fileName: "汉堡.png" }, { name: "鸡腿", fileName: "鸡腿.png" },
            { name: "鸡尾酒", fileName: "鸡尾酒.png" }, { name: "煎蛋", fileName: "煎蛋.png" },
            { name: "咖啡", fileName: "咖啡.png" }, { name: "可乐", fileName: "可乐.png" },
            { name: "奶茶", fileName: "奶茶.png" }, { name: "啤酒", fileName: "啤酒.png" },
            { name: "薯条", fileName: "薯条.png" }, { name: "糖葫芦", fileName: "糖葫芦.png" }
        ];
        const feedingSubtitles = [ "谢谢哥哥~", "好好吃~", "喜欢你！", "喜欢哥哥！", "好吃~好吃~" ];

        let feedingWindow = null;
        let inventoryItems = []; 

        function showFeedingSubtitle() {
            const gifContainer = feedingWindow.querySelector('.zml-eat-gif-container');
            if (!gifContainer) return;

            const randomIndex = Math.floor(Math.random() * feedingSubtitles.length);
            const subtitleText = feedingSubtitles[randomIndex];

            const subtitleEl = $el("div.zml-feeding-subtitle", { textContent: subtitleText });
            gifContainer.appendChild(subtitleEl);

            setTimeout(() => subtitleEl.remove(), 1500); 
        }

        function showHeartEffect() {
            const gifContainer = feedingWindow.querySelector('.zml-eat-gif-container');
            if (!gifContainer) return;

            const heartCount = 5 + Math.floor(Math.random() * 3); 

            for (let i = 0; i < heartCount; i++) {
                const heart = $el("img.zml-heart-effect", { src: heartImagePath + "?t=" + new Date().getTime() });
                
                const size = 20 + Math.random() * 40; 
                const startXOffset = -50 + (Math.random() * 60 - 30); 
                const endYOffset = -100 - (Math.random() * 50); 
                const duration = 0.7 + Math.random() * 0.5; 
                const delay = Math.random() * 0.4; 

                heart.style.width = `${size}px`;
                heart.style.height = `${size}px`;
                heart.style.setProperty('--start-x', `${startXOffset}%`);
                heart.style.setProperty('--end-y', `${endYOffset}%`);
                heart.style.setProperty('--duration', `${duration}s`);
                heart.style.setProperty('--delay', `${delay}s`);

                gifContainer.appendChild(heart);
                setTimeout(() => heart.remove(), (duration + delay) * 1000);
            }
        }

        function renderInventory() {
            const inventoryBar = feedingWindow.querySelector('.zml-inventory-bar');
            inventoryBar.innerHTML = ''; 
            
            inventoryItems.forEach((food, index) => {
                const itemEl = $el("div.zml-inventory-item", {
                    draggable: true,
                    dataset: { inventoryIndex: index } 
                }, [
                    $el("img", { src: eatSubfolderPath + food.fileName + "?t=" + new Date().getTime() })
                ]);

                itemEl.addEventListener("dragstart", (e) => {
                    e.dataTransfer.setData("text/plain", e.target.dataset.inventoryIndex);
                    setTimeout(() => e.target.style.opacity = '0.5', 0);
                });

                itemEl.addEventListener("dragend", (e) => {
                    e.target.style.opacity = '1';
                });

                inventoryBar.appendChild(itemEl);
            });
        }

        function saveInventory() {
            localStorage.setItem("zml.feeding.inventory", JSON.stringify(inventoryItems));
        }

        function addToInventory(foodItem) {
            if (inventoryItems.length >= 5) {
                alert("物品栏满了！(最多5个)");
                return;
            }
            inventoryItems.push(foodItem);
            renderInventory();
            saveInventory(); 
        }

        function openFeedingWindow() {
            if (feedingWindow) {
                feedingWindow.style.display = 'flex';
                let storedItems = [];
                try {
                    const storedString = localStorage.getItem("zml.feeding.inventory");
                    if (storedString) {
                        storedItems = JSON.parse(storedString);
                    }
                } catch (e) {
                    console.error("Failed to parse inventory from localStorage", e);
                    localStorage.removeItem("zml.feeding.inventory"); 
                }
                inventoryItems = [...storedItems];
                renderInventory();
                return;
            }
            
            let storedItems = [];
            try {
                const storedString = localStorage.getItem("zml.feeding.inventory");
                if (storedString) {
                    storedItems = JSON.parse(storedString);
                }
            } catch (e) {
                console.error("Failed to parse inventory from localStorage", e);
                localStorage.removeItem("zml.feeding.inventory"); 
            }
            inventoryItems = [...storedItems]; 

            const shopPanel = $el("div.zml-food-shop");
            const shopGrid = $el("div.zml-shop-grid");

            foodData.forEach(food => {
                const addItemBtn = $el("div.zml-shop-item-add-btn", { textContent: "+" });
                addItemBtn.onclick = () => {
                    addItemBtn.classList.add('clicked');
                    setTimeout(() => addItemBtn.classList.remove('clicked'), 200);
                    addToInventory(food);
                };

                const shopItem = $el("div.zml-shop-item", {}, [
                    $el("img", { src: eatSubfolderPath + food.fileName + "?t=" + new Date().getTime() }),
                    $el("p", { textContent: food.name }),
                    addItemBtn
                ]);
                shopGrid.appendChild(shopItem);
            });
            shopPanel.append($el("h4", {textContent: "零食商店"}), shopGrid);

            const gifContainer = $el("div.zml-eat-gif-container", {}, [
                $el("img", { src: eatGifPath + "?t=" + new Date().getTime() }) 
            ]);

            gifContainer.addEventListener("dragover", (e) => e.preventDefault());
            gifContainer.addEventListener("drop", (e) => {
                e.preventDefault();
                const inventoryIndexStr = e.dataTransfer.getData("text/plain");
                if (inventoryIndexStr === null || inventoryIndexStr === "") return;

                const inventoryIndex = parseInt(inventoryIndexStr, 10);
                if (!isNaN(inventoryIndex) && inventoryIndex >= 0 && inventoryIndex < inventoryItems.length) { 
                    inventoryItems.splice(inventoryIndex, 1); 
                    renderInventory(); 
                    saveInventory(); 
                    showHeartEffect(); 
                    showFeedingSubtitle(); 

                    const randomSound = eatSounds[Math.floor(Math.random() * eatSounds.length)];
                    randomSound.currentTime = 0;
                    randomSound.play().catch(err => console.error("投喂音效播放失败", err));
                }
            });

            const header = $el("div.zml-feeding-header", {}, [
                $el("h3", { textContent: "来喂点好吃的！" }),
                $el("span.zml-feeding-close-btn", { textContent: "✖", onclick: () => feedingWindow.style.display = 'none' }),
            ]);

            feedingWindow = $el("div.zml-feeding-window", {}, [
                header,
                $el("div.zml-feeding-main", {}, [
                    $el("button.zml-shop-button", { 
                        textContent: "商店",
                        onclick: () => shopPanel.classList.toggle('show')
                    }),
                    gifContainer,
                    shopPanel,
                    $el("div.zml-inventory-bar")
                ])
            ]);
            
            setupDraggable(feedingWindow, header);
            document.body.appendChild(feedingWindow);
            renderInventory(); 
        }

		// --- 悬浮球事件 ---
		floatingBall.addEventListener("contextmenu", (e) => { e.preventDefault(); createContextMenu(e); });
		floatingBall.addEventListener("dblclick", () => {
			if (dblClickAudioSetting.value) { audio.currentTime = 0; audio.play().catch(err => console.error("音频播放失败:", err)); }
			if (dblClickAnimationSetting.value) {
				if (animationTimeout) clearTimeout(animationTimeout);
				floatingBall.classList.remove("breathing-effect");

				const effect = animationEffectSetting.value;
				const displayDurationMs = animationDurationSetting.value * 1000; 

				const animationClasses = ["fade", "pop", "slide", "shake", "pulse"].map(c => `zml-animation-${c}`);
				floatingBall.classList.remove(...animationClasses); 

				const revertToIdleState = () => {
					const isCurrentlyIdle = app.ui.lastQueueSize === 0;
					floatingImage.src = isCurrentlyIdle ? idleImagePath : runningGifPath;
					floatingBall.classList.remove(...animationClasses); 
					if (isCurrentlyIdle && hoverEffectSetting.value) floatingBall.classList.add("breathing-effect");
                    animationTimeout = null; 
				};

				if (effect === 'none') {
                    floatingImage.src = animationImagePath;
                    animationTimeout = setTimeout(revertToIdleState, displayDurationMs);
				} else {
					const animationClass = `zml-animation-${effect}`;
                    floatingImage.src = animationImagePath; 
                    
                    void floatingBall.offsetWidth; 
					floatingBall.classList.add(animationClass); 

                    const onAnimationEffectEnd = (event) => {
                        if (event.target === floatingBall && event.animationName.startsWith('zml-')) {
                            floatingBall.removeEventListener('animationend', onAnimationEffectEnd);
                            floatingBall.classList.remove(animationClass); 
                        }
                    };
                    floatingBall.addEventListener('animationend', onAnimationEffectEnd, { once: true });
                    
					animationTimeout = setTimeout(revertToIdleState, displayDurationMs);
				}
			}
		});
		if (!visibilitySetting.value) floatingBall.classList.add("hidden"); applySize(true);
		floatingBall.addEventListener("mouseover", () => { if (hoverEffectSetting.value && floatingImage.src.includes("ZML.png")) floatingBall.classList.add("breathing-effect"); });
		floatingBall.addEventListener("mouseout", () => { floatingBall.classList.remove("breathing-effect"); });
		visibilitySetting.onChange = (value) => floatingBall.classList.toggle("hidden", !value);
		idleSizeSetting.onChange = () => applySize(floatingImage.src.includes("ZML.png"));
		runningSizeSetting.onChange = () => applySize(floatingImage.src.includes("ZML.gif"));
		api.addEventListener("execution_start", () => {
			if (animationTimeout) { clearTimeout(animationTimeout); animationTimeout = null; }
			floatingBall.classList.remove("breathing-effect");
			if (runtimeAudioSetting.value === "start") { audio.currentTime = 0; audio.play().catch(err => console.error("运行时音频播放失败:", err)); }
			const delay = gifDelaySetting.value * 1000;
			if (gifDisplayTimeout) clearTimeout(gifDisplayTimeout);
			const showRunningState = () => { floatingImage.src = runningGifPath; applySize(false); };
			if (delay === 0) showRunningState();
			else gifDisplayTimeout = setTimeout(() => { if (app.ui.lastQueueSize > 0) showRunningState(); gifDisplayTimeout = null; }, delay);
		});
		api.addEventListener("status", ({ detail }) => {
			if (gifDisplayTimeout && detail?.exec_info.queue_remaining === 0) { clearTimeout(gifDisplayTimeout); gifDisplayTimeout = null; }
			if (detail?.exec_info.queue_remaining === 0) {
				setTimeout(() => {
					if (app.ui.lastQueueSize === 0) {
						if (!animationTimeout) floatingImage.src = idleImagePath;
						applySize(true);
						if (runtimeAudioSetting.value === "end") { audio.currentTime = 0; audio.play().catch(err => console.error("运行时音频播放失败:", err)); }
					}
				}, 200);
			}
		});
		floatingBall.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			document.body.style.userSelect = 'none';
			let shiftX = e.clientX - floatingBall.getBoundingClientRect().left; let shiftY = e.clientY - floatingBall.getBoundingClientRect().top;
			floatingBall.style.transition = 'none';
			const moveAt = (pageX, pageY) => { floatingBall.style.left = `${pageX - shiftX}px`; floatingBall.style.top = `${pageY - shiftY}px`; floatingBall.style.bottom = 'auto'; floatingBall.style.right = 'auto'; };
			const onMouseMove = (event) => moveAt(event.pageX, event.pageY);
			const onMouseUp = () => {
				document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
				document.body.style.userSelect = '';
				floatingBall.style.transition = 'transform 0.2s ease-out, max-width 0.3s ease-out, max-height 0.3s ease-out, filter 0.3s ease-out';
				savePosition();
			};
			document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
		});
		floatingBall.ondragstart = () => false;
	}
});