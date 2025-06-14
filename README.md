最新更新日期：2025.06.14

文本转格式节点支持转换[]的权重了，支持格式化断开语法‘BREAK’。

新加入两个多框输文本入的节点，一个三个框，一个五个框，内置格式化标点符号，支持自定义分隔符。

——————————————

这是一个帮助管理图像的自定义节点，还有许多和文本相关的节点。

相信很多朋友在使用ComfyUI时都遇到过这样的情况：当你想保存这次跑的图和tag时，选择只有txt和xlsx表格（和其它的一些……，我自己之前用的是OneNote），txt无法保存图像就导致了不够直观，xlsx表格用起来又有些繁琐。想要找个好用的软件来管理，但是发现市面上专门用来管理图像和tag的软件大多都是付费闭源的，所以我开发了这个节点，它能让你：

1、直接通过系统自带的文件管理器管理图像，无需购买软件授权。

2、将文本写入到图像里，需要特定节点来提取，在外面完全看不出来区别，让图片在文件夹里更干净简洁。

3、支持从文件夹中抽取图像和对应tag（抽卡抽到爽！）。

4、我还开发了一个将图片/GIF转为HTML文件的节点，在外面完全看不出来这个文件里是什么，必须下载后在本地打开才会显示图像/GIF里的内容，至于这个功能主要在什么时候使用...你知道的_

5、支持将NAI权重格式转化为SD权重格式，还可以帮助过滤不想要的tag。

这里有我收集的图像，因为数量太多且占用太大，GitHub不让我上传，所以只能用网盘了：https://pan.baidu.com/s/10zwlixAx-chvd5Et9PaV4Q?pwd=4xrd

看图片可以更直观的感受到节点的功能：
![1](https://github.com/user-attachments/assets/4c816ed2-917d-4504-8bb4-8ff2237bee73)
![2](https://github.com/user-attachments/assets/7e7af3e0-3360-4dd4-ba98-fee6249faac2)
![3](https://github.com/user-attachments/assets/a8e68685-9b28-4491-94d9-5baad1330005)
![4](https://github.com/user-attachments/assets/a04a65dc-1ad0-46bb-972c-4d4a1c38cb27)
![5](https://github.com/user-attachments/assets/0f3269dd-e335-4ff5-a7e2-ccbb81cecc89)
![6](https://github.com/user-attachments/assets/06169f53-ed28-46b0-8b85-7f45083903cc)
![7](https://github.com/user-attachments/assets/615185f6-8f31-45ba-b9d9-5a5cf2d524af)
![8](https://github.com/user-attachments/assets/d30526fc-fdb8-4075-9c58-b1acf8c02b4b)
![9](https://github.com/user-attachments/assets/19937b35-6f7b-4448-858c-02967a902f17)
