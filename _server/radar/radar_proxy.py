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
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional, Tuple

USER_AGENT = "lofiatc-radar/1.0 (+https://afoodpro.github.io/lofiatcradio/)"
ADSBLOL_URL = "https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}"
ADSBFI_URL = "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}"
OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"
OPENSKY_TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
ADSB_ATTEMPT_TIMEOUT = 3  # на каждую попытку (lol, затем fi): 3 + 3 < DEADLINE
OPENSKY_ATTEMPT_TIMEOUT = 4  # на токен и на запрос по отдельности
DEADLINE = 7  # общий дедлайн ответа; клиент сдаётся на 10 с
RADII = (40, 80, 150, 250)
DEFAULT_ORIGINS = "https://afoodpro.github.io,http://localhost:8080"
ADSB_TTL = 5
OPENSKY_TTL = 15  # nm <= 80
OPENSKY_TTL_FAR = 45  # nm >= 150: большие bbox дороже по кредитам OpenSky
OPENSKY_FAR_NM = 150
ADSB_FAIL_TTL = 5
OPENSKY_FAIL_TTL = 20
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
        if not isinstance(a, dict):
            continue
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
        if not isinstance(s, list) or len(s) <= 10:
            continue
        lat, lon = _num(s[6]), _num(s[5])
        if lat is None or lon is None or not s[0]:
            continue
        out.append({
            "hex": str(s[0]).lower(),
            "call": str(s[1] or "").strip(),
            "lat": lat,
            "lon": lon,
            "track": _num(s[10]),
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
            if self._clock() >= hit[0]:
                del self._data[key]
                return None
            return hit[1]

    def put(self, key: Any, value: Any, ttl_sec: Optional[float] = None) -> None:
        with self._lock:
            self._data[key] = (self._clock() + (self._ttl if ttl_sec is None else ttl_sec), value)


# ---------- сеть ----------

# Последний X-Rate-Limit-Remaining от OpenSky (только число) — для строки лога.
_RATE = {"remaining": None}  # type: Dict[str, Optional[int]]


def _note_rate_limit(value: Optional[str]) -> None:
    try:
        _RATE["remaining"] = int(str(value).strip())
    except (TypeError, ValueError):
        pass


def _http_json(url: str, timeout: float, headers: Optional[Dict[str, str]] = None, data: Optional[bytes] = None,
               on_headers: Optional[Callable[[Any], None]] = None) -> Any:
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if on_headers is not None:
            on_headers(resp.headers)
        return json.loads(resp.read().decode("utf-8"))


def _post_form(url: str, form: Dict[str, str]) -> Any:
    return _http_json(
        url,
        OPENSKY_ATTEMPT_TIMEOUT,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=urllib.parse.urlencode(form).encode("ascii"),
    )


def fetch_adsb(lat: float, lon: float, nm: int) -> List[Aircraft]:
    """adsb.lol, при сбое — adsb.fi. Бросает исключение, если упали оба."""
    try:
        return normalize_adsblol(_http_json(ADSBLOL_URL.format(lat=lat, lon=lon, nm=nm), ADSB_ATTEMPT_TIMEOUT))
    except Exception:
        return normalize_adsblol(_http_json(ADSBFI_URL.format(lat=lat, lon=lon, nm=nm), ADSB_ATTEMPT_TIMEOUT))


def fetch_opensky(box: Tuple[float, float, float, float], token: str) -> List[Aircraft]:
    q = urllib.parse.urlencode(dict(zip(("lamin", "lomin", "lamax", "lomax"), ("%.4f" % v for v in box))))
    return normalize_opensky(_http_json(OPENSKY_STATES_URL + "?" + q, OPENSKY_ATTEMPT_TIMEOUT,
                                        headers={"Authorization": "Bearer " + token},
                                        on_headers=lambda h: _note_rate_limit(h.get("X-Rate-Limit-Remaining"))))


class OpenSkyAuth:
    """OAuth2 client credentials. Нет файла/ошибка -> token() is None (работаем только на adsb).

    Обновление идёт вне лока (один обновляющий), пока старый токен годен — отдаём его.
    """

    def __init__(self, creds_path: str, post: Callable[[str, Dict[str, str]], Any] = _post_form,
                 clock: Callable[[], float] = time.monotonic):
        self._path = creds_path
        self._post = post
        self._clock = clock
        self._token: Optional[str] = None
        self._expires_at = 0.0  # токен ещё годен
        self._refresh_at = 0.0  # пора обновлять
        self._retry_at = 0.0  # после сбоя не ходим до этого момента
        self._refreshing: Optional[threading.Event] = None
        self._lock = threading.Lock()

    def invalidate(self) -> None:
        """OpenSky ответил 401: забыть токен, следующий вызов обновит."""
        with self._lock:
            self._token = None
            self._expires_at = self._refresh_at = self._retry_at = 0.0

    def _usable(self, now: float) -> Optional[str]:
        return self._token if self._token and now < self._expires_at else None

    def token(self) -> Optional[str]:
        with self._lock:
            now = self._clock()
            if self._usable(now) and now < self._refresh_at:
                return self._token
            if self._refreshing is not None:
                waiter: Optional[threading.Event] = self._refreshing
            elif now < self._retry_at:
                return self._usable(now)
            else:
                waiter = None
                self._refreshing = done = threading.Event()
            old = self._usable(now)
        if waiter is not None:
            if old:
                return old
            waiter.wait(OPENSKY_ATTEMPT_TIMEOUT * 2)
            with self._lock:
                return self._usable(self._clock())
        try:
            with open(self._path, encoding="utf-8") as f:
                creds = json.load(f)
            res = self._post(OPENSKY_TOKEN_URL, {
                "grant_type": "client_credentials",
                "client_id": creds["clientId"],
                "client_secret": creds["clientSecret"],
            })
            tok, ttl = str(res["access_token"]), float(res.get("expires_in", 1800))
            ok = True
        except Exception:
            # детали не логируем: исключение может нести тело запроса
            tok, ttl, ok = None, 0.0, False
        with self._lock:
            now = self._clock()
            if ok:
                self._token = tok
                self._expires_at = now + ttl
                self._refresh_at = now + ttl - TOKEN_MARGIN
            else:
                self._retry_at = now + TOKEN_RETRY_BACKOFF
            self._refreshing = None
            result = self._usable(now)
        done.set()
        return result


# ---------- логика ----------

_EXECUTOR = ThreadPoolExecutor(max_workers=16, thread_name_prefix="radar-src")


@dataclass
class Deps:
    stations: Dict[str, Tuple[float, float]]
    allowed_origins: Any
    fetch_adsb: Callable[[float, float, int], List[Aircraft]]
    fetch_opensky: Callable[[Tuple[float, float, float, float], str], List[Aircraft]]
    auth: Any
    clock: Callable[[], float] = time.monotonic
    wall: Callable[[], float] = time.time
    deadline: float = DEADLINE

    def __post_init__(self) -> None:
        self.caches = {
            "adsb": TTLCache(ADSB_TTL, self.clock),
            "opensky": TTLCache(OPENSKY_TTL, self.clock),
        }
        self.fail_ttl = {"adsb": ADSB_FAIL_TTL, "opensky": OPENSKY_FAIL_TTL}
        self._lock = threading.Lock()
        self._inflight: Dict[Tuple[str, Any], Future] = {}

    def source(self, name: str, key: Any, job: Callable[[], List[Aircraft]]) -> Future:
        """Кеш (успех/отказ) -> уже летящий запрос -> новый запрос. Один запрос на (источник, ключ)."""
        cache = self.caches[name]
        with self._lock:
            hit = cache.get(key)
            if hit is not None:
                fut: Future = Future()
                if hit[0]:
                    fut.set_result(hit[1])
                else:
                    fut.set_exception(RuntimeError("cached failure"))
                return fut
            running = self._inflight.get((name, key))
            if running is not None:
                return running
            fut = Future()
            self._inflight[(name, key)] = fut
        _EXECUTOR.submit(self._run, name, key, job, fut)
        return fut

    def _run(self, name: str, key: Any, job: Callable[[], List[Aircraft]], fut: Future) -> None:
        try:
            value = job()
            err: Optional[BaseException] = None
        except BaseException as e:  # noqa: BLE001
            value, err = None, e
        with self._lock:
            # кеш пополняем до снятия из inflight и до resolve: промаха между ними нет
            if err is not None:
                ttl: Optional[float] = self.fail_ttl[name]
            elif name == "opensky" and key[1] >= OPENSKY_FAR_NM:
                ttl = OPENSKY_TTL_FAR
            else:
                ttl = None
            self.caches[name].put(key, (True, value) if err is None else (False, None), ttl)
            self._inflight.pop((name, key), None)
        if err is None:
            fut.set_result(value)
        else:
            fut.set_exception(err)


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

    def adsb_job() -> List[Aircraft]:
        return deps.fetch_adsb(lat0, lon0, nm)

    def opensky_job() -> List[Aircraft]:
        token = deps.auth.token()
        if not token:
            raise RuntimeError("no opensky token")
        try:
            raw = deps.fetch_opensky(bbox(lat0, lon0, nm), token)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                deps.auth.invalidate()
            raise
        return [a for a in raw if within(lat0, lon0, nm, a["lat"], a["lon"])]

    futs = {"adsb": deps.source("adsb", key, adsb_job), "opensky": deps.source("opensky", key, opensky_job)}
    wait(list(futs.values()), timeout=deps.deadline)
    # не успевшие к дедлайну считаются отсутствующими; их запрос доработает и заполнит кеш
    res: Dict[str, Optional[List[Aircraft]]] = {
        n: (f.result() if f.done() and f.exception() is None else None) for n, f in futs.items()
    }
    adsb, osky = res["adsb"], res["opensky"]
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
        timeout = 10

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
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            ms = int((time.monotonic() - t0) * 1000)
            extra = " adsb=%s opensky=%s" % (info.get("adsb"), info.get("opensky")) if info else ""
            if info and _RATE["remaining"] is not None:
                extra += " osky_rl=%d" % _RATE["remaining"]
            sys.stderr.write("GET %s %d %dms%s\n" % (self.path, status, ms, extra))

        def log_message(self, fmt: str, *args: Any) -> None:  # стандартный лог не нужен
            pass

    return Handler


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    stations = load_stations(os.environ.get("STATIONS_PATH", os.path.join(here, "stations.json")))
    origins = {o.strip() for o in os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()}
    creds = os.environ.get("OPENSKY_CREDS")
    if not creds and os.environ.get("CREDENTIALS_DIRECTORY"):  # systemd LoadCredential
        creds = os.path.join(os.environ["CREDENTIALS_DIRECTORY"], "opensky.json")
    creds = os.path.expanduser(creds or "/etc/lofiatc/opensky.json")
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
