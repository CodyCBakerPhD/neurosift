import { getHdf5Group } from "@hdf5Interface";
import { NwbObjectViewPlugin } from "../pluginInterface";
import { isTimeSeriesLikeGroup } from "./detection";
import TimeAlignedSeriesView from "./TimeAlignedSeriesView";

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
  // Show a "Time-aligned" button on a TimeIntervals table only when the file
  // also contains at least one compatible TimeSeries. The button opens the view
  // with the first compatible series as the default; the view offers a picker to
  // switch between the available series.
  getLaunchSecondaryPaths: ({ path, objectType, neurodataObjects }) => {
    if (objectType !== "group") return [];
    const primary = neurodataObjects.find((o) => o.path === path);
    if (!primary) return [];
    if (primary.attrs?.["neurodata_type"] !== "TimeIntervals") return [];
    const seriesPaths = neurodataObjects
      .filter((o) => o.group && isTimeSeriesLikeGroup(o.group.datasets))
      .map((o) => o.path);
    if (seriesPaths.length === 0) return [];
    return [[seriesPaths[0]]];
  },
  component: TimeAlignedSeriesView,
  // Launch from a dedicated button next to the object (like PSTH) rather than
  // rendering inline alongside the main timeseries view.
  launchableFromTable: true,
  requiresWindowDimensions: true,
};

export default timeAlignedSeriesPlugin;
