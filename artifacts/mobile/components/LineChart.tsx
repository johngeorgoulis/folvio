import React from "react";
import { View, useColorScheme } from "react-native";
import Svg, { Defs, LinearGradient, Path, Polyline, Stop } from "react-native-svg";
import Colors from "@/constants/colors";

interface DataPoint {
  year: number;
  value: number;
}

interface LineChartProps {
  conservative: DataPoint[];
  base: DataPoint[];
  optimistic: DataPoint[];
  width: number;
  height?: number;
}

function buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) / 3;
    const cp2x = points[i].x - (points[i].x - points[i - 1].x) / 3;
    d += ` C ${cp1x} ${points[i - 1].y} ${cp2x} ${points[i].y} ${points[i].x} ${points[i].y}`;
  }
  return d;
}

export function LineChart({ conservative, base, optimistic, width, height = 180 }: LineChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;

  const padding = { top: 12, bottom: 12, left: 8, right: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allValues = [...conservative, ...base, ...optimistic].map((p) => p.value);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const years = optimistic.map((p) => p.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const toPoint = (p: DataPoint) => ({
    x: padding.left + ((p.year - minYear) / (maxYear - minYear)) * chartW,
    y: padding.top + chartH - ((p.value - minVal) / (maxVal - minVal || 1)) * chartH,
  });

  const conservativePoints = conservative.map(toPoint);
  const basePoints = base.map(toPoint);
  const optimisticPoints = optimistic.map(toPoint);

  const conservativePath = buildPath(conservativePoints);
  const basePath = buildPath(basePoints);
  const optimisticPath = buildPath(optimisticPoints);

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="gradBase" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={theme.positive} stopOpacity={0.2} />
            <Stop offset="100%" stopColor={theme.positive} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path
          d={`${optimisticPath} L ${optimisticPoints[optimisticPoints.length - 1]?.x} ${padding.top + chartH} L ${padding.left} ${padding.top + chartH} Z`}
          fill={`rgba(0, 208, 132, 0.05)`}
        />
        <Path
          d={conservativePath}
          stroke={isDark ? "#4B5563" : "#D1D5DB"}
          strokeWidth={1.5}
          fill="none"
          strokeDasharray="4 4"
        />
        <Path
          d={optimisticPath}
          stroke={`rgba(0, 208, 132, 0.5)`}
          strokeWidth={1.5}
          fill="none"
          strokeDasharray="4 4"
        />
        <Path
          d={basePath}
          stroke={theme.positive}
          strokeWidth={2.5}
          fill="none"
        />
      </Svg>
    </View>
  );
}
