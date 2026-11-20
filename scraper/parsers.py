"""Парсеры официальных страниц. Каждый возвращает словарь с найденными полями
или бросает исключение, если нужное не нашлось. Ничего не подставляем «на глаз»"""
import html as htmlmod
import io
import json
import re

from extract import nuxt_data, walk
from fetch import get, FetchError
import requests
from fetch import HEADERS


class ParseError(Exception):
    pass


def rub(s) -> int:
    """'4 490 ₽' -> 4490"""
    digits = re.sub(r"[^\d]", "", str(s))
    if not digits:
        raise ParseError(f"не число: {s!r}")
    return int(digits)


def plain_text(page: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    t = htmlmod.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", t.replace(" ", " ").replace(" ", " ").replace("⁠", ""))


# ---------- Яндекс Плюс: таблица тарифов в официальной справке ----------
YANDEX_URL = "https://yandex.ru/support/plus-ru/ru/types"


# Одна и та же справка живёт по нескольким адресам. Из-за границы часть из них отвечает 404
YANDEX_URLS = [
    YANDEX_URL,
    "https://yandex.ru/support/plus/ru/types",
    "https://yandex.ru/support/plus-other/ru/types",
]


def yandex_plus():
    m, errs = None, []
    for url in YANDEX_URLS:
        try:
            page = get(url)
        except FetchError as e:
            errs.append(f"{url}: {e}")
            continue
        m = re.search(r"<h2[^>]*id=\"tarify\".*?<table>(.*?)</table>", page, re.S)
        if m:
            break
        errs.append(f"{url}: таблица тарифов не найдена")
    if not m:
        raise ParseError("; ".join(errs))
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", m.group(1), re.S):
        cells = [plain_text(td).strip() for td in re.findall(r"<td>(.*?)</td>", tr, re.S)]
        rows.append(cells)
    header = rows[0]
    if len(header) < 2 or "Яндекс Плюс" not in header[1]:
        raise ParseError(f"неожиданный заголовок таблицы: {header}")
    by = {r[0]: r for r in rows}
    month = rub(by["Стоимость на месяц"][1])
    year = rub(by["Стоимость на год"][1])
    out = {
        "month": month,
        "year": year,
        "tariff": header[1],
        "family": f"до {rub(by['Количество аккаунтов'][1])} аккаунтов, {rub(by['Количество устройств'][1])} устройств",
        "source": url,
        "variants": [],
    }
    for col in range(2, len(header)):
        try:
            out["variants"].append({
                "name": header[col],
                "month": rub(by["Стоимость на месяц"][col]),
                "year": rub(by["Стоимость на год"][col]),
            })
        except (KeyError, IndexError, ParseError):
            pass
    return out


# ---------- Иви: варианты покупки в состоянии страницы ----------
IVI_URL = "https://www.ivi.ru/profile/subscriptions"


def ivi():
    page = get(IVI_URL)
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*", page)
    if not m:
        raise ParseError("нет __INITIAL_STATE__")
    state, _ = json.JSONDecoder().raw_decode(page[m.end():])
    opts = state["billing"]["subscriptionPurchaseOptions"]["purchaseOptions"]
    own = [o for o in opts if o.get("object_id") == 6]  # 6 — сама подписка Иви
    if not own:
        raise ParseError("нет вариантов подписки Иви")
    day = 86400
    month = year = None
    trial = None
    for o in own:
        dur = int(o.get("renewal_initial_period") or o.get("duration") or 0)
        price = int(o.get("renewal_price") or 0)
        if o.get("trial"):
            days = round(int(o.get("duration", 0)) / day)
            cost = int(o.get("price") or 0)
            trial = f"{days} дней бесплатно" if cost == 0 else f"{days} дней за {cost} ₽"
            continue
        if 28 * day <= dur <= 31 * day and month is None:
            month = price
        elif 360 * day <= dur <= 366 * day and year is None:
            year = price
    if month is None:
        raise ParseError("не нашли месячную цену")
    return {"month": month, "year": year, "trial": trial, "tariff": "Иви", "source": IVI_URL}


# ---------- PREMIER: тарифы в данных Nuxt ----------
PREMIER_URL = "https://premier.one/"


def premier():
    data = nuxt_data(get(PREMIER_URL))
    products = {}
    for _, o in walk(data):
        if isinstance(o.get("tariffs"), list) and "serviceProductName" in o:
            products[o["serviceProductName"]] = [t for t in o["tariffs"] if isinstance(t, dict)]
    base = products.get("PREMIER")
    if not base:
        raise ParseError("нет продукта PREMIER")
    month = year = None
    for t in base:
        period, unit = t.get("billingPeriod"), t.get("billingPeriodTime")
        pay = t.get("paymentValue")
        if unit != "MONTH" or not isinstance(pay, (int, float)):
            continue
        if period == 1 and int(t.get("trialBillingPeriod") or 0) == 0:
            month = int(pay)
        elif period == 12:
            year = int(pay)
    if month is None:
        raise ParseError("нет месячного тарифа PREMIER")
    trial = None
    for name, tariffs in products.items():
        if "PREMIER" in name and "RUTUBE" in name:
            for t in tariffs:
                if int(t.get("trialBillingPeriod") or 0) > 0 and t.get("trialBillingPeriodTime") == "DAY":
                    trial = f"{t['trialBillingPeriod']} дней за {t.get('paymentValue')} ₽ (в связке {name})"
                    break
        if trial:
            break
    return {"month": month, "year": year, "trial": trial, "tariff": "PREMIER", "source": PREMIER_URL}


# ---------- Wink: витрина подписок ----------
WINK_URL = "https://wink.ru/services"


def wink():
    t = plain_text(get(WINK_URL))
    m = re.search(r"Wink Всё в одном (\d+) дн\w* бесплатно.*?далее — ([\d ]+) ₽/месяц", t)
    if not m:
        raise ParseError("нет карточки «Wink Всё в одном»")
    month = rub(m.group(2))
    trial = f"{m.group(1)} дня бесплатно"
    year = None
    y = re.search(r"Wink Всё в одном на 12 месяцев.*?Подключить за ([\d ]+) ₽ первый год, далее — ([\d ]+) ₽/год", t)
    note = None
    if y:
        year = rub(y.group(2))
        note = f"первый год {rub(y.group(1))} ₽"
    return {"month": month, "year": year, "trial": trial, "tariff": "Wink Всё в одном", "note": note, "source": WINK_URL}


# ---------- START: официальный PDF «Стоимость Подписки» ----------
START_URL = "https://start.ru/legal/subscription_price"


def start():
    r = requests.get(START_URL, headers=HEADERS, timeout=30)
    if r.status_code != 200 or not r.content.startswith(b"%PDF"):
        raise FetchError(f"HTTP {r.status_code}, не PDF")
    from pypdf import PdfReader
    text = " ".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(r.content)).pages)
    text = re.sub(r"\s+", " ", text)
    m = re.search(r"Подписки на 1 месяц\s*[–-]\s*([\d ]+)\s*руб", text)
    y = re.search(r"Подписки на 12 месяцев\s*[–-]\s*([\d ]+)\s*руб", text)
    if not m:
        raise ParseError("в PDF нет цены за месяц")
    return {"month": rub(m.group(1)), "year": rub(y.group(1)) if y else None, "tariff": "START", "source": START_URL}


# ---------- Okko: страница закрыта антибот-защитой, пробуем честно и сдаёмся ----------
OKKO_URL = "https://okko.tv/subscriptions"


def okko():
    t = plain_text(get(OKKO_URL))
    m = re.search(r"Месяц за 1 ₽, дальше — ([\d ]+) ₽/месяц", t)
    if not m:
        raise ParseError("цена не найдена")
    return {"month": rub(m.group(1)), "trial": "месяц за 1 ₽", "tariff": "Прайм", "source": OKKO_URL}


# ---------- Амедиатека: сайт цен не показывает без входа, берём встроенные покупки в App Store ----------
AMEDIA_APPSTORE = "https://apps.apple.com/ru/app/id695094274"


def amediateka():
    t = plain_text(get(AMEDIA_APPSTORE))
    m = re.search(r"Подписка Amediateka — 1 месяц ([\d ]+),00 ₽", t)
    if not m:
        raise ParseError("в App Store нет покупки «Подписка Amediateka — 1 месяц»")
    y = re.search(r"Подписка Amediateka — (?:12 месяцев|1 год) ([\d ]+),00 ₽", t)
    return {
        "month": rub(m.group(1)),
        "year": rub(y.group(1)) if y else None,
        "tariff": "Amediateka",
        "source": AMEDIA_APPSTORE,
        "source_note": "цена встроенной покупки в App Store",
    }


PARSERS = {
    "amediateka": amediateka,
    "yandex-plus": yandex_plus,
    "ivi": ivi,
    "premier": premier,
    "wink": wink,
    "start": start,
    "okko": okko,
}
