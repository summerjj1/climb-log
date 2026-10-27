export const normalizeGymName = (name) =>
  name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function adoptImportedGym(existing, incoming, gyms, catalog) {
  const merged = {
    ...existing,
    ...(existing.catalogId || incoming.catalogId
      ? { catalogId: existing.catalogId || incoming.catalogId }
      : {}),
  };
  const entry = catalog.find((g) => g.id === merged.catalogId);
  if (
    entry &&
    normalizeGymName(existing.name) === normalizeGymName(entry.name) &&
    normalizeGymName(incoming.name) !== normalizeGymName(entry.name) &&
    !gyms.some(
      (g) =>
        g.id !== existing.id &&
        normalizeGymName(g.name) === normalizeGymName(incoming.name),
    )
  )
    merged.name = incoming.name;
  return merged;
}

// Catalog identities survive user renames; matching a name never changes an existing ID.
export function mergeCatalog(
  gyms,
  catalog,
  createId = () => crypto.randomUUID(),
) {
  const merged = gyms.map((gym) => ({ ...gym }));
  let added = 0;
  for (const entry of catalog) {
    if (merged.some((gym) => gym.catalogId === entry.id)) continue;
    const names = new Set([entry.name, ...entry.aliases].map(normalizeGymName));
    const existing = merged.find(
      (gym) => !gym.catalogId && names.has(normalizeGymName(gym.name)),
    );
    if (existing) existing.catalogId = entry.id;
    else {
      merged.push({ id: createId(), name: entry.name, catalogId: entry.id });
      added++;
    }
  }
  return { gyms: merged, added };
}
