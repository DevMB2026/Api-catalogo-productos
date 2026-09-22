# Guía de integración — API de clientes

Consulta nuestro catálogo (Prezenza, Fit Be Fresh y Be Fresh Security) con **SKUs y tus precios**, en formato JSON, desde tu propio sistema.

- **URL base:** `https://api-catalogo-productos.onrender.com/api/v1`
- **Referencia completa (Swagger):** `https://api-catalogo-productos.onrender.com/api/v1/docs` → sección **Clientes**

## 1. Tu API Key

Te entregamos una llave que empieza con `cli_`. Envíala en **cada** petición en el header `X-API-Key`:

```bash
curl -H "X-API-Key: cli_TU_LLAVE" "https://api-catalogo-productos.onrender.com/api/v1/clientes/productos"
```

- Guárdala como una contraseña: solo en tu servidor, nunca en una página web, app pública o repositorio.
- Si se filtra o la pierdes, pídenos una nueva; la anterior deja de funcionar al instante.
- La llave es de **consulta**: no permite modificar nada.

## 2. Endpoints

| Método y ruta | Para qué |
|---|---|
| `GET /clientes/productos?page=1&limit=20` | Catálogo paginado (máx. 100 por página). Filtros opcionales: `brand` (`prezenza`, `fitbefresh`, `befreshsecurity`) y `q` (búsqueda de texto). |
| `GET /clientes/productos/{id}` | Un producto. |
| `GET /clientes/productos/sku/{sku}` | Buscar por SKU. Si es el SKU de una variante, `varianteEncontrada` indica color, talla y género. |
| `GET /clientes/productos/changes?since=…` | Solo lo que cambió desde tu última consulta (ver sección 4). |

## 3. Qué recibes

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a7decbd3d905ef7b12aab1b",
      "nombre": "CAMISA AMALFI",
      "sku": "TBLUAMAL-TCAMAMAL",
      "marca": { "nombre": "Prezenza", "slug": "prezenza" },
      "categoria": { "nombre": "Camisas", "slug": "camisas" },
      "genero": ["Dama", "Caballero"],
      "imagen": "https://…",
      "precios": { "menudeo": 315, "master": 258 },
      "rangos": { "menudeo": "1–30 pzas", "master": "precio especial" },
      "moneda": "MXN",
      "iva": "no incluido (precio + IVA)",
      "variantes": [
        {
          "color": "Azul Claro",
          "talla": "XCH",
          "skuInterno": "TBLUAMAL-TCAMAMAL-AZUL-CLARO-XCH",
          "skus": [
            { "sku": "BLUPPRZM65DLPOAAZLXC", "genero": "Dama" },
            { "sku": "CAMPPRZM65CLPOAAZLXC", "genero": "Caballero" }
          ]
        }
      ],
      "actualizado": "2026-09-22T22:10:58.926Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 49, "totalPages": 3 }
}
```

- **`precios`** trae solo los niveles de precio que tienes asignados (menudeo, mayoreo, volumen, distribuidor y/o master). Un nivel en `null` significa que ese producto aún no tiene ese precio.
- Los precios son **por pieza, en pesos mexicanos, más IVA**, y aplican a todas las tallas y colores del producto.
- **`rangos`** indica a cuántas piezas corresponde cada nivel según la marca.
- **`variantes`** vienen ordenadas por color y talla (XCH, CH, M, G, XG, 2XG … 5XG). En productos de dama y caballero, cada variante tiene un SKU por género.

## 4. Mantener tu sistema al día

1. **Primera carga:** llama `GET /clientes/productos/changes` **sin** `since`. Recibes todo el catálogo.
2. **Guarda** el `serverTime` de la respuesta.
3. **Después** (por ejemplo cada hora): llama `GET /clientes/productos/changes?since=<serverTime guardado>` y vuelve a guardar el nuevo `serverTime`.
4. Si la respuesta trae **`"hayMas": true`**, vuelve a llamar enseguida con el `serverTime` recibido, hasta que llegue `false`.

Qué hacer con cada producto recibido:

- `"activo": true` → **crear o reemplazar** el producto en tu sistema (trae datos, SKUs y precios actualizados).
- `"activo": false` → **quitarlo** (ya no se vende).
- Si llega `"resincronizacionCompleta": true`, cambiaron tus niveles de precio: reemplaza **todos** los precios que tengas guardados con los que acabas de recibir.

Un producto aparece en `changes` cuando cambian sus datos, sus SKUs **o su precio**.

## 5. Errores

Todas las respuestas de error tienen la forma `{ "success": false, "message": "…", "error": { "code": "…" } }`.

| HTTP | `code` | Qué significa |
|---|---|---|
| 401 | `API_KEY_REQUIRED` | No enviaste el header `X-API-Key`. |
| 401 | `API_KEY_INVALID` | La llave no es válida, fue revocada o la cuenta está desactivada. |
| 403 | `NO_PRICE_ACCESS` | Tu cuenta no tiene niveles de precio asignados. Contáctanos. |
| 404 | `PRODUCT_NOT_FOUND` | El producto o SKU no existe o ya no está activo. |
| 400 | `INVALID_ID` / `INVALID_SINCE` | El ID o la fecha `since` no tienen un formato válido. |
| 429 | `RATE_LIMITED` | Superaste el límite: **300 peticiones cada 15 minutos**. Espera y reintenta. |

## 6. Recomendaciones

- Usa `changes` para sincronizar; no descargues el catálogo completo en cada consulta.
- Identifica las variantes por su **SKU** (`skus[].sku`), no por el texto del color o la talla.
- Las imágenes son URLs públicas; puedes mostrarlas directamente o descargarlas.
- Para dudas o para solicitar una llave nueva, contacta a tu asesor.
