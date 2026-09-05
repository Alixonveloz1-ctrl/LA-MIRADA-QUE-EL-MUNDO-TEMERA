# LA MIRADA QUE EL MUNDO TEMERÁ

El estudio de producción del animé. Se abre en el navegador del teléfono y desde
ahí se produce la serie entera: se genera el banco de personajes y escenarios, se
elige la voz de cada uno, se sacan los keyframes, se convierten en clips, se
compone el audio y se monta.

**Qué produce.** Piezas de vídeo terminadas con su audio, sus subtítulos quemados
en español y su acabado de anime. Hoy la pieza que hay escrita plano a plano es
el teaser de 78 segundos y 24 planos, que se puede generar desde el primer día.
Los doce episodios están en `datos/guiones.json` con sus 289 escenas y pasan
antes por el desglose, que los convierte en planos.

**Lo que NO es.** No es un estudio genérico para hacer animes. Es para este
animé: los personajes, los escenarios, las luces, el estilo y el reparto de voces
están escritos en `datos/serie.json` y la herramienta no inventa nada que no esté
ahí. Un animé, un camino. Si algún día sirve para otro, será otro proyecto.

Tampoco tiene cuentas, ni login, ni multiproyecto, ni ninguna pantalla para subir
imágenes: todo lo visual lo genera la herramienta.

---

## Cómo se usa

1. Se pone en marcha una vez siguiendo **[docs/despliegue.md](docs/despliegue.md)**.
2. Se abre la dirección de Vercel en el teléfono y se añade a la pantalla de
   inicio, que es como se abre a pantalla completa.
3. Se entra en **Salud** y no se gasta nada hasta que esté todo en verde.
4. A partir de ahí, se trabaja por pantallas, en el orden que dice la guía:
   anclas del banco, resto del banco, escenarios, voces, keyframes, clips, audio
   y montaje.

Nada depende de que el móvil siga abierto: la cola y el estado viven en el
bucket, así que si se cierra la aplicación a mitad de una tirada de cuatrocientos
planos, al volver a entrar se reanuda sola.

---

## Estructura del repositorio

| Carpeta | Qué hay dentro |
|---|---|
| `app/` | La aplicación del navegador: cola, estado, progreso y las ocho pantallas, en módulos ES nativos sin build ni framework. |
| `api/` | La puerta única `POST /api/g` y su `_lib/`: firma el token, compone los prompts, habla con Vertex y con el bucket, y censura toda respuesta. |
| `datos/` | `guiones.json` (la serie), `serie.base.json` (cómo se produce, tal y como llegó) y `serie.json` (el que lee la herramienta, generado por el parche). |
| `docs/` | El contrato interno, el plan de construcción, las decisiones, la guía de despliegue y la explicación del parche de datos. |
| `herramientas/` | Lo que se ejecuta sin red: el parche de datos, los invariantes y el pesaje de las respuestas. |
| `montador/` | El contenedor de ffmpeg que corre como Job de Cloud Run: recorta, concatena, aplica el acabado, mezcla el audio y quema los subtítulos. |

En la raíz, `index.html` (lo único que se sirve), `package.json`, `vercel.json` y
este archivo.

---

## Las ocho pantallas

1. **Salud** — dice quién es esta instalación, si el bucket se lee y se escribe,
   si cada modelo contesta y cuánto pesan las respuestas, todo comprobado de
   verdad y antes de gastar un céntimo.
2. **Voces** — los personajes ordenados por volumen de diálogo, cada uno con las
   voces reales de la API diciendo su frase más difícil, para elegir escuchando.
3. **Banco** — los personajes y los escenarios de toda la serie: generar, mirar,
   aprobar y regenerar, con las cadenas de ancla y de edad a la vista.
4. **Desglose** — se elige un episodio y se convierte en planos, una llamada de
   texto por escena, sin campos de texto y sin pantalla de aprobación.
5. **Tomas** — la lista de la pieza activa filtrable por estado: keyframe,
   aprobar, clip, intentos, elegir.
6. **Audio** — la música de cada pieza y las voces de cada bloque, con
   reproductor: nada entra en un montaje sin haber sonado antes aquí.
7. **Cola** — qué se está generando ahora, qué falló y por qué, el botón de
   detener y el contador de gasto.
8. **Montaje** — montar por escenas, actos y episodio, y reproducir o descargar
   el resultado por URL firmada.

---

## Antes de desplegar

```
npm run comprobar
```

Encadena las tres herramientas y no necesita red ni credenciales: regenera
`datos/serie.json` desde `serie.base.json` con el parche, comprueba los
invariantes sobre los datos y sobre el árbol de código, y **pesa** la respuesta
de cada modo con material del tamaño real para verificar que cabe en los 4,5 MB.
Ese último fallo no se ve leyendo el código; se ve midiendo. Si algo no cumple,
sale con error y lo dice en español.

Cada paso se puede lanzar por separado con `npm run datos`, `npm run invariantes`
y `npm run pesar`.

---

## Para tocar el código

Antes de escribir una línea, **[docs/contrato.md](docs/contrato.md)**: es la
única fuente de firmas, nombres de campo y reglas. Si algo no está ahí, se decide
y se añade ahí primero.

Lo demás que conviene leer: `docs/plan-de-construccion.md` (el encargo original,
con las trampas ya pagadas), `docs/decisiones.md` (lo que hubo que decidir al
construir y qué alternativa se descartó) y `docs/patch-datos.md` (qué le cambia
el parche a los datos y por qué).

Todo el código y todos los comentarios van en español. Solo van en inglés los
prompts a los modelos de imagen y de vídeo y los encargos a Lyria, porque no
admite otra cosa. Ni un project id, ni un bucket, ni un correo, ni una clave, ni
un id de modelo escritos en el código: salen de variables de entorno y de
`datos/serie.json`.
