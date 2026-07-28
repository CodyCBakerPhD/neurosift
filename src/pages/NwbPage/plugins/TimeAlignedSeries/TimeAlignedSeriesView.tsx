import { getHdf5DatasetData, getHdf5Group } from "@hdf5Interface";
import {
  CSSProperties,
  FunctionComponent,
  useEffect,
  useMemo,
  useState,
} from "react";
import AlignToSelectionComponent from "../PSTH/PSTHItemView/components/AlignToSelection";
import WindowRangeComponent from "../PSTH/PSTHItemView/components/WindowRange";
import TrialAlignedSeriesWidget from "../PSTH/PSTHItemView/TrialAlignedSeriesWidget";
import TimeseriesClient from "../simple-timeseries/TimeseriesClient";
import {
  AlignedTrial,
  loadTimeAlignedSnippets,
} from "./loadTimeAlignedSnippets";

type Props = {
  nwbUrl: string;
  path: string; // the TimeIntervals table
  secondaryPaths?: string[]; // [timeseriesPath]
  width?: number;
  height?: number;
  condensed?: boolean;
};

const accordionSummaryStyle: CSSProperties = {
  cursor: "pointer",
  padding: "4px 8px",
  fontWeight: "bold",
  backgroundColor: "#34495e",
  color: "#fff",
  userSelect: "none",
};

const seriesColor = "#1f77b4";

const TimeAlignedSeriesView: FunctionComponent<Props> = ({
  nwbUrl,
  path,
  secondaryPaths,
  width = 800,
  height = 800,
}) => {
  const seriesPath = secondaryPaths && secondaryPaths[0];

  const [client, setClient] = useState<TimeseriesClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setClient(null);
    setError(null);
    if (!seriesPath) {
      setError("No timeseries was selected to align.");
      return;
    }
    (async () => {
      try {
        const group = await getHdf5Group(nwbUrl, seriesPath);
        if (!group) throw new Error(`Unable to load group: ${seriesPath}`);
        const c = await TimeseriesClient.create(nwbUrl, group);
        if (!canceled) setClient(c);
      } catch (err) {
        if (!canceled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [nwbUrl, seriesPath]);

  if (error) {
    return <div style={{ padding: 12, color: "#e74c3c" }}>Error: {error}</div>;
  }
  if (!seriesPath) {
    return <div style={{ padding: 12 }}>No timeseries selected.</div>;
  }
  if (!client) {
    return <div style={{ padding: 12 }}>Loading timeseries...</div>;
  }

  return (
    <TimeAlignedSeriesInner
      nwbUrl={nwbUrl}
      intervalsPath={path}
      seriesPath={seriesPath}
      client={client}
      width={width}
      height={height}
    />
  );
};

type InnerProps = {
  nwbUrl: string;
  intervalsPath: string;
  seriesPath: string;
  client: TimeseriesClient;
  width: number;
  height: number;
};

type CommittedParams = {
  channel: number;
  alignToVariables: string[];
  windowRange: { start: number; end: number };
  maxTrials: number;
};

const TimeAlignedSeriesInner: FunctionComponent<InnerProps> = ({
  nwbUrl,
  intervalsPath,
  seriesPath,
  client,
  width,
  height,
}) => {
  const numChannels = client.numChannels;

  const [channel, setChannel] = useState(0);
  const [alignToVariables, setAlignToVariables] = useState<string[]>([
    "start_time",
  ]);
  const [windowRangeStr, setWindowRangeStr] = useState<{
    start: string;
    end: string;
  }>({ start: "-0.5", end: "1" });
  const [maxTrialsStr, setMaxTrialsStr] = useState("50");

  const parseParams = (): CommittedParams | { error: string } => {
    const start = parseFloat(windowRangeStr.start);
    const end = parseFloat(windowRangeStr.end);
    if (isNaN(start) || isNaN(end)) return { error: "Invalid window range." };
    if (end <= start)
      return { error: "Window end must be greater than start." };
    const maxTrials = parseInt(maxTrialsStr);
    if (isNaN(maxTrials) || maxTrials < 1)
      return { error: "Invalid maximum number of trials." };
    if (alignToVariables.length === 0)
      return { error: "Select at least one align-to column." };
    return {
      channel,
      alignToVariables: [...alignToVariables],
      windowRange: { start, end },
      maxTrials,
    };
  };

  const initialCommitted = useMemo<CommittedParams>(
    () => ({
      channel: 0,
      alignToVariables: ["start_time"],
      windowRange: { start: -0.5, end: 1 },
      maxTrials: 50,
    }),
    [],
  );
  const [committed, setCommitted] = useState<CommittedParams>(initialCommitted);
  const [paramError, setParamError] = useState<string | null>(null);

  const handleUpdate = () => {
    const parsed = parseParams();
    if ("error" in parsed) {
      setParamError(parsed.error);
      return;
    }
    setParamError(null);
    setCommitted(parsed);
  };

  const controlsWidth = 260;
  const plotAreaWidth = width - controlsWidth;
  const panelHeight = Math.min(
    height,
    committed.alignToVariables.length > 1 ? 420 : 520,
  );

  return (
    <div
      style={{
        position: "absolute",
        width,
        height,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: controlsWidth,
          height,
          overflowY: "auto",
          overflowX: "hidden",
          fontSize: "0.8em",
        }}
      >
        <details open>
          <summary style={accordionSummaryStyle}>Channel</summary>
          <div style={{ padding: "6px 8px" }}>
            <label>
              Channel (0&ndash;{numChannels - 1}):&nbsp;
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
            </label>
            <div style={{ color: "#666", marginTop: 4 }}>
              {numChannels} channel{numChannels === 1 ? "" : "s"} ·{" "}
              {client.samplingFrequency.toFixed(1)} Hz
            </div>
          </div>
        </details>
        <div style={{ height: 6 }} />
        <details open>
          <summary style={accordionSummaryStyle}>Align to</summary>
          <AlignToSelectionComponent
            alignToVariables={alignToVariables}
            setAlignToVariables={setAlignToVariables}
            nwbUrl={nwbUrl}
            path={intervalsPath}
          />
        </details>
        <div style={{ height: 6 }} />
        <details open>
          <summary style={accordionSummaryStyle}>Controls</summary>
          <div style={{ padding: "6px 8px" }}>
            <WindowRangeComponent
              windowRangeStr={windowRangeStr}
              setWindowRangeStr={setWindowRangeStr}
            />
            <br />
            <br />
            <label>
              Max trials:&nbsp;
              <input
                type="number"
                min={1}
                value={maxTrialsStr}
                onChange={(e) => setMaxTrialsStr(e.target.value)}
                style={{ width: 60 }}
              />
            </label>
            <div style={{ marginTop: 10 }}>
              <button
                onClick={handleUpdate}
                style={{
                  padding: "6px 16px",
                  backgroundColor: "#007bff",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Update
              </button>
            </div>
            {paramError && (
              <div style={{ color: "#e74c3c", marginTop: 6 }}>{paramError}</div>
            )}
          </div>
        </details>
      </div>

      <div
        style={{
          position: "absolute",
          left: controlsWidth,
          width: plotAreaWidth,
          height,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {committed.alignToVariables.length === 0 ? (
          <div style={{ padding: 12 }}>
            Select one or more align-to columns.
          </div>
        ) : (
          committed.alignToVariables.map((alignToVariable) => (
            <div
              key={alignToVariable}
              style={{
                position: "relative",
                width: plotAreaWidth - 20,
                height: panelHeight,
                marginBottom: 8,
              }}
            >
              <AlignedSeriesPanel
                nwbUrl={nwbUrl}
                intervalsPath={intervalsPath}
                seriesPath={seriesPath}
                client={client}
                alignToVariable={alignToVariable}
                channel={committed.channel}
                windowRange={committed.windowRange}
                maxTrials={committed.maxTrials}
                width={plotAreaWidth - 20}
                height={panelHeight}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

type PanelProps = {
  nwbUrl: string;
  intervalsPath: string;
  seriesPath: string;
  client: TimeseriesClient;
  alignToVariable: string;
  channel: number;
  windowRange: { start: number; end: number };
  maxTrials: number;
  width: number;
  height: number;
};

const AlignedSeriesPanel: FunctionComponent<PanelProps> = ({
  nwbUrl,
  intervalsPath,
  client,
  alignToVariable,
  channel,
  windowRange,
  maxTrials,
  width,
  height,
}) => {
  const [trials, setTrials] = useState<AlignedTrial[] | null>(null);
  const [numAlignTimes, setNumAlignTimes] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number }>({
    loaded: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const canceler = { canceled: false };
    setTrials(null);
    setError(null);
    setProgress({ loaded: 0, total: 0 });
    (async () => {
      try {
        const rawTimes = await getHdf5DatasetData(
          nwbUrl,
          intervalsPath + "/" + alignToVariable,
          {},
        );
        if (!rawTimes)
          throw new Error(`Unable to load ${intervalsPath}/${alignToVariable}`);
        const alignTimes = Array.from(rawTimes as ArrayLike<number>);
        if (canceled) return;
        setNumAlignTimes(alignTimes.length);
        const loaded = await loadTimeAlignedSnippets(
          client,
          alignTimes,
          channel,
          windowRange,
          {
            maxTrials,
            canceler,
            onProgress: (loadedCount, total) => {
              if (!canceled) setProgress({ loaded: loadedCount, total });
            },
          },
        );
        if (canceled) return;
        setTrials(loaded);
      } catch (err) {
        if (!canceled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      canceled = true;
      canceler.canceled = true;
    };
  }, [
    nwbUrl,
    intervalsPath,
    client,
    alignToVariable,
    channel,
    windowRange,
    maxTrials,
  ]);

  const groups = useMemo(() => [{ group: 0, color: seriesColor }], []);

  const titleHeight = 24;
  const widgetHeight = height - titleHeight;

  return (
    <div style={{ position: "absolute", width, height }}>
      <div
        style={{
          position: "absolute",
          width,
          height: titleHeight,
          fontWeight: "bold",
          textAlign: "center",
        }}
      >
        {alignToVariable}
        {numAlignTimes !== null && (
          <span style={{ fontWeight: "normal", color: "#666" }}>
            {" "}
            ({Math.min(numAlignTimes, maxTrials)}
            {numAlignTimes > maxTrials ? ` of ${numAlignTimes}` : ""} trials)
          </span>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          top: titleHeight,
          width,
          height: widgetHeight,
        }}
      >
        {error ? (
          <div style={{ padding: 12, color: "#e74c3c" }}>Error: {error}</div>
        ) : !trials ? (
          <div style={{ padding: 12, color: "#555" }}>
            Loading snippets... {progress.loaded}
            {progress.total ? ` / ${progress.total}` : ""}
          </div>
        ) : trials.length === 0 ? (
          <div style={{ padding: 12, color: "#555" }}>
            No trials to display.
          </div>
        ) : (
          <TrialAlignedSeriesWidget
            width={width}
            height={widgetHeight}
            trials={trials}
            groups={groups}
            windowRange={windowRange}
            alignmentVariableName={alignToVariable}
          />
        )}
      </div>
    </div>
  );
};

export default TimeAlignedSeriesView;
