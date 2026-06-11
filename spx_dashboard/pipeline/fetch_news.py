"""
Fetch newsletter emails from the last 24 hours via IMAP and return their
text content for summarization.

Uses the same Gmail credentials as fetch_gmail.py (GMAIL_ADDRESS +
GMAIL_APP_PASSWORD).  Does NOT touch any attachment; reads only plain-text
and HTML body parts.

Environment variables:
    GMAIL_ADDRESS        inbox to read
    GMAIL_APP_PASSWORD   16-char app password
    NEWS_SENDER_FILTER   comma-separated list of sender substrings to
                         accept (e.g. "bloomberg.com,ft.com").  Optional;
                         when absent all messages from the last 24 h are
                         collected.
    NEWS_LOOKBACK_HOURS  how many hours back to look (default 24)
"""

from __future__ import annotations

import email
import imaplib
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from email.message import Message
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

IMAP_HOST = "imap.gmail.com"


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) else v


class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip = False
        if tag in ("p", "br", "div", "h1", "h2", "h3", "li"):
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = "".join(self._parts)
        # collapse whitespace runs while preserving paragraph breaks
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw.splitlines()]
        cleaned = "\n".join(ln for ln in lines if ln)
        return re.sub(r"\n{3,}", "\n\n", cleaned)


def _extract_text(msg: Message) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []
    for part in msg.walk():
        ct = part.get_content_type()
        if part.get_content_maintype() == "multipart":
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        charset = part.get_content_charset() or "utf-8"
        try:
            text = payload.decode(charset, errors="replace")
        except Exception:
            text = payload.decode("utf-8", errors="replace")
        if ct == "text/plain":
            plain_parts.append(text)
        elif ct == "text/html":
            stripper = _HTMLStripper()
            stripper.feed(text)
            html_parts.append(stripper.get_text())
    return ("\n\n".join(plain_parts) if plain_parts else "\n\n".join(html_parts)).strip()


def fetch_recent_newsletters(lookback_hours: int = 24) -> list[dict]:
    """
    Returns a list of dicts:
        { "subject": str, "sender": str, "date": str (ISO), "text": str }
    ordered newest-first.
    """
    address = _env("GMAIL_ADDRESS")
    password = _env("GMAIL_APP_PASSWORD")
    if not address or not password:
        print("Missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD", file=sys.stderr)
        return []

    sender_filters = [
        s.strip().lower()
        for s in (_env("NEWS_SENDER_FILTER") or "").split(",")
        if s.strip()
    ]
    lookback_hours = int(_env("NEWS_LOOKBACK_HOURS") or lookback_hours)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
    # IMAP SINCE only has day granularity; we'll filter by exact time ourselves.
    since_str = cutoff.strftime("%d-%b-%Y")

    imap = imaplib.IMAP4_SSL(IMAP_HOST)
    imap.login(address, password)
    print(f"[fetch_news] logged in as {address}", file=sys.stderr)
    results: list[dict] = []
    skipped_time = skipped_empty = 0
    try:
        imap.select("INBOX")
        typ, data = imap.search(None, "SINCE", since_str)
        if typ != "OK":
            print(f"[fetch_news] IMAP search failed: {typ}", file=sys.stderr)
            return []
        ids = data[0].split()
        print(
            f"[fetch_news] INBOX search SINCE {since_str} -> {len(ids)} message(s)",
            file=sys.stderr,
        )
        if not ids:
            return []

        for msg_id in reversed(ids):
            typ, msg_data = imap.fetch(msg_id, "(RFC822 INTERNALDATE)")
            if typ != "OK" or not msg_data:
                continue
            raw = next(
                (p[1] for p in msg_data if isinstance(p, tuple) and p[1]), None
            )
            if raw is None:
                continue

            msg = email.message_from_bytes(raw)

            # Prefer the server's INTERNALDATE; fall back to the message's own
            # Date header, and finally to "now" so a message is never silently
            # dropped just because its receive time couldn't be parsed.
            msg_dt = None
            internal_tuple = imaplib.Internaldate2tuple(msg_data[0][0])
            if internal_tuple is not None:
                import time
                msg_dt = datetime.fromtimestamp(
                    time.mktime(internal_tuple), tz=timezone.utc
                )
            if msg_dt is None and msg.get("Date"):
                try:
                    parsed = parsedate_to_datetime(msg["Date"])
                    if parsed is not None:
                        msg_dt = (
                            parsed
                            if parsed.tzinfo
                            else parsed.replace(tzinfo=timezone.utc)
                        ).astimezone(timezone.utc)
                except (TypeError, ValueError):
                    msg_dt = None
            if msg_dt is None:
                msg_dt = datetime.now(timezone.utc)

            sender_raw = msg.get("From", "")
            subject = msg.get("Subject", "(no subject)")

            if msg_dt < cutoff:
                skipped_time += 1
                print(
                    f"[fetch_news] skip (too old, {msg_dt.isoformat()}): "
                    f"{sender_raw} | {subject}",
                    file=sys.stderr,
                )
                continue

            sender_lower = sender_raw.lower()
            if sender_filters and not any(f in sender_lower for f in sender_filters):
                continue

            text = _extract_text(msg)
            if not text:
                skipped_empty += 1
                print(
                    f"[fetch_news] skip (empty body): {sender_raw} | {subject}",
                    file=sys.stderr,
                )
                continue

            print(
                f"[fetch_news] keep: {sender_raw} | {subject} ({len(text)} chars)",
                file=sys.stderr,
            )
            results.append(
                {
                    "subject": subject,
                    "sender": sender_raw,
                    "date": msg_dt.isoformat(),
                    "text": text,
                }
            )

        print(
            f"[fetch_news] kept {len(results)}, skipped {skipped_time} old / "
            f"{skipped_empty} empty",
            file=sys.stderr,
        )
    finally:
        try:
            imap.close()
        except Exception:
            pass
        imap.logout()

    return results
