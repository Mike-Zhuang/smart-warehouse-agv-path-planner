#pragma once

#include "GridMap.hpp"
#include "PathResult.hpp"

#include <string>

enum class SearchAlgorithm {
    AStar,
    Dijkstra
};

struct SearchOptions {
    bool allow_diagonal = true;
    bool prevent_corner_cutting = true;
};

class SearchPlanner {
public:
    explicit SearchPlanner(const GridMap& grid_map);

    PathResult plan(const Point& start, const Point& target, SearchAlgorithm algorithm,
                    const SearchOptions& options = {}) const;
    RoundTripResult planRoundTrip(const Point& start, const Point& target,
                                  SearchAlgorithm algorithm,
                                  const SearchOptions& options = {}) const;
    static int manhattanDistance(const Point& first, const Point& second);

private:
    const GridMap& grid_map_;
};
