# 智能仓储机器人路径规划系统

本项目使用 C++17 实现智能仓储机器人的路径规划核心。当前工程已经完成地图建模、
JSON 输入解析、字符地图输出、单车 A*、Dijkstra、往返路径规划和多车 CBS 协同规划。

## 构建

```bash
cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build
```

## 测试

```bash
ctest --test-dir cpp_core/build --output-on-failure
```

## 运行

```bash
./cpp_core/build/agv-path-planner < cpp_core/data/sample-map.json
```

标准输出只包含 JSON，字符地图输出到标准错误流。这样后续 FastAPI 可以直接解析
程序结果，而不需要清洗控制台文本。

## Web 前端

首次运行先安装前端依赖：

```bash
npm --prefix frontend install
```

启动本地接口和网页：

```bash
./scripts/dev.sh
```

浏览器打开：

```text
http://127.0.0.1:5173
```

网页支持地图编辑、数字与图标切换、JSON 导入导出、单车算法对比、搜索动画和 CBS
多车协同轨迹动画。页面默认加载符合原题要求的 `20 × 15` 仓库地图，路径使用 SVG
八方向箭头展示。地图工具可以开启曼哈顿距离热力层，地图顶部可以切换箭头、曲线和
组合路径样式。右侧“算法观察”面板会展示 A* 的 `g`、`h` 和 `f = g + h`。

CBS 多车模式可以按下面的顺序体验：

1. 点击左侧的 `CBS 多车`，再点击 `一键加载交叉口示例`。
2. 直接运行规划，观察带有 AGV 编号和方向箭头的同步轨迹。
3. 自定义任务时，先选中一辆 AGV 并点击地图设置起点；页面会自动切换到目标点设置。
4. 地图上的 `S1 / T1` 表示第 1 辆 AGV 的起点和目标点，其他编号以此类推。
5. 每辆 AGV 使用独立色系，浅色表示去程，深色表示返程。
6. 需要调整多车地图时，切换到“编辑仓库底图”，再使用画笔绘制货架或临时障碍。

## 完整验收

```bash
./scripts/check.sh
```

该脚本会依次运行 C++ 测试、后端测试、前端测试和生产构建。

## 当前进度

- 已完成：地图校验、通行规则、字符地图、JSON 协议、命令行入口和核心算法测试。
- 已完成：单车 A*、Dijkstra、往返路径拼接、CBS 多车协同规划。
- 已完成：FastAPI 接口、Web 前端、路径动画和服务器部署脚本。

## 服务器部署

生产环境使用 Nginx 托管前端静态文件，并将 `/api` 反向代理到仅监听本机的 FastAPI
服务 `127.0.0.1:18080`。服务器部署脚本位于：

```bash
./deploy/sync-deploy.sh
```

脚本会通过 GitHub 代理拉取 `main` 分支、构建 C++ 核心、运行核心测试、构建前端、
同步静态文件并重启 systemd 服务。正式服务器可以使用宝塔计划任务每 10 分钟执行一次。

设计记录见 [docs/decision-log.md](docs/decision-log.md)。
核心算法说明见 [docs/core-algorithms.md](docs/core-algorithms.md)。
