import { fftInPlace } from "./fft";
import { SpectrogramInput, SpectrogramResult } from "./WorkerTypes";

// Compute a short-time Fourier transform (spectrogram). Returns power spectral
// density in dB for a stack of overlapping Hann-windowed segments; the frequency
// axis is one-sided (0 .. Nyquist). When several signals are given (one per
// selected channel) their linear power is averaged before the dB conversion.
export const computeSpectrogram = (
  input: SpectrogramInput,
): SpectrogramResult => {
  const { signals, samplingFrequency, signalStartTimeSec, windowSize } = input;
  const overlap = Math.min(Math.max(input.overlap, 0), 0.95);
  const numSignals = signals.length;
  const signalLength = numSignals > 0 ? signals[0].length : 0;

  if (windowSize < 2 || (windowSize & (windowSize - 1)) !== 0) {
    throw new Error("windowSize must be a power of two >= 2");
  }

  // Prefer an explicit hop (used by the interactive view to match the zoom
  // level); otherwise derive it from the requested overlap fraction.
  const step =
    input.hopSize && input.hopSize > 0
      ? Math.max(1, Math.floor(input.hopSize))
      : Math.max(1, Math.floor(windowSize * (1 - overlap)));
  const numFreqs = windowSize / 2 + 1;

  // Precompute a Hann window and its power (for PSD normalization).
  const window = new Float64Array(windowSize);
  let windowPower = 0;
  for (let i = 0; i < windowSize; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    window[i] = w;
    windowPower += w * w;
  }
  const scale = 1 / (samplingFrequency * windowPower);

  const numWindows =
    numSignals > 0 && signalLength >= windowSize
      ? 1 + Math.floor((signalLength - windowSize) / step)
      : 0;

  const powers: number[] = new Array(numWindows * numFreqs);
  const re = new Float64Array(windowSize);
  const im = new Float64Array(windowSize);
  const psdAcc = new Float64Array(numFreqs);

  let minPowerDb = Number.POSITIVE_INFINITY;
  let maxPowerDb = Number.NEGATIVE_INFINITY;

  for (let w = 0; w < numWindows; w++) {
    const offset = w * step;
    psdAcc.fill(0);

    for (let s = 0; s < numSignals; s++) {
      const signal = signals[s];

      // Remove the segment mean (detrend) before windowing.
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
        // One-sided PSD: double all bins except DC and Nyquist.
        const doubled = f === 0 || f === windowSize / 2 ? mag2 : mag2 * 2;
        psdAcc[f] += doubled * scale;
      }
    }

    for (let f = 0; f < numFreqs; f++) {
      // Mean power across the selected channels.
      let psd = psdAcc[f] / numSignals;
      if (!(psd > 0)) psd = 1e-20;
      const db = 10 * Math.log10(psd);
      powers[w * numFreqs + f] = db;
      if (db < minPowerDb) minPowerDb = db;
      if (db > maxPowerDb) maxPowerDb = db;
    }
  }

  if (!isFinite(minPowerDb)) minPowerDb = 0;
  if (!isFinite(maxPowerDb)) maxPowerDb = 1;

  const windowStepSec = step / samplingFrequency;
  const firstWindowCenterTimeSec =
    signalStartTimeSec + windowSize / 2 / samplingFrequency;
  const freqStepHz = samplingFrequency / windowSize;

  return {
    powers,
    numWindows,
    numFreqs,
    firstWindowCenterTimeSec,
    windowStepSec,
    freqStartHz: 0,
    freqStepHz,
    minPowerDb,
    maxPowerDb,
  };
};
