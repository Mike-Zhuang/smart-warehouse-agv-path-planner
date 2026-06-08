# 智能仓储机器人路径规划系统

本目录包含源代码、示例地图、前端资源和一个已编译的 C++ 核心执行文件。

## 环境准备

建议使用：

- Python 3.12 64-bit
- Node.js 18 LTS 或 20 LTS
- CMake 3.16+
- Visual Studio 2022 C++ 构建工具
- vcpkg 安装 `nlohmann_json`

如果没有 `npm`，安装 Node.js LTS：

```text
https://nodejs.org/
```

Windows 安装 `nlohmann_json`：

```powershell
cd C:\
git clone https://github.com/microsoft/vcpkg
cd C:\vcpkg
.\bootstrap-vcpkg.bat
.\vcpkg install nlohmann-json:x64-windows
```

## 安装依赖

在本目录下执行：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

macOS / Linux 激活虚拟环境使用：

```bash
source .venv/bin/activate
```

## 构建 C++ 核心

Windows 使用 vcpkg 时执行：

```powershell
cmake -S cpp_core -B cpp_core/build -A x64 -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows
cmake --build cpp_core/build --config Release
```

其他环境可以直接执行：

```bash
cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build
```

## 启动图形界面

第一个终端启动后端：

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

第二个终端启动前端：

```powershell
npm --prefix frontend run dev
```

浏览器打开：

```text
http://127.0.0.1:5173
```

## 构建前端

```powershell
npm --prefix frontend run build
```
