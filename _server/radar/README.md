# Прокси радара

Маленький сервис на стандартной библиотеке Python 3.9+. Отдаёт самолёты вокруг одной из 7 станций:
adsb.lol (резерв adsb.fi) + OpenSky, дедуп по `hex`, приоритет у adsb.lol.

    GET /v1/aircraft?station=<CODE>&nm=<40|80|150|250>
    -> {"station","nm","ts","aircraft":[{"hex","call","lat","lon","track"}]}
    GET /healthz -> ok

Ошибки: 400 (станция или `nm`), 404 (путь), 502 (оба источника недоступны). Падение одного источника ответ не ломает.

## Запуск локально

    STATIONS_PATH=v3/stations.json OPENSKY_CREDS=~/.config/lofiatc/opensky.json \
      python3 _server/radar/radar_proxy.py

Слушает `127.0.0.1:8787` (TLS и домен — на стороне обратного прокси).

## Переменные окружения

- `STATIONS_PATH` — путь к `stations.json` (по умолчанию рядом со скриптом).
- `OPENSKY_CREDS` — JSON с `clientId`/`clientSecret` (по умолчанию `/etc/lofiatc/opensky.json`). Нет файла — работает только adsb.lol.
- `ALLOWED_ORIGINS` — через запятую, CORS только для них (по умолчанию `https://afoodpro.github.io,http://localhost:8080`).

Кеш: adsb 5 с, OpenSky 15 с на пару (станция, радиус). В лог (stderr) идёт одна строка на запрос; секреты и токены не пишутся.

## Проверка

    curl -s http://127.0.0.1:8787/healthz
    curl -si -H 'Origin: http://localhost:8080' 'http://127.0.0.1:8787/v1/aircraft?station=UNNT&nm=150'

## Тесты

    python3 -m unittest discover -s _server/radar -v

## systemd

`lofiatc-radar.service`: код и `stations.json` в `/opt/lofiatc-radar/`, ключи в `/etc/lofiatc/opensky.json` (подключаются через `LoadCredential`; скрипт берёт путь из `$CREDENTIALS_DIRECTORY`, если `OPENSKY_CREDS` не задан).
