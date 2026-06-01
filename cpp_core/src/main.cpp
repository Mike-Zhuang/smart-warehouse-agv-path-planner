#include "ConflictBasedSearch.hpp"
#include "GridMap.hpp"
#include "JsonAdapter.hpp"
#include "SearchPlanner.hpp"

#include <iostream>
#include <stdexcept>

namespace {

SearchAlgorithm parse_algorithm(const std::string& algorithm) {
    if (algorithm == "astar") {
        return SearchAlgorithm::AStar;
    }
    if (algorithm == "dijkstra") {
        return SearchAlgorithm::Dijkstra;
    }
    throw std::invalid_argument("Single robot algorithm must be astar or dijkstra");
}

nlohmann::json execute_single_request(const PlannerRequest& request, const GridMap& grid_map) {
    if (!grid_map.start().has_value() || !grid_map.target().has_value()) {
        throw std::invalid_argument("Single robot grid must contain one loading area and one target shelf");
    }

    SearchPlanner planner(grid_map);
    if (request.algorithm == "compare") {
        nlohmann::json output;
        output["algorithm"] = "compare";
        if (request.round_trip) {
            output["astar"] = JsonAdapter::toJson(planner.planRoundTrip(
                *grid_map.start(), *grid_map.target(), SearchAlgorithm::AStar, request.options));
            output["dijkstra"] = JsonAdapter::toJson(planner.planRoundTrip(
                *grid_map.start(), *grid_map.target(), SearchAlgorithm::Dijkstra, request.options));
        } else {
            output["astar"] = JsonAdapter::toJson(planner.plan(
                *grid_map.start(), *grid_map.target(), SearchAlgorithm::AStar, request.options));
            output["dijkstra"] = JsonAdapter::toJson(planner.plan(
                *grid_map.start(), *grid_map.target(), SearchAlgorithm::Dijkstra, request.options));
        }
        return output;
    }

    const SearchAlgorithm algorithm = parse_algorithm(request.algorithm);
    if (request.round_trip) {
        return JsonAdapter::toJson(
            planner.planRoundTrip(*grid_map.start(), *grid_map.target(), algorithm, request.options));
    }
    return JsonAdapter::toJson(
        planner.plan(*grid_map.start(), *grid_map.target(), algorithm, request.options));
}

nlohmann::json execute_multi_request(const PlannerRequest& request, const GridMap& grid_map) {
    if (request.algorithm != "cbs") {
        throw std::invalid_argument("Multi robot algorithm must be cbs");
    }
    return JsonAdapter::toJson(
        ConflictBasedSearch(grid_map).plan(request.robots, request.options, request.multi_robot_options));
}

}  // namespace

int main() {
    try {
        nlohmann::json input;
        std::cin >> input;

        const PlannerRequest request = JsonAdapter::parseRequest(input);
        const GridMap grid_map(request.grid);
        std::cerr << grid_map.render();

        if (request.mode == "single") {
            std::cout << execute_single_request(request, grid_map).dump(2) << '\n';
            return 0;
        }

        if (request.mode == "multi") {
            std::cout << execute_multi_request(request, grid_map).dump(2) << '\n';
            return 0;
        }

        throw std::invalid_argument("Mode must be single or multi");
    } catch (const std::exception& error) {
        std::cout << JsonAdapter::error(error.what()).dump(2) << '\n';
        return 1;
    }
}
