# Guía de instalación paso a paso

Objetivo: dejar la PC funcionando como central de alarma y grabación.
Tiempo estimado: una tarde. No hace falta saber programar — es copiar y pegar.

## Paso 1 — Instalar Linux en la PC

1. En otra computadora, descargar **Ubuntu Server 24.04 LTS** (https://ubuntu.com/download/server).
2. Grabarlo en un pendrive de 8GB+ con **balenaEtcher** (https://etcher.balena.io/).
3. Bootear la PC desde el pendrive (tecla F12/F9/ESC al prender) e instalar con las opciones por defecto.
   - Cuando pregunte, marcar **"Install OpenSSH server"**.
   - Usuario sugerido: `casa`.
4. Al terminar, anotar la IP que muestra (ej: `192.168.1.50`). Desde acá todo se puede hacer
   por SSH desde tu compu de siempre: `ssh casa@192.168.1.50`.

## Paso 2 — Fijarle la IP a la PC

En la página del router (generalmente http://192.168.1.1), buscar "DHCP" → "Reserva de IP"
y reservar la IP de la PC para que nunca cambie. Hacer lo mismo luego con cada cámara.

## Paso 3 — Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# cerrar sesión y volver a entrar para que tome el grupo
```

## Paso 4 — Copiar este proyecto a la PC

```bash
git clone <URL-de-este-repositorio>
cd calculadora-meli/seguridad-hogar
cp .env.example .env
nano .env      # completar con tus datos (contraseña de cámaras, ruta del dongle)
```

Para conocer la ruta del dongle Zigbee (enchufado en un USB):

```bash
ls -l /dev/serial/by-id/
```

Copiar la ruta completa (`/dev/serial/by-id/usb-ITead...`) en la variable `ZIGBEE_DONGLE` del `.env`.

## Paso 5 — Configurar las cámaras

1. Conectar cada cámara al switch PoE, y el switch al router.
2. Entrar a la web de cada cámara (la IP aparece en la app del router o con la herramienta
   ConfigTool de Dahua / SADP de Hikvision).
3. Ponerle una **contraseña fuerte** (la misma para todas, la que va en `CAMARA_PASSWORD` del `.env`).
4. Reservarle la IP en el router (como en el paso 2). Sugerencia: `.101`, `.102`, `.103`...
5. Editar `frigate/config.yml`: poner la IP real de cada cámara y renombrar
   los bloques (`frente`, `patio`) según dónde esté cada una.
6. **Importante**: en la web de cada cámara, desactivar el acceso a la nube del fabricante
   (P2P / EZVIZ / Hik-Connect) — el sistema es 100% local.

## Paso 6 — Levantar el sistema y emparejar los sensores

```bash
docker compose up -d
docker compose ps    # los 4 servicios deben decir "running"
```

Emparejar los sensores Zigbee:

1. Abrir `http://IP-DE-LA-PC:8081` (Zigbee2MQTT) y tocar **Permit join**.
2. Apretar el botón de cada sensor 5 segundos (queda titilando) hasta que aparezca en la lista.
3. Renombrarlos con **exactamente** estos nombres (las automatizaciones los esperan así):
   - `puerta_entrada`, `puerta_patio`, `ventana_living` (sensores de apertura)
   - `pir_living` (sensor de movimiento)
   - `sirena` (la sirena)
4. Volver a desactivar **Permit join**.

## Paso 7 — Configurar Home Assistant

1. Abrir `http://IP-DE-LA-PC:8123`, crear el usuario administrador.
2. **Ajustes → Dispositivos y servicios → Agregar integración → MQTT**, servidor: `localhost`,
   puerto `1883`. Con eso aparecen todos los sensores y la sirena.
3. Agregar la integración **Frigate** (Ajustes → Integraciones → Agregar → "Frigate",
   URL: `http://IP-DE-LA-PC:5000`). Con eso aparecen las cámaras y la detección de personas.
   Si no aparece, instalarla vía HACS (https://hacs.xyz).
4. Cambiar el código de alarma en `homeassistant/secrets.yaml`.

## Paso 8 — Vincular los celulares

En cada celular de la familia:

1. Instalar la app **Home Assistant** (Play Store / App Store).
2. Conectarla a `http://IP-DE-LA-PC:8123` estando en el WiFi de casa; crear un usuario por persona.
3. En la PC, editar `homeassistant/configuration.yaml`, sección `notify:` — agregar una línea
   por cada celular (el nombre exacto sale de Herramientas de desarrollador → Acciones →
   buscar `notify.mobile_app_`).
4. Reiniciar Home Assistant (Ajustes → Sistema → Reiniciar).

**Acceso desde afuera de casa** (para armar/desarmar y ver cámaras desde cualquier lado):
la opción simple y segura es **Home Assistant Cloud (Nabu Casa)** (~USD 6,5/mes) o,
gratis, **Tailscale** en la PC y los celulares (VPN privada, 10 min de configuración).
NO abrir puertos del router a internet.

## Paso 9 — Probar TODO

1. Armar la alarma en modo **Ausente** desde la app, salir, abrir la puerta → debe sonar
   la sirena a los 30 segundos y llegar la notificación a todos los celulares.
2. Caminar frente a una cámara con la alarma armada → disparo + foto en el celular.
3. Desarmar con el código → la sirena debe cortarse.
4. Desenchufar la PC del router 1 minuto → al volver, todo debe seguir funcionando solo.

## Mantenimiento

- Actualizar el sistema cada tanto: `docker compose pull && docker compose up -d`
- Las grabaciones viejas se borran solas (7 días continuo / 30 días eventos con personas).
- Si algo no funciona: `docker compose logs -f <servicio>` muestra el error.
