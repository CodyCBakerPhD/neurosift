export type SpectrogramInput = {
  // One signal per selected channel, already in physical units and all the
  // same length. When more than one is given, the power is averaged across
  // them (mean power spectrogram).
  signals: number[][];
  samplingFrequency: number;
  // Time (in seconds) corresponding to signal[0].
  signalStartTimeSec: number;
  // FFT window length in number of samples (should be a power of two).
  windowSize: number;
  // Fraction of overlap between consecutive windows in [0, 1). Used to derive
  // the hop size when hopSize is not given explicitly.
  overlap: number;
  // Explicit hop (step) between consecutive windows, in samples. When provided
  // it takes precedence over `overlap` — this is what the interactive view uses
  // to match the number of columns to the current zoom level.
  hopSize?: number;
};

export type SpectrogramResult = {
  // Row-major matrix of size numWindows x numFreqs holding power in dB.
  powers: number[];
  numWindows: number;
  numFreqs: number;
  // Center time (seconds) of the first window.
  firstWindowCenterTimeSec: number;
  // Time step (seconds) between consecutive windows.
  windowStepSec: number;
  // Frequency (Hz) of the first bin and spacing between bins.
  freqStartHz: number;
  freqStepHz: number;
  minPowerDb: number;
  maxPowerDb: number;
};
