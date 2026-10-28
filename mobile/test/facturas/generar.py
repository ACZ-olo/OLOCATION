"""Facturas de prueba para el escaneo (OCR), con el mismo formato que las reales.

Cada factura se dibuja plana (como escaneada) y después se le aplica un efecto de "foto"
(inclinación, perspectiva, dobleces, sombra, desenfoque) para parecerse a lo que toma el teléfono.
Los datos son inventados. Uso (desde mobile/):  python test/facturas/generar.py
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent / "img"
W, H = 1700, 2200
INK = (28, 28, 28)
FONTS = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(FONTS + name, size)


ARIAL = lambda s: font("arial.ttf", s)
ARIAL_B = lambda s: font("arialbd.ttf", s)
TIMES = lambda s: font("times.ttf", s)
TIMES_B = lambda s: font("timesbd.ttf", s)
COLON = lambda s: font("ARIALUNI.TTF", s)  # tiene el signo ₡


def ring(d, cx, cy, r, width, color, gap=None):
    box = (cx - r, cy - r, cx + r, cy + r)
    if gap:
        d.arc(box, gap[1], gap[0] + 360, fill=color, width=width)
    else:
        d.ellipse(box, outline=color, width=width)


def logo(d, x, y, scale, color):
    ring(d, x, y, 34 * scale, int(18 * scale), color)
    ring(d, x + 62 * scale, y + 62 * scale, 52 * scale, int(28 * scale), color, gap=(200, 235))


def barcode(d, x0, y0, x1, y1, seed):
    rnd = random.Random(seed)
    x = x0
    while x < x1:
        w = rnd.choice([2, 2, 3, 4])
        if rnd.random() < 0.6:
            d.rectangle((x, y0, x + w - 1, y1), fill=INK)
        x += w + rnd.choice([1, 2, 3])


def fake_qr(d, x, y, size, seed):
    rnd = random.Random(seed)
    n = 29
    m = size / n
    for i in range(n):
        for j in range(n):
            if rnd.random() < 0.5:
                d.rectangle((x + i * m, y + j * m, x + (i + 1) * m - 1, y + (j + 1) * m - 1), fill=INK)
    for fx, fy in [(0, 0), (n - 7, 0), (0, n - 7)]:
        X, Y = x + fx * m, y + fy * m
        d.rectangle((X, Y, X + 7 * m, Y + 7 * m), fill="white")
        d.rectangle((X, Y, X + 7 * m - 1, Y + 7 * m - 1), outline=INK, width=int(m))
        d.rectangle((X + 2 * m, Y + 2 * m, X + 5 * m - 1, Y + 5 * m - 1), fill=INK)


def draw_invoice(f):
    """f: datos de la factura (ver SAMPLE). Devuelve la imagen plana."""
    img = Image.new("RGB", (W, H), (250, 250, 248))
    d = ImageDraw.Draw(img)
    t = lambda xy, s, fnt, **kw: d.text(xy, s, font=fnt, fill=kw.pop("fill", INK), **kw)

    # Marca de agua y logo
    logo(d, 800, 960, 2.6, (212, 212, 212))
    logo(d, 225, 165, 1.0, (45, 45, 45))

    # Encabezado del proveedor (igual en todas)
    t((780, 150), "CONSORCIO FERRETERO DE SAN JOSE", TIMES_B(30), anchor="mt")
    for i, s in enumerate([
        "Pozos de Santa Ana, 200 metros Este de la entrada principal de Hules Técnicos,",
        "Apdo.: 12247-1000, San José, Costa Rica",
        "Teléfono: 2205-2525, Fax: (506) 2205-2424, Cédula Jurídica No.: 3-101-096760-04",
    ]):
        t((770, 192 + i * 24), s, TIMES(18), anchor="mt")

    # Número de factura
    d.rounded_rectangle((1210, 160, 1570, 300), radius=18, outline=INK, width=3)
    t((1390, 172), "Factura Electrónica No:", ARIAL_B(26), anchor="mt")
    barcode(d, 1235, 212, 1545, 246, f["invoice_no"])
    t((1390, 252), f["invoice_no"], ARIAL(18), anchor="mt")

    # Recuadro del cliente
    d.rectangle((150, 315, 1560, 485), outline=INK, width=3)
    t((158, 325), "CODIGO:", ARIAL_B(19))
    t((300, 327), f["code"], ARIAL(19))
    t((158, 352), "NOMBRE:", ARIAL_B(19))
    t((300, 354), f["name"], ARIAL(19))
    t((158, 380), "DIRECCION:", ARIAL_B(19))
    t((158, 438), f["address"], ARIAL(19))
    t((830, 340), "TRAMITAR CONTRA ENTREGA", ARIAL(18))
    t((790, 413), "CONTRIBUYENTE:", ARIAL_B(19))
    t((1040, 415), f["taxid"], ARIAL(19))
    for i, (label, value) in enumerate([("FECHA:", f["date"]), ("TELEFONO:", f["phone"]),
                                        ("HORA:", f["time"]), ("VENCE:", f["due"])]):
        t((1255, 350 + i * 33), label, ARIAL_B(19))
        t((1405, 352 + i * 33), value, ARIAL(19))

    # Filas de datos de la entrega
    d.rectangle((160, 495, 1580, 540), outline=INK, width=2)
    cells = [(160, "VIA:", ""), (290, "ZONA:", f["zone"]), (460, "RUTA:", f["route"]), (590, "AUT:", ""),
             (720, "REQUIERE OC:", "N"), (895, "AGENTE No:", f["agent"]), (1050, "EMPACADOR:", "")]
    for x, label, value in cells:
        if x > 160:
            d.line((x, 495, x, 540), fill=INK, width=2)
        t((x + 6, 500), label, ARIAL_B(17))
        if value:
            t((x + 18 + d.textlength(label, font=ARIAL_B(17)), 501), value, ARIAL(18))
    t((1190, 500), "0205 ORDEN PREPARADA POR EFLOW-", ARIAL(18))
    t((1190, 520), "WMS", ARIAL(18))
    d.rectangle((150, 540, 1580, 575), outline=INK, width=2)
    for x in (390, 550, 1120, 1450):
        d.line((x, 540, x, 575), fill=INK, width=2)
    t((156, 547), "ORDEN DE COMPRA:", ARIAL_B(17))
    t((556, 547), "ORDEN DE PEDIDO:", ARIAL_B(17))
    t((735, 549), f["order"], ARIAL(18))
    t((1126, 547), "CONDICIONES DE PAGO:", ARIAL_B(17))
    t((1352, 549), "45 DIAS", ARIAL(17))
    t((1456, 547), "BULTOS:", ARIAL_B(17))
    t((1548, 549), str(len(f["items"]) // 2 + 1), ARIAL(17))

    # Productos
    d.rectangle((150, 585, 1565, 1540), outline=INK, width=3)
    d.line((150, 655, 1565, 655), fill=INK, width=2)
    t((185, 605), "CÓDIGO", ARIAL_B(20))
    t((640, 615), "DESCRIPCION", ARIAL_B(20), anchor="mt")
    t((960, 615), "CANTIDAD", ARIAL_B(20), anchor="mt")
    t((1095, 618), "DESC", ARIAL_B(20), anchor="mt")
    t((1240, 600), "PRECIO", ARIAL_B(20), anchor="mt")
    t((1240, 624), "UNITARIO", ARIAL_B(20), anchor="mt")
    t((1338, 620), "IVA", ARIAL_B(20), anchor="mt")
    t((1405, 620), "TARIFA", ARIAL_B(20), anchor="mt")
    t((1515, 605), "VALOR", ARIAL_B(20), anchor="mt")
    t((1515, 629), "TOTAL", ARIAL_B(20), anchor="mt")
    subtotal = 0
    for i, (code, desc, qty, price) in enumerate(f["items"]):
        y = 668 + i * 26
        total = qty * price
        subtotal += total
        t((185, y), code, ARIAL(17))
        t((335, y), desc, ARIAL(17))
        t((1010, y), f"{qty:.2f}", ARIAL(17), anchor="ra")
        t((1100, y), "0%", ARIAL(17), anchor="ra")
        t((1260, y + 3), money(price), ARIAL(17), anchor="ra")
        t((1330, y + 3), "01", ARIAL(17))
        t((1395, y + 3), "08", ARIAL(17))
        t((1555, y + 5), money(total), ARIAL(17), anchor="ra")

    # Observaciones (abajo a la izquierda)
    d.rectangle((95, 1540, 1225, 1820), outline=INK, width=3)
    t((115, 1556), "Observaciones", ARIAL(21))
    for i, line in enumerate(f["notes"]):
        t((112, 1590 + i * 28), line, TIMES(23))
    for i, s in enumerate([
        "LOS DOCUMENTOS VENCIDOS OCASIONAN LA RETENCION DE FUTUROS PEDIDOS. ESTIMADO CLIENTE LE",
        "RECORDAMOS REVISAR LA MERCADERIA RECIBIDA, ANTES DE FIRMAR LA FACTURA EN SEÑAL DE RECIBIDO",
        "CONFORME. DESPUES DE 72 HORAS NO SE ACEPTAN RECLAMOS. DEPOSITOS EN LAS CUENTAS:",
    ]):
        t((665, 1700 + i * 23), s, TIMES(19), anchor="mt")
    t((665, 1778), "BAC 901864751   SCOTIA 302609500   BNCR 100-01-000-154878-3   BCR 001-0124979-7   "
                   "DAVI 91422014531   BCT 4862", TIMES_B(18), anchor="mt")

    # Totales (a la derecha de las observaciones)
    d.rectangle((1225, 1540, 1580, 1820), outline=INK, width=3)
    d.line((1233, 1540, 1233, 1820), fill=INK, width=2)
    tax = subtotal * 0.13
    for i, (label, value) in enumerate([("SUBTOTAL", subtotal), ("DESCUENTO1", 0), ("DESCUENTO2", 0),
                                        ("DESCUENTO3", 0), ("DESCUENTO4", 0), ("IMPUESTO", tax)]):
        y = 1556 + i * 34
        t((1245, y), label, ARIAL_B(21))
        t((1420, y - 2), "₡", COLON(22))
        t((1560, y), money(value), ARIAL(21), anchor="ra")
    t((1245, 1778), "TOTAL", ARIAL_B(21))
    t((1420, 1776), "₡", COLON(22))
    t((1560, 1778), money(subtotal + tax), ARIAL(21), anchor="ra")
    t((1585, 1828), "E: Excento. Descuento1: Descuento Línea. Descuento2: Bonificación,Descuento3: "
                    "Descuento Factura,Descuento4: Descuento Factura.", TIMES(14), anchor="ra")

    # Clave y pie
    d.rectangle((105, 1850, 1585, 2150), outline=INK, width=3)
    t((600, 1890), "Clave del Comprobante", TIMES_B(25), anchor="mt")
    t((600, 1945), f["key"], TIMES(21), anchor="mt")
    fake_qr(d, 1400, 1868, 175, f["key"])
    t((115, 2070), "Emitida conforme lo establecido en la resolución de Facturación Electrónica,", ARIAL(22))
    t((115, 2100), "No. DGT-R-48-2016 del siete de octubre de dos mil dieciséis de la Dirección General de "
                   "Tributación.", ARIAL(22))
    t((1430, 2108), "Página     1/1", TIMES(22))
    t((W // 2, 2168), "DOCUMENTO DE PRUEBA · OLOCATION · NO VÁLIDO", ARIAL(14), fill=(150, 150, 150),
      anchor="mt")
    return img


def money(v):
    whole, dec = f"{v:.2f}".split(".")
    return f"{int(whole):,}".replace(",", " ") + "." + dec


# --- Efecto de foto ---------------------------------------------------------------------------

def solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                k = m[r][c] / m[c][c]
                m[r] = [x - k * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def perspective_coeffs(dst, src):
    """Coeficientes para Image.transform: cada punto de `dst` (salida) toma el de `src`."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return solve(a, b)


def photo(img, seed=1, tilt=1.5, blur=1.2, dark=0.25, folds=True, crop_bottom=0):
    """La factura plana como si la hubieran fotografiado sobre una mesa."""
    rnd = random.Random(seed)
    paper = img.copy()
    d = ImageDraw.Draw(paper, "RGBA")
    if folds:  # dobleces del papel (la factura viene doblada en tres)
        for y in (int(H * 0.36), int(H * 0.69)):
            for k in range(14):
                d.line((0, y + k, W, y + k + rnd.randint(-6, 6)), fill=(0, 0, 0, max(0, 22 - k * 2)))
    # Luz pareja arriba a la izquierda, más oscuro abajo a la derecha
    shade = Image.new("L", (2, 2))
    shade.putdata([255, 235, 225, 255 - int(255 * dark)])
    shade = shade.resize((W, H), Image.BILINEAR)
    paper = Image.composite(paper, Image.new("RGB", (W, H), (120, 120, 125)), shade)

    out_w, out_h = 1800, 2400  # resolución parecida a la de una foto de teléfono
    margin = 100
    j = lambda s: rnd.uniform(-s, s)
    # Esquinas de la hoja en la foto (un poco en trapecio, como sacada de pie)
    corners = [(margin + 15 + j(20), margin + j(15)), (out_w - margin + 10 + j(20), margin + 20 + j(15)),
               (out_w - margin - 15 + j(20), out_h - margin + 15 + j(15)),
               (margin - 10 + j(20), out_h - margin + j(15))]
    ang = math.radians(tilt)
    cx, cy = out_w / 2, out_h / 2
    corners = [(cx + (x - cx) * math.cos(ang) - (y - cy) * math.sin(ang),
                cy + (x - cx) * math.sin(ang) + (y - cy) * math.cos(ang)) for x, y in corners]
    coeffs = perspective_coeffs(corners, [(0, 0), (W, 0), (W, H), (0, H)])
    table = Image.new("RGB", (out_w, out_h), (214, 211, 206))
    warped = paper.transform((out_w, out_h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (W, H), 255).transform((out_w, out_h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    table.paste(warped, (0, 0), mask)
    if crop_bottom:  # la foto no agarró la parte de abajo de la hoja
        table = table.crop((0, 0, out_w, out_h - crop_bottom))
    return table.filter(ImageFilter.GaussianBlur(blur))


def pen_circle(img, box):
    """Círculo de lapicero encima de las observaciones (como en las facturas reales)."""
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    for k, off in enumerate((0, 5, -4)):
        d.arc((x0 + off, y0 - off, x1 - off, y1 + off), 200 + k * 25, 200 + k * 25 + 340,
              fill=(60, 60, 75), width=3)


SAMPLE = dict(
    invoice_no="00100001010000724518",
    code="020310477",
    name="AGROSERVICIOS EL LLANO S.A",
    address="HEREDIA, SARAPIQUI, PUERTO VIEJO 100 M SUR DEL BANCO NACIONAL, ND",
    taxid="3101452280",
    date="14-10-2026", phone="27661204", time="09:42:51", due="28-11-2026",
    zone="Z204", route="11", agent="204", order="PEDFR204007315",
    items=[("7060005", 'Conector de presión EMT 1 1/4" UL 654S-SUB Topaz', 12, 597.12),
           ("7502488", "Socket/intemperie 1045 Eagle (200)", 30, 653.40),
           ("7104410", 'Tubo EMT 3/4" x 3 m galvanizado', 25, 2115.00)],
    notes=["Cargado de FR - OC 61204ENTREGAR EN LA VIRGEN"],
    key="50614102600310109676000100001010000724518105101426",
)

CLIENTS = {
    "llano": dict(code="020310477", name="AGROSERVICIOS EL LLANO S.A",
                  address="HEREDIA, SARAPIQUI, PUERTO VIEJO 100 M SUR DEL BANCO NACIONAL, ND"),
    "pital": dict(code="020215532", name="FERRETERIA LA COSECHA DEL NORTE S.A",
                  address="ALAJUELA, SAN CARLOS, PITAL CONTIGUO A LA PLAZA DE DEPORTES, ND"),
    "guapiles": dict(code="030118094", name="MATERIALES Y CONSTRUCCION CARIBE LTDA",
                     address="LIMON, POCOCI, GUAPILES 300 M ESTE DEL HOSPITAL, ND"),
    "liberia": dict(code="050402316", name="DEPOSITO EL GUANACASTE S.A",
                    address="GUANACASTE, LIBERIA, BARRIO LA VICTORIA FRENTE AL SUPER, ND"),
}

NOTE_1 = "Cargado de FR - OC 61204ENTREGAR EN LA VIRGEN"
NOTE_LONG = "ENTREGAR EN BODEGA CENTRAL RUTA 32, RECIBE DON CARLOS ANTES DE LA HORA DE ALMUERZO"
NOTE_2 = ["Cargado de FR - OC 60877 ENTREGAR EN GUAPILES,", "FRENTE A LA ESCUELA LIDER, PORTON VERDE"]
NOTE_DIR = "ENTREGAR EN PITAL, DIRECCION: 200 M NORTE DE LA IGLESIA CATOLICA"

# Cada caso: datos de la factura, efecto de foto y lo que se espera leer.
# En "esperado", una lista es el conjunto de resultados aceptables ("" = quedó vacío, que es válido
# cuando la foto es mala: lo importante es que no invente). "ok" es lo que debe dar invoiceReadOk.
CASES = [
    dict(id="01_obs_un_renglon", client="llano", notes=[NOTE_1],
         expect=dict(notes=NOTE_1)),
    dict(id="02_obs_larga_ruta_hora", client="pital", notes=[NOTE_LONG],
         expect=dict(notes=NOTE_LONG)),
    dict(id="03_obs_dos_renglones", client="guapiles", notes=NOTE_2,
         expect=dict(notes=" ".join(NOTE_2))),
    dict(id="04_sin_observaciones", client="liberia", notes=[],
         expect=dict(notes="Sin observaciones")),
    dict(id="05_obs_con_lapicero", client="pital", notes=["Cargado de FR - OC 60516ENTREGAR EN PITAL"], pen=True,
         expect=dict(notes=["Cargado de FR - OC 60516ENTREGAR EN PITAL", ""])),
    dict(id="06_obs_con_direccion", client="pital", notes=[NOTE_DIR],
         expect=dict(notes=NOTE_DIR)),
    dict(id="07_codigo_8_digitos", client="llano", notes=[NOTE_1], code="02031047",
         expect=dict(code="", notes=NOTE_1, ok=False)),
    dict(id="08_codigo_10_digitos", client="llano", notes=[NOTE_1], code="0203104771",
         expect=dict(code="", notes=NOTE_1, ok=False)),
    dict(id="09_codigo_con_letras", client="liberia", notes=[], code="O5O4O2316",
         expect=dict(code="050402316", notes="Sin observaciones")),
    dict(id="10_codigo_partido", client="guapiles", notes=NOTE_2, code="0301 18094",
         expect=dict(code="030118094", notes=" ".join(NOTE_2))),
    dict(id="11_codigo_con_guiones", client="pital", notes=[NOTE_DIR], code="020-215-532",
         expect=dict(code="020215532", notes=NOTE_DIR)),
    dict(id="12_foto_borrosa", client="llano", notes=[NOTE_1], photo=dict(blur=3.3),
         expect=dict(code=["020310477", ""], name=None, address=None, notes=[NOTE_1, ""], ok=None)),
    dict(id="13_foto_oscura", client="guapiles", notes=NOTE_2, photo=dict(dark=0.65),
         expect=dict(notes=[" ".join(NOTE_2), ""])),
    dict(id="14_foto_muy_inclinada", client="liberia", notes=[], photo=dict(tilt=5),
         expect=dict(notes=["Sin observaciones", ""])),
    dict(id="15_foto_cortada_abajo", client="pital", notes=[NOTE_DIR], photo=dict(crop_bottom=720),
         expect=dict(notes="")),
    dict(id="16_sin_obs_borrosa", client="llano", notes=[], photo=dict(blur=3.0, dark=0.45),
         expect=dict(code=["020310477", ""], name=None, address=None, notes=["Sin observaciones", ""], ok=None)),
]


def build(case, seed):
    client = CLIENTS[case["client"]]
    rnd = random.Random(seed)
    data = dict(SAMPLE, **client, notes=case["notes"])
    data["code"] = case.get("code", client["code"])
    data["invoice_no"] = f"0010000101000{rnd.randint(7000000, 7999999)}"
    data["key"] = "5061410260031010967600010000101" + "".join(rnd.choice("0123456789") for _ in range(19))
    data["date"] = f"{rnd.randint(1, 28):02d}-10-2026"
    flat = draw_invoice(data)
    if case.get("pen"):
        pen_circle(flat, (95, 1575, 700, 1640))
    opts = dict(seed=seed, tilt=rnd.uniform(-2, 2))
    opts.update(case.get("photo", {}))
    expect = dict(code=client["code"], name=client["name"], address=client["address"], ok=True)
    expect.update(case["expect"])
    return photo(flat, **opts), expect


if __name__ == "__main__":
    import json

    OUT.mkdir(exist_ok=True)
    flat = draw_invoice(SAMPLE)
    flat.save(OUT / "muestra_plana.png")
    photo(flat, seed=3).save(OUT / "muestra_foto.jpg", quality=85)
    cases = []
    for i, case in enumerate(CASES):
        img, expect = build(case, seed=100 + i)
        img.save(OUT / f"{case['id']}.jpg", quality=85)
        cases.append(dict(file=f"{case['id']}.jpg", expect=expect))
    (OUT.parent / "casos.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(cases)} facturas en {OUT}")
