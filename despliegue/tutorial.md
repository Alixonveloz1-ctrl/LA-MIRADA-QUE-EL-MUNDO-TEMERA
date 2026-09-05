# Poner en marcha el estudio

<walkthrough-tutorial-duration duration="10"></walkthrough-tutorial-duration>

Esto instala todo lo que *La mirada que el mundo temerá* necesita de Google
Cloud.

**No hace falta teclear nada.** Cada vez que veas un recuadro de comando, hay un
botón a su derecha que lo mete en el terminal por ti. En el móvil eso importa:
el terminal de Cloud Shell no deja pegar.

Tarda entre seis y diez minutos. No cierres la ventana mientras trabaja.

Pulsa **Siguiente** para empezar.

## Elegir el proyecto

Todo se instala dentro de un proyecto de Google Cloud. Elige el tuyo aquí:

<walkthrough-project-setup></walkthrough-project-setup>

**Tiene que tener la facturación activada.** Vertex no funciona sin ella, y si
falta, el fallo no llega ahora: llega más tarde, con errores que no la mencionan.
El instalador lo comprueba y se para si no está.

<walkthrough-footnote>Si el proyecto todavía no existe, créalo desde el selector
de arriba y vuelve a este paso.</walkthrough-footnote>

## Decirle a Cloud Shell cuál es

Este comando fija el proyecto que acabas de elegir. Pulsa el botón de la derecha
del recuadro y luego Enter en el terminal:

```bash
gcloud config set project <walkthrough-project-id/>
```

<walkthrough-footnote>Este es el único momento en que se decide en qué cuenta se
instala todo. El instalador te lo volverá a enseñar y te pedirá un Enter, por si
acaso.</walkthrough-footnote>

## Instalarlo

Una sola línea. Habilita las APIs, crea o detecta el bucket, le aplica el CORS,
crea la cuenta de servicio con sus permisos y su clave, y despliega el montador:

```bash
bash ~/cloudshell_open/LA-MIRADA-QUE-EL-MUNDO-TEMERA/instalar.sh
```

Mientras trabaja te va a preguntar tres cosas, y ninguna es larga:

1. **El proyecto** — te lo enseña y pulsas Enter si es el correcto.
2. **El bucket** — si hay varios, escribes **un número**. Si no hay ninguno, lo
   crea.
3. **El dominio del CORS** — opcional. Si pulsas Enter, lo deja abierto, que es
   lo normal aquí: al bucket no se entra sin una URL firmada y esa URL caduca en
   seis horas.

<walkthrough-footnote>Si algo falla, el error dice qué y por qué. Puedes volver a
ejecutar el instalador las veces que hagan falta: no rompe nada de lo que ya
esté hecho.</walkthrough-footnote>

## Copiar las variables

Al terminar, el instalador deja las variables escritas en un archivo. Ábrelo:

```bash
cat ~/mirada-variables.txt
```

Son seis o siete líneas. La primera, `GCP_SERVICE_ACCOUNT`, es la clave de la
cuenta de servicio **en base64 y en una sola línea**: son dos kilobytes de JSON y
en un móvil no se copian de otra forma sin que se rompan. La aplicación la acepta
así.

Si prefieres verlas en una página donde el copiar funciona mejor que en el
terminal, ábrelo en el editor:

```bash
cloudshell edit ~/mirada-variables.txt
```

## Pegarlas en Vercel

Esta parte no se puede automatizar: hay que entrar en Vercel.

1. Abre tu proyecto en **vercel.com**.
2. **Settings → Environment Variables**.
3. Pega cada línea del archivo: el nombre a la izquierda, el valor a la derecha.

Y después, **sin falta**:

**Vercel no aplica una variable nueva a un despliegue ya construido.**
Ve a **Deployments → los tres puntos del último → Redeploy**.

Si te saltas el Redeploy, la pantalla de Salud seguirá diciendo que falta algo
que ya está puesto, y buscarás el fallo donde no está.

<walkthrough-footnote>La pantalla de Salud trae el sello del despliegue: si
después de redesplegar ese sello no ha cambiado, el Redeploy no se
hizo.</walkthrough-footnote>

## Comprobar antes de gastar

Abre la aplicación en el móvil y entra en **Salud**.

Esa pantalla responde de una vez la única pregunta que ningún documento puede
responder: **qué modelos tiene permitidos tu cuenta de verdad.** Te dirá, modelo
por modelo, si contesta, con qué región y con qué variable se sustituye.

**Hasta que no esté todo en verde, no sigas.** Un keyframe malo cuesta céntimos;
un clip malo cuesta un euro.

Cuando esté: banco de anclas → resto del banco → escenarios → voces → keyframes
→ clips → audio → montaje. Genera **una ancla sola primero** y mírala antes de
encolar nada: si el estilo no es el que buscas, ese es el momento barato de
descubrirlo.

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

Ya está. El estudio es tuyo.
