"""Cached data-source fetchers.

Every function writes its raw payload under data/cache and is safe to re-run.
No function prints credentials.
"""

from __future__ import annotations

import base64
import gzip
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)

GISTEMP_GLOBAL_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
GISTEMP_GRID_URL = "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz"
POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

POWER_CODES = ("T2M", "PRECTOTCORR", "GWETROOT", "ALLSKY_SFC_SW_DWN")
USER_AGENT = "earth-trend-detective-case-files/0.1"


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def _download(url: str, destination: Path, timeout: int = 120) -> Path:
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    with _session().get(url, stream=True, timeout=timeout) as response:
        response.raise_for_status()
        temporary = destination.with_suffix(destination.suffix + ".part")
        with temporary.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    handle.write(chunk)
        temporary.replace(destination)
    return destination


def load_gistemp_global(cache: Path = CACHE) -> list[tuple[int, float]]:
    path = cache / "gistemp_global.csv"
    _download(GISTEMP_GLOBAL_URL, path)
    frame = pd.read_csv(path, skiprows=1, na_values="***")
    frame = frame[["Year", "J-D"]].dropna()
    frame["Year"] = frame["Year"].astype(int)
    frame["J-D"] = frame["J-D"].astype(float)
    return [(int(year), float(value)) for year, value in zip(frame["Year"], frame["J-D"])]


def load_gistemp_grid(
    start: int,
    end: int,
    cache: Path = CACHE,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return (years, lats, lons, values[years, lat, lon]) at 4° resolution."""
    import xarray as xr

    gz_path = cache / "gistemp_grid.nc.gz"
    nc_path = cache / "gistemp_grid.nc"
    _download(GISTEMP_GRID_URL, gz_path, timeout=240)
    if not nc_path.exists() or nc_path.stat().st_size == 0:
        with gzip.open(gz_path, "rb") as source, nc_path.open("wb") as target:
            target.write(source.read())

    with xr.open_dataset(nc_path, engine="scipy") as dataset:
        field = dataset["tempanomaly"].sel(time=slice(f"{start}-01-01", f"{end}-12-31"))
        annual = field.groupby("time.year").mean("time")
        years = np.asarray(annual["year"].values, dtype=int)
        lat = np.asarray(annual["lat"].values, dtype=float)
        lon = np.asarray(annual["lon"].values, dtype=float)
        values = np.asarray(annual.values, dtype=float)

    if lon.max() > 180.0:
        lon = ((lon + 180.0) % 360.0) - 180.0
        order = np.argsort(lon)
        lon = lon[order]
        values = values[:, :, order]

    # 4° subsample: every second 2° cell.
    values = values[:, ::2, ::2]
    lat = lat[::2]
    lon = lon[::2]
    return years, lat, lon, values


def fetch_power_point(
    slug: str,
    lat: float,
    lon: float,
    start: int,
    end: int,
    cache: Path = CACHE,
) -> dict[str, Any]:
    path = cache / "power" / f"{slug}.json"
    if path.exists() and path.stat().st_size > 0:
        return json.loads(path.read_text(encoding="utf-8"))

    params = {
        "parameters": ",".join(POWER_CODES),
        "community": "AG",
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start": str(start),
        "end": str(end),
        "format": "JSON",
    }
    response = _session().get(POWER_URL, params=params, timeout=60)
    response.raise_for_status()
    payload = response.json()
    if "properties" not in payload:
        raise ValueError(f"unexpected POWER response for {slug}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    time.sleep(0.25)
    return payload


def fetch_meteomatics(
    slug: str,
    lat: float,
    lon: float,
    username: str,
    password: str,
    cache: Path = CACHE,
) -> dict[str, Any] | None:
    if not username or not password:
        return None
    path = cache / "meteomatics" / f"{slug}.json"
    if path.exists() and path.stat().st_size > 0:
        return json.loads(path.read_text(encoding="utf-8"))

    valid_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    stamp = valid_time.strftime("%Y-%m-%dT%H:00:00Z")
    url = (
        f"https://api.meteomatics.com/{stamp}/"
        f"t_2m:C,precip_1h:mm,wind_speed_10m:ms/{lat:.4f},{lon:.4f}/json"
    )
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    response = _session().get(url, headers={"Authorization": f"Basic {token}"}, timeout=45)
    if response.status_code != 200:
        return None
    payload = response.json()
    values: dict[str, Any] = {}
    for item in payload.get("data", []):
        parameter = item.get("parameter")
        coordinates = item.get("coordinates") or []
        dates = coordinates[0].get("dates") if coordinates else []
        if parameter and dates:
            values[parameter] = dates[0].get("value")
    result = {
        "valid_time": stamp,
        "t_2m": values.get("t_2m:C"),
        "precip_1h": values.get("precip_1h:mm"),
        "wind_speed_10m": values.get("wind_speed_10m:ms"),
        "source": "Meteomatics",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result), encoding="utf-8")
    return result


def check_earthdata(env: dict[str, str]) -> dict[str, Any]:
    """Authenticate and search one MERRA-2 granule; never prints secrets."""
    username = env.get("EARTHDATA_USERNAME", "")
    password = env.get("EARTHDATA_PASSWORD", "")
    if not username or not password:
        return {"status": "unavailable", "detail": "Earthdata credentials not set"}

    os.environ["EARTHDATA_USERNAME"] = username
    os.environ["EARTHDATA_PASSWORD"] = password
    try:
        import earthaccess

        auth = earthaccess.login(strategy="environment")
        if not getattr(auth, "authenticated", False):
            return {"status": "error", "detail": "Earthdata login was not authenticated"}
        results = earthaccess.search_data(
            short_name="M2TMNXSLV",
            temporal=("2024-01-01", "2024-01-31"),
            count=1,
        )
        return {
            "status": "ok",
            "detail": f"Authenticated; MERRA-2 M2TMNXSLV search returned {len(results)} granule(s)",
            "granules": len(results),
        }
    except Exception as error:  # noqa: BLE001 - source checks must never break the build
        return {"status": "error", "detail": f"Earthdata check failed: {type(error).__name__}"}


def check_planetary() -> dict[str, Any]:
    body = {"collections": ["sentinel-2-l2a"], "limit": 1}
    try:
        response = _session().post(f"{STAC_URL}/search", json=body, timeout=45)
        response.raise_for_status()
        count = len(response.json().get("features", []))
        return {"status": "ok", "detail": f"STAC API reachable; {count} sample item(s)"}
    except Exception as error:  # noqa: BLE001
        return {"status": "error", "detail": f"STAC API check failed: {type(error).__name__}"}
