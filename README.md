<div align="center">

# 🎨 ComfyUI-ZML-Image 修改版 ✨

![Version](https://img.shields.io/badge/Version-Modified-brightgreen?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Active-blue?style=for-the-badge)
![Sync](https://img.shields.io/badge/Sync-Weekly-orange?style=for-the-badge)

### 💫 **这是关于ComfyUI-ZML-Image的修改版，会实时和原版进行同步更新** 💫

### 🚀 **本修改版主要是添加了一点原版目前没有的功能和更改了读取文件的方式** 🚀

</div>

---

## 📢 **更新公告**

> 🔄 **修改版将会随着安大的更新而更新（最多延迟一周吧）** 😘💕

---

## 🎵 **版本对比信息**

> 🆕 **对比zml原版修改的信息（最新更新时间2025/10/7）** 🎶

---

## 🗓️ **更新日志**

<div align="center">

![Update](https://img.shields.io/badge/📅_Latest_Update-2025/10/7-red?style=for-the-badge&logo=calendar)

</div>

<details>
<summary>🎯 <strong>点击查看详细修改内容</strong> 📋</summary>

<br>

### 🔧 **一. 修改了官网介绍信息和本地文件读取的逻辑**

#### 📄 **1. 官网介绍信息会保存为json（而非原版的log）**

> 💡 这样下载的内容就不会有格式码，修改版和原版对比

<div align="center">

<img width="2402" height="960" alt="Image" src="https://github.com/user-attachments/assets/46c863c2-3786-4884-a61f-10d3019912b7" />

</div>

#### 📁 **2. 本地文件读取逻辑**

> 🎯 修改版将会将下载内容直接下到和lora的同层级中而非像原版一样下载到zml的子目录文件夹，修改版和原版对比

<div align="center">

<img width="1897" height="488" alt="Image" src="https://github.com/user-attachments/assets/d9e0d498-f738-4a60-b147-5c9351a67ad4" />

</div>

### ✨ **二. 新增内容（批量添加lora也适用）**

#### ⚡ **1. 当选择lora时可以自动将默认权重写入权重栏**

> 🚀 如下图所示：

<div align="center">

<img width="1688" height="980" alt="Image" src="https://github.com/user-attachments/assets/50883ef4-d2dc-40a3-884e-50526369c0c1" />

<img width="1069" height="743" alt="Image" src="https://github.com/user-attachments/assets/7ec2274a-c643-4df4-b447-e17b2c4119d2" />

</div>

#### 🕷️ **2. 新增爬取默认权重信息**

![](Aspose.Words.7ca0cfb7-a3dd-4791-abd5-9b9c9020d3c3.005.png)![](Aspose.Words.7ca0cfb7-a3dd-4791-abd5-9b9c9020d3c3.006.png)

> 📊 可以直接爬取作者的默认lora信息，并保存为.log文件，之后也可以自己修改默认的权重值如下图：

<div align="center">

<img width="805" height="432" alt="Image" src="https://github.com/user-attachments/assets/966021a8-e26d-4408-9682-9c1cc74b0fc0" />

</div>

> ✅ 修改后，下次选择添加的lora一样可以读取这个权重值

<div align="center">

<img width="1147" height="929" alt="Image" src="https://github.com/user-attachments/assets/64bb82bf-063a-4788-9db5-4248b6f391b2" />

</div>

### 💪 **三. 关于强力lora加载器的修改**

#### ✏️ **1. 增加了lora编辑按钮**

<div align="center">

<img width="1013" height="661" alt="Image" src="https://github.com/user-attachments/assets/65e0f9fa-1e1c-48a2-9989-9a1efe4a7edf" />

</div>

> 🎨 可以直接一键编辑lora的信息，并且支持判定有无缩略图，如果没有缩略图则可以触发下载窗口如下：

<div align="center">

<img width="1440" height="820" alt="Image" src="https://github.com/user-attachments/assets/763a2cfd-d2f4-442c-9894-35ad6ef3129b" />

</div>

> ⏳ 点击爬取信息后，🖊会变成**"…"**表示正在爬取信息，爬取成功后会提示，如下图：

<div align="center">

<img width="1333" height="936" alt="Image" src="https://github.com/user-attachments/assets/503e40de-9eb8-41a9-80e6-90405a3be56e" />

</div>

> 🔄 当需要重新下载信息时，只需要删除本地下载的缩略图并重新选择这个lora便能重新触发下载提示框进行下载

</details>

---

## 🛠️ **安装指南**

<div align="center">

![Install](https://img.shields.io/badge/🚀_Easy_Install-3_Steps-success?style=for-the-badge&logo=download)

</div>

> 😎 **如何安装本修改版？**

<details>
<summary>📦 <strong>点击查看安装步骤</strong> 🔧</summary>

<br>

### 🎯 **安装方法**

#### 📥 **1. 下载zip文件**

<div align="center">

<img width="818" height="626" alt="Image" src="https://github.com/user-attachments/assets/265a2768-28d8-42ed-9472-35981963af7e" />

</div>

#### 📂 **2. 解压缩并复制文件**

> 💾 将下载的内容解压缩，然后将文件夹里面的内容全部复制，然后再粘贴到下面的地址：

<div align="center">

<img width="2679" height="828" alt="Image" src="https://github.com/user-attachments/assets/e9aa6aa7-d22e-458f-b849-36f3b9aae57f" />

</div>

> 💡 也可以直接将解压缩的文件夹复制到nede文件当做新的节点组使用（反正没改的部分都是和安大原版是同步的）

#### ⚡ **3. 使用批量下载工具**

> 🔧 打开修改版批量下载工具，选择下载要下载的lora文件（支持下载所有子目录，所以如果要全部直接下载的话请选择lora文件夹即可），然后点击扫描文件，然后选择要下载的选项，最后点击下载即可，下载日志会持续更新下载信息。

<div align="center">

<img width="2539" height="1099" alt="Image" src="https://github.com/user-attachments/assets/d21bdb0b-21c4-4575-a2c0-6328678ac99e" />

<img width="2531" height="1091" alt="Image" src="https://github.com/user-attachments/assets/b00bdce3-7553-486a-bf36-7b525769f0d1" />

</div>

</details>

---

<div align="center">

## 🎉 **总结**

> ✨ **综上便是修改版的内容** ✨

![Thank You](https://img.shields.io/badge/Thank_You-For_Using-pink?style=for-the-badge&logo=heart)

</div>
