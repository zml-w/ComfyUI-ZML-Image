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
const CHINESE_TEXT_COLOR = "#b2e066"; // This will be the default color
const TOP_TAG_BG = "#4a7a9a";
const TOP_TAG_CHINESE_COLOR = "#ffeb3b";
const DEFAULT_MODAL_BG = "#222";

let translationMap = new Map();
let allPromptButtons = new Map();
let historyStack = [];
let currentData = null;
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let isEditMode = false;

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

// 【ZML 新增】创建通用的选择对话框
function showChoiceDialog(title, choices, onConfirm) {
    const dialog = $el("div", {
        style: {
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            backgroundColor: "#222", padding: "20px", border: "1px solid #555",
            borderRadius: "8px", zIndex: "1002", width: "auto", minWidth: "300px",
            fontFamily: "sans-serif",
            color: ACTIVE_BUTTON_COLOR,
        }
    });

    const dialogTitle = $el("h3", { textContent: title, style: { marginTop: "0", marginBottom: "15px", textAlign: "center" } });
    dialog.appendChild(dialogTitle);

    const choiceButtonsContainer = $el("div", {
        style: { display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", marginBottom: "15px" }
    });
    choices.forEach(choice => {
        const choiceBtn = $el("button", {
            textContent: choice,
            style: { backgroundColor: "#57a", color: ACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer" },
            onclick: () => {
                onConfirm(choice);
                dialog.remove();
            }
        });
        choiceButtonsContainer.appendChild(choiceBtn);
    });
    dialog.appendChild(choiceButtonsContainer);

    const cancelBtn = $el("button", {
        textContent: "取消",
        style: { backgroundColor: INACTIVE_BUTTON_BG, color: INACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer", width: "100%" },
        onclick: () => dialog.remove(),
    });
    dialog.appendChild(cancelBtn);

    document.body.appendChild(dialog);
}

// 自动保存函数
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
                const currentCategory = currentData[activeCategoryIndex];
                if (currentCategory && currentCategory.groups && currentCategory.groups[activeGroupIndex]) {
                    renderGroupTags([currentCategory.groups[activeGroupIndex]]);
                }
                savePromptsToBackend(currentData);
            }
        }
    });

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
            const currentCategory = currentData[activeCategoryIndex];
            if (currentCategory && currentCategory.groups && currentCategory.groups[activeGroupIndex]) {
                renderGroupTags([currentCategory.groups[activeGroupIndex]]);
            }
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
    controlButtons.appendChild(importBtn);
    controlButtons.appendChild(editModeBtn);
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
                    padding: "5px", borderRadius: "3px", cursor: "pointer", backgroundColor: TOP_TAG_BG,
                    border: "1px solid #666", textAlign: "center", display: "flex", flexDirection: "column",
                    justifyContent: "center", alignItems: "center", color: ACTIVE_BUTTON_COLOR,
                    position: "relative", width: "60px", height: "40px", overflow: "hidden", margin: "2px",
                }
            });

            tagEl.innerHTML = `<div style="font-weight: bold; font-size: 0.5em; color: ${TOP_TAG_CHINESE_COLOR}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${name}</div><div style="font-size: 0.4em; color: #eee; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${weight === 1.0 ? prompt : `(${prompt}:${weight.toFixed(1)})`}</div>`;

            const controlsDiv = $el("div", {
                className: "weight-controls",
                style: {
                    position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
                    backgroundColor: "rgba(0, 0, 0, 0.7)", display: "none", justifyContent: "space-between", alignItems: "center",
                }
            });

            const minusBtn = $el("button", {
                textContent: "-",
                style: { backgroundColor: "transparent", color: "#f88", border: "none", fontSize: "1.5rem", cursor: "pointer", height: "100%", flex: "1" },
                onclick: (e) => {
                    e.stopPropagation();
                    let newWeight = Math.max(0.1, parseFloat(weight) - 0.1);
                    pushHistory();
                    currentPrompts.set(prompt, newWeight);
                    updateNodePrompt(); 
                    renderSelectedTags(); 
                    const currentCategory = currentData[activeCategoryIndex];
                    if (currentCategory && currentCategory.groups && currentCategory.groups[activeGroupIndex]) {
                        renderGroupTags([currentCategory.groups[activeGroupIndex]]);
                    }
                    savePromptsToBackend(currentData);
                }
            });

            const plusBtn = $el("button", {
                textContent: "+",
                style: { backgroundColor: "transparent", color: "#8f8", border: "none", fontSize: "1.5rem", cursor: "pointer", height: "100%", flex: "1" },
                onclick: (e) => {
                    e.stopPropagation();
                    let newWeight = parseFloat(weight) + 0.1;
                    pushHistory();
                    currentPrompts.set(prompt, newWeight);
                    updateNodePrompt(); 
                    renderSelectedTags();
                    const currentCategory = currentData[activeCategoryIndex];
                    if (currentCategory && currentCategory.groups && currentCategory.groups[activeGroupIndex]) {
                        renderGroupTags([currentCategory.groups[activeGroupIndex]]);
                    }
                    savePromptsToBackend(currentData);
                }
            });
            
            const removeBtn = $el("div", {
                textContent: "×",
                style: {
                    position: "absolute", top: "-1px", right: "1px", color: "white", backgroundColor: "rgba(255, 0, 0, 0.7)",
                    borderRadius: "50%", width: "14px", height: "14px", lineHeight: "14px", textAlign: "center",
                    fontSize: "12px", cursor: "pointer", display: "none"
                },
                onclick: (e) => {
                    e.stopPropagation();
                    pushHistory();
                    currentPrompts.delete(prompt);
                    updateNodePrompt();
                    renderSelectedTags();
                    const currentCategory = currentData[activeCategoryIndex];
                    if (currentCategory && currentCategory.groups && currentCategory.groups[activeGroupIndex]) {
                        renderGroupTags([currentCategory.groups[activeGroupIndex]]);
                    }
                    savePromptsToBackend(currentData);
                }
            });

            controlsDiv.appendChild(minusBtn);
            controlsDiv.appendChild(plusBtn);
            tagEl.appendChild(controlsDiv);
            tagEl.appendChild(removeBtn);

            tagEl.onmouseenter = () => {
                controlsDiv.style.display = "flex";
                removeBtn.style.display = "block";
            };
            tagEl.onmouseleave = () => {
                controlsDiv.style.display = "none";
                removeBtn.style.display = "none";
            };

            tagDisplay.appendChild(tagEl);
        });

        textDisplay.value = promptsArray.map(p => { const weight = currentPrompts.get(p); return weight === 1.0 ? p : `(${p}:${weight.toFixed(1)})`; }).join(", ");
    };

    const renderGroupTags = (groups) => {
        tagArea.innerHTML = "";
        groups.forEach((group) => {
            if (group.name) {
                const groupContainer = $el("div", { style: { marginBottom: "15px", padding: "10px", backgroundColor: "#111", borderRadius: "5px" } });
                const groupHeader = $el("h4", { textContent: group.name, style: { marginTop: "0", marginBottom: "10px", color: INACTIVE_BUTTON_COLOR, position: "relative" } });
                
                // 【ZML 新增】创建“恢复默认”按钮
                const restoreDefaultsBtn = $el("button", {
                    textContent: "恢复默认",
                    style: { padding: "3px 8px", cursor: "pointer", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: "3px", fontSize: "0.8em", marginRight: "10px" },
                    onclick: () => {
                        showChoiceDialog("恢复默认参数", ["颜色", "背景", "标签大小", "字体大小"], (choice) => {
                            switch (choice) {
                                case "颜色":
                                    delete group.textColor;
                                    break;
                                case "背景":
                                    delete group.tagBgColor;
                                    break;
                                case "标签大小":
                                    delete group.tagWidth;
                                    break;
                                case "字体大小":
                                    delete group.fontSize;
                                    break;
                            }
                            savePromptsToBackend(currentData);
                            renderGroupTags(groups); // 重新渲染以应用更改
                        });
                    }
                });

                const textColorInput = $el("input", {
                    type: "color",
                    value: group.textColor || CHINESE_TEXT_COLOR,
                    style: { width: "25px", height: "25px", border: "1px solid #555", padding: "0", cursor: "pointer", backgroundColor: "transparent", marginRight: "10px" },
                    onchange: (e) => {
                        group.textColor = e.target.value;
                        renderGroupTags(groups);
                        savePromptsToBackend(currentData);
                    }
                });

                const tagBgColorInput = $el("input", {
                    type: "color",
                    value: group.tagBgColor || INACTIVE_BUTTON_BG,
                    style: { width: "25px", height: "25px", border: "1px solid #555", padding: "0", cursor: "pointer", backgroundColor: "transparent", marginRight: "10px" },
                    onchange: (e) => {
                        group.tagBgColor = e.target.value;
                        renderGroupTags(groups);
                        savePromptsToBackend(currentData);
                    }
                });

                const tagSizeInput = $el("input", {
                    type: "number", value: group.tagWidth || 200, min: 50, max: 300,
                    style: { width: "50px", marginLeft: "10px", backgroundColor: "#333", color: "#eee", border: "1px solid #555" },
                    onchange: (e) => { group.tagWidth = parseInt(e.target.value); renderGroupTags(groups); savePromptsToBackend(currentData); }
                });
                const fontSizeInput = $el("input", {
                    type: "number", value: group.fontSize || 16, min: 8, max: 30,
                    style: { width: "50px", marginLeft: "10px", backgroundColor: "#333", color: "#eee", border: "1px solid #555" },
                    onchange: (e) => { group.fontSize = parseInt(e.target.value); renderGroupTags(groups); savePromptsToBackend(currentData); }
                });

                const controlsDiv = $el("div", { style: { display: "flex", alignItems: "center", gap: "5px", position: "absolute", right: "0", top: "-5px" } });
                controlsDiv.appendChild(restoreDefaultsBtn); // 添加新按钮
                controlsDiv.appendChild($el("span", { textContent: "颜色", style: { fontSize: "0.8em", color: INACTIVE_BUTTON_COLOR } }));
                controlsDiv.appendChild(textColorInput);
                controlsDiv.appendChild($el("span", { textContent: "背景", style: { fontSize: "0.8em", color: INACTIVE_BUTTON_COLOR } }));
                controlsDiv.appendChild(tagBgColorInput);
                controlsDiv.appendChild($el("span", { textContent: "标签大小:", style: { fontSize: "0.8em", color: INACTIVE_BUTTON_COLOR } }));
                controlsDiv.appendChild(tagSizeInput);
                controlsDiv.appendChild($el("span", { textContent: "字体大小:", style: { fontSize: "0.8em", color: INACTIVE_BUTTON_COLOR } }));
                controlsDiv.appendChild(fontSizeInput);
                groupHeader.appendChild(controlsDiv);
                groupContainer.appendChild(groupHeader);

                if (isEditMode) {
                    const deleteGroupBtn = $el("span", {
                        textContent: "×",
                        style: { position: "absolute", right: "440px", top: "-5px", color: "red", fontSize: "1.5em", cursor: "pointer", padding: "0 5px", }, //【ZML 修改】调整位置
                        onclick: (e) => {
                            e.stopPropagation();
                            if (confirm(`确定要删除二级分类 '${group.name}' 吗？此操作不可逆！`)) {
                                pushHistory();
                                const category = currentData[activeCategoryIndex];
                                const actualIndex = category.groups.indexOf(group);
                                if (actualIndex > -1) {
                                    category.groups.splice(actualIndex, 1);
                                    renderAllButtons();
                                    savePromptsToBackend(currentData);
                                } else { alert("删除失败：找不到分类。"); }
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
                        showInputDialog("添加提示词", [{ label: "提示词 (英文)", placeholder: "例如: 1girl", id: "prompt" }, { label: "中文翻译", placeholder: "例如: 1女孩", id: "name" }],
                            (values) => {
                                if (values.prompt && group.tags) {
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
                            padding: "5px 10px", borderRadius: "3px", cursor: "pointer", border: "1px solid #666", textAlign: "center",
                            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                            backgroundColor: currentPrompts.has(prompt) ? ACTIVE_BUTTON_BG : (group.tagBgColor || INACTIVE_BUTTON_BG),
                            color: INACTIVE_BUTTON_COLOR,
                            minWidth: `${group.tagWidth || 200}px`, width: `${group.tagWidth || 200}px`,
                            height: "50px", overflow: "hidden", position: "relative",
                        },
                    });
                    allPromptButtons.set(prompt, promptBtn);
                    
                    promptBtn.innerHTML = `<div style="font-weight: bold; font-size: ${group.fontSize || 16}px; color: ${group.textColor || CHINESE_TEXT_COLOR}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div><div style="font-size: ${group.fontSize * 0.8 || 12.8}px; color: #aaa; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prompt}</div>`;
                    
                    promptBtn.onclick = () => {
                        pushHistory();
                        if (currentPrompts.has(prompt)) { currentPrompts.delete(prompt); } else { currentPrompts.set(prompt, 1.0); }
                        updateNodePrompt(); 
                        renderSelectedTags(); 
                        renderGroupTags(groups);
                        savePromptsToBackend(currentData);
                    };
                    if (isEditMode) {
                        const deleteBtn = $el("span", {
                            textContent: "×",
                            style: { position: "absolute", top: "-5px", right: "-5px", backgroundColor: "red", color: "white", borderRadius: "50%", width: "15px", height: "15px", lineHeight: "15px", textAlign: "center", fontSize: "12px", cursor: "pointer", zIndex: "10", },
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
                    padding: "5px 10px", cursor: "pointer", border: "1px solid #555", borderRadius: "3px",
                    margin: "0 5px 0 0", position: "relative",
                    backgroundColor: index === activeCategoryIndex ? ACTIVE_BUTTON_BG : INACTIVE_BUTTON_BG,
                    color: index === activeCategoryIndex ? ACTIVE_BUTTON_COLOR : INACTIVE_BUTTON_COLOR,
                },
                onclick: () => {
                    activeCategoryIndex = index;
                    activeGroupIndex = 0;
                    renderAllButtons();
                }
            });
            if (isEditMode) {
                const deleteBtn = $el("span", {
                    textContent: "×",
                    style: {
                        position: "absolute", top: "-5px", right: "-5px", backgroundColor: "red", color: "white",
                        borderRadius: "50%", width: "15px", height: "15px", lineHeight: "15px", textAlign: "center",
                        fontSize: "12px", cursor: "pointer", zIndex: "10",
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                        if (confirm(`确定要删除一级分类 '${categoryData.name}' 吗？此操作不可逆！`)) {
                            pushHistory();
                            currentData.splice(index, 1);
                            activeCategoryIndex = 0; activeGroupIndex = 0;
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
            if (activeCategoryIndex >= data.length) { activeCategoryIndex = 0; }
            renderSubNavAndTags(data[activeCategoryIndex].groups);
        } else {
            renderSubNavAndTags([]);
        }
    };

    const renderSubNavAndTags = (groups) => {
        subNav.innerHTML = "";
        tagArea.innerHTML = "";
        if (!groups) groups = [];
        if (activeGroupIndex >= groups.length) { activeGroupIndex = 0; }

        groups.forEach((group, index) => {
            if (group.name) {
                const subNavBtn = $el("button", {
                    textContent: group.name,
                    style: {
                        padding: "5px 10px", margin: "5px 5px 0 0", cursor: "pointer",
                        backgroundColor: index === activeGroupIndex ? ACTIVE_BUTTON_BG : INACTIVE_BUTTON_BG,
                        color: index === activeGroupIndex ? ACTIVE_BUTTON_COLOR : INACTIVE_BUTTON_COLOR,
                        border: "1px solid #555", borderRadius: "3px", position: "relative",
                    },
                    onclick: () => {
                        activeGroupIndex = index;
                        renderSubNavAndTags(groups);
                    }
                });
                subNav.appendChild(subNavBtn);
            }
        });

        const addSubNavBtn = $el("button", {
            textContent: "+ 新增二级栏目",
            style: { padding: "5px 10px", cursor: "pointer", backgroundColor: ADD_BUTTON_BG, color: ACTIVE_BUTTON_COLOR, border: "none", borderRadius: "3px", margin: "5px 5px 0 0" },
            onclick: () => {
                showInputDialog("新增二级分类", [{ label: "分类名称", placeholder: "请输入分类名...", id: "name" }],
                    (values) => {
                        if (values.name && currentData[activeCategoryIndex]) {
                            const newGroup = { name: values.name, tags: {} };
                            currentData[activeCategoryIndex].groups.push(newGroup);
                            activeGroupIndex = currentData[activeCategoryIndex].groups.length - 1;
                            renderAllButtons();
                            savePromptsToBackend(currentData);
                        }
                    });
            }
        });
        subNav.appendChild(addSubNavBtn);
        
        if (groups.length > 0 && groups[activeGroupIndex]) {
            renderGroupTags([groups[activeGroupIndex]]);
        } else {
            tagArea.innerHTML = "";
        }
    };

    function showImportDialog() {
        const importDialog = $el("div", {
            style: {
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                backgroundColor: "#222", padding: "20px", border: "1px solid #555",
                borderRadius: "8px", zIndex: "1002", width: "400px",
                fontFamily: "sans-serif", color: ACTIVE_BUTTON_COLOR,
            }
        });
        const dialogTitle = $el("h3", { textContent: "批量导入标签", style: { marginTop: "0", marginBottom: "15px", textAlign: "center" } });
        importDialog.appendChild(dialogTitle);
        const categoryLabel = $el("label", { textContent: "选择一级栏目", style: { display: "block", marginBottom: "5px", color: INACTIVE_BUTTON_COLOR } });
        const categorySelect = $el("select", { style: { width: "100%", padding: "5px", backgroundColor: "#333", border: "1px solid #555", color: INACTIVE_BUTTON_COLOR, borderRadius: "3px", marginBottom: "10px" } });
        currentData.forEach((cat, index) => { categorySelect.appendChild($el("option", { value: index, textContent: cat.name })); });
        const groupLabel = $el("label", { textContent: "选择二级栏目", style: { display: "block", marginBottom: "5px", color: INACTIVE_BUTTON_COLOR } });
        const groupSelect = $el("select", { style: { width: "100%", padding: "5px", backgroundColor: "#333", border: "1px solid #555", color: INACTIVE_BUTTON_COLOR, borderRadius: "3px", marginBottom: "10px" } });
        const updateGroupSelect = (catIndex) => {
            groupSelect.innerHTML = "";
            const groups = currentData[catIndex]?.groups || [];
            groups.forEach((group, index) => { groupSelect.appendChild($el("option", { value: index, textContent: group.name })); });
        };
        categorySelect.onchange = (e) => { updateGroupSelect(e.target.value); };
        if (currentData.length > 0) { updateGroupSelect(categorySelect.value); }
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
                    const file = fileInput.files[0], categoryIndex = categorySelect.value, groupIndex = groupSelect.value;
                    if (!file || categoryIndex === "" || groupIndex === "") { alert("请选择一个文件和有效的分类！"); return; }
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const content = e.target.result, lines = content.split('\n'), newTags = {};
                        lines.forEach(line => {
                            const parts = line.trim().split(/[,，]/);
                            if (parts.length === 2) {
                                const [chinese, english] = parts.map(s => s.trim());
                                if (english && chinese) newTags[english] = chinese;
                            }
                        });
                        Object.assign(currentData[categoryIndex].groups[groupIndex].tags, newTags);
                        await savePromptsToBackend(currentData);
                        alert("标签导入成功！");
                        renderAllButtons();
                        importDialog.remove();
                    };
                    reader.readAsText(file, 'UTF-8');
                },
            }),
            $el("button", { textContent: "取消", style: { backgroundColor: INACTIVE_BUTTON_BG, color: INACTIVE_BUTTON_COLOR, padding: "5px 10px", border: "none", borderRadius: "3px", cursor: "pointer" }, onclick: () => importDialog.remove(), }),
        ];
        importDialog.appendChild(categoryLabel); importDialog.appendChild(categorySelect);
        importDialog.appendChild(groupLabel); importDialog.appendChild(groupSelect);
        importDialog.appendChild(createGroupBtn); importDialog.appendChild(fileLabel);
        importDialog.appendChild(fileInput); importDialog.appendChild($el("div", { style: { display: "flex", gap: "10px", marginTop: "15px", justifyContent: "flex-end" } }, buttons));
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
                this.addWidget("button", "打开标签化PromptUI", "open", () => {
                    createPromptModal(this);
                });
            };
        }
    },
});
