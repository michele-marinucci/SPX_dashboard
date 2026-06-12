"""
Poll a Gmail inbox over IMAP and download the newest .xlsx attachment.

Authentication uses a Gmail **App Password** (requires 2-Step Verification on
the account). App Passwords work with IMAP/SMTP; they do not require OAuth.

Environment variables:
    GMAIL_ADDRESS        the mailbox to poll (e.g. meritage.code@gmail.com)
    GMAIL_APP_PASSWORD   16-char app password (no spaces)
    GMAIL_FROM_FILTER    (optional) only accept mail from this sender
    ATTACHMENT_NAME      (optional) attachment filename to match; default
                         matches any *.xlsx. Substring, case-insensitive.

Behaviour:
    Scans the most recent messages, finds the newest one carrying a matching
    .xlsx attachment, and writes it to the path given on the command line.
    Prints the message's internal date (epoch ms) to stdout so the caller can
    decide whether it is newer than what was last processed.

Usage:
    python fetch_gmail.py <output.xlsx>
Exit codes:
    0  attachment downloaded
    3  no matching attachment found
    4  missing credentials
"""

from __future__ import annotations

import email
import imaplib
import os
import sys
import time
from email.message import Message

IMAP_HOST = "imap.gmail.com"

# Set to the internal date (epoch ms) of the message we downloaded, so callers
# that import this module (e.g. run_pipeline) can record the refresh date.
LAST_EMAIL_EPOCH_MS = 0


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) else v


def _iter_attachments(msg: Message):
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        if not filename:
            continue
        yield filename, part


def fetch_latest_xlsx(out_path: str) -> int:
    address = _env("GMAIL_ADDRESS")
    password = _env("GMAIL_APP_PASSWORD")
    if not address or not password:
        print("Missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD", file=sys.stderr)
        return 4

    from_filter = _env("GMAIL_FROM_FILTER")
    name_filter = (_env("ATTACHMENT_NAME") or "").lower()

    imap = imaplib.IMAP4_SSL(IMAP_HOST)
    imap.login(address, password)
    try:
        imap.select("INBOX")

        criteria = ["ALL"]
        if from_filter:
            criteria = ["FROM", from_filter]
        typ, data = imap.search(None, *criteria)
        if typ != "OK":
            print("IMAP search failed", file=sys.stderr)
            return 3
        ids = data[0].split()
        if not ids:
            print("No messages matched", file=sys.stderr)
            return 3

        # Newest first; check enough recent messages to find an attachment.
        for msg_id in reversed(ids[-50:]):
            typ, msg_data = imap.fetch(msg_id, "(RFC822 INTERNALDATE)")
            if typ != "OK" or not msg_data:
                continue
            raw = next(
                (p[1] for p in msg_data if isinstance(p, tuple) and p[1]), None
            )
            if raw is None:
                continue
            msg = email.message_from_bytes(raw)
            internal = imaplib.Internaldate2tuple(msg_data[0][0])

            for filename, part in _iter_attachments(msg):
                fl = filename.lower()
                if not fl.endswith(".xlsx"):
                    continue
                if name_filter and name_filter not in fl:
                    continue
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                with open(out_path, "wb") as f:
                    f.write(payload)
                epoch_ms = int(time.mktime(internal) * 1000) if internal else 0
                global LAST_EMAIL_EPOCH_MS
                LAST_EMAIL_EPOCH_MS = epoch_ms
                print(epoch_ms)  # stdout: timestamp for change detection
                print(
                    f"Downloaded {filename!r} ({len(payload)} bytes) -> {out_path}",
                    file=sys.stderr,
                )
                return 0

        print("No .xlsx attachment found in recent messages", file=sys.stderr)
        return 3
    finally:
        try:
            imap.close()
        except Exception:
            pass
        imap.logout()


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: fetch_gmail.py <output.xlsx>", file=sys.stderr)
        return 2
    return fetch_latest_xlsx(sys.argv[1])


if __name__ == "__main__":
    raise SystemExit(main())
