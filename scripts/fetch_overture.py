#!/usr/bin/env python3
"""Snapshot Overture Maps data for Astana from the public S3 bucket, without credentials.

Run: python scripts/fetch_overture.py [--release 2026-09-23.1]
Requires pyarrow. Reads only the Parquet row groups whose bbox statistics overlap Astana,
keeps the walk-relevant rows and writes them to data/overture/ with provenance metadata.
build_places.py merges these snapshots with the OpenStreetMap import offline.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.request import urlopen

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.fs as pafs
import pyarrow.parquet as pq

OUT = Path(__file__).resolve().parents[1] / "data" / "overture"
BUCKET = "overturemaps-us-west-2"
BBOX = (50.95, 71.10, 51.32, 71.85)  # south, west, north, east: Astana with suburbs
LICENSES = {
    "places": "Per source: Meta, Microsoft, PinMeTo CDLA-Permissive-2.0; Foursquare Apache-2.0; AllThePlaces CC0-1.0",
    "base": "ODbL-1.0 (derived from OpenStreetMap)",
    "buildings": "ODbL-1.0 for OpenStreetMap-derived buildings",
}

# Walk-relevant subsets; everything else in the bbox (offices, services, residential) is dropped.
PLACE_CATEGORIES = re.compile(r"^(restaurant|cafe|coffee_shop|casual_eatery|fast_food_restaurant|museum|art_gallery|park|garden|"
                              r"shopping_mall|music_venue|theatre_venue|movie_theater|library|cultural_center|monument|"
                              r"sculpture_statue|public_plaza|public_fountain|bridge|muslim_place_of_worship|"
                              r"christian_place_of_worship|amusement_park|zoo|playground|skating_rink|"
                              r"non_alcoholic_beverage_venue|smoothie_juice_bar|beach|landmark_and_historical_building|"
                              r"tourist_attraction|books_music_and_video_store)$")
LAND_USE = {("park", "park"), ("park", "village_green"), ("park", "dog_park"), ("horticulture", "garden"),
            ("recreation", "playground"), ("recreation", "recreation_ground"), ("recreation", "beach_resort"),
            ("pedestrian", "plaza"), ("entertainment", "theme_park"), ("entertainment", "zoo")}
INFRASTRUCTURE = {"fountain", "toilets", "drinking_water", "bicycle_rental", "artwork", "viewpoint", "information"}
LANDMARK_BUILDING = re.compile(r"мешіт|мечеть|собор|храм|церк|синагог|костел|костёл|музей|мұражай|театр|опера|"
                               r"сарай|дворец|кітапхана|библиотек|концерт|филармон|галере|ақорда|ak orda|palace|museum|theatre|mosque|cathedral",
                               re.IGNORECASE)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def filesystem():
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    return pafs.S3FileSystem(anonymous=True, region="us-west-2", **({"proxy_options": proxy} if proxy else {}))


def keys(release, prefix):
    listing = urlopen(f"https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/{release}/{prefix}/", timeout=60).read().decode()
    return re.findall(r"<Key>([^<]*\.parquet)</Key>", listing)


def read_bbox(fs, release, prefix, columns):
    south, west, north, east = BBOX
    tables = []
    for key in keys(release, prefix):
        parquet = pq.ParquetFile(f"{BUCKET}/{key}", filesystem=fs)
        meta = parquet.metadata
        names = {meta.row_group(0).column(i).path_in_schema: i for i in range(meta.num_columns)}
        groups = []
        for index in range(meta.num_row_groups):
            group = meta.row_group(index)
            stat = lambda name: group.column(names[name]).statistics
            if (stat("bbox.xmax").max < west or stat("bbox.xmin").min > east
                    or stat("bbox.ymax").max < south or stat("bbox.ymin").min > north):
                continue
            groups.append(index)
        if not groups:
            continue
        table = parquet.read_row_groups(groups, columns=columns)
        box = table.column("bbox")
        x = pc.divide(pc.add(pc.struct_field(box, "xmin"), pc.struct_field(box, "xmax")), 2)
        y = pc.divide(pc.add(pc.struct_field(box, "ymin"), pc.struct_field(box, "ymax")), 2)
        inside = pc.and_(pc.and_(pc.greater_equal(x, west), pc.less_equal(x, east)),
                         pc.and_(pc.greater_equal(y, south), pc.less_equal(y, north)))
        tables.append(table.filter(inside))
    return pa.concat_tables(tables).to_pylist() if tables else []


def point(row):
    box = row.pop("bbox")
    # Representative point: bbox centre, as with Overpass "out center" for ways.
    return {**row, "lat": round((box["ymin"] + box["ymax"]) / 2, 7), "lon": round((box["xmin"] + box["xmax"]) / 2, 7),
            "extentMeters": round(max(box["xmax"] - box["xmin"], box["ymax"] - box["ymin"]) * 111000)}


def write(name, rows, release, prefix, row_filter, license_note):
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    (OUT / f"{name}.json").write_bytes(body + b"\n")
    return {"file": f"{name}.json", "theme": prefix, "rows": len(rows), "sha256": hashlib.sha256(body + b"\n").hexdigest(),
            "filter": row_filter, "license": license_note}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", default="2026-09-23.1")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    fs = filesystem()
    common = ["id", "names", "sources", "bbox", "version"]
    files = []

    places = [point(r) for r in read_bbox(fs, args.release, "theme=places/type=place",
                                          common + ["confidence", "websites", "socials", "phones", "emails", "brand",
                                                    "addresses", "operating_status", "basic_category", "taxonomy"])
              if PLACE_CATEGORIES.match(r["basic_category"] or "") and (r["names"] or {}).get("primary")]
    files.append(write("places", places, args.release, "theme=places/type=place",
                       "named rows whose basic_category matches PLACE_CATEGORIES", LICENSES["places"]))

    land_use = [point(r) for r in read_bbox(fs, args.release, "theme=base/type=land_use",
                                            common + ["subtype", "class", "wikidata", "source_tags"])
                if (r["subtype"], r["class"]) in LAND_USE]
    files.append(write("land_use", land_use, args.release, "theme=base/type=land_use",
                       "subtype/class pairs in LAND_USE, named or not", LICENSES["base"]))

    infrastructure = [point(r) for r in read_bbox(fs, args.release, "theme=base/type=infrastructure",
                                                  common + ["subtype", "class", "wikidata", "source_tags"])
                      if r["class"] in INFRASTRUCTURE]
    files.append(write("infrastructure", infrastructure, args.release, "theme=base/type=infrastructure",
                       "class in INFRASTRUCTURE, named or not", LICENSES["base"]))

    buildings = [point(r) for r in read_bbox(fs, args.release, "theme=buildings/type=building",
                                             common + ["subtype", "class", "height"])
                 if (r["names"] or {}).get("primary") and LANDMARK_BUILDING.search(r["names"]["primary"])
                 and r["subtype"] not in ("residential", "transportation")]
    files.append(write("buildings", buildings, args.release, "theme=buildings/type=building",
                       "named landmark buildings (worship, museum, theatre, palace, library), not residential or transport",
                       LICENSES["buildings"]))

    meta = {"source": "Overture Maps Foundation", "release": args.release, "bucket": f"s3://{BUCKET}/release/{args.release}/",
            "retrievedAt": utc_now(), "bbox": dict(zip(("south", "west", "north", "east"), BBOX)),
            "attribution": "© OpenStreetMap contributors, Overture Maps Foundation",
            "attributionUrl": "https://docs.overturemaps.org/attribution/", "files": files}
    (OUT / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({f["file"]: f["rows"] for f in files}))


if __name__ == "__main__":
    main()
