import { fftInPlace } from "./fft";
import { SpectrogramInput, SpectrogramResult } from "./WorkerTypes";

// Compute a spectrogram. To avoid aliasing along the time axis when the display
// needs fewer columns than the data supports, the STFT is evaluated at a fixed
// fine analysis step (50% overlap) over *all* samples, and the power of every
// analysis window is averaged into the output column that covers it. That
// averaging is the anti-alias (low-pass) step that must precede decimating the
// time axis. Frequency is never decimated — each window is a full-rate FFT — so
// no frequency folding occurs. When several signals are given (one per selected
// channel) their linear power is averaged too (mean power spectrogram).
export const computeSpectrogram = (
  input: SpectrogramInput,
): SpectrogramResult => {
  const { signals, samplingFrequency, signalStartTimeSec, windowSize } = input;
  const numSignals = signals.length;
  const signalLength = numSignals > 0 ? signals[0].length : 0;

  if (windowSize < 2 || (windowSize & (windowSize - 1)) !== 0) {
    throw new Error("windowSize must be a power of two >= 2");
  }

  const numFreqs = windowSize / 2 + 1;

  // Fine analysis step: 50% overlap, using every sample of the block.
  const analysisStep = Math.max(1, Math.floor(windowSize / 2));
  const numAnalysis =
    numSignals > 0 && signalLength >= windowSize
      ? 1 + Math.floor((signalLength - windowSize) / analysisStep)
      : 0;

  const numColumns = Math.max(
    0,
    Math.min(Math.max(Math.floor(input.targetColumns), 1), numAnalysis),
  );

  // Hann window and its power (for PSD normalization).
  const window = new Float64Array(windowSize);
  let windowPower = 0;
  for (let i = 0; i < windowSize; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    window[i] = w;
    windowPower += w * w;
  }
  const scale = 1 / (samplingFrequency * windowPower);

  const re = new Float64Array(windowSize);
  const im = new Float64Array(windowSize);

  // Accumulate linear PSD per output column (summed over the analysis windows
  // that fall in the column and over channels), plus a contribution count.
  const colAccum = new Float64Array(numColumns * numFreqs);
  const colContrib = new Float64Array(numColumns);

  for (let a = 0; a < numAnalysis; a++) {
    const offset = a * analysisStep;
    const c = Math.floor((a * numColumns) / numAnalysis);
    const base = c * numFreqs;
    for (let s = 0; s < numSignals; s++) {
      const signal = signals[s];

      let mean = 0;
      for (let i = 0; i < windowSize; i++) mean += signal[offset + i];
      mean /= windowSize;

      for (let i = 0; i < windowSize; i++) {
        re[i] = (signal[offset + i] - mean) * window[i];
        im[i] = 0;
      }
      fftInPlace(re, im);

      for (let f = 0; f < numFreqs; f++) {
        const mag2 = re[f] * re[f] + im[f] * im[f];
        const doubled = f === 0 || f === windowSize / 2 ? mag2 : mag2 * 2;
        colAccum[base + f] += doubled * scale;
      }
      colContrib[c] += 1;
    }
  }

  const powers: number[] = new Array(numColumns * numFreqs);
  let minPowerDb = Number.POSITIVE_INFINITY;
  let maxPowerDb = Number.NEGATIVE_INFINITY;

  for (let c = 0; c < numColumns; c++) {
    const contrib = colContrib[c] || 1;
    const base = c * numFreqs;
    for (let f = 0; f < numFreqs; f++) {
      let psd = colAccum[base + f] / contrib;
      if (!(psd > 0)) psd = 1e-20;
      const db = 10 * Math.log10(psd);
      powers[base + f] = db;
      if (db < minPowerDb) minPowerDb = db;
      if (db > maxPowerDb) maxPowerDb = db;
    }
  }

  if (!isFinite(minPowerDb)) minPowerDb = 0;
  if (!isFinite(maxPowerDb)) maxPowerDb = 1;

  const groupSize = numColumns > 0 ? numAnalysis / numColumns : 1;
  const windowStepSec = (groupSize * analysisStep) / samplingFrequency;
  const firstWindowCenterTimeSec =
    signalStartTimeSec +
    (windowSize / 2 + ((groupSize - 1) / 2) * analysisStep) / samplingFrequency;
  const freqStepHz = samplingFrequency / windowSize;

  return {
    powers,
    numWindows: numColumns,
    numFreqs,
    firstWindowCenterTimeSec,
    windowStepSec,
    freqStartHz: 0,
    freqStepHz,
    minPowerDb,
    maxPowerDb,
  };
};
