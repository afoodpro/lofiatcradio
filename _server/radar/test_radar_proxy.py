from __future__ import annotations

import json
import os
import tempfile
import unittest

import radar_proxy as rp

STATIONS = {"UNNT": (55.01, 82.65)}
ORIGIN = "http://localhost:8080"


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make_deps(adsb=None, opensky=None, token="tok", clock=None):
    clock = clock or Clock()
    calls = {"adsb": 0, "opensky": 0}

    def fetch_adsb(lat, lon, nm):
        calls["adsb"] += 1
        if adsb is None:
            raise OSError("down")
        return adsb

    def fetch_opensky(box, tok):
        calls["opensky"] += 1
        if opensky is None:
            raise OSError("down")
        return opensky

    class Auth:
        def token(self):
            return token

    deps = rp.Deps(
        stations=STATIONS,
        allowed_origins={"https://afoodpro.github.io", ORIGIN},
        fetch_adsb=fetch_adsb,
        fetch_opensky=fetch_opensky,
        auth=Auth(),
        clock=clock,
        wall=lambda: 1700000000,
    )
    return deps, calls, clock


def ac(hex_, call="X", lat=55.0, lon=82.6, track=90):
    return {"hex": hex_, "call": call, "lat": lat, "lon": lon, "track": track}


def get(deps, qs="station=UNNT&nm=80", origin=ORIGIN, path="/v1/aircraft"):
    return rp.handle(path + ("?" + qs if qs else ""), origin, deps)


class HandleTests(unittest.TestCase):
    def test_unknown_station_400(self):
        deps, _, _ = make_deps(adsb=[])
        self.assertEqual(get(deps, "station=ZZZZ&nm=80")[0], 400)

    def test_bad_nm_400(self):
        deps, _, _ = make_deps(adsb=[])
        self.assertEqual(get(deps, "station=UNNT&nm=77")[0], 400)
        self.assertEqual(get(deps, "station=UNNT")[0], 400)

    def test_healthz(self):
        deps, _, _ = make_deps()
        status, _, body = get(deps, "", path="/healthz")
        self.assertEqual((status, body), (200, b"ok"))

    def test_404(self):
        deps, _, _ = make_deps()
        self.assertEqual(get(deps, "", path="/nope")[0], 404)

    def test_ok_shape_and_headers(self):
        deps, _, _ = make_deps(adsb=[ac("aaa111")], opensky=[])
        status, headers, body = get(deps)
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual((data["station"], data["nm"], data["ts"]), ("UNNT", 80, 1700000000))
        self.assertEqual(data["aircraft"][0]["hex"], "aaa111")
        self.assertEqual(headers["Cache-Control"], "max-age=5")
        self.assertEqual(headers["Vary"], "Origin")

    def test_cors_only_allowed_origin(self):
        deps, _, _ = make_deps(adsb=[], opensky=[])
        _, h1, _ = get(deps, origin=ORIGIN)
        self.assertEqual(h1["Access-Control-Allow-Origin"], ORIGIN)
        _, h2, _ = get(deps, origin="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Origin", h2)
        _, h3, _ = get(deps, origin=None)
        self.assertNotIn("Access-Control-Allow-Origin", h3)

    def test_opensky_filtered_to_circle(self):
        # угол bbox (nm=40) — вне круга, центр — внутри
        lamin, lomin, lamax, lomax = rp.bbox(55.01, 82.65, 40)
        corner = ac("c0ffee", lat=lamax, lon=lomax)
        inside = ac("bada55", lat=55.1, lon=82.7)
        deps, _, _ = make_deps(adsb=[], opensky=[corner, inside])
        data = json.loads(get(deps, "station=UNNT&nm=40")[2])
        self.assertEqual([a["hex"] for a in data["aircraft"]], ["bada55"])

    def test_opensky_cached_15s(self):
        deps, calls, clock = make_deps(adsb=[], opensky=[])
        get(deps)
        clock.t += 10
        get(deps)
        self.assertEqual(calls["opensky"], 1)
        clock.t += 6
        get(deps)
        self.assertEqual(calls["opensky"], 2)

    def test_adsb_cached_5s(self):
        deps, calls, clock = make_deps(adsb=[], opensky=[])
        get(deps)
        clock.t += 3
        get(deps)
        self.assertEqual(calls["adsb"], 1)
        clock.t += 3
        get(deps)
        self.assertEqual(calls["adsb"], 2)

    def test_opensky_down_still_200(self):
        deps, _, _ = make_deps(adsb=[ac("aaa111")], opensky=None)
        status, _, body = get(deps)
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)["aircraft"]), 1)

    def test_adsb_down_opensky_up_200(self):
        deps, _, _ = make_deps(adsb=None, opensky=[ac("bbb222", lat=55.0, lon=82.6)])
        status, _, body = get(deps)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["aircraft"][0]["hex"], "bbb222")

    def test_both_down_502(self):
        deps, _, _ = make_deps(adsb=None, opensky=None)
        self.assertEqual(get(deps)[0], 502)

    def test_no_token_skips_opensky(self):
        deps, calls, _ = make_deps(adsb=[ac("aaa111")], opensky=[], token=None)
        status, _, _ = get(deps)
        self.assertEqual(status, 200)
        self.assertEqual(calls["opensky"], 0)

    def test_adsb_only_no_token_adsb_down_502(self):
        deps, _, _ = make_deps(adsb=None, opensky=[], token=None)
        self.assertEqual(get(deps)[0], 502)


class PureTests(unittest.TestCase):
    def test_merge_dedup_prefers_adsblol(self):
        merged = rp.merge([ac("abc123", call="LOL")], [ac("abc123", call="OSKY"), ac("def456")])
        self.assertEqual([(a["hex"], a["call"]) for a in merged], [("abc123", "LOL"), ("def456", "X")])

    def test_normalize_adsblol(self):
        out = rp.normalize_adsblol({"ac": [
            {"hex": "ABC123", "flight": "SBI123  ", "lat": 1.5, "lon": 2.5, "track": 10.2},
            {"hex": "nopos"},
        ]})
        self.assertEqual(out, [{"hex": "abc123", "call": "SBI123", "lat": 1.5, "lon": 2.5, "track": 10.2}])

    def test_normalize_opensky(self):
        row = ["ABC123", "AFL1 ", "RU", 0, 0, 82.5, 55.5, 0, False, 0, 123.0]
        out = rp.normalize_opensky({"states": [row, ["x", "y", "z", 0, 0, None, None]]})
        self.assertEqual(out, [{"hex": "abc123", "call": "AFL1", "lat": 55.5, "lon": 82.5, "track": 123.0}])
        self.assertEqual(rp.normalize_opensky({"states": None}), [])

    def test_load_stations(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump([{"code": "AAAA", "lat": 1.0, "lon": 2.0, "city": "X"}], f)
        try:
            self.assertEqual(rp.load_stations(f.name), {"AAAA": (1.0, 2.0)})
        finally:
            os.remove(f.name)

    def test_ttl_cache(self):
        clock = Clock()
        c = rp.TTLCache(5, clock=clock)
        self.assertIsNone(c.get("k"))
        c.put("k", 1)
        clock.t += 4.9
        self.assertEqual(c.get("k"), 1)
        clock.t += 0.2
        self.assertIsNone(c.get("k"))


class AuthTests(unittest.TestCase):
    def _creds(self):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"clientId": "id", "clientSecret": "secret"}, f)
        f.close()
        self.addCleanup(os.remove, f.name)
        return f.name

    def test_token_refresh_before_expiry(self):
        clock = Clock()
        posts = []

        def post(url, form):
            posts.append((url, form))
            return {"access_token": "t%d" % len(posts), "expires_in": 1800}

        auth = rp.OpenSkyAuth(self._creds(), post=post, clock=clock)
        self.assertEqual(auth.token(), "t1")
        clock.t += 1739
        self.assertEqual(auth.token(), "t1")
        self.assertEqual(len(posts), 1)
        clock.t += 2  # 1741-я секунда
        self.assertEqual(auth.token(), "t2")
        self.assertEqual(posts[0][0], rp.OPENSKY_TOKEN_URL)
        self.assertEqual(posts[0][1]["grant_type"], "client_credentials")
        self.assertEqual(posts[0][1]["client_id"], "id")

    def test_no_creds_file_adsblol_only(self):
        called = []
        auth = rp.OpenSkyAuth("/nonexistent/opensky.json", post=lambda u, f: called.append(1), clock=Clock())
        self.assertIsNone(auth.token())
        self.assertEqual(called, [])

    def test_token_error_returns_none(self):
        def post(url, form):
            raise OSError("boom")

        auth = rp.OpenSkyAuth(self._creds(), post=post, clock=Clock())
        self.assertIsNone(auth.token())


if __name__ == "__main__":
    unittest.main()
