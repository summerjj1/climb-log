// Scale the target bitrate with output resolution and frame rate; never upscale.
export function fastVideoProfile(w, h, fps) {
  const longEdge = 1920;
  const shortEdge = 1080;
  const scale = Math.min(1, longEdge / Math.max(w, h), shortEdge / Math.min(w, h));
  const width = Math.max(2, Math.floor(w * scale / 2) * 2);
  const height = Math.max(2, Math.floor(h * scale / 2) * 2);
  const frameRate = Math.min(30, Number.isFinite(fps) && fps > 0 ? fps : 30);
  const ceiling = 3_000_000;
  const bitrate = Math.round(Math.max(350_000, ceiling * width * height / (longEdge * shortEdge) * frameRate / 30));
  return {width, height, frameRate, bitrate, audioBitrate: 128_000};
}
