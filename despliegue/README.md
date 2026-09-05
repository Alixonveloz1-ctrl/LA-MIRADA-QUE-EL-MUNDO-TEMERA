# despliegue/

Lo que Google Cloud necesita, escrito como archivos del repositorio y no como
comandos que alguien tenga que dictar. `instalar.sh` los lee de aquí.

| Archivo | Qué es |
|---|---|
| `cors.json` | La configuración de CORS del bucket |
| `permisos.txt` | Los papeles que necesita cada cuenta, y por qué |
| `apis.txt` | Las APIs que hay que habilitar, y para qué sirve cada una |

## Sobre `cors.json`

Sin esto, el navegador **no puede reducir el keyframe a 1280 px** antes de
mandarlo a Veo, y el error no menciona CORS por ningún lado: la imagen se ve
perfectamente y el fallo aparece al generar el clip.

`origin: ["*"]` es deliberado y es seguro **aquí**, por una razón concreta: al
bucket no se entra sin una URL firmada, y esa URL caduca en seis horas. Quien no
tiene la URL no lee nada, venga del origen que venga; y quien la tiene, la tiene.
Abrir el origen no abre el bucket.

Si aun así prefieres cerrarlo a tu dominio, `instalar.sh` te lo pregunta y
escribe la variante. Ten en cuenta que entonces hay que volver a aplicarlo cada
vez que cambie el dominio de Vercel, y que el síntoma de tenerlo mal es
exactamente el mismo que el de no tenerlo.

Los métodos son solo `GET` y `HEAD`: al bucket se sube por la función, nunca
desde el navegador.
