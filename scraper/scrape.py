"""Собирает публичные цены стримингов и подписок с официальных страниц

Запуск: python scraper/scrape.py
Пишет data/prices.json, data/history.json и data/bundle.js (те же данные для сайта,
чтобы index.html открывался даже двойным щелчком, без сервера)

Правило: если поле собрать не удалось, оно получает status "unverified".
Последнее известное значение сохраняется с датой, но за свежее не выдаётся
"""
import datetime as dt
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from parsers import PARSERS  # noqa: E402

FIELDS = ("month", "year", "trial", "family")
MANUAL_MAX_AGE_DAYS = 60


def load(name, default):
    p = DATA / name
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return default


def save(name, obj):
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def field(value, status, checked, source, note=None):
    out = {"value": value, "status": status, "checked": checked, "source": source}
    if note:
        out["note"] = note
    return out


def merge_field(name, svc, scraped, old, today):
    """Решает, что показать в поле: свежий сбор, ручную сверку или «не проверено»"""
    if scraped and scraped.get(name) is not None:
        return field(scraped[name], "auto", today, scraped.get("source"), scraped.get("source_note"))

    manual = svc.get("manual") or {}
    if manual.get(name) is not None:
        age = (dt.date.fromisoformat(today) - dt.date.fromisoformat(manual["checked"])).days
        status = "manual" if age <= MANUAL_MAX_AGE_DAYS else "unverified"
        return field(manual[name], status, manual["checked"], manual.get("source"), "сверено вручную")

    if name in ("family",) and svc.get("family"):
        return field(svc["family"], "manual", None, svc.get("family_source"), "из справочника services.json")

    prev = (old or {}).get(name) or {}
    if prev.get("value") is not None and prev.get("status") in ("auto", "stale"):
        # Раньше собиралось, сейчас нет: показываем прежнее значение, но честно помечаем
        return field(prev["value"], "stale", prev.get("checked"), prev.get("source"),
                     "сейчас собрать не удалось, это последнее известное значение")
    return field(None, "unverified", None, None)


def main():
    today = dt.date.today().isoformat()
    services = load("services.json", {})["services"]
    old_prices = load("prices.json", {}).get("services", {})
    history = load("history.json", {})

    results, errors = {}, {}
    for sid, fn in PARSERS.items():
        try:
            results[sid] = fn()
            print(f"OK   {sid}: {results[sid].get('month')} ₽/мес, {results[sid].get('year')} ₽/год")
        except Exception as e:  # noqa: BLE001
            errors[sid] = f"{type(e).__name__}: {e}"
            print(f"FAIL {sid}: {errors[sid]}")
            if "-v" in sys.argv:
                traceback.print_exc()

    # Тариф «Плюс с Амедиатекой и START» лежит в той же таблице справки Яндекса
    yp = results.get("yandex-plus")
    if yp:
        for v in yp.get("variants", []):
            if "Амедиатек" in v["name"]:
                results["yandex-plus-amedia"] = {
                    "month": v["month"], "year": v["year"], "tariff": v["name"],
                    "family": yp.get("family"), "source": yp["source"],
                }
        results["yandex-plus"].pop("variants", None)

    out = {}
    for svc in services:
        sid = svc["id"]
        scraped = results.get(sid)
        old = old_prices.get(sid, {})
        rec = {name: merge_field(name, svc, scraped, old, today) for name in FIELDS}
        rec["tariff"] = (scraped or {}).get("tariff") or svc.get("tariff")
        if scraped and scraped.get("note"):
            rec["note"] = scraped["note"]
        if sid in errors:
            rec["error"] = errors[sid]
        elif sid not in PARSERS and not svc.get("derived_from"):
            rec["error"] = "автоматического сбора пока нет: на открытой странице цены нет или она подгружается после входа"
        out[sid] = rec

        # История: дописываем точку, только если цена собрана автоматически и изменилась
        if rec["month"]["status"] == "auto" or rec["year"]["status"] == "auto":
            point = {"date": today, "month": rec["month"]["value"], "year": rec["year"]["value"]}
            h = history.setdefault(sid, [])
            if not h or (h[-1]["month"], h[-1]["year"]) != (point["month"], point["year"]):
                h.append(point)

    auto = sum(1 for r in out.values() if r["month"]["status"] == "auto")
    prices = {"updated": today, "auto_count": auto, "total": len(out), "services": out}
    save("prices.json", prices)
    save("history.json", history)
    bundle = {"services": services, "prices": prices, "history": history}
    (DATA / "bundle.js").write_text(
        "// Генерируется scraper/scrape.py, руками не править\nwindow.STREAMING_DATA = "
        + json.dumps(bundle, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"\nЦена за месяц собрана автоматически: {auto} из {len(out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
