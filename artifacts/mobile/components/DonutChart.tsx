import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import Colors from "@/constants/colors";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSublabel?: string;
}

const CHART_COLORS = [
  "#C9A84C",
  "#4A90D9",
  "#34D399",
  "#F87171",
  "#A78BFA",
  "#60A5FA",
  "#FBBF24",
  "#F472B6",
  "#2DD4BF",
  "#FB923C",
];

export function DonutChart({
  segments,
  size = 160,
  strokeWidth = 20,
  centerLabel,
  centerSublabel,
}: DonutChartProps) {
  const theme = Colors.dark;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const total = segments.reduce((s, seg) => s + seg.value, 0);

  if (total === 0) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="#1E3A5F"
            strokeWidth={strokeWidth}
            fill="none"
          />
        </Svg>
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          {centerLabel && (
            <Text style={{ color: theme.text, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              {centerLabel}
            </Text>
          )}
          {centerSublabel && (
            <Text style={{ color: theme.textSecondary, fontFamily: "Inter_400Regular", fontSize: 11 }}>
              {centerSublabel}
            </Text>
          )}
        </View>
      </View>
    );
  }

  let offset = 0;
  const arcs = segments.map((seg, i) => {
    const pct = seg.value / total;
    const dashArray = `${pct * circumference} ${circumference}`;
    const rotation = -90 + (offset / total) * 360;
    offset += seg.value;
    return {
      ...seg,
      dashArray,
      rotation,
      color: seg.color || CHART_COLORS[i % CHART_COLORS.length],
    };
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={0} origin={`${center}, ${center}`}>
          {arcs.map((arc, i) => (
            <Circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              stroke={arc.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={arc.dashArray}
              strokeDashoffset={0}
              rotation={arc.rotation}
              origin={`${center}, ${center}`}
              strokeLinecap="butt"
            />
          ))}
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
        {centerLabel && (
          <Text style={{ color: theme.text, fontFamily: "Inter_700Bold", fontSize: 17, letterSpacing: -0.5 }}>
            {centerLabel}
          </Text>
        )}
        {centerSublabel && (
          <Text style={{ color: theme.textSecondary, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 }}>
            {centerSublabel}
          </Text>
        )}
      </View>
    </View>
  );
}

export { CHART_COLORS };
