#pragma once

#include "Point.hpp"

#include <optional>
#include <string>
#include <vector>

enum class CellType {
    Empty = 0,
    Shelf = 1,
    Obstacle = 2,
    LoadingArea = 3,
    TargetShelf = 4
};

class GridMap {
public:
    explicit GridMap(std::vector<std::vector<int>> cells);

    int rows() const;
    int cols() const;
    bool isInside(const Point& point) const;
    bool isPassable(const Point& point) const;
    bool canMove(const Point& current, const Point& next, bool allow_diagonal,
                 bool prevent_corner_cutting) const;
    CellType getCell(const Point& point) const;
    std::optional<Point> start() const;
    std::optional<Point> target() const;
    std::string render(const std::vector<Point>& path = {}) const;

private:
    std::vector<std::vector<CellType>> cells_;
    std::optional<Point> start_;
    std::optional<Point> target_;

    static bool isSupportedCellValue(int value);
    static bool isDiagonalStep(const Point& current, const Point& next);
    void locateSingleTaskEndpoints();
};
