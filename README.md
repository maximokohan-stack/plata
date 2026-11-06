# Plata

Control de gastos, deudas, plata prestada y cuentas compartidas. Web app instalable (PWA) pensada para el celular, **sin servidor ni cuentas**: todos los datos viven solo en el dispositivo de cada persona.

## Qué hace

- **Anotar** gastos e ingresos (categoría, método de pago, fecha). Las categorías se pueden escribir y se guardan solas.
- **Deudas**: quién te debe y a quién le debés (con pagos parciales y recordatorio por WhatsApp), y tarjetas / cuotas.
- **Dividir**: cuatro calculadoras (partes iguales, quién puso cuánto, por consumo, según ingresos).
- **Grupos**: viajes o deptos con gastos compartidos, incluida la **compra por producto** (cada uno paga solo lo que consumió).
- **Opcional, con IA**: asistente de chat, lectura de tickets y facturas, e importación de movimientos desde capturas o PDF.
- Tema claro / oscuro / automático, backup en JSON, funciona sin internet.

## IA opcional: cada persona usa su propia key

Nada de IA funciona hasta que alguien carga **su propia API key** en ⚙ → *Funciones con IA*. Proveedores soportados: **Anthropic**, **OpenAI (ChatGPT)**, **Google Gemini** y **OpenRouter** (algunos modelos gratuitos). La key se guarda solo en el dispositivo (`localStorage`) y se envía directo al proveedor; no hay backend. Quien no carga una key no ve ningún botón de IA.

> No subas keys al repositorio. La app no las necesita en el código.

## Privacidad

Plata no tiene servidor ni cuentas: tus datos se guardan en este dispositivo (IndexedDB, con una reserva en localStorage). Si usás las funciones de IA (opcionales), se envía al proveedor que elegiste **solo lo que le pedís**: lo que escribís en el chat, los datos que el asistente consulta para responderte (por secciones, no todo junto) y las fotos o PDF que adjuntás. La app lo avisa antes de cada acción. Sin key de IA no se envía nada. El CSV se procesa en el dispositivo.

## Cómo se manejan las cuentas (reglas adoptadas)

- **Tu plata hoy** = saldos iniciales + todo lo que entró o salió de tus cuentas. Un préstamo, un cobro o un pago de grupo solo mueve una cuenta si elegís la cuenta al cargarlo; una deuda histórica no toca ningún saldo.
- **Gasto propio**: si pagás una cena de $ 60.000 para tres, sale $ 60.000 de la cuenta, tu gasto del mes es tu parte ($ 20.000) y $ 40.000 quedan **por recuperar**. Al cobrar sube la cuenta y baja lo pendiente; no se inventa un ingreso ni se borra tu gasto.
- **Tarjeta de crédito**: la compra es el gasto; pagar el resumen es un traspaso de una cuenta a la tarjeta (Mover plata), no otro gasto. Cada deuda con cuotas indica si sus cuotas cuentan como gasto (las deudas cargadas antes de v58 siguen contándolo, para no cambiar el historial).
- **Repartos y cuotas**: todo se calcula en centavos enteros y el total se conserva. Los centavos sobrantes van a quien figura primero (cuotas: a las primeras cuotas). Mismo dato, mismo reparto.
- **"Resultado del mes por día restante"** no es plata disponible: es ingresos − gastos del mes dividido los días que faltan, sin contar saldos ni compromisos.

## Datos, migración y copias

El estado tiene un número de esquema (`schemaVersion`, hoy 2). Al abrir una versión nueva con datos de una anterior se migra solo, de forma **aditiva** (no se reescriben ni borran movimientos) y **después de guardar una copia exacta de lo que había**, descargable desde Ajustes. Antes de restaurar un backup o de borrar todo también se guarda una copia, para volver atrás. Ajustes muestra la fecha de la última copia y Restaurar muestra una vista previa antes de reemplazar nada.

## Pruebas

```bash
node --test
```

`core.js` concentra la aritmética de plata (centavos, repartos, saldos, cuotas, préstamos, migración, CSV, duplicados, operaciones con vínculo y reversión, guardado con reserva). Las pruebas usan solo datos sintéticos y no necesitan dependencias.

## Desarrollo

Es HTML + CSS + JS plano, sin build. Para probarla en local:

```bash
python -m http.server 8760
# abrir http://localhost:8760
```

Archivos principales:

| Archivo | Qué contiene |
|---|---|
| `index.html`, `styles.css` | Estructura y estilos (identidad "libreta de cuentas") |
| `core.js` | Núcleo puro de plata (sin pantalla): centavos, repartos, saldos, cuotas, migración, CSV. Lo prueba `node --test` |
| `app.js` | Datos, vistas y formularios (usa `core.js` para toda la aritmética) |
| `calc.js` | Calculadoras de dividir |
| `items.js` | Compra por producto + lectura de tickets |
| `import.js` | Importar movimientos desde CSV (sin IA) o capturas / PDF, con vista previa y deshacer |
| `grupos.js` | Editar integrantes de un grupo |
| `respaldo.js` | Copia de seguridad visible, restauración con vista previa, recuperación |
| `onboarding.js` | Bienvenida de la primera vez |
| `tests/` | Pruebas automáticas del núcleo |
| `llm.js` | Capa de proveedores de IA (Anthropic, OpenAI, Gemini, OpenRouter) |
| `assistant.js` | Chat con herramientas |
| `sw.js`, `manifest.json` | Modo offline e instalación |
| `fonts/` | Outfit (títulos, cifras e interfaz), subconjunto latino, licencia SIL OFL 1.1. Alojadas en la app: sin pedidos a terceros y disponibles sin internet |

Al cambiar archivos de la app, subir el número de versión de `sw.js` (`const V = 'plata-vN'`) para que los celulares tomen la versión nueva.
