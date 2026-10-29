#!/usr/bin/env python3
"""Прокси радара ATC Live Radio v3: самолёты вокруг станции из adsb.lol (резерв adsb.fi) + OpenSky.

Только стандартная библиотека, Python 3.9+.
"""
from __future__ import annotations

import json
import math
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional, Tuple

USER_AGENT = "lofiatc-radar/1.0 (+https://afoodpro.github.io/lofiatcradio/)"
ADSBLOL_URL = "https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}"
ADSBFI_URL = "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}"
OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"
OPENSKY_TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
UPSTREAM_TIMEOUT = 5  # клиент ждёт 10 с; два последовательных запроса adsb укладываются
RADII = (40, 80, 150, 250)
DEFAULT_ORIGINS = "https://afoodpro.github.io,http://localhost:8080"
ADSB_TTL = 5
OPENSKY_TTL = 15
TOKEN_MARGIN = 60
TOKEN_RETRY_BACKOFF = 30

Aircraft = Dict[str, Any]


# ---------- чистые функции ----------

def load_stations(path: str) -> Dict[str, Tuple[float, float]]:
    with open(path, encoding="utf-8") as f:
        return {s["code"]: (float(s["lat"]), float(s["lon"])) for s in json.load(f)}


def bbox(lat: float, lon: float, nm: float) -> Tuple[float, float, float, float]:
    dlat = nm / 60.0
    dlon = nm / 60.0 / math.cos(math.radians(lat))
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def within(lat0: float, lon0: float, nm: float, lat: float, lon: float) -> bool:
    """Та же плоская метрика, что project() в клиенте: r <= 1."""
    x = (lon - lon0) * math.cos(math.radians(lat0)) * 60 / nm
    y = (lat - lat0) * 60 / nm
    return math.hypot(x, y) <= 1


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def normalize_adsblol(obj: Any) -> List[Aircraft]:
    out: List[Aircraft] = []
    for a in (obj or {}).get("ac") or []:
        lat, lon = _num(a.get("lat")), _num(a.get("lon"))
        if lat is None or lon is None or not a.get("hex"):
            continue
        out.append({
            "hex": str(a["hex"]).lower(),
            "call": str(a.get("flight") or "").strip(),
            "lat": lat,
            "lon": lon,
            "track": _num(a.get("track")),
        })
    return out


def normalize_opensky(obj: Any) -> List[Aircraft]:
    out: List[Aircraft] = []
    for s in (obj or {}).get("states") or []:
        lat, lon = _num(s[6]), _num(s[5])
        if lat is None or lon is None or not s[0]:
            continue
        out.append({
            "hex": str(s[0]).lower(),
            "call": str(s[1] or "").strip(),
            "lat": lat,
            "lon": lon,
            "track": _num(s[10]) if len(s) > 10 else None,
        })
    return out


def merge(primary: List[Aircraft], secondary: List[Aircraft]) -> List[Aircraft]:
    seen = {a["hex"] for a in primary}
    return list(primary) + [a for a in secondary if a["hex"] not in seen]


class TTLCache:
    def __init__(self, ttl_sec: float, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_sec
        self._clock = clock
        self._data: Dict[Any, Tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: Any) -> Any:
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return None
            if self._clock() - hit[0] >= self._ttl:
                del self._data[key]
                return None
            return hit[1]

    def put(self, key: Any, value: Any) -> None:
        with self._lock:
            self._data[key] = (self._clock(), value)


# ---------- сеть ----------

def _http_json(url: str, headers: Optional[Dict[str, str]] = None, data: Optional[bytes] = None) -> Any:
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_form(url: str, form: Dict[str, str]) -> Any:
    return _http_json(
        url,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=urllib.parse.urlencode(form).encode("ascii"),
    )


def fetch_adsb(lat: float, lon: float, nm: int) -> List[Aircraft]:
    """adsb.lol, при сбое — adsb.fi. Бросает исключение, если упали оба."""
    try:
        return normalize_adsblol(_http_json(ADSBLOL_URL.format(lat=lat, lon=lon, nm=nm)))
    except Exception:
        return normalize_adsblol(_http_json(ADSBFI_URL.format(lat=lat, lon=lon, nm=nm)))


def fetch_opensky(box: Tuple[float, float, float, float], token: str) -> List[Aircraft]:
    q = urllib.parse.urlencode(dict(zip(("lamin", "lomin", "lamax", "lomax"), ("%.4f" % v for v in box))))
    return normalize_opensky(_http_json(OPENSKY_STATES_URL + "?" + q, headers={"Authorization": "Bearer " + token}))


class OpenSkyAuth:
    """OAuth2 client credentials. Нет файла/ошибка -> token() is None (работаем только на adsb)."""

    def __init__(self, creds_path: str, post: Callable[[str, Dict[str, str]], Any] = _post_form,
                 clock: Callable[[], float] = time.monotonic):
        self._path = creds_path
        self._post = post
        self._clock = clock
        self._token: Optional[str] = None
        self._valid_until = 0.0
        self._lock = threading.Lock()

    def token(self) -> Optional[str]:
        with self._lock:
            now = self._clock()
            if now < self._valid_until:
                return self._token
            self._token = None
            try:
                with open(self._path, encoding="utf-8") as f:
                    creds = json.load(f)
                res = self._post(OPENSKY_TOKEN_URL, {
                    "grant_type": "client_credentials",
                    "client_id": creds["clientId"],
                    "client_secret": creds["clientSecret"],
                })
                self._token = str(res["access_token"])
                self._valid_until = now + float(res.get("expires_in", 1800)) - TOKEN_MARGIN
            except Exception:
                # не логируем детали: исключение может нести тело запроса
                self._valid_until = now + TOKEN_RETRY_BACKOFF
            return self._token


# ---------- логика ----------

@dataclass
class Deps:
    stations: Dict[str, Tuple[float, float]]
    allowed_origins: Any
    fetch_adsb: Callable[[float, float, int], List[Aircraft]]
    fetch_opensky: Callable[[Tuple[float, float, float, float], str], List[Aircraft]]
    auth: Any
    clock: Callable[[], float] = time.monotonic
    wall: Callable[[], float] = time.time

    def __post_init__(self) -> None:
        self.adsb_cache = TTLCache(ADSB_TTL, self.clock)
        self.opensky_cache = TTLCache(OPENSKY_TTL, self.clock)


def _respond(status: int, payload: Any, origin: Optional[str], deps: Deps, extra: Optional[Dict[str, str]] = None):
    headers = {"Vary": "Origin"}
    if isinstance(payload, bytes):
        body = payload
        headers["Content-Type"] = "text/plain; charset=utf-8"
    else:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if origin and origin in deps.allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
    headers.update(extra or {})
    return status, headers, body


def handle(path_qs: str, origin: Optional[str], deps: Deps, info: Optional[Dict[str, Any]] = None):
    """Возвращает (status, headers, body). info (необязательно) получает счётчики источников для лога."""
    info = info if info is not None else {}
    parsed = urllib.parse.urlsplit(path_qs)
    if parsed.path == "/healthz":
        return _respond(200, b"ok", origin, deps)
    if parsed.path != "/v1/aircraft":
        return _respond(404, {"error": "not found"}, origin, deps)

    qs = urllib.parse.parse_qs(parsed.query)
    code = (qs.get("station") or [""])[0]
    try:
        nm = int((qs.get("nm") or [""])[0])
    except ValueError:
        nm = 0
    if code not in deps.stations or nm not in RADII:
        return _respond(400, {"error": "bad station or nm"}, origin, deps)
    lat0, lon0 = deps.stations[code]
    key = (code, nm)

    adsb = deps.adsb_cache.get(key)
    if adsb is None:
        try:
            adsb = deps.fetch_adsb(lat0, lon0, nm)
            deps.adsb_cache.put(key, adsb)
        except Exception:
            adsb = None

    osky = deps.opensky_cache.get(key)
    if osky is None:
        token = deps.auth.token()
        if token:
            try:
                raw = deps.fetch_opensky(bbox(lat0, lon0, nm), token)
                osky = [a for a in raw if within(lat0, lon0, nm, a["lat"], a["lon"])]
                deps.opensky_cache.put(key, osky)
            except Exception:
                osky = None

    info["adsb"] = None if adsb is None else len(adsb)
    info["opensky"] = None if osky is None else len(osky)
    if adsb is None and osky is None:
        return _respond(502, {"error": "upstream unavailable"}, origin, deps)

    aircraft = merge(adsb or [], osky or [])
    payload = {"station": code, "nm": nm, "ts": int(deps.wall()), "aircraft": aircraft}
    return _respond(200, payload, origin, deps, {"Cache-Control": "max-age=5"})


# ---------- HTTP ----------

def make_handler(deps: Deps):
    class Handler(BaseHTTPRequestHandler):
        server_version = "lofiatc-radar"

        def do_GET(self) -> None:  # noqa: N802
            t0 = time.monotonic()
            info: Dict[str, Any] = {}
            try:
                status, headers, body = handle(self.path, self.headers.get("Origin"), deps, info)
            except Exception:
                status, headers, body = 500, {"Content-Type": "text/plain"}, b"error"
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            ms = int((time.monotonic() - t0) * 1000)
            extra = " adsb=%s opensky=%s" % (info.get("adsb"), info.get("opensky")) if info else ""
            sys.stderr.write("GET %s %d %dms%s\n" % (self.path, status, ms, extra))

        def log_message(self, fmt: str, *args: Any) -> None:  # стандартный лог не нужен
            pass

    return Handler


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    stations = load_stations(os.environ.get("STATIONS_PATH", os.path.join(here, "stations.json")))
    origins = {o.strip() for o in os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()}
    creds = os.path.expanduser(os.environ.get("OPENSKY_CREDS", "/etc/lofiatc/opensky.json"))
    deps = Deps(stations=stations, allowed_origins=origins, fetch_adsb=fetch_adsb,
                fetch_opensky=fetch_opensky, auth=OpenSkyAuth(creds))
    server = ThreadingHTTPServer(("127.0.0.1", 8787), make_handler(deps))
    sys.stderr.write("radar proxy on 127.0.0.1:8787, stations=%d, origins=%s\n" % (len(stations), sorted(origins)))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
