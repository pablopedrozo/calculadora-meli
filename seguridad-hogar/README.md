# 🏠🔒 Sistema de seguridad del hogar

Sistema de alarma y videovigilancia profesional, 100% local (sin nubes de fabricantes
ni abonos mensuales), corriendo en una PC propia.

## Qué hace

- **Graba las cámaras 24/7** y detecta **personas** con IA local (ignora perros, autos, ramas).
- **Panel de alarma real**: Desarmada / Armado en casa (perímetro) / Armado ausente (todo).
- Sensores de apertura en puertas y ventanas + sensor de movimiento interior (Zigbee).
- Al detectar intrusión con la alarma armada: **sirena + notificación crítica con foto**
  al celular de toda la familia en segundos.
- Todo se controla desde la app de Home Assistant en cada celular vinculado.

## Componentes

| Software | Rol | Interfaz web |
|---|---|---|
| [Frigate](https://frigate.video) | Grabación + detección de personas por IA | `:5000` |
| [Home Assistant](https://www.home-assistant.io) | Alarma, automatizaciones, app del celular | `:8123` |
| [Zigbee2MQTT](https://www.zigbee2mqtt.io) | Sensores y sirena Zigbee | `:8081` |
| [Mosquitto](https://mosquitto.org) | Mensajería interna (MQTT) | — |

Todo corre con Docker Compose y arranca solo al prender la PC.

## Empezar

1. **Comprar lo que falta** → [docs/LISTA_COMPRAS.md](docs/LISTA_COMPRAS.md)
2. **Instalar todo** → [docs/GUIA_INSTALACION.md](docs/GUIA_INSTALACION.md)

## Estructura

```
seguridad-hogar/
├── docker-compose.yml          # levanta los 4 servicios
├── .env.example                # plantilla de datos propios (copiar a .env)
├── frigate/config.yml          # cámaras y detección de personas
├── homeassistant/
│   ├── configuration.yaml      # panel de alarma y notificaciones
│   ├── automations.yaml        # la lógica: disparos, sirena, avisos
│   └── secrets.yaml            # código de la alarma
├── zigbee2mqtt/configuration.yaml
├── mosquitto/mosquitto.conf
└── docs/                       # guía de instalación y lista de compras
```
