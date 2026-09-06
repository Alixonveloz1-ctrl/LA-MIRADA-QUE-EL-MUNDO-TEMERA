# Volver a desplegar el montador

<walkthrough-tutorial-duration duration="4"></walkthrough-tutorial-duration>

El montador es el contenedor con ffmpeg que corta, pega y monta. Vive en Cloud
Run y **se despliega a mano**, así que siempre va por detrás del repositorio:
cada vez que aprende algo nuevo hay que traerlo aquí.

**No hace falta teclear nada.** Cada recuadro de comando lleva un botón a su
derecha que lo mete en el terminal por ti. En el móvil eso es lo único que
importa: el terminal de Cloud Shell no deja pegar.

Esto **no toca nada más**: ni el bucket, ni la cuenta de servicio, ni los
permisos, ni tus variables de Vercel.

Tarda unos tres o cuatro minutos, casi todo construyendo. Pulsa **Siguiente**.

## Traer lo último

Cloud Shell clona el repositorio la primera vez, pero si ya lo tenías de otra
ocasión **no lo actualiza solo**. Este comando trae los cambios:

```bash
cd ~/cloudshell_open/LA-MIRADA-QUE-EL-MUNDO-TEMERA && git pull
```

<walkthrough-footnote>Si dice «Already up to date», es que ya estaba al día y no
pasa nada: sigue al paso siguiente igualmente.</walkthrough-footnote>

## Desplegarlo

Una sola línea, y es la única que hace algo:

```bash
bash ~/cloudshell_open/LA-MIRADA-QUE-EL-MUNDO-TEMERA/instalar.sh montador
```

No te va a preguntar nada. Busca el montador que ya tienes, lee **del propio
job** el bucket y la clave que ya tiene puestos, y lo vuelve a desplegar igual.

Que la clave salga de ahí y no se genere de nuevo es lo importante: una clave
nueva invalidaría la `MONTAJE_KEY` que tienes en Vercel, y el montaje empezaría a
fallar diciendo cualquier otra cosa. Si por lo que sea no consigue leerla, se
para y te lo dice, en vez de arriesgarse.

<walkthrough-footnote>Si te dice que no encuentra el job, es que nunca se llegó a
instalar: entonces hace falta la instalación completa una vez, con
<code>bash ~/cloudshell_open/LA-MIRADA-QUE-EL-MUNDO-TEMERA/instalar.sh</code>, y a
partir de ahí ya sirve este camino corto.</walkthrough-footnote>

## Ya está

Cuando salga **MONTADOR ACTUALIZADO**, se acabó.

**No hay que tocar nada en Vercel** y no hay que redesplegar nada allí: lo que ha
cambiado es el contenedor de Google, no la aplicación.

Vuelve al estudio en el móvil y sigue donde lo dejaste.

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>
