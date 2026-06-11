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
import json
import os
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA_DIR = os.path.join(REPO, "data")
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
You are a senior investment analyst writing the daily morning note for a small team of investment professionals.
Your job is to distill the key investment-relevant signal from the day's newsletters — concisely and precisely.

Rules:
- Prioritize themes that appear in MULTIPLE newsletters. Repetition = signal.
- Ignore promotional content, ads, and generic market colour that appears in only one source.
- Structure the output as JSON exactly matching this schema:

{
  "date": "YYYY-MM-DD",
  "top_themes": [
    {
      "headline": "short headline (max 12 words)",
      "detail": "2-4 sentences. What is happening, why it matters for equities.",
      "sources": ["Newsletter Name 1", "Newsletter Name 2"]
    }
  ],
  "positions": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "notes": "1-3 sentences of what was said specifically about this name. Omit if nothing meaningful."
    }
  ],
  "one_liner": "One crisp sentence summarising the morning in plain English."
}

- top_themes: up to 5 items, most cross-cited first. Only include a theme if ≥2 sources touched it, OR if it is highly material to a portfolio position.
- positions: only include positions where something specific and meaningful was said. Do NOT pad with generic commentary.
- Keep the tone factual, no hyperbole.
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
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Email delivery
# ---------------------------------------------------------------------------

def _send_email(summary: dict, html_body: str) -> None:
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

    subject = f"Morning Note · {summary.get('date', dt.date.today().isoformat())}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)

    one_liner = summary.get("one_liner", "")
    plain_lines = [f"Morning Note — {summary.get('date', '')}", "", one_liner, ""]
    for theme in summary.get("top_themes", []):
        plain_lines.append(f"• {theme['headline']}")
        plain_lines.append(f"  {theme['detail']}")
        srcs = theme.get("sources", [])
        if srcs:
            plain_lines.append(f"  Sources: {', '.join(srcs)}")
        plain_lines.append("")
    positions = summary.get("positions", [])
    if positions:
        plain_lines.append("Portfolio mentions:")
        for p in positions:
            plain_lines.append(f"  [{p['ticker']}] {p['notes']}")

    msg.attach(MIMEText("\n".join(plain_lines), "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(from_addr, password)
        smtp.sendmail(from_addr, recipients, msg.as_string())
    print(f"Email sent to {recipients}", file=sys.stderr)


def _build_html(summary: dict) -> str:
    date = summary.get("date", "")
    one_liner = summary.get("one_liner", "")
    themes_html = ""
    for t in summary.get("top_themes", []):
        srcs = ", ".join(t.get("sources", []))
        themes_html += (
            f'<div style="margin-bottom:16px">'
            f'<b>{t["headline"]}</b><br>'
            f'<span style="color:#444">{t["detail"]}</span><br>'
            f'<span style="color:#888;font-size:12px">{srcs}</span>'
            f"</div>"
        )
    positions_html = ""
    for p in summary.get("positions", []):
        positions_html += (
            f'<div style="margin-bottom:8px">'
            f'<b style="color:#3730e6">{p["ticker"]}</b> — {p["notes"]}'
            f"</div>"
        )
    pos_section = (
        f'<h2 style="font-size:14px;margin-top:24px">Portfolio Mentions</h2>{positions_html}'
        if positions_html
        else ""
    )
    return f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a22">
<div style="border-top:3px solid #3730e6;padding-top:16px;margin-bottom:24px">
  <span style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Morning Note · {date}</span>
  <p style="font-size:15px;font-weight:600;margin:8px 0 0">{one_liner}</p>
</div>
<h2 style="font-size:14px;margin-bottom:12px">Top Themes</h2>
{themes_html}
{pos_section}
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
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MORNING_NEWS_JSON, "w") as f:
        json.dump(entries, f, indent=2)


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

    if newsletters:
        html = _build_html(summary)
        _send_email(summary, html)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
