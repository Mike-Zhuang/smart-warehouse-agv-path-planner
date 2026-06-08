#pragma once

#include "ConflictBasedSearch.hpp"
#include "GridMap.hpp"
#include "PathResult.hpp"
#include "SearchPlanner.hpp"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

struct PlannerRequest {
    std::string mode = "single";
    std::string algorithm = "astar";
    bool round_trip = true;
    SearchOptions options;
    MultiRobotOptions multi_robot_options;
    std::vector<std::vector<int>> grid;
    std::vector<RobotTask> robots;
};

class JsonAdapter {
public:
    static PlannerRequest parseRequest(const nlohmann::json& input);
    static nlohmann::json toJson(const PathResult& result);
    static nlohmann::json toJson(const RoundTripResult& result);
    static nlohmann::json toJson(const MultiRobotResult& result);
    static nlohmann::json error(const std::string& message);
};
