import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el } from "/scripts/ui.js";

app.registerExtension({
	name: "ZML.FunFloatingBall.V20_Final",
	async setup(app) {
		// --- 设置项 ---
		const visibilitySetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.show",
			name: "悬浮球 - 显示/隐藏",
			type: "boolean",
			defaultValue: true,
		});

		const idleSizeSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.idleSize",
			name: "悬浮球 - 空闲尺寸 (px)",
			type: "slider",
			attrs: { min: 20, max: 300, step: 1 },
			defaultValue: 100,
		});

		const runningSizeSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.runningSize",
			name: "悬浮球 - 运行尺寸 (px)",
			type: "slider",
			attrs: { min: 20, max: 500, step: 1 },
			defaultValue: 200,
		});
        
        const dblClickAudioSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.dblClickAudio",
			name: "悬浮球 - 启用双击音频",
			type: "boolean",
			defaultValue: true,
		});

        const runtimeAudioSetting = app.ui.settings.addSetting({
            id: "zml.floatingBall.runtimeAudioMode",
            name: "悬浮球 - 运行时音频",
            type: "combo",
            options(value) {
                const options = {"disable":"禁用","start":"运行开始时播放","end":"运行结束时播放"};
                const internalValues = Object.keys(options);
                return internalValues.map((internalVal) => ({
                    value: internalVal,
                    text: options[internalVal],
                    selected: internalVal === value,
                }));
            },
            defaultValue: "disable",
        });

		const dblClickAnimationSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.dblClickAnimation",
			name: "悬浮球 - 启用双击动画",
			type: "boolean",
			defaultValue: true,
		});

		const animationDurationSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.animationDuration",
			name: "悬浮球 - 动画显示时间 (秒)",
			type: "slider",
			attrs: { min: 0.1, max: 10, step: 0.1 },
			defaultValue: 2,
		});

        const animationEffectSetting = app.ui.settings.addSetting({
            id: "zml.floatingBall.animationEffect",
            name: "悬浮球 - 双击动画效果",
            type: "combo",
            options(value) {
                const options = { "none": "无", "fade": "淡入淡出", "pop": "弹出", "slide": "上滑", "shake": "抖动", "pulse": "脉冲" };
                return Object.keys(options).map(internalVal => ({
                    value: internalVal,
                    text: options[internalVal],
                    selected: internalVal === value,
                }));
            },
            defaultValue: "fade",
        });

		const hoverEffectSetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.hoverEffect",
			name: "悬浮球 - 启用悬停呼吸效果",
			type: "boolean",
			defaultValue: true,
		});

		const gifDelaySetting = app.ui.settings.addSetting({
			id: "zml.floatingBall.gifDelay",
			name: "悬浮球 - GIF延迟显示 (秒)",
			type: "slider",
			attrs: { min: 0, max: 3, step: 0.1 },
			defaultValue: 0.5,
		});

		// --- 资源路径 ---
		const idleImagePath = "/extensions/ComfyUI-ZML-Image/images/ZML.png";
		const runningGifPath = "/extensions/ComfyUI-ZML-Image/images/ZML.gif";
        const audioPath = "/extensions/ComfyUI-ZML-Image/images/ZML.wav";
		const animationImagePath = "/extensions/ComfyUI-ZML-Image/images/ZML2.png";

		const audio = new Audio(audioPath);
		let animationTimeout = null;
		let gifDisplayTimeout = null;

		const floatingImage = $el("img", {
			src: idleImagePath,
			style: {
				width: "100%", height: "100%", borderRadius: "12px",
				display: "block", border: "none", outline: "none",
				pointerEvents: "none",
			}
		});
		
		const floatingBall = $el("div.zml-floating-ball", {
			style: {
				position: "fixed", bottom: "20px", left: "20px",
				width: "auto", height: "auto",
				borderRadius: "12px", backgroundColor: "transparent",
				border: "none", cursor: "pointer", zIndex: 9998,
				transition: "transform 0.2s ease-out, max-width 0.3s ease-out, max-height 0.3s ease-out, filter 0.3s ease-out",
				filter: "drop-shadow(0px 2px 5px rgba(0,0,0,0.5))"
			}
		}, [floatingImage]);
        
		$el("style", { 
			textContent: `
				.zml-floating-ball.hidden { display: none; }
				.zml-floating-ball.breathing-effect {
					animation: zml-breathing 2.5s ease-in-out infinite;
				}
				@keyframes zml-breathing {
					0% { transform: scale(1); }
					50% { transform: scale(1.1); }
					100% { transform: scale(1); }
				}
				.zml-animation-fade { animation: zml-fade-in 0.4s ease-out; }
				.zml-animation-pop { animation: zml-pop-in 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55); }
                .zml-animation-slide { animation: zml-slide-up 0.5s ease-out; }
                .zml-animation-shake { animation: zml-shake 0.5s ease-in-out; }
                .zml-animation-pulse { animation: zml-pulse 0.7s ease-in-out; }
				@keyframes zml-fade-in { from { opacity: 0; } to { opacity: 1; } }
				@keyframes zml-pop-in { 0% { transform: scale(0.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
                @keyframes zml-slide-up { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes zml-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); } 20%, 40%, 60%, 80% { transform: translateX(5px); } }
                @keyframes zml-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
			`, 
			parent: document.body 
		});
		document.body.appendChild(floatingBall);

		const applySize = (isIdle) => {
			const size = isIdle ? idleSizeSetting.value : runningSizeSetting.value;
			const s = `${size}px`;
			floatingBall.style.maxWidth = s;
			floatingBall.style.maxHeight = s;
			floatingImage.style.maxWidth = s;
			floatingImage.style.maxHeight = s;
		};
		
		const createContextMenu = (e) => {
			const oldMenu = document.querySelector('.zml-ball-context-menu');
			if (oldMenu) oldMenu.remove();
			const menu = $el("div.zml-ball-context-menu", { style: { position: 'absolute', left: `${e.clientX}px`, top: `${e.clientY}px`, backgroundColor: '#333', border: '1px solid #555', borderRadius: '5px', padding: '5px', zIndex: '10000', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' } });
            const audioButton = $el("button", { textContent: dblClickAudioSetting.value ? "禁用双击音频" : "启用双击音频", style: { background: 'none', border: 'none', color: '#eee', padding: '8px 12px', cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left' } });
            audioButton.onmouseover = () => audioButton.style.backgroundColor = '#555';
			audioButton.onmouseout = () => audioButton.style.backgroundColor = 'transparent';
            audioButton.onclick = () => { dblClickAudioSetting.value = !dblClickAudioSetting.value; menu.remove(); };
			const hideButton = $el("button", { textContent: "隐藏悬浮球", style: { background: 'none', border: 'none', color: '#eee', padding: '8px 12px', cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left' } });
            hideButton.onmouseover = () => hideButton.style.backgroundColor = '#555';
			hideButton.onmouseout = () => hideButton.style.backgroundColor = 'transparent';
			hideButton.onclick = () => { floatingBall.classList.add("hidden"); visibilitySetting.value = false; menu.remove(); };
			menu.appendChild(audioButton);
			menu.appendChild(hideButton);
			document.body.appendChild(menu);
			setTimeout(() => {
				document.addEventListener("click", () => menu.remove(), { once: true });
                document.addEventListener("contextmenu", () => menu.remove(), { once: true });
			}, 0);
		};

		floatingBall.addEventListener("contextmenu", (e) => { e.preventDefault(); createContextMenu(e); });

        floatingBall.addEventListener("dblclick", () => {
            if (dblClickAudioSetting.value) { audio.currentTime = 0; audio.play().catch(err => console.error("音频播放失败:", err)); }
			if (dblClickAnimationSetting.value) {
				if (animationTimeout) clearTimeout(animationTimeout);
				floatingBall.classList.remove("breathing-effect");
				const effect = animationEffectSetting.value;
				const duration = animationDurationSetting.value * 1000;
				const revertImage = () => {
					const isCurrentlyIdle = app.ui.lastQueueSize === 0;
					floatingImage.src = isCurrentlyIdle ? idleImagePath : runningGifPath;
					animationTimeout = null;
					if (isCurrentlyIdle && hoverEffectSetting.value) {
						floatingBall.classList.add("breathing-effect");
					}
				};

				if (effect === 'none') {
					floatingImage.src = animationImagePath;
					animationTimeout = setTimeout(revertImage, duration);
				} else {
					const animationClass = `zml-animation-${effect}`;
					floatingBall.classList.remove("zml-animation-fade", "zml-animation-pop", "zml-animation-slide", "zml-animation-shake", "zml-animation-pulse");
					void floatingBall.offsetWidth;
					floatingImage.src = animationImagePath;
					floatingBall.classList.add(animationClass);
					floatingBall.addEventListener('animationend', () => floatingBall.classList.remove(animationClass), { once: true });
					animationTimeout = setTimeout(revertImage, duration);
				}
			}
        });

        if (!visibilitySetting.value) floatingBall.classList.add("hidden");
		applySize(true);
        
		floatingBall.addEventListener("mouseover", () => {
            if (hoverEffectSetting.value && floatingImage.src.includes("ZML.png")) {
                floatingBall.classList.add("breathing-effect");
            }
        });

        floatingBall.addEventListener("mouseout", () => {
            floatingBall.classList.remove("breathing-effect");
        });

        visibilitySetting.onChange = (value) => floatingBall.classList.toggle("hidden", !value);
		idleSizeSetting.onChange = () => applySize(floatingImage.src.includes("ZML.png"));
		runningSizeSetting.onChange = () => applySize(floatingImage.src.includes("ZML.gif"));

		api.addEventListener("execution_start", () => {
			if(animationTimeout) { clearTimeout(animationTimeout); animationTimeout = null; }
			floatingBall.classList.remove("breathing-effect");
			
            if (runtimeAudioSetting.value === "start") { audio.currentTime = 0; audio.play().catch(err => console.error("运行时音频播放失败:", err)); }

			const delay = gifDelaySetting.value * 1000;
			if (gifDisplayTimeout) clearTimeout(gifDisplayTimeout);

			const showRunningState = () => {
				floatingImage.src = runningGifPath;
				applySize(false);
			};

			if (delay === 0) {
				showRunningState();
			} else {
				gifDisplayTimeout = setTimeout(() => {
					if (app.ui.lastQueueSize > 0) {
						showRunningState();
					}
					gifDisplayTimeout = null;
				}, delay);
			}
		});

		api.addEventListener("status", ({ detail }) => {
			if (gifDisplayTimeout && detail?.exec_info.queue_remaining === 0) {
				clearTimeout(gifDisplayTimeout);
				gifDisplayTimeout = null;
			}

			if (detail?.exec_info.queue_remaining === 0) {
				setTimeout(() => {
					if (app.ui.lastQueueSize === 0) {
						if(!animationTimeout) { 
							floatingImage.src = idleImagePath; 
						}
						applySize(true);
                        if (runtimeAudioSetting.value === "end") { audio.currentTime = 0; audio.play().catch(err => console.error("运行时音频播放失败:", err)); }
					}
				}, 200);
			}
		});

		floatingBall.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			document.body.style.userSelect = 'none';
			let shiftX = e.clientX - floatingBall.getBoundingClientRect().left;
			let shiftY = e.clientY - floatingBall.getBoundingClientRect().top;
			floatingBall.style.transition = 'none';
			function moveAt(pageX, pageY) {
				floatingBall.style.left = `${pageX - shiftX}px`;
				floatingBall.style.top = `${pageY - shiftY}px`;
				floatingBall.style.bottom = 'auto';
				floatingBall.style.right = 'auto';
			}
			function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
            function onMouseUp() {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
				document.body.style.userSelect = '';
                floatingBall.style.transition = 'transform 0.2s ease-out, max-width 0.3s ease-out, max-height 0.3s ease-out, filter 0.3s ease-out';
            }
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
		floatingBall.ondragstart = () => false;
	}
});