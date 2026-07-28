import { getHdf5Group } from "@hdf5Interface";
import { NwbObjectViewPlugin } from "../pluginInterface";
import TimeAlignedSeriesView from "./TimeAlignedSeriesView";

// True if the group looks like a TimeSeries with a sampled data array, i.e. it
// has a `data` dataset (1D single-channel or 2D time-by-channel) together with
// either explicit `timestamps` or a regular `starting_time`.
const isTimeSeriesLikeGroup = (
  datasets: { name: string; shape: number[] }[],
): boolean => {
  const dataDataset = datasets.find((ds) => ds.name === "data");
  if (!dataDataset) return false;
  const numDims = dataDataset.shape.length || 0;
  if (![1, 2].includes(numDims)) return false;
  const hasTimestamps = datasets.some((ds) => ds.name === "timestamps");
  const hasStartTime = datasets.some((ds) => ds.name === "starting_time");
  return hasTimestamps || hasStartTime;
};

// A time-aligned view of any TimeSeries relative to the events of a
// TimeIntervals table. Like the PSTH, it extracts short snippets of the series
// before and after each `_time` column of the table, overlaid across
// repetitions, plus the trial-averaged trace.
export const timeAlignedSeriesPlugin: NwbObjectViewPlugin = {
  name: "TimeAlignedSeries",
  label: "Time-aligned",
  canHandle: async ({
    nwbUrl,
    path,
    objectType,
    secondaryPaths,
  }: {
    nwbUrl: string;
    path: string;
    objectType: "group" | "dataset";
    secondaryPaths?: string[];
  }) => {
    if (objectType !== "group") return false;
    if (!secondaryPaths) return false;
    if (secondaryPaths.length !== 1) return false;

    // Primary object must be a TimeIntervals table.
    const group = await getHdf5Group(nwbUrl, path);
    if (!group) return false;
    if (group.attrs["neurodata_type"] !== "TimeIntervals") return false;

    // Secondary object must be a timeseries-like group.
    const secondaryGroup = await getHdf5Group(nwbUrl, secondaryPaths[0]);
    if (!secondaryGroup) return false;
    return isTimeSeriesLikeGroup(secondaryGroup.datasets);
  },
  component: TimeAlignedSeriesView,
  // Launch from a dedicated button next to the object (like PSTH) rather than
  // rendering inline alongside the main timeseries view.
  launchableFromTable: true,
  requiresWindowDimensions: true,
};

export default timeAlignedSeriesPlugin;
