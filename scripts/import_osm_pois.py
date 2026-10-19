#!/usr/bin/env python3
"""Import named Astana POIs from Overpass without credentials or geocoding.

Run: python scripts/import_osm_pois.py
Offline rebuild: python scripts/import_osm_pois.py --offline
All output stays in ../data. The raw response is retained byte-for-byte.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DATA = Path(__file__).resolve().parents[1] / "data"
BBOX = (51.04, 71.28, 51.23, 71.62)  # south, west, north, east
ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
LICENSE = "ODbL-1.0"
LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
ATTRIBUTION = "© OpenStreetMap contributors"
SOURCE_URL = "https://www.openstreetmap.org/copyright"
QUERY = """[out:json][timeout:150][bbox:51.04,71.28,51.23,71.62];
(
  nwr[amenity~"^(cafe|restaurant|fast_food|food_court|ice_cream|bar|pub|arts_centre|theatre|cinema|library|exhibition_centre)$"];
  nwr[tourism~"^(museum|gallery|attraction|viewpoint|artwork|zoo|theme_park)$"];
  nwr[leisure~"^(park|garden|playground|nature_reserve)$"];
  nwr[historic~"^(monument|memorial|castle|ruins|archaeological_site)$"];
  nwr[shop=mall];
);
out meta center;
"""
LABELS = {
    "cafe": "Кафе", "restaurant": "Ресторан", "fast_food": "Быстрое питание",
    "food_court": "Фуд-корт", "ice_cream": "Мороженое", "bar": "Бар", "pub": "Паб",
    "museum": "Музей", "gallery": "Галерея", "attraction": "Достопримечательность",
    "viewpoint": "Обзорная точка", "artwork": "Арт-объект", "zoo": "Зоопарк",
    "theme_park": "Парк развлечений", "park": "Парк", "garden": "Сад",
    "playground": "Детская площадка", "nature_reserve": "Природная территория",
    "monument": "Памятник", "memorial": "Мемориал", "castle": "Замок",
    "ruins": "Руины", "archaeological_site": "Археологический объект",
    "arts_centre": "Культурный центр", "theatre": "Театр", "cinema": "Кинотеатр",
    "library": "Библиотека", "mall": "Торговый центр",
    "exhibition_centre": "Выставочный центр",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_json(path, value):
    """Atomic replacement means the app always sees a complete JSON file."""
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def fetch():
    payload = urlencode({"data": QUERY}).encode("utf-8")
    attempts = []
    for endpoint in ENDPOINTS:
        start = utc_now()
        try:
            request = Request(endpoint, data=payload, headers={
                "User-Agent": "Ascension-Smartwalk-POI-Importer/1.0 (educational Astana dataset)",
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                "Accept": "application/json",
            })
            with urlopen(request, timeout=180) as response:
                body = response.read()
            parsed = json.loads(body)
            if parsed.get("remark") or not isinstance(parsed.get("elements"), list):
                raise ValueError("Overpass returned an incomplete/error response: " + str(parsed.get("remark")))
            if not parsed["elements"]:
                raise ValueError("Overpass returned zero elements; previous dataset will be preserved")
            retrieved = utc_now()
            attempts.append({"endpoint": endpoint, "startedAt": start, "status": "success"})
            raw_path = DATA / "overpass-astana.raw.json"
            meta = {
                "source": "OpenStreetMap via Overpass API", "endpoint": endpoint,
                "retrievedAt": retrieved, "queryFile": "overpass-astana.ql",
                "rawFile": raw_path.name, "rawSha256": hashlib.sha256(body).hexdigest(),
                "osmBaseTimestamp": parsed.get("osm3s", {}).get("timestamp_osm_base"),
                "license": LICENSE, "licenseUrl": LICENSE_URL, "attribution": ATTRIBUTION,
                "attributionUrl": SOURCE_URL, "bbox": dict(zip(("south", "west", "north", "east"), BBOX)),
                "attempts": attempts,
            }
            return parsed, meta, body
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            attempts.append({"endpoint": endpoint, "startedAt": start, "status": "failed", "error": str(exc)})
            print(f"Endpoint failed: {endpoint}: {exc}", file=sys.stderr, flush=True)
            time.sleep(3)
    raise RuntimeError("All Overpass endpoints failed; existing outputs were preserved. " + json.dumps(attempts))


def category(tags):
    for key in ("tourism", "leisure", "historic", "amenity", "shop"):
        if tags.get(key) in LABELS:
            return tags[key]
    return None


def distance_m(a_lat, a_lon, b_lat, b_lon):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371008.8 * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1 - h)))


def describe(tags, kind):
    for key in ("description:ru", "description", "description:kk", "description:en"):
        if tags.get(key, "").strip():
            return tags[key].strip(), {"kind": "source_tag", "tagKeys": [key]}
    pieces, keys = [LABELS[kind] + "."], []
    address = ", ".join(tags[k] for k in ("addr:street", "addr:housenumber") if tags.get(k))
    if address:
        pieces.append("Адрес по OSM: " + address + ".")
        keys.extend(k for k in ("addr:street", "addr:housenumber") if tags.get(k))
    for key, label in (("cuisine", "Кухня"), ("artwork_type", "Тип арт-объекта"),
                       ("subject", "Тема"), ("operator", "Оператор")):
        if tags.get(key):
            pieces.append(label + ": " + tags[key] + ".")
            keys.append(key)
    return " ".join(pieces), {"kind": "derived_from_osm_tags", "tagKeys": keys + [
        next(k for k in ("tourism", "leisure", "historic", "amenity", "shop") if tags.get(k) == kind)]}


def normalize(raw, meta):
    seen, pois, excluded, duplicate_ids = set(), [], Counter(), []
    for element in raw["elements"]:
        uid = f"osm:{element['type']}:{element['id']}"
        if uid in seen:
            duplicate_ids.append(uid)
            continue
        seen.add(uid)
        tags = element.get("tags", {})
        name_key = next((k for k in ("name", "name:ru", "name:kk", "name:en", "official_name", "short_name")
                         if tags.get(k, "").strip()), None)
        if not name_key:
            excluded["no_source_name"] += 1
            continue
        kind = category(tags)
        if not kind:
            excluded["unsupported_category"] += 1
            continue
        point = element if element["type"] == "node" else element.get("center", {})
        lat, lon = point.get("lat"), point.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            excluded["missing_coordinates"] += 1
            continue
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            excluded["representative_point_outside_bbox"] += 1
            continue
        # Exclude lifecycle-tagged closures rather than recommending an inactive business.
        if any(tags.get(k) == "yes" for k in ("disused", "abandoned", "demolished", "removed")):
            excluded["inactive_lifecycle"] += 1
            continue
        if tags.get("access") in ("private", "no"):
            excluded["non_public_access"] += 1
            continue
        desc, desc_provenance = describe(tags, kind)
        source_url = f"https://www.openstreetmap.org/{element['type']}/{element['id']}"
        phone = tags.get("contact:phone") or tags.get("phone") or None
        website = tags.get("contact:website") or tags.get("website") or None
        pois.append({
            "id": uid, "name": tags[name_key].strip(), "nameRu": tags.get("name:ru") or None,
            "nameKk": tags.get("name:kk") or None, "nameEn": tags.get("name:en") or None,
            "lat": lat, "lon": lon, "category": kind, "description": desc,
            "tags": tags, "sourceUrl": source_url, "retrievedAt": meta["retrievedAt"],
            "openingHours": tags.get("opening_hours") or None,
            "phone": phone, "website": website,
            "email": tags.get("contact:email") or tags.get("email") or None,
            "access": tags.get("access") or None, "fee": tags.get("fee") or None,
            "wheelchair": tags.get("wheelchair") or None,
            "rating": None, "popularity": None,
            "contacts": {"phone": phone, "website": website,
                         "email": tags.get("contact:email") or tags.get("email") or None},
            "osmType": element["type"], "osmId": element["id"],
            "coordinateSource": "osm_node" if element["type"] == "node" else "overpass_bbox_center",
            "osmUpdatedAt": element.get("timestamp"), "osmVersion": element.get("version"),
            "license": LICENSE,
            "provenance": {"source": "OpenStreetMap", "sourceUrl": source_url,
                           "retrievedAt": meta["retrievedAt"], "license": LICENSE,
                           "licenseUrl": LICENSE_URL, "attribution": ATTRIBUTION,
                           "nameTag": name_key, "description": desc_provenance},
            # No environmental/experiential properties are inferred from the category.
            "quietness": None, "powerSockets": None, "interactivity": None, "events": None,
        })
    # Overlapping node + area names can represent one venue; flag for review without
    # automatically deleting legitimate neighbouring branches or distinct facilities.
    candidates = []
    groups = {}
    def name_keys(poi):
        names = [poi["name"]] + [value for key, value in poi["tags"].items()
                                  if key.startswith("name:") or key in ("official_name", "short_name")]
        result = set()
        for name in names:
            # A city suffix in a mapped alternate name is not part of venue identity.
            name = re.sub(r"(?:\s+|,\s*)(astana|астана)$", "", name.casefold())
            result.add(re.sub(r"\W+", "", name, flags=re.UNICODE))
        return result - {""}
    for poi in pois:
        for normalized_name in name_keys(poi):
            groups.setdefault((normalized_name, poi["category"]), []).append(poi)
    paired = set()
    for group in groups.values():
        for i, left in enumerate(group):
            for right in group[i + 1:]:
                meters = distance_m(left["lat"], left["lon"], right["lat"], right["lon"])
                pair_key = tuple(sorted((left["id"], right["id"])))
                if meters <= 40 and pair_key not in paired:
                    paired.add(pair_key)
                    candidates.append({"ids": [left["id"], right["id"]], "name": left["name"],
                                       "distanceMeters": round(meters, 2), "action": "retained_for_review"})
    return sorted(pois, key=lambda p: p["id"]), excluded, duplicate_ids, candidates


def quality(pois, raw, meta, excluded, duplicate_ids, candidates):
    areas = {
        "expoMega": {"label": "EXPO / MEGA Silk Way", "bbox": [51.080, 71.395, 51.107, 71.435]},
        "leftBankCenter": {"label": "Baiterek / Nurzhol / left-bank centre", "bbox": [51.115, 71.400, 51.145, 71.460]},
        "historicCenter": {"label": "Ishim embankment / old centre", "bbox": [51.151, 71.405, 51.180, 71.450]},
    }
    coverage = {}
    for key, area in areas.items():
        south, west, north, east = area["bbox"]
        selected = [p for p in pois if south <= p["lat"] <= north and west <= p["lon"] <= east]
        coverage[key] = {**area, "count": len(selected), "byCategory": dict(sorted(Counter(p["category"] for p in selected).items())),
                         "sample": [{k: p[k] for k in ("id", "name", "lat", "lon")} for p in selected[:8]]}
    required = {"id": str, "name": str, "lat": (int, float), "lon": (int, float),
                "category": str, "description": str, "tags": dict, "sourceUrl": str, "retrievedAt": str}
    errors = []
    for p in pois:
        for field, expected in required.items():
            if not isinstance(p.get(field), expected):
                errors.append({"id": p.get("id"), "field": field, "error": "invalid type"})
        if p.get("openingHours") is not None and not isinstance(p["openingHours"], str):
            errors.append({"id": p["id"], "field": "openingHours", "error": "invalid type"})
    report = {
        "generatedAt": utc_now(), "retrievedAt": meta["retrievedAt"],
        "rawElements": len(raw["elements"]), "normalizedCount": len(pois),
        "uniqueIds": len({p["id"] for p in pois}), "duplicateIdsRemoved": duplicate_ids,
        "excludedCounts": dict(excluded), "byCategory": dict(sorted(Counter(p["category"] for p in pois).items())),
        "unnamedSourceObjectsByCategory": dict(sorted(Counter(
            category(e.get("tags", {})) or "unknown" for e in raw["elements"]
            if not any(e.get("tags", {}).get(k, "").strip()
                       for k in ("name", "name:ru", "name:kk", "name:en", "official_name", "short_name"))
        ).items())),
        "byOsmType": dict(sorted(Counter(p["osmType"] for p in pois).items())),
        "contractErrors": errors, "bboxRequested": meta["bbox"],
        "bboxActual": {"south": min(p["lat"] for p in pois), "west": min(p["lon"] for p in pois),
                       "north": max(p["lat"] for p in pois), "east": max(p["lon"] for p in pois)},
        "coverage": coverage, "possibleDuplicatePairs": candidates,
        "completeness": {"withOpeningHours": sum(p["openingHours"] is not None for p in pois),
                         "withPhone": sum(p["phone"] is not None for p in pois),
                         "withWebsite": sum(p["website"] is not None for p in pois),
                         "withEmail": sum(p["email"] is not None for p in pois),
                         "sourceDescriptions": sum(p["provenance"]["description"]["kind"] == "source_tag" for p in pois)},
        "checks": {"atLeast300NamedPois": len(pois) >= 300, "allIdsUnique": len({p["id"] for p in pois}) == len(pois),
                   "contractValid": not errors, "allWithinBbox": all(BBOX[0] <= p["lat"] <= BBOX[2] and BBOX[1] <= p["lon"] <= BBOX[3] for p in pois),
                   "expoMegaCovered": coverage["expoMega"]["count"] > 0,
                   "leftBankCenterCovered": coverage["leftBankCenter"]["count"] > 0,
                   "historicCenterCovered": coverage["historicCenter"]["count"] > 0},
        "limitations": [
            "This is a bbox extract, not an administrative boundary or exhaustive catalogue.",
            "Unnamed source objects are excluded; their real tags remain in the raw response.",
            "Ways and relations use Overpass bounding-box centres, not verified entrances or routing access points.",
            "Near-name duplicates are flagged, not merged across OSM objects; IDs are deduplicated exactly.",
            "Normalized count is a count of distinct OSM objects, not independently verified distinct venues.",
            "Mapped access=private/no objects are excluded; absence of an access tag is not proof of public entry.",
            "OSM data is community maintained; opening hours and contacts may be absent or outdated.",
            "Quietness, sockets, interactivity and events are unknown; no values are invented.",
            "Opening hours are preserved as raw OSM expressions; open-now is not evaluated.",
            "No field survey, live venue checks, routing-time validation or city-wide completeness claim is made.",
        ],
        "provenance": {"source": "OpenStreetMap via Overpass API", "endpoint": meta["endpoint"],
                       "rawSha256": meta["rawSha256"], "osmBaseTimestamp": meta["osmBaseTimestamp"],
                       "license": LICENSE, "licenseUrl": LICENSE_URL,
                       "attribution": ATTRIBUTION, "attributionUrl": SOURCE_URL},
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Rebuild from the retained response without network requests")
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    if args.offline:
        raw = json.loads((DATA / "overpass-astana.raw.json").read_text(encoding="utf-8"))
        meta = json.loads((DATA / "import-metadata.json").read_text(encoding="utf-8"))
        actual_hash = hashlib.sha256((DATA / "overpass-astana.raw.json").read_bytes()).hexdigest()
        if actual_hash != meta["rawSha256"]:
            raise ValueError("Retained raw response hash does not match import metadata")
        body = None
    else:
        raw, meta, body = fetch()
    pois, excluded, duplicates, candidates = normalize(raw, meta)
    if not pois:
        raise ValueError("No eligible named POIs; previous normalized outputs were preserved")
    report = quality(pois, raw, meta, excluded, duplicates, candidates)
    if not all(report["checks"].values()):
        write_json(DATA / "import-failure-report.json", report)
        print("Quality checks failed; existing dataset was preserved.", file=sys.stderr)
        raise SystemExit(2)
    if body is not None:
        raw_path = DATA / "overpass-astana.raw.json"
        raw_temp = raw_path.with_name(raw_path.name + ".tmp")
        raw_temp.write_bytes(body)
        raw_temp.replace(raw_path)
        write_json(DATA / "import-metadata.json", meta)
        (DATA / "overpass-astana.ql").write_text(QUERY, encoding="utf-8")
    write_json(DATA / "pois.json", pois)
    write_json(DATA / "quality-report.json", report)
    print(json.dumps({"normalizedCount": len(pois), "byCategory": report["byCategory"],
                      "coverage": {k: v["count"] for k, v in report["coverage"].items()},
                      "checks": report["checks"], "output": str(DATA / "pois.json")}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    main()
