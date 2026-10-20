#!/usr/bin/env python3
"""Write Notion connector fetch results (JSON files) into .cache/notion/*.md for the build. Local-only helper."""
import json, re, sys, pathlib
out = pathlib.Path(__file__).resolve().parent.parent / '.cache' / 'notion'
out.mkdir(parents=True, exist_ok=True)
for f in sys.argv[1:]:
    raw = open(f).read(); d = json.loads(raw[raw.find('{'):raw.rfind('}') + 1]); t = d['text']
    url = re.search(r'<page url="([^"]+)"', t).group(1)
    pid = url.rstrip('/').split('/')[-1].split('?')[0]
    title = json.loads(re.search(r'<properties>\s*(\{.*?\})\s*</properties>', t, re.S).group(1))['title']
    content = re.search(r'<content>\n?(.*)</content>', t, re.S).group(1).rstrip('\n') + '\n'
    icon = (d.get('icon') or {}).get('emoji', '')
    hdr = f"---\nid: {pid}\ntitle: {title}\nicon: {icon}\nurl: {url}\nlast_edited: {d.get('page_last_edited_at')}\n---\n"
    (out / f'{pid}.md').write_text(hdr + content)
    print('cached', pid[:6] + '…', len(content), 'chars')
