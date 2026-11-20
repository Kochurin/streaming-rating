"""Достаёт встроенные JSON-состояния из HTML: Next.js, Nuxt, Angular и других"""
import html as htmlmod
import json
import re


def script_json(page: str, script_id: str):
    m = re.search(r'<script[^>]*id="%s"[^>]*>(.*?)</script>' % re.escape(script_id), page, re.S)
    if not m:
        return None
    raw = m.group(1).strip()
    try:
        return json.loads(raw)
    except ValueError:
        return json.loads(htmlmod.unescape(raw))


def next_data(page: str):
    return script_json(page, "__NEXT_DATA__")


def nuxt_data(page: str):
    """Разворачивает формат devalue, которым Nuxt 3 сериализует состояние"""
    arr = script_json(page, "__NUXT_DATA__")
    if arr is None:
        return None
    cache = {}

    def res(i, depth=0):
        if not isinstance(i, int) or i < 0 or i >= len(arr) or depth > 200:
            return i
        if i in cache:
            return cache[i]
        v = arr[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in ("Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef"):
                out = res(v[1], depth + 1) if len(v) > 1 else None
            elif v and isinstance(v[0], str) and v[0] in ("Set", "Map", "Date", "BigInt", "null"):
                out = None
            else:
                out = []
                cache[i] = out
                out.extend(res(x, depth + 1) for x in v)
                return out
        elif isinstance(v, dict):
            out = {}
            cache[i] = out
            for k, x in v.items():
                out[k] = res(x, depth + 1)
            return out
        else:
            out = v
        cache[i] = out
        return out

    return res(0)


def walk(obj, path=""):
    """Обходит дерево и отдаёт (путь, словарь) для каждого словаря"""
    seen = set()
    stack = [(path, obj)]
    while stack:
        p, o = stack.pop()
        if id(o) in seen:
            continue
        if isinstance(o, (dict, list)):
            seen.add(id(o))
        if isinstance(o, dict):
            yield p, o
            for k, v in o.items():
                stack.append((f"{p}.{k}", v))
        elif isinstance(o, list):
            for n, v in enumerate(o):
                stack.append((f"{p}[{n}]", v))
