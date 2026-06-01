#pragma once

#include "GridMap.hpp"
#include "PathResult.hpp"
#include "SearchPlanner.hpp"

#include <optional>
#include <string>
#include <vector>

struct RobotTask {
    std::string id;
    Point start;
    Point target;
    bool round_trip = true;
};

struct RobotPath {
    std::string id;
    std::vector<Point> timeline;
    int path_cost = 0;
    std::optional<int> return_start_time_step;
};

struct MultiRobotResult {
    bool success = false;
    std::string message;
    std::vector<RobotPath> robots;
    int total_cost = 0;
    int resolved_conflict_count = 0;
};

struct MultiRobotOptions {
    static constexpr int HARD_MAX_ROBOTS = 16;
    static constexpr int HARD_MAX_HIGH_LEVEL_NODES = 100000;
    static constexpr int HARD_MAX_TIME_STEPS = 2000;

    int max_robots = 8;
    int max_high_level_nodes = 10000;
    int max_time_steps = 300;
};

class ConflictBasedSearch {
public:
    explicit ConflictBasedSearch(const GridMap& grid_map);

    MultiRobotResult plan(const std::vector<RobotTask>& tasks,
                          const SearchOptions& search_options = {},
                          const MultiRobotOptions& multi_robot_options = {}) const;

private:
    const GridMap& grid_map_;
};
