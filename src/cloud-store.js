import {isVideo,mediaType,mediaSize} from './route-media.js';
import {CHUNK_SIZE,CHUNK_THRESHOLD,uploadChunks,downloadChunks,mediaPaths} from "./chunked-media.js";
import { mediaStorageLimit, VIDEO_MIME_TYPES } from "./media-limits.js";
import { adoptImportedGym } from "./gym-catalog.js";
export class CloudConflict extends Error {
  constructor() {
    super("另一台设备已经修改了记录。请先点击「刷新云端」，再重试本次修改。");
    this.name = "CloudConflict";
  }
}

export class CloudStore {
  constructor(client, userId, mediaStore, options = {}) {
    this.chunkedUploads = options.chunkedUploads === true;
    this.lazyVideos = options.lazyVideos === true;
    this.signedUrlSeconds = options.signedUrlSeconds || 3600;
    this.client = client;
    this.userId = userId;
    this.version = 0;
    this.photos = mediaStore || client.storage.from("climb-photos");
    this.uploadPrefix = this.photos.uploadPrefix || `${userId}/`;
  }
  async load(cache = { routes: [] }) {
    const { data, error } = await this.client
      .from("climb_collections")
      .select("version,payload")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      this.version = 0;
      return { gyms: [], routes: [] };
    }
    const cached = new Map(cache.routes.map((r) => [r.photoPath, r.photo]));
    const routes = [];
    // Posters live in metadata. Never fetch a video merely to render the list.
    for (const route of data.payload.routes) {
      mediaPaths(route, this.userId);
      let photo = cached.get(route.photoPath);
      if (!(photo instanceof Blob) && !(this.lazyVideos && isVideo(route))) {
        photo = await this.getPhoto(route);
      }
      routes.push({ ...route, photo });
    }
    this.version = data.version;
    return { gyms: data.payload.gyms, routes };
  }
  async getPhoto(route, {signal, onProgress = () => {}} = {}) {
    mediaPaths(route, this.userId);
    signal?.throwIfAborted();
    if (route.photo instanceof Blob) return route.photo;
    const result = route.photoParts
      ? {data: await downloadChunks(this.photos, route, this.userId, {signal,onProgress})}
      : await this.photos.download(route.photoPath);
    signal?.throwIfAborted();
    if (result.error) throw result.error;
    if (!(result.data instanceof Blob) || !result.data.size) throw new Error('视频读取不完整，请重试');
    const expected = mediaSize(route);
    if (expected && result.data.size !== expected) throw new Error('视频读取不完整，请重试');
    // Some storage gateways return application/octet-stream; metadata/path retain
    // the media type used when uploading, without reading file bytes again.
    const type = mediaType(route);
    const photo = type && result.data.type !== type ? result.data.slice(0, result.data.size, type) : result.data;
    onProgress({loaded:photo.size,total:photo.size});
    return photo;
  }
  async videoSource(route, {signal} = {}) {
    const paths = mediaPaths(route, this.userId);
    signal?.throwIfAborted();
    if (!isVideo(route)) throw new Error('不是视频文件');
    if (!route.photoParts) {
      // Native video uses Range against the short-lived private storage URL.
      const {data,error} = await this.photos.createSignedUrl(paths[0], this.signedUrlSeconds);
      signal?.throwIfAborted();
      if (error) throw error;
      const url = new URL(data?.signedUrl);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('视频地址无效');
      return {url:url.href};
    }
    const manifest = route.photoParts, cache = new Map();
    // Bounded in-memory cache only; never persist private chunks to CacheStorage.
    signal?.addEventListener('abort', () => cache.clear(), {once:true});
    const part = async index => {
      signal?.throwIfAborted();
      let pending = cache.get(index);
      if (!pending) {
        pending = (async () => {
          const result = await this.photos.download(paths[index]);
          signal?.throwIfAborted();
          if (result.error) throw result.error;
          if (!(result.data instanceof Blob) || result.data.size !== manifest.parts[index].size) throw new Error('视频分块读取不完整');
          return result.data;
        })();
        cache.set(index,pending);
        pending.catch(() => { if (cache.get(index) === pending) cache.delete(index); });
      } else { cache.delete(index); cache.set(index,pending); }
      while (cache.size > 3) cache.delete(cache.keys().next().value);
      return pending;
    };
    return {size:manifest.size,type:manifest.type,async read(start,end) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= manifest.size || end-start >= CHUNK_SIZE) throw new Error('视频读取范围无效');
      const pieces=[];
      for (let index=Math.floor(start/CHUNK_SIZE);index<=Math.floor(end/CHUNK_SIZE);index++) {
        const blob=await part(index);
        signal?.throwIfAborted();
        pieces.push(blob.slice(Math.max(0,start-index*CHUNK_SIZE),Math.min(blob.size,end-index*CHUNK_SIZE+1)));
      }
      return new Blob(pieces,{type:manifest.type}).arrayBuffer();
    }};
  }
  async save(next, previous, {onProgress = () => {}} = {}) {
    const routes = [],
      uploaded = [];
    let savingMetadata = false;
    try {
      for (const route of next.routes) {
        let photoPath = route.photoPath, photoParts = route.photoParts;
        if (!photoPath?.startsWith(`${this.userId}/`)) {
          const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", ...(VIDEO_MIME_TYPES.includes("video/quicktime") ? {"video/quicktime":"mov", "video/webm":"webm"} : {}) };
          const extension = types[route.photo?.type?.split(";")[0]];
          if (!extension || !route.photo.size || route.photo.size > mediaStorageLimit(route.photo.type))
            throw new Error(`文件格式无效或超过 ${mediaStorageLimit(route.photo?.type) / 1024 ** 2} MB`);
          photoPath = `${this.uploadPrefix}${crypto.randomUUID()}.${extension}`;
          if (this.chunkedUploads && route.photo.type.startsWith("video/") && route.photo.size > CHUNK_THRESHOLD) {
            photoParts = await uploadChunks(this.photos,photoPath,route.photo,{onProgress});
            uploaded.push(...photoParts.parts.map(part => part.path));
          } else {
            photoParts = undefined;
            onProgress({loaded:0,total:route.photo.size});
            const { error } = await this.photos.upload(photoPath, route.photo, {
              contentType: route.photo.type || "image/jpeg", upsert: false,
            });
            if (error) throw error;
            uploaded.push(photoPath);
            onProgress({loaded:route.photo.size,total:route.photo.size});
          }
        }
        const savedRoute = { ...route, photoPath, photoParts, mediaType: mediaType(route), mediaSize: mediaSize(route) };
        mediaPaths(savedRoute, this.userId);
        routes.push(savedRoute);
      }
      const payload = {
        gyms: next.gyms,
        routes: routes.map(({ photo, ...r }) => r),
      };
      const version = this.version + 1;
      savingMetadata = true;
      const table = this.client.from("climb_collections");
      const operation =
        this.version === 0
          ? table.insert({ user_id: this.userId, version, payload })
          : table
              .update({ version, payload })
              .eq("user_id", this.userId)
              .eq("version", this.version);
      const { data, error } = await operation.select("version").maybeSingle();
      if (error?.code === "23505" || (!error && !data))
        throw new CloudConflict();
      if (error) throw error;
      this.version = data.version;
      // Only collect removed photos after the revision-checked metadata commit succeeds.
      const retained = new Set(routes.flatMap((r) => mediaPaths(r,this.userId)));
      const removed = [
        ...new Set(
          previous.routes
            .filter((r) => r.photoPath?.startsWith(`${this.userId}/`))
            .flatMap((r) => mediaPaths(r,this.userId))
            .filter(
              (path) =>
                path?.startsWith(`${this.userId}/`) && !retained.has(path),
            ),
        ),
      ];
      if (removed.length) await this.photos.remove(removed).catch(() => {});
      return { gyms: next.gyms, routes };
    } catch (error) {
      // An interrupted metadata response may have committed. Do not delete its photos.
      if (
        uploaded.length &&
        (!savingMetadata || error instanceof CloudConflict)
      )
        await this.photos.remove(uploaded).catch(() => {});
      if (savingMetadata && error && typeof error === "object") error.stage = "metadata";
      throw error;
    }
  }
}

export function mergeLocalRecords(remote, local, catalog = []) {
  const gyms = remote.gyms.map((g) => ({ ...g }));
  const map = new Map();
  for (const gym of local.gyms) {
    let existing = gyms.find(
      (g) =>
        g.id === gym.id ||
        (gym.catalogId && g.catalogId === gym.catalogId) ||
        g.name.toLowerCase() === gym.name.toLowerCase(),
    );
    if (!existing) {
      existing = { ...gym };
      gyms.push(existing);
    } else {
      existing = adoptImportedGym(existing, gym, gyms, catalog);
      gyms[gyms.findIndex((g) => g.id === existing.id)] = existing;
    }
    map.set(gym.id, existing.id);
  }
  const ids = new Set(remote.routes.map((r) => r.id));
  const imported = local.routes
    .filter((r) => !ids.has(r.id))
    .map(({ photoPath, photoParts, ...r }) => ({ ...r, gymId: map.get(r.gymId) }));
  return { gyms, routes: [...remote.routes, ...imported] };
}
