import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/**
 * 创建并显示一个用于添加预设的弹窗
 * @param {object} node - LiteGraph节点实例
 */
function createPresetDialog(node) {
    // 如果已存在一个弹窗，则先移除
    const existingDialog = document.querySelector(".zml-preset-dialog");
    if (existingDialog) {
        existingDialog.remove();
    }

    const dialog = document.createElement("div");
    dialog.className = "zml-preset-dialog";

    dialog.innerHTML = `
        <div class="zml-dialog-content">
            <h2>添加新的预设</h2>
            <div class="zml-form-row">
                <label for="zml-preset-name">名称 (下拉菜单显示的文字):</label>
                <input type="text" id="zml-preset-name" name="zml-preset-name">
            </div>
            <div class="zml-form-row">
                <label for="zml-preset-value">内容 (选择后实际输出的文本):</label>
                <textarea id="zml-preset-value" name="zml-preset-value" rows="5"></textarea>
            </div>
            <div class="zml-form-row">
                <label for="zml-preset-separator">分隔符:</label>
                <input type="text" id="zml-preset-separator" name="zml-preset-separator" value="#-#">
            </div>
            <div class="zml-dialog-footer">
                <span class="zml-dialog-notice">暂时只能通过刷新浏览器页面来更新节点</span>
                <div class="zml-dialog-buttons">
                    <button id="zml-save-preset">保存</button>
                    <button id="zml-cancel-preset">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    const saveButton = dialog.querySelector("#zml-save-preset");
    const cancelButton = dialog.querySelector("#zml-cancel-preset");
    const nameInput = dialog.querySelector("#zml-preset-name");
    const valueInput = dialog.querySelector("#zml-preset-value");
    const separatorInput = dialog.querySelector("#zml-preset-separator");

    // "保存"按钮的点击事件
    saveButton.onclick = async () => {
        const name = nameInput.value.trim();
        const value = valueInput.value.trim();
        const separator = separatorInput.value;

        if (!name || !value || !separator) {
            alert("名称、内容和分隔符均不能为空！");
            return;
        }

        try {
            const response = await api.fetchApi("/zml/add_preset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, value, separator }),
            });

            if (response.status === 200) {
                dialog.remove();
            } else {
                alert(`保存失败: ${await response.text()}`);
            }
        } catch (error) {
            alert(`发生错误: ${error}`);
            console.error("ZML Preset Save Error:", error);
        }
    };

    cancelButton.onclick = () => {
        dialog.remove();
    };
}

// 注册ComfyUI扩展
app.registerExtension({
    name: "ZML.PresetEditor",
    async setup(app) {

        const style = document.createElement('style');
        style.textContent = `
            .zml-preset-dialog {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                display: flex; align-items: center; justify-content: center; z-index: 1001;
            }
            .zml-dialog-content {
                background: #282828; padding: 25px; border-radius: 8px; width: 450px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.5); color: #e0e0e0; border: 1px solid #444;
            }
            .zml-dialog-content h2 { margin-top: 0; margin-bottom: 20px; text-align: center; }
            .zml-form-row { margin-bottom: 15px; }
            .zml-form-row label { display: block; margin-bottom: 5px; font-size: 14px; }
            .zml-form-row input, .zml-form-row textarea {
                width: 100%; box-sizing: border-box; background: #1e1e1e; color: #e0e0e0;
                border: 1px solid #555; border-radius: 4px; padding: 10px; font-size: 14px;
            }
            .zml-dialog-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 25px;
            }
            .zml-dialog-notice {
                font-size: 12px;
                color: #999;
                flex-grow: 1;
            }
            .zml-dialog-buttons button {
                margin-left: 10px; padding: 10px 18px; border-radius: 5px; border: none;
                cursor: pointer; font-weight: bold;
            }
            #zml-save-preset { background-color: #4CAF50; color: white; }
            #zml-cancel-preset { background-color: #555; color: white; }
        `;
        document.head.appendChild(style);
        
    },

    nodeCreated(node) {
        if (node.comfyClass === "ZML_PresetText") {

            node.addWidget( "button", "添加预设", null, () => createPresetDialog(node) );
            
        }
    }
});