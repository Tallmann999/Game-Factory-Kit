#!/usr/bin/env python3
"""Build a portable reference board from local raster images; no network or dependencies."""
from __future__ import annotations

import argparse
import base64
import html
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024


def escaped(value: object) -> str:
    return html.escape(str(value), quote=True)


def image_data(path: Path) -> tuple[str, int]:
    # Read at most the permitted size, including for an unexpectedly large input.
    with path.open("rb") as stream:
        raw = stream.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"Image exceeds 8 MiB: {path.name}")
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif raw.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif raw.startswith((b"GIF87a", b"GIF89a")):
        mime = "image/gif"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise ValueError(f"Use a PNG, JPEG, GIF or WebP image: {path.name}")
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}", len(raw)


def render(manifest: dict, base: Path) -> str:
    if not isinstance(manifest, dict):
        raise ValueError("Manifest must be a JSON object")
    title = manifest.get("title", "Reference board")
    directions = manifest.get("directions")
    if not isinstance(directions, list) or not 1 <= len(directions) <= 6:
        raise ValueError("Provide 1–6 directions (normally 2–3)")
    cards, seen, total = [], set(), 0
    for direction in directions:
        if not isinstance(direction, dict):
            raise ValueError("Each direction must be an object")
        key = direction.get("id")
        if not isinstance(key, str) or not key.strip() or key in seen:
            raise ValueError("Direction IDs must be unique nonempty strings")
        seen.add(key)
        images = direction.get("images")
        if not isinstance(images, list) or not 1 <= len(images) <= 6:
            raise ValueError(f"Direction {key}: provide 1–6 images")
        figures = []
        for item in images:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not item["path"]:
                raise ValueError("Each image needs a local path")
            kind = item.get("kind", "reference")
            if kind not in ("reference", "generated", "user"):
                raise ValueError("Image kind must be reference, generated or user")
            source = item.get("source", "")
            if not isinstance(source, str):
                raise ValueError("Source must be an HTTP(S) URL or an empty string")
            if source:
                parsed = urlsplit(source)
                if parsed.scheme not in ("http", "https") or not parsed.hostname:
                    raise ValueError("Source links must use HTTP(S)")
            data, size = image_data((base / item["path"]).resolve())
            total += size
            if total > MAX_TOTAL_BYTES:
                raise ValueError("Board images exceed 32 MiB; use smaller reference images")
            caption = escaped(item.get("caption", ""))
            link = (f'<a href="{escaped(source)}" target="_blank" rel="noopener noreferrer">Источник / Source</a>'
                    if source else '<span>Локальное изображение; права на использование не проверены</span>')
            figures.append(f'<figure><img src="{data}" alt="{caption}"><figcaption>'
                           f'<strong>{escaped(kind)}</strong> · {caption}<br>{link}</figcaption></figure>')
        cards.append(f'<section><label class="choice"><input type="radio" name="direction" value="{escaped(key)}"> '
                     f'{escaped(direction.get("name", key))} <small>({escaped(key)})</small></label>'
                     f'<p class="notes">{escaped(direction.get("notes", ""))}</p>'
                     f'<div class="images">{"".join(figures)}</div></section>')
    values = {"TITLE": escaped(title), "CARDS": "".join(cards)}
    return re.sub(r"\{\{(TITLE|CARDS)\}\}", lambda match: values[match[1]], TEMPLATE)


def build(manifest_path: Path, output: Path, replace: bool = False) -> Path:
    manifest_path, output = manifest_path.resolve(), output.resolve()
    if output.suffix.lower() != ".html":
        raise ValueError("Output must be an .html file")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    content = render(manifest, manifest_path.parent)
    # Even --replace may not overwrite an input image or the manifest.
    inputs = {manifest_path}
    for direction in manifest["directions"]:
        inputs.update((manifest_path.parent / item["path"]).resolve() for item in direction["images"])
    if output in inputs:
        raise ValueError("Output must not overwrite a source file")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w" if replace else "x", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
    return output


TEMPLATE = '''<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{TITLE}}</title><link rel="icon" href="data:,"><style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#10131b;color:#e9edf6}
body{max-width:1280px;margin:auto;padding:32px}h1{line-height:1.15}p{color:#bfc9dd}
section{background:#1b2130;border:1px solid #35415a;border-radius:16px;padding:22px;margin:24px 0}
.choice{font-size:1.3rem;font-weight:700;cursor:pointer}input{accent-color:#ac9aff}
.notes{white-space:pre-wrap}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}
figure{margin:0;min-width:0}img{width:100%;height:280px;object-fit:contain;background:#0b0e15;border-radius:8px}
figcaption{font-size:.85rem;overflow-wrap:anywhere;margin-top:8px}a{color:#baadff}small{font-weight:400}
textarea{box-sizing:border-box;width:100%;min-height:100px;background:#1b2130;color:inherit;border:1px solid #66718a;padding:12px}
button{margin-top:16px;padding:12px 20px;background:#c5baff;color:#17112b;border:0;border-radius:8px;font:inherit;cursor:pointer}
footer{margin-top:20px;color:#bfc9dd;font-size:.9rem}@media(max-width:600px){body{padding:16px}.images{grid-template-columns:1fr}}
</style><h1>{{TITLE}}</h1>
<p>Выберите направление и напишите, что сохранить или изменить. Можно ответить Codex в чате по ID варианта.
Это выбор направления для быстрого MVP: финальные ассеты пока не нужны.</p>
<main>{{CARDS}}</main>
<label for="notes">Комментарий: что нравится, что исключить</label><textarea id="notes"></textarea>
<button type="button" id="download">Скачать выбор JSON</button><p id="status" role="status" aria-live="polite"></p>
<footer>Ничего не отправляется автоматически. После скачивания укажите Codex путь к JSON или сообщите выбор в чате.
Референс не означает разрешение использовать изображение в готовой игре.</footer>
<script>
document.getElementById('download').addEventListener('click',()=>{
 const chosen=document.querySelector('input[name="direction"]:checked');
 const status=document.getElementById('status');
 if(!chosen){status.textContent='Сначала выберите направление.';return;}
 const feedback={schema_version:1,board:document.title,direction:chosen.value,
   notes:document.getElementById('notes').value,recorded_at:new Date().toISOString()};
 const url=URL.createObjectURL(new Blob([JSON.stringify(feedback,null,2)],{type:'application/json;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='reference-feedback.json';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 status.textContent='Выбор подготовлен к скачиванию. Передайте путь к файлу или ответьте Codex в чате.';
});
</script></html>'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--replace", action="store_true", help="Replace an existing HTML board")
    args = parser.parse_args()
    try:
        result = build(args.manifest, args.output, args.replace)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"error: {exc}\n")
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
