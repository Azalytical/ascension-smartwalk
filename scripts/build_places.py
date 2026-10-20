#!/usr/bin/env python3
"""Merge the OpenStreetMap import with Overture Maps snapshots into data/places.json.

Run: python scripts/build_places.py   (offline; inputs are files in data/)
Inputs:  data/pois.json, data/overpass-astana.raw.json (OpenStreetMap, import_osm_pois.py)
         data/overture/*.json (Overture Maps, fetch_overture.py)
Outputs: data/places.json (the app dataset), data/places-report.json (counts, rejections, licenses)

OpenStreetMap records keep priority. An Overture place that matches an existing record by name
nearby, or by phone, website or Instagram, only fills that record's missing contacts, with the
source of each filled field recorded. Everything else is added as a separate record that keeps
its own source, license and confidence.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from difflib import SequenceMatcher
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import quote, urlparse

DATA = Path(__file__).resolve().parents[1] / "data"
OVERTURE = DATA / "overture"
BOUNDS = (51.0, 71.25, 51.35, 71.65)  # south, west, north, east; the start-point bounds of src/retrieval.mjs

OSM_SOURCE = {"id": "osm", "label": "OpenStreetMap", "license": "ODbL-1.0",
              "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
              "attribution": "© OpenStreetMap contributors", "attributionUrl": "https://www.openstreetmap.org/copyright"}
DATASET_LABELS = {"meta": "Meta", "Microsoft": "Microsoft", "Foursquare": "Foursquare",
                  "AllThePlaces": "AllThePlaces", "PinMeTo": "PinMeTo"}
LICENSE_URLS = {"CDLA-Permissive-2.0": "https://cdla.dev/permissive-2-0/",
                "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
                "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
                "ODbL-1.0": "https://opendatacommons.org/licenses/odbl/1-0/"}

LABELS = {
    "cafe": "Кафе", "restaurant": "Ресторан", "fast_food": "Быстрое питание", "bakery": "Пекарня",
    "dessert": "Десерты", "museum": "Музей", "gallery": "Галерея", "park": "Парк", "garden": "Сад",
    "playground": "Детская площадка", "mall": "Торговый центр", "cinema": "Кинотеатр", "theatre": "Театр",
    "concert_hall": "Концертный зал", "library": "Библиотека", "arts_centre": "Культурный центр",
    "monument": "Памятник", "memorial": "Мемориал", "artwork": "Арт-объект", "plaza": "Площадь",
    "fountain": "Фонтан", "bridge": "Мост", "place_of_worship": "Место богослужения",
    "amusement_park": "Парк развлечений", "theme_park": "Парк развлечений", "zoo": "Зоопарк", "beach": "Пляж",
    "viewpoint": "Обзорная точка", "attraction": "Достопримечательность",
    "toilets": "Общественный туалет", "drinking_water": "Питьевая вода", "bicycle_rental": "Прокат велосипедов",
}
# Search words in ru/kk/en per kind, so a query like «мечеть» or «фонтан» finds the place by its kind.
KIND_WORDS = {
    "place_of_worship": "мечеть мешіт mosque собор храм церковь church", "fountain": "фонтан субұрқақ fountain",
    "plaza": "площадь алаң square", "bridge": "мост көпір bridge набережная", "bakery": "пекарня выпечка bakery нан",
    "dessert": "десерт кондитерская торт dessert", "concert_hall": "концерт филармония concert",
    "amusement_park": "аттракционы развлечения amusement", "zoo": "зоопарк zoo", "beach": "пляж beach жағажай",
    "toilets": "туалет уборная toilet дәретхана wc", "drinking_water": "вода питьевая water су",
    "bicycle_rental": "велосипед прокат bike велопрокат",
}
FEATURE_WORDS = {"wifi": "wifi вайфай интернет", "outdoorSeating": "веранда терраса летняя на улице",
                 "vegetarian": "вегетарианское веган vegetarian vegan", "halal": "халал halal",
                 "wheelchair": "коляска пандус доступная среда wheelchair", "takeaway": "с собой навынос takeaway"}
SLIM_TAGS = ("amenity", "leisure", "tourism", "historic", "shop", "building", "man_made", "cuisine", "religion",
             "denomination", "sport", "artwork_type", "memorial", "subject", "operator", "brand", "access", "fee",
             "wheelchair", "internet_access", "outdoor_seating", "takeaway", "diet:vegetarian", "diet:vegan", "diet:halal")

PLACE_KINDS = {
    "cafe": "cafe", "coffee_shop": "cafe", "tea_room": "cafe", "bubble_tea_shop": "cafe", "smoothie_juice_bar": "cafe",
    "bakery": "bakery", "dessert_shop": "dessert", "ice_cream_shop": "dessert", "cupcake_shop": "dessert",
    "chocolatier": "dessert", "fast_food_restaurant": "fast_food", "museum": "museum", "history_museum": "museum",
    "art_museum": "museum", "science_museum": "museum", "art_gallery": "gallery", "park": "park", "garden": "garden",
    "botanical_garden": "garden", "shopping_mall": "mall", "movie_theater": "cinema", "theatre_venue": "theatre",
    "music_venue": "concert_hall", "opera_and_ballet": "concert_hall", "library": "library",
    "cultural_center": "arts_centre", "monument": "monument", "sculpture_statue": "monument", "public_plaza": "plaza",
    "public_fountain": "fountain", "bridge": "bridge", "muslim_place_of_worship": "place_of_worship",
    "christian_place_of_worship": "place_of_worship", "roman_catholic_place_of_worship": "place_of_worship",
    "jewish_place_of_worship": "place_of_worship", "amusement_park": "amusement_park", "zoo": "zoo",
    "playground": "playground", "beach": "beach",
}
FOOD = {"cafe", "bakery", "dessert", "restaurant", "fast_food"}
MIN_CONFIDENCE = {"food": 0.6, "green": 0.7, "other": 0.5}
LAND_USE_KINDS = {"park": "park", "village_green": "park", "dog_park": "park", "garden": "garden",
                  "playground": "playground", "recreation_ground": "park", "beach_resort": "beach", "plaza": "plaza",
                  "theme_park": "theme_park", "zoo": "zoo"}
INFRASTRUCTURE_KINDS = {"fountain": "fountain", "toilets": "toilets", "drinking_water": "drinking_water",
                        "bicycle_rental": "bicycle_rental", "artwork": "artwork", "viewpoint": "viewpoint"}
CONCERT_NAME = re.compile(r"концерт|филармон|concert|hall|холл|зал|арена|arena|сарай|palace|опера|opera|театр|theat", re.I)
GREEN_NAME = re.compile(r"парк|сквер|сад|саябақ|бақ|park|garden|аллея|аллеясы|бульвар|роща|орман", re.I)
JUNK_NAME = re.compile(r"^\W*\d|^(ул\.|улица\s|пр\.|проспект\s|мкр|микрорайон\s)|көшесі\s*\d|\d+/\d+|\bжк\b|квартир|аренд|"
                       r"доставк|delivery|parking|парковоч|fashion|караоке|karaoke|кальян|hookah", re.I)
OTHER_CITY = re.compile(r"алматы|almaty|кокшетау|kokshetau|караганд|karaganda|шымкент|shymkent|павлодар|pavlodar|"
                        r"актобе|aktobe|костанай|kostanay|щучинск|бурабай|borovoe|боровое|turkey|türkiye|istanbul", re.I)
STOP = {"кафе", "cafe", "café", "coffee", "кофейня", "кофе", "ресторан", "restaurant", "бар", "bar", "тц", "трц", "тд",
        "астана", "astana", "нур", "султан", "нурсултан", "г", "город", "the", "и", "и", "kz", "kazakhstan", "казахстан",
        "мейрамхана", "мешіті", "мешіт", "мечеть", "mosque", "masjid", "парк", "park", "саябағы", "сквер", "музей", "museum",
        "фонтан", "fountain", "субұрқақ", "детская", "площадка", "памятник", "ескерткіші", "монумент", "monument", "театр"}
CYR = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі",
               ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "i", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u",
                "f", "h", "ts", "ch", "sh", "sh", "", "y", "", "e", "yu", "ya", "a", "g", "k", "n", "o", "u", "u", "h", "i"]))


def read(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def write_json(path, value, compact=False):
    temp = path.with_name(path.name + ".tmp")
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(value, ensure_ascii=False, indent=2)
    temp.write_text(text + "\n", encoding="utf-8")
    temp.replace(path)


def meters(a_lat, a_lon, b_lat, b_lon):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 6371008.8 * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1 - h)))


def latin(text):
    text = "".join(CYR.get(ch, ch) for ch in text.lower().replace("ё", "е"))
    return text.replace("kh", "h").replace("q", "k").replace("w", "v").replace("x", "ks").replace("j", "zh")


def name_variants(names):
    """Sources often put several languages in one name: «Kazakh / Russian / English»."""
    variants = []
    for name in names:
        if name:
            variants.append(name)
            variants.extend(part.strip() for part in re.split(r"\s+/\s+|\|", name) if part.strip() and part.strip() != name)
    return variants


def name_tokens(name):
    words = re.findall(r"[^\W_]+", str(name or "").lower().replace("ё", "е"))
    return [latin(w) for w in words if w not in STOP]


def similar_names(left, right):
    for a in left:
        for b in right:
            ka, kb = "".join(a), "".join(b)
            if not ka or not kb:
                continue
            short, long = sorted((ka, kb), key=len)
            if ka == kb or (len(short) >= 5 and len(short) * 2 >= len(long) and short in long):
                return True
            if min(len(ka), len(kb)) >= 4 and SequenceMatcher(None, ka, kb).ratio() >= 0.82:
                return True
            # Word order differs between sources: «IMAX Кинопарк 7» and «KinoPark 7 IMAX».
            if min(len(ka), len(kb)) >= 6 and SequenceMatcher(None, "".join(sorted(a)), "".join(sorted(b))).ratio() >= 0.85:
                return True
            ta, tb = {t for t in a if len(t) >= 3}, {t for t in b if len(t) >= 3}
            if ta and tb and len(ta & tb) / len(ta | tb) >= 0.5:
                return True
    return False


def phone_key(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[-10:] if len(digits) >= 10 else None


def host_key(value):
    if not value:
        return None
    try:
        host = urlparse(value if "://" in str(value) else f"https://{value}").hostname or ""
    except ValueError:
        return None
    host = host.removeprefix("www.")
    return None if not host or host in ("facebook.com", "instagram.com", "linktr.ee", "taplink.cc", "2gis.kz", "wa.me") else host


def instagram_key(value):
    match = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", str(value or ""))
    return match.group(1).lower().strip(".") if match else None


def wikipedia_url(tag):
    match = re.match(r"^([a-z\-]{2,12}):(.+)$", str(tag or ""))
    return f"https://{match.group(1)}.wikipedia.org/wiki/{quote(match.group(2).strip().replace(' ', '_'))}" if match else None


def features(tags):
    result = {}
    if tags.get("internet_access") in ("wlan", "yes", "wifi"):
        result["wifi"] = True
    if tags.get("outdoor_seating") == "yes":
        result["outdoorSeating"] = True
    if tags.get("diet:vegetarian") in ("yes", "only") or tags.get("diet:vegan") in ("yes", "only"):
        result["vegetarian"] = True
    if tags.get("diet:halal") in ("yes", "only"):
        result["halal"] = True
    if tags.get("takeaway") in ("yes", "only"):
        result["takeaway"] = True
    if tags.get("wheelchair") in ("yes", "limited", "no"):
        result["wheelchair"] = tags["wheelchair"]
    return result


def keywords(kind, feats):
    words = [KIND_WORDS.get(kind, "")] + [FEATURE_WORDS[key] for key, value in feats.items() if value is True or value == "yes"]
    return " ".join(w for w in words if w) or None


def osm_url(record_id):
    match = re.match(r"^([nwr])(\d+)@(\d+)$", str(record_id or ""))
    if not match:
        return None, None, None
    kind = {"n": "node", "w": "way", "r": "relation"}[match.group(1)]
    return f"osm:{kind}:{match.group(2)}", f"https://www.openstreetmap.org/{kind}/{match.group(2)}", int(match.group(3))


FOOD_KINDS = {"cafe", "bakery", "dessert", "restaurant", "fast_food", "ice_cream", "food_court", "bar", "pub"}
GROUPS = {"food": FOOD_KINDS, "mall": {"mall"}, "service": {"toilets", "drinking_water", "bicycle_rental"},
          "green": {"park", "garden", "playground", "beach", "nature_reserve"},
          "landmark": {"monument", "memorial", "artwork", "plaza", "fountain", "bridge", "viewpoint", "castle", "ruins",
                       "archaeological_site"},
          "worship": {"place_of_worship"}, "family": {"amusement_park", "theme_park", "zoo"},
          "culture": {"museum", "gallery", "exhibition_centre", "cinema", "theatre", "concert_hall", "library", "arts_centre"}}


def kind_group(kind):
    return next((group for group, kinds in GROUPS.items() if kind in kinds), "attraction")


def compatible(left, right):
    """A café never absorbs a park, and a monument never absorbs the park around it."""
    a, b = kind_group(left), kind_group(right)
    return a == b or ("attraction" in (a, b) and not {a, b} & {"food", "mall", "service"})


class Index:
    """Grid lookup so matching stays linear in the number of records."""

    def __init__(self):
        self.cells = defaultdict(list)
        self.contacts = defaultdict(list)

    @staticmethod
    def cell(lat, lon):
        return int(lat / 0.0025), int(lon / 0.004)

    def add(self, record):
        # Generic generated names («Фонтан», «Детская площадка») never identify a place.
        self.refresh(record)
        self.cells[self.cell(record["lat"], record["lon"])].append(record)
        for key in contact_keys(record):
            self.contacts[key].append(record)

    @staticmethod
    def refresh(record):
        record["_names"] = [] if record["nameIsGenerated"] else [name_tokens(n) for n in name_variants(
            {record["name"], record.get("nameRu"), record.get("nameKk"), record.get("nameEn"), *record.get("aliases", [])})]

    def near(self, lat, lon):
        y, x = self.cell(lat, lon)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yield from self.cells.get((y + dy, x + dx), ())

    def match(self, candidate, radius):
        names = [name_tokens(n) for n in name_variants(candidate["_candidateNames"])]
        for record in self.near(candidate["lat"], candidate["lon"]):
            if compatible(record["category"], candidate["category"]) \
                    and meters(record["lat"], record["lon"], candidate["lat"], candidate["lon"]) <= radius \
                    and similar_names(names, record["_names"]):
                return record, "name_within_%dm" % radius
        # Chains share websites and hotlines, so a shared contact only counts at practically the same spot.
        for key in contact_keys(candidate):
            for record in self.contacts.get(key, ()):
                if compatible(record["category"], candidate["category"]) \
                        and meters(record["lat"], record["lon"], candidate["lat"], candidate["lon"]) <= 60:
                    return record, "contact_" + key.split(":")[0]
        return None, None

    def landmark_elsewhere(self, candidate, records):
        """A landmark name already mapped kilometres away: business pages often pin the city centre instead."""
        names = [name_tokens(n) for n in name_variants(candidate["_candidateNames"])]
        for record in records:
            if kind_group(record["category"]) == kind_group(candidate["category"]) and record["_names"] \
                    and meters(record["lat"], record["lon"], candidate["lat"], candidate["lon"]) <= 15000 \
                    and similar_names(names, record["_names"]):
                return record
        return None


def contact_keys(record):
    keys = set()
    if phone_key(record.get("phone")):
        keys.add("phone:" + phone_key(record["phone"]))
    for url in record.get("socials") or []:
        if instagram_key(url):
            keys.add("instagram:" + instagram_key(url))
    return keys


def base_record(**fields):
    record = {"id": None, "name": None, "nameRu": None, "nameKk": None, "nameEn": None, "lat": None, "lon": None,
              "category": None, "description": None, "keywords": None, "tags": {}, "sourceUrl": None,
              "retrievedAt": None, "openingHours": None, "phone": None, "website": None, "email": None,
              "socials": [], "address": None, "access": None, "fee": None, "wheelchair": None,
              "wikipedia": None, "wikidata": None, "features": {}, "nameIsGenerated": False, "source": None}
    record.update(fields)
    return record


def from_osm_poi(poi):
    tags = poi["tags"]
    feats = features(tags)
    address = ", ".join(tags[k] for k in ("addr:street", "addr:housenumber") if tags.get(k)) or None
    socials = sorted({tags[k] for k in ("contact:instagram", "contact:facebook", "contact:vk", "contact:telegram")
                      if str(tags.get(k, "")).startswith("http")})
    return base_record(
        id=poi["id"], name=poi["name"], nameRu=poi.get("nameRu"), nameKk=poi.get("nameKk"), nameEn=poi.get("nameEn"),
        aliases=[a for a in poi.get("aliases", []) if a != poi["name"]][:6], lat=poi["lat"], lon=poi["lon"],
        category=poi["category"], description=poi["description"], keywords=keywords(poi["category"], feats),
        tags={k: tags[k] for k in SLIM_TAGS if k in tags}, sourceUrl=poi["sourceUrl"], retrievedAt=poi["retrievedAt"],
        openingHours=poi.get("openingHours"), phone=poi.get("phone"), website=poi.get("website"), email=poi.get("email"),
        socials=socials, address=address, access=poi.get("access"), fee=poi.get("fee"), wheelchair=poi.get("wheelchair"),
        wikipedia=wikipedia_url(tags.get("wikipedia")), wikidata=tags.get("wikidata"), features=feats,
        source={**OSM_SOURCE, "osmVersion": poi.get("osmVersion"), "osmUpdatedAt": poi.get("osmUpdatedAt"),
                **({"mergedOsmIds": poi["osmIds"]} if len(poi.get("osmIds", [])) > 1 else {})})


def unnamed_osm_playgrounds(raw, retrieved_at, known):
    for element in raw["elements"]:
        tags = element.get("tags", {})
        uid = f"osm:{element['type']}:{element['id']}"
        if tags.get("leisure") != "playground" or uid in known or tags.get("access") in ("private", "no"):
            continue
        if any(tags.get(k, "").strip() for k in ("name", "name:ru", "name:kk", "name:en")):
            continue
        point = element if element["type"] == "node" else element.get("center", {})
        if not isinstance(point.get("lat"), (int, float)):
            continue
        url = f"https://www.openstreetmap.org/{element['type']}/{element['id']}"
        yield base_record(
            id=uid, name="Детская площадка", lat=point["lat"], lon=point["lon"], category="playground",
            description="Детская площадка. Название в OpenStreetMap не указано.",
            tags={k: tags[k] for k in SLIM_TAGS if k in tags}, sourceUrl=url, retrievedAt=retrieved_at,
            access=tags.get("access"), nameIsGenerated=True,
            source={**OSM_SOURCE, "osmVersion": element.get("version"), "osmUpdatedAt": element.get("timestamp")})


def tag_dict(pairs):
    return {k: v for k, v in (pairs or [])}


def common_names(names):
    common = dict(names.get("common") or [])
    return common.get("ru"), common.get("kk"), common.get("en")


def from_overture_osm(row, kind, retrieved_at, release):
    """Rows of the Overture base and buildings themes are OpenStreetMap objects; they keep OSM ids and links."""
    source = next((s for s in row["sources"] if s["dataset"] == "OpenStreetMap"), None)
    uid, url, version = osm_url(source and source["record_id"])
    if not uid:
        return None
    tags = tag_dict(row.get("source_tags"))
    names = row.get("names") or {}
    primary = (names.get("primary") or "").strip()
    ru, kk, en = common_names(names)
    feats = features(tags)
    label = LABELS.get(kind, "Место")
    return base_record(
        id=uid, name=primary or label, nameRu=ru, nameKk=kk, nameEn=en, lat=row["lat"], lon=row["lon"], category=kind,
        description=f"{label}." + ("" if primary else " Название в OpenStreetMap не указано."),
        keywords=keywords(kind, feats), tags={k: tags[k] for k in SLIM_TAGS if k in tags}, sourceUrl=url,
        retrievedAt=retrieved_at, access=tags.get("access"), fee=tags.get("fee"), wheelchair=tags.get("wheelchair"),
        wikipedia=wikipedia_url(tags.get("wikipedia")), wikidata=row.get("wikidata") or tags.get("wikidata"),
        features=feats, nameIsGenerated=not primary,
        source={**OSM_SOURCE, "osmVersion": version, "osmUpdatedAt": source.get("update_time"),
                "via": f"Overture Maps {release}", "extentMeters": row.get("extentMeters")})


def place_kind(row):
    primary = (row.get("taxonomy") or {}).get("primary") or ""
    if row["basic_category"] == "restaurant" or primary in ("steakhouse", "salad_bar"):
        return "restaurant"
    if primary == "opera_and_ballet" or (primary == "music_venue" and CONCERT_NAME.search(row["names"]["primary"])):
        return "concert_hall"
    if primary == "music_venue":
        return None
    return PLACE_KINDS.get(primary) or PLACE_KINDS.get(row["basic_category"] or "")


def from_overture_place(row, kind, retrieved_at, release):
    names = row["names"]
    name = re.sub(r"\s+", " ", re.sub(r'["“”«»]', "", names["primary"])).strip()
    ru, kk, en = common_names(names)
    datasets = [s for s in row["sources"] if s["dataset"] != "Overture"]
    origin = datasets[0] if datasets else row["sources"][0]
    dataset = DATASET_LABELS.get(origin["dataset"], origin["dataset"])
    address = next((a.get("freeform") for a in row.get("addresses") or [] if a.get("freeform")), None)
    primary = (row.get("taxonomy") or {}).get("primary")
    cuisine = primary.removesuffix("_restaurant") if primary and primary.endswith("_restaurant") else None
    description = f"{LABELS[kind]}." + (f" Адрес по данным {dataset}: {address}." if address else "")
    return base_record(
        id=f"overture:{row['id']}", name=name, nameRu=ru, nameKk=kk, nameEn=en, lat=row["lat"], lon=row["lon"],
        category=kind, description=description, keywords=keywords(kind, {}),
        tags={k: v for k, v in (("overture:category", primary), ("cuisine", cuisine)) if v},
        sourceUrl=f"https://explore.overturemaps.org/#18/{row['lat']}/{row['lon']}", retrievedAt=retrieved_at,
        phone=(row.get("phones") or [None])[0], website=(row.get("websites") or [None])[0],
        email=(row.get("emails") or [None])[0], socials=sorted(set(row.get("socials") or []))[:4], address=address,
        wikidata=(row.get("brand") or {}).get("wikidata"),
        source={"id": "overture", "label": f"Overture Maps · {dataset}", "dataset": dataset,
                "license": origin["license"], "licenseUrl": LICENSE_URLS.get(origin["license"]),
                "attribution": f"Overture Maps Foundation; {dataset}",
                "attributionUrl": "https://docs.overturemaps.org/attribution/", "release": release,
                "gersId": row["id"], "confidence": round(row["confidence"], 3),
                "sourceUpdatedAt": origin.get("update_time")})


def enrich(record, candidate, how):
    filled = {}
    for field in ("phone", "website", "email", "address", "nameRu", "nameKk", "nameEn", "wikidata"):
        if not record.get(field) and candidate.get(field):
            record[field] = candidate[field]
            filled[field] = candidate["id"]
    new_socials = [s for s in candidate.get("socials") or [] if s not in record["socials"]]
    if new_socials:
        record["socials"] = (record["socials"] + new_socials)[:6]
        filled["socials"] = candidate["id"]
    entry = {"id": candidate["id"], "source": candidate["source"]["label"], "match": how,
             "sourceUrl": candidate["sourceUrl"]}
    if candidate["source"].get("confidence") is not None:
        entry["confidence"] = candidate["source"]["confidence"]
    record.setdefault("alsoIn", []).append(entry)
    if filled:
        record.setdefault("fieldSources", {}).update(filled)
    return bool(filled)


def inside(lat, lon):
    return BOUNDS[0] <= lat <= BOUNDS[2] and BOUNDS[1] <= lon <= BOUNDS[3]


def main():
    osm_meta = read("import-metadata.json")
    overture_meta = json.loads((OVERTURE / "metadata.json").read_text(encoding="utf-8"))
    release, overture_at = overture_meta["release"], overture_meta["retrievedAt"]
    load = lambda name: json.loads((OVERTURE / name).read_text(encoding="utf-8"))
    raw = read("overpass-astana.raw.json")
    raw_ids = {f"osm:{e['type']}:{e['id']}" for e in raw["elements"]}

    records, index, rejected, enriched, added = [], Index(), Counter(), Counter(), Counter()

    def accept(record, origin):
        records.append(record)
        index.add(record)
        added[origin] += 1

    for poi in read("pois.json"):
        accept(from_osm_poi(poi), "osm_import")
    known = raw_ids | {i for p in records for i in p["source"].get("mergedOsmIds", [p["id"]])}
    for record in unnamed_osm_playgrounds(raw, osm_meta["retrievedAt"], {r["id"] for r in records}):
        accept(record, "osm_unnamed_playground")

    def overture_osm(rows, kinds, origin, min_extent=0):
        for row in rows:
            kind = kinds(row)
            record = kind and from_overture_osm(row, kind, overture_at, release)
            if not record:
                rejected[f"{origin}:not_selected"] += 1
                continue
            if record["id"] in known:
                rejected[f"{origin}:already_in_osm_import"] += 1
                continue
            if not inside(record["lat"], record["lon"]) or record["access"] in ("private", "no"):
                rejected[f"{origin}:outside_or_private"] += 1
                continue
            if record["nameIsGenerated"]:
                if kind in ("park", "garden") and (row.get("extentMeters") or 0) < min_extent:
                    rejected[f"{origin}:small_unnamed_green"] += 1
                    continue
                if any(r["category"] == kind and meters(r["lat"], r["lon"], record["lat"], record["lon"]) < 35
                       for r in index.near(record["lat"], record["lon"])):
                    rejected[f"{origin}:duplicate_nearby"] += 1
                    continue
            else:
                record["_candidateNames"] = [record["name"], record["nameRu"], record["nameKk"], record["nameEn"]]
                match, how = index.match(record, 250)
                record.pop("_candidateNames")
                if match:
                    enrich(match, record, how)
                    Index.refresh(match)
                    enriched[origin] += 1
                    continue
            known.add(record["id"])
            accept(record, origin)

    overture_osm(load("land_use.json"), lambda r: LAND_USE_KINDS.get(r["class"]), "overture_osm_land_use", min_extent=120)
    overture_osm(load("infrastructure.json"), lambda r: INFRASTRUCTURE_KINDS.get(r["class"]), "overture_osm_infrastructure")

    def building_kind(row):
        name = row["names"]["primary"].lower()
        if row["subtype"] == "religious" or re.search(r"мешіт|мечеть|собор|храм|церк|синагог|костел", name):
            return "place_of_worship"
        if re.search(r"музей|мұражай", name):
            return "museum"
        if re.search(r"театр|опера", name):
            return "theatre"
        if re.search(r"кітапхана|библиотек", name):
            return "library"
        if re.search(r"концерт|филармон", name):
            return "concert_hall"
        if re.search(r"ақорда|бейбітшілік және келісім|тәуелсіздік сарайы|дворец мира|дворец независимости|пирамид", name):
            return "attraction"
        return None

    overture_osm(load("buildings.json"), building_kind, "overture_osm_buildings")

    for row in sorted(load("places.json"), key=lambda r: (-r["confidence"], r["id"])):
        kind = place_kind(row)
        group = "food" if kind in FOOD else "green" if kind in ("park", "garden") else "other"
        name = (row["names"] or {}).get("primary") or ""
        address = " ".join(a.get("freeform") or "" for a in row.get("addresses") or [])
        if not kind:
            rejected["overture_places:category"] += 1
        elif row.get("operating_status") in ("closed", "permanently_closed", "temporarily_closed"):
            rejected["overture_places:closed"] += 1
        elif row["confidence"] < MIN_CONFIDENCE[group]:
            rejected["overture_places:low_confidence"] += 1
        elif JUNK_NAME.search(name) or (group == "green" and not GREEN_NAME.search(name)):
            rejected["overture_places:name_not_a_place"] += 1
        elif OTHER_CITY.search(address) or re.search(r"алматы|almaty", name, re.I):
            rejected["overture_places:other_city"] += 1
        elif not inside(row["lat"], row["lon"]):
            rejected["overture_places:outside_bounds"] += 1
        else:
            record = from_overture_place(row, kind, overture_at, release)
            record["_candidateNames"] = [record["name"], record["nameRu"], record["nameKk"], record["nameEn"]]
            match, how = index.match(record, 150 if group == "food" else 300)
            elsewhere = None if match or group != "other" else index.landmark_elsewhere(
                record, [r for r in records if kind_group(r["category"]) not in ("food", "mall", "service")])
            record.pop("_candidateNames")
            if match:
                enrich(match, record, how)
                Index.refresh(match)
                enriched["overture_places"] += 1
            elif elsewhere:
                rejected["overture_places:landmark_mapped_elsewhere"] += 1
            else:
                accept(record, "overture_places")

    for record in records:
        record.pop("_names", None)
        if not record["keywords"]:
            record.pop("keywords")
        for key in ("aliases", "socials", "features", "tags"):
            if not record.get(key):
                record.pop(key, None)
        for key in [k for k, v in record.items() if v is None or v is False]:
            record.pop(key)
    records.sort(key=lambda r: r["id"])
    ids = [r["id"] for r in records]
    assert len(ids) == len(set(ids)), "duplicate ids"
    write_json(DATA / "places.json", records, compact=True)
    body = (DATA / "places.json").read_bytes()
    report = {
        "generatedFrom": {"openStreetMap": {"retrievedAt": osm_meta["retrievedAt"], "rawSha256": osm_meta["rawSha256"]},
                          "overture": {"release": release, "retrievedAt": overture_at,
                                       "files": {f["file"]: f["sha256"] for f in overture_meta["files"]}}},
        "placesSha256": hashlib.sha256(body).hexdigest(), "total": len(records),
        "bySource": dict(Counter(r["source"]["label"] for r in records).most_common()),
        "byCategory": dict(Counter(r["category"] for r in records).most_common()),
        "added": dict(added), "enrichedExisting": dict(enriched), "rejected": dict(sorted(rejected.items())),
        "generatedNames": sum(1 for r in records if r.get("nameIsGenerated")),
        "withOpeningHours": sum(1 for r in records if r.get("openingHours")),
        "withPhone": sum(1 for r in records if r.get("phone")),
        "withWebsite": sum(1 for r in records if r.get("website")),
        "withSocials": sum(1 for r in records if r.get("socials")),
        "withAddress": sum(1 for r in records if r.get("address")),
        "withWikipedia": sum(1 for r in records if r.get("wikipedia")),
        "licenses": dict(Counter(r["source"]["license"] for r in records).most_common()),
        "policy": [
            "OpenStreetMap records keep priority; a matching Overture place only fills missing contacts, recorded in fieldSources and alsoIn.",
            "Overture places need confidence >= 0.6 for food, 0.7 for parks and gardens, 0.5 for landmarks and culture; residential complexes, addresses, karaoke and hookah bars are excluded.",
            "An Overture landmark whose name is already mapped up to 15 km away is dropped: business pages often pin the city centre.",
            "Unnamed playgrounds, fountains, toilets and parks larger than 120 m get a generic name and nameIsGenerated=true.",
            "Coordinates of areas are bbox centres, not entrances. Overture coordinates come from its sources (often business pages) and are less precise than OSM.",
            "Opening hours exist only where OpenStreetMap has them; Overture has none.",
        ],
    }
    write_json(DATA / "places-report.json", report)
    print(json.dumps({k: report[k] for k in ("total", "bySource", "added", "enrichedExisting")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
