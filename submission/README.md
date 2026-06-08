# 智能仓储机器人路径规划系统

本目录包含程序源代码、示例地图、前端资源和一个已编译的 C++ 核心执行文件。

## 需要安装的环境

- CMake 3.16 或更高版本
- 支持 C++17 的编译器
- nlohmann_json
- Python 3.10 或更高版本
- Node.js 18 或更高版本

## 安装依赖并构建核心程序

在本目录下执行：

```bash
python -m venv .venv
```

激活 Python 虚拟环境：

```bash
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate
```

安装后端和前端依赖：

```bash
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

构建 C++ 核心程序：

```bash
cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build
```

如果 Windows 使用 vcpkg 安装 `nlohmann_json`，构建命令改为：

```bash
cmake -S cpp_core -B cpp_core/build -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build cpp_core/build --config Release
```

## 启动图形界面

打开第一个终端，启动后端：

```bash
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

打开第二个终端，启动前端：

```bash
npm --prefix frontend run dev
```

然后在浏览器打开：

```text
http://127.0.0.1:5173
```

## 本地构建前端

如需生成前端静态文件，执行：

```bash
npm --prefix frontend run build
```

构建结果会生成在：

```text
frontend/dist/
```
