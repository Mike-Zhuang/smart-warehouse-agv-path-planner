cmake_minimum_required(VERSION 3.20)

project(agv_path_planner LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(nlohmann_json CONFIG REQUIRED)

add_library(agv_core
    src/GridMap.cpp
    src/SearchPlanner.cpp
    src/ConflictBasedSearch.cpp
    src/JsonAdapter.cpp
)

target_include_directories(agv_core PUBLIC include)
target_link_libraries(agv_core PUBLIC nlohmann_json::nlohmann_json)

add_executable(agv-path-planner src/main.cpp)
target_link_libraries(agv-path-planner PRIVATE agv_core)

enable_testing()

add_executable(core-tests tests/core-tests.cpp)
target_link_libraries(core-tests PRIVATE agv_core)

add_test(NAME core-tests COMMAND core-tests)
