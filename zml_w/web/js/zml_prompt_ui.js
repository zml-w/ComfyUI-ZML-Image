// custom_nodes/ComfyUI-ZML-Image/zml_w/web/js/zml_prompt_ui.js

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { $el, ComfyDialog } from "/scripts/ui.js";

const PROMPT_API_PREFIX = "/zml";
const ACTIVE_BUTTON_BG = "#6a6";
const INACTIVE_BUTTON_BG = "#444";
const ACTIVE_BUTTON_COLOR = "#fff";
const INACTIVE_BUTTON_COLOR = "#eee";
const ADD_BUTTON_BG = "#3a7a3a";
const CHINESE_TEXT_COLOR = "#b2e066";
const TOP_TAG_BG = "#4a7a9a";
const TOP_TAG_CHINESE_COLOR = "#ffeb3b";
const DEFAULT_MODAL_BG = "#222";

let translationMap = new Map();
let allPromptButtons = new Map();
let historyStack = [];
let currentData = null; 
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let isEditMode = false; // 新增：编辑模式状态

// 通用弹出式对话框函数
function showInputDialog(title, inputs, onConfirm) {
    const dialog = $el("div", {
        style: {
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            backgroundColor: "#222", padding: "20px", border: "1px solid #555",
            borderRadius: "8px", zIndex: "1002", width: "300px",
            fontFamily: "sans-serif",
            color: ACTIVE_BUTTON_COLOR,
        }
    });
    
    const dialogTitle = $el("h3", { textContent: title, style: { marginTop: "0", marginBottom: "15px", textAlign: "center" } });
    dialog.appendChild(dialogTitle);

    const inputElements = {};
    inputs.forEach(input => {
        const label = $el("label", { textContent: input.label, style: { display: "block", marginBottom: "5px", color: INACTIVE_BUTTON_COLOR } });
        const inputEl = $el("input", {
            type: "text",
            placeholder: input.placeholder,
            style: { width: "calc(100% - 12px)", padding: "5px", backgroundColor: "#333", border: "1px solid #555", color: INACTIVE_BUTTON_COLOR, borderRadius: "3px" },
        });
        dialog.appendChild(label);
        dialog.appendChild(inputEl);
        inputElements[input.id] = inputEl;
    });

    const buttons = [
        $el("button", {
            textContent: "确认",
            style: { backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer" },
            onclick: () => {
                const values = {};
                for (const id in inputElements) {
                    values[id] = inputElements[id].value;
                }
                onConfirm(values);
                dialog.remove();
            },
        }),
        $el("button", {
            textContent: "取消",
            style: { backgroundColor: INACTIVE_BUTTON_BG, color: INACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer" },
            onclick: () => dialog.remove(),
        }),
    ];
    
    dialog.appendChild($el("div", { style: { display: "flex", gap: "10px", marginTop: "15px", justifyContent: "flex-end" } }, buttons));
    document.body.appendChild(dialog);
}

// 新增：自动保存函数
async function savePromptsToBackend(data) {
    try {
        await api.fetchApi(`${PROMPT_API_PREFIX}/save_prompts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        console.log("Prompts saved automatically.");
    } catch (error) {
        console.error("Error saving prompts automatically:", error);
    }
}

function createPromptModal(node) {
    const backdrop = $el("div", {
        style: {
            position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.7)", zIndex: "1000",
        },
    });

    const modal = $el("div", {
        style: {
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            backgroundColor: DEFAULT_MODAL_BG,
            padding: "20px", border: "1px solid #555",
            borderRadius: "8px", zIndex: "1001", width: "95vw", height: "95vh",
            maxWidth: "1400px", maxHeight: "900px",
            display: "flex", flexDirection: "column",
            fontFamily: "sans-serif",
        },
    });
    
    const header = $el("div", {
        style: {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingBottom: "10px", borderBottom: "1px solid #444", color: ACTIVE_BUTTON_COLOR,
            position: "relative"
        }
    });
    const headerTitle = $el("div", { textContent: "ZML 标签化提示词", style: { fontSize: "1.5em", flexGrow: "1" } });
    
    const themeToggleBtn = $el("button", {
        textContent: "切换主题",
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#5a5a5a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px", marginRight: "10px" }
    });
    const colorPickerContainer = $el("div", {
        style: {
            display: "none",
            position: "absolute",
            top: "100%",
            left: "0",
            zIndex: "1003",
            backgroundColor: "#333",
            border: "1px solid #555",
            padding: "10px",
            borderRadius: "5px"
        }
    });
    const colorPicker = $el("input", {
        type: "color",
        value: DEFAULT_MODAL_BG,
        style: { width: "100%", height: "30px", marginBottom: "10px", border: "none" },
        oninput: (e) => {
            modal.style.backgroundColor = e.target.value;
        }
    });
    const resetColorBtn = $el("button", {
        textContent: "恢复默认",
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#5a5a5a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px", width: "100%" },
        onclick: () => {
            modal.style.backgroundColor = DEFAULT_MODAL_BG;
            colorPicker.value = DEFAULT_MODAL_BG;
        }
    });
    
    themeToggleBtn.onclick = () => {
        colorPickerContainer.style.display = colorPickerContainer.style.display === "none" ? "block" : "none";
    };

    colorPickerContainer.appendChild(colorPicker);
    colorPickerContainer.appendChild(resetColorBtn);
    
    const closeBtn = $el("button", { textContent: "关闭PromptUI", style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#5a5a5a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px", marginRight: "10px" }, onclick: () => { 
        backdrop.remove(); 
        modal.remove(); 
    } });
    const refreshBtn = $el("button", { textContent: "刷新PromptUI", style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#5a5a5a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" }, onclick: () => { 
        backdrop.remove(); 
        modal.remove(); 
        createPromptModal(node);
    } });
    
    header.appendChild(themeToggleBtn);
    header.appendChild(colorPickerContainer);
    
    header.appendChild(headerTitle);
    header.appendChild(closeBtn);
    header.appendChild(refreshBtn);

    const tagDisplay = $el("div", {
        style: {
            minHeight: "40px",
            padding: "5px",
            backgroundColor: "#333",
            border: "1px solid #555",
            borderRadius: "5px",
            display: "flex",
            flexWrap: "wrap",
            gap: "5px",
            alignItems: "center",
        }
    });

    const textDisplay = $el("textarea", {
        readOnly: true,
        style: {
            width: "100%",
            minHeight: "50px",
            marginTop: "10px",
            padding: "5px",
            backgroundColor: "#111",
            color: "#eee",
            border: "1px solid #555",
            borderRadius: "5px",
            resize: "vertical",
        }
    });

    const controls = $el("div", {
        style: {
            marginTop: "5px",
            display: "flex",
            gap: "5px",
            justifyContent: "space-between",
        }
    });

    const undoBtn = $el("button", {
        textContent: "撤回",
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#8a6d3b", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" },
        onclick: () => {
            if (historyStack.length > 0) {
                const lastState = historyStack.pop();
                currentPrompts = new Map(lastState);
                updateNodePrompt();
                renderSelectedTags();
                updatePromptButtons();
                savePromptsToBackend(currentData);
            }
        }
    });
    
    // 新增：批量导入按钮
    const importBtn = $el("button", {
        textContent: "批量导入",
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#3b8a6d", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" },
        onclick: showImportDialog,
    });
    
    const editModeBtn = $el("button", {
        textContent: "编辑模式",
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#5a5a5a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" },
        onclick: () => {
            isEditMode = !isEditMode;
            editModeBtn.style.backgroundColor = isEditMode ? ACTIVE_BUTTON_BG : "#5a5a5a";
            renderAllButtons();
        }
    });

    const copyBtn = $el("button", { 
        textContent: "一键复制", 
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#57a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" }, 
        onclick: () => { 
            textDisplay.select();
            document.execCommand("copy");
            const originalText = copyBtn.textContent;
            copyBtn.textContent = "已复制!";
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1000);
        } 
    });

    const clearBtn = $el("button", { 
        textContent: "一键清空", 
        style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#8c5a5a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" }, 
        onclick: () => {
            pushHistory();
            currentPrompts.clear();
            updateNodePrompt();
            renderSelectedTags();
            updatePromptButtons();
            savePromptsToBackend(currentData);
        }
    });

    const commentText = $el("div", {
        textContent: "下面的是添加提示词的部分，上面的是展示已添加提示词",
        style: { color: INACTIVE_BUTTON_COLOR, fontSize: "0.9em", alignSelf: "center" }
    });

    const controlButtons = $el("div", {
        style: { display: "flex", gap: "5px" }
    });
    controlButtons.appendChild(undoBtn);
    controlButtons.appendChild(importBtn); // 添加批量导入按钮
    controlButtons.appendChild(editModeBtn); // 添加编辑模式按钮
    controlButtons.appendChild(copyBtn);
    controlButtons.appendChild(clearBtn);

    controls.appendChild(commentText);
    controls.appendChild(controlButtons);

    const promptDisplayArea = $el("div", {
        style: { padding: "5px 0" }
    });
    promptDisplayArea.appendChild(tagDisplay);
    promptDisplayArea.appendChild(textDisplay);
    promptDisplayArea.appendChild(controls);

    const content = $el("div", { 
        style: { flexGrow: "1", display: "flex", flexDirection: "column", overflow: "hidden" } 
    });

    const mainTabsContainer = $el("div", {
        style: {
            display: "flex",
            alignItems: "center",
            padding: "5px 0",
            borderBottom: "1px solid #555",
            flexWrap: "wrap",
            gap: "5px"
        }
    });
    const mainTabs = $el("div", {
        style: {
            display: "flex",
            flexGrow: "1",
            flexWrap: "wrap",
            gap: "5px"
        }
    });
    const addMainTabBtn = $el("button", {
        textContent: "+ 新增一级栏目",
        style: {
            padding: "5px 10px", cursor: "pointer", backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px"
        },
        onclick: () => {
            showInputDialog("新增一级分类", [{ label: "分类名称", placeholder: "请输入分类名...", id: "name" }], (values) => {
                if (values.name) {
                    console.log("新增一级分类:", values.name);
                    const newCategory = { name: values.name, groups: [] };
                    currentData.push(newCategory);
                    renderAllButtons();
                    savePromptsToBackend(currentData);
                }
            });
        }
    });
    mainTabsContainer.appendChild(mainTabs);
    mainTabsContainer.appendChild(addMainTabBtn);
    
    const subNavAndAddArea = $el("div", {
        style: {
            display: "flex",
            alignItems: "center",
            padding: "5px 0",
            borderBottom: "1px solid #555",
            flexWrap: "wrap",
            gap: "5px"
        }
    });
    const subNav = $el("div", {
        style: {
            display: "flex",
            flexWrap: "wrap",
            flexGrow: "1",
            gap: "5px"
        }
    });
    const addSubNavBtn = $el("button", {
        textContent: "+ 新增二级栏目",
        style: {
            padding: "5px 10px", cursor: "pointer", backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px"
        },
        onclick: () => {
            showInputDialog("新增二级分类", [{ label: "分类名称", placeholder: "请输入分类名...", id: "name" }], (values) => {
                if (values.name && currentData[activeCategoryIndex]) {
                    console.log("新增二级分类:", values.name, "到一级分类:", currentData[activeCategoryIndex].name);
                    const newGroup = { name: values.name, tags: {} };
                    currentData[activeCategoryIndex].groups.push(newGroup);
                    renderAllButtons();
                    savePromptsToBackend(currentData);
                }
            });
        }
    });
    subNav.appendChild(addSubNavBtn);
    subNavAndAddArea.appendChild(subNav);
    
    const tagArea = $el("div", { style: { flexGrow: "1", overflowY: "auto", padding: "5px 0" } });
    
    modal.appendChild(header);
    modal.appendChild(promptDisplayArea);
    modal.appendChild(mainTabsContainer);
    modal.appendChild(subNavAndAddArea);
    modal.appendChild(tagArea);
    
    const footer = $el("div", {
        style: { paddingTop: "5px", borderTop: "1px solid #444", display: "flex", justifyContent: "flex-end", gap: "5px" },
    });
    const confirmBtn = $el("button", { textContent: "确认", style: { padding: "5px 10px", cursor: "pointer", backgroundColor: "#57a", color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" }, onclick: () => { 
        backdrop.remove(); 
        modal.remove(); 
    } });
    footer.appendChild(confirmBtn);
    modal.appendChild(footer);
    
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    backdrop.onclick = () => { 
        backdrop.remove(); 
        modal.remove(); 
    };

    const currentPromptWidget = node.widgets.find(w => w.name === "positive_prompt");
    const parseInitialPrompts = (value) => {
        const prompts = new Map();
        value.split(',').forEach(s => {
            const trimmed = s.trim();
            if (trimmed) {
                const match = trimmed.match(/\((.*):(\d+\.\d+)\)/);
                if (match) {
                    prompts.set(match[1], parseFloat(match[2]));
                } else {
                    prompts.set(trimmed, 1.0);
                }
            }
        });
        return prompts;
    };
    let currentPrompts = parseInitialPrompts(currentPromptWidget.value);
    
    const pushHistory = () => {
        historyStack.push(Array.from(currentPrompts.entries()));
        if (historyStack.length > 20) {
            historyStack.shift();
        }
    };

    const updateNodePrompt = () => {
        const promptString = Array.from(currentPrompts.entries()).map(([prompt, weight]) => {
            if (weight === 1.0) return prompt;
            return `(${prompt}:${weight.toFixed(1)})`;
        }).join(', ');
        currentPromptWidget.value = promptString;
        app.graph.setDirtyCanvas(true);
    };

    const updatePromptButtons = () => {
        allPromptButtons.forEach((btn, prompt) => {
            if (currentPrompts.has(prompt)) {
                btn.style.backgroundColor = ACTIVE_BUTTON_BG;
                btn.style.color = ACTIVE_BUTTON_COLOR;
            } else {
                btn.style.backgroundColor = INACTIVE_BUTTON_BG;
                btn.style.color = INACTIVE_BUTTON_COLOR;
            }
        });
    };

    const renderAllButtons = () => {
        if (!currentData) return;
        renderMainTabs(currentData);
        renderSelectedTags();
    };

    const renderSelectedTags = () => {
        tagDisplay.innerHTML = "";
        const promptsArray = Array.from(currentPrompts.keys());
        
        promptsArray.forEach(prompt => {
            const name = translationMap.get(prompt) || prompt;
            const weight = currentPrompts.get(prompt) || 1.0;

            const tagEl = $el("div", {
                style: {
                    padding: "5px",
                    borderRadius: "3px",
                    cursor: "pointer",
                    backgroundColor: TOP_TAG_BG,
                    border: "1px solid #666",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    color: ACTIVE_BUTTON_COLOR,
                    position: "relative",
                    width: "60px",
                    height: "40px",
                    overflow: "hidden",
                    margin: "2px",
                },
                onclick: () => {
                    pushHistory();
                    currentPrompts.delete(prompt);
                    updateNodePrompt();
                    renderSelectedTags();
                    updatePromptButtons();
                    savePromptsToBackend(currentData);
                }
            });
            
            tagEl.innerHTML = `
                <div style="font-weight: bold; font-size: 0.5em; color: ${TOP_TAG_CHINESE_COLOR}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                    ${name}
                </div>
                <div style="font-size: 0.4em; color: #eee; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                    ${weight === 1.0 ? prompt : `(${prompt}:${weight.toFixed(1)})`}
                </div>
            `;
            
            const controlsDiv = $el("div", {
                className: "weight-controls",
                style: {
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: "100%",
                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                    display: "none",
                    justifyContent: "space-between",
                    alignItems: "center",
                }
            });
            
            const minusBtn = $el("button", {
                textContent: "-",
                style: {
                    backgroundColor: "transparent",
                    color: "red",
                    border: "none",
                    fontSize: "2em",
                    cursor: "pointer",
                    height: "100%",
                    width: "50%",
                },
                onclick: (e) => {
                    e.stopPropagation();
                    let newWeight = Math.max(0.1, parseFloat(weight) - 0.1);
                    pushHistory();
                    currentPrompts.set(prompt, newWeight);
                    updateNodePrompt();
                    renderSelectedTags();
                    updatePromptButtons();
                    savePromptsToBackend(currentData);
                }
            });
            
            const plusBtn = $el("button", {
                textContent: "+",
                style: {
                    backgroundColor: "transparent",
                    color: "green",
                    border: "none",
                    fontSize: "2em",
                    cursor: "pointer",
                    height: "100%",
                    width: "50%",
                },
                onclick: (e) => {
                    e.stopPropagation();
                    let newWeight = parseFloat(weight) + 0.1;
                    pushHistory();
                    currentPrompts.set(prompt, newWeight);
                    updateNodePrompt();
                    renderSelectedTags();
                    updatePromptButtons();
                    savePromptsToBackend(currentData);
                }
            });

            controlsDiv.appendChild(minusBtn);
            controlsDiv.appendChild(plusBtn);
            tagEl.appendChild(controlsDiv);

            tagEl.onmouseenter = () => controlsDiv.style.display = "flex";
            tagEl.onmouseleave = () => controlsDiv.style.display = "none";
            
            tagDisplay.appendChild(tagEl);
        });
        
        textDisplay.value = promptsArray.map(p => {
            const weight = currentPrompts.get(p);
            return weight === 1.0 ? p : `(${p}:${weight.toFixed(1)})`;
        }).join(", ");
    };
    
    const renderGroupTags = (groups) => {
        tagArea.innerHTML = "";
        
        groups.forEach((group, groupIndex) => {
            if (group.name) {
                const groupContainer = $el("div", {
                    style: {
                        marginBottom: "15px",
                        padding: "10px",
                        backgroundColor: "#111",
                        borderRadius: "5px"
                    }
                });
                
                const groupHeader = $el("h4", {
                    textContent: group.name,
                    style: { marginTop: "0", marginBottom: "10px", color: group.color ? group.color : INACTIVE_BUTTON_COLOR, position: "relative" }
                });

                // 新增：标签大小和字体大小输入框
                const tagSizeInput = $el("input", {
                    type: "number",
                    value: group.tagWidth || 200,
                    min: 50,
                    max: 300,
                    style: { width: "50px", marginLeft: "10px", backgroundColor: "#333", color: "#eee", border: "1px solid #555" },
                    onchange: (e) => {
                        group.tagWidth = parseInt(e.target.value);
                        renderGroupTags(groups);
                        savePromptsToBackend(currentData);
                    }
                });
                const fontSizeInput = $el("input", {
                    type: "number",
                    value: group.fontSize || 16,
                    min: 8,
                    max: 30,
                    style: { width: "50px", marginLeft: "10px", backgroundColor: "#333", color: "#eee", border: "1px solid #555" },
                    onchange: (e) => {
                        group.fontSize = parseInt(e.target.value);
                        renderGroupTags(groups);
                        savePromptsToBackend(currentData);
                    }
                });

                const controlsDiv = $el("div", {
                    style: { display: "flex", alignItems: "center", gap: "5px", position: "absolute", right: "0", top: "0" }
                });
                controlsDiv.appendChild($el("span", { textContent: "标签大小:", style: { fontSize: "0.8em", color: INACTIVE_BUTTON_COLOR } }));
                controlsDiv.appendChild(tagSizeInput);
                controlsDiv.appendChild($el("span", { textContent: "字体大小:", style: { fontSize: "0.8em", color: INACTIVE_BUTTON_COLOR } }));
                controlsDiv.appendChild(fontSizeInput);
                groupHeader.appendChild(controlsDiv);

                groupContainer.appendChild(groupHeader);
                
                if (isEditMode) {
                    const deleteGroupBtn = $el("span", {
                        textContent: "×",
                        style: {
                            position: "absolute", top: "0", right: "0",
                            color: "red", fontSize: "1.5em", cursor: "pointer", padding: "0 5px",
                        },
                        onclick: (e) => {
                            e.stopPropagation();
                            if (confirm(`确定要删除二级分类 '${group.name}' 吗？此操作不可逆！`)) {
                                pushHistory();
                                const category = currentData[activeCategoryIndex];
                                category.groups.splice(groupIndex, 1);
                                renderAllButtons();
                                savePromptsToBackend(currentData);
                            }
                        }
                    });
                    groupHeader.appendChild(deleteGroupBtn);
                }

                const promptContainer = $el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } });
                
                const addTagBtn = $el("button", {
                    textContent: "+ 添加",
                    style: { padding: "5px 10px", cursor: "pointer", backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px" },
                    onclick: () => {
                         showInputDialog("添加提示词", [
                             { label: "提示词 (英文)", placeholder: "例如: 1girl", id: "prompt" },
                             { label: "中文翻译", placeholder: "例如: 1女孩", id: "name" }
                         ], (values) => {
                             if (values.prompt && group.tags) {
                                console.log("新增提示词:", values.prompt, "中文名:", values.name, "到分类:", group.name);
                                group.tags[values.prompt] = values.name;
                                renderAllButtons();
                                savePromptsToBackend(currentData);
                             }
                         });
                    }
                });
                promptContainer.appendChild(addTagBtn);
                
                for (const prompt in group.tags) {
                    const name = group.tags[prompt];
                    translationMap.set(prompt, name);
                    
                    const promptBtn = $el("button", {
                        style: { 
                            padding: "5px 10px", 
                            borderRadius: "3px", 
                            cursor: "pointer", 
                            backgroundColor: currentPrompts.has(prompt) ? ACTIVE_BUTTON_BG : INACTIVE_BUTTON_BG, 
                            border: "1px solid #666",
                            textAlign: "center",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            alignItems: "center",
                            color: currentPrompts.has(prompt) ? ACTIVE_BUTTON_COLOR : INACTIVE_BUTTON_COLOR,
                            minWidth: `${group.tagWidth || 200}px`, // 应用自定义标签大小
                            width: `${group.tagWidth || 200}px`,
                            height: "50px",
                            overflow: "hidden",
                            position: "relative",
                        },
                    });

                    allPromptButtons.set(prompt, promptBtn);
                    
                    promptBtn.innerHTML = `
                        <div style="font-weight: bold; font-size: ${group.fontSize || 16}px; color: ${CHINESE_TEXT_COLOR}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div>
                        <div style="font-size: ${group.fontSize * 0.8 || 12.8}px; color: #aaa; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prompt}</div>
                    `;

                    promptBtn.onclick = () => {
                        pushHistory();
                        if (currentPrompts.has(prompt)) {
                            currentPrompts.delete(prompt);
                        } else {
                            currentPrompts.set(prompt, 1.0);
                        }
                        updateNodePrompt();
                        renderSelectedTags();
                        updatePromptButtons();
                        savePromptsToBackend(currentData);
                    };

                    if (isEditMode) {
                        const deleteBtn = $el("span", {
                            textContent: "×",
                            style: {
                                position: "absolute", top: "-5px", right: "-5px",
                                backgroundColor: "red", color: "white", borderRadius: "50%",
                                width: "15px", height: "15px", lineHeight: "15px", textAlign: "center",
                                fontSize: "12px", cursor: "pointer", zIndex: "10",
                            },
                            onclick: (e) => {
                                e.stopPropagation();
                                if (confirm(`确定要删除标签 '${prompt}' 吗？`)) {
                                    pushHistory();
                                    delete group.tags[prompt];
                                    renderAllButtons();
                                    savePromptsToBackend(currentData);
                                }
                            }
                        });
                        promptBtn.appendChild(deleteBtn);
                    }
                    promptContainer.appendChild(promptBtn);
                }
                groupContainer.appendChild(promptContainer);
                tagArea.appendChild(groupContainer);
            }
        });
    };

    const renderMainTabs = (data) => {
        mainTabs.innerHTML = "";
        
        data.forEach((categoryData, index) => {
            const navBtn = $el("button", {
                textContent: categoryData.name,
                style: {
                    padding: "5px 10px",
                    cursor: "pointer",
                    backgroundColor: index === activeCategoryIndex ? "#555" : "#333",
                    border: "1px solid #555",
                    borderBottom: "none",
                    color: "#eee",
                    borderRadius: "3px",
                    margin: "0 5px 0 0",
                    position: "relative",
                },
                onclick: () => {
                    activeCategoryIndex = index;
                    [...mainTabs.children].forEach(btn => {
                        btn.style.backgroundColor = "#333";
                        btn.style.borderBottom = "none";
                    });
                    navBtn.style.backgroundColor = "#555";
                    navBtn.style.borderBottom = "1px solid #555";
                    renderSubNavAndTags(categoryData.groups);
                }
            });

            if (isEditMode) {
                const deleteBtn = $el("span", {
                    textContent: "×",
                    style: {
                        position: "absolute", top: "-5px", right: "-5px",
                        backgroundColor: "red", color: "white", borderRadius: "50%",
                        width: "15px", height: "15px", lineHeight: "15px", textAlign: "center",
                        fontSize: "12px", cursor: "pointer", zIndex: "10",
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                        if (confirm(`确定要删除一级分类 '${categoryData.name}' 吗？此操作不可逆！`)) {
                            pushHistory();
                            currentData.splice(index, 1);
                            activeCategoryIndex = 0;
                            renderAllButtons();
                            savePromptsToBackend(currentData);
                        }
                    }
                });
                navBtn.appendChild(deleteBtn);
            }
            mainTabs.appendChild(navBtn);
        });
        
        if (data.length > 0) {
            renderSubNavAndTags(data[activeCategoryIndex].groups);
        }
    };

    const renderSubNavAndTags = (groups) => {
        subNav.innerHTML = "";
        tagArea.innerHTML = "";
        
        groups.forEach((group, index) => {
            if (group.name) {
                const subNavBtn = $el("button", {
                    textContent: group.name,
                    style: {
                        padding: "5px 10px", margin: "5px 5px 0 0", cursor: "pointer",
                        backgroundColor: index === activeGroupIndex ? "#555" : "#333",
                        color: index === activeGroupIndex ? ACTIVE_BUTTON_COLOR : INACTIVE_BUTTON_COLOR,
                        border: "1px solid #555",
                        borderRadius: "3px",
                        position: "relative",
                    },
                    onclick: () => {
                        activeGroupIndex = index;
                        [...subNav.children].forEach(btn => {
                            btn.style.backgroundColor = "#333";
                            btn.style.color = INACTIVE_BUTTON_COLOR;
                        });
                        subNavBtn.style.backgroundColor = "#555";
                        subNavBtn.style.color = ACTIVE_BUTTON_COLOR;
                        renderGroupTags([groups[index]]);
                    }
                });

                if (isEditMode) {
                    const deleteBtn = $el("span", {
                        textContent: "×",
                        style: {
                            position: "absolute", top: "-5px", right: "-5px",
                            backgroundColor: "red", color: "white", borderRadius: "50%",
                            width: "15px", height: "15px", lineHeight: "15px", textAlign: "center",
                            fontSize: "12px", cursor: "pointer", zIndex: "10",
                        },
                        onclick: (e) => {
                            e.stopPropagation();
                            if (confirm(`确定要删除二级分类 '${group.name}' 吗？此操作不可逆！`)) {
                                pushHistory();
                                currentData[activeCategoryIndex].groups.splice(index, 1);
                                renderAllButtons();
                                savePromptsToBackend(currentData);
                            }
                        }
                    });
                    subNavBtn.appendChild(deleteBtn);
                }
                subNav.appendChild(subNavBtn);
                
                if (index === activeGroupIndex) {
                    renderGroupTags([group]);
                }
            }
        });
        
        // 新增二级栏目按钮
        const addSubNavBtn = $el("button", {
            textContent: "+ 新增二级栏目",
            style: {
                padding: "5px 10px", cursor: "pointer", backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px", marginLeft: "auto",
            },
            onclick: () => {
                showInputDialog("新增二级分类", [{ label: "分类名称", placeholder: "请输入分类名...", id: "name" }], (values) => {
                    if (values.name && currentData[activeCategoryIndex]) {
                        console.log("新增二级分类:", values.name, "到一级分类:", currentData[activeCategoryIndex].name);
                        const newGroup = { name: values.name, tags: {} };
                        currentData[activeCategoryIndex].groups.push(newGroup);
                        renderAllButtons();
                        savePromptsToBackend(currentData);
                    }
                });
            }
        });
        subNavAndAddArea.appendChild(addSubNavBtn);
    };

    // 新增：批量导入对话框函数
    function showImportDialog() {
        const importDialog = $el("div", {
            style: {
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                backgroundColor: "#222", padding: "20px", border: "1px solid #555",
                borderRadius: "8px", zIndex: "1002", width: "400px",
                fontFamily: "sans-serif",
                color: ACTIVE_BUTTON_COLOR,
            }
        });

        const dialogTitle = $el("h3", { textContent: "批量导入标签", style: { marginTop: "0", marginBottom: "15px", textAlign: "center" } });
        importDialog.appendChild(dialogTitle);

        const categoryLabel = $el("label", { textContent: "选择一级栏目", style: { display: "block", marginBottom: "5px", color: INACTIVE_BUTTON_COLOR } });
        const categorySelect = $el("select", { style: { width: "100%", padding: "5px", backgroundColor: "#333", border: "1px solid #555", color: INACTIVE_BUTTON_COLOR, borderRadius: "3px", marginBottom: "10px" } });
        
        currentData.forEach((cat, index) => {
            categorySelect.appendChild($el("option", { value: index, textContent: cat.name }));
        });
        
        const groupLabel = $el("label", { textContent: "选择二级栏目", style: { display: "block", marginBottom: "5px", color: INACTIVE_BUTTON_COLOR } });
        const groupSelect = $el("select", { style: { width: "100%", padding: "5px", backgroundColor: "#333", border: "1px solid #555", color: INACTIVE_BUTTON_COLOR, borderRadius: "3px", marginBottom: "10px" } });
        
        const updateGroupSelect = (catIndex) => {
            groupSelect.innerHTML = "";
            const groups = currentData[catIndex]?.groups || [];
            groups.forEach((group, index) => {
                groupSelect.appendChild($el("option", { value: index, textContent: group.name }));
            });
        };

        categorySelect.onchange = (e) => {
            updateGroupSelect(e.target.value);
        };
        
        if (currentData.length > 0) {
            updateGroupSelect(categorySelect.value);
        }

        const createGroupBtn = $el("button", {
            textContent: "+ 新建二级栏目",
            style: { width: "100%", backgroundColor: "#3a7a3a", color: ACTIVE_BUTTON_COLOR, padding: "5px", border: "none", borderRadius: "3px", cursor: "pointer", marginBottom: "15px" },
            onclick: () => {
                showInputDialog("新建二级栏目", [{ label: "栏目名称", placeholder: "请输入栏目名...", id: "name" }], (values) => {
                    if (values.name) {
                        const newGroup = { name: values.name, tags: {} };
                        const catIndex = categorySelect.value;
                        currentData[catIndex].groups.push(newGroup);
                        updateGroupSelect(catIndex);
                        groupSelect.value = currentData[catIndex].groups.length - 1;
                        savePromptsToBackend(currentData);
                    }
                });
            }
        });

        const fileLabel = $el("label", { textContent: "选择TXT文件 (格式: 中文,英文)", style: { display: "block", marginBottom: "5px", color: INACTIVE_BUTTON_COLOR } });
        const fileInput = $el("input", { type: "file", accept: ".txt", style: { width: "100%", padding: "5px", backgroundColor: "#333", border: "1px solid #555", color: INACTIVE_BUTTON_COLOR, borderRadius: "3px", marginBottom: "15px" } });

        const buttons = [
            $el("button", {
                textContent: "确认导入",
                style: { backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer" },
                onclick: async () => {
                    const file = fileInput.files[0];
                    const categoryIndex = categorySelect.value;
                    const groupIndex = groupSelect.value;
                    
                    if (!file || categoryIndex === "" || groupIndex === "") {
                        alert("请选择一个文件和有效的分类！");
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const content = e.target.result;
                        const lines = content.split('\n');
                        const newTags = {};
                        lines.forEach(line => {
                            const parts = line.trim().split(',');
                            if (parts.length === 2) {
                                const [chinese, english] = parts.map(s => s.trim());
                                newTags[english] = chinese;
                            }
                        });
                        
                        const targetGroup = currentData[categoryIndex].groups[groupIndex];
                        Object.assign(targetGroup.tags, newTags);
                        
                        await savePromptsToBackend(currentData);
                        alert("标签导入成功！");
                        renderAllButtons();
                        importDialog.remove();
                    };
                    reader.readAsText(file, 'UTF-8');
                },
            }),
            $el("button", {
                textContent: "取消",
                style: { backgroundColor: INACTIVE_BUTTON_BG, color: INACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer" },
                onclick: () => importDialog.remove(),
            }),
        ];

        importDialog.appendChild(categoryLabel);
        importDialog.appendChild(categorySelect);
        importDialog.appendChild(groupLabel);
        importDialog.appendChild(groupSelect);
        importDialog.appendChild(createGroupBtn);
        importDialog.appendChild(fileLabel);
        importDialog.appendChild(fileInput);
        importDialog.appendChild($el("div", { style: { display: "flex", gap: "10px", marginTop: "15px", justifyContent: "flex-end" } }, buttons));
        
        document.body.appendChild(importDialog);
    }
    
    api.fetchApi(`${PROMPT_API_PREFIX}/get_prompts`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                tagArea.textContent = `加载失败: ${data.error}`;
                return;
            }
            currentData = data;
            renderAllButtons();
        })
        .catch(error => {
            tagArea.textContent = `加载失败: ${error}`;
            console.error(error);
        });
}

app.registerExtension({
    name: "ZML.PromptUI",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ZML_PromptUINode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                const widget = this.widgets.find(w => w.name === "positive_prompt");
                // 移除固定高度的代码，让用户可以自由调整大小
                // if (widget) {
                //     widget.inputEl.style.height = "150px";
                // }

                this.addWidget("button", "打开标签化PromptUI", "open", () => {
                    createPromptModal(this);
                });
            };
        }
    },
});