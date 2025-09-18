from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List
from flask import Flask, flash, redirect, render_template, request, url_for

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
BOOKINGS_LOG = DATA_DIR / "bookings.jsonl"

app = Flask(__name__)
app.secret_key = "toolrent-demo-secret"

OWNER_PHONE = "+7 904 608-82-71"
OWNER_TELEGRAM = "https://t.me/hokkystyle"
PLACEHOLDER_IMG = "https://placehold.co/800x600/EEF2FF/1E3A8A?text=ToolRent"

AVAILABILITY_META: Dict[str, Dict[str, str]] = {
    "in_stock": {"cls": "badge badge--in", "text": "В наличии"},
    "limited": {"cls": "badge badge--lim", "text": "Осталось мало"},
    "out_of_stock": {"cls": "badge badge--out", "text": "Нет в наличии"},
}

PLATFORM_ICONS: Dict[str, str] = {
    "avito": (
        "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24'"
        " aria-hidden='true'><circle cx='6' cy='6' r='4'/>"
        "<circle cx='18' cy='6' r='4'/><circle cx='6' cy='18' r='4'/><circle cx='18' cy='18' r='4'/></svg>"
    ),
}


def load_json(name: str) -> Any:
    path = DATA_DIR / name
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def prepare_tools() -> List[Dict[str, Any]]:
    rows = load_json("inventory.json")
    tools: List[Dict[str, Any]] = []
    for row in rows:
        tool = {**row}
        tool.setdefault("tags", [])
        tool.setdefault("specs", [])
        tool.setdefault("short_description", "")
        tool.setdefault("weekend_price", None)
        tool.setdefault("deposit", None)
        tool.setdefault("quantity", None)
        tool.setdefault("availability", "in_stock")
        tool.setdefault("image", "")
        tools.append(tool)
    return tools


def prepare_reviews() -> List[Dict[str, Any]]:
    rows = load_json("reviews.json")
    reviews = []
    for row in rows:
        review = {**row}
        if review.get("date"):
            # нормализуем формат даты
            try:
                parsed = datetime.fromisoformat(str(review["date"]))
                review["date"] = parsed.strftime("%d.%m.%Y")
            except ValueError:
                review["date"] = str(review["date"])
        reviews.append(review)
    return reviews


@app.template_filter("money")
def format_money(value: Any) -> str:
    if value in (None, ""):
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if number.is_integer():
        formatted = f"{int(number):,}"
    else:
        formatted = f"{number:,.2f}"
    return formatted.replace(",", "\u00a0")


def unique_tags(tools: Iterable[Dict[str, Any]]) -> List[str]:
    tags = {tag for tool in tools for tag in tool.get("tags", [])}
    return sorted(tags)


def min_price(tools: Iterable[Dict[str, Any]], key: str) -> Any:
    values = [tool.get(key) for tool in tools if isinstance(tool.get(key), (int, float))]
    return min(values) if values else None


def canonical_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def telegram_href(value: str) -> str:
    if value.startswith("@"):
        return f"https://t.me/{value[1:]}"
    return value


def log_booking(entry: Dict[str, Any]) -> None:
    BOOKINGS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with BOOKINGS_LOG.open("a", encoding="utf-8") as fh:
        json.dump(entry, fh, ensure_ascii=False)
        fh.write("\n")


@app.route("/")
def index():
    tools = prepare_tools()
    reviews = prepare_reviews()

    search_term = request.args.get("q", "").strip()
    active_tag = request.args.get("tag", "all")
    preselect = request.args.get("preselect")

    filtered_tools: List[Dict[str, Any]] = []
    for tool in tools:
        name = tool.get("name", "")
        tags = tool.get("tags", [])
        if search_term and search_term.lower() not in name.lower():
            continue
        if active_tag != "all" and active_tag not in tags:
            continue
        filtered_tools.append(tool)

    tags = unique_tags(tools)
    min_day = min_price(tools, "daily_price")
    min_weekend = min_price(tools, "weekend_price")
    current_year = datetime.now().year

    return render_template(
        "index.html",
        tools=filtered_tools,
        all_tools=tools,
        reviews=reviews,
        tags=tags,
        search_term=search_term,
        active_tag=active_tag,
        preselect=preselect,
        min_day=min_day,
        min_weekend=min_weekend,
        availability_meta=AVAILABILITY_META,
        platform_icons=PLATFORM_ICONS,
        owner_phone=OWNER_PHONE,
        owner_phone_href=canonical_phone(OWNER_PHONE),
        owner_telegram=OWNER_TELEGRAM,
        owner_telegram_href=telegram_href(OWNER_TELEGRAM),
        placeholder_img=PLACEHOLDER_IMG,
        current_year=current_year,
    )


@app.post("/book")
def book():
    form = request.form
    tools = prepare_tools()

    required = {
        "name": "Имя",
        "contact": "Телефон или Telegram",
        "tool": "Инструмент",
        "from_date": "Дата начала",
        "to_date": "Дата окончания",
    }

    missing = [label for field, label in required.items() if not form.get(field)]
    if missing:
        flash(
            "Пожалуйста, заполните обязательные поля: " + ", ".join(missing),
            "error",
        )
        return redirect(url_for("index"))

    tool = next((t for t in tools if t.get("id") == form.get("tool")), None)
    if tool is None:
        flash("Выбранный инструмент не найден. Попробуйте ещё раз.", "error")
        return redirect(url_for("index"))

    entry = {
        "ts": datetime.utcnow().isoformat(),
        "name": form.get("name"),
        "contact": form.get("contact"),
        "tool": tool.get("name"),
        "tool_id": tool.get("id"),
        "from": form.get("from_date"),
        "to": form.get("to_date"),
        "delivery": bool(form.get("addon_delivery")),
        "bags": bool(form.get("addon_bags")),
        "bits": bool(form.get("addon_bits")),
        "notes": form.get("notes"),
    }
    log_booking(entry)

    message = (
        f"Спасибо, {form.get('name')}! Ваша заявка на «{tool.get('name')}» получена. "
        f"Мы свяжемся с вами по {form.get('contact')} и подтвердим аренду."
    )
    flash(message, "success")

    return redirect(url_for("index", preselect=tool.get("id")))


if __name__ == "__main__":
    app.run(debug=True)
