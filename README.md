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

Nada de IA funciona hasta que alguien carga **su propia API key** en ⚙ → *Funciones con IA*. Proveedores soportados: **Anthropic**, **Google Gemini** y **OpenRouter** (algunos modelos gratuitos). La key se guarda solo en el dispositivo (`localStorage`) y se envía directo al proveedor; no hay backend. Quien no carga una key no ve ningún botón de IA.

> No subas keys al repositorio. La app no las necesita en el código.

## Privacidad

Los datos financieros no salen del dispositivo. Lo único que viaja a un tercero es lo que la persona decide mandar al proveedor de IA que eligió (texto de la consulta, o la foto/PDF de un ticket).

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
| `app.js` | Datos, vistas, formularios, cálculo de saldos |
| `calc.js` | Calculadoras de dividir |
| `items.js` | Compra por producto + lectura de tickets |
| `import.js` | Importar movimientos desde capturas / PDF |
| `llm.js` | Capa de proveedores de IA (Anthropic, Gemini, OpenRouter) |
| `assistant.js` | Chat con herramientas |
| `sw.js`, `manifest.json` | Modo offline e instalación |
| `fonts/` | Outfit (títulos, cifras e interfaz), subconjunto latino, licencia SIL OFL 1.1. Alojadas en la app: sin pedidos a terceros y disponibles sin internet |

Al cambiar archivos de la app, subir el número de versión de `sw.js` (`const V = 'plata-vN'`) para que los celulares tomen la versión nueva.
