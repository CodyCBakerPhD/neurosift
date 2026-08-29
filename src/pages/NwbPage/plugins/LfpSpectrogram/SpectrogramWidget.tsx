import { FunctionComponent, useEffect, useMemo, useRef } from "react";
import { applyColormap, ColormapName } from "./colormap";
import { plotMargins } from "./plotConstants";
import { SpectrogramResult } from "./WorkerTypes";

export type NormalizationMode = "none" | "whiten";

type Props = {
  // The computed spectrogram block (covers a range at least as wide as the
  // visible window). May be null while the first block is loading.
  result: SpectrogramResult | null;
  width: number;
  height: number;
  colormap: ColormapName;
  // Visible time window (seconds); columns are positioned by absolute time so
  // panning/zooming is just a redraw of the cached block.
  visibleStartTimeSec: number;
  visibleEndTimeSec: number;
  // Displayed frequency range (Hz) — the y-axis view (does not remove data).
  freqMinHz: number;
  freqMaxHz: number;
  // Band-pass cutoffs (Hz): frequency content outside [highPass, lowPass] is
  // removed from the displayed spectrogram (shown dark), separate from the
  // display range above.
  highPassHz: number;
  lowPassHz: number;
  // Power normalization: "whiten" multiplies power by frequency (1/f whitening)
  // so the broadband 1/f tilt is flattened.
  normalization: NormalizationMode;
  loading?: boolean;
};

const margins = plotMargins;

// Colour used for frequency bins removed by the band-pass filter.
const FILTERED_RGB: [number, number, number] = [28, 28, 28];

const SpectrogramWidget: FunctionComponent<Props> = ({
  result,
  width,
  height,
  colormap,
  visibleStartTimeSec,
  visibleEndTimeSec,
  freqMinHz,
  freqMaxHz,
  highPassHz,
  lowPassHz,
  normalization,
  loading,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Build the offscreen bitmap for the block, applying 1/f whitening and the
  // band-pass mask per frequency row, and derive the colour scale from the
  // in-band (post-normalization) values. All of this is at render time, so
  // changing normalization/cutoffs is instant and needs no recompute.
  const { offscreen, vMin, vMax } = useMemo(() => {
    if (!result || result.numWindows === 0 || result.numFreqs === 0) {
      return { offscreen: null, vMin: 0, vMax: 1 };
    }
    const { numWindows, numFreqs, powers, freqStartHz, freqStepHz } = result;
    const whiten = normalization === "whiten";

    // Per-frequency: is the bin in the pass band, and its whitening offset (dB).
    const inBand = new Uint8Array(numFreqs);
    const whitenOffsetDb = new Float64Array(numFreqs);
    for (let f = 0; f < numFreqs; f++) {
      const freq = freqStartHz + f * freqStepHz;
      const passes = freq >= highPassHz && freq <= lowPassHz;
      if (whiten) {
        // 1/f whitening = multiply power by frequency; DC has no defined tilt.
        inBand[f] = passes && freq > 0 ? 1 : 0;
        whitenOffsetDb[f] = freq > 0 ? 10 * Math.log10(freq) : 0;
      } else {
        inBand[f] = passes ? 1 : 0;
      }
    }

    // Colour-scale range over the in-band, normalized values.
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let w = 0; w < numWindows; w++) {
      const base = w * numFreqs;
      for (let f = 0; f < numFreqs; f++) {
        if (!inBand[f]) continue;
        const v = powers[base + f] + whitenOffsetDb[f];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (!isFinite(mn) || !isFinite(mx)) {
      mn = 0;
      mx = 1;
    }
    if (mx === mn) mx = mn + 1;
    const span = mx - mn;

    const img = new ImageData(numWindows, numFreqs);
    for (let w = 0; w < numWindows; w++) {
      const base = w * numFreqs;
      for (let f = 0; f < numFreqs; f++) {
        let r: number, g: number, b: number;
        if (!inBand[f]) {
          [r, g, b] = FILTERED_RGB;
        } else {
          const v = powers[base + f] + whitenOffsetDb[f];
          [r, g, b] = applyColormap(colormap, (v - mn) / span);
        }
        // Flip the frequency axis so low frequencies are at the bottom.
        const row = numFreqs - 1 - f;
        const idx = (row * numWindows + w) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    const off = document.createElement("canvas");
    off.width = numWindows;
    off.height = numFreqs;
    off.getContext("2d")?.putImageData(img, 0, 0);
    return { offscreen: off, vMin: mn, vMax: mx };
  }, [result, colormap, normalization, highPassHz, lowPassHz]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const plotW = width - margins.left - margins.right;
    const plotH = height - margins.top - margins.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const visSpan = visibleEndTimeSec - visibleStartTimeSec;
    const tToX = (t: number) =>
      margins.left + ((t - visibleStartTimeSec) / visSpan) * plotW;

    // Frequency range shown on the y-axis.
    const nyquist =
      (result?.freqStartHz ?? 0) +
      ((result?.numFreqs ?? 1) - 1) * (result?.freqStepHz ?? 0);
    const fMin = Math.max(0, freqMinHz);
    const fMax = result ? Math.min(nyquist, freqMaxHz) : freqMaxHz;

    if (offscreen && result && visSpan > 0) {
      const rowForFreq = (freq: number) =>
        result.numFreqs - 1 - freq / result.freqStepHz;
      const srcYTop = Math.max(0, rowForFreq(fMax));
      const srcYBottom = Math.min(result.numFreqs, rowForFreq(fMin));
      const srcH = Math.max(1, srcYBottom - srcYTop);

      // Absolute-time edges of the block.
      const halfStep = result.windowStepSec / 2;
      const blockStart = result.firstWindowCenterTimeSec - halfStep;
      const blockEnd =
        result.firstWindowCenterTimeSec +
        (result.numWindows - 1) * result.windowStepSec +
        halfStep;
      const destX0 = tToX(blockStart);
      const destX1 = tToX(blockEnd);

      ctx.save();
      ctx.beginPath();
      ctx.rect(margins.left, margins.top, plotW, plotH);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        offscreen,
        0,
        srcYTop,
        result.numWindows,
        srcH,
        destX0,
        margins.top,
        destX1 - destX0,
        plotH,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = "#888";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        loading ? "Computing spectrogram…" : "No data",
        width / 2,
        height / 2,
      );
    }

    // Axes frame
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.strokeRect(margins.left, margins.top, plotW, plotH);

    // Time axis (x) — labels the visible window.
    ctx.fillStyle = "#222";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const numXTicks = 6;
    for (let i = 0; i <= numXTicks; i++) {
      const frac = i / numXTicks;
      const x = margins.left + frac * plotW;
      const t = visibleStartTimeSec + frac * visSpan;
      ctx.strokeStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(x, margins.top + plotH);
      ctx.lineTo(x, margins.top + plotH + 4);
      ctx.stroke();
      ctx.fillText(t.toFixed(2), x, margins.top + plotH + 6);
    }
    ctx.fillText("Time (s)", margins.left + plotW / 2, height - 14);

    // Frequency axis (y)
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const numYTicks = 6;
    for (let i = 0; i <= numYTicks; i++) {
      const frac = i / numYTicks;
      const y = margins.top + plotH - frac * plotH;
      const f = fMin + frac * (fMax - fMin);
      ctx.strokeStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(margins.left - 4, y);
      ctx.lineTo(margins.left, y);
      ctx.stroke();
      ctx.fillText(f.toFixed(0), margins.left - 6, y);
    }
    ctx.save();
    ctx.translate(14, margins.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Frequency (Hz)", 0, 0);
    ctx.restore();

    // Colorbar
    if (result && offscreen) {
      const barX = width - margins.right + 24;
      const barW = 14;
      const barTop = margins.top;
      const barH = plotH;
      const grad = ctx.createLinearGradient(0, barTop + barH, 0, barTop);
      for (let s = 0; s <= 10; s++) {
        const [r, g, b] = applyColormap(colormap, s / 10);
        grad.addColorStop(s / 10, `rgb(${r},${g},${b})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(barX, barTop, barW, barH);
      ctx.strokeStyle = "#333";
      ctx.strokeRect(barX, barTop, barW, barH);
      ctx.fillStyle = "#222";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${vMax.toFixed(0)}`, barX + barW + 4, barTop + 4);
      ctx.fillText(`${vMin.toFixed(0)}`, barX + barW + 4, barTop + barH - 4);
      ctx.save();
      ctx.translate(barX + barW + 34, barTop + barH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText(
        normalization === "whiten" ? "Power (dB, whitened)" : "Power (dB)",
        0,
        0,
      );
      ctx.restore();
    }
  }, [
    offscreen,
    result,
    width,
    height,
    colormap,
    visibleStartTimeSec,
    visibleEndTimeSec,
    freqMinHz,
    freqMaxHz,
    normalization,
    vMin,
    vMax,
    loading,
  ]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default SpectrogramWidget;
