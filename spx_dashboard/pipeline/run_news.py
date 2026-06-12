"""
Morning news pipeline:

    1. Fetch newsletters from the last 24 h via IMAP.
    2. Load positions from data/dashboard.json.
    3. Send everything to Claude; get back a structured morning note.
    4. Write data/morning_news.json (appending to existing archive).
    5. Send the summary by email to MORNING_NEWS_RECIPIENTS.

Usage:
    python run_news.py
Env:
    GMAIL_ADDRESS / GMAIL_APP_PASSWORD  — shared with fetch_gmail.py
    NEWS_SENDER_FILTER                  — comma-sep sender substrings
    NEWS_LOOKBACK_HOURS                 — default 24
    ANTHROPIC_API_KEY                   — Claude API key
    MORNING_NEWS_RECIPIENTS             — comma-sep email addresses to mail
    MORNING_NEWS_FROM                   — from address (defaults to GMAIL_ADDRESS)
"""

from __future__ import annotations

import datetime as dt
import base64
import json
import os
import smtplib
import sys
from zoneinfo import ZoneInfo
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "data")
LOGO_PATH = os.path.join(REPO, "public", "meritage-logo.png")
PORTFOLIO_JSON = os.path.join(DATA_DIR, "portfolio.json")
MORNING_NEWS_JSON = os.path.join(DATA_DIR, "morning_news.json")

sys.path.insert(0, HERE)
from fetch_news import fetch_recent_newsletters  # noqa: E402


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) else v


# ---------------------------------------------------------------------------
# Position list
# ---------------------------------------------------------------------------

def _get_positions() -> list[str]:
    # The team's actual portfolio, maintained in data/portfolio.json (also the
    # source for the Equities Dashboard page). NOT the SPX monitor universe.
    try:
        with open(PORTFOLIO_JSON) as f:
            data = json.load(f)
        return [
            f"{p['ticker']} ({p['name']})" if p.get("name") else p["ticker"]
            for p in data.get("positions", [])
            if p.get("ticker")
        ]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# LLM summarization
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are a senior analyst writing the daily morning note for a small team of professional investors at a long-only equity fund.
Your readers are sophisticated and run the portfolio listed below. Write for them.

AUDIENCE & TONE:
- They are investors. NEVER explain basic finance concepts (e.g. what an IPO, an index fund, a buyback, or a P/E ratio is). No definitions of common terms.
- Assume deep familiarity with the portfolio positions. Do not explain what the companies do.
- Be concise. Short, simple sentences — one idea each. Avoid long or complex sentences.
- Avoid unnecessary jargon and buzzwords, but ordinary financial terms are completely fine and expected.
- Be factual and specific. No hype, no filler.

PRIORITIES:
- Portfolio positions come FIRST. Lead with anything material to the names we own and give them the most space.
- Then the broad themes that recur across MULTIPLE newsletters. Repetition = signal. Ignore ads, promos, and one-off market colour.

FORMAT (built to be skimmed):
- Every key takeaway is its own numbered bullet (1, 2, 3 …).
- Supporting detail goes in lettered sub-bullets (a, b, c …) under the relevant takeaway.
- A busy reader should get the whole gist from the numbered bullets alone.

PORTFOLIO POSITIONS — "Claude's take":
- The fund is LONG every position. For each position you mention, after stating what happened, add your own read called "Claude's take".
- "Claude's take" = the implications for our long thesis: competitive moat, durability, future revenue growth, earnings power, pricing, competitive threats. Be specific to that name. 1-3 short sentences. It is analysis, not a recap of the news.

Structure the output as JSON exactly matching this schema:

{
  "date": "YYYY-MM-DD",
  "one_liner": "One concise sentence framing the morning.",
  "top_themes": [
    {
      "headline": "short headline (max 10 words)",
      "points": [
        {
          "text": "The key takeaway. One concise sentence.",
          "details": [
            "A supporting detail, kept short. Shown as a lettered sub-bullet.",
            "Another supporting detail, only if it adds something."
          ]
        }
      ],
      "sources": ["Newsletter Name 1", "Newsletter Name 2"],
      "chart": {
        "type": "bar",
        "title": "short chart title",
        "unit": "%",
        "series": [
          { "label": "S&P 500", "value": -1.6 },
          { "label": "Nasdaq 100", "value": -2.3 }
        ]
      }
    }
  ],
  "positions": [
    {
      "ticker": "MSFT",
      "name": "Microsoft",
      "notes": "The key takeaway about this name — what happened and why it matters. Concise.",
      "claude_take": "Your read on the implications for our long position: moat, growth, earnings power. Specific. 1-3 short sentences."
    }
  ]
}

Field rules:
- positions: list every owned name with something specific and material in today's mail — these are the priority, so put them first. Order by materiality. Omit names with nothing meaningful; do not pad. Always include "claude_take" for each name you list.
- top_themes: up to 5 items, most cross-cited first. Only include a theme if >=2 sources touched it, OR if it is highly material to a portfolio position.
- points: 2-5 per theme. "text" is the key takeaway (numbered bullet); "details" is 0-3 short supporting sub-bullets (lettered). Omit "details" or use an empty list when the takeaway stands alone.
- chart: include ONLY when the newsletters contain concrete, comparable numbers worth visualising (e.g. several index moves, a set of values across names, a trend). Provide 2-8 labeled numeric values in "series". Use "bar" for comparisons and "line" for a time trend. Set "unit" to the measure (e.g. "%", "$", "bps"). If there is nothing meaningful to chart, set "chart" to null.
- Output ONLY the JSON object, no markdown fences, no preamble.
"""


def _summarize(newsletters: list[dict], positions: list[str]) -> dict:
    import anthropic

    client = anthropic.Anthropic(api_key=_env("ANTHROPIC_API_KEY"))

    pos_str = ", ".join(positions) if positions else "(no positions loaded)"

    newsletter_blocks = []
    for i, nl in enumerate(newsletters, 1):
        block = (
            f"--- Newsletter {i} ---\n"
            f"From: {nl['sender']}\n"
            f"Subject: {nl['subject']}\n"
            f"Date: {nl['date']}\n\n"
            f"{nl['text'][:6000]}"  # cap per-newsletter to keep prompt sane
        )
        newsletter_blocks.append(block)

    user_content = (
        f"Today's date: {dt.date.today().isoformat()}\n\n"
        f"Portfolio positions to watch for: {pos_str}\n\n"
        + "\n\n".join(newsletter_blocks)
    )

    response = client.messages.create(
        model="claude-fable-5",
        # Generous budget: the model may emit a thinking block that also draws
        # from max_tokens, and a truncated response yields invalid JSON.
        max_tokens=8192,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_content}],
    )

    # The response may contain thinking blocks before the text block, so pick
    # the text block(s) explicitly rather than assuming content[0].
    raw = "".join(
        getattr(block, "text", "") for block in response.content
    ).strip()
    # Tolerate a ```json … ``` fence if the model adds one.
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    summary = json.loads(raw)
    # Fail loudly (workflow goes red) rather than archiving a malformed note.
    if not isinstance(summary, dict):
        raise ValueError(f"LLM summary is not a JSON object: {type(summary).__name__}")
    if not isinstance(summary.get("date"), str):
        summary["date"] = dt.date.today().isoformat()
    for key in ("top_themes", "positions"):
        if not isinstance(summary.get(key), list):
            raise ValueError(f"LLM summary field {key!r} is missing or not a list")
    return summary


# ---------------------------------------------------------------------------
# Email delivery
# ---------------------------------------------------------------------------

def _send_email(summary: dict) -> None:
    recipients_raw = _env("MORNING_NEWS_RECIPIENTS") or ""
    recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]
    if not recipients:
        print("No MORNING_NEWS_RECIPIENTS set; skipping email.", file=sys.stderr)
        return

    gmail_address = _env("GMAIL_ADDRESS") or ""
    from_addr = _env("MORNING_NEWS_FROM") or gmail_address
    password = _env("GMAIL_APP_PASSWORD") or ""
    if not from_addr or not password:
        print("Missing email credentials; skipping send.", file=sys.stderr)
        return

    subject = f"Morning Notes · {summary.get('date', dt.date.today().isoformat())}"

    # Build plain-text body first.
    one_liner = summary.get("one_liner", "")
    plain_lines = [f"Morning Notes — {summary.get('date', '')}", "", one_liner, ""]
    positions = summary.get("positions", [])
    if positions:
        plain_lines.append("Portfolio mentions:")
        for p in positions:
            plain_lines.append(f"  [{p['ticker']}] {p['notes']}")
            if p.get("claude_take"):
                plain_lines.append(f"      Claude's take: {p['claude_take']}")
        plain_lines.append("")
    for theme in summary.get("top_themes", []):
        plain_lines.append(theme["headline"].upper())
        points = theme.get("points") or _legacy_points(theme)
        for pi, point in enumerate(points, 1):
            plain_lines.append(f"   {pi}. {point.get('text', '')}")
            for di, sub in enumerate(_point_subs(point)):
                letter = chr(ord("a") + di)
                plain_lines.append(f"      {letter}. {sub}")
        chart = theme.get("chart")
        if chart and chart.get("series"):
            unit = chart.get("unit", "")
            vals = ", ".join(f"{s.get('label')}: {s.get('value')}{unit}" for s in chart["series"])
            plain_lines.append(f"   [{chart.get('title', 'Chart')}] {vals}")
        srcs = theme.get("sources", [])
        if srcs:
            plain_lines.append(f"   Sources: {', '.join(srcs)}")
        plain_lines.append("")

    # Attach the Meritage logo as a CID image so email clients show it inline.
    logo_cid = "meritage-logo"
    logo_data: bytes | None = None
    try:
        with open(LOGO_PATH, "rb") as fh:
            logo_data = fh.read()
    except OSError:
        logo_cid = None  # type: ignore[assignment]

    html_body = _build_html(summary, logo_cid=logo_cid)

    # Use multipart/related when we have an embedded image, otherwise alternative.
    if logo_data:
        msg_outer = MIMEMultipart("related")
        msg_outer["Subject"] = subject
        msg_outer["From"] = from_addr
        msg_outer["To"] = ", ".join(recipients)
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText("\n".join(plain_lines), "plain"))
        alt.attach(MIMEText(html_body, "html"))
        msg_outer.attach(alt)
        img = MIMEImage(logo_data, _subtype="png")
        img.add_header("Content-ID", f"<{logo_cid}>")
        img.add_header("Content-Disposition", "inline", filename="meritage-logo.png")
        msg_outer.attach(img)
        msg = msg_outer
    else:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText("\n".join(plain_lines), "plain"))
        msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(from_addr, password)
        smtp.sendmail(from_addr, recipients, msg.as_string())
    print(f"Email sent to {recipients}", file=sys.stderr)


def _legacy_points(theme: dict) -> list[dict]:
    """Adapt an older single-paragraph theme to the new points shape."""
    detail = theme.get("detail")
    return [{"text": detail, "details": []}] if detail else []


def _point_subs(point: dict) -> list[str]:
    """Lettered sub-bullets for a point: the new `details`, or — for notes
    generated under the old schema — the legacy `jargon` term/definition pairs."""
    if point.get("details"):
        return [str(d) for d in point["details"]]
    return [
        f"{j.get('term', '')}: {j.get('definition', '')}"
        for j in (point.get("jargon") or [])
    ]


def _chart_html(chart: dict) -> str:
    series = chart.get("series") or []
    if not series:
        return ""
    unit = chart.get("unit", "")
    vals = [float(s.get("value", 0)) for s in series]
    peak = max((abs(v) for v in vals), default=0) or 1
    rows = ""
    for s in series:
        v = float(s.get("value", 0))
        width = int(abs(v) / peak * 100)
        colour = "#dc2626" if v < 0 else "#16a34a"
        rows += (
            f'<tr>'
            f'<td style="font-size:12px;color:#444;padding:3px 8px 3px 0;white-space:nowrap">{s.get("label", "")}</td>'
            f'<td style="width:100%;padding:3px 0">'
            f'<span style="display:inline-block;height:12px;width:{width}%;background:{colour};border-radius:2px;vertical-align:middle"></span>'
            f'<span style="font-size:11px;color:#666;margin-left:6px">{v}{unit}</span>'
            f'</td></tr>'
        )
    return (
        f'<div style="margin:10px 0 4px">'
        f'<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">{chart.get("title", "")}</div>'
        f'<table style="border-collapse:collapse;width:100%">{rows}</table>'
        f"</div>"
    )


def _build_html(summary: dict, logo_cid: str | None = None) -> str:
    date = summary.get("date", "")
    # Header date as e.g. "June 11, 2026"; fall back to the raw value if it
    # isn't a parseable ISO date.
    try:
        date = dt.date.fromisoformat(date).strftime("%B %-d, %Y")
    except ValueError:
        pass
    one_liner = summary.get("one_liner", "")

    positions_html = ""
    for p in summary.get("positions", []):
        take = p.get("claude_take")
        take_html = (
            f'<div style="margin:4px 0 0 14px;font-size:12px;color:#555;'
            f'border-left:2px solid #3730e6;padding-left:8px">'
            f'<b style="color:#3730e6">Claude’s take:</b> {take}</div>'
            if take
            else ""
        )
        positions_html += (
            f'<div style="margin-bottom:12px">'
            f'<b style="color:#3730e6">{p["ticker"]}</b> — {p["notes"]}'
            f"{take_html}"
            f"</div>"
        )
    pos_section = (
        f'<h2 style="font-size:14px;margin-top:24px">Portfolio Mentions</h2>{positions_html}'
        if positions_html
        else ""
    )

    themes_html = ""
    for t in summary.get("top_themes", []):
        points = t.get("points") or _legacy_points(t)
        points_html = ""
        for point in points:
            subs = _point_subs(point)
            subs_html = ""
            if subs:
                items = "".join(
                    f'<li style="margin:2px 0">{s}</li>' for s in subs
                )
                subs_html = (
                    f'<ol type="a" style="margin:4px 0 4px 18px;padding:0;'
                    f'font-size:12px;color:#666">{items}</ol>'
                )
            points_html += f'<li style="margin:4px 0">{point.get("text", "")}{subs_html}</li>'
        chart_html = _chart_html(t["chart"]) if t.get("chart") else ""
        srcs = ", ".join(t.get("sources", []))
        themes_html += (
            f'<div style="margin-bottom:20px">'
            f'<b>{t["headline"]}</b>'
            f'<ol style="margin:6px 0 6px 18px;padding:0;color:#333;font-size:13px">{points_html}</ol>'
            f"{chart_html}"
            f'<div style="color:#888;font-size:12px;margin-top:4px">{srcs}</div>'
            f"</div>"
        )

    if logo_cid:
        logo_html = (
            f'<img src="cid:{logo_cid}" alt="Meritage" height="26" '
            f'style="height:26px;width:auto;display:inline-block;vertical-align:middle">'
        )
    else:
        logo_html = (
            '<span style="font-size:15px;font-weight:800;letter-spacing:.04em;'
            'color:#3730e6;vertical-align:middle">MERITAGE</span>'
        )

    return f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a22">
<div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #eee">
  {logo_html}
  <span style="font-size:13px;color:#aaa;vertical-align:middle">&nbsp;&nbsp;|&nbsp;&nbsp;Morning Notes&nbsp;·&nbsp;{date}</span>
</div>
<div style="margin-bottom:24px">
  <p style="font-size:15px;font-weight:600;margin:0">{one_liner}</p>
</div>
{pos_section}
<h2 style="font-size:14px;margin:24px 0 12px">Top Themes</h2>
{themes_html}
<p style="font-size:11px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:12px">
  MERITAGE · INTERNAL · Generated automatically from morning newsletters
</p>
</body></html>"""


# ---------------------------------------------------------------------------
# Archive helpers
# ---------------------------------------------------------------------------

def _load_archive() -> list[dict]:
    try:
        with open(MORNING_NEWS_JSON) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_archive(entries: list[dict]) -> None:
    # Atomic write: a crash mid-dump would otherwise leave invalid JSON, and
    # the next run's _load_archive() would silently reset the whole archive.
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = MORNING_NEWS_JSON + ".tmp"
    with open(tmp, "w") as f:
        json.dump(entries, f, indent=2)
    os.replace(tmp, MORNING_NEWS_JSON)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("Fetching newsletters…", file=sys.stderr)
    newsletters = fetch_recent_newsletters()
    if not newsletters:
        print("NO_NEWSLETTERS: nothing to summarize.", file=sys.stderr)
        # Write a placeholder so the site always has something to render
        today = dt.date.today().isoformat()
        summary = {
            "date": today,
            "top_themes": [],
            "positions": [],
            "one_liner": "No newsletters received this morning.",
        }
    else:
        print(f"Found {len(newsletters)} newsletter(s).", file=sys.stderr)
        positions = _get_positions()
        print(f"Loaded {len(positions)} portfolio positions.", file=sys.stderr)

        if not _env("ANTHROPIC_API_KEY"):
            print("Missing ANTHROPIC_API_KEY", file=sys.stderr)
            return 4

        print("Summarizing with Claude…", file=sys.stderr)
        summary = _summarize(newsletters, positions)

    # Prepend to archive (newest first), keeping last 90 days
    archive = _load_archive()
    today = summary.get("date", dt.date.today().isoformat())
    # Replace existing entry for today if present
    archive = [e for e in archive if e.get("date") != today]
    archive.insert(0, summary)
    # Trim to 90 days
    cutoff = (dt.date.today() - dt.timedelta(days=90)).isoformat()
    archive = [e for e in archive if e.get("date", "") >= cutoff]
    _save_archive(archive)
    print(f"UPDATED: morning_news.json ({len(archive)} entries in archive)", file=sys.stderr)

    # Always refresh/store the note (above), but only email on weekdays. The
    # markets are closed on weekends, so a Saturday/Sunday blast is just noise —
    # the note still lands in the archive and on the site. Weekday is evaluated
    # in US Eastern time so it matches the 9am-ET schedule regardless of the
    # runner's UTC clock.
    if newsletters:
        weekday_et = dt.datetime.now(ZoneInfo("America/New_York")).weekday()  # Mon=0 … Sun=6
        if weekday_et < 5:
            _send_email(summary)
        else:
            print("Weekend (ET) — note saved, skipping email.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
