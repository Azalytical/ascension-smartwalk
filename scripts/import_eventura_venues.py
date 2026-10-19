#!/usr/bin/env python3
"""Read Eventura's public venue snapshots without changing the source project.

Only the two explicit directory exports are read. Mock fixtures, databases,
credentials, user profiles and bookings are never inspected or imported.
Coordinates are not guessed: the directory keeps null coordinates, and a
separate file enriches existing OSM points only after name + address matching.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse


SOURCE_FILES = ("places-2gis.json", "places.json")
KAZAKH_FOLD = str.maketrans("әғқңөұүһі", "агкноуухи")
# Explicit bilingual spellings, never fuzzy matching arbitrary addresses.
STREET_ALIASES = {
    "мухамедханов": "мухамедханов", "мухамедханова": "мухамедханов",
    "мухамедхановкаиым": "каиыммухамедханов",
    "сатпаева": "сатпаев", "маилина": "маилин", "бараева": "бараев",
    "петрова": "петров", "нажимеденов": "нажимеденов", "нажимеденова": "нажимеденов",
    "нарикбаева": "нарикбаев", "максута": "максут", "мухтара": "мухтар",
    "ауэзова": "ауэзов", "кошкарбаева": "кошкарбаев",
    "бейбитшилик": "беибитшилик", "беибитшилик": "беибитшилик",
    "москва": "маскеу", "маскеу": "маскеу",
}
STREET_TYPES = re.compile(r"\b(?:улица|ул|проспект|просп|прт|пр|переулок|пер|шоссе|ш|көшесі|кошеси|даңғылы|дангылы|көш|астана|аstana|трц|mega|silk|way)\b", re.I)


def text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def normalize(value):
    return re.sub(r"[^\w\d]", "", unicodedata.normalize("NFKC", str(value or "")).casefold().replace("ё", "е"))


def public_url(value):
    value = text(value)
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return None
    return value


def number(value, minimum=0, maximum=math.inf):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and minimum <= value <= maximum else None


def category_for(row):
    categories = row.get("rubrics") or row.get("categories") or [row.get("categoryName")]
    joined = " ".join(value for value in categories if isinstance(value, str)).casefold()
    if re.search(r"ресторан|пиццери|суши|быстрое питание|фастфуд|столов", joined):
        return "restaurant"
    if re.search(r"кофейн|кафе|пекарн|кондитер", joined):
        return "cafe"
    # Hotels, private banquet rooms, equipment rental, bars and karaoke do not
    # silently become a restaurant or another supported walking category.
    return None


def source_id(row, provider):
    url = row["url"]
    if provider == "2GIS":
        match = re.search(r"/firm/(\d+)", url)
        if match:
            return f"eventura:2gis:{match[1]}"
    place_id = parse_qs(urlparse(url).query).get("query_place_id", [])
    return f"eventura:google:{place_id[0]}" if place_id else f"eventura:{hashlib.sha256(url.encode()).hexdigest()[:20]}"


def normalize_row(row, provider, source_file):
    name = text(row.get("title"))
    source_url = public_url(row.get("url"))
    if not name or not source_url:
        return None
    # A comma in 2GIS titles separates the business name from its descriptor.
    short_name = name.split(",", 1)[0].strip() if provider == "2GIS" else name
    categories = [value.strip() for value in row.get("rubrics", row.get("categories", [])) if text(value)]
    if not categories and text(row.get("categoryName")):
        categories = [text(row["categoryName"])]
    category = category_for(row)
    city = "Косшы" if "/kosshy/" in source_url else text(row.get("city")) or "Астана"
    address = text(row.get("address")) or text(row.get("street"))
    website = public_url(row.get("website"))
    instagram = website if website and (urlparse(website).hostname or "").lower() in {"instagram.com", "www.instagram.com"} else None
    phone = text(row.get("phone"))
    contacts = {key: value for key, value in {"phone": phone, "website": website, "instagram": instagram}.items() if value}
    return {
        "id": source_id(row, provider), "name": short_name, "sourceTitle": name,
        "lat": None, "lon": None, "category": category,
        "description": ", ".join(categories) + (f". Адрес: {address}." if address else ".") if categories else (f"Адрес: {address}." if address else None),
        "descriptionKind": "derived_from_source_category_and_address", "city": city, "address": address,
        "tags": {"eventura:categories": "; ".join(categories), "eventura:category": text(row.get("category"))},
        "sourceUrl": source_url, "retrievedAt": None, "openingHours": None,
        "contacts": contacts, "website": website, "phone": phone,
        "averageCheck": None, "rating": number(row.get("totalScore"), 0, 5),
        "reviewCount": number(row.get("reviewsCount")), "popularity": None,
        "coordinateSource": None, "recommendationEligible": False,
        "eligibilityReason": "coordinates_missing" if city == "Астана" and category else "outside_astana" if city != "Астана" else "unsupported_category",
        "license": None,
        "provenance": {"source": provider, "via": "Eventura local public venue directory", "sourceFile": source_file,
                       "sourceUrl": source_url, "retrievedAt": None, "license": None},
    }


def house(value):
    if not text(value):
        return None
    # Cyrillic suffixes and their Latin lookalikes denote the same building.
    folded = value.casefold().replace("\"", "").replace("«", "").replace("»", "")
    folded = re.sub(r"\s+", "", folded).translate(str.maketrans({"а": "a", "в": "b", "с": "c", "е": "e", "к": "k", "т": "t", "м": "m", "н": "h", "о": "o", "р": "p", "х": "x", "у": "y"}))
    return folded if re.fullmatch(r"\d+[\w]*(?:/\d+[\w]*)?", folded) else None


def street(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold().replace("ё", "е")
    value = STREET_TYPES.sub(" ", value).translate(KAZAKH_FOLD)
    tokens = re.findall(r"[^\W\d_]+", value)
    return "".join(STREET_ALIASES.get(token, token) for token in tokens)


def directory_address(value):
    if not value:
        return None
    # A terminal house number is required; block/floor addresses are kept
    # unresolved rather than discarding a possibly meaningful branch suffix.
    match = re.search(r"[, ]+(\d+[a-zа-яәіңғүұқөһ]*(?:/\d+[a-zа-яәіңғүұқөһ]*)?)\s*$", value, re.I)
    if not match:
        return None
    return street(value[:match.start()]), house(match[1])


def osm_address(row):
    tags = row.get("tags") if isinstance(row.get("tags"), dict) else {}
    if text(tags.get("addr:street")) and house(tags.get("addr:housenumber")):
        return street(tags["addr:street"]), house(tags["addr:housenumber"])
    return directory_address(tags.get("addr:full"))


def name_keys(row):
    names = [row.get(key) for key in ("name", "nameRu", "nameKk", "nameEn")]
    tags = row.get("tags") if isinstance(row.get("tags"), dict) else {}
    names += [tags.get(key) for key in ("name", "name:ru", "name:kk", "name:en")]
    return {normalize(name) for name in names if text(name)}


def enrich(directory, osm):
    names = collections.defaultdict(dict)
    for point in osm:
        for key in name_keys(point):
            names[key][str(point["id"])] = point
    enrichment = []
    used_pairs = set()
    for venue in directory:
        if venue["city"] != "Астана" or not venue["category"]:
            continue
        candidates = list(names.get(normalize(venue["name"]), {}).values())
        address = directory_address(venue["address"])
        if not address or not all(address):
            continue
        matches = [point for point in candidates if osm_address(point) == address
                   and point.get("category") in {"cafe", "restaurant"}]
        if len(matches) != 1:
            continue
        point = matches[0]
        pair = (point["id"], venue["id"])
        if pair in used_pairs:
            continue
        used_pairs.add(pair)
        fields = {key: value for key, value in {"rating": venue["rating"], "reviewCount": venue["reviewCount"],
                  "contacts": venue["contacts"] or None, "address": venue["address"]}.items() if value is not None}
        enrichment.append({
            "osmId": point["id"], "fields": fields,
            "eventuraSource": {"id": venue["id"], "sourceUrl": venue["sourceUrl"], "retrievedAt": None,
                               "license": None, "provenance": venue["provenance"]},
            "matchEvidence": {"method": "exact_normalized_name_and_address", "name": venue["name"],
                              "eventuraAddress": venue["address"], "osmAddress": {key: value for key, value in point.get("tags", {}).items() if key.startswith("addr:")},
                              "normalizedStreet": address[0], "normalizedHouse": address[1],
                              "matchingOsmPointsAtThisAddress": len(matches)},
        })
    return enrichment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--eventura-dir", required=True, type=Path)
    parser.add_argument("--osm-file", type=Path, default=Path("data/pois.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    source_root, output_root = args.eventura_dir.resolve(), args.output_dir.resolve()
    if output_root == source_root or source_root in output_root.parents:
        parser.error("The output directory must be outside Eventura; the source is read-only.")
    imported, fingerprints = [], []
    for filename in SOURCE_FILES:
        raw = (source_root / filename).read_bytes()
        rows = json.loads(raw)
        if not isinstance(rows, list):
            parser.error(f"{filename} must contain a public directory array")
        provider = "2GIS" if filename == "places-2gis.json" else "Google Maps"
        normalized_rows = [normalized for row in rows if isinstance(row, dict) and (normalized := normalize_row(row, provider, filename))]
        imported += normalized_rows
        fingerprints.append({"file": filename, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "records": len(rows),
                             "importedRecords": len(normalized_rows), "skippedInvalidRecords": len(rows) - len(normalized_rows)})
    # Do not merge different provider URLs without coordinates: the same name
    # can belong to several branches. Multiple source facts remain auditable.
    by_id = {row["id"]: row for row in imported}
    directory = sorted(by_id.values(), key=lambda row: row["id"])
    osm = json.loads(args.osm_file.read_text())
    enrichment = enrich(directory, osm)
    for source in fingerprints:
        if hashlib.sha256((source_root / source["file"]).read_bytes()).hexdigest() != source["sha256"]:
            raise RuntimeError("Source changed during read-only import; rerun the import.")
    metadata = {
        "schemaVersion": 1, "importedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": fingerprints, "directoryRecords": len(directory),
        "cityCounts": dict(collections.Counter(row["city"] for row in directory)),
        "categoryCounts": dict(collections.Counter(row["category"] or "unsupported" for row in directory)),
        "recordsWithSourceCoordinates": 0, "recordsWithKnownAverageCheck": 0, "recordsWithKnownOpeningHours": 0,
        "enrichmentRecords": len(enrichment), "enrichedOsmPoints": len({row["osmId"] for row in enrichment}),
        "notes": [
            "Eventura was read only; only places-2gis.json and places.json were read.",
            "Mock venue constants, user data, credentials, bookings, reviews by individual authors and photos are excluded.",
            "Coordinates, prices, opening hours and original retrieval dates are absent in the source exports and remain null.",
            "reviewCount is a count of directory reviews, not popularity or a real-time signal.",
            "No coordinate-free directory record can enter geographic retrieval until its location is verified.",
            "Provider records remain separate: matching names do not prove matching branches.",
            "Enrichment is allowed only for an exact normalized name plus street and house number; both records must describe a cafe or restaurant and the OSM match must be unique at that address. The OSM category is preserved.",
            "The local snapshots contain no license grant; provider terms may apply. Their metadata is separate from OSM's ODbL provenance.",
        ],
    }
    output_root.mkdir(parents=True, exist_ok=True)
    for filename, data in [("eventura-venues.json", directory), ("eventura-enrichment.json", enrichment), ("eventura-import-metadata.json", metadata)]:
        (output_root / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: metadata[key] for key in ("directoryRecords", "cityCounts", "categoryCounts", "enrichmentRecords", "enrichedOsmPoints")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
