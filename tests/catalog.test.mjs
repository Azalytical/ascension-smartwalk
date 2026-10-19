import test from 'node:test';
import assert from 'node:assert/strict';
import { combineCatalog } from '../src/catalog.mjs';

test('Eventura enrichment keeps coordinates, ODbL and provider-specific fact provenance', () => {
  const poi = { id: 'osm:1', name: 'Cafe', lat: 51.12, lon: 71.42, category: 'cafe', rating: null,
    contacts: { phone: '+77111111111' }, sourceUrl: 'https://www.openstreetmap.org/node/1', license: 'ODbL-1.0' };
  const supplement = { osmId: poi.id, fields: { rating: 4.8, reviewCount: 100, contacts: { phone: '+77222222222', website: 'https://cafe.example' } },
    eventuraSource: { sourceUrl: 'https://2gis.kz/astana/firm/123', retrievedAt: null, license: null, provenance: { source: '2GIS' } },
    matchEvidence: { method: 'exact_normalized_name_and_address' } };
  const before = JSON.stringify(poi);
  const [out] = combineCatalog([poi], [supplement]);
  assert.equal(out.lat, poi.lat); assert.equal(out.sourceUrl, poi.sourceUrl); assert.equal(out.license, 'ODbL-1.0');
  assert.equal(out.rating, 4.8); assert.equal(out.fieldSources.rating.sourceUrl, supplement.eventuraSource.sourceUrl);
  assert.equal(out.contacts.phone, poi.contacts.phone); assert.equal(out.contacts.website, 'https://cafe.example');
  assert.equal(out.fieldSources.rating.retrievedAt, null); assert.equal(out.fieldSources.rating.license, null);
  assert.equal(JSON.stringify(poi), before);
});

test('unverified branch matching cannot enrich a POI', () => {
  const poi = {id:'osm:1',name:'Cafe',rating:null};
  assert.equal(combineCatalog([poi], [{osmId:poi.id,fields:{rating:5},eventuraSource:{sourceUrl:'https://example.com'},matchEvidence:{method:'name_only'}}])[0],poi);
});
