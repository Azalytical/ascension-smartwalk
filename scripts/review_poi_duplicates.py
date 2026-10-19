#!/usr/bin/env python3
"""Fetch bounded OSM geometry evidence for the five reviewed duplicate pairs.

Run once to fetch evidence, or use --offline to inspect the retained response.
Uses only the Python standard library. Does not modify the original city extract.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

DATA = Path(__file__).resolve().parents[1] / "data"
QUERY = """[out:json][timeout:60];
(
  node(id:4965336822,6494912583,7569174946,12049030099,12049030108,12973394495,12990081601);
  way(id:499328514,502046662,1460702136);
  way(around:100,51.16258,71.45180)[building];
  way(around:100,51.17933,71.37823)[building];
  way(around:80,51.16924,71.41841)[building];
  node(around:500,51.08909,71.40733)[entrance];
  way(around:100,51.161,71.423)[highway~"^(footway|pedestrian|path)$"];
  nwr(around:100,51.161,71.423)[natural=water];
);
out meta center geom;
"""


def write_json(path, value):
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def inside(lat, lon, geometry):
    """Ray casting for a simple OSM closed-way footprint, not multipolygons."""
    contained = False
    for a, b in zip(geometry, geometry[1:]):
        if (a["lat"] > lat) != (b["lat"] > lat):
            cross_lon = (b["lon"] - a["lon"]) * (lat - a["lat"]) / (b["lat"] - a["lat"]) + a["lon"]
            if lon < cross_lon:
                contained = not contained
    return contained


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    raw_path = DATA / "dedup-evidence.raw.json"
    meta_path = DATA / "dedup-evidence.metadata.json"
    if not args.offline:
        errors = []
        for endpoint in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"):
            try:
                request = Request(endpoint, data=urlencode({"data": QUERY}).encode(), headers={
                    "User-Agent": "Ascension-Smartwalk-DedupReview/1.0", "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
                with urlopen(request, timeout=90) as response:
                    body = response.read()
                raw = json.loads(body)
                if raw.get("remark") or not raw.get("elements"):
                    raise ValueError("Incomplete Overpass response; previous evidence preserved")
                break
            except (HTTPError, URLError, TimeoutError, ValueError) as exc:
                errors.append({"endpoint": endpoint, "error": str(exc)})
                print(str(exc), file=sys.stderr, flush=True)
        else:
            raise RuntimeError(str(errors))
        temp = raw_path.with_name(raw_path.name + ".tmp")
        temp.write_bytes(body)
        temp.replace(raw_path)
        write_json(meta_path, {"source": "OpenStreetMap via Overpass API", "endpoint": endpoint,
                              "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                              "rawSha256": hashlib.sha256(body).hexdigest(),
                              "queryFile": "dedup-evidence.ql", "rawFile": raw_path.name,
                              "osmBaseTimestamp": raw.get("osm3s", {}).get("timestamp_osm_base"),
                              "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
                              "attributionUrl": "https://www.openstreetmap.org/copyright"})
        (DATA / "dedup-evidence.ql").write_text(QUERY, encoding="utf-8")
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if hashlib.sha256(raw_path.read_bytes()).hexdigest() != meta["rawSha256"]:
        raise ValueError("Geometry evidence SHA-256 mismatch")
    index = {f"osm:{e['type']}:{e['id']}": e for e in raw["elements"]}
    city = json.loads((DATA / "overpass-astana.raw.json").read_text(encoding="utf-8"))
    source = {f"osm:{e['type']}:{e['id']}": e for e in city["elements"]}
    candidate_ids = ["osm:node:" + str(i) for i in (
        4965336822, 6494912583, 7569174946, 12049030099, 12049030108, 12973394495, 12990081601)]
    candidate_ids += ["osm:way:" + str(i) for i in (499328514, 502046662, 1460702136)]
    nodes = [index[i] for i in candidate_ids if i.startswith("osm:node:")]
    footprints = [e for e in raw["elements"] if e["type"] == "way" and e.get("geometry")
                  and e.get("nodes", [None])[0] == e.get("nodes", [0])[-1]]
    report = {
        "sourceMetadata": meta, "reviewedObjectCount": len(candidate_ids),
        "sourceVersionsMatch": all(index[i]["version"] == source[i]["version"] and index[i]["tags"] == source[i]["tags"] for i in candidate_ids),
        "nodeContainment": [{"id": f"osm:node:{n['id']}", "insideFootprints": [
            {"id": f"osm:way:{w['id']}", "tags": w.get("tags", {})}
            for w in footprints if inside(n["lat"], n["lon"], w["geometry"])]} for n in nodes],
        "parkContainment": [],
        "limitations": ["Containment uses simple closed-way footprints; an indoor unit or branch identity is not inferred from containment alone."]}
    for aid, bid in (("osm:way:502046662", "osm:way:1460702136"), ("osm:way:1460702136", "osm:way:502046662")):
        a, b = index[aid], index[bid]
        points = a["geometry"][:-1]
        report["parkContainment"].append({"polygon": aid, "insidePolygon": bid, "vertices": len(points),
                                           "verticesInside": sum(inside(p["lat"], p["lon"], b["geometry"]) for p in points)})
    write_json(DATA / "dedup-evidence.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
