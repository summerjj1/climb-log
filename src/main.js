import {streamingURL} from './video-stream.js';
import {fragmentedPlayback} from './fragmented-player.js';
import {mediaType, mediaSize} from './route-media.js';
import {uploadErrorMessage} from "./upload-errors.js";
import { VIDEO_DEFAULT_QUALITY, VIDEO_INPUT_LIMIT, VIDEO_DURATION_LIMIT, BACKUP_FILE_LIMIT, VIDEO_MIME_TYPES, mediaStorageLimit } from "./media-limits.js";
import { compressVideo, isVideo, formatBytes, formatDuration, safePoster, inspectSavedVideo } from "./video.js";
import shanghaiCatalog from "./shanghai-gyms.json";
import {
  mergeCatalog,
  normalizeGymName,
  adoptImportedGym,
} from "./gym-catalog.js";
import { createMediaStore } from "./cos-store.js";
import { cloud, recoveryLink, cloudProvider } from "./cloud.js";
import { installCloudBaseAuth } from "./cloudbase-auth.js";
import { installShowcase } from "./showcase.js";
import { CloudStore, CloudConflict, mergeLocalRecords } from "./cloud-store.js";
let cloudStore = null,
  cloudUser = null,
  accountEpoch = 0,
  accountBusy = false,
  authMode = "login";
let cloudbaseAuth = null;
let showcase = null;
const catalogById = new Map(shanghaiCatalog.gyms.map((g) => [g.id, g]));
let processingController = null;
let videoControl = null;
let videoProcessingState = "running";
let lastProcessingText = "";
const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
$("#video-quality").value = VIDEO_DEFAULT_QUALITY;
if (cloudProvider === "cloudbase") {
  $("#video-quality-auto").hidden = false;
  $("#video-quality-original").hidden = false;
  $("#video-quality-fast").hidden = false;
  $("#video-quality").value = VIDEO_DEFAULT_QUALITY;
  $("#video-settings-note").textContent = "快速压缩：最高 1080p、30 帧，目标视频码率最高 3 Mbps。优先硬件加速，保留原速和声音，支持暂停、继续和取消；实际速度取决于设备。原视频最大 1 GB、20 分钟，快速压缩后不超过 1 GB；智能清晰等原有模式不超过 200 MB。不压缩会保留原文件，其他设备能否播放取决于原编码。";
  $("#media-input-limits").textContent = `照片每张 ≤ 20 MB · 原视频每段 ≤ ${VIDEO_INPUT_LIMIT / 1024 ** 3} GB、${VIDEO_DURATION_LIMIT / 60} 分钟`;
}
function applyTheme(theme) {
  const selected = theme === "green" ? "green" : "pink";
  document.documentElement.dataset.theme = selected;
  document.querySelector('meta[name="theme-color"]').content =
    selected === "pink" ? "#a33665" : "#233f35";
  $$("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === selected));
  });
}
applyTheme(document.documentElement.dataset.theme);
$$("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
    try {
      localStorage.setItem("climb-log-theme", button.dataset.themeChoice);
    } catch {
      toast("主题已切换；当前浏览器无法记住选择。");
    }
  });
});
window.addEventListener("storage", (event) => {
  if (event.key === "climb-log-theme" || event.key === null) applyTheme(event.newValue);
});

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 16-5-5-8 10M3 16l4-4 4 4"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]}</svg>`;
const escape = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const grades = [
  "5.8",
  "5.9",
  ...[10, 11, 12, 13, 14, 15].flatMap((n) =>
    ["a", "b", "c", "d"].map((l) => `5.${n}${l}`),
  ),
];
function gradeOptions(selected = "5.8") {
  const options = grades
    .map(
      (value) =>
        `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`,
    )
    .join("");
  return (
    options +
    (!grades.includes(selected)
      ? `<option value="${escape(selected)}" selected>${escape(selected)}（原记录）</option>`
      : "")
  );
}
const normalizeGrade = (s) =>
  s
    .trim()
    .replace(/\s+/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９．]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 65248),
    )
    .toLowerCase();
function compareGrade(a, b) {
  const parse = (x) => {
    const m = x.match(/^5\.(\d+)([a-d])?$/);
    return m ? +m[1] * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : null;
  };
  const x = parse(a),
    y = parse(b);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return a.localeCompare(b, "zh-CN", { numeric: true });
}
let db,
  state = { gyms: [], routes: [] },
  selectedGym = "all",
  renamingGym = null,
  renamingBusy = false,
  status = "all",
  query = "",
  grade = "all",
  order = "new",
  pending = [],
  processing = false,
  saving = false,
  available = false,
  toastTimer;
const urls = new Map();
let detailMediaController = null;
let playbackController = null;
function stopPlayback() {
  playbackController?.abort();
  playbackController = null;
  $$('#detail-dialog video').forEach(video => {video.pause(); video.removeAttribute('src'); video.load();});
}
let exportController = null;
function photoURL(r) {
  if (!urls.has(r.id)) urls.set(r.id, URL.createObjectURL(r.photo));
  return urls.get(r.id);
}
async function loadRoutePhoto(route, options = {}) {
  const epoch = accountEpoch, store = cloudStore;
  options.signal?.throwIfAborted();
  if (route.photo instanceof Blob) return route.photo;
  if (!store) throw new Error('当前记录没有可读取的文件');
  const photo = await store.getPhoto(route, options);
  options.signal?.throwIfAborted();
  if (epoch !== accountEpoch) throw new DOMException('账号已切换', 'AbortError');
  route.photo = photo;
  const current = state.routes.find(r => r.id === route.id && r.photoPath === route.photoPath);
  if (current) current.photo = photo;
  return photo;
}
function videoReadError(error) {
  const status = Number(error?.status || error?.statusCode);
  const code = Number.isFinite(status) && status >= 400 ? `（HTTP ${status}）` : '';
  return status === 401 ? '登录已过期，请重新登录后读取视频。'
    : status === 403 ? `没有读取权限，请检查账号和云服务状态${code}。`
    : `视频读取失败${code}，请检查网络后重试。`;
}
function videoPlayer(route, source = photoURL(route)) {
  return `<video crossorigin="anonymous" src="${escape(source)}" ${safePoster(route.poster) ? `poster="${route.poster}"` : ''} controls playsinline preload="metadata" aria-label="${escape(route.name)}攀爬视频"></video>`;
}
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function showError(e) {
  console.error(e);
  toast(
    e instanceof CloudConflict
      ? e.message
      : cloudUser
        ? "云端保存失败，本次修改尚未保存。请检查网络；若其他设备有修改，请先刷新云端。"
        : e?.name === "QuotaExceededError"
          ? "存储空间不足，请先导出备份并清理部分照片。"
          : "保存失败，请重试或先导出备份。",
  );
}
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(cloudProvider === "cloudbase" ? "climb-log-cloudbase" : "climb-log", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("data");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("数据库被其他页面占用"));
  });
}
function load() {
  return new Promise((resolve, reject) => {
    const req = db.transaction("data").objectStore("data").get("collection");
    req.onsuccess = () => resolve(req.result || { gyms: [], routes: [] });
    req.onerror = () => reject(req.error);
  });
}
let writeQueue = Promise.resolve();
function persistLocal(next) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(next, "collection");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function loadWithDefaultGyms(store, cache, epoch = accountEpoch) {
  let current = store ? await store.load(cache) : await load();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (epoch !== accountEpoch) throw new Error("账号已切换");
    const merged = mergeCatalog(current.gyms, shanghaiCatalog.gyms);
    if (JSON.stringify(merged.gyms) === JSON.stringify(current.gyms))
      return current;
    const next = { ...current, gyms: merged.gyms };
    if (!store) {
      await persistLocal(next);
      return next;
    }
    try {
      return await store.save(next, current);
    } catch (error) {
      if (!(error instanceof CloudConflict) || attempt === 1) throw error;
      current = await store.load(current);
    }
  }
}
function commit(change) {
  const epoch = accountEpoch,
    store = cloudStore;
  const task = writeQueue.then(async () => {
    if (!available || epoch !== accountEpoch)
      throw new Error("账号或存储状态已变化，请重试");
    let next = change(state);
    if (store) {
      $("#cloud-status").textContent = "正在保存到云端…";
      next = await store.save(next, state, {onProgress: ({loaded,total,retrying,part,parts}) => {
        if (!saving || epoch !== accountEpoch) return;
        $("#save-progress").value = Math.round(loaded / total * 100);
        $("#save-progress-label").textContent = retrying
          ? `正在重试第 ${part}/${parts} 块，已上传 ${formatBytes(loaded)} / ${formatBytes(total)}`
          : loaded === total ? "文件已传输，正在保存线路信息…"
          : `正在上传 ${formatBytes(loaded)} / ${formatBytes(total)}${parts ? ` · 分 ${parts} 块传输` : ""}。请保持页面在前台。`;
      }});
      if (epoch !== accountEpoch) throw new Error("账号已切换");
      $("#cloud-status").textContent = "已保存到云端";
    } else await persistLocal(next);
    state = next;
    render();
  });
  writeQueue = task.catch(() => {
    if (store && epoch === accountEpoch)
      $("#cloud-status").textContent = "保存失败，请重试或刷新云端";
  });
  return task;
}
const gymName = (id) =>
  state.gyms.find((g) => g.id === id)?.name || "未命名岩馆";
const dateText = (v) =>
  new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(
    new Date(v),
  );
const wallArt = `<svg class="wall-art" viewBox="0 0 300 310" fill="none" aria-hidden="true"><defs><pattern id="bolts" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="1.3" fill="#bdc6b1"/></pattern></defs><path d="M36 12 260 0l24 292-258 8Z" fill="#e1e6d6"/><path d="m36 12 150 140L26 300M186 152 260 0M186 152l98 140" stroke="#c8d1bd"/><path d="M36 12 260 0l24 292-258 8Z" fill="url(#bolts)"/><path d="M105 268c-40-46 82-55 49-100S94 140 118 107s93-30 61-73" stroke="#859774" stroke-width="1.5" stroke-dasharray="5 6"/><g fill="#3b654e" stroke="#315942" stroke-width="2"><path d="M100 257c8-12 23-6 24 2s-16 13-24 9-6-6 0-11Z"/><path d="M144 183c-8-7 0-20 10-21s17 7 12 13-14 14-22 8Z"/><path d="M104 116c-2-12 11-19 21-12s4 17-3 20-16 1-18-8Z"/><path d="M169 38c-8-4-4-17 6-19s22 1 20 10-18 13-26 9Z"/></g><g fill="#bd845e"><path d="M54 184c-7-9 10-18 16-12s-7 22-16 12Z"/><path d="M215 227c-8-3-9-13 2-16s18 8 15 13-10 7-17 3Z"/><path d="M220 82c0-8 18-14 22-4s-20 14-22 4Z"/></g><g fill="#a7b19a"><path d="M65 57c-6-6 7-13 15-8s-8 18-15 8Z"/><path d="M193 129c-9-4-6-15 3-17s15 16-3 17Z"/><path d="M69 224c-4-6 10-9 16-4s-12 13-16 4Z"/></g><path d="m57 285 190-3" stroke="#b7c2aa" stroke-width="2"/></svg>`;
function render() {
  ["#upload", "#export-data", "#restore-data", "#add-gym"].forEach(
    (s) => ($(s).disabled = !available),
  );
  renderGyms();
  $("#page-title").textContent =
    selectedGym === "all" ? "全部线路" : gymName(selectedGym);
  $("#rename-gym").hidden = selectedGym === "all";
  $("#rename-gym").disabled = !available || renamingBusy;
  const base = state.routes.filter(
      (r) => selectedGym === "all" || r.gymId === selectedGym,
    ),
    done = base.filter((r) => r.done).length;
  $("#overview").innerHTML =
    `<span><strong>${base.length}</strong> 条线路</span><span><strong>${done}</strong> 已通关</span><span><strong>${base.length ? Math.round((done / base.length) * 100) + "%" : "—"}</strong> 通关率</span>`;
  const activeGrades = [...new Set(base.map((r) => r.grade))].sort(
    compareGrade,
  );
  $("#grade-filter").innerHTML =
    '<option value="all">全部难度</option>' +
    activeGrades
      .map((g) => `<option value="${escape(g)}">${escape(g)}</option>`)
      .join("");
  if (!activeGrades.includes(grade)) grade = "all";
  $("#grade-filter").value = grade;
  const filtered = base
    .filter(
      (r) =>
        (status === "all" || r.done === (status === "done")) &&
        (grade === "all" || r.grade === grade) &&
        `${r.name} ${r.notes} ${r.grade}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      order === "new"
        ? b.createdAt - a.createdAt
        : (order === "easy" ? 1 : -1) * compareGrade(a.grade, b.grade) ||
          b.createdAt - a.createdAt,
    );
  $$(".status-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.status === status);
    b.setAttribute("aria-pressed", b.dataset.status === status);
  });
  $("#result-count").textContent =
    `${filtered.length} 条线路${base.length !== filtered.length ? ` / 共 ${base.length} 条` : ""}`;
  $("#reset-filter").hidden = !(query || grade !== "all" || status !== "all");
  $("#gallery").innerHTML = filtered
    .map(
      (r) =>
        `<article class="route-card"><button class="photo-button" data-detail="${escape(r.id)}" aria-label="查看线路：${escape(r.name)}">${isVideo(r) ? (safePoster(r.poster) ? `<img src="${r.poster}" alt="${escape(r.name)}视频封面" loading="lazy">` : `<span class="video-placeholder">攀爬视频</span>`) + `<span class="video-badge">${icon("play")}视频${r.videoMeta?.duration ? ` · ${formatDuration(r.videoMeta.duration)}` : ""}</span>` : `<img src="${photoURL(r)}" alt="${escape(r.name)}线路照片" loading="lazy">`}<span class="grade-pill">${escape(r.grade)}</span><span class="photo-caption">查看线路</span></button><div class="card-info"><div><h3>${escape(r.name)}</h3><p>${escape(gymName(r.gymId))} · ${dateText(r.createdAt)}</p></div><button class="done-toggle ${r.done ? "done" : ""}" data-toggle="${escape(r.id)}" aria-pressed="${r.done}" aria-label="${escape(r.name)}：${r.done ? "已通关，点击改为待挑战" : "待挑战，点击标记已通关"}">${icon(r.done ? "check" : "circle")}${r.done ? "已通关" : "待挑战"}</button></div></article>`,
    )
    .join("");
  $("#empty").hidden = filtered.length > 0;
  $("#empty").classList.toggle("no-results", base.length > 0);
  $("#empty").innerHTML = base.length
    ? '<div class="empty-copy"><h2>还没有匹配的线路</h2><p>换个难度或状态，找到你的下一条挑战。</p><button id="empty-reset" class="primary">清除筛选</button></div>'
    : `<div class="empty-copy"><h2>下一次突破，<br>从收藏一条线路开始。</h2><p>拍下让你心动的线路，标上难度。<br>爬通时，给自己一个小小的勾。</p><button class="primary" id="empty-upload" ${available ? "" : "disabled"}>${icon("plus")}添加第一条线路</button></div>${wallArt}`;
  $("#gym-options").innerHTML = state.gyms
    .map((g) => `<option value="${escape(g.name)}"></option>`)
    .join("");
  if (!$("#default-grade").options.length)
    $("#default-grade").innerHTML = gradeOptions();
}
$('#toggle-gyms').onclick = () => {
  const open = $('.sidebar').classList.toggle('gyms-expanded');
  $('#toggle-gyms').setAttribute('aria-expanded', String(open));
};
function renderGyms() {
  $('#toggle-gyms').textContent = `选择岩馆 · ${selectedGym === 'all' ? '全部线路' : gymName(selectedGym)}`;
  const search = normalizeGymName($("#gym-search").value);
  const matches = state.gyms.filter((gym) => {
    const entry = catalogById.get(gym.catalogId);
    return normalizeGymName(
      [
        gym.name,
        entry?.name,
        entry?.district,
        entry?.address,
        ...(entry?.aliases || []),
      ].join(" "),
    ).includes(search);
  });
  $("#gym-count").textContent = search
    ? `找到 ${matches.length} 家 / 共 ${state.gyms.length} 家`
    : `共 ${state.gyms.length} 家岩馆`;
  $("#gyms").innerHTML =
    [{ id: "all", name: "全部线路" }, ...matches]
      .map((gym) => {
        const district = catalogById.get(gym.catalogId)?.district;
        return `<button class="gym-nav ${selectedGym === gym.id ? "active" : ""}" data-gym="${escape(gym.id)}" title="${escape(gym.name)}${district ? ` · ${escape(district)}` : ""}" aria-pressed="${selectedGym === gym.id}">${icon(gym.id === "all" ? "grid" : "pin")}<span>${escape(gym.name)}${district ? `<small>${escape(district)}</small>` : ""}</span><b>${state.routes.filter((r) => gym.id === "all" || r.gymId === gym.id).length}</b></button>`;
      })
      .join("") +
    (!matches.length
      ? `<p class="gym-tip">${search ? "没有找到岩馆，试试名称或区名。" : "添加常去的岩馆，<br>让每条线路都有归处。"}</p>`
      : "");
}
$("#gym-search").oninput = renderGyms;
function resetFilters() {
  query = "";
  grade = "all";
  status = "all";
  $("#search").value = "";
  render();
}
function openUpload() {
  if (!available) return;
  $("#upload-gym").value =
    selectedGym === "all"
      ? state.gyms.length === 1
        ? state.gyms[0].name
        : ""
      : gymName(selectedGym);
  $("#upload-error").textContent = "";
  updatePending();
  $("#upload-dialog").showModal();
}
function updatePending() {
  $("#pending-list").innerHTML = pending
    .map(
      (p, i) =>
        `<div class="pending-row" data-index="${i}">${isVideo(p) ? `<video src="${p.url}" ${safePoster(p.poster) ? `poster="${p.poster}"` : ""} controls playsinline preload="metadata" aria-label="待导入视频 ${i + 1}"></video>` : `<img src="${p.url}" alt="待导入照片 ${i + 1}">`}<div>${isVideo(p) ? `<p class="media-size">${formatBytes(p.videoMeta.originalBytes)} → ${formatBytes(p.photo.size)}<br>${formatDuration(p.videoMeta.duration)} · 原速${p.videoMeta.keptOriginal ? " · 保留原画质与原文件" : p.videoMeta.remuxed ? " · 无损转为 MP4" : p.photo.size >= p.videoMeta.originalBytes ? " · 已转为兼容 MP4，体积未减小" : ` · 节省 ${Math.round((1-p.photo.size/p.videoMeta.originalBytes)*100)}%`}</p>` : ""}<label>线路名称<input type="text" data-field="name" maxlength="80" value="${escape(p.name)}" required></label><label class="check-label"><input type="checkbox" data-field="done" ${p.done ? "checked" : ""}>已经通关</label></div><label>难度 · YDS<select data-field="grade" required>${gradeOptions(p.grade)}</select></label><button type="button" class="icon-button" data-remove="${i}" aria-label="移除${isVideo(p) ? "视频" : "照片"} ${i + 1}">${icon("close")}</button></div>`,
    )
    .join("");
  $("#save-upload").disabled = !pending.length || processing || saving;
  $("#video-quality").disabled = processing || saving;
  $("#photo-files").disabled = processing || saving;
  $("#processing-status").hidden = !processing;
  $("#save-status").hidden = !saving;
  $("#cancel-processing").disabled = !processing;
  renderVideoControl();
  $("#upload-hint").textContent = cloudUser ? "保存后同步到你的私有云端" : "保存到此浏览器；登录后可导入云端";
  $("#save-upload").textContent = saving
    ? "正在保存…"
    : processing
      ? "正在处理…"
      : `保存${pending.length ? " " + pending.length + " 条" : ""}线路`;
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file),
      img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas"),
          scale = Math.min(
            1,
            3200 / Math.max(img.naturalWidth, img.naturalHeight),
          );
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            blob ? resolve(blob) : reject(new Error("图片转换失败"));
          },
          "image/jpeg",
          0.94,
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片。HEIC 照片请先转换为 JPG。"));
    };
    img.src = url;
  });
}
function renderVideoControl() {
  const button = $("#pause-processing");
  button.hidden = !processing || !videoControl?.supported;
  button.disabled = videoProcessingState === "pausing";
  button.textContent = videoProcessingState === "paused" ? "继续处理" : videoProcessingState === "pausing" ? "正在暂停…" : "暂停处理";
  $("#processing-label").textContent = videoProcessingState === "paused"
    ? "已暂停 · 进度已保留，点击「继续处理」即可接着处理。请勿刷新或关闭页面。"
    : videoProcessingState === "pausing" ? "正在暂停，请稍候…" : lastProcessingText;
  $("#processing-note").hidden = !processing || !videoControl;
  $("#processing-note").textContent = videoControl?.supported
    ? "暂停后保留当前进度；刷新或关闭页面会丢失本次处理进度。"
    : "当前浏览器不支持暂停；可以取消处理，或用新版 Chrome / Edge 打开网站。";
}
$("#pause-processing").onclick = () => {
  if (videoProcessingState === "paused") videoControl?.resume();
  else videoControl?.pause();
};
async function addFiles(files) {
  if (processing || saving || !available) return;
  const epoch = accountEpoch;
  const controller = new AbortController();
  processingController = controller;
  processing = true;
  videoControl = null; videoProcessingState = "running"; lastProcessingText = "正在准备…";
  const quality = $("#video-quality").value;
  updatePending();
  const errors = [];
  try {
    for (const file of [...files]) {
      if (controller.signal.aborted || epoch !== accountEpoch) break;
      if (pending.length >= 30) { errors.push("一次最多导入 30 个文件，请先保存后继续添加。"); break; }
      const video = file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
      if (!video && !file.type.startsWith("image/")) { errors.push(`${file.name}：请选择照片或视频。`); continue; }
      if (video && pending.some(isVideo)) { errors.push(`${file.name}：视频一次处理 1 段，请先保存已有视频。`); continue; }
      if (!video && file.size > 20 * 1024 * 1024) { errors.push(`${file.name}：照片超过 20 MB，请压缩后重试。`); continue; }
      const progress = ({ label, percent }) => {
        if (controller.signal.aborted || epoch !== accountEpoch) return;
        lastProcessingText = `${file.name} · ${label}${percent === null ? "" : ` ${percent}%`}`;
        if (percent === null) $("#processing-progress").removeAttribute("value");
        else $("#processing-progress").value = percent;
        renderVideoControl();
      };
      try {
        progress({ label: "正在处理…", percent: null });
        const media = video
          ? await compressVideo(file, { quality, signal: controller.signal, onProgress: progress,
              onControl: control => {
                if (controller.signal.aborted || epoch !== accountEpoch) return;
                videoControl = control;
                videoProcessingState = "running";
                renderVideoControl();
              },
              onState: next => {
                if (controller.signal.aborted || epoch !== accountEpoch) return;
                videoProcessingState = next;
                renderVideoControl();
              },
            })
          : { photo: await compressImage(file) };
        if (controller.signal.aborted || epoch !== accountEpoch) break;
        pending.push({ ...media, url: URL.createObjectURL(media.photo),
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "未命名线路",
          grade: normalizeGrade($("#default-grade").value) || "5.8", done: false });
      } catch (error) {
        if (controller.signal.aborted || epoch !== accountEpoch) break;
        errors.push(`${file.name}：${error.message}`);
      }
    }
  } finally {
    if (processingController === controller) {
      processingController = null;
      videoControl = null; videoProcessingState = "running";
      processing = false;
      if (epoch === accountEpoch) {
        $("#upload-error").textContent = controller.signal.aborted ? "已取消处理，尚未上传。已处理好的文件仍可保存。" : errors.join("\n");
        $("#photo-files").value = "";
        updatePending();
      }
    }
  }
}
$("#cancel-processing").onclick = () => processingController?.abort();

$("#add-gym").innerHTML = icon("plus");
$("#upload").innerHTML = icon("plus") + "添加线路";
$("#search-icon").innerHTML = icon("search");
$("#image-icon").innerHTML = icon("image");
$$(".close-dialog").forEach((b) => {
  b.innerHTML = icon("close");
  b.addEventListener("click", () => {
    if (saving || processing) {
      toast("正在处理文件，可点击「取消处理」停止。");
      return;
    }
    b.closest("dialog").close();
  });
});
$("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
$("#upload-dialog").addEventListener("cancel", (e) => {
  if (processing || saving) e.preventDefault();
});
$("#upload").onclick = openUpload;
$("#add-gym").onclick = () => {
  $("#gym-form").hidden = !$("#gym-form").hidden;
  if (!$("#gym-form").hidden) $("#gym-name").focus();
};
$("#cancel-gym").onclick = () => {
  $("#gym-form").hidden = true;
  $("#gym-name").value = "";
};
$("#gym-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("#gym-name").value.trim();
  if (!name) {
    $("#gym-name").setCustomValidity("请输入岩馆名称");
    $("#gym-name").reportValidity();
    return;
  }
  const existing = state.gyms.find(
    (g) => g.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    selectedGym = existing.id;
    render();
    toast("已切换到这个岩馆");
  } else {
    const gym = { id: crypto.randomUUID(), name };
    try {
      await commit((s) => ({ ...s, gyms: [...s.gyms, gym] }));
      selectedGym = gym.id;
      resetFilters();
      toast("岩馆已添加");
    } catch (e) {
      showError(e);
      return;
    }
  }
  $("#gym-form").hidden = true;
  $("#gym-name").value = "";
};
$("#gym-name").oninput = () => $("#gym-name").setCustomValidity("");
function closeRenameGym() {
  $("#rename-gym-form").hidden = true;
  renamingGym = null;
  $("#rename-gym-error").textContent = "";
}
$("#rename-gym").onclick = () => {
  if (selectedGym === "all" || renamingBusy) return;
  renamingGym = selectedGym;
  $("#rename-gym-name").value = gymName(renamingGym);
  $("#rename-gym-error").textContent = "";
  $("#rename-gym-form").hidden = false;
  $("#rename-gym-name").focus();
  $("#rename-gym-name").select();
};
$("#cancel-rename-gym").onclick = () => {
  closeRenameGym();
  $("#rename-gym").focus();
};
$("#rename-gym-name").oninput = () => {
  $("#rename-gym-error").textContent = "";
};
$("#rename-gym-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!renamingGym || renamingBusy) return;
  const id = renamingGym,
    name = $("#rename-gym-name").value.trim();
  if (!name) {
    $("#rename-gym-error").textContent = "请输入岩馆名称，不能只填写空格。";
    $("#rename-gym-name").focus();
    return;
  }
  renamingBusy = true;
  const controls = $$("input, button", $("#rename-gym-form"));
  controls.forEach((control) => (control.disabled = true));
  try {
    await commit((s) => {
      if (
        s.gyms.some(
          (g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error("已有同名岩馆，请换一个名称。");
      }
      return {
        ...s,
        gyms: s.gyms.map((g) => (g.id === id ? { ...g, name } : g)),
      };
    });
    closeRenameGym();
    toast("岩馆已改名，原有线路和通关记录已保留");
  } catch (error) {
    $("#rename-gym-error").textContent =
      error.message === "已有同名岩馆，请换一个名称。"
        ? error.message
        : "改名未保存，请重试。原有记录不受影响。";
  } finally {
    renamingBusy = false;
    controls.forEach((control) => (control.disabled = false));
    $("#rename-gym").disabled = !available;
    if (!$("#rename-gym-form").hidden) $("#rename-gym-name").focus();
    else if (!$("#rename-gym").hidden) $("#rename-gym").focus();
  }
};
$("#gyms").onclick = (e) => {
  const b = e.target.closest("[data-gym]");
  if (b) {
    closeRenameGym();
    selectedGym = b.dataset.gym;
    resetFilters();
  }
};
$(".status-tabs").onclick = (e) => {
  const b = e.target.closest("[data-status]");
  if (b) {
    status = b.dataset.status;
    render();
  }
};
$("#search").oninput = (e) => {
  query = e.target.value.trim();
  render();
};
$("#grade-filter").onchange = (e) => {
  grade = e.target.value;
  render();
};
$("#sort").onchange = (e) => {
  order = e.target.value;
  render();
};
$("#reset-filter").onclick = resetFilters;
$("#empty").onclick = (e) => {
  if (e.target.closest("#empty-upload")) openUpload();
  if (e.target.closest("#empty-reset")) resetFilters();
};
$("#gallery").onclick = async (e) => {
  const toggle = e.target.closest("[data-toggle]"),
    detail = e.target.closest("[data-detail]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    toggle.disabled = true;
    try {
      let marked = false;
      await commit((s) => ({
        ...s,
        routes: s.routes.map((r) =>
          r.id === id
            ? {
                ...r,
                done: (marked = !r.done),
                completedAt: marked ? Date.now() : null,
              }
            : r,
        ),
      }));
      toast(marked ? "通关了！又向上了一步。" : "已改为待挑战");
    } catch (e) {
      showError(e);
      render();
    }
  }
  if (detail) openDetail(detail.dataset.detail);
};
$("#photo-files").onchange = (e) => addFiles(e.target.files);
const dropzone = $("#dropzone");
["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
  }),
);
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
$("#pending-list").oninput = (e) => {
  const row = e.target.closest("[data-index]"),
    field = e.target.dataset.field;
  if (row && field)
    pending[+row.dataset.index][field] =
      field === "done" ? e.target.checked : e.target.value;
};
$("#pending-list").onclick = (e) => {
  const b = e.target.closest("[data-remove]");
  if (b && !saving && !processing) {
    const [p] = pending.splice(+b.dataset.remove, 1);
    URL.revokeObjectURL(p.url);
    updatePending();
  }
};
$("#default-grade").onchange = () => {
  const value = normalizeGrade($("#default-grade").value);
  if (value) {
    pending.forEach((p) => (p.grade = value));
    updatePending();
  }
};
$("#upload-form").onsubmit = async (e) => {
  e.preventDefault();
  if (processing || saving || !pending.length) return;
  const name = $("#upload-gym").value.trim();
  if (!name) {
    $("#upload-error").textContent = "请填写岩馆名称。";
    return;
  }
  if (pending.some((p) => !p.name.trim() || !normalizeGrade(p.grade))) {
    $("#upload-error").textContent = "每条线路都需要名称和难度。";
    return;
  }
  saving = true;
  $("#upload-error").textContent = "";
  $("#save-progress").value = 0;
  $("#save-progress-label").textContent = cloudUser ? "正在准备上传…" : "正在保存到此浏览器…";
  updatePending();
  try {
    await commit((s) => {
      let gym = s.gyms.find((g) => g.name.toLowerCase() === name.toLowerCase());
      const gyms = [...s.gyms];
      if (!gym) {
        gym = { id: crypto.randomUUID(), name };
        gyms.push(gym);
      }
      const now = Date.now(),
        routes = pending.map((p) => ({
          id: crypto.randomUUID(),
          gymId: gym.id,
          name: p.name.trim(),
          grade: normalizeGrade(p.grade),
          done: p.done,
          photo: p.photo,
          ...(isVideo(p) ? { poster: p.poster, videoMeta: p.videoMeta } : {}),
          notes: "",
          createdAt: now,
          completedAt: p.done ? now : null,
        }));
      selectedGym = gym.id;
      return { gyms, routes: [...s.routes, ...routes] };
    });
    const count = pending.length;
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    pending = [];
    resetFilters();
    $("#upload-dialog").close();
    toast(`已添加 ${count} 条线路`);
  } catch (e) {
    showError(e);
    $("#upload-error").textContent = `${uploadErrorMessage(e)} 文件仍保留在窗口中。`;
  } finally {
    saving = false;
    updatePending();
  }
};
function openDetail(id) {
  detailMediaController?.abort();
  stopPlayback();
  const r = state.routes.find((r) => r.id === id);
  if (!r) return;
  $("#detail-content").innerHTML =
    `<div class="detail-layout"><div class="detail-image">${isVideo(r) ? (r.photo instanceof Blob ? videoPlayer(r) : `<div class="video-on-demand">${safePoster(r.poster) ? `<img src="${r.poster}" alt="${escape(r.name)}视频封面">` : `<span class="video-placeholder">攀爬视频</span>`}<button id="play-cloud-video" type="button" class="primary">${icon("play")}播放视频</button><span>点击后边加载边播放${mediaSize(r) ? ` · ${formatBytes(mediaSize(r))}` : ""}</span></div>`) : `<img src="${photoURL(r)}" alt="${escape(r.name)}完整线路照片">`}</div><form class="detail-form" id="edit-form"><h2 id="detail-title">线路手记</h2>${isVideo(r) ? `<button class="text-button" id="download-video" type="button">下载视频</button><p id="video-load-status" class="video-load-status" role="status" aria-live="polite"></p>` : ""}<label>线路名称<input name="name" value="${escape(r.name)}" maxlength="80" required></label><div class="form-grid"><label>岩馆<select name="gymId" required>${state.gyms.map(g => `<option value="${escape(g.id)}" ${g.id === r.gymId ? "selected" : ""}>${escape(g.name)}</option>`).join("")}<option value="__new__">＋ 新增岩馆</option></select></label><label>难度 · YDS<select name="grade" required>${gradeOptions(r.grade)}</select></label></div><label id="edit-new-gym" hidden>新岩馆名称<input name="newGym" maxlength="40" placeholder="输入岩馆名称" disabled></label><label style="margin-top:16px">备注<textarea name="notes" maxlength="2000" placeholder="记下难点、动作，或下一次想尝试的方法…">${escape(r.notes || "")}</textarea></label><label class="check-label"><input name="done" type="checkbox" ${r.done ? "checked" : ""}>这条线路，我已经通关了</label><p class="form-error" id="edit-error" role="alert"></p><button class="primary" type="submit">保存修改</button><button class="text-button delete-route" type="button" id="delete-route">删除这条线路</button></form></div>`;
  $('#edit-form [name="gymId"]').onchange = (event) => {
    const adding = event.target.value === '__new__';
    const input = $('#edit-form [name="newGym"]');
    $('#edit-new-gym').hidden = !adding;
    input.disabled = !adding;
    input.required = adding;
    if (adding) input.focus();
  };
  $("#detail-dialog").showModal();
  if (showcase && isVideo(r)) {
    const shareButton = document.createElement('button');
    shareButton.type = 'button'; shareButton.className = 'primary share-route'; shareButton.id = 'share-video';
    shareButton.textContent = '分享';
    shareButton.onclick = () => showcase.share(r, gymName(r.gymId));
    $('#edit-form button[type="submit"]').after(shareButton);
  }
  if (isVideo(r)) {
    const status = $('#video-load-status'), download = $('#download-video'), play = $('#play-cloud-video');
    const readVideo = async action => {
      detailMediaController?.abort();
      const controller = new AbortController();
      detailMediaController = controller;
      download.disabled = true;
      if (play) play.disabled = true;
      status.textContent = r.photo instanceof Blob ? '正在准备视频…' : '正在加载视频，请保持页面打开…';
      try {
        await loadRoutePhoto(r, {signal:controller.signal,onProgress:({loaded,total}) => {
          if (!controller.signal.aborted) status.textContent = `正在加载视频 ${formatBytes(loaded)} / ${formatBytes(total)}`;
        }});
        controller.signal.throwIfAborted();
        if (action === 'play') {
          $('.detail-image', $('#detail-dialog')).innerHTML = videoPlayer(r);
          const video = $('#detail-dialog video');
          status.textContent = '';
          try { await video.play(); } catch { if (!controller.signal.aborted) status.textContent = '视频已就绪，请点击播放。'; }
        } else {
          const a = document.createElement('a');
          a.href = photoURL(r);
          a.download = `PanleMEI视频.${({'video/quicktime':'mov','video/webm':'webm'})[mediaType(r)] || 'mp4'}`;
          a.click();
          status.textContent = '视频已准备好下载。';
        }
      } catch (error) {
        if (!controller.signal.aborted) status.textContent = videoReadError(error);
      } finally {
        if (detailMediaController === controller) {
          detailMediaController = null;
          download.disabled = false;
          if (play) play.disabled = false;
        }
      }
    };
    if (play) play.onclick = async () => {
      stopPlayback();
      const controller = new AbortController(), store=cloudStore, epoch=accountEpoch;
      playbackController=controller;
      play.disabled=true;
      status.textContent='正在准备播放…';
      const fail = error => {
        if (controller.signal.aborted) return;
        stopPlayback();
        const box=$('.detail-image', $('#detail-dialog'));
        box.replaceChildren();
        if (safePoster(r.poster)) {const poster=document.createElement('img');poster.src=r.poster;poster.alt='视频封面';box.append(poster);}
        box.append(play);play.disabled=false;
        status.textContent=error?.message?.includes('当前浏览器') ? error.message : `${videoReadError(error)} 可重试播放，或点击「下载视频」。`;
      };
      try {
        if(!store) throw new Error('请重新登录');
        const source=await store.videoSource(r,{signal:controller.signal});
        const fragmented=await fragmentedPlayback(source,r,{signal:controller.signal,onError:fail});
        const url=fragmented?.url || await streamingURL(source,{signal:controller.signal,onError:fail});
        controller.signal.throwIfAborted();
        if (epoch!==accountEpoch) throw new DOMException('账号已切换','AbortError');
        $('.detail-image', $('#detail-dialog')).innerHTML=videoPlayer(r,url);
        const video=$('#detail-dialog video');
        fragmented?.attach(video);
        video.addEventListener('error',()=>fail(new Error('播放失败')),{once:true});
        video.addEventListener('playing',()=>{status.textContent='边加载边播放 · 关闭窗口可停止继续读取';});
        video.addEventListener('waiting',()=>{status.textContent='正在缓冲…';});
        status.textContent='边加载边播放 · 正在读取开头…';
        try {await video.play();} catch(error) {
          if(!controller.signal.aborted) {
            if(error.name==='NotAllowedError') status.textContent='视频已就绪，请点击播放器上的播放按钮。';
            else fail(error);
          }
        }
      } catch(error) {fail(error);}
    };
    download.onclick = () => readVideo('download');
  }
  $("#edit-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target),
      name = data.get("name").trim(),
      gymId = data.get("gymId"),
      gym = gymId === "__new__" ? (data.get("newGym") || "").trim() : state.gyms.find(g => g.id === gymId)?.name,
      grade = normalizeGrade(data.get("grade"));
    if (!name || !gym || !grade) {
      $("#edit-error").textContent = "线路名称、岩馆和难度不能为空。";
      return;
    }
    const button = $("button[type=submit]", e.target);
    button.disabled = true;
    try {
      await commit((s) => {
        let venue = gymId === "__new__"
          ? s.gyms.find(g => g.name.toLowerCase() === gym.toLowerCase())
          : s.gyms.find(g => g.id === gymId);
        const gyms = [...s.gyms];
        if (!venue) {
          venue = { id: crypto.randomUUID(), name: gym };
          gyms.push(venue);
        }
        return {
          gyms,
          routes: s.routes.map((route) =>
            route.id === id
              ? {
                  ...route,
                  name,
                  grade,
                  gymId: venue.id,
                  notes: data.get("notes").trim(),
                  done: data.has("done"),
                  completedAt: data.has("done")
                    ? route.completedAt || Date.now()
                    : null,
                }
              : route,
          ),
        };
      });
      $("#detail-dialog").close();
      toast("线路手记已更新");
    } catch (e) {
      showError(e);
      button.disabled = false;
    }
  };
  $("#delete-route").onclick = async (e) => {
    if (e.target.dataset.confirm !== "true") {
      e.target.dataset.confirm = "true";
      e.target.textContent = "确认删除？此操作无法撤销";
      return;
    }
    e.target.disabled = true;
    try {
      await commit((s) => ({
        ...s,
        routes: s.routes.filter((r) => r.id !== id),
      }));
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
      $("#detail-dialog").close();
      toast("线路已删除");
    } catch (e) {
      showError(e);
      e.target.disabled = false;
    }
  };
}
$("#detail-dialog").addEventListener("close", () => {
  detailMediaController?.abort();
  stopPlayback();
});
const blobDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
$("#export-data").onclick = async () => {
  const button = $("#export-data"), epoch = accountEpoch;
  if (exportController) return;
  const controller = new AbortController();
  exportController = controller;
  button.disabled = true;
  try {
    await writeQueue;
    controller.signal.throwIfAborted();
    const snapshot = state;
    const estimatedBytes = snapshot.routes.reduce((sum, r) => sum + 4 * Math.ceil(mediaSize(r) / 3), 0)
      + new Blob([JSON.stringify({...snapshot, routes:snapshot.routes.map(({photo,...r}) => r)})]).size;
    if (estimatedBytes + 1024 * snapshot.routes.length > BACKUP_FILE_LIMIT)
      throw new Error(`完整备份超过 ${BACKUP_FILE_LIMIT / 1024 ** 2} MB，请先在视频详情中下载视频留存。`);
    const routes = [];
    let actualBytes = new Blob([JSON.stringify({...snapshot,routes:snapshot.routes.map(({photo,...r})=>r)})]).size;
    for (const [index,r] of snapshot.routes.entries()) {
      controller.signal.throwIfAborted();
      button.textContent = `正在读取 ${index + 1}/${snapshot.routes.length}`;
      const photo = await loadRoutePhoto(r, {signal:controller.signal});
      actualBytes += 4 * Math.ceil(photo.size / 3) + 1024;
      if (actualBytes > BACKUP_FILE_LIMIT) throw new Error(`完整备份超过 ${BACKUP_FILE_LIMIT / 1024 ** 2} MB，请在视频详情中单独下载视频。`);
      routes.push({...r, photo:await blobDataURL(photo)});
    }
    controller.signal.throwIfAborted();
    if (epoch !== accountEpoch) throw new DOMException('账号已切换','AbortError');
    const blob = new Blob(
        [
          JSON.stringify({
            app: "climb-log",
            version: snapshot.routes.some(isVideo) ? 2 : 1,
            exportedAt: new Date().toISOString(),
            gyms: snapshot.gyms,
            routes,
          }),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `PanleMEI备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("备份已导出，包含照片和视频");
  } catch (e) {
    if (!controller.signal.aborted) toast(e.message?.startsWith('完整备份超过') ? e.message : '备份导出失败，请检查网络后重试。');
  } finally {
    if (exportController === controller) exportController = null;
    button.textContent = '导出备份';
    button.disabled = !available;
  }
};
$("#restore-data").onclick = () => $("#backup-file").click();
const validText = (s, max) =>
  typeof s === "string" && s.trim().length > 0 && s.length <= max;
async function parseBackup(file) {
  if (file.size > BACKUP_FILE_LIMIT)
    throw new Error(`备份超过 ${BACKUP_FILE_LIMIT / 1024 ** 2} MB，请拆分备份后导入。`);
  const data = JSON.parse(await file.text());
  if (
    data.app !== "climb-log" ||
    ![1, 2].includes(data.version) ||
    !Array.isArray(data.gyms) ||
    !Array.isArray(data.routes) ||
    data.gyms.length > 10000 ||
    data.routes.length > 10000
  )
    throw new Error("这不是有效的PanleMEI备份。");
  const ids = new Set();
  for (const g of data.gyms) {
    if (!validText(g.id, 80) || !validText(g.name, 40) || ids.has(g.id))
      throw new Error("备份的岩馆信息不完整。");
    ids.add(g.id);
  }
  const routeIds = new Set(),
    routes = [];
  for (const r of data.routes) {
    if (
      !validText(r.id, 80) ||
      routeIds.has(r.id) ||
      !ids.has(r.gymId) ||
      !validText(r.name, 80) ||
      !validText(r.grade, 20) ||
      typeof r.done !== "boolean" ||
      !Number.isFinite(r.createdAt) ||
      r.createdAt < 0 ||
      r.createdAt > 8640000000000000 ||
      typeof r.notes !== "string" ||
      r.notes.length > 2000 ||
      typeof r.photo !== "string" ||
      r.photo.length > Math.ceil(mediaStorageLimit(r.photo.startsWith("data:video/") ? "video/mp4" : "image/jpeg") / 3) * 4 + 100 ||
      !/^data:(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm));base64,[A-Za-z0-9+/=]+$/.test(r.photo) ||
      (r.photo.startsWith("data:video/") && data.version !== 2)
    )
      throw new Error("备份中的线路或照片数据不完整。");
    routeIds.add(r.id);
    const response = await fetch(r.photo), raw = await response.blob();
    const video = VIDEO_MIME_TYPES.includes(raw.type);
    if (raw.type.startsWith("video/") && !video) throw new Error("当前版本不支持此备份视频格式。");
    const videoMeta = video ? await inspectSavedVideo(raw) : null;
    const photo = video ? raw : await compressImage(raw);
    routes.push({
      id: r.id,
      gymId: r.gymId,
      name: r.name,
      grade: normalizeGrade(r.grade),
      done: r.done,
      notes: r.notes,
      createdAt: r.createdAt,
      completedAt:
        typeof r.completedAt === "number" && Number.isFinite(r.completedAt)
          ? r.completedAt
          : null,
      photo,
      ...(video ? { poster: safePoster(r.poster), videoMeta } : {}),
    });
  }
  return {
    gyms: data.gyms.map((g) => ({
      id: g.id,
      name: g.name.trim(),
      ...(catalogById.has(g.catalogId) ? { catalogId: g.catalogId } : {}),
    })),
    routes,
  };
}
$("#backup-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const button = $("#restore-data");
  button.disabled = true;
  button.textContent = "恢复中…";
  try {
    const backup = await parseBackup(file);
    let added = 0;
    await commit((s) => {
      const gyms = [...s.gyms],
        mapping = new Map();
      for (const g of backup.gyms) {
        let existing = gyms.find(
          (x) =>
            (g.catalogId && x.catalogId === g.catalogId) ||
            ((!x.catalogId || !g.catalogId || x.catalogId === g.catalogId) &&
              normalizeGymName(x.name) === normalizeGymName(g.name)),
        );
        if (!existing) {
          existing = { ...g, id: crypto.randomUUID() };
          gyms.push(existing);
        } else {
          existing = adoptImportedGym(existing, g, gyms, shanghaiCatalog.gyms);
          gyms[gyms.findIndex((x) => x.id === existing.id)] = existing;
        }
        mapping.set(g.id, existing.id);
      }
      const ids = new Set(s.routes.map((r) => r.id)),
        imported = backup.routes
          .filter((r) => !ids.has(r.id))
          .map((r) => ({ ...r, gymId: mapping.get(r.gymId) }));
      added = imported.length;
      return { gyms, routes: [...s.routes, ...imported] };
    });
    selectedGym = "all";
    resetFilters();
    toast(`恢复完成，新增 ${added} 条线路；已有线路已保留`);
  } catch (error) {
    toast(
      error instanceof SyntaxError
        ? "文件无法读取，请选择导出的 JSON 备份。"
        : error.message || "恢复失败，请检查备份文件。",
    );
  } finally {
    button.disabled = false;
    button.textContent = "恢复备份";
    e.target.value = "";
  }
};
function setAuthMode(mode) {
  if (cloudbaseAuth) return cloudbaseAuth.setMode(mode);
  authMode = mode;
  const recovery = mode === "recovery",
    reset = mode === "reset";
  $("#auth-title").textContent = recovery
    ? "设置新密码"
    : reset
      ? "找回密码"
      : mode === "signup"
        ? "注册PanleMEI账号"
        : "登录同步";
  $("#auth-submit").textContent = recovery
    ? "保存新密码"
    : reset
      ? "发送重置邮件"
      : mode === "signup"
        ? "注册"
        : "登录";
  $("#auth-email-label").hidden = recovery;
  $("#auth-email").required = !recovery;
  $("#auth-password-label").hidden = reset;
  $("#auth-password").required = !reset;
  $("#auth-password").autocomplete =
    mode === "login" ? "current-password" : "new-password";
  $("#auth-password").value = "";
  $("#auth-toggle").textContent = mode === "login" ? "注册账号" : "返回登录";
  $("#auth-modes").hidden = recovery || cloudProvider === "cloudbase";
  $("#auth-reset").hidden = mode !== "login";
  $("#auth-message").textContent = "";
}
function authError(error) {
  if (cloudProvider === "cloudbase" && /invalid|password|credential|not.found/i.test(error.message))
    return "用户名或密码不正确。请使用腾讯云试用账号，原网站账号暂不能在这里登录。";
  if (/invalid.login/i.test(error.message))
    return "邮箱或密码不正确。请使用PanleMEI账号，首次使用先注册。";
  if (/email.not.confirmed/i.test(error.message))
    return "请先打开验证邮件确认邮箱，再登录。";
  if (
    /email_address_not_authorized|email.*not.*allowed|not authorized/i.test(
      error.code || error.message,
    )
  )
    return "当前邮件服务仅支持项目管理员邮箱；开放其他邮箱需先配置邮件服务。";
  if (/rate|too many/i.test(error.message)) return "操作太频繁，请稍后重试。";
  return "操作未完成，请检查网络、邮箱和密码后重试。";
}
$("#cloud-account").onclick = () => {
  if (cloudUser) {
    toast(`当前账号：${accountName(cloudUser)}`);
    return;
  }
  setAuthMode("login");
  $("#auth-dialog").showModal();
};
$("#auth-toggle").onclick = () =>
  setAuthMode(authMode === "login" ? "signup" : "login");
$("#auth-reset").onclick = () => setAuthMode("reset");
$("#auth-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("#auth-submit"),
    mode = authMode;
  const email = $("#auth-email").value.trim(),
    password = $("#auth-password").value;
  button.disabled = true;
  $("#auth-message").textContent = "正在处理…";
  try {
    const redirectTo = `${location.origin}${location.pathname}`;
    const result =
      mode === "signup"
        ? await cloud.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: redirectTo },
          })
        : mode === "reset"
          ? await cloud.auth.resetPasswordForEmail(email, { redirectTo })
          : mode === "recovery"
            ? await cloud.auth.updateUser({ password })
            : await cloud.auth.signInWithPassword(cloudProvider === "cloudbase" ? { username: email, password } : { email, password });
    if (result.error) throw result.error;
    $("#auth-password").value = "";
    if (mode === "reset")
      $("#auth-message").textContent = "如该邮箱已注册，请检查重置邮件。";
    else if (mode === "signup" && !result.data.session)
      $("#auth-message").textContent =
        "请打开验证邮件确认邮箱，然后返回这里登录。";
    else {
      $("#auth-dialog").close();
      if (mode === "recovery") toast("密码已更新");
    }
  } catch (error) {
    $("#auth-message").textContent = authError(error);
  } finally {
    button.disabled = false;
  }
};
function accountName(user) {
  return user?.email || user?.user_metadata?.username || user?.user_metadata?.name || (user ? "试用账号" : "");
}
if (cloudProvider === "cloudbase") {
  document.title = "PanleMEI · 我的线路";
  cloudbaseAuth = installCloudBaseAuth(cloud.auth);
  showcase = installShowcase({ client: cloud, toast, editRoute: id => {
    if (!available || !state.routes.some(r => r.id === id)) return toast('请先刷新云端，读取这条线路后再修改。');
    openDetail(id);
  }, login: () => {
    for (const dialog of $$('dialog[open]')) dialog.close();
    $('#cloud-account').click();
  }});
  showcase.start();
}
function renderAccount() {
  $("#cloud-account").textContent = accountName(cloudUser) || "登录同步";
  $("#cloud-account").title =
    accountName(cloudUser) || "登录后在不同设备使用同一份记录";
  $("#cloud-actions").hidden = !cloudUser;
  $("#account-label").hidden = !cloudUser;
  $(".local-note").hidden = cloudProvider === "cloudbase" && !!cloudUser;
  $("#storage-mode").textContent = cloudUser
    ? "当前账号的私有云端记录"
    : (cloudProvider === "cloudbase" ? "腾讯云试用 · 登录后同步" : "记录仅保存在此浏览器");
  $("#cloud-account").disabled = accountBusy;
  $("#cloud-refresh").disabled = accountBusy;
  $("#cloud-import").disabled = accountBusy || !available;
  $("#cloud-signout").disabled = accountBusy;
}
function clearAccountView() {
  detailMediaController?.abort();
  stopPlayback();
  exportController?.abort();
  processingController?.abort();
  processingController = null;
  videoControl = null; videoProcessingState = "running";
  processing = false;
  for (const dialog of $$("dialog[open]"))
    if (dialog.id !== "auth-dialog") dialog.close();
  pending.forEach((p) => URL.revokeObjectURL(p.url));
  pending = [];
  updatePending();
  urls.forEach(URL.revokeObjectURL);
  urls.clear();
  state = { gyms: [], routes: [] };
  selectedGym = "all";
  closeRenameGym();
  $("#gym-search").value = "";
  $("#gym-form").hidden = true;
}
async function switchAccount(user, force = false) {
  if (!force && (user?.id || null) === (cloudUser?.id || null)) return;
  const epoch = ++accountEpoch;
  available = false;
  accountBusy = true;
  cloudUser = user;
  void showcase?.setUser(user);
  cloudStore = user ? new CloudStore(cloud, user.id, cloudProvider === "cloudbase" ? cloud.storage.from("climb-photos") : createMediaStore(cloud, user.id, { uploads: import.meta.env.VITE_COS_UPLOADS === "true" && (import.meta.env.VITE_COS_USER_IDS || "").split(",").map(id => id.trim()).includes(user.id), endpoint: import.meta.env.VITE_COS_SIGN_ENDPOINT || "/.netlify/functions/cos-sign" }), {chunkedUploads: cloudProvider === "cloudbase", lazyVideos: cloudProvider === "cloudbase"}) : null;
  const store = cloudStore;
  clearAccountView();
  resetFilters();
  renderAccount();
  $("#cloud-status").textContent = user
    ? "正在读取云端记录…"
    : "正在读取本机记录…";
  try {
    await writeQueue;
    const next = await loadWithDefaultGyms(store, undefined, epoch);
    if (epoch !== accountEpoch) return;
    state = next;
    available = true;
    $("#cloud-status").textContent = user
      ? "已读取云端 · 修改后自动保存"
      : "本机模式";
  } catch (error) {
    if (epoch !== accountEpoch) return;
    $("#cloud-status").textContent =
      "读取失败，请检查网络后刷新云端，或退出账号使用本机记录";
  } finally {
    if (epoch === accountEpoch) {
      accountBusy = false;
      render();
      renderAccount();
    }
  }
}
$("#cloud-refresh").onclick = async () => {
  if (!cloudStore || accountBusy) return;
  accountBusy = true;
  renderAccount();
  const store = cloudStore,
    epoch = accountEpoch;
  try {
    await writeQueue;
    available = false;
    render();
    const next = await loadWithDefaultGyms(store, state, epoch);
    if (epoch !== accountEpoch) return;
    urls.forEach(URL.revokeObjectURL);
    urls.clear();
    state = next;
    available = true;
    if (!state.gyms.some((g) => g.id === selectedGym)) selectedGym = "all";
    $("#cloud-status").textContent = "已读取最新云端记录";
    toast("云端记录已刷新");
  } catch (error) {
    $("#cloud-status").textContent = "刷新失败，请检查网络后重试";
    // Keep the visible snapshot, but do not allow writes against an uncertain revision.
  } finally {
    if (epoch === accountEpoch) {
      accountBusy = false;
      render();
      renderAccount();
    }
  }
};
$("#cloud-import").onclick = async () => {
  if (!cloudStore || accountBusy || !available) return;
  accountBusy = true;
  renderAccount();
  const epoch = accountEpoch;
  try {
    const local = await load();
    if (epoch !== accountEpoch) return;
    await commit((s) => mergeLocalRecords(s, local, shanghaiCatalog.gyms));
    toast("本机记录已合并到当前账号，原有本机记录仍保留");
  } catch (error) {
    showError(error);
  } finally {
    if (epoch === accountEpoch) {
      accountBusy = false;
      renderAccount();
    }
  }
};
$("#cloud-signout").onclick = async () => {
  if (accountBusy) return;
  accountBusy = true;
  renderAccount();
  try {
    await writeQueue;
    const { error } = await cloud.auth.signOut({ scope: "local" });
    if (error) throw error;
  } catch (error) {
    toast("退出失败，请稍后重试");
  } finally {
    accountBusy = false;
    renderAccount();
  }
};
window.addEventListener("beforeunload", () => {
  urls.forEach(URL.revokeObjectURL);
  pending.forEach((p) => URL.revokeObjectURL(p.url));
});
try {
  db = await openDB();
  state = await loadWithDefaultGyms(null);
  available = true;
  db.onversionchange = () => {
    db.close();
    available = false;
    $("#storage-error").textContent = "存储已更新，请刷新页面后继续。";
    $("#storage-error").hidden = false;
    render();
  };
} catch (error) {
  console.error(error);
  $("#storage-error").textContent =
    "无法使用浏览器本地存储。请开启网站存储权限，或使用普通浏览窗口后重试。";
  $("#storage-error").hidden = false;
}
render();
renderAccount();
if (db) {
  let authEventVersion = 0;
  cloud.auth.onAuthStateChange((event, session) => {
    authEventVersion++;
    // Defer Supabase calls until outside the auth callback's internal lock.
    setTimeout(() => {
      void switchAccount(session?.user || null);
      if (
        session &&
        (event === "PASSWORD_RECOVERY" ||
          (event === "INITIAL_SESSION" && recoveryLink))
      ) {
        setAuthMode("recovery");
        if (!$("#auth-dialog").open) $("#auth-dialog").showModal();
      }
    }, 0);
  });
  // CloudBase does not replay INITIAL_SESSION to listeners registered after SDK
  // initialization. Restore it explicitly, without overwriting a newer event.
  if (cloudProvider === "cloudbase") {
    const initialVersion = authEventVersion;
    const { data, error } = await cloud.auth.getSession();
    if (!error && initialVersion === authEventVersion)
      await switchAccount(data?.session?.user || null);
  }
}
