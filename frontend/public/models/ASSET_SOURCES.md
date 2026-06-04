# 3D 模型资源说明

当前 3D 仓库视图使用项目内生成的低多边形 GLB 占位模型：

- `agv.glb`：AGV 小车
- `rack.glb`：货架
- `obstacle.glb`：临时障碍物

这些模型只由基础几何体组成，不依赖第三方版权资源，适合课程展示和服务器静态托管。
如需替换为更精细的模型，建议优先选择授权清晰的 CC0 / 可商用来源，例如：

- Open Source 3D Assets
- CG3D Public Domain 3D Models
- Quaternius
- Pixabay 3D Models

替换时保持文件名不变即可复用现有前端加载逻辑。单个模型建议控制在 1–2MB 内。
