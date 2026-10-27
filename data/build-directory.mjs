import { readFile, writeFile, mkdir } from "node:fs/promises";
const catalog = JSON.parse(
  await readFile(new URL("../src/shanghai-gyms.json", import.meta.url), "utf8"),
);
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const rows = [...catalog.gyms]
  .sort((a, b) =>
    (a.district + a.name).localeCompare(b.district + b.name, "zh-CN"),
  )
  .map(
    (gym) =>
      `<tr><td>${escape(gym.district)}</td><td>${escape(gym.name)}</td><td>${escape(gym.address) || "详见来源"}</td><td>${gym.sources.map((url, i) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">来源 ${i + 1}</a>`).join("、")}</td></tr>`,
  )
  .join("");
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../public/shanghai-gyms.html", import.meta.url),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>上海岩馆名录 · PanleMEI</title><style>body{font:15px/1.8 system-ui,sans-serif;color:#233f35;background:#fafbf7;margin:0;padding:28px;max-width:1100px;margin:auto}a{color:#33674e}h1{font-size:26px}p{max-width:850px}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:650px}th,td{text-align:left;border-bottom:1px solid #dce3d8;padding:12px;vertical-align:top}th{background:#edf1e8}td:last-child{white-space:nowrap}</style><a href="/">← 返回PanleMEI</a><h1>上海岩馆公开名录 · ${catalog.gyms.length} 家</h1><p>整理日期：${catalog.checkedAt}。按独立场馆、分店收录，包含商业岩馆、儿童攀岩馆及公园攀岩场地。资料来自品牌官网、行政许可、媒体与地图/场馆目录。</p><p><strong>这不是全市完整名单，也不是实时营业清单。</strong>部分目录仅能检索到摘要，地址不详的条目保留空白；请通过场馆官方渠道确认营业情况。导入后可自行重命名，重复导入保留已有名称、照片和通关记录。</p><p>已排除公开标记暂停营业的攀猩松江旭辉里、优加虹口壹丰广场、徐汇滨江攀岩墙，以及许可证已注销的岩舞空间颛桥万达店。King88 场地按 2026 年许可记录收录为无界攀岩，旧名爬客/派客作为别名；同一地址的叶岩/RIBBON/共绘、HighFive/酸爽合并收录。</p><div class="table"><table><thead><tr><th>区域</th><th>岩馆 / 分店</th><th>公开地址</th><th>资料来源</th></tr></thead><tbody>${rows}</tbody></table></div></html>`,
);
