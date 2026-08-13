"""
FASE 1 de la migración de imágenes a Cloudinary.
Construye el mapa color -> imágenes desde data/prezenza-raw.json (sin red).

Por producto: agrupa las imágenes de cada variación por su color; las variaciones
"(sin color)" y las imágenes de nivel producto (Store API) van a `gallery`.

Deduplica por "firma" (nombre de archivo sin sufijo de tamaño -700x1054 ni la
extensión), para colapsar la principal (sized) y su full_src al mismo asset.
Prefiere `full_src` (alta resolución).

Salida: data/prezenza-images-map.json  (para revisar antes de subir nada).

  python scripts/scrape/build_images_map.py
"""
import json
import re
import os

import sys
_arg = lambda n, d: next((a.split("=", 1)[1] for a in sys.argv if a.startswith(f"--{n}=")), d)
RAW = _arg("raw", os.path.join(os.path.dirname(__file__), "..", "..", "data", "prezenza-raw.json"))
OUT = _arg("out", os.path.join(os.path.dirname(__file__), "..", "..", "data", "prezenza-images-map.json"))
FIXED_BRAND = _arg("brand", None)  # si se da, se usa como brandSlug para todos
BRAND_ALIAS = {"fit-be-fresh": "fitbefresh"}


def signature(url):
    name = url.split("/")[-1].split("?")[0].lower()
    name = re.sub(r"-\d+x\d+", "", name)                 # quita -700x1054
    name = re.sub(r"\.(jpe?g|png|webp|gif)", "", name)   # quita extensiones (incl. .jpg.jpeg)
    return name


def variation_images(v):
    """Lista de (src, sig) de una variación, prefiriendo full_src, deduplicada."""
    cands = []
    img = v.get("image") or {}
    main = img.get("full_src") or img.get("src")
    if main:
        cands.append((main, True if img.get("full_src") else False))
    for x in (v.get("additional_variation_images") or []):
        if isinstance(x, dict):
            u = x.get("full_src") or x.get("src")
            if u:
                cands.append((u, bool(x.get("full_src"))))
    # dedup por firma; si hay full y no-full de la misma firma, gana el full
    best = {}
    for url, is_full in cands:
        sig = signature(url)
        if sig not in best or (is_full and not best[sig][1]):
            best[sig] = (url, is_full)
    return [{"src": u, "sig": sig} for sig, (u, _) in best.items()]


def dedup(items):
    seen, out = set(), []
    for it in items:
        if it["sig"] not in seen:
            seen.add(it["sig"])
            out.append(it)
    return out


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    productos = []
    tot_color_imgs = tot_gallery = 0
    all_sigs = set()

    for p in data:
        brand = FIXED_BRAND or (p.get("brands") or [{}])[0].get("slug") or ""
        brand = BRAND_ALIAS.get(brand, brand)
        colors, gallery = {}, []

        for v in p.get("_variations_full", []):
            color = (v.get("attributes", {}) or {}).get("attribute_pa_colores") or ""
            imgs = variation_images(v)
            if color:
                colors.setdefault(color, [])
                colors[color].extend(imgs)
            else:
                gallery.extend(imgs)  # variación "(sin color)"

        # + imágenes de nivel producto (Store API)
        for im in p.get("images", []):
            u = im.get("src")
            if u:
                gallery.append({"src": u, "sig": signature(u)})

        colors = {c: dedup(v) for c, v in colors.items()}
        gallery = dedup(gallery)

        for v in colors.values():
            for it in v:
                all_sigs.add(it["sig"])
            tot_color_imgs += len(v)
        for it in gallery:
            all_sigs.add(it["sig"])
        tot_gallery += len(gallery)

        productos.append({
            "slug": p["slug"], "sku": p.get("sku"), "brandSlug": brand,
            "colors": colors, "gallery": gallery,
            "ajax": p.get("type") == "variable" and not p.get("_variations_full"),
        })

    json.dump({"products": productos}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"Productos: {len(productos)}")
    print(f"Imágenes de color: {tot_color_imgs} | de galería: {tot_gallery}")
    print(f"Firmas únicas globales (uploads reales aprox): {len(all_sigs)}")
    print(f"Guardado: {os.path.abspath(OUT)}")
    ej = next(x for x in productos if x["slug"] == "playera-cotton")
    print(f"\nEjemplo PLAYERA COTTON:")
    for c, v in ej["colors"].items():
        print(f"  {c:14} {len(v)} img -> {[i['sig'] for i in v]}")
    print(f"  gallery: {len(ej['gallery'])} img")


if __name__ == "__main__":
    main()
