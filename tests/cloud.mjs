import { strict as assert } from "node:assert";
import {
  CloudStore,
  CloudConflict,
  mergeLocalRecords,
} from "../src/cloud-store.js";

const rows = new Map(),
  objects = new Map();
let uploadFails = false,
  lostResponse = false;
function client() {
  return {
    storage: {
      from: () => ({
        upload: async (path, blob) => {
          if (uploadFails) return { error: new Error("offline") };
          objects.set(path, blob);
          return {};
        },
        download: async (path) => ({ data: objects.get(path) }),
        remove: async (paths) => {
          paths.forEach((p) => objects.delete(p));
          return {};
        },
      }),
    },
    from: () => {
      let method = "get",
        body,
        user,
        revision;
      const query = {
        select: () => query,
        eq: (key, value) => {
          if (key === "user_id") user = value;
          else revision = value;
          return query;
        },
        insert: (value) => {
          method = "insert";
          body = value;
          user = value.user_id;
          return query;
        },
        update: (value) => {
          method = "update";
          body = value;
          return query;
        },
        maybeSingle: async () => {
          const current = rows.get(user);
          if (method === "get") return { data: current || null };
          if (method === "insert" && current)
            return { error: { code: "23505" } };
          if (method === "update" && current?.version !== revision)
            return { data: null };
          rows.set(user, structuredClone(body));
          if (lostResponse) throw new Error("response lost after commit");
          return { data: { version: body.version } };
        },
      };
      return query;
    },
  };
}
const initial = {
  gyms: [{ id: "gym", name: "本机馆" }],
  routes: [
    {
      id: "route",
      gymId: "gym",
      photo: new Blob(["photo"], { type: "image/jpeg" }),
      done: false,
    },
  ],
};
const first = new CloudStore(client(), "user-a");
const saved = await first.save(initial, { routes: [] });
assert.equal(objects.size, 1);
assert.equal(rows.get("user-a").payload.routes[0].photo, undefined);
assert.match(saved.routes[0].photoPath, /^user-a\//);
const second = new CloudStore(client(), "user-a");
const loaded = await second.load();
assert.equal(await loaded.routes[0].photo.text(), "photo");
const updated = await second.save(
  { ...loaded, routes: loaded.routes.map((r) => ({ ...r, done: true })) },
  loaded,
);
assert.equal(objects.size, 1, "metadata edits must not reupload photos");
await assert.rejects(first.save(saved, saved), CloudConflict);
assert.equal(rows.get("user-a").payload.routes[0].done, true);
const third = new CloudStore(client(), "user-b");
assert.deepEqual(await third.load(), { gyms: [], routes: [] });
uploadFails = true;
await assert.rejects(third.save(initial, { routes: [] }), /offline/);
assert.equal(rows.has("user-b"), false);
uploadFails = false;
lostResponse = true;
await assert.rejects(third.save(initial, { routes: [] }), /response lost/);
assert.equal(
  objects.size,
  2,
  "uncertain save must retain photos that may be referenced",
);
lostResponse = false;
const recovered = await third.load();
assert.equal(await recovered.routes[0].photo.text(), "photo");
const merged = mergeLocalRecords(updated, initial);
assert.equal(merged.routes.length, 1);
assert.equal(merged.routes[0].done, true);
assert.equal(mergeLocalRecords(merged, initial).gyms.length, 1);
const cachedWrongAccount = {
  routes: [
    { photoPath: saved.routes[0].photoPath, photo: new Blob(["wrong"]) },
  ],
};
assert.equal(
  await (await third.load(cachedWrongAccount)).routes[0].photo.text(),
  "photo",
);
await assert.rejects(
  first.save({ gyms: saved.gyms, routes: [] }, saved),
  CloudConflict,
);
assert.equal(
  objects.has(saved.routes[0].photoPath),
  true,
  "stale deletes must keep the current photo",
);
const deleting = new CloudStore(client(), "user-a");
const beforeDelete = await deleting.load();
await deleting.save({ gyms: beforeDelete.gyms, routes: [] }, beforeDelete);
assert.equal(
  objects.has(saved.routes[0].photoPath),
  false,
  "successful deletion cleans its photo",
);
assert.equal(
  objects.has(recovered.routes[0].photoPath),
  true,
  "other account photos remain",
);
console.log(
  "PASS: private photo paths, metadata-only updates, revision conflicts, account isolation, upload failures, uncertain commits, local merge deduplication.",
);
const videoStore = new CloudStore(client(), 'video-owner');
const videoState = { gyms: [], routes: [{id:'video',photo:new Blob(['synthetic mp4'],{type:'video/mp4'}),poster:'data:image/jpeg;base64,AA==',videoMeta:{duration:4}}] };
const videoSaved = await videoStore.save(videoState,{routes:[]});
assert.match(videoSaved.routes[0].photoPath,/\.mp4$/);
const videoReload = new CloudStore(client(),'video-owner');
const loadedVideo = await videoReload.load();
assert.equal(loadedVideo.routes[0].photo.type,'video/mp4');
assert.equal(loadedVideo.routes[0].videoMeta.duration,4);
assert.equal(loadedVideo.routes[0].poster,videoState.routes[0].poster);
await assert.rejects(videoStore.save({gyms:[],routes:[{photo:new Blob(['html'],{type:'text/html'})}]},videoSaved),/文件格式/);
console.log('PASS: MP4 extension/MIME, video metadata and private reload, unsupported media rejected.');
