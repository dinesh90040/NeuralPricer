import React, { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart } from "lightweight-charts";

export default function MarketCandles({ currency, candles, theme }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: theme === "light" ? "#57606A" : "#8B949E",
      },
      grid: {
        vertLines: { color: "rgba(139, 148, 158, 0.12)" },
        horzLines: { color: "rgba(139, 148, 158, 0.12)" },
      },
      rightPriceScale: { borderColor: "rgba(139, 148, 158, 0.25)" },
      timeScale: { borderColor: "rgba(139, 148, 158, 0.25)", timeVisible: true },
      localization: { priceFormatter: (price) => `$${price.toLocaleString()}` },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#3FB950",
      downColor: "#F85149",
      borderVisible: false,
      wickUpColor: "#3FB950",
      wickDownColor: "#F85149",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    seriesRef.current.setData(candles.map(({ time, open, high, low, close }) => ({
      time,
      open,
      high,
      low,
      close,
    })));
    chartRef.current?.timeScale().fitContent();
  }, [candles, currency, theme]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${currency} perpetual candlestick chart`}
      className="w-full"
    />
  );
}
