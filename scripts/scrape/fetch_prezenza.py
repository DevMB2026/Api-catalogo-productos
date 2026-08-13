"""
Extrae el catálogo de prezenza.com (WordPress + WooCommerce) usando las APIs
oficiales — NO raspa HTML frágil:

  1) Store API pública  /wp-json/wc/store/products   -> lista de productos
  2) JSON incrustado    data-product_variations       -> detalle por variación

Guarda el resultado CRUDO en data/prezenza-raw.json para verificarlo antes de
mapearlo al esquema de la API nueva. Sin credenciales. Es el propio sitio del
usuario y robots.txt permite el acceso.

  python scripts/scrape/fetch_prezenza.py
"""
import json
import re
import html
import time
import urllib.request
import urllib.error
import os

BASE = "https://prezenza.com"
STORE = BASE + "/wp-json/wc/store/products"
UA = "Mozilla/5.0 (compatible; PrezenzaCatalogMigration/1.0; +dev@prezenza.com)"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "prezenza-raw.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8"), dict(r.headers)


def fetch_all_products():
    """Pagina la Store API hasta traer todos los productos."""
    productos = []
    page = 1
    while True:
        body, headers = get(f"{STORE}?per_page=100&page={page}")
        lote = json.loads(body)
        if not lote:
            break
        productos.extend(lote)
        total = int(headers.get("X-WP-Total", len(productos)))
        print(f"  página {page}: +{len(lote)}  ({len(productos)}/{total})")
        if len(productos) >= total or len(lote) < 1:
            break
        page += 1
        time.sleep(0.4)  # cortesía
    return productos


def fetch_variations(permalink):
    """Extrae el JSON completo de variaciones incrustado en la página del producto.
    Devuelve [] si el producto es simple o si WooCommerce lo carga por AJAX."""
    try:
        htmltxt, _ = get(permalink)
    except urllib.error.HTTPError as e:
        print(f"    ! no se pudo abrir {permalink}: {e}")
        return []
    # atributo puede venir con comillas dobles o simples
    m = re.search(r'data-product_variations=(?:"([^"]*)"|\'([^\']*)\')', htmltxt)
    if not m:
        return []
    raw = m.group(1) if m.group(1) is not None else m.group(2)
    if raw.strip() in ("", "false", "true"):
        return []  # variaciones cargadas por AJAX (producto con muchas combinaciones)
    try:
        return json.loads(html.unescape(raw))
    except json.JSONDecodeError:
        return []


def main():
    print("1) Descargando lista de productos (Store API)…")
    productos = fetch_all_products()

    print(f"2) Descargando variaciones de {len(productos)} productos…")
    for i, p in enumerate(productos, 1):
        if p.get("type") == "variable" and p.get("permalink"):
            vs = fetch_variations(p["permalink"])
            p["_variations_full"] = vs
            print(f"  [{i}/{len(productos)}] {p['name'][:40]:<40} {len(vs)} variaciones")
            time.sleep(0.3)  # cortesía entre páginas
        else:
            p["_variations_full"] = []

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(productos, f, ensure_ascii=False, indent=2)
    print(f"\n✔ Guardado: {os.path.abspath(OUT)}  ({len(productos)} productos)")


if __name__ == "__main__":
    main()
