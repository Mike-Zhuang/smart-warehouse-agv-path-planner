#include "JsonAdapter.hpp"

#include <stdexcept>

namespace {

Point parse_point(const nlohmann::json& value) {
    if (!value.is_array() || value.size() != 2 || !value[0].is_number_integer() ||
        !value[1].is_number_integer()) {
        throw std::invalid_argument("Point must contain exactly two integers");
    }
    return Point{value[0].get<int>(), value[1].get<int>()};
}

nlohmann::json point_to_json(const Point& point) {
    return nlohmann::json::array({point.row, point.col});
}

nlohmann::json path_to_json(const std::vector<Point>& path) {
    nlohmann::json output = nlohmann::json::array();
    for (const auto& point : path) {
        output.push_back(point_to_json(point));
    }
    return output;
}

}  // namespace

PlannerRequest JsonAdapter::parseRequest(const nlohmann::json& input) {
    if (!input.is_object()) {
        throw std::invalid_argument("Request must be a JSON object");
    }

    PlannerRequest request;
    request.mode = input.value("mode", "single");
    request.algorithm = input.value("algorithm", request.mode == "multi" ? "cbs" : "astar");
    request.round_trip = input.value("roundTrip", true);
    request.options.allow_diagonal = input.value("allowDiagonal", true);
    request.options.prevent_corner_cutting = input.value("preventCornerCutting", true);
    if (input.contains("options")) {
        const auto& options = input["options"];
        if (!options.is_object()) {
            throw std::invalid_argument("options must be a JSON object");
        }
        request.multi_robot_options.max_robots =
            options.value("maxRobots", request.multi_robot_options.max_robots);
        request.multi_robot_options.max_high_level_nodes =
            options.value("maxHighLevelNodes", request.multi_robot_options.max_high_level_nodes);
        request.multi_robot_options.max_time_steps =
            options.value("maxTimeSteps", request.multi_robot_options.max_time_steps);
    }

    if (!input.contains("grid") || !input["grid"].is_array()) {
        throw std::invalid_argument("Request must contain a grid array");
    }
    request.grid = input["grid"].get<std::vector<std::vector<int>>>();

    if (request.mode == "multi") {
        if (!input.contains("robots") || !input["robots"].is_array()) {
            throw std::invalid_argument("Multi robot request must contain a robots array");
        }

        for (const auto& robot_json : input["robots"]) {
            RobotTask task;
            task.id = robot_json.at("id").get<std::string>();
            task.start = parse_point(robot_json.at("start"));
            task.target = parse_point(robot_json.at("target"));
            task.round_trip = robot_json.value("roundTrip", true);
            request.robots.push_back(task);
        }
    }

    return request;
}

nlohmann::json JsonAdapter::toJson(const PathResult& result) {
    return {
        {"found", result.found},
        {"message", result.message},
        {"path", path_to_json(result.path)},
        {"pathCost", result.path_cost},
        {"expandedCount", result.expanded_count},
        {"expandedOrder", path_to_json(result.expanded_order)}
    };
}

nlohmann::json JsonAdapter::toJson(const RoundTripResult& result) {
    return {
        {"success", result.success},
        {"message", result.message},
        {"outbound", toJson(result.outbound)},
        {"returnTrip", toJson(result.return_trip)},
        {"fullPath", path_to_json(result.full_path)},
        {"totalCost", result.total_cost},
        {"totalExpandedCount", result.total_expanded_count}
    };
}

nlohmann::json JsonAdapter::toJson(const MultiRobotResult& result) {
    nlohmann::json robots = nlohmann::json::array();
    for (const auto& robot : result.robots) {
        robots.push_back({
            {"id", robot.id},
            {"timeline", path_to_json(robot.timeline)},
            {"pathCost", robot.path_cost}
        });
    }

    return {
        {"success", result.success},
        {"message", result.message},
        {"robots", robots},
        {"totalCost", result.total_cost},
        {"resolvedConflictCount", result.resolved_conflict_count}
    };
}

nlohmann::json JsonAdapter::error(const std::string& message) {
    return {
        {"success", false},
        {"message", message}
    };
}
