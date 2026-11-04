"""Facturas planas (como la muestra_plana.png, sin efecto de foto) para probar la app completa.

Cada factura tiene datos distintos: cliente, número, clave, fecha, productos, zona, ruta, etc.
Incluye clientes nuevos, clientes repetidos (para ver "ya estaba registrado"), observaciones con y
sin dirección, sin observaciones y facturas con un campo obligatorio mal (para ver el aviso).
Los datos son inventados. Uso (desde mobile/):  python test/facturas/generar_planas.py
Salida: ../facturas-ejemplo/planas/*.png y LEEME.md con lo que se espera de cada una.
"""
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generar import ARIAL, draw_invoice  # noqa: E402
from PIL import ImageDraw  # noqa: E402

OUT = Path(__file__).resolve().parents[3] / "facturas-ejemplo" / "planas"

PRODUCTS = [
    ("7060005", 'Conector de presión EMT 1 1/4" UL 654S-SUB Topaz', 597.12),
    ("7502488", "Socket/intemperie 1045 Eagle (200)", 653.40),
    ("7104410", 'Tubo EMT 3/4" x 3 m galvanizado', 2115.00),
    ("1203317", "Cemento gris uso general 50 kg", 6150.00),
    ("1208840", "Varilla corrugada #3 grado 40 x 6 m", 2380.50),
    ("1301122", "Block de concreto 12x20x40 cm", 495.00),
    ("2405519", "Lámina de zinc HG #28 x 3.66 m", 9875.00),
    ("2410073", "Clavo para zinc 2 1/2\" (caja 1 kg)", 1890.00),
    ("3102284", "Tubo PVC presión SDR 26 1/2\" x 6 m", 3245.75),
    ("3102291", "Codo PVC 1/2\" x 90° liso", 145.20),
    ("3107760", "Pegamento PVC 1/4 galón regular", 5630.00),
    ("3215508", "Llave de chorro 1/2\" bronce", 3990.00),
    ("4011176", "Cable THHN #12 AWG rojo (rollo 100 m)", 38950.00),
    ("4011183", "Cable THHN #12 AWG negro (rollo 100 m)", 38950.00),
    ("4020347", "Tomacorriente doble polarizado blanco", 1475.00),
    ("4025581", "Interruptor sencillo 15 A blanco", 1120.00),
    ("4103329", "Centro de carga 8 espacios superficial", 24600.00),
    ("4107715", "Breaker 1 polo 20 A enchufable", 3880.00),
    ("5002261", "Pintura látex blanco hueso cubeta 5 gal", 42500.00),
    ("5002278", "Pintura anticorrosiva negro mate galón", 14250.00),
    ("5011094", "Rodillo antigota 9\" con marco", 3175.00),
    ("5013320", "Brocha de cerda natural 3\"", 1950.00),
    ("6004417", "Tornillo gypsum 6 x 1\" (bolsa 100)", 1340.00),
    ("6008852", "Lámina gypsum regular 1/2\" 1.22x2.44", 7890.00),
    ("6012235", "Perfil galvanizado 3 5/8\" x 3.05 m", 2645.00),
    ("6101908", "Malla electrosoldada 15x15 cm 2.35x6 m", 18350.00),
    ("7203341", "Cinta aislante negra 3/4\" x 20 m", 790.00),
    ("7305572", "Manguera jardín 1/2\" x 15 m reforzada", 8450.00),
    ("8001163", "Pala redonda mango largo", 6980.00),
    ("8002240", "Carretilla 5 pies³ llanta neumática", 46900.00),
    ("8010095", "Machete 22\" con funda", 4520.00),
    ("8104476", "Candado de bronce 40 mm", 5275.00),
    ("8120318", "Bisagra de libro 3\" (par) acero", 865.00),
    ("9003317", "Disco de corte metal 4 1/2\" x 1 mm", 1060.00),
    ("9008874", "Broca para concreto 3/8\" x 6\"", 2210.00),
    ("9105526", "Silicón transparente uso general 280 ml", 2985.00),
    ("9201147", "Alambre negro de amarre #16 (kg)", 1415.00),
    ("9301183", "Sacos de arena fina (m³)", 15800.00),
]

# Cada caso: cliente + observaciones + lo que se espera al escanear.
# notes: lista de renglones ([] = recuadro vacío → "Sin observaciones").
CASES = [
    dict(id="01_nuevo_obs_con_direccion", code="050105871", name="FERRETERIA EL POCHOTE S.A",
         address="GUANACASTE, NICOYA, NICOYA 150 M OESTE DEL PARQUE CENTRAL, ND",
         notes=["ENTREGAR EN NOSARA, 300 M SUR DE LA PLAZA DE DEPORTES"],
         expect="Cliente nuevo. Ubicación - Observaciones: dirección en Nosara."),
    dict(id="02_nuevo_obs_entregar_en_lugar", code="010915420",
         name="AGROVETERINARIA EL VALLE S.A",
         address="SAN JOSE, PEREZ ZELEDON, SAN ISIDRO DE EL GENERAL 75 M NORTE DE LA CATEDRAL, ND",
         notes=["Cargado de FR - OC 61877 ENTREGAR EN PLATANARES"],
         expect="Cliente nuevo. Entregar en: PLATANARES."),
    dict(id="03_nuevo_sin_observaciones", code="030502219",
         name="MATERIALES DE CONSTRUCCION TURRIALBA LTDA",
         address="CARTAGO, TURRIALBA, TURRIALBA BARRIO EL CARMEN 200 M ESTE DEL BANCO POPULAR, ND",
         notes=[], terms="CONTADO",
         expect="Cliente nuevo. Observaciones: Sin observaciones."),
    dict(id="04_nuevo_obs_dos_renglones", code="020117763", name="DEPOSITO Y FERRETERIA LA FORTUNA S.A",
         address="ALAJUELA, SAN CARLOS, LA FORTUNA 100 M NORTE DE LA IGLESIA, ND",
         notes=["Cargado de FR - OC 62015 ENTREGAR EN EL TANQUE,", "DEL CEMENTERIO 400 M OESTE, BODEGA AZUL"],
         expect="Cliente nuevo. Observaciones de dos renglones unidas; dirección en El Tanque."),
    dict(id="05_nuevo_obs_sin_direccion_telefono", code="060602140", name="FERRETERIA Y MADERAS QUEPOS S.A",
         address="PUNTARENAS, QUEPOS, QUEPOS CONTIGUO A LA TERMINAL DE BUSES, ND",
         notes=["LLAMAR AL 8812-4470 ANTES DE ENTREGAR"],
         expect="Cliente nuevo. Observaciones sin dirección → 'Sin dirección en observaciones'."),
    dict(id="06_nuevo_obs_con_senas", code="021303398", name="ALMACEN AGRICOLA UPALA S.A",
         address="ALAJUELA, UPALA, UPALA 50 M SUR DEL HOSPITAL, ND",
         notes=["ENTREGAR EN BIJAGUA, FRENTE AL SUPER LA AMISTAD, PORTON NEGRO"],
         expect="Cliente nuevo. Dirección en Bijagua."),
    dict(id="07_nuevo_obs_pago", code="021202657", name="CONSTRUCENTRO SARCHI LTDA",
         address="ALAJUELA, SARCHI, SARCHI NORTE 200 M OESTE DE LA CARRETA MONUMENTAL, ND",
         notes=["PAGO CONTRA ENTREGA, SOLO EFECTIVO O SINPE"], terms="CONTADO",
         expect="Cliente nuevo. Observaciones sin dirección."),
    dict(id="08_nuevo_nombre_con_enie", code="021001845", name="FERRETERIA PEÑAS BLANCAS S.A",
         address="ALAJUELA, SAN RAMON, PEÑAS BLANCAS 300 M ESTE DE LA ESCUELA, ND",
         notes=[],
         expect="Cliente nuevo con Ñ en nombre y dirección. Sin observaciones."),
    dict(id="09_nuevo_obs_finca_km", code="070103319", name="AGROSERVICIOS DEL ATLANTICO S.A",
         address="LIMON, LIMON, RIO BLANCO 100 M NORTE DE LA ESCUELA, ND",
         notes=["ENTREGAR EN FINCA LA ESTRELLA, KM 12 CARRETERA A VALLE LA ESTRELLA"],
         expect="Cliente nuevo. Dirección en Valle La Estrella."),
    dict(id="10_nuevo_obs_solo_orden", code="020504466", name="FERRETERIA ATENAS CENTRO S.A",
         address="ALAJUELA, ATENAS, ATENAS 25 M SUR DEL MERCADO MUNICIPAL, ND",
         notes=["Cargado de FR - OC 61530"],
         expect="Cliente nuevo. Observaciones solo con la orden → sin dirección."),
    dict(id="11_nuevo_obs_dos_renglones_recibe", code="060702915",
         name="MULTISERVICIOS FERRETEROS DEL SUR LTDA",
         address="PUNTARENAS, GOLFITO, GOLFITO DEPOSITO LIBRE LOCAL 14, ND",
         notes=["ENTREGAR EN RIO CLARO, 200 M NORTE DE LA BOMBA,", "RECIBE DOÑA MARIELA, HORARIO DE 8 A 12"],
         expect="Cliente nuevo. Dos renglones; dirección en Río Claro."),
    dict(id="12_nuevo_obs_horario", code="020305512", name="MATERIALES EL MIRADOR DE GRECIA S.A",
         address="ALAJUELA, GRECIA, SAN ISIDRO 400 M OESTE DEL TEMPLO CATOLICO, ND",
         notes=["NO RECIBEN LOS SABADOS"], terms="30 DIAS",
         expect="Cliente nuevo. Observaciones sin dirección."),
    dict(id="13_nuevo_canas_sin_obs", code="050601287", name="FERRETERIA CAÑAS DEL TEMPISQUE S.A",
         address="GUANACASTE, CAÑAS, CAÑAS 100 M ESTE DEL PARQUE, ND",
         notes=[],
         expect="Cliente nuevo. Sin observaciones."),
    dict(id="14_nuevo_obs_casa_porton", code="010403670", name="DEPOSITO DE MATERIALES PURISCAL S.A",
         address="SAN JOSE, PURISCAL, SANTIAGO 300 M NORTE DE LA CRUZ ROJA, ND",
         notes=["ENTREGAR EN BARBACOAS, CASA ESQUINERA PORTON CAFE"],
         expect="Cliente nuevo. Dirección en Barbacoas."),
    dict(id="15_nuevo_obs_orden_y_lugar", code="060901134", name="AGROINSUMOS PARRITA LTDA",
         address="PUNTARENAS, PARRITA, PARRITA FRENTE A LA PLAZA, ND",
         notes=["Cargado de FR - OC 62290 ENTREGAR EN PALO SECO"], terms="30 DIAS",
         expect="Cliente nuevo. Entregar en: PALO SECO."),
    dict(id="16_nuevo_muchos_productos", code="050304421", name="FERRETERIA SANTA CRUZ GUANACASTE S.A",
         address="GUANACASTE, SANTA CRUZ, SANTA CRUZ 200 M SUR DEL ESTADIO, ND",
         notes=["DESCARGAR POR EL PORTON DE ATRAS, SOLO CAMION PEQUEÑO"], items=14,
         expect="Cliente nuevo con 14 productos (la tabla no debe confundir al lector)."),
    dict(id="17_nuevo_heredia_bodega", code="040802231", name="FERRETERIA LOS ANGELES DE SAN PABLO S.A",
         address="HEREDIA, SAN PABLO, RINCON DE SABANILLA 100 M OESTE DE LA ESCUELA, ND",
         notes=["ENTREGAR EN BODEGA DE BARVA, 50 M SUR DEL CEMENTERIO DE SAN PEDRO"],
         expect="Cliente nuevo. Dirección en Barva."),
    dict(id="18_nuevo_obs_persona", code="030301588", name="MADERAS Y FERRETERIA LA UNION LTDA",
         address="CARTAGO, LA UNION, TRES RIOS 200 M NORTE DE LA IGLESIA, ND",
         notes=["ENTREGAR ANTES DE LAS 10 AM, PREGUNTAR POR JORGE"],
         expect="Cliente nuevo. Observaciones sin dirección."),
    dict(id="19_nuevo_nombre_largo", code="011802744", name="DISTRIBUIDORA HERMANOS QUESADA ROJAS S.A",
         address="SAN JOSE, DESAMPARADOS, SAN MIGUEL CALLE FALLAS 600 M SUR DE LA IGLESIA CATOLICA, ND",
         notes=["Cargado de FR - OC 62411 ENTREGAR EN EL ROSARIO DE DESAMPARADOS"],
         expect="Cliente nuevo con nombre y dirección largos."),
    # Clientes repetidos: escanear DESPUÉS de su factura original.
    dict(id="20_repetido_turrialba_otra_obs", code="030502219",
         name="MATERIALES DE CONSTRUCCION TURRIALBA LTDA",
         address="CARTAGO, TURRIALBA, TURRIALBA BARRIO EL CARMEN 200 M ESTE DEL BANCO POPULAR, ND",
         notes=["ENTREGAR EN SANTA ROSA DE TURRIALBA, 100 M ESTE DEL PUENTE"],
         expect="Mismo código que la 03 → 'Este cliente ya estaba registrado' (no crea otro)."),
    dict(id="21_repetido_upala_igual", code="021303398", name="ALMACEN AGRICOLA UPALA S.A",
         address="ALAJUELA, UPALA, UPALA 50 M SUR DEL HOSPITAL, ND",
         notes=["ENTREGAR EN BIJAGUA, FRENTE AL SUPER LA AMISTAD, PORTON NEGRO"],
         expect="Mismo cliente y observaciones que la 06 (otra factura) → ya estaba registrado."),
    # Campo obligatorio mal: no registra nada y pide otra foto diciendo qué falta.
    dict(id="22_error_sin_nombre", code="040105528", name="",
         address="HEREDIA, SAN RAFAEL, CONCEPCION 200 M NORTE DEL SALON COMUNAL, ND",
         notes=["Cargado de FR - OC 62503"],
         expect="Aviso: no se pudo leer el nombre. No registra."),
    dict(id="23_error_sin_direccion", code="040301976", name="FERRETERIA SANTO DOMINGO S.A", address="",
         notes=[],
         expect="Aviso: no se pudo leer la dirección. No registra."),
    dict(id="24_error_codigo_8_digitos", code="01070215", name="FERRETERIA DESAMPARADOS NORTE S.A",
         address="SAN JOSE, DESAMPARADOS, DESAMPARADOS 100 M OESTE DEL MERCADO, ND",
         notes=["ENTREGAR EN BODEGA PRINCIPAL"],
         expect="Aviso: no se pudo leer el código (tiene 8 números). No registra."),
]

ZONES = ["Z101", "Z118", "Z204", "Z215", "Z307", "Z322", "Z410", "Z503", "Z516", "Z602", "Z611", "Z705"]
TERM_DAYS = {"45 DIAS": 45, "30 DIAS": 30, "CONTADO": 0}


def money_ok(img, text, x, limit):
    """Avisa si un texto se sale de su espacio (se enciman los campos)."""
    w = ImageDraw.Draw(img).textlength(text, font=ARIAL(19))
    if x + w > limit:
        print(f"  ! texto largo ({int(x + w)} > {limit}): {text}")


def build(case, i):
    rnd = random.Random(500 + i)
    day = date(2026, 10, 1) + timedelta(days=rnd.randint(0, 33))
    terms = case.get("terms", "45 DIAS")
    invoice_no = f"0010000101000{7240000 + i * 1371 + rnd.randint(0, 900)}"
    key = ("506" + day.strftime("%d%m%y") + "003101096760" + invoice_no + "1"
           + "".join(rnd.choice("0123456789") for _ in range(8)))
    picked = rnd.sample(PRODUCTS, case.get("items", rnd.randint(2, 7)))
    # El total (con impuesto) queda por debajo del millón: más largo se encima con el signo ₡.
    cap = 850000 / (len(picked) * 1.13)
    qtys = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 40, 50]
    items = [(c, d, rnd.choice([q for q in qtys if q * p <= cap] or [1]), p) for c, d, p in picked]
    zone = rnd.choice(ZONES)
    data = dict(
        invoice_no=invoice_no, code=case["code"], name=case["name"], address=case["address"],
        taxid=f"3{rnd.choice(['101', '102'])}{rnd.randint(100000, 999999)}",
        date=day.strftime("%d-%m-%Y"), phone=f"{rnd.choice([2, 2, 4, 8])}{rnd.randint(1000000, 9999999)}",
        time=f"{rnd.randint(7, 16):02d}:{rnd.randint(0, 59):02d}:{rnd.randint(0, 59):02d}",
        due=(day + timedelta(days=TERM_DAYS[terms])).strftime("%d-%m-%Y"),
        zone=zone, route=str(rnd.randint(1, 48)), agent=str(rnd.randint(101, 640)),
        order=f"PEDFR{zone[1:]}{rnd.randint(0, 999999):06d}",
        items=items, notes=case["notes"], key=key, terms=terms,
    )
    img = draw_invoice(data)
    money_ok(img, case["name"], 300, 825)
    money_ok(img, case["address"], 158, 1245)
    return img, data


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows, cases = [], []
    for i, case in enumerate(CASES):
        print(case["id"])
        img, data = build(case, i)
        img.save(OUT / f"{case['id']}.png", optimize=True)
        notes = " ".join(case["notes"]) or "Sin observaciones"
        code = case["code"] if len(case["code"]) == 9 else ""
        missing = [m for m, v in (("código", code), ("nombre", case["name"]), ("dirección", case["address"]))
                   if not v]
        expect = dict(code=code, name=case["name"], address=case["address"], notes=notes, ok=not missing)
        if missing:
            expect["missing"] = missing
        cases.append(dict(file=f"{case['id']}.png", expect=expect))
        rows.append(f"| {case['id']}.png | {case['code'] or '—'} | {case['name'] or '(vacío)'} | "
                    f"{notes} | {case['expect']} |")
    (OUT / "LEEME.md").write_text(
        "# Facturas planas de prueba\n\n"
        "Generadas con `mobile/test/facturas/generar_planas.py` (datos inventados, mismo formato que\n"
        "`muestra_plana.png`). Escanearlas en orden: la 20 y la 21 repiten clientes de la 03 y la 06.\n\n"
        "| Archivo | Código | Nombre | Observaciones | Qué debe pasar |\n|---|---|---|---|---|\n"
        + "\n".join(rows) + "\n",
        encoding="utf-8",
    )
    (OUT / "casos.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(CASES)} facturas en {OUT}")


if __name__ == "__main__":
    main()
