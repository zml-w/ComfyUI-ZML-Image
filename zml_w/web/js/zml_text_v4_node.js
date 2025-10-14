import { app } from "../../../scripts/app.js";

// 创建辅助函数用于创建DOM元素
function createEl(tag, className = "", properties = {}, text = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.assign(el, properties);
    if (text) el.textContent = text;
    return el;
}

// 全局CSS样式注入 - 只创建一次
let globalStylesInjected = false;
function injectGlobalStyles() {
    if (globalStylesInjected) return;
    
    const style = document.createElement('style');
    style.textContent = `
        /* 按钮基础样式 */
        .zml-v4-button {
            transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
        }
        
        /* 按钮悬停效果 */
        .zml-v4-button:hover:not(:active) {
            background-color: #444 !important;
            border-color: #777 !important;
            color: #ffffff !important;
        }
        
        /* 按钮按下效果 */
        .zml-v4-button:active {
            background-color: #2a2a2a !important;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.5) !important;
            border-color: #555 !important;
        }
        
        /* 选中按钮的按下效果 */
        .zml-v4-button.selected:active {
            background-color: #1b5e20 !important;
            border-color: #4caf50 !important;
        }
        
        /* 输入框样式 */
        .zml-v4-button-edit-input {
            background-color: #2a2a2a;
            border: 1px solid #777;
            border-radius: 2px;
            color: #fff;
            font-size: 12px;
            text-align: center;
            outline: none;
        }
    `;
    document.head.appendChild(style);
    globalStylesInjected = true;
}

// 注册ZML_SelectTextV4节点的前端扩展
app.registerExtension({
    name: "ZML.SelectTextV4",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        // 检查节点类型是否为ZML_SelectTextV4
        if (nodeData.name === "ZML_SelectTextV4") {
            // 注入全局样式
            injectGlobalStyles();
            
            // 保存原始的onNodeCreated方法
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            
            // 重写onNodeCreated方法
            nodeType.prototype.onNodeCreated = function() {
                // 调用原始的onNodeCreated方法
                if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);
                
                // 初始化文本存储数组，用于存储5个按钮的文本内容
                this.textContents = ["", "", "", "", "", ""]; // 索引0未使用，1-5对应按钮1-5
                
                // 初始化按钮标题数组，用于存储5个按钮的自定义标题
                this.buttonTitles = ["", "1", "2", "3", "4", "5"]; // 索引0未使用，1-5对应按钮1-5
                
                // 初始化当前选中的按钮索引
                this.currentButtonIndex = 0;
                
                // 存储按钮元素的引用
                this.buttonElements = [];
                
                // 保存原始文本框的值并隐藏它
                this.hideOriginalTextarea();
                
                // 创建隐藏的文本widget用于保存文本内容（可序列化）
                this.createHiddenTextWidgets();
                
                // 创建自定义的文本框DOM容器
                this.createCustomTextArea();
                
                // 创建自定义的水平排列内容显示区域
                this.createHorizontalContentArea();
                
                // 添加水平排列的按钮组
                this.addHorizontalButtonGroup();
                
                // 尝试从隐藏widget加载已保存的内容
                // 减少延迟时间
                setTimeout(() => {
                    this.loadFromHiddenWidgets();
                    
                    // 如果没有已保存的内容，使用原始文本值初始化
                    if (!this.hasLoadedSavedContent && this.originalTextValue) {
                        this.textContents[1] = this.originalTextValue;
                        this.currentButtonIndex = 1;
                        // 更新内容显示区域
                        this.updateContentDisplay();
                        // 更新按钮选中状态
                        this.updateButtonSelectionState();
                        // 更新自定义文本框
                        if (this.customTextarea) {
                            this.customTextarea.value = this.originalTextValue;
                        }
                        // 更新隐藏widget
                        this.updateHiddenWidgets();
                    }
                }, 10);
            };
            
            // 隐藏原生文本框并保存其值
            nodeType.prototype.hideOriginalTextarea = function() {
                try {
                    const originalTextarea = this.getWidgetByName("文本");
                    if (originalTextarea) {
                        this.originalTextValue = originalTextarea.value || "";
                        // 隐藏原生文本框的父元素
                        if (originalTextarea.parent) {
                            originalTextarea.parent.style.display = "none";
                        }
                    }
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 隐藏原生文本框时出错:", error);
                    }
                }
            };
            
            // 创建自定义文本框
            nodeType.prototype.createCustomTextArea = function() {
                try {
                    // 创建一个容器来放置自定义文本框
                    const container = createEl("div", "zml-v4-textarea-container", {
                        style: `
                            width: 100%;
                            box-sizing: border-box;
                            height: 265px;
                            margin: -210px 0;
                            padding: 0;
                            display: flex;
                            flex-direction: column;
                        `
                    });
                    
                    // 创建自定义文本框
                    this.customTextarea = createEl("textarea", "zml-v4-custom-textarea", {
                        value: this.originalTextValue || "",
                        placeholder: "输入文本",
                        style: `
                            width: 100%;
                            min-height: 100px;
                            height: 100%;
                            flex: 1;
                            padding: 8px;
                            font-size: 13px;
                            font-family: inherit;
                            background-color: #3a3a3a;
                            border: 1px solid #555;
                            border-radius: 4px;
                            color: #ddd;
                            box-sizing: border-box;
                            resize: vertical;
                            outline: none;
                            transition: border-color 0.1s ease;
                        `
                    });
                    
                    // 添加输入事件，同步到文本存储
                    const self = this;
                    this.customTextarea.addEventListener('input', function(e) {
                        const value = e.target.value;
                        // 如果有当前选中的按钮，同步更新
                        if (self.currentButtonIndex > 0 && self.currentButtonIndex <= 5) {
                            self.textContents[self.currentButtonIndex] = value;
                            // 更新内容显示区域
                            self.updateContentDisplay();
                            // 更新隐藏widget，保存到工作流
                            self.updateHiddenWidgets();
                        }
                    });
                    
                    // 添加焦点样式
                    this.customTextarea.addEventListener('focus', function() {
                        this.style.borderColor = "#777";
                        this.style.boxShadow = "0 0 5px rgba(119, 119, 119, 0.3)";
                    });
                    
                    this.customTextarea.addEventListener('blur', function() {
                        this.style.borderColor = "#555";
                        this.style.boxShadow = "none";
                    });
                    
                    container.appendChild(this.customTextarea);
                    
                    // 减少延迟时间，使用0毫秒
                    setTimeout(() => {
                        if (this.widgets) {
                            // 将自定义文本框添加为widget
                            this.addDOMWidget("zml_v4_custom_textarea", "div", container, { 
                                serialize: false,
                                _getPosition: () => {
                                    // 让它出现在节点顶部位置
                                    return { x: 0, y: 0 };
                                }
                            });
                        }
                    }, 0);
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 创建自定义文本框时出错:", error);
                    }
                }
            };
            
            // 创建隐藏的文本widget用于保存文本内容和按钮标题（可序列化）
            nodeType.prototype.createHiddenTextWidgets = function() {
                try {
                    // 创建5个隐藏的文本widget，用于保存每个按钮对应的文本内容
                    for (let i = 1; i <= 5; i++) {
                        // 创建隐藏的widget用于保存文本内容
                        this.addWidget("text", `zml_hidden_text_${i}`, this.textContents[i] || "", (v) => {}, {
                            serialize: true,    // 这是关键，设置为true才能保存到工作流
                            visible: false      // 隐藏widget，不在UI中显示
                        });
                    }
                    
                    // 创建一个隐藏的widget用于保存所有按钮标题和当前选中索引，格式为：
                    // 标题1#-#标题2#-#标题3#-#标题4#-#标题5 |||当前选中索引
                    const defaultTitles = "1#-#2#-#3#-#4#-#5 |||1";
                    this.addWidget("text", "zml_hidden_all_titles", defaultTitles, (v) => {}, {
                        serialize: true,    // 这是关键，设置为true才能保存到工作流
                        visible: false      // 隐藏widget，不在UI中显示
                    });
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 创建隐藏widget时出错:", error);
                    }
                }
            };
            
            // 从隐藏widget加载保存的文本内容和按钮标题
            nodeType.prototype.loadFromHiddenWidgets = function() {
                try {
                    let hasLoadedContent = false;
                    
                    // 加载每个按钮对应的文本内容
                    for (let i = 1; i <= 5; i++) {
                        const widget = this.getWidgetByName(`zml_hidden_text_${i}`);
                        if (widget && widget.value) {
                            this.textContents[i] = widget.value;
                            hasLoadedContent = true;
                        }
                    }
                    
                    // 加载按钮标题和当前选中索引（统一存储在一个widget中）
                    const titlesWidget = this.getWidgetByName("zml_hidden_all_titles");
                    if (titlesWidget && titlesWidget.value) {
                        // 分离标题部分和索引部分
                        const parts = titlesWidget.value.split(" |||");
                        const titlesPart = parts[0] || "";
                        const indexPart = parts[1] || "";
                        
                        // 加载按钮标题（简化版本，直接使用标题值）
                        if (titlesPart) {
                            const buttonTitles = titlesPart.split("#-#");
                            for (let i = 0; i < buttonTitles.length && i < 5; i++) {
                                const index = i + 1; // 索引1-5对应按钮1-5
                                this.buttonTitles[index] = buttonTitles[i].trim() || index.toString();
                                hasLoadedContent = true;
                            }
                            // 更新按钮元素的标题显示
                            for (let i = 1; i <= 5; i++) {
                                if (this.buttonElements[i]) {
                                    this.buttonElements[i].textContent = this.buttonTitles[i] || i.toString();
                                }
                            }
                        }
                        
                        // 加载当前选中的按钮索引
                        if (indexPart) {
                            const savedIndex = parseInt(indexPart, 10);
                            if (!isNaN(savedIndex) && savedIndex >= 1 && savedIndex <= 5) {
                                this.currentButtonIndex = savedIndex;
                                // 更新自定义文本框显示当前选中的内容
                                if (this.customTextarea) {
                                    this.customTextarea.value = this.textContents[savedIndex] || "";
                                }
                                hasLoadedContent = true;
                            }
                        }
                    }
                    
                    // 标记是否已经加载了保存的内容
                    this.hasLoadedSavedContent = hasLoadedContent;
                    
                    // 如果加载了内容，更新显示
                    if (hasLoadedContent) {
                        this.updateContentDisplay();
                        this.updateButtonSelectionState();
                        
                        // 同时更新原始文本框的值
                        const textarea = this.getWidgetByName("文本");
                        if (textarea) {
                            textarea.value = this.textContents[this.currentButtonIndex] || "";
                            if (textarea.inputEl) {
                                textarea.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                                textarea.inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    }
                    
                    return hasLoadedContent;
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 加载保存的内容时出错:", error);
                    }
                    this.hasLoadedSavedContent = false;
                    return false;
                }
            };
            
            // 更新隐藏widget，保存文本内容和按钮标题到工作流
            nodeType.prototype.updateHiddenWidgets = function() {
                try {
                    // 更新每个按钮对应的文本内容widget
                    for (let i = 1; i <= 5; i++) {
                        const widget = this.getWidgetByName(`zml_hidden_text_${i}`);
                        if (widget) {
                            widget.value = this.textContents[i] || "";
                        }
                    }
                    
                    // 将所有按钮标题合并为一个字符串，格式为：标题1#-#标题2#-#标题3#-#标题4#-#标题5 |||当前选中索引
                    const titlesString = [1, 2, 3, 4, 5].map(i => this.buttonTitles[i] || i.toString()).join("#-#");
                    const combinedString = `${titlesString} |||${this.currentButtonIndex}`;
                    const titlesWidget = this.getWidgetByName("zml_hidden_all_titles");
                    if (titlesWidget) {
                        titlesWidget.value = combinedString;
                    }
                    
                    // 同时更新原始文本框的值，保持兼容性
                    const textarea = this.getWidgetByName("文本");
                    if (textarea && this.currentButtonIndex > 0 && this.currentButtonIndex <= 5) {
                        textarea.value = this.textContents[this.currentButtonIndex] || "";
                        if (textarea.inputEl) {
                            textarea.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            textarea.inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    
                    // 确保节点被标记为已修改
                    if (this.setDirty) {
                        this.setDirty(true);
                    }
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 更新隐藏widget时出错:", error);
                    }
                }
            };
            
            // 获取文本框小部件
            nodeType.prototype.getWidgetByName = function(name) {
                if (!this.widgets) return null;
                return this.widgets.find(w => w.name === name) || null;
            };
            
            // 创建水平排列的内容显示区域
            nodeType.prototype.createHorizontalContentArea = function() {
                try {
                    // 创建一个容器来水平放置所有内容字段
                    const container = createEl("div", "zml-v4-content-container", {
                        style: `
                            display: flex;
                            gap: 3px;
                            padding: 4px;
                            margin: 2px 0;
                            width: 100%;
                            box-sizing: border-box;
                            border: 1px solid #555;
                            border-radius: 4px;
                            background-color: #2a2a2a;
                        `
                    });
                    
                    // 为每个按钮创建一个小型的文本输入框，水平排列
                    this.contentInputs = {};
                    const self = this;
                    for (let i = 1; i <= 5; i++) {
                        // 小型输入框（无标签）
                        const input = createEl("input", `zml-v4-content-input zml-v4-content-input-${i}`, {
                            type: "text",
                            value: this.textContents[i] || "",
                            style: `
                                width: calc(20% - 2px);
                                padding: 1px 3px;
                                font-size: 10px;
                                background-color: #3a3a3a;
                                border: 1px solid #555;
                                border-radius: 2px;
                                color: #ddd;
                                box-sizing: border-box;
                                height: 24px;
                                min-width: 0;
                                flex: 1;
                            `
                        });
                        
                        // 添加输入事件，同步到文本存储
                        const buttonIndex = i;
                        input.oninput = function(e) {
                            self.textContents[buttonIndex] = e.target.value;
                            // 如果当前选中的是这个按钮，也同步到主文本框
                            if (self.currentButtonIndex === buttonIndex) {
                                const textarea = self.getWidgetByName("文本");
                                if (textarea) {
                                    textarea.value = e.target.value;
                                    if (textarea.inputEl) {
                                        textarea.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                                    }
                                }
                            }
                            // 更新隐藏widget，保存到工作流
                            self.updateHiddenWidgets();
                        };
                        
                        this.contentInputs[buttonIndex] = input;
                        container.appendChild(input);
                    }
                    
                    // 减少延迟时间，使用0毫秒
                    setTimeout(() => {
                        if (this.widgets) {
                            // 将内容区域添加为widget
                            this.addDOMWidget("zml_v4_contents", "div", container, { 
                                serialize: false,
                                _getPosition: () => {
                                    // 让它出现在主文本框之后
                                    const textareaWidget = this.getWidgetByName("文本");
                                    if (textareaWidget && textareaWidget.parent) {
                                        // 获取文本框的位置并放在它下面
                                        const rect = textareaWidget.parent.getBoundingClientRect();
                                        return { x: 0, y: rect.bottom + 10 };
                                    }
                                    return { x: 0, y: 0 };
                                }
                            });
                        }
                    }, 0);
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 创建水平内容区域时出错:", error);
                    }
                }
            };
            
            // 更新内容显示区域
            nodeType.prototype.updateContentDisplay = function() {
                for (let i = 1; i <= 5; i++) {
                    if (this.contentInputs[i]) {
                        this.contentInputs[i].value = this.textContents[i] || "";
                    }
                }
            };
            
            // 更新按钮选中状态 - 优化版本
            nodeType.prototype.updateButtonSelectionState = function() {
                for (let i = 1; i <= 5; i++) {
                    const button = this.buttonElements[i];
                    if (button) {
                        if (i === this.currentButtonIndex) {
                            // 明显的选中状态样式，但简化动画
                            button.style.backgroundColor = "#2e7d32";
                            button.style.borderColor = "#66bb6a";
                            button.style.borderWidth = "2px";
                            button.style.fontWeight = "bold";
                            button.style.color = "#ffffff";
                            button.style.boxShadow = "0 0 6px rgba(76, 175, 80, 0.4)";
                            button.classList.add("selected");
                        } else {
                            // 未选中状态样式
                            button.style.backgroundColor = "#3a3a3a";
                            button.style.borderColor = "#666";
                            button.style.borderWidth = "1px";
                            button.style.fontWeight = "500";
                            button.style.color = "#d0d0d0";
                            button.style.boxShadow = "none";
                            button.classList.remove("selected");
                        }
                    }
                }
            };
            
            // 添加水平按钮组方法 - 优化版本
            nodeType.prototype.addHorizontalButtonGroup = function() {
                try {
                    // 创建一个容器来放置按钮，添加统一的外边框
                    const container = createEl("div", "zml-v4-button-container", {
                        style: `
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            gap: 2px;
                            padding: 2px;
                            margin: 0;
                            width: 100%;
                            box-sizing: border-box;
                            border: 1px solid #555;
                            border-radius: 4px;
                        `
                    });
                    
                    // 创建从1到5的五个按钮并水平排列，每个按钮都有自己的边框
                    const self = this;
                    for (let i = 1; i <= 5; i++) {
                        // 创建样式类，使用CSS动画
                        const button = createEl("button", `zml-v4-button zml-v4-button-${i}`, {
                            textContent: this.buttonTitles[i] || i.toString(),
                            style: `
                                padding: 0 12px;
                                height: 28px;
                                border-radius: 3px;
                                border: 1px solid #666;
                                background-color: #3a3a3a;
                                color: #d0d0d0;
                                font-size: 14px;
                                font-weight: 500;
                                cursor: pointer;
                                margin: 0;
                                width: calc(100% / 5);
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                user-select: none;
                                outline: none;
                            `,
                            title: `双击编辑按钮标题，点击切换内容`
                        });
                        
                        // 添加双击编辑功能
                        const buttonIndex = i;
                        button.ondblclick = function(e) {
                            e.stopPropagation();
                            
                            // 保存原始标题
                            const originalTitle = this.textContent;
                            
                            // 创建输入框
                            const input = createEl("input", "zml-v4-button-edit-input", {
                                type: "text",
                                value: originalTitle,
                                style: `width: 80%; height: 80%; padding: 2px 4px;`
                            });
                            
                            // 清空按钮内容并添加输入框
                            this.innerHTML = "";
                            this.appendChild(input);
                            
                            // 聚焦输入框
                            input.focus();
                            input.select();
                            
                            // 失去焦点时保存
                            const saveTitle = function() {
                                const newTitle = input.value.trim() || originalTitle;
                                button.textContent = newTitle;
                                // 保存到标题数组
                                self.buttonTitles[buttonIndex] = newTitle;
                                // 更新隐藏widget，保存到工作流
                                self.updateHiddenWidgets();
                                // 如果按钮被选中，更新选中状态样式
                                if (buttonIndex === self.currentButtonIndex) {
                                    self.updateButtonSelectionState();
                                }
                            };
                            
                            // 监听失去焦点事件
                            input.onblur = saveTitle;
                            
                            // 监听回车键保存
                            input.onkeydown = function(e) {
                                if (e.key === 'Enter') {
                                    input.blur();
                                } else if (e.key === 'Escape') {
                                    button.textContent = originalTitle;
                                    if (buttonIndex === self.currentButtonIndex) {
                                        self.updateButtonSelectionState();
                                    }
                                }
                            };
                        };
                        
                        // 存储按钮引用
                        this.buttonElements[i] = button;
                        
                        // 添加按钮点击事件
                        button.onclick = function() {
                            self.switchTextContent(buttonIndex);
                        };
                        
                        // 添加按钮到容器
                        container.appendChild(button);
                    }
                    
                    // 减少延迟时间，使用0毫秒
                    setTimeout(() => {
                        // 确保按钮组添加到节点的最底部
                        if (this.widgets) {
                            // 将按钮组添加为最后一个widget，确保它位于节点底部
                            this.addDOMWidget("zml_v4_buttons", "div", container, { 
                                serialize: false,
                                // 确保小部件位于底部
                                _getPosition: () => {
                                    // 这会使按钮组出现在所有其他小部件之后
                                    return { x: 0, y: Infinity };
                                }
                            });
                            
                            // 强制重新布局节点
                            if (this.setDirty) {
                                this.setDirty(false);
                            }
                        }
                    }, 0);
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 添加水平按钮组时出错:", error);
                    }
                }
            };
            
            // 切换文本内容的方法 - 优化版本
            nodeType.prototype.switchTextContent = function(buttonIndex) {
                try {
                    // 保存当前文本到之前选中的按钮（如果有）
                    if (this.currentButtonIndex > 0 && this.currentButtonIndex <= 5) {
                        if (this.customTextarea) {
                            this.textContents[this.currentButtonIndex] = this.customTextarea.value;
                        }
                    }
                    
                    // 更新当前选中的按钮索引
                    this.currentButtonIndex = buttonIndex;
                    
                    // 从新选中的按钮加载文本
                    const newText = this.textContents[buttonIndex] || "";
                    
                    // 更新自定义文本框
                    if (this.customTextarea) {
                        this.customTextarea.value = newText;
                    }
                    
                    // 同时更新原文本框（保持兼容性）
                    const textarea = this.getWidgetByName("文本");
                    if (textarea) {
                        textarea.value = newText;
                        if (textarea.inputEl) {
                            textarea.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            textarea.inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    
                    // 批量更新UI以减少重绘
                    requestAnimationFrame(() => {
                        this.updateContentDisplay();
                        this.updateButtonSelectionState();
                    });
                    
                    // 更新隐藏widget，保存到工作流
                    this.updateHiddenWidgets();
                    
                    // 确保节点被标记为已修改
                    if (this.setDirty) {
                        this.setDirty(true);
                    }
                } catch (error) {
                    // 仅在开发环境显示错误
                    if (process.env.NODE_ENV !== 'production') {
                        console.error("ZML_SelectTextV4: 切换文本内容时出错:", error);
                    }
                }
            };
        }
    }
});