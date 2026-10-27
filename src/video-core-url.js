// Pages limits each deployed asset to 25 MiB. Only fetch these parts when
// software compression is selected; fast compression and originals skip them.
export async function videoCoreUrl(base, signal) {
  const direct = new URL(`${base}ffmpeg-core.wasm`, location.origin).href;
  if (import.meta.env.VITE_SPLIT_VIDEO_CORE !== '1') return {url: direct, release() {}};
  const response = await fetch(`${direct}.json`, {signal});
  if (!response.ok) throw new Error('视频工具加载失败，请重试。');
  const manifest = await response.json();
  if (!Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > 8)
    throw new Error('视频工具配置无效，请刷新页面。');
  const blobs = [];
  for (const part of manifest.parts) {
    if (!/^ffmpeg-core\.[a-f0-9]{12}\.\d+\.bin$/.test(part.name) || !Number.isSafeInteger(part.size) || part.size <= 0)
      throw new Error('视频工具配置无效，请刷新页面。');
    const result = await fetch(new URL(part.name, direct), {signal});
    if (!result.ok) throw new Error('视频工具下载失败，请重试。');
    const blob = await result.blob();
    if (blob.size !== part.size) throw new Error('视频工具下载不完整，请重试。');
    blobs.push(blob);
  }
  signal?.throwIfAborted();
  const blob = new Blob(blobs, {type: 'application/wasm'});
  if (blob.size !== manifest.size) throw new Error('视频工具大小不正确，请重试。');
  const url = URL.createObjectURL(blob);
  return {url, release: () => URL.revokeObjectURL(url)};
}
