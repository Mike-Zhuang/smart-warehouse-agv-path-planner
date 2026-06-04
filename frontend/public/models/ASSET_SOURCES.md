# 3D 模型资源说明

当前 3D 仓库视图默认使用项目内的程序化仓库资产：货架由金属立柱、层板和货箱组合，
障碍物由托盘与箱体组合，AGV 使用叉车式小车模型。这样可以避免第三方模型下载失败
或授权不清导致页面不可用。

目录内仍保留以下轻量 GLB 作为兼容占位资源：

- `agv.glb`：AGV 小车
- `rack.glb`：货架
- `obstacle.glb`：临时障碍物

这些 GLB 只由基础几何体组成，不依赖第三方版权资源，适合课程展示和服务器静态托管。
如需替换为更精细的真实模型，建议选择授权清晰的 CC0 或 CC BY 来源，例如：

- Open Source 3D Assets
- CG3D Public Domain 3D Models
- Quaternius
- Pixabay 3D Models
- Sketchfab 可下载模型

使用 CC BY 模型时，必须在 README、页面说明或本文件中保留作者署名和模型链接。
单个模型建议控制在 1–3MB 内。
