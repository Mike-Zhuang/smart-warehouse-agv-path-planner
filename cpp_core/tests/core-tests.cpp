#include "GridMap.hpp"
#include "JsonAdapter.hpp"
#include "SearchPlanner.hpp"
#include "ConflictBasedSearch.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

template <typename Function>
void assert_throws(const Function& function) {
    bool did_throw = false;
    try {
        function();
    } catch (const std::exception&) {
        did_throw = true;
    }
    assert(did_throw);
}

int calculate_path_cost(const std::vector<Point>& path) {
    int path_cost = 0;
    for (std::size_t index = 1; index < path.size(); ++index) {
        const int row_distance = std::abs(path[index].row - path[index - 1].row);
        const int col_distance = std::abs(path[index].col - path[index - 1].col);
        path_cost += row_distance == 0 && col_distance == 0 ? 1 : row_distance + col_distance;
    }
    return path_cost;
}

void assert_valid_path(const GridMap& grid_map, const std::vector<Point>& path,
                     const SearchOptions& options) {
    assert(!path.empty());
    for (std::size_t index = 1; index < path.size(); ++index) {
        assert(grid_map.canMove(
            path[index - 1], path[index], options.allow_diagonal, options.prevent_corner_cutting));
    }
}

Point position_at(const RobotPath& path, const std::size_t time_step) {
    if (time_step < path.timeline.size()) {
        return path.timeline[time_step];
    }
    return path.timeline.back();
}

void assert_conflict_free(const std::vector<RobotPath>& paths) {
    std::size_t makespan = 0;
    for (const auto& path : paths) {
        assert(!path.timeline.empty());
        makespan = std::max(makespan, path.timeline.size());
    }

    for (std::size_t time_step = 0; time_step < makespan; ++time_step) {
        for (std::size_t first = 0; first < paths.size(); ++first) {
            for (std::size_t second = first + 1; second < paths.size(); ++second) {
                assert(position_at(paths[first], time_step) != position_at(paths[second], time_step));
                if (time_step > 0) {
                    assert(!(position_at(paths[first], time_step - 1) ==
                                 position_at(paths[second], time_step) &&
                             position_at(paths[second], time_step - 1) ==
                                 position_at(paths[first], time_step)));
                }
            }
        }
    }
}

void testGridValidation() {
    assert_throws([] { GridMap({}); });
    assert_throws([] { GridMap({{0, 0}, {0}}); });
    assert_throws([] { GridMap({{0, 9}}); });
    assert_throws([] { GridMap({{3, 3, 4}}); });
    assert_throws([] { GridMap({{3, 4, 4}}); });
}

void testPassableCellsAndEndpoints() {
    const GridMap grid_map({{3, 0, 1}, {2, 4, 0}});

    assert(grid_map.rows() == 2);
    assert(grid_map.cols() == 3);
    assert((grid_map.start() == Point{0, 0}));
    assert((grid_map.target() == Point{1, 1}));
    assert(grid_map.isPassable(Point{0, 0}));
    assert(grid_map.isPassable(Point{1, 1}));
    assert(!grid_map.isPassable(Point{0, 2}));
    assert(!grid_map.isPassable(Point{1, 0}));
    assert(!grid_map.isPassable(Point{-1, 0}));
}

void testMovementRules() {
    const GridMap blocked_corner({{3, 1}, {2, 4}});
    assert(!blocked_corner.canMove(Point{0, 0}, Point{1, 1}, true, true));
    assert(blocked_corner.canMove(Point{0, 0}, Point{1, 1}, true, false));

    const GridMap open_grid({{3, 0}, {0, 4}});
    assert(open_grid.canMove(Point{0, 0}, Point{0, 1}, true, true));
    assert(open_grid.canMove(Point{0, 0}, Point{1, 1}, true, true));
    assert(!open_grid.canMove(Point{0, 0}, Point{1, 1}, false, true));
    assert(!open_grid.canMove(Point{0, 0}, Point{0, 0}, true, true));
}

void testRender() {
    const GridMap grid_map({{3, 0, 1}, {2, 4, 0}});
    const std::string output = grid_map.render({Point{0, 1}});
    assert(output == "S * #\nX T .\n");
}

void testManhattanDistance() {
    assert(SearchPlanner::manhattanDistance(Point{1, 2}, Point{4, 6}) == 7);
}

void testSingleRobotSearch() {
    const SearchOptions options;
    const GridMap diagonal_grid({{3, 0}, {0, 4}});
    const SearchPlanner diagonal_planner(diagonal_grid);
    const PathResult diagonal =
        diagonal_planner.plan(Point{0, 0}, Point{1, 1}, SearchAlgorithm::AStar, options);
    assert(diagonal.found);
    assert(diagonal.path_cost == 2);
    assert(diagonal.path.size() == 2);
    assert_valid_path(diagonal_grid, diagonal.path, options);

    const GridMap detour_grid({{3, 1, 4}, {0, 0, 0}});
    const SearchPlanner detour_planner(detour_grid);
    const PathResult detour =
        detour_planner.plan(Point{0, 0}, Point{0, 2}, SearchAlgorithm::AStar, options);
    assert(detour.found);
    assert(detour.path_cost == 4);
    assert(calculate_path_cost(detour.path) == detour.path_cost);
    assert_valid_path(detour_grid, detour.path, options);

    const GridMap blocked_grid({{3, 1, 4}, {1, 1, 1}});
    const PathResult blocked =
        SearchPlanner(blocked_grid).plan(Point{0, 0}, Point{0, 2}, SearchAlgorithm::AStar, options);
    assert(!blocked.found);
    assert(blocked.path.empty());
}

void testDijkstraAndRoundTrip() {
    const SearchOptions options;
    const GridMap grid_map({
        {3, 0, 0, 0},
        {0, 1, 1, 0},
        {0, 0, 0, 0},
        {0, 1, 0, 4}
    });
    const SearchPlanner planner(grid_map);
    const PathResult astar =
        planner.plan(Point{0, 0}, Point{3, 3}, SearchAlgorithm::AStar, options);
    const PathResult dijkstra =
        planner.plan(Point{0, 0}, Point{3, 3}, SearchAlgorithm::Dijkstra, options);
    assert(astar.found && dijkstra.found);
    assert(astar.path_cost == dijkstra.path_cost);
    assert(astar.expanded_count <= dijkstra.expanded_count);
    for (const SearchTraceEntry& entry : astar.search_trace) {
        assert(entry.h_cost == SearchPlanner::manhattanDistance(entry.point, Point{3, 3}));
        assert(entry.f_cost == entry.g_cost + entry.h_cost);
    }
    for (const SearchTraceEntry& entry : dijkstra.search_trace) {
        assert(entry.h_cost == 0);
        assert(entry.f_cost == entry.g_cost);
    }

    const GridMap diagonal_grid({{3, 0}, {0, 4}});
    const RoundTripResult round_trip =
        SearchPlanner(diagonal_grid).planRoundTrip(
            Point{0, 0}, Point{1, 1}, SearchAlgorithm::AStar, options);
    assert(round_trip.success);
    assert(round_trip.total_cost == 4);
    assert(round_trip.full_path.size() == 3);
    assert((round_trip.full_path.front() == Point{0, 0}));
    assert((round_trip.full_path[1] == Point{1, 1}));
    assert((round_trip.full_path.back() == Point{0, 0}));
}

void testJsonRequestParsing() {
    const nlohmann::json input = {
        {"mode", "multi"},
        {"grid", {{0, 0}, {0, 0}}},
        {"robots", {{{"id", "agv-01"}, {"start", {0, 0}}, {"target", {1, 1}}}}}
    };

    const PlannerRequest request = JsonAdapter::parseRequest(input);
    assert(request.mode == "multi");
    assert(request.algorithm == "cbs");
    assert(request.robots.size() == 1);
    assert(request.robots.front().id == "agv-01");
    assert((request.robots.front().target == Point{1, 1}));
}

void testMultiRobotOptionsParsing() {
    const nlohmann::json input = {
        {"mode", "multi"},
        {"grid", {{0, 0}, {0, 0}}},
        {"options", {
            {"maxRobots", 4},
            {"maxHighLevelNodes", 12000},
            {"maxTimeSteps", 500}
        }},
        {"robots", {{{"id", "agv-01"}, {"start", {0, 0}}, {"target", {1, 1}}}}}
    };

    const PlannerRequest request = JsonAdapter::parseRequest(input);
    assert(request.multi_robot_options.max_robots == 4);
    assert(request.multi_robot_options.max_high_level_nodes == 12000);
    assert(request.multi_robot_options.max_time_steps == 500);
}

void testMultiRobotLimits() {
    const GridMap grid_map({{0, 0}, {0, 0}});
    const ConflictBasedSearch planner(grid_map);
    const RobotTask first{"agv-01", Point{0, 0}, Point{1, 1}, false};
    const RobotTask second{"agv-02", Point{1, 0}, Point{0, 1}, false};

    MultiRobotOptions invalid_time_steps;
    invalid_time_steps.max_time_steps = 0;
    assert_throws([&] { planner.plan({first}, {}, invalid_time_steps); });

    MultiRobotOptions too_many_tasks;
    too_many_tasks.max_robots = 1;
    assert_throws([&] { planner.plan({first, second}, {}, too_many_tasks); });

    MultiRobotOptions invalid_high_level_limit;
    invalid_high_level_limit.max_high_level_nodes = 0;
    assert_throws([&] { planner.plan({first}, {}, invalid_high_level_limit); });
}

void testConflictBasedSearchWithoutConflict() {
    const GridMap grid_map({
        {0, 0, 0},
        {0, 0, 0},
        {0, 0, 0}
    });
    const ConflictBasedSearch planner(grid_map);
    const MultiRobotResult result = planner.plan({
        RobotTask{"agv-01", Point{0, 0}, Point{0, 2}, false},
        RobotTask{"agv-02", Point{2, 0}, Point{2, 2}, false}
    });

    assert(result.success);
    assert(result.robots.size() == 2);
    assert(result.resolved_conflict_count == 0);
    assert(!result.robots.front().return_start_time_step.has_value());
    assert_conflict_free(result.robots);
}

void testConflictBasedSearchWithVertexConflict() {
    const GridMap grid_map({
        {1, 0, 1},
        {0, 0, 0},
        {1, 0, 1}
    });
    const ConflictBasedSearch planner(grid_map);
    const SearchOptions options{false, true};
    const MultiRobotResult result = planner.plan({
        RobotTask{"agv-01", Point{1, 0}, Point{1, 2}, false},
        RobotTask{"agv-02", Point{0, 1}, Point{2, 1}, false}
    }, options);

    assert(result.success);
    assert(result.resolved_conflict_count > 0);
    assert_conflict_free(result.robots);
    const bool has_waiting_step = std::any_of(
        result.robots.begin(), result.robots.end(), [](const RobotPath& path) {
            for (std::size_t index = 1; index < path.timeline.size(); ++index) {
                if (path.timeline[index] == path.timeline[index - 1]) {
                    return true;
                }
            }
            return false;
        });
    assert(has_waiting_step);
}

void testConflictBasedSearchWithEdgeConflict() {
    const GridMap grid_map({
        {0, 0},
        {0, 0}
    });
    const ConflictBasedSearch planner(grid_map);
    const SearchOptions options{false, true};
    const MultiRobotResult result = planner.plan({
        RobotTask{"agv-01", Point{0, 0}, Point{0, 1}, false},
        RobotTask{"agv-02", Point{0, 1}, Point{0, 0}, false}
    }, options);

    assert(result.success);
    assert(result.resolved_conflict_count > 0);
    assert_conflict_free(result.robots);
}

void testConflictBasedSearchRoundTrip() {
    const GridMap grid_map({{0, 0}});
    const MultiRobotResult result = ConflictBasedSearch(grid_map).plan({
        RobotTask{"agv-01", Point{0, 0}, Point{0, 1}, true}
    });

    assert(result.success);
    assert(result.robots.size() == 1);
    assert(result.robots.front().path_cost == 2);
    assert(result.robots.front().timeline.size() == 3);
    assert((result.robots.front().timeline.front() == Point{0, 0}));
    assert((result.robots.front().timeline[1] == Point{0, 1}));
    assert((result.robots.front().timeline.back() == Point{0, 0}));
    assert(result.robots.front().return_start_time_step == 1);
}

void testConflictBasedSearchTimeStepLimit() {
    const GridMap grid_map({{0, 0, 0}});
    MultiRobotOptions options;
    options.max_time_steps = 1;

    const MultiRobotResult result = ConflictBasedSearch(grid_map).plan({
        RobotTask{"agv-01", Point{0, 0}, Point{0, 2}, false}
    }, {}, options);
    assert(!result.success);
}

}  // namespace

int main() {
    testGridValidation();
    testPassableCellsAndEndpoints();
    testMovementRules();
    testRender();
    testManhattanDistance();
    testSingleRobotSearch();
    testDijkstraAndRoundTrip();
    testJsonRequestParsing();
    testMultiRobotOptionsParsing();
    testMultiRobotLimits();
    testConflictBasedSearchWithoutConflict();
    testConflictBasedSearchWithVertexConflict();
    testConflictBasedSearchWithEdgeConflict();
    testConflictBasedSearchRoundTrip();
    testConflictBasedSearchTimeStepLimit();

    std::cout << "All core tests passed\n";
    return 0;
}
