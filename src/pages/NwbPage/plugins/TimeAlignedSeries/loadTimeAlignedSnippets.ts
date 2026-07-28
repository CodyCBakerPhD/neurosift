import TimeseriesClient from "../simple-timeseries/TimeseriesClient";

export type AlignedTrial = {
  // Times relative to the alignment event (seconds).
  times: number[];
  // Signal values for a single channel over the snippet.
  roiValues: number[];
  // Group is unused here (single group) but kept for widget compatibility.
  group: number;
};

// Extract short snippets of a single channel of a TimeSeries around each
// alignment time. Each snippet spans [alignTime + windowStart, alignTime +
// windowEnd] and its timestamps are shifted so that the alignment event sits at
// t = 0. Reads are issued with a small amount of concurrency to stay responsive
// without overwhelming the remote HDF5 reader.
export const loadTimeAlignedSnippets = async (
  client: TimeseriesClient,
  alignTimes: number[],
  channel: number,
  windowRange: { start: number; end: number },
  opts: {
    maxTrials: number;
    concurrency?: number;
    canceler?: { canceled: boolean };
    onProgress?: (loaded: number, total: number) => void;
  },
): Promise<AlignedTrial[]> => {
  const times = alignTimes.slice(0, opts.maxTrials);
  const trials: (AlignedTrial | undefined)[] = new Array(times.length);
  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? 8, times.length),
  );

  let nextIndex = 0;
  let loaded = 0;

  const worker = async () => {
    for (;;) {
      const i = nextIndex++;
      if (i >= times.length) break;
      if (opts.canceler?.canceled) break;
      const t = times[i];
      const { timestamps, data } = await client.getDataForTimeRange(
        t + windowRange.start,
        t + windowRange.end,
        channel,
        channel + 1,
      );
      const values = data[0] || [];
      trials[i] = {
        times: timestamps.map((ts) => ts - t),
        roiValues: values,
        group: 0,
      };
      loaded += 1;
      opts.onProgress?.(loaded, times.length);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return trials.filter((tr): tr is AlignedTrial => tr !== undefined);
};
