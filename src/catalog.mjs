/** Enrich verified OSM branches without changing their coordinates or ODbL provenance. */
export function combineCatalog(base, enrichment = []) {
  const rows = Array.isArray(base) ? base : base.pois;
  const supplements = new Map(enrichment.map(row => [row.osmId, row]));
  return rows.map(poi => {
    const extra = supplements.get(poi.id);
    if (!extra || !extra.eventuraSource?.sourceUrl || extra.matchEvidence?.method !== 'exact_normalized_name_and_address') return poi;
    const source = { source: extra.eventuraSource.provenance?.source || 'Eventura', ...extra.eventuraSource };
    const fields = {};
    const fieldSources = { ...poi.fieldSources };
    for (const key of ['rating', 'reviewCount', 'address']) {
      const value = extra.fields[key];
      if (value === undefined || value === null || value === '') continue;
      // Keep any known incumbent field and its original provenance.
      if (poi[key] !== undefined && poi[key] !== null && poi[key] !== '') continue;
      fields[key] = value;
      fieldSources[key] = source;
    }
    const contacts = { ...poi.contacts };
    for (const [key, value] of Object.entries(extra.fields.contacts || {})) {
      if (value && !contacts[key] && !poi[key]) { contacts[key] = value; fieldSources[key] = source; fieldSources.contacts = source; }
    }
    return { ...poi, ...fields, contacts, fieldSources, additionalSources: [...(poi.additionalSources || []), source],
      enrichmentMatch: extra.matchEvidence };
  });
}
