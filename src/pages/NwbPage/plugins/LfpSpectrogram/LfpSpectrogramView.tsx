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
import { ControlButton } from "../common/components/ControlButton";
import TimeseriesClient from "../simple-timeseries/TimeseriesClient";
import ChannelSelector from "./ChannelSelector";
import { ColormapName, colormapNames } from "./colormap";
import { plotMargins } from "./plotConstants";
import SpectrogramDataClient, {
  limitChannels,
  MAX_AVG_CHANNELS,
} from "./SpectrogramDataClient";
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

// Height of each stacked spectrogram in per-channel mode.
const PER_CHANNEL_PANEL_HEIGHT = 200;

type ChannelMode = "mean" | "perChannel";

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

// A single spectrogram panel: owns the caching data client and the debounced
// fetch for its channel set, and renders the widget for the shared visible
// range. Used both for the averaged view and for one-per-channel stacking.
type PanelProps = {
  client: TimeseriesClient;
  worker: Worker;
  channels: number[];
  windowSize: number;
  visRange: [number, number];
  width: number;
  height: number;
  colormap: ColormapName;
  freqMaxHz: number;
  label?: string;
};

const SpectrogramPanel: FunctionComponent<PanelProps> = ({
  client,
  worker,
  channels,
  windowSize,
  visRange,
  width,
  height,
  colormap,
  freqMaxHz,
  label,
}) => {
  const [result, setResult] = useState<SpectrogramResult | null>(null);
  const [loading, setLoading] = useState(false);

  const channelsKey = channels.join(",");
  const dataClient = useMemo(
    () => new SpectrogramDataClient(client, worker, { channels, windowSize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, worker, channelsKey, windowSize],
  );

  const reqRef = useRef(0);
  useEffect(() => {
    if (channels.length === 0) {
      setResult(null);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => {
      const reqId = ++reqRef.current;
      setLoading(true);
      dataClient
        .getSpectrogram(visRange[0], visRange[1])
        .then((r) => {
          if (reqId !== reqRef.current) return;
          setResult(r);
          setLoading(false);
        })
        .catch(() => {
          if (reqId !== reqRef.current) return;
          setLoading(false);
        });
    }, 40);
    return () => clearTimeout(handle);
  }, [dataClient, visRange, channels.length]);

  return (
    <div>
      {label !== undefined && (
        <div
          style={{
            fontSize: 11,
            color: "#495057",
            padding: "2px 0 0 6px",
            fontWeight: 500,
          }}
        >
          {label}
        </div>
      )}
      <SpectrogramWidget
        result={result}
        width={width}
        height={height}
        colormap={colormap}
        visibleStartTimeSec={visRange[0]}
        visibleEndTimeSec={visRange[1]}
        freqMinHz={0}
        freqMaxHz={freqMaxHz}
        loading={loading}
      />
    </div>
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

  const [selectedChannels, setSelectedChannels] = useState<number[]>([0]);
  const [windowSize, setWindowSize] = useState(512);
  const [colormap, setColormap] = useState<ColormapName>("viridis");
  const [freqMaxHz, setFreqMaxHz] = useState(Math.min(nyquist, 150));
  const [channelMode, setChannelMode] = useState<ChannelMode>("mean");

  // Visible time window (seconds).
  const [visRange, setVisRange] = useState<[number, number]>(() => [
    dataStart,
    dataStart + Math.min(30, totalDuration || 30),
  ]);

  // A single long-lived compute worker; each panel's data client wraps it.
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

  const plotHeight = Math.max(200, height - (condensed ? 70 : 96));
  const plotW = width - plotMargins.left - plotMargins.right;

  // Channels shown, bounded (averaged together, or one panel each).
  const shownChannels = useMemo(
    () => limitChannels(selectedChannels, MAX_AVG_CHANNELS),
    [selectedChannels],
  );
  const numShown = shownChannels.length;

  // Widest allowed window: keeps a block's total sample load (across the shown
  // channels, whether averaged or stacked) under MAX_BLOCK_SAMPLES. A block
  // spans up to ~8x the visible window.
  const maxSpan = useMemo(
    () =>
      Math.min(
        totalDuration,
        MAX_BLOCK_SAMPLES / (8 * samplingFrequency * Math.max(numShown, 1)),
      ),
    [totalDuration, samplingFrequency, numShown],
  );

  // Narrowest allowed window (a handful of FFT windows).
  const minSpan = useMemo(
    () => Math.max((windowSize * 4) / samplingFrequency, 1e-3),
    [windowSize, samplingFrequency],
  );

  const clampRange = useCallback(
    (start: number, end: number): [number, number] => {
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
    [dataStart, dataEnd, maxSpan, minSpan],
  );

  // Button-driven zoom (about the view centre) and horizontal scroll.
  const zoomByFactor = useCallback(
    (factor: number) => {
      setVisRange((prev) => {
        const center = (prev[0] + prev[1]) / 2;
        const newSpan = (prev[1] - prev[0]) * factor;
        return clampRange(center - newSpan / 2, center + newSpan / 2);
      });
    },
    [clampRange],
  );

  const panByFraction = useCallback(
    (frac: number) => {
      setVisRange((prev) => {
        const dt = frac * (prev[1] - prev[0]);
        return clampRange(prev[0] + dt, prev[1] + dt);
      });
    },
    [clampRange],
  );

  // --- pan / zoom interaction ---
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; range: [number, number] } | null>(null);

  // Wheel-to-zoom only in mean mode; in per-channel mode the wheel is left to
  // scroll the stack of panels vertically (zoom via the buttons instead).
  const wheelZoom = channelMode === "mean";

  // Prevent the page from scrolling while the wheel is used to zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !wheelZoom) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, [wheelZoom]);

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
      if (!wheelZoom) return;
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
    [wheelZoom, timeAtClientX, clampRange],
  );

  const labeledField = (label: string, node: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ color: "#555", fontSize: 11 }}>{label}</span>
      {node}
    </label>
  );

  const visSpan = visRange[1] - visRange[0];
  const numSel = selectedChannels.length;
  const capped = numSel > MAX_AVG_CHANNELS;
  const channelsNote =
    numSel === 0
      ? "no channels selected"
      : channelMode === "mean"
        ? numSel === 1
          ? "1 channel"
          : capped
            ? `avg of ${MAX_AVG_CHANNELS} of ${numSel} channels`
            : `avg of ${numSel} channels`
        : capped
          ? `${MAX_AVG_CHANNELS} of ${numSel} channels`
          : `${numSel} channel${numSel === 1 ? "" : "s"}`;

  const eps = 1e-6;
  const canZoomIn = visSpan > minSpan + eps;
  const canZoomOut = visSpan < maxSpan - eps;
  const canPanLeft = visRange[0] > dataStart + eps;
  const canPanRight = visRange[1] < dataEnd - eps;

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
          "Channels",
          <ChannelSelector
            numChannels={numChannels}
            selected={selectedChannels}
            setSelected={setSelectedChannels}
          />,
        )}

        {labeledField(
          "Multiple channels",
          <select
            value={channelMode}
            onChange={(e) => setChannelMode(e.target.value as ChannelMode)}
          >
            <option value="mean">Mean (one spectrogram)</option>
            <option value="perChannel">Separate (one per channel)</option>
          </select>,
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
          "Max freq (Hz)",
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          padding: "2px 4px 4px",
        }}
      >
        <ControlButton
          onClick={() => zoomByFactor(0.5)}
          disabled={!canZoomIn}
          title="Zoom in (shorter time window)"
        >
          🔍+
        </ControlButton>
        <ControlButton
          onClick={() => zoomByFactor(2)}
          disabled={!canZoomOut}
          title="Zoom out (longer time window)"
        >
          🔍-
        </ControlButton>
        <ControlButton
          onClick={() => panByFraction(-0.8)}
          disabled={!canPanLeft}
          title="Scroll back in time"
        >
          ←
        </ControlButton>
        <ControlButton
          onClick={() => panByFraction(0.8)}
          disabled={!canPanRight}
          title="Scroll forward in time"
        >
          →
        </ControlButton>
        <span style={{ fontSize: 12, color: "#555", marginLeft: 8 }}>
          {channelsNote} · {samplingFrequency.toFixed(1)} Hz · window{" "}
          {visSpan.toFixed(2)} s ·{" "}
          {wheelZoom
            ? "drag/scroll to navigate"
            : "drag or buttons to navigate"}
        </span>
      </div>

      <div
        ref={containerRef}
        style={{
          cursor: dragRef.current ? "grabbing" : "grab",
          width,
          ...(channelMode === "perChannel"
            ? { maxHeight: plotHeight, overflowY: "auto" as const }
            : {}),
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={handleWheel}
      >
        {!worker ? null : channelMode === "mean" ? (
          <SpectrogramPanel
            client={client}
            worker={worker}
            channels={selectedChannels}
            windowSize={windowSize}
            visRange={visRange}
            width={width}
            height={plotHeight}
            colormap={colormap}
            freqMaxHz={freqMaxHz}
          />
        ) : (
          shownChannels.map((ch) => (
            <SpectrogramPanel
              key={ch}
              client={client}
              worker={worker}
              channels={[ch]}
              windowSize={windowSize}
              visRange={visRange}
              width={width}
              height={PER_CHANNEL_PANEL_HEIGHT}
              colormap={colormap}
              freqMaxHz={freqMaxHz}
              label={`Channel ${ch}`}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default LfpSpectrogramView;
