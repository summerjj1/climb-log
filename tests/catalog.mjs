import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { mergeCatalog, adoptImportedGym } from "../src/gym-catalog.js";
const { gyms } = JSON.parse(
  await readFile(new URL("../src/shanghai-gyms.json", import.meta.url), "utf8"),
);
assert.equal(new Set(gyms.map((g) => g.id)).size, gyms.length);
assert.ok(
  gyms.every((g) => g.name.length <= 40 && g.sources.length && g.aliases),
);
const catalog = [
  { id: "one", name: "馆 A（新店）", aliases: ["原名"] },
  { id: "two", name: "馆 A（老店）", aliases: [] },
];
const existing = [
  { id: "keep", name: " 原名 " },
  { id: "custom", name: "1GOAT" },
];
const imported = mergeCatalog(existing, catalog, () => "new-id");
assert.equal(imported.added, 1);
assert.equal(imported.gyms[0].id, "keep");
assert.equal(imported.gyms[0].name, " 原名 ");
assert.equal(existing[0].catalogId, undefined);
imported.gyms[0].name = "我的馆";
const again = mergeCatalog(imported.gyms, catalog);
assert.equal(again.added, 0);
assert.equal(again.gyms[0].name, "我的馆");
const normalized = mergeCatalog(
  [{ id: "x", name: "馆a(新店)" }],
  catalog,
  () => "y",
);
assert.equal(normalized.added, 1);
assert.equal(normalized.gyms[0].catalogId, "one");
const defaultGym = { id: "default", name: catalog[0].name, catalogId: "one" };
const restored = adoptImportedGym(defaultGym, { name: "备份自定义馆名", catalogId: "one" }, [defaultGym], catalog);
assert.equal(restored.id, "default");
assert.equal(restored.name, "备份自定义馆名");
assert.equal(adoptImportedGym(restored, { name: "另一个备份名", catalogId: "one" }, [restored], catalog).name, "备份自定义馆名");
console.log(
  `PASS: ${gyms.length} catalog entries, alias/format matching, branch separation, immutable merge, rename idempotence.`,
);
