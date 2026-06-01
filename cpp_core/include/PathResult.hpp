#pragma once

#include "Point.hpp"

#include <string>
#include <vector>

struct SearchTraceEntry {
    Point point;
    int g_cost = 0;
    int h_cost = 0;
    int f_cost = 0;
};

struct PathResult {
    bool found = false;
    std::string message;
    std::vector<Point> path;
    int path_cost = 0;
    int expanded_count = 0;
    std::vector<Point> expanded_order;
    std::vector<SearchTraceEntry> search_trace;
};

struct RoundTripResult {
    bool success = false;
    std::string message;
    PathResult outbound;
    PathResult return_trip;
    std::vector<Point> full_path;
    int total_cost = 0;
    int total_expanded_count = 0;
};
