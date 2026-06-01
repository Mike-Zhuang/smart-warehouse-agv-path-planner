#pragma once

#include <cstddef>
#include <functional>

struct Point {
    int row = 0;
    int col = 0;

    bool operator==(const Point& other) const {
        return row == other.row && col == other.col;
    }

    bool operator!=(const Point& other) const {
        return !(*this == other);
    }

    bool operator<(const Point& other) const {
        return row < other.row || (row == other.row && col < other.col);
    }
};

struct PointHash {
    std::size_t operator()(const Point& point) const {
        const std::size_t row_hash = std::hash<int>{}(point.row);
        const std::size_t col_hash = std::hash<int>{}(point.col);
        return row_hash ^ (col_hash << 1);
    }
};
