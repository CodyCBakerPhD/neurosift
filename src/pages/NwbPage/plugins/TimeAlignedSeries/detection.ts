// True if the group looks like a TimeSeries with a sampled data array, i.e. it
// has a `data` dataset (1D single-channel or 2D time-by-channel) together with
// either explicit `timestamps` or a regular `starting_time`.
export const isTimeSeriesLikeGroup = (
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
