# Facturas planas de prueba

Generadas con `mobile/test/facturas/generar_planas.py` (datos inventados, mismo formato que
`muestra_plana.png`). Escanearlas en orden: la 20 y la 21 repiten clientes de la 03 y la 06.
De la 22 en adelante la app no registra nada y muestra un aviso con el título indicado (si hay
dos problemas, los dos).

| Archivo | Código | Nombre | Observaciones | Qué debe pasar |
|---|---|---|---|---|
| 01_nuevo_obs_con_direccion.png | 050105871 | FERRETERIA EL POCHOTE S.A | ENTREGAR EN NOSARA, 300 M SUR DE LA PLAZA DE DEPORTES | Cliente nuevo. Ubicación - Observaciones: dirección en Nosara. |
| 02_nuevo_obs_entregar_en_lugar.png | 010915420 | AGROVETERINARIA EL VALLE S.A | Cargado de FR - OC 61877 ENTREGAR EN PLATANARES | Cliente nuevo. Entregar en: PLATANARES. |
| 03_nuevo_sin_observaciones.png | 030502219 | MATERIALES DE CONSTRUCCION TURRIALBA LTDA | Sin observaciones | Cliente nuevo. Observaciones: Sin observaciones. |
| 04_nuevo_obs_dos_renglones.png | 020117763 | DEPOSITO Y FERRETERIA LA FORTUNA S.A | Cargado de FR - OC 62015 ENTREGAR EN EL TANQUE, DEL CEMENTERIO 400 M OESTE, BODEGA AZUL | Cliente nuevo. Observaciones de dos renglones unidas; dirección en El Tanque. |
| 05_nuevo_obs_sin_direccion_telefono.png | 060602140 | FERRETERIA Y MADERAS QUEPOS S.A | LLAMAR AL 8812-4470 ANTES DE ENTREGAR | Cliente nuevo. Observaciones sin dirección → 'Sin dirección en observaciones'. |
| 06_nuevo_obs_con_senas.png | 021303398 | ALMACEN AGRICOLA UPALA S.A | ENTREGAR EN BIJAGUA, FRENTE AL SUPER LA AMISTAD, PORTON NEGRO | Cliente nuevo. Dirección en Bijagua. |
| 07_nuevo_obs_pago.png | 021202657 | CONSTRUCENTRO SARCHI LTDA | PAGO CONTRA ENTREGA, SOLO EFECTIVO O SINPE | Cliente nuevo. Observaciones sin dirección. |
| 08_nuevo_nombre_con_enie.png | 021001845 | FERRETERIA PEÑAS BLANCAS S.A | Sin observaciones | Cliente nuevo con Ñ en nombre y dirección. Sin observaciones. |
| 09_nuevo_obs_finca_km.png | 070103319 | AGROSERVICIOS DEL ATLANTICO S.A | ENTREGAR EN FINCA LA ESTRELLA, KM 12 CARRETERA A VALLE LA ESTRELLA | Cliente nuevo. Dirección en Valle La Estrella. |
| 10_nuevo_obs_solo_orden.png | 020504466 | FERRETERIA ATENAS CENTRO S.A | Cargado de FR - OC 61530 | Cliente nuevo. Observaciones solo con la orden → sin dirección. |
| 11_nuevo_obs_dos_renglones_recibe.png | 060702915 | MULTISERVICIOS FERRETEROS DEL SUR LTDA | ENTREGAR EN RIO CLARO, 200 M NORTE DE LA BOMBA, RECIBE DOÑA MARIELA, HORARIO DE 8 A 12 | Cliente nuevo. Dos renglones; dirección en Río Claro. |
| 12_nuevo_obs_horario.png | 020305512 | MATERIALES EL MIRADOR DE GRECIA S.A | NO RECIBEN LOS SABADOS | Cliente nuevo. Observaciones sin dirección. |
| 13_nuevo_canas_sin_obs.png | 050601287 | FERRETERIA CAÑAS DEL TEMPISQUE S.A | Sin observaciones | Cliente nuevo. Sin observaciones. |
| 14_nuevo_obs_casa_porton.png | 010403670 | DEPOSITO DE MATERIALES PURISCAL S.A | ENTREGAR EN BARBACOAS, CASA ESQUINERA PORTON CAFE | Cliente nuevo. Dirección en Barbacoas. |
| 15_nuevo_obs_orden_y_lugar.png | 060901134 | AGROINSUMOS PARRITA LTDA | Cargado de FR - OC 62290 ENTREGAR EN PALO SECO | Cliente nuevo. Entregar en: PALO SECO. |
| 16_nuevo_muchos_productos.png | 050304421 | FERRETERIA SANTA CRUZ GUANACASTE S.A | DESCARGAR POR EL PORTON DE ATRAS, SOLO CAMION PEQUEÑO | Cliente nuevo con 14 productos (la tabla no debe confundir al lector). |
| 17_nuevo_heredia_bodega.png | 040802231 | FERRETERIA LOS ANGELES DE SAN PABLO S.A | ENTREGAR EN BODEGA DE BARVA, 50 M SUR DEL CEMENTERIO DE SAN PEDRO | Cliente nuevo. Dirección en Barva. |
| 18_nuevo_obs_persona.png | 030301588 | MADERAS Y FERRETERIA LA UNION LTDA | ENTREGAR ANTES DE LAS 10 AM, PREGUNTAR POR JORGE | Cliente nuevo. Observaciones sin dirección. |
| 19_nuevo_nombre_largo.png | 011802744 | DISTRIBUIDORA HERMANOS QUESADA ROJAS S.A | Cargado de FR - OC 62411 ENTREGAR EN EL ROSARIO DE DESAMPARADOS | Cliente nuevo con nombre y dirección largos. |
| 20_repetido_turrialba_otra_obs.png | 030502219 | MATERIALES DE CONSTRUCCION TURRIALBA LTDA | ENTREGAR EN SANTA ROSA DE TURRIALBA, 100 M ESTE DEL PUENTE | Mismo código que la 03 → 'Este cliente ya estaba registrado' (no crea otro). |
| 21_repetido_upala_igual.png | 021303398 | ALMACEN AGRICOLA UPALA S.A | ENTREGAR EN BIJAGUA, FRENTE AL SUPER LA AMISTAD, PORTON NEGRO | Mismo cliente y observaciones que la 06 (otra factura) → ya estaba registrado. |
| 22_error_sin_nombre.png | 040105528 | (vacío) | Cargado de FR - OC 62503 | Aviso: “No hay nombre del cliente”. No registra. |
| 23_error_sin_direccion.png | 040301976 | FERRETERIA SANTO DOMINGO S.A | Sin observaciones | Aviso: “No hay dirección”. No registra. |
| 24_error_codigo_8_digitos.png | 01070215 | FERRETERIA DESAMPARADOS NORTE S.A | ENTREGAR EN BODEGA PRINCIPAL | Aviso: “El formato del código está mal”. No registra. |
| 25_error_sin_etiqueta_codigo.png | (no aparece) | FERRETERIA EL ROBLE DE ALAJUELA S.A | Cargado de FR - OC 62617 | Aviso: “No se encontró el código”. No registra. (No aparece CODIGO (ni la etiqueta ni el número).) |
| 26_error_codigo_vacio.png | (vacío) | MATERIALES SAN JUAN DE TIBAS S.A | ENTREGAR EN BODEGA DE LLORENTE | Aviso: “No hay código del cliente”. No registra. (CODIGO sin número.) |
| 27_error_codigo_10_digitos.png | 0201158743 | FERRETERIA CIUDAD QUESADA S.A | Sin observaciones | Aviso: “El formato del código está mal”. No registra. (Código de 10 números.) |
| 28_error_codigo_con_letra.png | 0201X0215 | AGROCOMERCIAL LOS CHILES S.A | LLAMAR ANTES DE ENTREGAR | Aviso: “El formato del código está mal”. No registra. (Código con una letra (0201X0215).) |
| 29_error_codigo_tachado.png | 060403352 | DEPOSITO DE MATERIALES ESPARZA S.A | Cargado de FR - OC 62702 | Aviso: “No se logró leer el código”. No registra. (Código tachado con lapicero.) |
| 30_error_sin_etiqueta_nombre.png | 030204417 | (no aparece) | ENTREGAR EN OROSI, CONTIGUO A LA IGLESIA | Aviso: “No se encontró el nombre”. No registra. (No aparece NOMBRE (ni la etiqueta ni el nombre).) |
| 31_error_nombre_tachado.png | 070205538 | DEPOSITO GERMANIA LTDA | Sin observaciones | Aviso: “No se logró leer el nombre”. No registra. (Nombre tachado con lapicero.) |
| 32_error_sin_etiqueta_direccion.png | 010603781 | FERRETERIA ASERRI SUR S.A | Cargado de FR - OC 62844 | Aviso: “No se encontró la dirección”. No registra. (No aparece DIRECCION (ni la etiqueta ni la dirección).) |
| 33_error_direccion_una_palabra.png | 020802914 | DEPOSITO AGRICOLA POAS S.A | ENTREGAR EN SAN PEDRO DE POAS | Aviso: “La dirección está incompleta”. No registra. (Dirección de una sola palabra (ALAJUELA).) |
| 34_error_direccion_tachada.png | 050703165 | FERRETERIA BAGACES S.A | Sin observaciones | Aviso: “No se logró leer la dirección”. No registra. (Dirección tachada con lapicero.) |
| 35_error_hoja_en_blanco.png | — | — | — | Aviso: “No se leyó texto en la foto”. No registra. (Hoja en blanco.) |
| 36_error_no_es_factura.png | — | — | — | Aviso: “No se encontró la factura en la foto”. No registra. (Una carta del proveedor (sin recuadro del cliente).) |
| 37_error_codigo_8_y_sin_direccion.png | 02011587 | FERRETERIA NARANJO CENTRO S.A | Cargado de FR - OC 62903 | Aviso: “El formato del código está mal” · “No hay dirección”. No registra. (Código de 8 números y DIRECCION vacía.) |
| 38_error_sin_nombre_y_direccion_incompleta.png | 040904486 | (no aparece) | Sin observaciones | Aviso: “No se encontró el nombre” · “La dirección está incompleta”. No registra. (Sin NOMBRE y dirección de una sola palabra (HEREDIA).) |
