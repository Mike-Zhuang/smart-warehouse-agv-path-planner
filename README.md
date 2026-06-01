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

## 当前进度

- 已完成：地图校验、通行规则、字符地图、JSON 协议、命令行入口和核心算法测试。
- 已完成：单车 A*、Dijkstra、往返路径拼接、CBS 多车协同规划。
- 后续增强：FastAPI 接口、Web 前端、路径动画和服务器部署。

设计记录见 [docs/decision-log.md](docs/decision-log.md)。
核心算法说明见 [docs/core-algorithms.md](docs/core-algorithms.md)。
