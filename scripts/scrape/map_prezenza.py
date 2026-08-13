"""
Mapea data/prezenza-raw.json (crudo de WooCommerce) al esquema de la API nueva.

Decisiones de mapeo (documentadas a propósito):
  - Colores (pa_colores)         -> Opción "Color" (tipo swatch)
  - Elije la talla (pa_elije...) -> Opción "Talla" (tipo size)
  - Selecciona Un Genero         -> campo `sexo` del producto (NO es un eje):
        MASCULINO -> hombre, FEMENINO -> mujer, ambos -> [hombre, mujer],
        sin atributo de género -> ["unisex"]
  - variants = producto cartesiano (Color x Talla) de los ejes presentes.
        WooCommerce suele dejar talla/genero en "cualquiera" y variar solo por
        color, así que expandimos todas las combinaciones que tu catálogo espera.
  - Imagen por color: se rescata de las variaciones incrustadas (cuando una
        variación fija solo el color) y se adjunta al valor de color y al media.
  - PRECIOS: OMITIDOS por completo, a pedido.
  - brand y category se guardan por NOMBRE/slug (no ObjectId); un import posterior
        los resuelve contra tu base. Se elige la categoría más específica (hoja).

  python scripts/scrape/map_prezenza.py
"""
import json
import re
import html
import os
from collections import Counter

RAW = os.path.join(os.path.dirname(__file__), "..", "..", "data", "prezenza-raw.json")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "prezenza-catalogo.json")

GENERO = {"masculino": "hombre", "femenino": "mujer"}


def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def tax_of(attr):
    """Clasifica un atributo WooCommerce por su taxonomía."""
    t = (attr.get("taxonomy") or "").lower()
    if "colores" in t:
        return "color"
    if "talla" in t:
        return "talla"
    if "genero" in t:
        return "genero"
    return "otro"


def color_images(prod):
    """slug_color -> url de imagen, tomada de las variaciones que fijan solo el color."""
    out = {}
    for v in prod.get("_variations_full", []):
        a = v.get("attributes", {})
        color = a.get("attribute_pa_colores") or ""
        talla = a.get("attribute_pa_elije-la-talla") or ""
        genero = a.get("attribute_pa_genero") or ""
        img = (v.get("image") or {}).get("src")
        if color and not talla and not genero and img and color not in out:
            out[color] = img
    return out


def pick_category(cats):
    """La categoría más específica (hoja): la de slug más largo / con enlace más profundo."""
    if not cats:
        return None
    return sorted(cats, key=lambda c: len((c.get("link") or "").rstrip("/").split("/")))[-1]


def map_product(prod):
    attrs = prod.get("attributes", [])
    by = {tax_of(a): a for a in attrs}

    # --- sexo (desde género) ---
    sexo = []
    if "genero" in by:
        for term in by["genero"]["terms"]:
            g = GENERO.get(term["slug"].lower())
            if g and g not in sexo:
                sexo.append(g)
    if not sexo:
        sexo = ["unisex"]

    # --- opciones (Color / Talla) ---
    imgs = color_images(prod)
    options = []
    color_vals = []
    if "color" in by:
        for t in by["color"]["terms"]:
            val = {"nombre": t["name"], "slug": t["slug"]}
            if t["slug"] in imgs:
                val["imagen"] = imgs[t["slug"]]
            color_vals.append(val)
        options.append({"nombre": "Color", "tipo": "swatch", "valores": color_vals})
    talla_vals = []
    if "talla" in by:
        talla_vals = [{"nombre": t["name"], "slug": t["slug"]} for t in by["talla"]["terms"]]
        options.append({"nombre": "Talla", "tipo": "size", "valores": talla_vals})

    # --- variantes: cartesiano de los ejes presentes ---
    base_sku = prod.get("sku") or prod["slug"].upper()
    ejes = []
    if color_vals:
        ejes.append([(v["nombre"], v["slug"], imgs.get(v["slug"])) for v in color_vals])
    if talla_vals:
        ejes.append([(v["nombre"], v["slug"], None) for v in talla_vals])

    variants = []
    def cartesian(pools):
        if not pools:
            return [[]]
        out = [[]]
        for pool in pools:
            out = [combo + [item] for combo in out for item in pool]
        return out

    for combo in cartesian(ejes):
        ov = [c[0] for c in combo]                 # nombres de valor (Color, Talla)
        sku_suffix = "-".join(c[1] for c in combo).upper()
        media = []
        for c in combo:
            if c[2]:  # imagen de color
                media.append({"url": c[2], "principal": True})
        variants.append({
            "optionValues": ov,
            "sku": f"{base_sku}-{sku_suffix}" if sku_suffix else base_sku,
            "stock": 0,
            "media": media,
        })

    # --- media a nivel producto ---
    media = []
    for i, im in enumerate(prod.get("images", [])):
        if im.get("src"):
            media.append({"url": im["src"], "alt": im.get("alt") or prod["name"], "principal": i == 0})

    cat = pick_category(prod.get("categories"))
    # Fallback: en el sitio, las camisas no traen categoría asignada, pero la
    # categoría "CAMISAS Y BLUSAS" (count=8) corresponde exactamente a los 8
    # productos "CAMISA …". Se infiere por nombre para no dejarlos sin categoría
    # (obligatoria en el modelo).
    if not cat and prod["name"].upper().startswith("CAMISA"):
        cat = {"name": "CAMISAS Y BLUSAS", "slug": "camisas"}
    brand = (prod.get("brands") or [{}])[0]

    return {
        "nombre": prod["name"],
        "sku": base_sku,
        "slug": prod["slug"],
        "descripcion": strip_html(prod.get("description")) or strip_html(prod.get("short_description")),
        "sexo": sexo,
        "brand": brand.get("name"),
        "brandSlug": brand.get("slug"),
        "categoria": cat.get("name") if cat else None,
        "categoriaSlug": cat.get("slug") if cat else None,
        "categoriasTodas": [c["name"] for c in prod.get("categories", [])],
        "attributes": [],  # EAV: los 3 atributos WC se mapearon a options/sexo
        "options": options,
        "variants": variants,
        "media": media,
        "destacado": False,
        "activo": True,
        "_origen": {"woo_id": prod["id"], "permalink": prod.get("permalink"),
                    "variaciones_reales": len(prod.get("_variations_full", []))},
    }


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    mapped = [map_product(p) for p in data]

    json.dump(mapped, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # Resumen
    print(f"Productos mapeados: {len(mapped)}")
    print(f"Guardado en: {os.path.abspath(OUT)}")
    print("\nMarcas encontradas:")
    for b, c in Counter(m["brand"] for m in mapped).most_common():
        print(f"  {b}: {c}")
    print("\nDistribución de sexo:")
    for s, c in Counter(tuple(m["sexo"]) for m in mapped).most_common():
        print(f"  {'+'.join(s)}: {c}")
    print(f"\nTotal de variantes generadas: {sum(len(m['variants']) for m in mapped)}")
    print("Ejemplo (primer producto):")
    ej = mapped[0]
    print(f"  {ej['nombre']} | {ej['brand']} | {ej['categoria']} | sexo={ej['sexo']}")
    print(f"  opciones={[o['nombre']+':'+str(len(o['valores'])) for o in ej['options']]} variantes={len(ej['variants'])} imgs={len(ej['media'])}")


if __name__ == "__main__":
    main()
