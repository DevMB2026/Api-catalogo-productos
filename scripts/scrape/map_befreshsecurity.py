"""
Mapea data/befreshsecurity-raw.json al esquema de la API (solo los 9 NUEVOS).
Reglas específicas de Be Fresh Security:
  - brand = Be Fresh Security (slug befreshsecurity).
  - categoría: INFERIDA por nombre (la Store API no la devuelve) -> categorías
    existentes: CHALECO*->chalecos, SUDADERA*->sudaderas, PLAYERA*->playeras,
    CAMISA*->camisas, PANTALON*->pantalones.
  - TALLAS normalizadas a español: L->G, XL->XG, 2XL->2XG, 3XL->3XG (CH/XCH/M/XXCH
    se quedan) para reutilizar los OptionValues ya normalizados y NO reintroducir 'L'.
  - sexo = [unisex] (todos son unisex, no hay atributo de género).
  - SKU: si viene vacío, se genera del slug.
  - Colores->Opción Color, tallas->Opción Talla, variants=cartesiano, imágenes por color.

  python scripts/scrape/map_befreshsecurity.py
"""
import json, re, html, os

RAW = os.path.join(os.path.dirname(__file__), "..", "..", "data", "befreshsecurity-raw.json")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "befreshsecurity-catalogo.json")

SIZE_ES = {"L": "G", "XL": "XG", "2XL": "2XG", "3XL": "3XG"}  # inglés -> español
CAT_BY_KW = [("CHALECO", "CHALECOS", "chalecos"), ("SUDADERA", "SUDADERAS", "sudaderas"),
             ("PLAYERA", "PLAYERAS", "playeras"), ("CAMISA", "CAMISAS Y BLUSAS", "camisas"),
             ("PANTALON", "PANTALONES", "pantalones")]


def strip_html(s):
    if not s: return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def signature(url):
    name = url.split("/")[-1].split("?")[0].lower()
    return re.sub(r"\.(jpe?g|png|webp|gif)", "", re.sub(r"-\d+x\d+", "", name))


def color_images(prod):
    out = {}
    for v in prod.get("_variations_full", []):
        a = v.get("attributes", {})
        color = a.get("attribute_pa_colores") or ""
        talla = a.get("attribute_pa_elije-la-talla") or ""
        img = (v.get("image") or {}).get("src")
        if color and not talla and img and color not in out:
            out[color] = img
    return out


def infer_cat(name):
    up = name.upper()
    for kw, nom, slug in CAT_BY_KW:
        if kw in up:
            return nom, slug
    return None, None


def norm_size(v):
    return SIZE_ES.get(v.strip().upper(), v.strip())


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    productos = []
    for p in data:
        by = {a.get("taxonomy"): a for a in p.get("attributes", [])}
        imgs = color_images(p)

        # opciones
        options, color_vals, talla_vals = [], [], []
        ca = by.get("pa_colores")
        if ca:
            for t in ca["terms"]:
                val = {"nombre": t["name"], "slug": t["slug"]}
                if t["slug"] in imgs: val["imagen"] = imgs[t["slug"]]
                color_vals.append(val)
            options.append({"nombre": "Color", "tipo": "swatch", "valores": color_vals})
        ta = by.get("pa_elije-la-talla")
        if ta:
            talla_vals = [{"nombre": norm_size(t["name"]), "slug": None} for t in ta["terms"]]
            options.append({"nombre": "Talla", "tipo": "size", "valores": talla_vals})

        base_sku = (p.get("sku") or "").strip() or p["slug"].upper()

        # variantes cartesianas
        ejes = []
        if color_vals: ejes.append([(v["nombre"], v.get("slug") or v["nombre"], imgs.get(v.get("slug"))) for v in color_vals])
        if talla_vals: ejes.append([(v["nombre"], v["nombre"], None) for v in talla_vals])

        def cartesian(pools):
            out = [[]]
            for pool in pools: out = [c + [x] for c in out for x in pool]
            return out

        from re import sub as _sub
        slugify = lambda s: _sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
        variants = []
        for combo in cartesian(ejes):
            ov = [c[0] for c in combo]
            suf = "-".join(slugify(c[1]) for c in combo).upper()
            media = [{"url": c[2], "principal": True} for c in combo if c[2]]
            variants.append({"optionValues": ov, "sku": f"{base_sku}-{suf}" if suf else base_sku,
                             "stock": 0, "media": media})

        nom, cslug = infer_cat(p["name"])
        media = [{"url": im["src"], "alt": im.get("alt") or p["name"], "principal": i == 0}
                 for i, im in enumerate(p.get("images", [])) if im.get("src")]

        productos.append({
            "nombre": p["name"], "sku": base_sku, "slug": p["slug"],
            "descripcion": strip_html(p.get("description")) or strip_html(p.get("short_description")),
            "sexo": ["unisex"], "brand": "Be Fresh Security", "brandSlug": "befreshsecurity",
            "categoria": nom, "categoriaSlug": cslug,
            "attributes": [], "options": options, "variants": variants, "media": media,
            "destacado": False, "activo": True,
            "_origen": {"woo_id": p["id"], "permalink": p.get("permalink")},
        })

    json.dump(productos, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Mapeados: {len(productos)}")
    print(f"Guardado: {os.path.abspath(OUT)}")
    for m in productos:
        talla = next((o for o in m["options"] if o["nombre"] == "Talla"), None)
        color = next((o for o in m["options"] if o["nombre"] == "Color"), None)
        print(f"  {m['nombre'][:32]:34} cat={m['categoriaSlug']:10} sku={m['sku'][:22]:24} "
              f"colores={len(color['valores']) if color else 0} tallas={[v['nombre'] for v in talla['valores']] if talla else []} vars={len(m['variants'])}")


if __name__ == "__main__":
    main()
