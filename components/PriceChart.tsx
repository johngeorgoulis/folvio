import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import Colors from "@/constants/colors";
import type { ChartPoint } from "@/services/priceService";

interface PriceChartProps {
  data: ChartPoint[];
  width: number;
  height?: number;
  range: string;
}

function formatXLabel(ts: number, range: string): string {
  const d = new Date(ts);
  if (range === "1D") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "1W" || range === "1M") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (range === "3M" || range === "6M") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
}

function formatPrice(price: number): string {
  if (price >= 1000) return `€${price.toFixed(0)}`;
  if (price >= 10) return `€${price.toFixed(2)}`;
  return `€${price.toFixed(3)}`;
}

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cp1x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) / 3;
    const cp2x = pts[i].x - (pts[i].x - pts[i - 1].x) / 3;
    d += ` C ${cp1x} ${pts[i - 1].y} ${cp2x} ${pts[i].y} ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

const PAD = { top: 24, bottom: 32, left: 8, right: 8 };

export default function PriceChart({ data, width, height = 200, range }: PriceChartProps) {
  const theme = Colors.dark;
  const [touchIdx, setTouchIdx] = useState<number | null>(null);

  const cW = width - PAD.left - PAD.right;
  const cH = height - PAD.top - PAD.bottom;

  if (data.length < 2) {
    return (
      <View style={[styles.empty, { width, height, backgroundColor: theme.backgroundCard }]}>
        <Text style={{ color: theme.textSecondary, fontSize: 13, fontFamily: "Inter_400Regular" }}>
          Chart unavailable
        </Text>
      </View>
    );
  }

  const prices = data.map((p) => p.priceEUR);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const priceRange = maxP - minP || 1;

  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * cW;
  const toY = (p: number) => PAD.top + cH - ((p - minP) / priceRange) * cH;

  const pts = data.map((d, i) => ({ x: toX(i), y: toY(d.priceEUR) }));
  const linePath = buildSmoothPath(pts);
  const lastPt = pts[pts.length - 1];
  const areaPath = `${linePath} L ${lastPt.x} ${PAD.top + cH} L ${PAD.left} ${PAD.top + cH} Z`;

  const isPositive = prices[prices.length - 1] >= prices[0];
  const lineColor = isPositive ? theme.tint : theme.negative;

  const labelIndices = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  const activePt = touchIdx !== null ? pts[touchIdx] : null;
  const activePrice = touchIdx !== null ? data[touchIdx].priceEUR : null;
  const activeTs = touchIdx !== null ? data[touchIdx].timestamp : null;

  function handleTouch(evt: { nativeEvent: { locationX: number } }) {
    const nx = evt.nativeEvent.locationX - PAD.left;
    const frac = Math.max(0, Math.min(1, nx / cW));
    const idx = Math.round(frac * (data.length - 1));
    setTouchIdx(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const tooltipX = activePt
    ? Math.max(PAD.left + 4, Math.min(activePt.x - 34, width - 76))
    : 0;

  return (
    <View
      style={{ width, height }}
      onTouchStart={handleTouch}
      onTouchMove={handleTouch}
      onTouchEnd={() => setTouchIdx(null)}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="pcGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Path d={areaPath} fill="url(#pcGrad)" />

        <Path
          d={linePath}
          stroke={lineColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {labelIndices.map((idx, i) => {
          const x = toX(idx);
          const label = formatXLabel(data[idx].timestamp, range);
          const anchor = i === 0 ? "start" : i === 2 ? "end" : "middle";
          return (
            <SvgText
              key={idx}
              x={x}
              y={height - 6}
              fontSize={10}
              fill={theme.textSecondary}
              textAnchor={anchor}
              fontFamily="Inter_400Regular"
            >
              {label}
            </SvgText>
          );
        })}

        {activePt && activePrice != null && activeTs != null && (
          <>
            <Line
              x1={activePt.x}
              y1={PAD.top - 4}
              x2={activePt.x}
              y2={PAD.top + cH}
              stroke={lineColor}
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeOpacity={0.7}
            />
            <Circle
              cx={activePt.x}
              cy={activePt.y}
              r={4}
              fill={lineColor}
              stroke={theme.background}
              strokeWidth={2}
            />
            <Rect
              x={tooltipX}
              y={PAD.top - 22}
              width={72}
              height={20}
              rx={6}
              fill={theme.backgroundElevated}
              opacity={0.95}
            />
            <SvgText
              x={tooltipX + 36}
              y={PAD.top - 7}
              fontSize={11}
              fill={lineColor}
              textAnchor="middle"
              fontFamily="Inter_600SemiBold"
            >
              {formatPrice(activePrice)}
            </SvgText>
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
