import { getHdf5DatasetData, getHdf5Group } from "@hdf5Interface";
import {
  CSSProperties,
  FunctionComponent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNeurodataObjects } from "../../useNeurodataObjects";
import AlignToSelectionComponent from "../PSTH/PSTHItemView/components/AlignToSelection";
import WindowRangeComponent from "../PSTH/PSTHItemView/components/WindowRange";
import TrialAlignedSeriesWidget from "../PSTH/PSTHItemView/TrialAlignedSeriesWidget";
import TimeseriesClient from "../simple-timeseries/TimeseriesClient";
import { isTimeSeriesLikeGroup } from "./detection";
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

const shortName = (path: string) =>
  path.split("/").filter(Boolean).pop() || path;

const TimeAlignedSeriesView: FunctionComponent<Props> = ({
  nwbUrl,
  path,
  secondaryPaths,
  width = 800,
  height = 800,
}) => {
  const { neurodataObjects } = useNeurodataObjects(nwbUrl);

  // All timeseries-like objects in the file are candidate series to align.
  const seriesOptions = useMemo(
    () =>
      neurodataObjects
        .filter((o) => o.group && isTimeSeriesLikeGroup(o.group.datasets))
        .map((o) => o.path),
    [neurodataObjects],
  );

  const initialSeries = secondaryPaths && secondaryPaths[0];
  const [selectedSeriesPath, setSelectedSeriesPath] = useState<
    string | undefined
  >(initialSeries);

  // Once the object list is known, make sure a valid series is selected.
  useEffect(() => {
    if (selectedSeriesPath && seriesOptions.includes(selectedSeriesPath))
      return;
    if (initialSeries && seriesOptions.includes(initialSeries)) {
      setSelectedSeriesPath(initialSeries);
      return;
    }
    // Keep an externally-provided series even before the object list resolves.
    if (initialSeries && seriesOptions.length === 0) return;
    if (seriesOptions.length > 0) setSelectedSeriesPath(seriesOptions[0]);
  }, [seriesOptions, initialSeries, selectedSeriesPath]);

  if (!selectedSeriesPath) {
    if (seriesOptions.length === 0 && neurodataObjects.length > 0) {
      return (
        <div style={{ padding: 12 }}>
          No compatible TimeSeries found in this file.
        </div>
      );
    }
    return <div style={{ padding: 12 }}>Loading timeseries...</div>;
  }

  return (
    <TimeAlignedSeriesInner
      nwbUrl={nwbUrl}
      intervalsPath={path}
      seriesPath={selectedSeriesPath}
      seriesOptions={seriesOptions}
      setSeriesPath={setSelectedSeriesPath}
      width={width}
      height={height}
    />
  );
};

type InnerProps = {
  nwbUrl: string;
  intervalsPath: string;
  seriesPath: string;
  seriesOptions: string[];
  setSeriesPath: (p: string) => void;
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
  seriesOptions,
  setSeriesPath,
  width,
  height,
}) => {
  // Load a client for the selected series. Keep the previous client visible
  // while a new series loads so the controls and existing plots don't flicker.
  const [client, setClient] = useState<TimeseriesClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setClientError(null);
    (async () => {
      try {
        const group = await getHdf5Group(nwbUrl, seriesPath);
        if (!group) throw new Error(`Unable to load group: ${seriesPath}`);
        const c = await TimeseriesClient.create(nwbUrl, group);
        if (!canceled) setClient(c);
      } catch (err) {
        if (!canceled) {
          setClient(null);
          setClientError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [nwbUrl, seriesPath]);

  const numChannels = client ? client.numChannels : 1;

  const [channel, setChannel] = useState(0);
  const [alignToVariables, setAlignToVariables] = useState<string[]>([
    "start_time",
  ]);
  const [windowRangeStr, setWindowRangeStr] = useState<{
    start: string;
    end: string;
  }>({ start: "-0.5", end: "1" });
  const [maxTrialsStr, setMaxTrialsStr] = useState("50");

  // Display options apply live (no data reload needed).
  const [showRawTraces, setShowRawTraces] = useState(true);
  const [rawTraceAlpha, setRawTraceAlpha] = useState(0.4);
  const [showStdBand, setShowStdBand] = useState(true);
  const [stdMultipleStr, setStdMultipleStr] = useState("1");
  const stdMultiple = useMemo(() => {
    const v = parseFloat(stdMultipleStr);
    return isNaN(v) || v < 0 ? 1 : v;
  }, [stdMultipleStr]);

  // Keep the channel selection within range when the series changes.
  useEffect(() => {
    if (client && channel > client.numChannels - 1) {
      setChannel(Math.max(0, client.numChannels - 1));
    }
  }, [client, channel]);

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
          <summary style={accordionSummaryStyle}>Timeseries</summary>
          <div style={{ padding: "6px 8px" }}>
            <select
              value={seriesPath}
              onChange={(e) => setSeriesPath(e.target.value)}
              style={{ width: "100%" }}
              disabled={seriesOptions.length <= 1}
            >
              {(seriesOptions.includes(seriesPath)
                ? seriesOptions
                : [seriesPath, ...seriesOptions]
              ).map((p) => (
                <option key={p} value={p} title={p}>
                  {shortName(p)}
                </option>
              ))}
            </select>
            <div
              style={{
                color: "#666",
                marginTop: 4,
                wordBreak: "break-all",
                fontSize: "0.9em",
              }}
            >
              {seriesPath}
            </div>
          </div>
        </details>
        <div style={{ height: 6 }} />
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
                disabled={!client}
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
              {client
                ? `${numChannels} channel${numChannels === 1 ? "" : "s"} · ${client.samplingFrequency.toFixed(1)} Hz`
                : "Loading series..."}
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
        <div style={{ height: 6 }} />
        <details open>
          <summary style={accordionSummaryStyle}>Display</summary>
          <div style={{ padding: "6px 8px" }}>
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={showRawTraces}
                onChange={(e) => setShowRawTraces(e.target.checked)}
              />
              &nbsp;Show raw traces
            </label>
            <div
              style={{
                marginTop: 6,
                opacity: showRawTraces ? 1 : 0.4,
              }}
            >
              <label>
                Opacity: {rawTraceAlpha.toFixed(2)}
                <br />
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={rawTraceAlpha}
                  disabled={!showRawTraces}
                  onChange={(e) => setRawTraceAlpha(parseFloat(e.target.value))}
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            <hr style={{ margin: "8px 0", borderColor: "#dde4ed" }} />
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={showStdBand}
                onChange={(e) => setShowStdBand(e.target.checked)}
              />
              &nbsp;&plusmn;Std band (dashed)
            </label>
            <div style={{ marginTop: 6, opacity: showStdBand ? 1 : 0.4 }}>
              <label>
                Multiple (&sigma;):&nbsp;
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={stdMultipleStr}
                  disabled={!showStdBand}
                  onChange={(e) => setStdMultipleStr(e.target.value)}
                  style={{ width: 60 }}
                />
              </label>
            </div>
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
        {clientError ? (
          <div style={{ padding: 12, color: "#e74c3c" }}>
            Error loading series: {clientError}
          </div>
        ) : !client ? (
          <div style={{ padding: 12, color: "#555" }}>Loading series...</div>
        ) : committed.alignToVariables.length === 0 ? (
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
                showRawTraces={showRawTraces}
                rawTraceAlpha={rawTraceAlpha}
                showStdBand={showStdBand}
                stdMultiple={stdMultiple}
                yAxisLabel={`ch ${committed.channel}`}
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
  showRawTraces: boolean;
  rawTraceAlpha: number;
  showStdBand: boolean;
  stdMultiple: number;
  yAxisLabel: string;
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
  showRawTraces,
  rawTraceAlpha,
  showStdBand,
  stdMultiple,
  yAxisLabel,
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
            showRawTraces={showRawTraces}
            rawTraceAlpha={rawTraceAlpha}
            showStdBand={showStdBand}
            stdMultiple={stdMultiple}
            yAxisLabel={yAxisLabel}
          />
        )}
      </div>
    </div>
  );
};

export default TimeAlignedSeriesView;
