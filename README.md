# Servidor de valores de mercado

API Node.js + MongoDB que conserva indefinidamente los valores diarios. La fuente diaria es FútbolFantasy y las observaciones leídas por la app desde una sesión válida de `/market` se guardan como contraste; para una fecha concreta, la API sirve primero el consenso observado en Biwenger y usa FútbolFantasy cuando no existe esa observación.

## Despliegue en Render

1. Sube el repositorio a GitHub o GitLab.
2. En MongoDB Atlas crea la base de datos, un usuario con contraseña y permite conexiones desde Render. Copia la cadena `mongodb+srv://…`.
3. En Render elige **New > Blueprint** y selecciona este repositorio. Render leerá `render.yaml` y creará el servicio web y el cron.
4. Introduce `MONGODB_URI` para el servicio web y para el cron cuando Render lo solicite. No guardes esta cadena en Git.
5. Cuando el servicio esté activo, abre `https://TU-SERVICIO.onrender.com/health`.
6. En `app/src/main/java/com/biwinger/saldo/MainActivity.java`, asigna `https://TU-SERVICIO.onrender.com` a la constante `MARKET_API_BASE_URL` y vuelve a compilar la app.

El cron se lanza a los minutos 15 entre las 05:00 y 07:59 UTC. El propio importador comprueba `Europe/Madrid`, solo importa después de las 07:00 españolas y utiliza una clave diaria única en MongoDB; así funciona con horario de invierno y verano sin duplicar valores.

Render no ofrece actualmente plan gratuito para Cron Jobs y aplica un cargo mínimo mensual. Si prefieres evitarlo, ejecuta `npm run import:daily` desde cualquier programador externo con el mismo horario y despliega únicamente el servicio web.

## Importación histórica inicial

Desde Render puedes crear temporalmente un Job o ejecutar en una máquina con Node 22+:

```bash
cd server
npm install --omit=dev
MONGODB_URI='mongodb+srv://…' npm run import:history
```

Primero importa todas las fechas expuestas en la tabla principal y después visita, de forma secuencial y reanudable, la ficha de cada futbolista. Si se interrumpe, vuelve a ejecutar el comando: las fichas terminadas se omiten. `-- --force` permite repetirlas. `DETAIL_DELAY_MS` controla la pausa entre fichas y vale 900 ms por defecto.

## API

- `GET /health`: comprueba servidor y MongoDB.
- `POST /api/v1/values/query`: recibe `{ "players": ["Nombre"], "days": 60 }`.
- `POST /api/v1/observations/biwenger`: recibe el catálogo diario leído por la app. Solo contiene identificador seudónimo de instalación, nombre, equipo, posición y valor; no recibe cookies, contraseña, saldo ni identidad de la liga.

Las colecciones `market_values` y `biwenger_observations` tienen índices únicos, por lo que repetir un cron o un envío actualiza el dato existente sin duplicarlo. Los históricos no se eliminan; el límite de días solo se aplica a las respuestas de la API.
