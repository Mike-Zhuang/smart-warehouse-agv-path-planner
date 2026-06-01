#!/usr/bin/env bash
set -euo pipefail

cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build
ctest --test-dir cpp_core/build --output-on-failure
python3 -m unittest discover -s backend/tests -t . -v
npm --prefix frontend run test
npm --prefix frontend run build

