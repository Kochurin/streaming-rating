(function () {
  "use strict";
  var D = window.STREAMING_DATA;
  if (!D) {
    document.querySelector("main").innerHTML = '<p class="block">Нет файла data/bundle.js. Запустите <code>python scraper/scrape.py</code></p>';
    return;
  }
  var services = D.services.services || D.services;
  var prices = D.prices.services;
  var history = D.history || {};
  var OK = { auto: 1, manual: 1 };
  var STATUS = {
    auto: "собрано скриптом",
    manual: "сверено вручную",
    stale: "сейчас не собирается, последнее известное значение",
    unverified: "не проверено"
  };

  var fmt = new Intl.NumberFormat("ru-RU");
  function rub(n) { return fmt.format(Math.round(n)) + " ₽"; }
  function date(s) {
    if (!s) return "";
    var p = s.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u || ""; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- сборка строк ----------
  var rows = services.map(function (s) {
    var p = prices[s.id] || {};
    function f(k) { return p[k] || { value: null, status: "unverified" }; }
    var m = f("month"), y = f("year");
    return {
      s: s, p: p, name: s.name,
      month: m, year: y, trial: f("trial"), family: f("family"),
      mOk: OK[m.status] ? m.value : null,
      yOk: OK[y.status] ? y.value : null
    };
  });

  var auto = rows.filter(function (r) { return r.month.status === "auto"; }).length;
  document.getElementById("meta").innerHTML =
    "Обновлено <b>" + date(D.prices.updated) + "</b> · цена месяца собрана скриптом у " + auto + " из " + rows.length +
    " сервисов, остальные помечены";

  // ---------- подсказка ----------
  var tip = document.getElementById("tip");
  function tipText(fl) {
    var t = STATUS[fl.status] || "";
    if (fl.checked) t += ", " + date(fl.checked);
    if (fl.note && fl.note !== "сверено вручную") t += ". " + fl.note;
    if (fl.source) t += "\nИсточник: " + host(fl.source);
    return t;
  }
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.getAttribute("data-tip");
    tip.style.whiteSpace = "pre-line";
    tip.hidden = false;
    var r = el.getBoundingClientRect();
    var x = Math.min(r.left, window.innerWidth - 310);
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = (r.bottom + 6) + "px";
  });
  window.addEventListener("scroll", function () { tip.hidden = true; }, { passive: true });

  function cell(fl, render) {
    if (fl.value === null || fl.value === undefined || fl.status === "unverified") {
      return '<span class="na" data-tip="' + esc(tipText(fl) + (fl.value != null ? "\nПоследнее значение: " + fl.value : "")) + '">не проверено</span>';
    }
    var dot = '<i class="dot ' + fl.status + '"></i>';
    return '<span class="val ' + fl.status + '" data-tip="' + esc(tipText(fl)) + '">' + dot + render(fl.value) + "</span>";
  }

  // ---------- таблица ----------
  var state = { filter: "any", sort: "month", asc: true, hours: 20 };
  var tbody = document.querySelector("#tbl tbody");

  function sortVal(r, k) {
    if (k === "name") return r.name.toLowerCase();
    if (k === "month") return r.mOk;
    if (k === "year") return r.yOk;
    if (k === "yearMonth") return r.yOk != null ? r.yOk / 12 : null;
    if (k === "hour") return r.mOk != null && state.hours > 0 && r.s.tags.indexOf("kino") >= 0 ? r.mOk / state.hours : null;
    if (k === "trial") return OK[r.trial.status] ? 0 : 1;
    if (k === "family") return OK[r.family.status] ? 0 : 1;
    return null;
  }

  function renderTable() {
    var list = rows.filter(function (r) { return state.filter === "any" || r.s.tags.indexOf(state.filter) >= 0; });
    list.sort(function (a, b) {
      var x = sortVal(a, state.sort), y = sortVal(b, state.sort);
      if (x === null && y === null) return a.name.localeCompare(b.name, "ru");
      if (x === null) return 1;
      if (y === null) return -1;
      var c = x < y ? -1 : x > y ? 1 : 0;
      return state.asc ? c : -c;
    });
    tbody.innerHTML = list.map(function (r) {
      var ym = r.year.value != null && r.year.status !== "unverified"
        ? '<span class="val ' + r.year.status + '" data-tip="Годовая цена, делённая на 12">' + rub(r.year.value / 12) + "</span>"
        : '<span class="na">—</span>';
      var hour = r.s.tags.indexOf("kino") < 0 ? '<span class="na">—</span>'
        : r.mOk == null ? '<span class="na">не проверено</span>'
        : state.hours === 0 ? '<span class="na">—</span>'
        : '<span data-tip="' + esc("Месяц " + rub(r.mOk) + " ÷ " + state.hours + " ч из калькулятора") + '">' + rub(r.mOk / state.hours) + "</span>";
      var note = r.p.note ? '<small class="sub">' + esc(r.p.note) + "</small>" : "";
      var inc = (r.s.includes || []).join(", ");
      return "<tr>" +
        '<td class="svc"><b><a href="' + esc(r.s.url) + '" target="_blank" rel="noopener">' + esc(r.name) + "</a></b>" +
        (r.p.tariff && r.p.tariff !== r.name ? "<small>тариф «" + esc(r.p.tariff) + "»</small>" : "") + "</td>" +
        '<td class="num">' + cell(r.month, rub) + "</td>" +
        '<td class="num">' + cell(r.year, rub) + note + "</td>" +
        '<td class="num">' + ym + "</td>" +
        '<td class="num">' + hour + "</td>" +
        "<td>" + cell(r.trial, esc) + "</td>" +
        "<td>" + cell(r.family, esc) + "</td>" +
        '<td class="inc">' + (inc ? esc(inc) : '<span class="na">не проверено</span>') + "</td>" +
        "</tr>";
    }).join("");
    document.querySelectorAll("#tbl th[data-k]").forEach(function (th) {
      th.classList.toggle("sorted", th.dataset.k === state.sort);
      th.classList.toggle("asc", th.dataset.k === state.sort && state.asc);
    });
  }

  document.querySelectorAll("#tbl th[data-k]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.dataset.k;
      if (state.sort === k) state.asc = !state.asc; else { state.sort = k; state.asc = true; }
      renderTable();
    });
  });
  document.querySelectorAll("#filters .chip").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#filters .chip").forEach(function (x) { x.classList.toggle("on", x === b); });
      state.filter = b.dataset.f;
      renderTable();
    });
  });

  // ---------- калькулятор ----------
  function familyInfo(r) {
    if (!OK[r.family.status] || !r.family.value) return null;
    var v = String(r.family.value);
    if (/^нет/i.test(v)) return { cap: 1 };
    var cap = v.match(/до (\d+)/);
    var price = v.match(/(\d[\d\s]*)\s*₽/);
    return { cap: cap ? +cap[1] : 1, price: price ? +price[1].replace(/\s/g, "") : null };
  }

  function costFor(r, people, payYear) {
    var base, period;
    if (payYear && r.yOk != null) { base = r.yOk / 12; period = "при оплате за год"; }
    else if (r.mOk != null) { base = r.mOk; period = "помесячно"; }
    else return null;
    var fam = familyInfo(r), note = "";
    var total = base;
    if (people > 1) {
      if (fam && fam.cap >= people) {
        if (fam.price && !(payYear && r.yOk != null)) total = fam.price;
        note = fam.price ? "семейный тариф " + rub(fam.price) : "до " + fam.cap + " человек в одной подписке";
      } else if (fam && fam.cap === 1) {
        total = base * people; note = "только на одного, считаем " + people + " подписки";
      } else {
        total = base * people; note = "семейный доступ не проверен, считаем " + people + " подписки";
      }
    }
    return { total: total, period: period, note: note };
  }

  function renderCalc() {
    var hours = +document.getElementById("hours").value;
    var music = document.getElementById("needMusic").checked;
    var payYear = document.getElementById("payYear").checked;
    var people = +document.getElementById("people").value;
    state.hours = hours;
    document.getElementById("hoursOut").textContent = hours + " ч";
    var needKino = hours > 0;
    var priced = rows.filter(function (r) { return r.mOk != null || r.yOk != null; });
    var opts = [];
    priced.forEach(function (r) {
      var t = r.s.tags, c = costFor(r, people, payYear);
      if (!c) return;
      var kino = t.indexOf("kino") >= 0, mus = t.indexOf("music") >= 0;
      if ((!needKino || kino) && (!music || mus)) opts.push({ items: [r], costs: [c] });
    });
    if (needKino && music) {
      var k = priced.filter(function (r) { return r.s.tags.indexOf("kino") >= 0 && r.s.tags.indexOf("music") < 0; });
      var m = priced.filter(function (r) { return r.s.tags.indexOf("music") >= 0 && r.s.tags.indexOf("kino") < 0; });
      k.forEach(function (a) {
        m.forEach(function (b) {
          var ca = costFor(a, people, payYear), cb = costFor(b, people, payYear);
          if (ca && cb) opts.push({ items: [a, b], costs: [ca, cb] });
        });
      });
    }
    opts.forEach(function (o) { o.total = o.costs.reduce(function (s, c) { return s + c.total; }, 0); });
    opts.sort(function (a, b) { return a.total - b.total; });
    var el = document.getElementById("results");
    if (!needKino && !music) { el.innerHTML = '<li class="empty">Отметьте, что нужно: кино или музыка</li>'; renderTable(); return; }
    if (!opts.length) { el.innerHTML = '<li class="empty">Под такие условия нет вариантов с проверенной ценой</li>'; renderTable(); return; }
    el.innerHTML = opts.slice(0, 6).map(function (o, i) {
      var names = o.items.map(function (r) { return r.name; }).join(" + ");
      var notes = o.items.map(function (r, j) {
        var c = o.costs[j];
        var parts = [c.period];
        if (c.note) parts.push(c.note);
        if (r.month.status === "manual") parts.push("цена сверена вручную " + date(r.month.checked));
        return (o.items.length > 1 ? r.name + ": " : "") + parts.join(", ");
      }).join(" · ");
      var perHour = needKino && hours > 0 ? "<small>" + rub(o.total / hours / people) + " за час на человека</small>" : "<small>" + (people > 1 ? rub(o.total / people) + " на человека" : "&nbsp;") + "</small>";
      return '<li class="' + (i === 0 ? "best" : "") + '"><span class="rank">' + (i + 1) + '</span><span class="what"><b>' + esc(names) +
        "</b><small>" + esc(notes) + '</small></span><span class="cost">' + rub(o.total) + "<small>в месяц</small>" + perHour + "</span></li>";
    }).join("");
    renderTable();
  }
  ["hours", "needMusic", "payYear", "people"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", renderCalc);
  });

  // ---------- график истории ----------
  var hMode = "month";
  var hidden = {};
  var colors = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
  var series = rows.filter(function (r) { return (history[r.s.id] || []).length; }).map(function (r, i) {
    return { id: r.s.id, name: r.name, pts: history[r.s.id], color: "var(" + colors[i % colors.length] + ")" };
  });

  function renderChart() {
    var W = 900, H = 300, L = 56, R = 16, T = 12, B = 30;
    var all = [];
    series.forEach(function (s) {
      if (hidden[s.id]) return;
      s.pts.forEach(function (p) { if (p[hMode] != null) all.push({ t: Date.parse(p.date), v: p[hMode] }); });
    });
    var box = document.getElementById("chart");
    if (!all.length) { box.innerHTML = '<p class="hint">Нет данных</p>'; return; }
    var dates = {};
    all.forEach(function (a) { dates[a.t] = 1; });
    if (Object.keys(dates).length === 1) { renderBars(box); return; }
    var today = Date.parse(D.prices.updated);
    var t0 = Math.min.apply(null, all.map(function (a) { return a.t; }));
    var t1 = Math.max(today, Math.max.apply(null, all.map(function (a) { return a.t; })));
    if (t1 - t0 < 30 * 864e5) t0 = t1 - 30 * 864e5;
    var vmax = Math.max.apply(null, all.map(function (a) { return a.v; }));
    var step = hMode === "month" ? 100 : 1000;
    vmax = Math.ceil(vmax * 1.1 / step) * step;
    function x(t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }
    function y(v) { return T + (1 - v / vmax) * (H - T - B); }
    var g = "";
    for (var v = 0; v <= vmax; v += step * Math.max(1, Math.round(vmax / step / 5))) {
      g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt.format(v) + "</text>";
    }
    [t0, (t0 + t1) / 2, t1].forEach(function (t, i) {
      var d = new Date(t);
      g += '<text x="' + x(t) + '" y="' + (H - 8) + '" text-anchor="' + ["start", "middle", "end"][i] + '">' +
        d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) + "</text>";
    });
    var labels = [];
    series.forEach(function (s) {
      if (hidden[s.id]) return;
      var pts = s.pts.filter(function (p) { return p[hMode] != null; });
      if (!pts.length) return;
      // Ступенчатая линия: цена держится до следующего изменения
      var d = "", prev = null;
      pts.forEach(function (p, i) {
        var px = x(Date.parse(p.date)), py = y(p[hMode]);
        d += i === 0 ? "M" + px + " " + py : "H" + px + "V" + py;
        prev = p;
      });
      d += "H" + x(t1);
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.5"/>';
      pts.forEach(function (p) {
        g += '<circle cx="' + x(Date.parse(p.date)) + '" cy="' + y(p[hMode]) + '" r="4" fill="' + s.color + '" data-tip="' +
          esc(s.name + ": " + rub(p[hMode]) + " с " + date(p.date)) + '"/>';
      });
      labels.push({ y: y(prev[hMode]) - 6, name: s.name, color: s.color });
    });
    // Разводим подписи по вертикали, чтобы не налезали
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    }
    labels.forEach(function (l) {
      g += '<text x="' + (W - R - 4) + '" y="' + l.y + '" text-anchor="end" style="fill:' + l.color + '">' + esc(l.name) + "</text>";
    });
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="История цен">' + g + "</svg>";
  }

  // Пока у всех сервисов одна дата, линия была бы выдумкой: показываем столбцы на этот день
  function renderBars(box) {
    var items = series.filter(function (s) { return !hidden[s.id]; }).map(function (s) {
      var p = s.pts[s.pts.length - 1];
      return { name: s.name, v: p[hMode], color: s.color, date: p.date };
    }).filter(function (it) { return it.v != null; }).sort(function (a, b) { return a.v - b.v; });
    var W = 900, rowH = 30, L = 210, R = 90, H = items.length * rowH + 10;
    var vmax = Math.max.apply(null, items.map(function (i) { return i.v; }));
    var g = "";
    items.forEach(function (it, i) {
      var yy = 5 + i * rowH, w = (W - L - R) * it.v / vmax;
      g += '<text x="' + (L - 10) + '" y="' + (yy + 19) + '" text-anchor="end" style="fill:var(--ink);font-size:13px">' + esc(it.name) + "</text>" +
        '<rect x="' + L + '" y="' + (yy + 6) + '" width="' + w + '" height="18" rx="4" fill="' + it.color + '" data-tip="' + esc(it.name + ": " + rub(it.v) + " на " + date(it.date)) + '"/>' +
        '<text x="' + (L + w + 8) + '" y="' + (yy + 19) + '" style="fill:var(--ink);font-size:13px;font-weight:600">' + rub(it.v) + "</text>";
    });
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Цены на ' + date(items[0] && items[0].date) + '">' + g + "</svg>";
  }

  function renderLegend() {
    document.getElementById("chartLegend").innerHTML = series.map(function (s) {
      return '<button data-id="' + s.id + '" class="' + (hidden[s.id] ? "off" : "") + '"><i style="background:' + s.color + '"></i>' + esc(s.name) + "</button>";
    }).join("");
    document.querySelectorAll("#chartLegend button").forEach(function (b) {
      b.addEventListener("click", function () { hidden[b.dataset.id] = !hidden[b.dataset.id]; renderLegend(); renderChart(); });
    });
  }
  document.querySelectorAll("#history .chip").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#history .chip").forEach(function (x) { x.classList.toggle("on", x === b); });
      hMode = b.dataset.h;
      renderChart();
    });
  });
  var first = null;
  series.forEach(function (s) { if (!first || s.pts[0].date < first) first = s.pts[0].date; });
  var single = series.every(function (s) { return s.pts.length === 1 && s.pts[0].date === first; });
  document.getElementById("chartNote").textContent = !first ? ""
    : single ? "История копится с " + date(first) + ", пока есть только этот день. Линии появятся, когда скрипт заметит первое изменение цены. Сюда попадают только цены, собранные автоматически"
    : "История копится с " + date(first) + ": новая точка появляется, когда скрипт видит другую цену. Сюда попадают только цены, собранные автоматически";

  renderCalc();
  renderLegend();
  renderChart();
})();
