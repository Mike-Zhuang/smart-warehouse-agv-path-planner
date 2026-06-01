#include "ConflictBasedSearch.hpp"

#include <algorithm>
#include <array>
#include <limits>
#include <optional>
#include <queue>
#include <set>
#include <stdexcept>
#include <tuple>
#include <unordered_set>
#include <utility>

namespace {

enum class ConstraintType {
    Vertex,
    Edge
};

struct Constraint {
    std::size_t robot_index = 0;
    ConstraintType type = ConstraintType::Vertex;
    int time_step = 0;
    Point point;
    Point from;
    Point to;
};

struct Conflict {
    std::size_t first_robot = 0;
    std::size_t second_robot = 0;
    ConstraintType type = ConstraintType::Vertex;
    int time_step = 0;
    Point point;
    Point first_from;
    Point first_to;
    Point second_from;
    Point second_to;
};

struct TimelineState {
    Point point;
    int time_step = 0;
    bool returning = false;

    bool operator==(const TimelineState& other) const {
        return point == other.point && time_step == other.time_step && returning == other.returning;
    }
};

struct TimelineStateHash {
    std::size_t operator()(const TimelineState& state) const {
        std::size_t value = PointHash{}(state.point);
        value ^= std::hash<int>{}(state.time_step) << 1;
        value ^= std::hash<bool>{}(state.returning) << 2;
        return value;
    }
};

struct TimedSearchNode {
    TimelineState state;
    int g_cost = 0;
    int h_cost = 0;

    int f_cost() const {
        return g_cost + h_cost;
    }
};

struct TimedSearchNodeCompare {
    bool operator()(const TimedSearchNode& first, const TimedSearchNode& second) const {
        if (first.f_cost() != second.f_cost()) {
            return first.f_cost() > second.f_cost();
        }
        if (first.h_cost != second.h_cost) {
            return first.h_cost > second.h_cost;
        }
        if (first.state.time_step != second.state.time_step) {
            return first.state.time_step > second.state.time_step;
        }
        return second.state.point < first.state.point;
    }
};

struct ConstraintTreeNode {
    std::vector<Constraint> constraints;
    std::vector<RobotPath> paths;
    int total_cost = 0;
    int makespan = 0;
    int resolved_conflict_count = 0;
    std::size_t sequence = 0;
};

struct ConstraintTreeNodeCompare {
    bool operator()(const ConstraintTreeNode& first, const ConstraintTreeNode& second) const {
        if (first.total_cost != second.total_cost) {
            return first.total_cost > second.total_cost;
        }
        if (first.makespan != second.makespan) {
            return first.makespan > second.makespan;
        }
        return first.sequence > second.sequence;
    }
};

constexpr std::array<Point, 9> DIRECTIONS = {
    Point{-1, 0}, Point{1, 0},  Point{0, -1}, Point{0, 1},
    Point{-1, -1}, Point{-1, 1}, Point{1, -1}, Point{1, 1},
    Point{0, 0}
};

bool is_waiting(const Point& current, const Point& next) {
    return current == next;
}

bool is_diagonal_move(const Point& current, const Point& next) {
    return current.row != next.row && current.col != next.col;
}

int move_cost(const Point& current, const Point& next) {
    if (is_waiting(current, next)) {
        return 1;
    }
    return is_diagonal_move(current, next) ? 2 : 1;
}

int heuristic(const TimelineState& state, const RobotTask& task) {
    if (!task.round_trip) {
        return SearchPlanner::manhattanDistance(state.point, task.target);
    }
    if (state.returning) {
        return SearchPlanner::manhattanDistance(state.point, task.start);
    }
    return SearchPlanner::manhattanDistance(state.point, task.target) +
           SearchPlanner::manhattanDistance(task.target, task.start);
}

bool is_goal_state(const TimelineState& state, const RobotTask& task) {
    if (!task.round_trip) {
        return state.point == task.target;
    }
    return state.returning && state.point == task.start;
}

TimelineState normalize_state(TimelineState state, const RobotTask& task) {
    if (task.round_trip && !state.returning && state.point == task.target) {
        state.returning = true;
    }
    return state;
}

bool violates_constraint(const std::vector<Constraint>& constraints, const std::size_t robot_index,
                        const Point& from, const Point& to, const int next_time_step) {
    for (const Constraint& constraint : constraints) {
        if (constraint.robot_index != robot_index || constraint.time_step != next_time_step) {
            continue;
        }
        if (constraint.type == ConstraintType::Vertex && constraint.point == to) {
            return true;
        }
        if (constraint.type == ConstraintType::Edge &&
            constraint.from == from && constraint.to == to) {
            return true;
        }
    }
    return false;
}

bool can_stay_at_goal(const std::vector<Constraint>& constraints, const std::size_t robot_index,
                   const Point& goal, const int current_time_step) {
    for (const Constraint& constraint : constraints) {
        if (constraint.robot_index != robot_index || constraint.time_step <= current_time_step) {
            continue;
        }
        if (constraint.type == ConstraintType::Vertex && constraint.point == goal) {
            return false;
        }
        if (constraint.type == ConstraintType::Edge &&
            constraint.from == goal && constraint.to == goal) {
            return false;
        }
    }
    return true;
}

RobotPath reconstruct_robot_path(
    const std::string& id, const int path_cost,
    TimelineState current,
    const std::unordered_map<TimelineState, TimelineState, TimelineStateHash>& parent) {
    std::vector<TimelineState> states;
    states.push_back(current);

    while (current.time_step > 0) {
        const auto iterator = parent.find(current);
        if (iterator == parent.end()) {
            return RobotPath{id, {}, path_cost, std::nullopt};
        }
        current = iterator->second;
        states.push_back(current);
    }

    std::reverse(states.begin(), states.end());
    RobotPath path{id, {}, path_cost, std::nullopt};
    for (const TimelineState& state : states) {
        path.timeline.push_back(state.point);
        if (state.returning && !path.return_start_time_step.has_value()) {
            path.return_start_time_step = state.time_step;
        }
    }
    return path;
}

std::optional<RobotPath> plan_robot(
    const GridMap& grid_map, const RobotTask& task, const std::size_t robot_index,
    const std::vector<Constraint>& constraints, const SearchOptions& search_options,
    const MultiRobotOptions& multi_robot_options) {
    TimelineState start_state{task.start, 0, false};
    start_state = normalize_state(start_state, task);
    if (violates_constraint(constraints, robot_index, task.start, task.start, 0)) {
        return std::nullopt;
    }

    std::priority_queue<TimedSearchNode, std::vector<TimedSearchNode>, TimedSearchNodeCompare>
        open_set;
    std::unordered_map<TimelineState, int, TimelineStateHash> g_cost;
    std::unordered_map<TimelineState, TimelineState, TimelineStateHash> parent;
    std::unordered_set<TimelineState, TimelineStateHash> closed;

    g_cost[start_state] = 0;
    open_set.push(TimedSearchNode{start_state, 0, heuristic(start_state, task)});

    while (!open_set.empty()) {
        const TimedSearchNode current = open_set.top();
        open_set.pop();

        const auto known_cost = g_cost.find(current.state);
        if (known_cost == g_cost.end() || known_cost->second != current.g_cost ||
            closed.count(current.state) > 0) {
            continue;
        }
        closed.insert(current.state);

        if (is_goal_state(current.state, task) &&
            can_stay_at_goal(constraints, robot_index, current.state.point, current.state.time_step)) {
            return reconstruct_robot_path(task.id, current.g_cost, current.state, parent);
        }

        if (current.state.time_step >= multi_robot_options.max_time_steps) {
            continue;
        }

        for (const Point& direction : DIRECTIONS) {
            const Point next_point{
                current.state.point.row + direction.row,
                current.state.point.col + direction.col
            };
            if (is_waiting(current.state.point, next_point)) {
                if (!grid_map.isPassable(next_point)) {
                    continue;
                }
            } else if (!grid_map.canMove(
                           current.state.point, next_point, search_options.allow_diagonal,
                           search_options.prevent_corner_cutting)) {
                continue;
            }

            const int next_time_step = current.state.time_step + 1;
            if (violates_constraint(
                    constraints, robot_index, current.state.point, next_point, next_time_step)) {
                continue;
            }

            TimelineState next_state{next_point, next_time_step, current.state.returning};
            next_state = normalize_state(next_state, task);
            const int next_cost = current.g_cost + move_cost(current.state.point, next_point);

            const auto previous_cost = g_cost.find(next_state);
            if (previous_cost != g_cost.end() && next_cost >= previous_cost->second) {
                continue;
            }

            g_cost[next_state] = next_cost;
            parent[next_state] = current.state;
            open_set.push(TimedSearchNode{next_state, next_cost, heuristic(next_state, task)});
        }
    }

    return std::nullopt;
}

Point position_at(const RobotPath& path, const int time_step) {
    if (time_step < static_cast<int>(path.timeline.size())) {
        return path.timeline[time_step];
    }
    return path.timeline.back();
}

std::optional<Conflict> find_first_conflict(const std::vector<RobotPath>& paths) {
    int makespan = 0;
    for (const RobotPath& path : paths) {
        makespan = std::max(makespan, static_cast<int>(path.timeline.size()));
    }

    for (int time_step = 0; time_step < makespan; ++time_step) {
        for (std::size_t first = 0; first < paths.size(); ++first) {
            for (std::size_t second = first + 1; second < paths.size(); ++second) {
                const Point first_point = position_at(paths[first], time_step);
                const Point second_point = position_at(paths[second], time_step);
                if (first_point == second_point) {
                    return Conflict{
                        first, second, ConstraintType::Vertex, time_step, first_point,
                        {}, {}, {}, {}
                    };
                }

                if (time_step == 0) {
                    continue;
                }

                const Point first_previous = position_at(paths[first], time_step - 1);
                const Point second_previous = position_at(paths[second], time_step - 1);
                if (first_previous == second_point && second_previous == first_point) {
                    return Conflict{
                        first, second, ConstraintType::Edge, time_step, {},
                        first_previous, first_point, second_previous, second_point
                    };
                }
            }
        }
    }

    return std::nullopt;
}

Constraint make_constraint(const Conflict& conflict, const std::size_t robot_index) {
    if (conflict.type == ConstraintType::Vertex) {
        return Constraint{robot_index, ConstraintType::Vertex, conflict.time_step, conflict.point, {}, {}};
    }
    if (robot_index == conflict.first_robot) {
        return Constraint{
            robot_index, ConstraintType::Edge, conflict.time_step, {},
            conflict.first_from, conflict.first_to
        };
    }
    return Constraint{
        robot_index, ConstraintType::Edge, conflict.time_step, {},
        conflict.second_from, conflict.second_to
    };
}

void update_node_cost(ConstraintTreeNode& node) {
    node.total_cost = 0;
    node.makespan = 0;
    for (const RobotPath& path : node.paths) {
        node.total_cost += path.path_cost;
        node.makespan = std::max(node.makespan, static_cast<int>(path.timeline.size()));
    }
}

void validate_options(const MultiRobotOptions& options) {
    if (options.max_robots <= 0 || options.max_robots > MultiRobotOptions::HARD_MAX_ROBOTS) {
        throw std::invalid_argument("maxRobots is outside the supported range");
    }
    if (options.max_high_level_nodes <= 0 ||
        options.max_high_level_nodes > MultiRobotOptions::HARD_MAX_HIGH_LEVEL_NODES) {
        throw std::invalid_argument("maxHighLevelNodes is outside the supported range");
    }
    if (options.max_time_steps <= 0 ||
        options.max_time_steps > MultiRobotOptions::HARD_MAX_TIME_STEPS) {
        throw std::invalid_argument("maxTimeSteps is outside the supported range");
    }
}

}  // namespace

ConflictBasedSearch::ConflictBasedSearch(const GridMap& grid_map) : grid_map_(grid_map) {}

MultiRobotResult ConflictBasedSearch::plan(
    const std::vector<RobotTask>& tasks, const SearchOptions& search_options,
    const MultiRobotOptions& multi_robot_options) const {
    if (tasks.empty()) {
        throw std::invalid_argument("Robot task list must not be empty");
    }

    validate_options(multi_robot_options);
    if (tasks.size() > static_cast<std::size_t>(multi_robot_options.max_robots)) {
        throw std::invalid_argument("Robot task count exceeds maxRobots");
    }

    std::set<std::string> robot_ids;
    for (const RobotTask& task : tasks) {
        if (task.id.empty()) {
            throw std::invalid_argument("Robot id must not be empty");
        }
        if (!robot_ids.insert(task.id).second) {
            throw std::invalid_argument("Robot ids must be unique");
        }
        if (!grid_map_.isPassable(task.start) || !grid_map_.isPassable(task.target)) {
            throw std::invalid_argument("Robot start and target must be passable");
        }
    }

    ConstraintTreeNode root;
    for (std::size_t index = 0; index < tasks.size(); ++index) {
        const auto path = plan_robot(
            grid_map_, tasks[index], index, root.constraints, search_options, multi_robot_options);
        if (!path.has_value()) {
            return MultiRobotResult{
                false, "At least one robot has no feasible path", {}, 0, 0
            };
        }
        root.paths.push_back(*path);
    }
    update_node_cost(root);

    std::priority_queue<
        ConstraintTreeNode, std::vector<ConstraintTreeNode>, ConstraintTreeNodeCompare>
        open_set;
    open_set.push(root);

    std::size_t sequence = 1;
    int expanded_high_level_nodes = 0;
    while (!open_set.empty() && expanded_high_level_nodes < multi_robot_options.max_high_level_nodes) {
        const ConstraintTreeNode current = open_set.top();
        open_set.pop();
        ++expanded_high_level_nodes;

        const auto conflict = find_first_conflict(current.paths);
        if (!conflict.has_value()) {
            return MultiRobotResult{
                true, "Conflict-free paths found", current.paths,
                current.total_cost, current.resolved_conflict_count
            };
        }

        // 每个冲突拆成两个分支，各自限制一辆机器人，只重规划受影响的路径。
        for (const std::size_t robot_index : {conflict->first_robot, conflict->second_robot}) {
            ConstraintTreeNode child = current;
            child.constraints.push_back(make_constraint(*conflict, robot_index));
            child.resolved_conflict_count = current.resolved_conflict_count + 1;
            child.sequence = sequence++;

            const auto path = plan_robot(
                grid_map_, tasks[robot_index], robot_index, child.constraints,
                search_options, multi_robot_options);
            if (!path.has_value()) {
                continue;
            }

            child.paths[robot_index] = *path;
            update_node_cost(child);
            open_set.push(std::move(child));
        }
    }

    return MultiRobotResult{
        false, "CBS search limit reached before finding conflict-free paths", {}, 0, 0
    };
}
