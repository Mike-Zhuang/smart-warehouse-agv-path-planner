# 智能仓储机器人路径规划系统

本目录是课程作业提交包，包含程序源代码和本地复现所需的配套文件。

## 目录说明

```text
cpp_core/   C++17 核心算法，包含 A*、Dijkstra、CBS 和示例地图
backend/    FastAPI 接口层，负责调用 C++ 可执行文件
frontend/   React + TypeScript 前端界面，包含 2D / 3D 可视化
scripts/    本地检查和启动脚本
bin/        已编译的 C++ 核心可执行文件
```

## 环境要求

- CMake 3.16 或更高版本
- 支持 C++17 的编译器
- nlohmann_json
- Python 3.10 或更高版本
- Node.js 18 或更高版本

macOS 可使用下面命令安装主要依赖：

```bash
brew install cmake nlohmann-json node
```

## 完整复现步骤

在本目录下执行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
npm --prefix frontend ci
./scripts/check.sh
```

如果 `pip install` 因本机证书配置报错，可以改用：

```bash
python3 -m pip install --index-url https://pypi.org/simple --trusted-host pypi.org --trusted-host files.pythonhosted.org -r backend/requirements.txt
```

`scripts/check.sh` 会依次完成：

```text
1. 构建 C++ 核心程序
2. 运行 C++ 单元测试
3. 运行后端接口测试
4. 运行前端测试
5. 构建前端页面
```

## 单独运行 C++ 核心

本提交包已提供 macOS ARM64 可执行文件：

```bash
./bin/macos-arm64/agv-path-planner < cpp_core/data/sample-map.json
```

如果当前系统无法运行该文件，可以重新构建：

```bash
cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build
./cpp_core/build/agv-path-planner < cpp_core/data/sample-map.json
```

标准输出为 JSON 结果，字符地图输出到标准错误流。

## 启动图形界面

先安装依赖并构建 C++ 核心：

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
npm --prefix frontend ci
cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build
```

然后启动本地服务：

```bash
./scripts/dev.sh
```

浏览器打开：

```text
http://127.0.0.1:5173
```

## 清理临时文件

测试或运行后会生成构建目录和依赖目录，如需恢复为干净源码包，可删除：

```bash
rm -rf .venv cpp_core/build frontend/node_modules frontend/dist
find . -name "__pycache__" -type d -prune -exec rm -rf {} +
find . -name "*.tsbuildinfo" -delete
```
