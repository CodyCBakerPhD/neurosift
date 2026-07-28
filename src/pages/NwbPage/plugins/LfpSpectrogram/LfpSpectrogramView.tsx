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
import SpectrogramWidget from "./SpectrogramWidget";
import { SpectrogramInput, SpectrogramResult } from "./WorkerTypes";

type Props = {
  nwbUrl: string;
  path: string;
  width?: number;
  height?: number;
  condensed?: boolean;
};

// Cap the number of samples pulled into the browser for a single computation.
const MAX_SAMPLES = 2_000_000;

const windowSizeOptions = [128, 256, 512, 1024, 2048, 4096];
const overlapOptions = [0, 0.25, 0.5, 0.75];

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
      nwbUrl={nwbUrl}
      path={path}
      client={client}
      width={width}
      height={height}
      condensed={condensed}
    />
  );
};

type InnerProps = {
  nwbUrl: string;
  path: string;
  client: TimeseriesClient;
  width: number;
  height: number;
  condensed: boolean;
};

const LfpSpectrogramInner: FunctionComponent<InnerProps> = ({
  path,
  client,
  width,
  height,
  condensed,
}) => {
  const samplingFrequency = client.samplingFrequency;
  const nyquist = samplingFrequency / 2;
  const totalDuration = client.duration;
  const numChannels = client.numChannels;

  const [channel, setChannel] = useState(0);
  const [startTimeSec, setStartTimeSec] = useState(client.startTime);
  const [durationSec, setDurationSec] = useState(
    Math.min(60, totalDuration || 60),
  );
  const [windowSize, setWindowSize] = useState(512);
  const [overlap, setOverlap] = useState(0.5);
  const [colormap, setColormap] = useState<ColormapName>("viridis");
  const [freqMaxHz, setFreqMaxHz] = useState(Math.min(nyquist, 150));

  const [result, setResult] = useState<SpectrogramResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("./worker", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const estimatedSamples = useMemo(
    () => Math.round(durationSec * samplingFrequency),
    [durationSec, samplingFrequency],
  );
  const tooManySamples = estimatedSamples > MAX_SAMPLES;

  const handleCompute = useCallback(async () => {
    const worker = workerRef.current;
    if (!worker) return;
    if (tooManySamples) {
      setComputeError(
        `The selected window has ~${estimatedSamples.toLocaleString()} samples, ` +
          `which exceeds the limit of ${MAX_SAMPLES.toLocaleString()}. ` +
          `Reduce the duration.`,
      );
      return;
    }
    setComputing(true);
    setComputeError(null);
    setResult(null);
    setStatusMessage("Loading LFP data...");
    try {
      const tStart = Math.max(client.startTime, startTimeSec);
      const tEnd = Math.min(client.endTime, startTimeSec + durationSec);
      const { data } = await client.getDataForTimeRange(
        tStart,
        tEnd,
        channel,
        channel + 1,
      );
      const signal = data[0] || [];
      if (signal.length < windowSize) {
        throw new Error(
          `Loaded ${signal.length} samples, but the FFT window is ${windowSize}. ` +
            `Increase the duration or decrease the window size.`,
        );
      }
      setStatusMessage("Computing spectrogram...");
      const input: SpectrogramInput = {
        signal,
        samplingFrequency,
        signalStartTimeSec: tStart,
        windowSize,
        overlap,
      };
      const requestId = ++requestIdRef.current;
      const spectrogram = await new Promise<SpectrogramResult>(
        (resolve, reject) => {
          const onMessage = (evt: MessageEvent) => {
            if (evt.data.requestId !== requestId) return;
            worker.removeEventListener("message", onMessage);
            if (evt.data.error) reject(new Error(evt.data.error));
            else resolve(evt.data.result);
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({ requestId, input });
        },
      );
      setResult(spectrogram);
      setStatusMessage("");
    } catch (err) {
      setComputeError(err instanceof Error ? err.message : String(err));
      setStatusMessage("");
    } finally {
      setComputing(false);
    }
  }, [
    client,
    channel,
    startTimeSec,
    durationSec,
    windowSize,
    overlap,
    samplingFrequency,
    tooManySamples,
    estimatedSamples,
  ]);

  const freqResolution = samplingFrequency / windowSize;
  const timeResolution = (windowSize * (1 - overlap)) / samplingFrequency;

  const controlsHeight = condensed ? 150 : 176;
  const plotHeight = Math.max(200, height - controlsHeight);

  return (
    <div style={{ width }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px 20px",
          padding: "8px 4px",
          fontSize: 13,
          alignItems: "flex-end",
        }}
      >
        <LabeledField label={`Channel (0-${numChannels - 1})`}>
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
          />
        </LabeledField>

        <LabeledField label="Start (s)">
          <input
            type="number"
            step="0.1"
            value={startTimeSec}
            onChange={(e) => setStartTimeSec(parseFloat(e.target.value) || 0)}
            style={{ width: 90 }}
          />
        </LabeledField>

        <LabeledField label="Duration (s)">
          <input
            type="number"
            step="1"
            min={0}
            value={durationSec}
            onChange={(e) =>
              setDurationSec(Math.max(0, parseFloat(e.target.value) || 0))
            }
            style={{ width: 90 }}
          />
        </LabeledField>

        <LabeledField label="FFT window (samples)">
          <select
            value={windowSize}
            onChange={(e) => setWindowSize(parseInt(e.target.value))}
          >
            {windowSizeOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </LabeledField>

        <LabeledField label="Overlap">
          <select
            value={overlap}
            onChange={(e) => setOverlap(parseFloat(e.target.value))}
          >
            {overlapOptions.map((o) => (
              <option key={o} value={o}>
                {Math.round(o * 100)}%
              </option>
            ))}
          </select>
        </LabeledField>

        <LabeledField label={`Max freq (Hz, ≤${nyquist.toFixed(0)})`}>
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
          />
        </LabeledField>

        <LabeledField label="Colormap">
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColormapName)}
          >
            {colormapNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </LabeledField>

        <button
          onClick={handleCompute}
          disabled={computing}
          style={{
            padding: "6px 16px",
            backgroundColor: computing ? "#6c757d" : "#007bff",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: computing ? "default" : "pointer",
          }}
        >
          {computing ? "Computing..." : "Compute spectrogram"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#555", padding: "0 4px 6px" }}>
        Sampling rate: {samplingFrequency.toFixed(1)} Hz · Freq resolution:{" "}
        {freqResolution.toFixed(2)} Hz · Time resolution:{" "}
        {timeResolution.toFixed(3)} s
        {tooManySamples && (
          <span style={{ color: "#e67e22" }}>
            {" "}
            · Warning: selection has ~{estimatedSamples.toLocaleString()}{" "}
            samples (limit {MAX_SAMPLES.toLocaleString()})
          </span>
        )}
      </div>

      {computeError && (
        <div style={{ color: "#e74c3c", padding: "4px", fontSize: 13 }}>
          {computeError}
        </div>
      )}

      {statusMessage && (
        <div style={{ color: "#555", padding: "4px", fontSize: 13 }}>
          {statusMessage}
        </div>
      )}

      {result ? (
        <SpectrogramWidget
          result={result}
          width={width}
          height={plotHeight}
          colormap={colormap}
          freqMinHz={0}
          freqMaxHz={freqMaxHz}
        />
      ) : (
        !computing &&
        !computeError && (
          <div
            style={{
              width,
              height: plotHeight,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
              border: "1px dashed #ccc",
              boxSizing: "border-box",
            }}
          >
            Configure the parameters above and click "Compute spectrogram" to
            visualize {path.split("/").pop()}.
          </div>
        )
      )}
    </div>
  );
};

const LabeledField: FunctionComponent<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
    <span style={{ color: "#555", fontSize: 11 }}>{label}</span>
    {children}
  </label>
);

export default LfpSpectrogramView;
