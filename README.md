# Servidor Biwenia

API Node.js + MongoDB que conserva los valores diarios, gestiona las cuentas recordadas de la app y ejecuta el analista de liga mediante OpenAI sin exponer la clave a la APK.

## Despliegue en Render

1. Sube el repositorio a GitHub o GitLab.
2. En MongoDB Atlas crea la base, un usuario con contraseña y permite conexiones desde Render.
3. En Render elige **New > Blueprint** y selecciona el repositorio. `render.yaml` crea el servicio web y el cron diario.
4. Configura `MONGODB_URI` tanto en el servicio web como en el cron.
5. Configura solo en el servicio web:
   - `OPENAI_API_KEY`: clave secreta de un proyecto de OpenAI con facturación activa.
   - `OPENAI_SAFETY_SALT`: valor aleatorio secreto de al menos 32 caracteres.
   - `DATASET_HASH_SALT`: otro valor aleatorio secreto para anonimizar ligas y mánagers.
   - `OPENAI_MODEL=gpt-5.6-sol`.
   - `OPENAI_REASONING_EFFORT=medium`.
   - Opcionales: `OPENAI_MAX_OUTPUT_TOKENS=1200`, `OPENAI_CONTEXT_MAX_CHARS=240000` y `SESSION_DAYS=90`.
6. No configures `OPENAI_API_KEY` en Android ni en el cron.
7. Abre `https://TU-SERVICIO.onrender.com/health`. `features.ai` debe ser `true`.

La URL de este despliegue ya está fijada en `MainActivity.java` como `https://biwenger.onrender.com`.

## Configuración de OpenAI

No hace falta crear un Assistant ni un bot en OpenAI Platform. El servidor usa la Responses API mediante el SDK oficial. Las instrucciones completas y versionadas están en `src/ai.js`, constante `BIWENGER_SYSTEM_PROMPT`; es el único lugar que hay que editar para cambiar el comportamiento.

Configuración aplicada:

- Modelo: `gpt-5.6-sol`.
- Esfuerzo de razonamiento: `medium`.
- Verbosidad: `medium`.
- Salida máxima: 1200 tokens.
- `store: false`.
- `safety_identifier` estable y seudónimo por usuario.
- Ámbito exclusivo de Biwenger; una pregunta ajena se rechaza, pero queda registrada como consumo.

La app envía un contexto JSON compacto con mánagers, saldos, plantillas, pujas máximas, mercado libre actual, movimientos recientes, perfiles aprendidos y resultados históricos. No envía cookies ni credenciales de Biwenger.

## Cron e importación histórica

El cron se lanza a los minutos 15 entre las 05:00 y 07:59 UTC. El importador comprueba `Europe/Madrid`, solo trabaja después de las 07:00 españolas y utiliza una clave diaria única en MongoDB, por lo que admite horario de invierno/verano sin duplicar valores.

Para la importación histórica inicial:

```bash
cd server
npm install --omit=dev
MONGODB_URI='mongodb+srv://…' npm run import:history
```

La tarea es secuencial y reanudable. `-- --force` permite repetir fichas y `DETAIL_DELAY_MS` controla la pausa, con 900 ms por defecto.

## API

- `GET /health`: comprueba Mongo y muestra las funciones activas.
- `POST /api/v1/auth/register`: `{ "displayName", "email", "password", "deviceName" }`.
- `POST /api/v1/auth/login`: `{ "email", "password", "deviceName" }`.
- `GET /api/v1/auth/me`: requiere `Authorization: Bearer TOKEN`.
- `POST /api/v1/auth/logout`: revoca la sesión actual.
- `POST /api/v1/ai/ask`: `{ "preset", "question", "context" }`, con sesión.
- `POST /api/v1/predictions/sync`: sincroniza predicciones y resultados anonimizados, con sesión.
- `POST /api/v1/values/query`: `{ "players": ["Nombre"], "days": 60 }`.
- `POST /api/v1/observations/biwenger`: guarda el contraste diario leído por la app.

Las contraseñas se derivan con `scrypt` y sal individual. Las sesiones son tokens opacos; Mongo solo conserva su hash y las elimina al caducar. Todas las cuentas tienen por ahora `credits.unlimited=true` y coste cero. Cada consulta queda en `ai_requests` con estado y uso de tokens, dejando preparado el descuento de saldo futuro.

Las predicciones se guardan en `prediction_datasets`. Los identificadores originales de liga, mánager y futbolista se transforman mediante HMAC antes de almacenarse. Cuando un escaneo posterior encuentra el resultado real, el mismo documento se actualiza con ganador, importe y, si la liga Premium los muestra, todas las pujas participantes.

## Desarrollo y pruebas

Copia `.env.example` como `.env` y sustituye los marcadores. Nunca publiques `.env`.

```bash
npm install
npm test
npm start
```
