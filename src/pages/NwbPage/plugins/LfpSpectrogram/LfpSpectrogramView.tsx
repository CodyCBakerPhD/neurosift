import { useHdf5Group } from "@hdf5Interface";
import {
  FunctionComponent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../common/loadingState.css";
import TimeseriesClient from "../simple-timeseries/TimeseriesClient";
import { ColormapName, colormapNames } from "./colormap";
import { plotMargins } from "./plotConstants";
import SpectrogramDataClient from "./SpectrogramDataClient";
import SpectrogramWidget from "./SpectrogramWidget";
import { SpectrogramResult } from "./WorkerTypes";

type Props = {
  nwbUrl: string;
  path: string;
  width?: number;
  height?: number;
  condensed?: boolean;
};

const windowSizeOptions = [128, 256, 512, 1024, 2048, 4096];

// Upper bound on samples pulled into the browser for one cached block. A block
// spans up to ~8x the visible window, so this also bounds the widest zoom-out.
const MAX_BLOCK_SAMPLES = 4_000_000;

const LfpSpectrogramView: FunctionComponent<Props> = ({
  nwbUrl,
  path,
  width = 800,
  height = 500,
  condensed = false,
}) => {
  const group = useHdf5Group(nwbUrl, path);

  const [client, setClient] = useState<TimeseriesClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setClient(null);
    setClientError(null);
    if (!group) return;
    TimeseriesClient.create(nwbUrl, group)
      .then((c) => {
        if (!canceled) setClient(c);
      })
      .catch((err) => {
        if (!canceled) setClientError(err.message || String(err));
      });
    return () => {
      canceled = true;
    };
  }, [nwbUrl, group]);

  if (clientError) {
    return (
      <div className="loadingContainer" style={{ color: "#e74c3c" }}>
        Error: {clientError}
      </div>
    );
  }
  if (!group) {
    return <div className="loadingContainer">Loading info...</div>;
  }
  if (!client) {
    return <div className="loadingContainer">Loading timeseries client...</div>;
  }

  return (
    <LfpSpectrogramInner
      client={client}
      width={width}
      height={height}
      condensed={condensed}
    />
  );
};

type InnerProps = {
  client: TimeseriesClient;
  width: number;
  height: number;
  condensed: boolean;
};

const LfpSpectrogramInner: FunctionComponent<InnerProps> = ({
  client,
  width,
  height,
  condensed,
}) => {
  const samplingFrequency = client.samplingFrequency;
  const nyquist = samplingFrequency / 2;
  const dataStart = client.startTime;
  const dataEnd = client.endTime;
  const totalDuration = dataEnd - dataStart;
  const numChannels = client.numChannels;

  const [channel, setChannel] = useState(0);
  const [windowSize, setWindowSize] = useState(512);
  const [colormap, setColormap] = useState<ColormapName>("viridis");
  const [freqMaxHz, setFreqMaxHz] = useState(Math.min(nyquist, 150));

  // Visible time window (seconds).
  const [visRange, setVisRange] = useState<[number, number]>(() => [
    dataStart,
    dataStart + Math.min(30, totalDuration || 30),
  ]);

  const [result, setResult] = useState<SpectrogramResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A single long-lived compute worker; the data client wraps it with a cache.
  const [worker, setWorker] = useState<Worker | null>(null);
  useEffect(() => {
    const w = new Worker(new URL("./worker", import.meta.url), {
      type: "module",
    });
    setWorker(w);
    return () => {
      w.terminate();
      setWorker(null);
    };
  }, []);

  // Recreate the caching client when the worker or spectrogram params change.
  const dataClient = useMemo(() => {
    if (!worker) return null;
    return new SpectrogramDataClient(client, worker, { channel, windowSize });
  }, [client, worker, channel, windowSize]);

  // Fetch/compute the block for the current visible range (debounced), keeping
  // the previous block on screen until the new one is ready.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!dataClient) return;
    const handle = setTimeout(() => {
      const reqId = ++reqRef.current;
      setLoading(true);
      dataClient
        .getSpectrogram(visRange[0], visRange[1])
        .then((r) => {
          if (reqId !== reqRef.current) return;
          setResult(r);
          setError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (reqId !== reqRef.current) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }, 40);
    return () => clearTimeout(handle);
  }, [dataClient, visRange]);

  const plotHeight = Math.max(200, height - (condensed ? 70 : 96));
  const plotW = width - plotMargins.left - plotMargins.right;

  // Widest allowed window: keeps a block's sample load under MAX_BLOCK_SAMPLES
  // (a block spans up to ~8x the visible window).
  const maxSpan = useMemo(
    () => Math.min(totalDuration, MAX_BLOCK_SAMPLES / (8 * samplingFrequency)),
    [totalDuration, samplingFrequency],
  );

  const clampRange = useCallback(
    (start: number, end: number): [number, number] => {
      const minSpan = Math.max((windowSize * 4) / samplingFrequency, 1e-3);
      const span = Math.min(Math.max(end - start, minSpan), maxSpan || minSpan);
      let s = start;
      let e = s + span;
      if (e > dataEnd) {
        e = dataEnd;
        s = e - span;
      }
      if (s < dataStart) {
        s = dataStart;
        e = Math.min(s + span, dataEnd);
      }
      return [s, e];
    },
    [dataStart, dataEnd, maxSpan, windowSize, samplingFrequency],
  );

  // --- pan / zoom interaction ---
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; range: [number, number] } | null>(null);

  // Prevent the page from scrolling while the wheel is used to zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

  const timeAtClientX = useCallback(
    (clientX: number, range: [number, number]) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return range[0];
      const x = clientX - rect.left;
      const frac = Math.min(Math.max((x - plotMargins.left) / plotW, 0), 1);
      return range[0] + frac * (range[1] - range[0]);
    },
    [plotW],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = { x: e.clientX, range: visRange };
    },
    [visRange],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const span = drag.range[1] - drag.range[0];
      const dt = (dx / plotW) * span;
      setVisRange(clampRange(drag.range[0] - dt, drag.range[1] - dt));
    },
    [plotW, clampRange],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY === 0) return;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setVisRange((prev) => {
        const tc = timeAtClientX(e.clientX, prev);
        const span = prev[1] - prev[0];
        const newSpan = span * factor;
        const frac = span > 0 ? (tc - prev[0]) / span : 0.5;
        const newStart = tc - frac * newSpan;
        return clampRange(newStart, newStart + newSpan);
      });
    },
    [timeAtClientX, clampRange],
  );

  const labeledField = (label: string, node: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ color: "#555", fontSize: 11 }}>{label}</span>
      {node}
    </label>
  );

  const visSpan = visRange[1] - visRange[0];

  return (
    <div style={{ width }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px 18px",
          padding: "6px 4px",
          fontSize: 13,
          alignItems: "flex-end",
        }}
      >
        {labeledField(
          `Channel (0-${numChannels - 1})`,
          <input
            type="number"
            min={0}
            max={numChannels - 1}
            value={channel}
            onChange={(e) =>
              setChannel(
                Math.max(
                  0,
                  Math.min(numChannels - 1, parseInt(e.target.value) || 0),
                ),
              )
            }
            style={{ width: 70 }}
          />,
        )}

        {labeledField(
          "FFT window (samples)",
          <select
            value={windowSize}
            onChange={(e) => setWindowSize(parseInt(e.target.value))}
          >
            {windowSizeOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>,
        )}

        {labeledField(
          `Max freq (Hz, ≤${nyquist.toFixed(0)})`,
          <input
            type="number"
            min={1}
            max={nyquist}
            value={freqMaxHz}
            onChange={(e) =>
              setFreqMaxHz(
                Math.max(1, Math.min(nyquist, parseFloat(e.target.value) || 1)),
              )
            }
            style={{ width: 80 }}
          />,
        )}

        {labeledField(
          "Colormap",
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColormapName)}
          >
            {colormapNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>,
        )}

        <button
          onClick={() =>
            setVisRange([dataStart, dataStart + Math.min(30, totalDuration)])
          }
          style={{
            padding: "5px 12px",
            border: "1px solid #dee2e6",
            borderRadius: 4,
            background: "#f8f9fa",
            cursor: "pointer",
          }}
        >
          Reset view
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#555", padding: "0 4px 4px" }}>
        Drag to pan · scroll to zoom · {samplingFrequency.toFixed(1)} Hz ·
        window {visSpan.toFixed(2)} s{loading ? " · updating…" : ""}
        {error ? <span style={{ color: "#e74c3c" }}> · {error}</span> : null}
      </div>

      <div
        ref={containerRef}
        style={{ cursor: dragRef.current ? "grabbing" : "grab", width }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={handleWheel}
      >
        <SpectrogramWidget
          result={result}
          width={width}
          height={plotHeight}
          colormap={colormap}
          visibleStartTimeSec={visRange[0]}
          visibleEndTimeSec={visRange[1]}
          freqMinHz={0}
          freqMaxHz={freqMaxHz}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default LfpSpectrogramView;
