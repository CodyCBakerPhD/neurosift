import TimeseriesClient from "../simple-timeseries/TimeseriesClient";

export type AlignedTrial = {
  // Row index into the intervals table (preserved so group-by values can be
  // matched per row without reloading the snippet data).
  index: number;
  // Times relative to the alignment event (seconds).
  times: number[];
  // Signal values for a single channel over the snippet.
  roiValues: number[];
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
    maxIntervals: number;
    concurrency?: number;
    canceler?: { canceled: boolean };
    onProgress?: (loaded: number, total: number) => void;
  },
): Promise<AlignedTrial[]> => {
  const times = alignTimes.slice(0, opts.maxIntervals);
  const trials: (AlignedTrial | undefined)[] = new Array(times.length);
  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? 8, times.length),
  );
  // Clamp the channel defensively; the selected series may have fewer channels.
  const ch = Math.max(0, Math.min(channel, client.numChannels - 1));

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
        ch,
        ch + 1,
      );
      const values = data[0] || [];
      trials[i] = {
        index: i,
        times: timestamps.map((ts) => ts - t),
        roiValues: values,
      };
      loaded += 1;
      opts.onProgress?.(loaded, times.length);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return trials.filter((tr): tr is AlignedTrial => tr !== undefined);
};
