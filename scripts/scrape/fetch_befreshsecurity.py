"""
Extrae los 9 productos NUEVOS de befreshsecurity.com.
La Store API de listado está cacheada (devuelve siempre los mismos 10), pero el
endpoint POR-ID no lo está. Estrategia por producto:
  1) GET /producto/{slug}/  -> saca el product id (postid-XXXX)
  2) GET /wp-json/wc/store/products/{id}  -> datos limpios (estructurados)
  3) del HTML: data-product_variations -> imágenes por color (variaciones)

Guarda data/befreshsecurity-raw.json (misma forma que prezenza-raw.json).
  python scripts/scrape/fetch_befreshsecurity.py
"""
import json, re, html, time, os, urllib.request

BASE = "https://befreshsecurity.com"
UA = "Mozilla/5.0 (compatible; BFSCatalogMigration/1.0; +dev@prezenza.com)"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "befreshsecurity-raw.json")

# Los 9 productos NUEVOS (los 3 solapados NO se scrapean; solo se les añade marca/alias).
NUEVOS = [
    "sudadera-galaxy-unisex", "chaleco-brigadista-unisex", "playera-iron-manga-larga-unisex",
    "camisa-security-unisex-copia", "chaleco-alta-visibilidad-unisex", "chaleco-mexico-unisex",
    "sudadera-onix-unisex", "playera-versus-unisex", "camisa-security-unisex",
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def variations_from_html(htmltxt):
    m = re.search(r'data-product_variations=(?:"([^"]*)"|\'([^\']*)\')', htmltxt)
    if not m:
        return []
    raw = m.group(1) if m.group(1) is not None else m.group(2)
    if raw.strip() in ("", "false", "true"):
        return []
    try:
        return json.loads(html.unescape(raw))
    except json.JSONDecodeError:
        return []


def main():
    productos = []
    for i, slug in enumerate(NUEVOS, 1):
        page = get(f"{BASE}/producto/{slug}/")
        m = re.search(r"postid-(\d+)", page)
        if not m:
            print(f"  [{i}] {slug}: no encontré product id, salto")
            continue
        pid = m.group(1)
        prod = json.loads(get(f"{BASE}/wp-json/wc/store/products/{pid}"))
        prod["_variations_full"] = variations_from_html(page)
        productos.append(prod)
        print(f"  [{i}/9] {prod['name'][:38]:40} id={pid} sku={prod.get('sku','')[:20]:22} "
              f"attrs={[a['name'][:6] for a in prod.get('attributes',[])]} vars={len(prod['_variations_full'])} imgs={len(prod.get('images',[]))}")
        time.sleep(0.3)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(productos, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nGuardado: {os.path.abspath(OUT)} ({len(productos)} productos)")


if __name__ == "__main__":
    main()
