import { app } from "../../../scripts/app.js";

// 新增：定义节点推荐的最小尺寸常量
const SELECT_TEXT_V3_MIN_WIDTH = 300; // 适当增加宽度以容纳顶部所有控件
const SELECT_TEXT_V3_MIN_HEIGHT_EMPTY_LIST = 185; // 在文本列表为空时，为UI元素和底部按钮预留足够高度

function createEl(tag, className = "", properties = {}, text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.assign(el, properties);
    if (text) el.textContent = text;
    return el;
}

// === Helper function to adjust color brightness (从LoRA loader中复制过来，确保一致性) ===
const adjustBrightness = (hex, percent) => {
    hex = hex.replace(/^#/, '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    r = Math.min(255, Math.max(0, r + Math.floor(percent / 100 * 255)));
    g = Math.min(255, Math.max(0, g + Math.floor(percent / 100 * 255)));
    b = Math.min(255, Math.max(0, b + Math.floor(percent / 100 * 255)));

    const toHex = (c) => ('0' + c.toString(16)).slice(-2);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};
// ===============================================

app.registerExtension({
    name: "ZML.SelectTextV3.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData) {
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
                            .zml-st3-entry-card.zml-st3-dragging,
                            .zml-st3-folder-card.zml-st3-dragging {
                                opacity: 0.5;
                                background: #555;
                            }
                            /* Dragging insertion line */
                            .zml-st3-drag-over-line {
                                border-top: 2px solid #5d99f2 !important;
                            }
                            /* Dragging into folder highlight */
                            .zml-st3-drag-over-folder {
                                background-color: rgba(93, 153, 242, 0.3) !important;
                            }

                            .zml-st3-drag-handle.locked {
                                cursor: not-allowed !important;
                                color: #666 !important;
                            }

                            /* Folder specific styles */
                            .zml-st3-folder-card {
                                background: #30353c; /* Default folder background */
                                border: 1px solid #4a515a; /* Default folder border */
                                border-radius: 4px;
                                margin-bottom: 4px; /* Spacing between folder cards */
                            }
                            .zml-st3-folder-header {
                                display: flex;
                                align-items: center;
                                padding: 4px;
                                cursor: pointer;
                            }
                            .zml-st3-folder-toggle {
                                width: 20px;
                                text-align: center;
                                font-size: 14px;
                                user-select: none;
                                flex-shrink: 0;
                            }
                            .zml-st3-folder-name-input {
                                background: #2b2b2b;
                                border: 1px solid #444;
                                color: #ccc;
                                border-radius: 2px;
                                flex-grow: 1;
                                padding: 4px;
                                margin: 0 4px;
                            }
                            .zml-st3-folder-delete {
                                background: #444;
                                color: #ccc;
                                border: 1px solid #666;
                                border-radius: 2px;
                                width: 28px;
                                height: 28px;
                                cursor: pointer;
                                flex-shrink: 0;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            .zml-st3-folder-content {
                                padding: 4px;
                                border-top: 1px solid #4a515a;
                                display: flex;
                                flex-direction: column;
                                gap: 4px;
                            }
                            .zml-st3-folder-content.hidden {
                                display: none;
                            }

                            /* Existing control styles, ensuring consistency */
                            .zml-control-btn, .zml-control-input {
                                height: 26px;
                                padding: 0;
                                border: 1px solid #555;
                                border-radius: 2px;
                                background: #333;
                                color: #ccc;
                                cursor: pointer;
                                font-size: 14px;
                                line-height: 1;
                                box-sizing: border-box;
                                flex-shrink: 0;
                            }
                            .zml-control-input {
                                padding: 4px 8px;
                                font-size: 12px;
                                background: #333;
                            }
                            .zml-control-label {
                                font-size: 12px;
                                color: #ccc;
                                flex-shrink: 0;
                            }
                            .zml-control-group {
                                display: flex;
                                align-items: center;
                                gap: 4px;
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
                    // Ensure folderColor is initialized
                    this.folderColor = this.folderColor ?? "#30353c";

                    if (!this.selectTextV3_data) {
                        this.selectTextV3_data = {
                            entries: [
                                { id: "entry1", item_type: "text", title: "", content: "", enabled: true, parent_id: null },
                            ]
                        };
                    } else {
                        // Compatibility for old workflows: add item_type and parent_id for existing entries
                        this.selectTextV3_data.entries.forEach(e => {
                            if (!e.item_type) e.item_type = 'text'; // Default to 'text' if missing
                            if (e.parent_id === undefined) e.parent_id = null; // Default to top-level if missing
                        });
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
                            titleWidth: "名称宽度",
                            newFolder: "新建文件夹",
                            moveOut: "移出",
                            deleteFolder: "删除文件夹",
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

                    const controlsRow = createEl("div");
                    controlsRow.style.cssText = `margin-bottom: 10px; display: flex; align-items: center; gap: 8px;`;

                    // --- 分隔符控件组 ---
                    const separatorGroup = createEl("div", "zml-control-group");
                    const separatorLabel = createEl("span", "zml-control-label", this.getText("separator"));
                    separatorLabel.style.cssText += `margin-left: 2px;`;
                    const separatorInput = createEl("input", "zml-control-input");
                    separatorInput.type = "text";
                    separatorInput.value = this.widgets.find(w => w.name === "separator")?.value || ",";
                    separatorInput.style.cssText += `width: 40px; text-align: left; flex-shrink: 0;`;
                    separatorInput.oninput = (e) => { this.widgets.find(w => w.name === "separator").value = e.target.value; this.triggerSlotChanged(); };
                    separatorGroup.append(separatorLabel, separatorInput);
                    controlsRow.appendChild(separatorGroup);

                    // --- 名称宽度控件组 ---
                    const titleWidthGroup = createEl("div", "zml-control-group");
                    const titleWidthLabel = createEl("span", "zml-control-label", this.getText("titleWidth"));
                    const titleWidthInput = createEl("input", "zml-control-input");
                    titleWidthInput.type = "number";
                    titleWidthInput.min = "20";
                    titleWidthInput.max = "300";
                    titleWidthInput.value = this.titleWidth;
                    titleWidthInput.placeholder = this.getText("titleWidth");
                    titleWidthInput.title = this.getText("titleWidth");
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
                    titleWidthGroup.append(titleWidthLabel, titleWidthInput);
                    controlsRow.appendChild(titleWidthGroup);

                    // === 新建文件夹按钮 ===
                    const newFolderBtn = createEl("button", "zml-control-btn", { textContent: "📁+" });
                    newFolderBtn.title = this.getText("newFolder");
                    newFolderBtn.onclick = () => {
                        this.selectTextV3_data.entries.push({
                            id: "folder" + Date.now(),
                            item_type: "folder",
                            name: "新建文件夹",
                            is_collapsed: false,
                            parent_id: null,
                        });
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(newFolderBtn);
                    // =======================

                    // === 文件夹颜色按钮 ===
                    const folderColorInput = createEl("input", "", { type: "color", value: this.folderColor, style: "width:0; height:0; border:0; padding:0; visibility:hidden;" });
                    folderColorInput.onchange = (e) => {
                        this.folderColor = e.target.value;
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    const folderColorBtn = createEl("button", "zml-control-btn", { textContent: "🎨" });
                    folderColorBtn.title = "自定义文件夹颜色";
                    folderColorBtn.onclick = () => folderColorInput.click();
                    controlsRow.append(folderColorInput, folderColorBtn);
                    // ======================

                    // --- 锁定按钮 ---
                    const lockToggleButton = createEl("button", "zml-control-btn", { textContent: this.isLocked ? "🔒" : "🔓" });
                    lockToggleButton.title = this.getText("lockDrag");
                    lockToggleButton.style.cssText += `width: 26px; height: 26px; ${this.isLocked ? 'background: #644;' : 'background: #333;'}`;
                    lockToggleButton.onclick = () => {
                        this.isLocked = !this.isLocked;
                        lockToggleButton.textContent = this.isLocked ? "🔒" : "🔓";
                        lockToggleButton.style.background = this.isLocked ? '#644' : '#333';
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(lockToggleButton);

                    // --- 尺寸切换按钮 ---
                    const sizeToggleButton = createEl("button", "zml-control-btn", { textContent: "↕" });
                    sizeToggleButton.title = "切换紧凑/普通视图";
                    sizeToggleButton.style.cssText += `width: 26px; height: 26px;`;
                    sizeToggleButton.onclick = () => {
                        this.compactView = !this.compactView;
                        this.applySizeMode();
                        this.triggerSlotChanged();
                    };
                    controlsRow.appendChild(sizeToggleButton);

                    const entriesList = createEl("div");
                    entriesList.style.cssText = `margin-bottom: 6px; flex: 1; min-height: 50px; overflow-y: auto; border: 1px solid #444; border-radius: 2px; padding: 4px; background: #333;`;

                    const newTextBoxBtn = createEl("button", "", { textContent: this.getText("newTextBox") });
                    newTextBoxBtn.style.cssText = `background: #444; color: #ccc; border: 1px solid #666; border-radius: 2px; cursor: pointer; font-size: 12px; font-weight: 500; margin-top: auto; width: 100%;`;
                    newTextBoxBtn.onmouseenter = () => newTextBoxBtn.style.background = '#555';
                    newTextBoxBtn.onmouseleave = () => newTextBoxBtn.style.background = '#444';
                    newTextBoxBtn.onclick = () => {
                        const newId = "text" + Date.now();
                        this.selectTextV3_data.entries.push({ id: newId, item_type: "text", title: "", content: "", enabled: true, parent_id: null });
                        this.renderSelectTextV3Entries();
                        this.triggerSlotChanged();
                    };

                    container.append(header, controlsRow, entriesList, newTextBoxBtn);

                    this.applySizeMode = () => {
                        const s = this.compactView ? this.styles.compact : this.styles.normal;
                        newTextBoxBtn.style.padding = s.newButtonPadding;
                        this.renderSelectTextV3Entries();
                    };


                    this.createTextEntryDOM = (entry) => {
                        const s = this.compactView ? this.styles.compact : this.styles.normal;
                        const entryCard = createEl("div", "zml-st3-entry-card", {
                            style: `display: flex; align-items: center; gap: 4px; padding: ${s.cardPadding}; background: ${entry.enabled ? '#3a3a3a' : '#2a2a2a'}; border: 1px solid ${entry.enabled ? '#555' : '#444'}; border-radius: 2px;`
                        });
                        entryCard.dataset.id = entry.id;
                        entryCard.dataset.type = "text";

                        const checkbox = createEl("input", "", { type: "checkbox", checked: entry.enabled, style: `transform: scale(${s.checkboxScale}); flex-shrink: 0; margin-right: 4px;` });
                        checkbox.onchange = (e) => { entry.enabled = e.target.checked; this.renderSelectTextV3Entries(); this.triggerSlotChanged(); };

                        const dragHandle = createEl("div", "zml-st3-drag-handle", { textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; display: flex; align-items: center; justify-content: center; width: 20px; color: ${this.isLocked ? '#666' : '#888'}; flex-shrink: 0; user-select: none; font-size: 14px;` });
                        dragHandle.draggable = !this.isLocked;

                        const baseInputStyle = `box-sizing: border-box; background: #2b2b2b; border: 1px solid #444; border-radius: 2px; color: #ccc; font-size: 12px; margin-right: 4px; padding: ${s.inputPadding}; height: ${s.inputHeight};`;

                        const titleInput = createEl("input", "", { type: "text", value: entry.title, placeholder: this.getText("inputName"), style: `width: ${this.titleWidth}px; ${baseInputStyle}` });
                        titleInput.oninput = (e) => { entry.title = e.target.value; this.triggerSlotChanged(); };

                        const contentInput = createEl("input", "", { type: "text", value: entry.content, placeholder: this.getText("inputContent"), style: `flex: 1; min-width: 50px; ${baseInputStyle}` });
                        contentInput.oninput = (e) => { entry.content = e.target.value; this.triggerSlotChanged(); };

                        entryCard.append(checkbox, dragHandle, titleInput, contentInput);

                        // === 移出文件夹按钮 (新增) ===
                        if (entry.parent_id) {
                            const moveOutBtn = createEl("button", "", {
                                textContent: "⬆️", title: this.getText("moveOut"),
                                style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #4a6a4a; color: #ccc; cursor: pointer; display: flex; align-items: center; justify-content: center; width: ${s.inputHeight}; height: ${s.inputHeight}; flex-shrink: 0; margin-right: 4px;`
                            });
                            moveOutBtn.onclick = () => {
                                entry.parent_id = null;
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            };
                            entryCard.appendChild(moveOutBtn);
                        }
                        // ===========================

                        const deleteBtn = createEl("button", "", { textContent: "X", style: `padding: 0; border: 1px solid #666; border-radius: 2px; background: #444; color: #ccc; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0;` });
                        deleteBtn.onclick = () => {
                            const itemIndex = this.selectTextV3_data.entries.findIndex(it => it.id === entry.id);
                            if (itemIndex > -1) {
                                this.selectTextV3_data.entries.splice(itemIndex, 1);
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };
                        entryCard.appendChild(deleteBtn);

                        this.addDragDropHandlers(entryCard, entry);
                        return entryCard;
                    };


                    this.createFolderDOM = (entry) => {
                        const folderCard = createEl("div", "zml-st3-folder-card", {
                            style: `background: ${this.folderColor}; border: 1px solid ${adjustBrightness(this.folderColor, -15)};`
                        });
                        folderCard.dataset.id = entry.id;
                        folderCard.dataset.type = "folder";

                        const header = createEl("div", "zml-st3-folder-header");
                        const toggle = createEl("div", "zml-st3-folder-toggle", { textContent: entry.is_collapsed ? "▶" : "▼" });
                        const nameInput = createEl("input", "zml-st3-folder-name-input", { type: "text", value: entry.name, placeholder: "文件夹名称" });
                        const deleteBtn = createEl("button", "zml-st3-folder-delete", { textContent: "🗑️", title: this.getText("deleteFolder") });
                        const dragHandle = createEl("div", "zml-st3-drag-handle", { textContent: "☰", style: `cursor: ${this.isLocked ? 'not-allowed' : 'grab'}; color: ${this.isLocked ? '#666' : '#ccc'}; user-select: none; font-size: 14px; padding: 0 5px;` });
                        dragHandle.draggable = !this.isLocked;

                        const content = createEl("div", `zml-st3-folder-content ${entry.is_collapsed ? 'hidden' : ''}`, {
                            style: `border-top: 1px solid ${adjustBrightness(this.folderColor, -15)};`
                        });

                        header.onclick = (e) => {
                            if (e.target === nameInput || e.target === deleteBtn || e.target === dragHandle) return;
                            if (e.target === header || e.target === toggle || e.target.parentElement === header) {
                                entry.is_collapsed = !entry.is_collapsed;
                                toggle.textContent = entry.is_collapsed ? "▶" : "▼";
                                content.classList.toggle('hidden', entry.is_collapsed);
                                this.triggerSlotChanged();
                            }
                        };

                        nameInput.onchange = (e) => { entry.name = e.target.value; this.triggerSlotChanged(); };

                        deleteBtn.onclick = (e) => {
                            e.stopPropagation();
                            const children = this.selectTextV3_data.entries.filter(it => it.parent_id === entry.id);
                            if (children.length > 0) {
                                alert("文件夹内含有文本框，无法删除！");
                                return;
                            }
                            const itemIndex = this.selectTextV3_data.entries.findIndex(it => it.id === entry.id);
                            if (itemIndex > -1) {
                                this.selectTextV3_data.entries.splice(itemIndex, 1);
                                this.renderSelectTextV3Entries();
                                this.triggerSlotChanged();
                            }
                        };

                        header.append(toggle, dragHandle, nameInput, deleteBtn);
                        folderCard.append(header, content);
                        this.addDragDropHandlers(folderCard, entry);
                        return folderCard;
                    };

                    this.addDragDropHandlers = (element, entry) => {
                        if (this.isLocked) return;

                        const handle = element.querySelector(".zml-st3-drag-handle");
                        if (!handle) return;

                        handle.ondragstart = (e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData("text/plain", entry.id);
                            e.dataTransfer.setDragImage(element, e.offsetX, e.offsetY);
                            setTimeout(() => element.classList.add("zml-st3-dragging"), 0);
                        };

                        element.ondragover = (e) => {
                            e.preventDefault();
                            const draggingEl = document.querySelector(".zml-st3-dragging");
                            if (draggingEl && draggingEl !== element) {
                                const draggingEntryId = e.dataTransfer.getData("text/plain");
                                const draggingEntry = this.selectTextV3_data.entries.find(it => it.id === draggingEntryId);

                                if (!draggingEntry) return;

                                document.querySelectorAll(".zml-st3-drag-over-line, .zml-st3-drag-over-folder").forEach(el => {
                                    el.classList.remove("zml-st3-drag-over-line", "zml-st3-drag-over-folder");
                                });

                                if (entry.item_type === 'folder' && draggingEntry.item_type === 'text') {
                                    element.querySelector('.zml-st3-folder-header').classList.add("zml-st3-drag-over-folder");
                                } else {
                                    element.classList.add("zml-st3-drag-over-line");
                                }
                            }
                        };

                        element.ondragleave = (e) => {
                            element.classList.remove("zml-st3-drag-over-line");
                            if (entry.item_type === 'folder') {
                                element.querySelector('.zml-st3-folder-header').classList.remove("zml-st3-drag-over-folder");
                            }
                        };

                        element.ondrop = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            document.querySelectorAll(".zml-st3-drag-over-line, .zml-st3-drag-over-folder").forEach(el => {
                                el.classList.remove("zml-st3-drag-over-line", "zml-st3-drag-over-folder");
                            });

                            const fromId = e.dataTransfer.getData("text/plain");
                            const toId = entry.id;

                            const fromIndex = this.selectTextV3_data.entries.findIndex(it => it.id === fromId);
                            const toIndex = this.selectTextV3_data.entries.findIndex(it => it.id === toId);
                            const fromItem = this.selectTextV3_data.entries[fromIndex];
                            const toItem = this.selectTextV3_data.entries[toIndex];

                            if (fromIndex === -1 || toIndex === -1 || fromId === toId) return;

                            const itemToMove = this.selectTextV3_data.entries.splice(fromIndex, 1)[0];
                            let newInsertIndex = this.selectTextV3_data.entries.findIndex(it => it.id === toId);

                            if (toItem.item_type === 'folder' && fromItem.item_type === 'text') {
                                itemToMove.parent_id = toItem.id;
                                this.selectTextV3_data.entries.splice(newInsertIndex + 1, 0, itemToMove);
                            } else {
                                itemToMove.parent_id = toItem.parent_id;
                                this.selectTextV3_data.entries.splice(newInsertIndex, 0, itemToMove);
                            }

                            this.renderSelectTextV3Entries();
                            this.triggerSlotChanged();
                        };

                        element.ondragend = (e) => {
                            element.classList.remove("zml-st3-dragging");
                            document.querySelectorAll(".zml-st3-drag-over-line, .zml-st3-drag-over-folder").forEach(el => {
                                el.classList.remove("zml-st3-drag-over-line", "zml-st3-drag-over-folder");
                            });
                        };
                    };

                    this.renderSelectTextV3Entries = () => {
                        entriesList.innerHTML = "";
                        const itemMap = new Map(this.selectTextV3_data.entries.map(e => [e.id, { entry: e, dom: null }]));

                        for (const [id, item] of itemMap) {
                            if (item.entry.item_type === 'folder') {
                                item.dom = this.createFolderDOM(item.entry);
                            } else {
                                item.dom = this.createTextEntryDOM(item.entry);
                            }
                        }

                        const topLevelItems = this.selectTextV3_data.entries.filter(e => !e.parent_id);

                        const appendRecursive = (parentDom, itemsToAppend) => {
                            itemsToAppend.forEach(item => {
                                const domInfo = itemMap.get(item.id);
                                if (!domInfo) return;

                                parentDom.appendChild(domInfo.dom);

                                if (item.item_type === 'folder') {
                                    const folderContentArea = domInfo.dom.querySelector('.zml-st3-folder-content');
                                    if (folderContentArea) {
                                        const children = this.selectTextV3_data.entries.filter(e => e.parent_id === item.id);
                                        const sortedChildren = children.sort((a, b) =>
                                            this.selectTextV3_data.entries.indexOf(a) - this.selectTextV3_data.entries.indexOf(b)
                                        );
                                        appendRecursive(folderContentArea, sortedChildren);
                                    }
                                }
                            });
                        };

                        const sortedTopLevelItems = topLevelItems.sort((a, b) =>
                            this.selectTextV3_data.entries.indexOf(a) - this.selectTextV3_data.entries.indexOf(b)
                        );

                        appendRecursive(entriesList, sortedTopLevelItems);
                        this.updateOutputPreview(); // Assuming this is handled by a separate function
                        app.graph.setDirtyCanvas(true, true); // Mark canvas dirty to force redraw
                    };
                    
                    this.updateOutputPreview = () => {
                        // This part needs to be updated if the output behavior changes with folders
                        // For now, let's assume it concatenates all selected top-level texts.
                        // Or, if text is in a folder (enabled and not collapsed), its content should be included.
                        // A more complex implementation would involve walking the folder structure.
                        // For simplicity, let's just collect all enabled text entries, regardless of folder.
                        const separatorWidget = this.widgets.find(w => w.name === "separator");
                        const separator = separatorWidget ? separatorWidget.value : ",";
                        
                        let combinedContent = "";
                        this.selectTextV3_data.entries.forEach(entry => {
                            if (entry.item_type === 'text' && entry.enabled) {
                                combinedContent += (combinedContent ? separator : "") + entry.content;
                            }
                        });

                        const outputWidget = this.widgets.find(w=>w.name === "text");
                        if(outputWidget) {
                            // Trim leading/trailing separators if they resulted from empty inputs
                            // 使用更安全的正则表达式构建方式，避免特殊字符问题
                            const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            outputWidget.value = combinedContent.replace(new RegExp(`^${escapedSeparator}+|${escapedSeparator}+$`, 'g'), '');
                        }
                    };

                    this.addDOMWidget("selecttextv3_ui", "div", container, { serialize: false });
                    
                    // 修改：调整初始最小高度和宽度
                    const initialHeightFromWidgets = (this.widgets_always_on_top?.[0]?.last_y || 0) + SELECT_TEXT_V3_MIN_HEIGHT_EMPTY_LIST; // 确保顶部插槽下方有足够的空间
                    this.size = [
                        Math.max(this.size[0] || 0, SELECT_TEXT_V3_MIN_WIDTH),
                        Math.max(this.size[1] || 0, initialHeightFromWidgets)
                    ];
                    
                    const origOnResize = this.onResize;
                    this.onResize = function(size) {
                        size[0] = Math.max(size[0], SELECT_TEXT_V3_MIN_WIDTH); // 确保宽度不小于最小宽度

                        let currentContentHeight = controlsRow.offsetHeight + newTextBoxBtn.offsetHeight + 12; // Controls + padding
                        
                        // 如果没有文本条目，为entriesList区域预留一部分高度
                        if (entriesList.scrollHeight > entriesList.clientHeight) { 
                             currentContentHeight += entriesList.scrollHeight;
                         } else { 
                             currentContentHeight += entriesList.clientHeight; 
                         }

                        // 确保总高度不小于初始布局所需的高度，同时兼顾列表为空时的最小高度
                        currentContentHeight = Math.max(currentContentHeight, initialHeightFromWidgets);

                        size[1] = Math.max(size[1], currentContentHeight);
                        this.size = size;

                        const domElement = this.domElement;
                        if (domElement) {
                            if (size[1] < domElement.scrollHeight || size[0] < domElement.scrollWidth) {
                                domElement.style.overflow = "auto";
                                entriesList.style.overflowY = "auto";
                            } else {
                                domElement.style.overflow = "hidden";
                                entriesList.style.overflowY = "visible";
                            }
                        }

                        if (origOnResize) origOnResize.call(this, size);
                    };

                    this.triggerSlotChanged = () => {
                        dataWidget.value = JSON.stringify(this.selectTextV3_data);
                        this.updateOutputPreview(); // Ensure the widget output is updated
                        // 触发大小调整以适应内容变化
                        this.onResize(this.size); 
                        this.setDirtyCanvas(true, true);
                    };

                    // 在初始化时异步调用一次 onResize 和 applySizeMode，确保 DOM 已渲染
                    setTimeout(() => {
                        this.applySizeMode(); // Initial render and size adjustment
                        this.onResize(this.size); // Force an immediate resize after initial render
                    }, 0);


                } catch (error) { console.error("ZML_SelectTextV3: Error during initialization:", error); }
                return r;
            };

            const origOnSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(obj) {
                // IMPORTANT: Ensure the original onSerialize is called first
                // Use the correct ternary operator for calling if it exists.
                origOnSerialize?.apply(this, arguments); 
                
                if (this.selectTextV3_data) obj.selectTextV3_data = this.selectTextV3_data;
                obj.compactView = this.compactView;
                obj.isLocked = this.isLocked;
                obj.titleWidth = this.titleWidth;
                obj.folderColor = this.folderColor; // Save folder color
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(obj) {
                // IMPORTANT: Ensure the original onConfigure is called first
                // Use the correct ternary operator for calling if it exists.
                origOnConfigure?.apply(this, arguments); 

                if (obj.selectTextV3_data) {
                    this.selectTextV3_data = obj.selectTextV3_data;
                    // Compatibility for old workflows: add item_type and parent_id for existing entries
                    this.selectTextV3_data.entries.forEach(e => {
                        if (!e.item_type) e.item_type = 'text';
                        if (e.parent_id === undefined) e.parent_id = null;
                    });
                }
                if (obj.compactView !== undefined) this.compactView = obj.compactView;
                if (obj.isLocked !== undefined) this.isLocked = obj.isLocked;
                if (obj.titleWidth !== undefined) {
                    this.titleWidth = obj.titleWidth;
                }
                this.folderColor = obj.folderColor ?? "#30353c"; // Load folder color, or use default

                if (this.selectTextV3_initialized) {
                    setTimeout(() => {
                        // Refresh widget data and UI elements' state
                        const dataWidget = this.widgets.find(w => w.name === "selectTextV3_data");
                        if (dataWidget) dataWidget.value = JSON.stringify(this.selectTextV3_data);

                        const lockButton = this.domElement.querySelector("button.zml-control-btn[title='锁定/解锁文本框排序']");
                        if (lockButton) {
                            lockButton.textContent = this.isLocked ? "🔒" : "🔓";
                            lockButton.style.background = this.isLocked ? '#644' : '#333';
                        }
                        const titleWidthInput = this.domElement.querySelector("input.zml-control-input[type='number']");
                        if (titleWidthInput) {
                            titleWidthInput.value = this.titleWidth;
                        }
                        const folderColorInput = this.domElement.querySelector("input[type='color']");
                        if (folderColorInput) {
                            folderColorInput.value = this.folderColor;
                        }

                        this.applySizeMode(); // This will re-render entries
                        this.onResize(this.size); // 再次调用 onResize 确保重新配置后高度正确
                    }, 10);
                }
            };
        }
    }
});
