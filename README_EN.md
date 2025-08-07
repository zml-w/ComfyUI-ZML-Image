<div align="center">

\### \[🇨🇳 简体中文](README.md) | \[🇺🇸 English](README\_EN.md)

</div>

## The documentation was translated by AI.

#### I attempted to add English support, but was unsuccessful. Perhaps in the future, as my skills improve, I'll be able to add multi-language support. For now, the node only supports Chinese.

# Version Update Introduction
> Last updated: 2025-08-06 Another huge update!!

> Added a tag-based image loader node. The UI is inspired by weilin. You can batch load images and read their text blocks by clicking a button. Hovering over the button also previews the image!
> 
> Also added a single text block loader node, which is more convenient to use than the load image node!!
>
> Added an audio player node with several built-in audio clips Ciallo～(∠・ω< )⌒☆
> 
> Removed the Lora layer control node.
>
> Optimized some nodes.

<details>

<summary>Click to see more past updates</summary>



> Update date: 2025-08-03

>
> It should now be installable via the Manager, I've fixed the bug!
>
> Added a dual float node.
>
> Added a preset resolution node, similar in function to the preset text node.
>
> Added a dual integer V3 (judgment node). It presets three resolution sizes in the node and then judges the value from the input. If the input width > height, it outputs the first preset resolution. If width < height, it outputs the third preset resolution. If width = height or the difference is within a threshold, it outputs the second resolution. I made this for generating videos, as the V2 version still required manual switching, and I would sometimes forget to adjust it. The V3 version can automatically determine the video resolution, which is much more convenient.
>
> To quickly prepare Lora introductions (log), trigger words (txt), and images, I've created a node to parse Lora metadata. Just load a Lora, and it will automatically download the necessary txt, log, and image files required by the Lora loader, placing them in a 'zml' subfolder within the Lora's directory. Very convenient.
>
> The visual crop node now supports outputting at the original resolution.
>

> **Below are previous node descriptions**
>

> 0. Compared to the official Save Image node, this one adds a text block input. You can input any text prompt, and it will be written to the image's metadata (not the workflow info). The text block requires a specific method to be extracted. It supports custom prefixes/suffixes for filenames, image name counting, and naming based on the current time. It can also scale the image and delete the image's metadata (workflow info), retaining only the text block to significantly reduce disk space usage.
>
> 1. Compared to the official Load Image node, this node only loads a single frame, even from a GIF. It supports outputting images with a transparent channel, reading the image's filename, and reading the text block info saved in the image—yes, the same text block saved by the save node.
>
> 2. The Load Image from Path node supports reading images and corresponding text blocks from a folder. It supports three modes: fixed index, sequential index, and random index (enjoy the gacha!).
>
> 3. The Image/GIF to HTML file node completely conceals the content. You can't see what's inside until you download and open it locally. As for when to use this feature... you know what I mean ;)
>
> 4. Converts NAI weight format to SD weight format. It can also help filter unwanted tags, format punctuation, and custom-delete any characters.
>
> 5. Random Text Line (also supports sequential and indexed loading) and Random Artist (you can customize the number of random artists and the min/max artist weights). It includes a txt file with 1000 artists, and you can add your own.
>
> 6. There are multiple text input and text selection nodes. The text selection node is for pre-writing prompts and then choosing which one to enable, suitable for commonly used prompts.
>
> 7. A node to constrain resolution formats. It can be used to format the resolution for image generation (default is a multiple of '8') or to constrain formats for other specific uses. How you use it is up to you.
>
> 8. You can use a YOLO model to automatically censor/mosaic images, or you can input your own mask to do so.
>
> 9. You can add text watermarks to images. The text automatically wraps when it reaches the image border, and you can also generate a full-screen watermark. Commercial-use fonts are built-in.
>
> 10. You can generate random integers or use preset integers and call them by index, making it simple to generate images at random resolutions or quickly switch between resolutions.
>
> 11. Three new Lora nodes were created based on the lora node (LoRA Loader (pysss)) from ComfyUI-Custom-Scripts. Original node GitHub link: https://github.com/pythongosssss/ComfyUI-Custom-Scripts. Thanks to the original author for their work. To use it, create a 'zml' subfolder in your lora directory. Place image, txt, and log files with the same name as the lora file inside. The node can then read this information. Hovering over a lora in the selection list will show a preview image, and it also categorizes loras by folder. The structure should be: `lora/zml`. For example, for `111.safetensors` in the `lora` folder, you would have `111.png`, `111.txt`, and `111.log` in the `lora/zml` folder. This is a great idea, thanks again to the original author.
>
> 12. Visual Crop Image node: Connect a Load Image node to it, then click the "Crop Image" button to open a UI for manually adjusting the crop area. It supports four cropping modes: rectangle, circle, path selection, and brush (lasso) selection. No more need to open Photoshop!
>
> 13. Crop Solid Color Background node: Automatically removes excess pixels from a solid background. It currently supports white, green, and transparent. The node crops as much unused pixel space as possible to facilitate image stitching. It supports cropping the background into rectangular and irregular shapes.
>
> 14. Add Solid Color Background node: Adds a border to the outside of an image. If the image has a transparent channel, it can detect the subject's outline and add the border based on that outline. Supported border colors are white, black, green, and transparent.
>
> 15. Merge Images node: This is for photoshopping 2-4 images together. Although other nodes do this, I found them not very user-friendly, so I made this one. Like the crop node, you click a button to open a UI to process the image. No need to run the workflow beforehand. Just connect Load Image nodes, click the button to edit, and your changes are saved within the node. Running the workflow will then output the processed image. It can also be used for censoring images.
>
> 16. Painter node: A simple brush to draw freely on an image.
>
> 17. Image Pause node: The node will pause the workflow for 15s, allowing you to choose which of the three output pipes the image should go to. Unselected pipes will only output a placeholder image instead of the input image. My ZML Save Image node is optimized to not save these 1x1 placeholder images, which general save nodes might do.

</details>

## Video Introduction: [Click to Visit](https://www.bilibili.com/video/BV1i4twzDELr/?spm\_id\_from=333.1007.0.0\&vd\_source=0134812498ce59b7f53810ad84889d12)

### I plan to add more tool scripts. As the number of scripts might grow, I decided to create a separate repository for them:

- **https://github.com/zml-w/ZML-Image-Script/tree/main**

#### Most nodes have a "help" output, which contains a detailed introduction to the node. Those that don't are generally simple enough to understand through experimentation.

<details>
<summary>Partial Node Showcase</summary>

> <img width="1632" height="875" alt="1" src="https://github.com/user-attachments/assets/77ccda88-1851-4948-a45b-2f42b46d7f53" />
>
> <img width="1601" height="784" alt="2" src="https://github.com/user-attachments/assets/21f9d0aa-834e-48dd-9384-584e0a215284" />
>
> <img width="1210" height="913" alt="3" src="https://github.com/user-attachments/assets/3359a2fd-a55a-4068-aa25-0338298b7c0b" />
>
> <img width="1698" height="862" alt="4" src="https://github.com/user-attachments/assets/059746d8-31e0-4c97-a620-6e490a6a79b4" />
> 
> <img width="1607" height="755" alt="5" src="https://github.com/user-attachments/assets/8fe91394-8874-4eb4-85dc-d7f8ce6a86da" />
>
> <img width="1719" height="745" alt="6" src="https://github.com/user-attachments/assets/2eee7e21-52a0-4d6a-bd9f-8edd52e84eff" />
>
> <img width="1261" height="762" alt="7" src="https://github.com/user-attachments/assets/a1e67136-0ed7-4664-8f3a-3de69282f71b" />
>
> <img width="982" height="893" alt="8" src="https://github.com/user-attachments/assets/dd905d68-138d-4c30-a0e2-dbdb206c11e9" />
>
> <img width="1254" height="753" alt="9" src="https://github.com/user-attachments/assets/14e6f8df-8b36-4d06-a827-8bbdef1b0e8f" />
>
> <img width="1389" height="683" alt="10" src="https://github.com/user-attachments/assets/0757a6e3-d557-4284-ad56-dcc0e004b41c" />
>
> <img width="1294" height="816" alt="11" src="https://github.com/user-attachments/assets/de9b70a5-03b0-426a-90fc-bf1d8295abf2" />
>
> <img width="1131" height="712" alt="12" src="https://github.com/user-attachments/assets/c0d253aa-96c2-4a9e-b64f-682f3908fa2e" />
>
> <img width="1196" height="639" alt="13" src="https://github.com/user-attachments/assets/c1793444-d44f-47cd-89a4-67c408cde01e" />
>
> <img width="911" height="894" alt="14" src="https://github.com/user-attachments/assets/4f666b73-f968-4182-a327-e29187ddf202" />
>
> <img width="1290" height="760" alt="15" src="https://github.com/user-attachments/assets/5a520228-fe42-49c9-a43d-e545474254f4" />

</details>

## If you have any issues, please submit them

`My younger sister is so cute. Here's a picture of her.`

<img width="1024" height="540" alt="妹相随\_6" src="https://github.com/user-attachments/assets/bc18deae-6c3c-4e70-a642-1b4210accdc3" />
