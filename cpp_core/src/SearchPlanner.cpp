#include "SearchPlanner.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <queue>
#include <stdexcept>
#include <vector>

namespace {

constexpr int INF_COST = std::numeric_limits<int>::max();

struct SearchNode {
    Point point;
    int g_cost = 0;
    int h_cost = 0;

    int f_cost() const {
        return g_cost + h_cost;
    }
};

struct SearchNodeCompare {
    bool operator()(const SearchNode& first, const SearchNode& second) const {
        if (first.f_cost() != second.f_cost()) {
            return first.f_cost() > second.f_cost();
        }
        if (first.h_cost != second.h_cost) {
            return first.h_cost > second.h_cost;
        }
        return second.point < first.point;
    }
};

constexpr std::array<Point, 8> DIRECTIONS = {
    Point{-1, 0}, Point{1, 0},  Point{0, -1}, Point{0, 1},
    Point{-1, -1}, Point{-1, 1}, Point{1, -1}, Point{1, 1}
};

bool is_diagonal_move(const Point& current, const Point& next) {
    return current.row != next.row && current.col != next.col;
}

int move_cost(const Point& current, const Point& next) {
    return is_diagonal_move(current, next) ? 2 : 1;
}

std::vector<Point> reconstruct_path(
    const Point& start, const Point& target,
    const std::vector<std::vector<std::optional<Point>>>& parent) {
    std::vector<Point> path;
    Point current = target;
    path.push_back(current);

    // 搜索阶段只保存前驱节点，最终统一回溯可以避免在最小堆中复制整条路径。
    while (current != start) {
        const auto& previous = parent[current.row][current.col];
        if (!previous.has_value()) {
            return {};
        }
        current = *previous;
        path.push_back(current);
    }

    std::reverse(path.begin(), path.end());
    return path;
}

}  // namespace

SearchPlanner::SearchPlanner(const GridMap& grid_map) : grid_map_(grid_map) {}

PathResult SearchPlanner::plan(const Point& start, const Point& target,
                               const SearchAlgorithm algorithm,
                               const SearchOptions& options) const {
    if (!grid_map_.isPassable(start) || !grid_map_.isPassable(target)) {
        throw std::invalid_argument("Start and target must be passable");
    }

    std::priority_queue<SearchNode, std::vector<SearchNode>, SearchNodeCompare> open_set;
    std::vector<std::vector<int>> g_cost(
        grid_map_.rows(), std::vector<int>(grid_map_.cols(), INF_COST));
    std::vector<std::vector<bool>> closed(
        grid_map_.rows(), std::vector<bool>(grid_map_.cols(), false));
    std::vector<std::vector<std::optional<Point>>> parent(
        grid_map_.rows(), std::vector<std::optional<Point>>(grid_map_.cols()));

    const auto heuristic = [&](const Point& point) {
        return algorithm == SearchAlgorithm::AStar ? manhattanDistance(point, target) : 0;
    };

    g_cost[start.row][start.col] = 0;
    open_set.push(SearchNode{start, 0, heuristic(start)});

    PathResult result;
    while (!open_set.empty()) {
        const SearchNode current = open_set.top();
        open_set.pop();

        if (closed[current.point.row][current.point.col]) {
            continue;
        }

        // 同一个格子可能以不同代价多次进入堆，过期节点不应参与扩展。
        if (current.g_cost != g_cost[current.point.row][current.point.col]) {
            continue;
        }

        closed[current.point.row][current.point.col] = true;
        result.expanded_order.push_back(current.point);

        if (current.point == target) {
            result.found = true;
            result.message = "Path found";
            result.path_cost = current.g_cost;
            result.path = reconstruct_path(start, target, parent);
            result.expanded_count = static_cast<int>(result.expanded_order.size());
            return result;
        }

        for (const Point& direction : DIRECTIONS) {
            const Point next{current.point.row + direction.row, current.point.col + direction.col};
            if (!grid_map_.canMove(
                    current.point, next, options.allow_diagonal, options.prevent_corner_cutting)) {
                continue;
            }

            const int next_cost = current.g_cost + move_cost(current.point, next);
            if (next_cost >= g_cost[next.row][next.col]) {
                continue;
            }

            g_cost[next.row][next.col] = next_cost;
            parent[next.row][next.col] = current.point;
            open_set.push(SearchNode{next, next_cost, heuristic(next)});
        }
    }

    result.message = "No feasible path found";
    result.expanded_count = static_cast<int>(result.expanded_order.size());
    return result;
}

RoundTripResult SearchPlanner::planRoundTrip(const Point& start, const Point& target,
                                             const SearchAlgorithm algorithm,
                                             const SearchOptions& options) const {
    RoundTripResult result;
    result.outbound = plan(start, target, algorithm, options);
    if (!result.outbound.found) {
        result.message = "Outbound path was not found";
        result.total_expanded_count = result.outbound.expanded_count;
        return result;
    }

    result.return_trip = plan(target, start, algorithm, options);
    result.total_expanded_count = result.outbound.expanded_count + result.return_trip.expanded_count;
    if (!result.return_trip.found) {
        result.message = "Return path was not found";
        return result;
    }

    result.success = true;
    result.message = "Round trip path found";
    result.total_cost = result.outbound.path_cost + result.return_trip.path_cost;
    result.full_path = result.outbound.path;
    result.full_path.insert(
        result.full_path.end(), std::next(result.return_trip.path.begin()), result.return_trip.path.end());
    return result;
}

int SearchPlanner::manhattanDistance(const Point& first, const Point& second) {
    return std::abs(first.row - second.row) + std::abs(first.col - second.col);
}
