#include "GridMap.hpp"

#include <cmath>
#include <set>
#include <stdexcept>

GridMap::GridMap(std::vector<std::vector<int>> cells)
{
    if (cells.empty() || cells.front().empty())
    {
        throw std::invalid_argument("Grid must not be empty");
    }

    const std::size_t expected_columns = cells.front().size();
    cells_.reserve(cells.size());

    for (const auto &row : cells)
    {
        if (row.size() != expected_columns)
        {
            throw std::invalid_argument("Grid rows must have equal length");
        }

        std::vector<CellType> converted_row;
        converted_row.reserve(row.size());
        for (const int value : row)
        {
            if (!isSupportedCellValue(value))
            {
                throw std::invalid_argument("Grid contains unsupported cell value");
            }
            converted_row.push_back(static_cast<CellType>(value));
        }
        cells_.push_back(std::move(converted_row));
    }

    locateSingleTaskEndpoints();
}

int GridMap::rows() const
{
    return static_cast<int>(cells_.size());
}

int GridMap::cols() const
{
    return static_cast<int>(cells_.front().size());
}

bool GridMap::isInside(const Point &point) const
{
    return point.row >= 0 && point.row < rows() && point.col >= 0 && point.col < cols();
}

bool GridMap::isPassable(const Point &point) const
{
    if (!isInside(point))
    {
        return false;
    }

    const CellType cell = getCell(point);
    return cell != CellType::Shelf && cell != CellType::Obstacle;
}

bool GridMap::canMove(const Point &current, const Point &next, bool allow_diagonal,
                      bool prevent_corner_cutting) const
{
    if (!isInside(current) || !isPassable(next))
    {
        return false;
    }

    const int row_distance = std::abs(current.row - next.row);
    const int col_distance = std::abs(current.col - next.col);
    if (row_distance > 1 || col_distance > 1 || row_distance + col_distance == 0)
    {
        return false;
    }

    if (!isDiagonalStep(current, next))
    {
        return true;
    }

    if (!allow_diagonal)
    {
        return false;
    }

    if (!prevent_corner_cutting)
    {
        return true;
    }

    // 斜向移动时同时检查两个正交方向，避免机器人穿过障碍物形成的墙角。
    const Point vertical_neighbor{next.row, current.col};
    const Point horizontal_neighbor{current.row, next.col};
    return isPassable(vertical_neighbor) && isPassable(horizontal_neighbor);
}

CellType GridMap::getCell(const Point &point) const
{
    if (!isInside(point))
    {
        throw std::out_of_range("Point is outside the grid");
    }
    return cells_[point.row][point.col];
}

std::optional<Point> GridMap::start() const
{
    return start_;
}

std::optional<Point> GridMap::target() const
{
    return target_;
}

std::string GridMap::render(const std::vector<Point> &path) const
{
    std::set<Point> path_points(path.begin(), path.end());
    std::string output;

    for (int row = 0; row < rows(); ++row)
    {
        for (int col = 0; col < cols(); ++col)
        {
            const Point point{row, col};
            char symbol = '.';
            switch (getCell(point))
            {
            case CellType::Empty:
                symbol = '.';
                break;
            case CellType::Shelf:
                symbol = '#';
                break;
            case CellType::Obstacle:
                symbol = 'X';
                break;
            case CellType::LoadingArea:
                symbol = 'S';
                break;
            case CellType::TargetShelf:
                symbol = 'T';
                break;
            }

            if (path_points.count(point) > 0 && symbol == '.')
            {
                symbol = '*';
            }
            output += symbol;
            output += col + 1 == cols() ? '\n' : ' ';
        }
    }

    return output;
}

bool GridMap::isSupportedCellValue(const int value)
{
    return value >= static_cast<int>(CellType::Empty) &&
           value <= static_cast<int>(CellType::TargetShelf);
}

bool GridMap::isDiagonalStep(const Point &current, const Point &next)
{
    return current.row != next.row && current.col != next.col;
}

void GridMap::locateSingleTaskEndpoints()
{
    for (int row = 0; row < rows(); ++row)
    {
        for (int col = 0; col < cols(); ++col)
        {
            const Point point{row, col};
            if (getCell(point) == CellType::LoadingArea)
            {
                if (start_.has_value())
                {
                    throw std::invalid_argument("Grid must contain at most one loading area");
                }
                start_ = point;
            }

            if (getCell(point) == CellType::TargetShelf)
            {
                if (target_.has_value())
                {
                    throw std::invalid_argument("Grid must contain at most one target shelf");
                }
                target_ = point;
            }
        }
    }
}
