# PARCHE · Despliegue

Añadir al `plan-de-construccion.md` como sección 16. Faltaba entera.

Todo lo de aquí sale de despliegues que ya funcionan en producción. Las trampas
marcadas costaron horas la primera vez.

---

## 1. Tres sitios, y solo uno se despliega solo

| Qué | Dónde | Cómo |
|---|---|---|
| `index.html` + `app/` + el endpoint | **Vercel** | Solo. Conectado al repo: cada push despliega. |
| El montador ffmpeg | **Cloud Run** | **A mano**, una vez, desde Cloud Shell. |
| Bucket, Vertex, modelos | **Google Cloud** | No se despliega. Se configura una vez. |

---

## 2. La restricción que manda sobre todo el proceso de instalación

> **El terminal de Cloud Shell no deja pegar desde el móvil.**

Y aquí solo se trabaja desde el móvil.

Consecuencia, y no es negociable: **la instalación del montador tiene que caber en
dos líneas cortas que se puedan teclear a mano.** Nada de pegar un script de
doscientas líneas, nada de bloques largos de `gcloud`.

El patrón que funciona:

```
git clone https://github.com/<usuario>/<repo>.git
```
```
bash <repo>/montador/instalar.sh
```

Todo lo demás lo hace `instalar.sh`, que vive en el repositorio. Si el
procedimiento de instalación no cabe en dos líneas tecleables, está mal diseñado.

---

## 3. Qué hace `instalar.sh`

1. **Enseña el proyecto de Google Cloud activo y espera un Enter.** Es el único
   momento en que el usuario puede darse cuenta de que está en la cuenta
   equivocada. Si no es el correcto: Ctrl+C y `gcloud config set project ...`.
2. **Detecta el bucket.** Si solo hay uno, lo coge y lo dice. Si hay varios, los
   enumera y el usuario escribe **un número**, no un nombre.
3. Habilita las APIs que falten.
4. Genera la clave secreta del montador (`openssl rand -hex 24`).
5. Construye y despliega.
6. Da los permisos de bucket.
7. **Imprime al final, en un recuadro grande, las variables con su nombre y su
   valor exactos** para copiarlas a Vercel.

Tarda entre cinco y ocho minutos y hay que decirle al usuario que no cierre la
ventana.

---

## 4. Cloud Run: job, no servicio

El montador va como **Cloud Run Job**, no como servicio.

**Por qué importa, y es una trampa cara:** un *servicio* de Cloud Run, si se le
responde a la petición y se sigue trabajando por detrás, **se queda sin CPU a
mitad del trabajo**. Google le apaga el procesador. Con un servicio hay que pasar
`--no-cpu-throttling` obligatoriamente o el vídeo se corta por la mitad sin error
claro.

Un **job** no tiene ese problema: siempre tiene CPU y admite tiempos largos. Para
montar un episodio de 22 minutos es la única opción sensata.

Parámetros de referencia:

```
--memory 2Gi --cpu 2
--task-timeout 3600
--max-retries 0
```

`--max-retries 0` a propósito: un montaje que falla no mejora repitiéndose solo,
y repetirlo cuesta dinero.

---

## 5. Autenticación entre Vercel y el montador

El montador necesita **su propia clave**, generada en la instalación y compartida
solo entre él y Vercel. Dos variables salen del instalador:

| Variable | Qué es |
|---|---|
| `MONTAJE_URL` | la dirección del montador recién creado |
| `MONTAJE_KEY` | la clave que el endpoint usa para hablar con él |

---

## 6. Permisos: no basta con la service account de Vercel

**Trampa.** El montador **no** se ejecuta con la service account que usa Vercel.
Se ejecuta con la cuenta de compute del proyecto. Si no se le da permiso
explícito sobre el bucket, el montaje falla al escribir el resultado, después de
haber hecho todo el trabajo.

Hay que dar acceso al bucket a la cuenta
`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`, y el instalador lo hace.

Y la service account de Vercel necesita **Cloud Run Invoker** para poder lanzar el
job.

---

## 7. Vercel

- Repo de GitHub conectado. Cada push a la rama principal despliega.
- Las variables de entorno de la sección 14 del plan, más `MONTAJE_URL` y
  `MONTAJE_KEY`.
- La versión de Node **fijada en `package.json`**.

**Trampa, y de las que más tiempo hacen perder:**

> **Vercel no aplica una variable nueva a un despliegue ya construido.**

Se añade la variable, y hay que ir a **Deployments → los tres puntos del último →
Redeploy**. Si no, la pantalla de Salud sigue diciendo que falta algo que ya está
puesto, y se busca el fallo donde no está.

Esto tiene que estar escrito **en la propia pantalla de Salud**, junto a cada
variable que falte: *«¿la acabas de añadir? Vercel necesita un Redeploy.»*

---

## 8. El bucket y el navegador

El navegador carga imágenes y vídeos del bucket con URL firmada. Eso exige
**CORS configurado en el bucket** para el dominio de Vercel.

**Trampa:** sin CORS las imágenes simplemente no aparecen, y el error de consola
no menciona CORS por ningún lado.

---

## 9. Por qué el montador no puede conocer ningún nombre de archivo

Ya está en el plan, pero aquí se ve el motivo real: **el montador se despliega a
mano y por tanto siempre va por detrás del repositorio.**

Si un día se añade un material nuevo y hay que redesplegar el contenedor para que
el generador pueda usarlo, el diseño está mal. Todo llega como datos en el
encargo: una lista `origen → destino` y una hoja de montaje. El contenedor no
lleva escrito ni el bucket, ni el proyecto, ni la cuenta.

El contenedor necesita, además de ffmpeg, **una fuente con acentos** para los
subtítulos en español.

---

## 10. Orden de arranque

1. Google Cloud: APIs, bucket, service account, CORS del bucket.
2. Repo en GitHub con los tres archivos de datos.
3. Vercel conectado, variables puestas, **desplegado**.
4. Abrir **Salud**. Hasta que esté toda en verde, no se sigue.
5. El montador, cuando toque la fase C. Dos líneas en Cloud Shell.
6. `MONTAJE_URL` y `MONTAJE_KEY` en Vercel, y **Redeploy**.
