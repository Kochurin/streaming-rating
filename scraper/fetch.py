"""Загрузка страниц с понятным User-Agent и повторной попыткой"""
import time

import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 streaming-rating-bot"
)
HEADERS = {"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"}


class FetchError(Exception):
    pass


def get(url: str, tries: int = 2, timeout: int = 25) -> str:
    last = None
    for n in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            if r.status_code != 200:
                raise FetchError(f"HTTP {r.status_code}")
            r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
            text = r.text
            # Страница-заглушка антибота: не обходим, просто считаем, что собрать не вышло
            if "servicepipe.tech" in text or "badbrowser" in r.url or "/unsupported" in r.url:
                raise FetchError("страница закрыта антибот-защитой")
            return text
        except (requests.RequestException, FetchError) as e:
            last = e
            if n + 1 < tries:
                time.sleep(3)
    raise FetchError(str(last))
