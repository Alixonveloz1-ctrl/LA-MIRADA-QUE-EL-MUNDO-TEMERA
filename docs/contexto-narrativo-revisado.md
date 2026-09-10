# Contexto narrativo revisado

Relectura completa de las 289 escenas de los doce capítulos guardados en
`datos/guiones.json`, incluidas sus acciones, recuerdos, transiciones y
revelaciones. Contrastada con las identidades de `datos/serie.json`, el opening,
el ending y las reglas de continuidad añadidas durante la implementación.
No se ha reconstruido una versión distinta de la historia ni consultado un
guion externo que no esté disponible en el repositorio.

## Aclaraciones del autor

Estas tres aclaraciones sustituyen las objeciones del análisis anterior:

- La muerte de la madre se muestra en el capítulo 1. Sus apariciones posteriores
  pertenecen al pasado. No significan que vuelva a estar viva en el presente.
- Saharis tiene dieciséis años en el presente. Los recuerdos muestran otras
  edades. No se deduce su edad sumando arbitrariamente capítulos y recuerdos.
- Saharis tararea lo que recuerda de la nana. Nunca la escuchó completa. La
  ejecución incompleta es parte de la historia y no debe completarse para corregirla.

No se inventan supervivencias, otra madre, escenas explicativas, cumpleaños ni
un orden cronológico nuevo. El orden de presentación es parte del relato.

## Recorrido completo de la temporada

| Capítulo | Historia actual y revelación | Pasado y continuidad que debe preservarse |
|---|---|---|
| 1. El que no llora | Saharis obtiene información en Elserath, detecta el anillo, investiga Renn y llega a la puerta bajo la ciudad sin entrar. | Ritual, recién nacido y recuerdo de la nana en la celda. La madre no aparece en la cena. La ropa noble cambia por ropa de barrio en el portal. El refugio es una habitación seca con farol y pared de investigación. |
| 2. El precio del apellido | Usa deudas para obtener el apellido Elserath; prepara una identidad de respaldo, investiga el sótano en uso y empieza a preguntar de dónde era su madre. | Niño de cinco años, advertencia sobre ocultar lo que es, nana y abrazo. No convertir lo que recuerda en personas presentes junto a Iven o Livia. La pregunta sobre el origen todavía no tiene respuesta. |
| 3. La Prueba del Fuego | Reconoce el símbolo en el Consejo y comprende que el culto forma parte de la ciudad. Su mapa anterior falla. Encuentra pagos entre Elserath y Vharn. | Academia, mano herida y vendada, aprendizaje oculto y palabra «esclava». El sacerdote de la academia y el Celebrante no se intercambian por ser ancianos. Los asistentes del Consejo y la reunión del sótano no desaparecen durante los detalles. |
| 4. Lo que no se apagó | Reconoce al consejero Vharn por su voz como el Celebrante. Prepara salidas, acaba aceptando el ofrecimiento y se contiene cuando Rothar lo golpea. | Recuerdos de la pérdida de su madre, la marca de propiedad y la salida al bosque. No convertirlos en una nueva muerte en el presente. La herida de la ceja sigue al ataque de Rothar. |
| 5. El bosque no está | Reencuentra a Eira y Kael entre refugiados. Descubre la destrucción del bosque y la relación con su huida. Escribe NUEVE. | Eira curándolo y el ritual de savia lunar pertenecen al bosque del pasado. Eira repartiendo agua es Eira, no la madre. Kael en el campamento lleva muleta. La cena Vharn contrasta con lo que acaba de conocer. |
| 6. Admiración, temor, pérdida | Salva temporalmente el campamento mediante coerción sobre el inspector. Eira descubre el coste humano y lo rechaza. Saharis destruye y reconstruye su pared. | Lago, agresión a Kael y rechazo en el sendero: Saharis niño, Eira joven, Kael sin muleta. El retorno a la orilla recupera a sus versiones actuales. No ilustrar como presente el secuestro solo porque se cuenta en diálogo. |
| 7. El sistema de las Siete Casas | Reorganiza la pared como organigrama, sabotea una ruta, accede a registros, acepta el matrimonio como cálculo y decide heredar el sistema. Encuentra a otra cautiva. | Libro y descubrimiento de los circuitos en el pasado. La embarazada del presente es una mujer distinta de su madre, aunque ocupe el mismo lugar. Saharis cierra su puerta y permanece fuera. |
| 8. El heredero | Administra la rama inferior, desplaza a Deras y explica a Livia cómo usa a las personas. Descubre un traslado con un niño anterior a su nacimiento. La acólita lo confirma. | Sura, su pérdida y los soldados corresponden al pasado. No poner a Sura en el despacho actual ni convertir los hechos relatados por la acólita en una escena presente de nacimiento. |
| 9. El nombre | Rothar distrae a la casa mientras Saharis entra a registros. Descubre Ilmen, Kadre y que su nombre pertenecía al niño anterior. Livia lo impulsa a buscar respuestas. | No hay escenas marcadas como flashback: hablar de su madre y del otro niño no los incorpora físicamente a la habitación. Saharis todavía no sabe el nombre Sera. |
| 10. La que me vio | Viaja al norte, conoce a la abuela, escucha el nombre Sera, presencia una cena cálida, reconoce la nana y se marcha dejando todo su dinero sin revelar quién es. | 16b alterna madre/celda y niña/cocina: tiempos, personas y espacios separados. La nieve está fuera de Ilmen; el pan permanece sin tocar, los circuitos se apagan sin destruir la casa y la bolsa se queda sobre la mesa. |
| 11. El altar vacío | Toma el control: desmantela Renn, derrota a los hombres de Deras, pierde a Eira, hereda tras la muerte de Iven, ve salir a Rothar y mata al Celebrante. | No hay escenas marcadas como flashback. Los cuerpos, las salidas y los objetos retirados deben persistir. No atribuirle a Saharis la muerte de Iven por una deducción que el guion no muestra. No convertir a Deras en otro muerto. |
| 12. La mirada que el mundo temerá | El poder funciona y la casa está vacía. Livia está embarazada; Saharis recibe la carta de Kadre, ayuda al niño, regresa al refugio, intenta cantar y vuelve a trabajar. | El abrazo materno de la escena 18 es pasado. El niño del portal no es automáticamente Saharis niño. La nana queda incompleta; las preguntas arrancadas no reaparecen como papeles, pero queda una inscripción distinta en la piedra. |

## Mapa de recuerdos

El archivo marca 40 escenas como flashback. Una de ellas, 10/16b, contiene además
cortes al presente. Por eso un booleano no describe por sí solo todos sus planos.

| Capítulo | Escenas marcadas como pasado |
|---|---|
| 1 | 1, 2, 15, 17 |
| 2 | 2, 7, 8, 14, 22 |
| 3 | 3, 4, 5, 8, 9, 19 |
| 4 | 5, 6, 7, 8, 16, 23 |
| 5 | 6, 13 |
| 6 | 9, 10, 14, 15, 16, 17 |
| 7 | 6, 7, 8 |
| 8 | 5, 6, 7, 11, 12, 13 |
| 9 | Ninguna |
| 10 | 16b, con alternancia interna al presente |
| 11 | Ninguna |
| 12 | 18 |

La edad de un personaje no depende del número de capítulo. Cada regreso al
presente recupera su vestuario, cuerpo, objetos y posición correspondientes.
No se envejece automáticamente a un personaje por haber visto antes un recuerdo.

## Estados que las referencias no deben reiniciar

La pared del refugio es un objeto narrativo, no decoración intercambiable:

- 1/14: anillo dibujado y SIETE; investigación inicial.
- 2/17 y 2/23: apellido tachado como objetivo cumplido y pregunta sobre la madre.
- 3/18 y 3/20: arranca el mapa equivocado y añade quién la compró.
- 4/17: dibuja la marca y añade de quién era.
- 5/24: escribe NUEVE.
- 6/21–24: destruye toda la pared, llora y la reconstruye.
- 7/1 y 7/17–18: organigrama, compra por Vharn y decisión de heredar el sistema.
- 9/2 y 9/17: línea temporal y niño anterior; las respuestas llegan progresivamente.
- 11/3: retira las tres preguntas y coloca pasos para tomar el control.
- 12/16–17: polvo, preguntas retiradas y una inscripción en piedra que sobrevivió.

Una referencia maestra puede conservar arquitectura y mobiliario. No autoriza a
copiar el estado de la pared de otro capítulo, devolver una bolsa ya entregada,
quitarle la muleta a Kael actual ni devolver a la habitación a quien salió.

Hay tres tratamientos distintos del salón: Elserath ocupado y gastado al inicio,
Ilmen cálido y familiar, y Elserath reformado y vacío al final. «Que no desaparezca
la gente» no equivale a llenar también las escenas que la historia quiere vacías.

El símbolo del culto debe reconocerse entre anillo, puerta, dibujos y documentos.
No debe cambiar a un emblema genérico por compartir un prompt de fantasía.
Las revelaciones del nombre Sera, del niño anterior y del Celebrante deben llegar
en sus escenas, sin anticiparlas mediante rótulos o recuerdos inventados.

La nana dentro de la historia y las canciones del opening/ending son usos
distintos. Una letra aprobada para los créditos no demuestra que Saharis conozca
esas palabras ni autoriza a completar lo que tararea en la escena final. Las
letras aprobadas del opening y ending no se han cambiado.

## Qué rectifiqué en las instrucciones propias

- Retirada la instrucción que dejaba en duda la muerte de la madre.
- Retiradas mis afirmaciones que fijaban una nueva muerte actual o una edad de
  dieciocho para Saharis en el cierre.
- Añadido el canon del autor y la distinción presente/pasado a las reglas que
  llegan al desglose y a la imagen; el vídeo conserva ese primer fotograma. Las anotaciones antiguas y el retrato del
  banco no deciden la edad de la escena.
- Añadida la advertencia expresa de alternancia en 10/16b.
- Retiradas de los informes las tres objeciones que ya aclaró el autor.

No se modificaron las 289 acciones, sus diálogos, orden, marcas de flashback ni
indicaciones temporales del guion fuente. No se cambiaron las imágenes, vídeos,
audio o estado de producción. No hubo despliegue ni generaciones de pago.

## Cierre de la implementación y revisión del material

- **Alternancias resueltas por segmento:** 6/3, 8/8, 10/16b y 12/6 tienen reparto,
  lugar y tiempo por toma. Se exige cubrir los segmentos en orden y se impide
  interpolar entre ellos. La reparación conserva la duración total y el audio.
- **Reparto silencioso:** corregidas también las omisiones de Saharis en 2/18,
  2/24, 3/18 y 3/22. El contexto no sustituye revisar la ocupación visible de las
  escenas completas ni los estados de sus objetos.
- **Texto importado:** se conservan anotaciones antiguas de edad y de la nana en
  el guion fuente; el canon del autor controla las instrucciones visuales.
  El diálogo estructurado de 4/3 menciona diecisiete: no se ha cambiado ese texto
  ni una voz ya generada. Una modificación de audio debe mantener su sincronía.
- **Resultados del modelo:** las miradas, escala, pistas legibles y edades se
  aprueban mirando los keyframes. La revisión del vídeo comprueba además que
  no aparezcan clima, personas u objetos ajenos a la imagen de partida.

El criterio para cualquier modificación siguiente es conservar lo que ocurre,
cuándo lo conoce Saharis y qué recuerda, y corregir únicamente cómo se representa.
