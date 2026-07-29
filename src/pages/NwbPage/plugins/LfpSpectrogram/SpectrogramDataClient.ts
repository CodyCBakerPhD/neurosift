import TimeseriesClient from "../simple-timeseries/TimeseriesClient";
import { SpectrogramInput, SpectrogramResult } from "./WorkerTypes";

// Target number of STFT columns computed per cached block. The visible window
// covers a quarter-to-eighth of a block, so this yields a few hundred columns
// across the view — plenty for a canvas that is then smoothly scaled.
const TARGET_COLUMNS_PER_BLOCK = 3000;

// Number of computed blocks to keep in memory (LRU).
const MAX_CACHED_BLOCKS = 8;

type BlockKey = string;

// Snap a visible range to a cached block: a power-of-two-sized span, aligned to
// a half-block grid, that is guaranteed to fully contain the view while staying
// stable across small pans/zooms so neighbouring views reuse the same block.
const computeBlock = (
  client: TimeseriesClient,
  visStartSec: number,
  visEndSec: number,
): { blockT1: number; blockT2: number } => {
  const dataStart = client.startTime;
  const dataEnd = client.endTime;
  const visSpan = Math.max(visEndSec - visStartSec, 1e-4);

  // Block span is at least 4x the visible span (one octave of headroom on each
  // side) so panning stays within the same block.
  const octave = Math.pow(2, Math.ceil(Math.log2(visSpan)));
  const blockSpan = octave * 4;
  const grid = blockSpan / 2;

  let blockT1 = Math.floor((visStartSec - dataStart) / grid) * grid + dataStart;
  if (blockT1 < dataStart) blockT1 = dataStart;
  let blockT2 = Math.min(blockT1 + blockSpan, dataEnd);
  // Guard against a view that pokes past the block near the data end.
  if (blockT2 < visEndSec) blockT2 = Math.min(visEndSec, dataEnd);

  return { blockT1, blockT2 };
};

export class SpectrogramDataClient {
  private cache = new Map<BlockKey, SpectrogramResult>();
  private requestIdCounter = 0;

  constructor(
    private client: TimeseriesClient,
    private worker: Worker,
    private params: { channel: number; windowSize: number },
  ) {}

  get startTime() {
    return this.client.startTime;
  }
  get endTime() {
    return this.client.endTime;
  }

  private keyFor(blockT1: number, blockT2: number): BlockKey {
    const { channel, windowSize } = this.params;
    return `${channel}|${windowSize}|${blockT1.toFixed(4)}|${blockT2.toFixed(4)}`;
  }

  // Return the spectrogram block covering the given visible range, computing and
  // caching it if necessary. Repeated/adjacent calls hit the cache.
  async getSpectrogram(
    visStartSec: number,
    visEndSec: number,
  ): Promise<SpectrogramResult> {
    const { blockT1, blockT2 } = computeBlock(
      this.client,
      visStartSec,
      visEndSec,
    );
    const key = this.keyFor(blockT1, blockT2);

    const cached = this.cache.get(key);
    if (cached) {
      // Refresh LRU order.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const fs = this.client.samplingFrequency;
    const { channel, windowSize } = this.params;

    const { data } = await this.client.getDataForTimeRange(
      blockT1,
      blockT2,
      channel,
      channel + 1,
    );
    const signal = data[0] || [];

    // Choose the hop so the block yields ~TARGET_COLUMNS_PER_BLOCK columns, but
    // never finer than a fraction of the window (avoids needless overlap).
    const blockSamples = signal.length;
    let hopSize = Math.max(
      1,
      Math.round(blockSamples / TARGET_COLUMNS_PER_BLOCK),
    );
    hopSize = Math.max(hopSize, Math.floor(windowSize / 8));

    const input: SpectrogramInput = {
      signal,
      samplingFrequency: fs,
      signalStartTimeSec: blockT1,
      windowSize,
      overlap: 0,
      hopSize,
    };

    const result = await this.computeInWorker(input);
    this.cache.set(key, result);
    while (this.cache.size > MAX_CACHED_BLOCKS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return result;
  }

  private computeInWorker(input: SpectrogramInput): Promise<SpectrogramResult> {
    const requestId = ++this.requestIdCounter;
    return new Promise<SpectrogramResult>((resolve, reject) => {
      const onMessage = (evt: MessageEvent) => {
        if (evt.data.requestId !== requestId) return;
        this.worker.removeEventListener("message", onMessage);
        if (evt.data.error) reject(new Error(evt.data.error));
        else resolve(evt.data.result);
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ requestId, input });
    });
  }
}

export default SpectrogramDataClient;
