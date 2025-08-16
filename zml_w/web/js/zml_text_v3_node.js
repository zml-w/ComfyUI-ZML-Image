import { app } from "../../../scripts/app.js";

function createEl(tag, className = "", text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

app.registerExtension({
    name: "ZML.SelectTextV3.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeType.comfyClass === "ZML_SelectTextV3") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;

                try {
                    if (this.selectTextV3_initialized) return r;
                    this.selectTextV3_initialized = true;
                    
                    if (!document.getElementById("zml-select-text-v3-styles")) {
                        const style = document.createElement("style");
                        style.id = "zml-select-text-v3-styles";
                        style.innerHTML = `
                            .zml-entry-card.zml-dragging {
                                opacity: 0.5;
                                background: #555;
                            }
                            .zml-entry-card.zml-drag-over {
                                border-top: 2px solid #5d99f2 !important; 
                            }
                            .zml-drag-handle.locked {
                                cursor: not-allowed !important;
                                color: #666 !important;
                            }
                            /* 统一所有调节器（输入框、按钮）的高度 */
                            .zml-control-btn, .zml-control-input {
                                height: 26px; /* 固定高度 */
                                padding: 0;
                                border: 1px solid #555;
                                border-radius: 2px;
                                background: #333;
                                color: #ccc;
                                cursor: pointer;
                                font-size: 14px;
                                line-height: 1;
                                box-sizing: border-box; /* 包含padding和border在内 */
                            }
                            .zml-control-input {
                                padding: 4px 8px; /* 内部填充 */
                                font-size: 12px;
                                background: #333;
                            }
                            /* 【 ZML 新增 】 统一标签样式 */
                            .zml-control-label {
                                font-size: 12px; 
                                color: #ccc; 
                                flex-shrink: 0; /* 防止挤压 */
                            }
                            /* 【 ZML 新增 】 组合控件的容器 */
                            .zml-control-group {
                                display: flex;
                                align-items: center;
                                gap: 4px; /* 标签和输入框之间的小间隔 */
                            }
                        `;
                        document.head.appendChild(style);
                    }


                    this.styles = {
                        normal: {
                            cardPadding: "6px",
                            inputPadding: "4px 8px",
                            inputHeight: "26px",
                            checkboxScale: "1.5",
                            newButtonPadding: "8px 16px",
                        },
                        compact: {
                            cardPadding: "2px 4px",
                            inputPadding: "2px 6px",
                            inputHeight: "22px",
                            checkboxScale: "1.2",
                            newButtonPadding: "4px 16px",
                        }
                    };

                    this.compactView = this.compactView ?? false;
                    this.isLocked = this.isLocked ?? false; 
                    this.titleWidth = this.titleWidth ?? 80;

                    if (!this.selectTextV3_data) {
                        this.selectTextV3_data = {
                            entries: [
                                { id: "entry1", title: "", content: "", enabled: true },
                                { id: "entry2", title: "", content: "", enabled: true },
                            ]
                        };
                    }
                    
                    this.language = "zh";
                    this.texts = { 
                        zh: { 
                            title: "选择文本V3", 
                            separator: "分隔符", 
                            newTextBox: "新建文本框", 
                            inputName: "输入名称...", 
                            inputContent: "输入内容...", 
                            lockDrag: "锁定/解锁文本框排序",
                            titleWidth: "名称宽度" 
                        } 
                    };
                    this.getText = (key) => this.texts[this.language][key] || key;

                    const dataWidget = this.addWidget("text", "selectTextV3_data", JSON.stringify(this.selectTextV3_data), (v) => { try { if(v) this.selectTextV3_data = JSON.parse(v); } catch(e){} }, { serialize: true });
                    dataWidget.hidden = true;
                    dataWidget.computeSize = () => [0, 0];

                    const container = createEl("div");
                    container.style.cssText = `position: absolute; top: -38px; left: 0; right: 5px; height: calc(100% + 38px); padding: 40px 6px 6px 6px; background: #2b2b2b; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; display: flex; flex-direction: column; z-index: 1;`;

                    const header = createEl("div");
                    header.style.cssText = `display: flex; align-items: center; margin-top: -32px; margin-bottom: 8px; padding-bottom: 0px; border-bottom: 1px solid #444;`;
                   
                    const separatorContainer = createEl("div");
                    // 【 ZML 修改 】 调整整个控制组的间距
                    separatorContainer.style.cssText = `margin-bottom: 10px; display: flex; align-items: center; gap: 8px;`; // 组间距

                    // --- 分隔符控件组 ---
                    const separatorGroup = createEl("div", "zml-control-group");
                    const separatorLabel = createEl("span", "zml-control-label", this.getText("separator")); // 【 ZML 修改 】 添加类名
                    // 【 ZML 修改 】 移除 min-width
                    separatorLabel.style.cssText += `margin-left: 2px;`; 
                    const separatorInput = createEl("input", "zml-control-input");
                    separatorInput.type = "text";
                    separatorInput.value = this.widgets.find(w => w.name === "separator")?.value || ",";
                    // 【 ZML 修改 】 文本左对齐，固定宽度
                    separatorInput.style.cssText += `width: 40px; text-align: left; flex-shrink: 0;`; 
                    separatorInput.oninput = (e) => { this.widgets.find(w => w.name === "separator").value = e.target.value; this.triggerSlotChanged(); };
                    separatorGroup.appendChild(separatorLabel);
                    separatorGroup.appendChild(separatorInput);

                    // --- 名称宽度控件组 ---
                    const titleWidthGroup = createEl("div", "zml-control-group"); // 【 ZML 新增 】
                    const titleWidthLabel = createEl("span", "zml-control-label", this.getText("titleWidth")); // 【 ZML 新增 】
                    // 【 ZML 修改 】 宽度输入框，文本左对齐
                    const titleWidthInput = createEl("input", "zml-control-input"); 
                    titleWidthInput.type = "number";
                    titleWidthInput.min = "20"; 
                    titleWidthInput.max = "300"; 
                    titleWidthInput.value = this.titleWidth;
                    titleWidthInput.placeholder = this.getText("titleWidth");
                    titleWidthInput.title = this.getText("titleWidth");
                    // 【 ZML 修改 】 文本左对齐，固定宽度
                    titleWidthInput.style.cssText += `width: 60px; text-align: left; flex-shrink: 0;`; 
                    titleWidthInput.oninput = (e) => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val)) val = 80; 
                        val = Math.max(20, Math.min(300, val)); 
                        this.titleWidth = val;
                        e.target.value = val; 
                        this.renderSelectTextV3Entries(); 
                        this.triggerSlotChanged();
                    };
                    titleWidthGroup.appendChild(titleWidthLabel); // 【 ZML 新增 】
                    titleWidthGroup.appendChild(titleWidthInput); // 【 ZML 新增 】

                    // --- 锁定按钮 ---
                    const lockToggleButton = createEl("button", "zml-control-btn", this.isLocked ? "🔒" : "🔓"); 
                    lockToggleButton.title = this.getText("lockDrag");
                    // 【 ZML 修改 】 背景色动态变化
                    lockToggleButton.style.cssText += `width: 26px; height: 26px; ${this.isLocked ? 'background: #644;' : 'background: #333;'}`; 
                    lockToggleButton.onclick = () => {
                        this.isLocked = !this.isLocked;
                        lockToggleButton.textContent = this.isLocked ? "🔒" : "🔓";
                        lockToggleButton.style.background = this.isLocked ? '#644' : '#333';
                        this.renderSelectTextV3Entries(); 
                        this.triggerSlotChanged();
                    };

                    // --- 尺寸切换按钮 ---
                    const sizeToggleButton = createEl("button", "zml-control-btn", "↕"); 
                    sizeToggleButton.title = "切换紧凑/普通视图";
                    sizeToggleButton.style.cssText += `width: 26px; height: 26px;`; 
                    sizeToggleButton.onclick = () => {
                        this.compactView = !this.compactView;
                        this.applySizeMode();
                        this.triggerSlotChanged();
                    };

                    const entriesList = createEl("div");
                    entriesList.style.cssText = `margin-bottom: 6px; flex: 1; min-height: 50px; overflow-y: auto; border: 1px solid #444; border-radius: 2px; padding: 4px; background: #333;`;

                    const newTextBoxBtn = createEl("button", "", this.getText("newTextBox"));
                    newTextBoxBtn.style.cssText = `background: #444; color: #ccc; border: 1px solid #666; border-radius: 2px; cursor: pointer; font-size: 12px; font-weight: 500; margin-top: auto; width: 100%;`;
                    newTextBoxBtn.onmouseenter = () => newTextBoxBtn.style.background = '#555';
                    newTextBoxBtn.onmouseleave = () => newTextBoxBtn.style.background = '#444';
                    newTextBoxBtn.onclick = () => {
                        const newId = "entry" + Date.now();
                        this.selectTextV3_data.entries.push({ id: newId, title: "", content: "", enabled: true });
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };

                    // 【 ZML 修改 】 按顺序添加控件组
                    separatorContainer.appendChild(separatorGroup);
                    separatorContainer.appendChild(titleWidthGroup);
                    separatorContainer.appendChild(lockToggleButton); 
                    separatorContainer.appendChild(sizeToggleButton);
                    
                    container.appendChild(header);
                    container.appendChild(separatorContainer);
                    container.appendChild(entriesList);
                    container.appendChild(newTextBoxBtn);

                    this.applySizeMode = () => {
                        // 紧凑模式下的样式不再影响这些固定大小的按钮和输入框
                        const s = this.compactView ? this.styles.compact : this.styles.normal;
                        newTextBoxBtn.style.padding = s.newButtonPadding;
                        this.renderSelectTextV3Entries();
                    };

                    this.renderSelectTextV3Entries = () => {
                        const s = this.compactView ? this.styles.compact : this.styles.normal;
                        entriesList.innerHTML = "";
                        this.selectTextV3_data.entries.forEach((entry, index) => {
                            const entryCard = createEl("div", "zml-entry-card");
                            entryCard.dataset.index = index;
                            entryCard.style.cssText = `display: flex; align-items: center; margin-bottom: 3px; background: ${entry.enabled ? '#3a3a3a' : '#2a2a2a'}; border: 1px solid ${entry.enabled ? '#555' : '#444'}; border-radius: 2px; padding: ${s.cardPadding};`;
                            
                            const checkbox = createEl("input");
                            checkbox.type = "checkbox";
                            checkbox.checked = entry.enabled;
                            checkbox.style.cssText = `margin-right: 4px; flex-shrink: 0; transform: scale(${s.checkboxScale});`;
                            checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderSelectTextV3Entries(); this.triggerSlotChanged(); };

                            const dragHandle = createEl("div", "zml-drag-handle", "☰");
                            dragHandle.style.cssText = `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; margin-right: 4px; flex-shrink: 0; user-select: none; font-size: 14px;`;
                            dragHandle.draggable = !this.isLocked; 
                            if (this.isLocked) { 
                                dragHandle.classList.add("locked");
                            } else {
                                dragHandle.classList.remove("locked");
                            }

                            const baseInputStyle = `box-sizing: border-box; background: #2b2b2b; border: 1px solid #444; border-radius: 2px; color: #ccc; font-size: 12px; margin-right: 4px; padding: ${s.inputPadding}; height: ${s.inputHeight};`;
                            
                            const titleInput = createEl("input");
                            titleInput.type = "text";
                            titleInput.value = entry.title;
                            titleInput.placeholder = this.getText("inputName");
                            titleInput.style.cssText = `width: ${this.titleWidth}px; ${baseInputStyle}`;
                            titleInput.oninput = (e) => { entry.title = e.target.value; this.triggerSlotChanged(); };

                            const contentInput = createEl("input");
                            contentInput.type = "text";
                            contentInput.value = entry.content;
                            contentInput.placeholder = this.getText("inputContent");
                            contentInput.style.cssText = `flex: 1; min-width: 50px; ${baseInputStyle}`;
                            contentInput.oninput = (e) => { entry.content = e.target.value; this.triggerSlotChanged(); };

                            const deleteBtn = createEl("button", "", "X");
                            deleteBtn.style.cssText = `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0;`;
                            deleteBtn.onclick = () => { this.selectTextV3_data.entries.splice(index, 1); this.renderSelectTextV3Entries(); this.triggerSlotChanged(); };

                            // 拖放事件仅在未锁定状态下启用
                            if (!this.isLocked) {
                                entryCard.ondragstart = (e) => {
                                    if (e.target !== dragHandle) {
                                        e.preventDefault();
                                        return;
                                    }
                                    e.dataTransfer.setData("text/plain", index);
                                    setTimeout(() => e.currentTarget.classList.add("zml-dragging"), 0);
                                };
                                entryCard.ondragover = (e) => {
                                    e.preventDefault();
                                    const draggingEl = document.querySelector(".zml-dragging");
                                    if (draggingEl && draggingEl !== e.currentTarget) {
                                        e.currentTarget.classList.add("zml-drag-over");
                                    }
                                };
                                entryCard.ondragleave = (e) => {
                                    e.preventDefault();
                                    e.currentTarget.classList.remove("zml-drag-over");
                                };
                                entryCard.ondrop = (e) => {
                                    e.preventDefault();
                                    e.currentTarget.classList.remove("zml-drag-over");
                                    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                                    const toIndex = index;
                                    
                                    if (fromIndex !== toIndex) {
                                        const itemToMove = this.selectTextV3_data.entries.splice(fromIndex, 1)[0];
                                        this.selectTextV3_data.entries.splice(toIndex, 0, itemToMove);
                                        
                                        this.renderSelectTextV3Entries();
                                        this.triggerSlotChanged();
                                    }
                                };
                                entryCard.ondragend = (e) => {
                                    e.currentTarget.classList.remove("zml-dragging");
                                };
                            } else { // 锁定状态下禁用拖放事件
                                entryCard.ondragstart = entryCard.ondragover = entryCard.ondragleave = entryCard.ondrop = entryCard.ondragend = null;
                            }


                            entryCard.appendChild(checkbox);
                            entryCard.appendChild(dragHandle);
                            entryCard.appendChild(titleInput);
                            entryCard.appendChild(contentInput);
                            entryCard.appendChild(deleteBtn);
                            entriesList.appendChild(entryCard);
                        });
                        this.updateOutputPreview();
                    };
                    
                    this.updateOutputPreview = () => {};

                    this.addDOMWidget("selecttextv3_ui", "div", container, { serialize: false });
                    this.size = [Math.max(this.size[0] || 0, 300), Math.max(this.size[1] || 0, 220)];
                    const origOnResize = this.onResize;
                    this.onResize = function(size) { size[0] = Math.max(size[0], 300); size[1] = Math.max(size[1], 150); this.size = size; if (origOnResize) origOnResize.call(this, size); };
                    this.triggerSlotChanged = () => { dataWidget.value = JSON.stringify(this.selectTextV3_data); this.setDirtyCanvas(true, true); };

                    this.applySizeMode();

                } catch (error) { console.error("ZML_SelectTextV3: Error during initialization:", error); }
                return r;
            };

            const origOnSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(obj) {
                origOnSerialize ? origOnSerialize.apply(this, arguments) : undefined;
                if (this.selectTextV3_data) obj.selectTextV3_data = this.selectTextV3_data;
                obj.compactView = this.compactView;
                obj.isLocked = this.isLocked; 
                obj.titleWidth = this.titleWidth;
            };
            
            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(obj) {
                origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
                if (obj.selectTextV3_data) this.selectTextV3_data = obj.selectTextV3_data;
                if (obj.compactView !== undefined) this.compactView = obj.compactView;
                if (obj.isLocked !== undefined) this.isLocked = obj.isLocked;
                if (obj.titleWidth !== undefined) {
                    this.titleWidth = obj.titleWidth;
                }
                
                if (this.selectTextV3_initialized) {
                    setTimeout(() => {
                        this.widgets.find(w => w.name === "selectTextV3_data").value = JSON.stringify(this.selectTextV3_data);
                        
                        // 更新锁定按钮的显示
                        const lockButton = this.domElement.querySelector("button.zml-control-btn[title='锁定/解锁文本框排序']");
                        if (lockButton) {
                            lockButton.textContent = this.isLocked ? "🔒" : "🔓";
                            lockButton.style.background = this.isLocked ? '#644' : '#333';
                        }

                        // 更新名称宽度输入框的显示
                        const titleWidthInput = this.domElement.querySelector("input.zml-control-input[type='number']");
                        if (titleWidthInput) {
                            titleWidthInput.value = this.titleWidth;
                        }

                        this.applySizeMode();
                    }, 10);
                }
            };
        }
    }
});
