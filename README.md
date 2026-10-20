# Meeting Prep Dashboard

A static, passphrase-locked dashboard (GitHub Pages) of upcoming meetings and their Notion prep pages.

- **Everything sensitive is encrypted.** The only meeting data in this repo is `docs/data.enc.json`:
  AES-256-GCM, key derived with PBKDF2-SHA256 (600,000 iterations, random 16-byte salt, random 12-byte IV, fresh on every build).
- **Decryption happens in your browser** with Web Crypto. No server, no analytics, no third-party requests (strict CSP, `noindex`).
- All times are shown in **Central time (America/Chicago)**.

## Features
Next-meeting hero with live countdown · stats (next 48h, prep pages, checklist progress, open follow-ups) ·
day-grouped timeline · prep status and checklist progress per meeting · priority questions & agenda ·
**Open prep in Notion** buttons · light/dark theme · optional "keep unlocked in this tab" (sessionStorage only).

## Building the data
```bash
export DASHBOARD_PASSPHRASE='…'      # required, never commit it
node scripts/build.mjs                # writes docs/data.enc.json
```
Sources (combined, all optional):
1. `.cache/notion/*.md` — prep pages exported from Notion (gitignored; written by the assistant each morning).
2. Notion API — set `NOTION_TOKEN` and `NOTION_PREP_PARENT_ID` (the "Meeting Prep" page) to read its child pages.
3. Outlook ICS — set `OUTLOOK_ICS_URL` to align times/attendees with the calendar. With `ORG_EMAIL_DOMAIN` set,
   external meetings without a prep page also appear, flagged **No prep page**.

Prep pages are expected to be titled `<Meeting title> — <Month D, YYYY>` with sections such as Meeting details,
Objective, Priority questions, Agenda outline, Prep checklist, Live notes, Follow-up checklist. Checkbox items in the
prep and follow-up checklists drive the progress bars.

`node scripts/build.mjs --example` builds a clearly-labeled EXAMPLE dataset into `example/` (gitignored) for design previews.

## Changing the passphrase
Re-run the build with the new `DASHBOARD_PASSPHRASE` and push `docs/data.enc.json`. Old blobs in git history stay
encrypted with the old passphrase, so choose a strong one (16+ characters) from the start.
