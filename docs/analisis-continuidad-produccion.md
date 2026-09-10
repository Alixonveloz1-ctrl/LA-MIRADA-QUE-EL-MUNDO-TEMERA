# Diagnóstico de continuidad y generación del anime

Fecha: 10 de septiembre de 2026. Estado: análisis terminado; implementación y validación visual de las correcciones pendientes.

## 1. Dictamen y alcance

La aplicación ya tiene banco de personajes, galería de escenarios, archivo reutilizable, aprobación de keyframes y generación imagen-a-vídeo. No necesita sustituir estos sistemas. Le falta una capa que conserve el estado narrativo y espacial de una secuencia y compruebe que cada plano lo respeta.

El problema no se resuelve únicamente añadiendo «no mirar a cámara», «todos los personajes» y «sin lluvia». Hay información incorrecta antes de componer el prompt, instrucciones contradictorias al componerlo y ausencia de verificación semántica después de generar.

Se ha revisado:

- La acción completa de los 12 capítulos: 289 escenas, incluida la escena 16b del capítulo 10. Se han contrastado campos de reparto, localización y ejemplos de diálogo. No se dispone aquí de los documentos originales anteriores a su extracción a JSON.
- El inventario local: 28 placas de escenario —incluido el túnel específico del teaser—, 73 placas de personaje y 56 tomas de archivo. Inventario declarado no equivale a inventario aprobado actualmente en producción.
- El recorrido guion → desglose → pieza guardada → prompt → imagen → aprobación → vídeo → montaje.
- Doce imágenes conservadas de la revisión del capítulo 1: 3-1, 3-3, 4-1, 4-4, 3-4, 4-7, 5-5, 6-9, 7-4, 8-4, 8-10 y 18-2. Son una muestra, no una auditoría visual exhaustiva de todas las tomas.
- Comprobaciones locales sin llamadas a modelos ni gastos de generación.

Base inspeccionada: commit local `28a3fc00ef38cdfdf14ee67ee75c0388289ee4ff`. Esta revisión no certifica que ese commit sea el despliegue actual. No se ha vuelto a descargar la galería completa ni se han reproducido aquí los vídeos actuales: la lluvia en vídeo es un síntoma comunicado por el usuario, cuyo desencadenante en los prompts sí se ha reproducido.

En esta revisión no se ha modificado código, datos de producción, aprobaciones ni archivos generados. Este documento es el único entregable añadido. Se han conservado los cambios locales preexistentes.

## 2. Hallazgos y correcciones necesarias

P0: resolver antes de una regeneración masiva. P1: resolver antes de dar por terminada la producción.

| Prioridad | Hallazgo comprobado | Consecuencia | Corrección propuesta |
|---|---|---|---|
| P0 | `contextoDeLaEscena()` recibe la escena aislada, sin estado de continuidad anterior. | Una conversación nueva puede reiniciar reparto, posiciones y objetos. | Contexto compacto de secuencia con estado inicial/final y conexión entre escenas; conservar llamadas por escena. |
| P0 | `personajesDeEscena()` limpia nombres, pero no distingue presencia física, mención e identidad implícita. `placasDeLaEscena()` depende de esa lista. | Se ofrece una persona equivocada o ninguna referencia del protagonista. | Reparto semántico corregido y versionado: presentes, fuera de campo, mencionados, entradas y salidas. |
| P0 | La instrucción de escenario termina limitando la imagen a las personas que esa toma nombra: “and nobody else”. | Si el prompt solo nombra al hablante, desaparecen los invitados aunque el lugar permanezca. | Ignorar personas accidentales del escenario, pero conservar la ocupación canónica de la secuencia. |
| P0 | `BARRIO` contiene `rain haze`, `wet surfaces` y `no warm source`, también en túneles, celdas y otras habitaciones. | El prompt añade clima e incluso contradice el farol o el fuego del guion. | Separar iluminación, clima, humedad superficial y fenómenos locales; aplicarlos por espacio y momento. |
| P0 | `promptVideo()` concatena movimiento, luz genérica y estilo; no establece qué debe conservar del primer fotograma. | El vídeo puede reinterpretar el ambiente, cambiar ocupación y añadir lluvia. | Encargo de movimiento limitado por la imagen aprobada y la continuidad: qué permanece y qué puede cambiar. |
| P0 | Los ID de escenario no siempre representan el lugar real; además, un mismo ID mezcla subespacios. | La referencia visual puede ser de otra casa, o de un exterior en una escena interior. | Corregir asociaciones y añadir subespacios/variantes vinculados a los maestros existentes. |
| P0 | Reconstruir una pieza conserva material previo por ID de toma, aunque cambie su contenido. | Una imagen aprobada puede quedar asociada a una acción nueva con el mismo ID. | Revisiones y procedencia de activos; migración comparada, sin borrar ni reasignar silenciosamente. |
| P1 | Hay referencias frontales de identidad y encuadres narrativos que parecen retratos; no hay control de destino de mirada. | Los actores se relacionan con el espectador en vez de con la escena. | Mirada hacia interlocutor u objeto, eje de conversación y encuadre explícitos por toma; revisión visual. |
| P1 | El código ya pide proporciones correctas, pero no mantiene una distribución espacial verificable. | Cambian tamaños aparentes, posición y relación con muebles. | Posición relativa a mesa/silla/puerta, postura, altura relativa y cámara coherentes; no repetir un plano general como fondo universal. |
| P1 | Edad, vestuario y estados físicos no están completamente diferenciados en las referencias ofrecidas. | Adultos en recuerdos, ropa noble en el barrio o Kael lesionado antes de lesionarse. | Variantes necesarias de identidad, edad, vestuario y estado; no regenerar todo el banco. |
| P1 | Algunas líneas de `dialogo` están recortadas respecto a `accion`. | Voz, actuación y duración pueden perder información narrativa. | Reconciliar con el guion fuente y marcar únicamente los bloques de voz/timing afectados. |
| P1 | Los chequeos actuales validan estructura, referencias y duración, no el resultado cinematográfico. | Un desglose incoherente puede superar todas las pruebas. | Validaciones semánticas y revisión visual de secuencias, además de los tests existentes. |

Las dos láminas de muestra permiten observar la pérdida de invitados entre 3-1 y 3-3/4-4, la relación problemática personaje–mesa en 4-1 y la repetición de composiciones frontales. También merece revisión la luminosidad de las ventanas: el banquete es nocturno. Por ello, 3-1 no queda proclamada automáticamente como maestro correcto solo porque tenga invitados.

## 3. Errores de datos con ejemplos verificables

| Capítulo/escena | Dato actual | Lo que exige la acción |
|---|---|---|
| 1/14 | `personajes: []` | Saharis dibuja el anillo y lo fija en la pared. No desaparece por no hablar. |
| 1/17 | Solo `madre` | Madre y Saharis de tres o cuatro años; el rostro de ella no se muestra. |
| 1/19 | Saharis y vendedora | Tres conversaciones sucesivas: vendedora, mozo y niño. No reunirlos artificialmente en una sola conversación. |
| 2/16 | Incluye `madre` | Hablan Livia y Saharis; su madre es mencionada, no está allí. |
| 3/1 | Incluye `madre` | Consejo con cuarenta hombres y mujeres, Iven y Saharis; no es una aparición de su madre. |
| 4/11 | Ofrece anciano de academia y Celebrante | La presentación y el reconocimiento conducen al Celebrante, no a intercambiar dos identidades ancianas. |
| 4/13 | `elserath-jardin` | Continúa el jardín de Vharn de 4/12. |
| 5/9 | Solo `madre` | La mujer de pelo plateado es Eira, que ve a Saharis. |
| 7/22 y 8/2 | Ofrece `madre` | Es otra mujer embarazada cautiva; la semejanza de situación no la convierte en Sera. |
| 9/13 | La acción acaba en «dos palabras:»; el reparto contiene `saharis ilmen.` | Falta reconstruir el texto de la revelación desde su fuente. No tratar una inscripción como un actor adicional. |
| 10/7 | Incluye `madre` | Abuela y Saharis; los pómulos evocan a la madre ausente. |
| 10/9–14 y 10/21 | `elserath-cocina`, siete escenas | Cocina de Casa Ilmen, en Kadre, que empieza en 10/8. |
| 11/21 | Ofrece `anciano-academia`, no Celebrante | Continúa el enfrentamiento con el Celebrante de las escenas anteriores. |
| 12/7 | `cripta` | Albañiles tapiando la puerta desde el callejón; necesita el exterior correspondiente. |

Otra conexión a resolver: 1/23–24 usa `calle` para la puerta bajo la ciudad; 2/1 dice expresamente que es la puerta final del capítulo anterior, pero la asigna a `casa-renn`. No se deben generar dos accesos visualmente inconexos para una continuidad explícita.

Ejemplos de diálogo incompleto:

| Escena/personaje | Final guardado en `dialogo` | Continuación presente en `accion` |
|---|---|---|
| 1/4, Rothar | «…y al día» | «siguiente cenaba aquí.» |
| 1/4, Saharis | «…Es su» | «obligación.» |
| 1/6, Iven | «…y sin un solo» | «hombre perdido.» |
| 1/9, Saharis | «…lleva dos semanas» | «contento.» |
| 1/9, Saharis | «…Si quiere, hablo con» | «el administrador y le adelanta el primer trimestre.» |
| 2/22, madre | «…antes de que» | «fueras dios.» |

`traducirAJapones()` actualmente da por intencionales las frases cortadas e incluso cita el ejemplo de Iven. Ese comentario no resuelve la contradicción con la acción completa. No hay que completar toda frase automáticamente: existen interrupciones legítimas. Hay que distinguirlas contrastando el guion original. Estos ejemplos confirman discrepancias; no constituyen un recuento exhaustivo de líneas afectadas.

## 4. Qué historia debe conservar la aplicación

El arco no es una sucesión de retratos de un protagonista poderoso. Saharis aprende a controlar un sistema y termina heredándolo, mientras pierde o instrumentaliza sus vínculos humanos. Las miradas, silencios, posiciones y acciones pequeñas transportan información que no debe sustituirse por sonrisas a cámara ni espectáculo mágico genérico.

| Bloque | Progresión narrativa | Continuidad visual clave |
|---|---|---|
| 1–3 | Del ritual y la infiltración en Elserath al apellido adquirido y al descubrimiento de que el culto forma parte de la ciudad. | Cambio de ropa, anillo del culto, puerta recurrente, libros y pared de investigación. |
| 4–6 | Reconocimiento del Celebrante, memoria de la madre, Eira y el bosque; ayuda al campamento mediante coerción y rechazo moral de Eira. | Edades de recuerdos, Kael joven sin muleta, Eira a los dieciséis frente a la adulta, pared destruida y reconstruida. |
| 7–9 | Decide heredar el sistema, accede a los registros y descubre al niño anterior cuyo nombre recibió. | Organigrama de siete casas, textos legibles de los registros, cautiva distinta de su madre, gestos contenidos. |
| 10 | Encuentra a los Ilmen, conoce el nombre Sera y reconoce la nana en una familia corriente; no ejecuta su amenaza y deja su dinero. | Kadre nevado, casa de madera cálida, once comensales, niña de seis años, mismo motivo musical con significado distinto. |
| 11–12 | Toma el poder, pierde vínculos, mata al Celebrante y gobierna; vuelve al refugio, canta, llora y regresa al trabajo. | Ausencias definitivas, casa reformada y vacía, Livia embarazada, pared envejecida y preguntas arrancadas. |

Invariantes narrativas:

- El símbolo del culto es círculo, ojo y cuatro dientes. Debe reconocerse en anillo, dibujo y puerta. No confundirlo por defecto con el anillo de sello personal de Saharis.
- El Celebrante enmascarado y el consejero cotidiano son la misma identidad en situaciones distintas. No confundirlo con el sacerdote anciano de la academia.
- El parecido de pómulos entre madre, Saharis y abuela es una pista, no una licencia para intercambiar sus caras.
- La pared del refugio tiene historia: papeles arrancados, reconstrucción, organigrama y preguntas eliminadas. Una referencia de arquitectura no debe restaurar automáticamente una versión antigua de los papeles.
- Elserath pasa de una cena viva, gastada y con vajilla desigual a una casa reformada, armoniosa y vacía. «Siempre llena» sería tan incorrecto como el vacío del capítulo 1.
- La nana es un motivo reconocible entre madre, niña de Kadre y Saharis. La ejecución y el idioma cambian de significado, no debe convertirse en tres canciones sin relación.

### Aclaraciones del autor incorporadas tras la relectura

1. **Madre:** el autor confirma su muerte mostrada en el capítulo 1 y que sus apariciones posteriores son recuerdos. No representarla viva en el presente ni inventar otra madre o una explicación cronológica.
2. **Edad:** Saharis tiene dieciséis años en el presente, según el autor; las edades anteriores pertenecen a recuerdos. Las anotaciones antiguas de edad en los archivos no sustituyen esta aclaración.
3. **Nana:** recuerda y tararea fragmentos; nunca la escuchó completa. No añadirle una letra o un final que no conoce.

Se retiran las tres objeciones del análisis anterior. La lectura completa, sus límites y las consecuencias para la generación se documentan en `docs/contexto-narrativo-revisado.md`.

## 5. Continuidad exigida en el capítulo 1

La siguiente tabla especifica estados y transiciones, no propone regenerar cada fila ni crear un maestro por escena.

| Escena | Espacio/tiempo | Qué debe mantenerse o cambiar |
|---|---|---|
| 1–2 | Cripta, noche, recuerdo | Ritual con seis o siete figuras, Celebrante, madre y recién nacido según la acción; muerte de la madre confirmada por el autor, con cobertura no gráfica. |
| 3 | Elserath, cena nocturna | Veinte invitados; Saharis en un extremo, Iven en cabecera, conversaciones y vajilla desigual. |
| 4 | Misma cena, continuo | Rothar interviene ante la mesa ocupada; reacciones dirigidas entre personajes. No reiniciar el comedor. |
| 5 | Mismo salón, más tarde | Saharis y Livia junto a la ventana; libro y criado con bandeja. Es un desplazamiento legítimo, no obligarlos a seguir sentados. |
| 6 | Mismo salón, más tarde | Iven relata su viaje; Saharis escucha. La nieve pertenece al relato, no al clima del salón. |
| 7 | Misma cena | Invitado se quita el guante; mano y anillo del culto reconocibles; Saharis lo observa. |
| 8 | Misma cena | Saharis se sienta junto al invitado y le sirve vino. Conservar quién sirve a quién, asiento, mano y copa. |
| 9 | Cocina Elserath, noche | Cocinero y olla; Saharis en el marco, sin entrar. Sale y deja al cocinero mirando la puerta vacía. Administrador e hija son menciones. |
| 10 | Jardín, noche fría | Rothar es más grande, no gigantesco; discusión, salida de Saharis y Rothar solo al final. |
| 11 | Calle alta, madrugada | Descenso gradual hacia el barrio; Saharis a pie, perro que no ladra. |
| 12 | Portal del barrio, madrugada | Entra vestido de noble y sale con abrigo basto; ropa buena enrollada. Tres hombres pasan sin mirarlo. |
| 13 | Refugio subterráneo, madrugada | Habitación pequeña y seca, piedra húmeda, un farol, mesa, jergón y pared de investigación. Saharis se sienta. |
| 14 | Mismo refugio, continuo | Dibuja y fija el símbolo; revelación de la palabra SIETE. Sin perder su identidad por falta de diálogo. |
| 15 | Cripta, recuerdo | Acólita, recién nacido y Celebrante. Es otra época: no usar el último frame del refugio como continuidad espacial. |
| 16 | Refugio, amanecer | Retoma a Saharis sentado sin haberse movido. Una gota localizada del techo, no lluvia dentro de la habitación. |
| 17 | Celda, recuerdo | Madre sin rostro visible y niño de tres/cuatro años. Preservar melodía, edad y abrazo. |
| 18 | Refugio, día | Saharis quema una nota en el farol, mira cómo arde y se levanta. No posar mostrando fuego al espectador. |
| 19 | Mercado, día | Mantener multitud; tres encuentros separados, moneda y anotación RENN. Sigue vestido de pobre. |
| 20–21 | Exterior Renn, día a noche | Mismo escalón, cuenco y casa; espera, llegada del carro con seis barriles, hombre del delantal y criados. |
| 22 | Callejones, noche | Sigue al mismo hombre a media calle de distancia. El carro se marcha vacío. |
| 23–24 | Puerta bajo la ciudad, noche | El hombre llama, entra y la puerta se cierra; Saharis sale de la sombra y toca el símbolo. Saharis no entra en este final. |

**Encuadre no equivale a ocupación:** en un primer plano no tienen que verse los veinte invitados. Deben seguir existiendo donde corresponda, fuera de campo u ocultos; si el fondo muestra sus asientos, no pueden desaparecer sin motivo. Tampoco se deben congelar posiciones a través de saltos temporales o desplazamientos escritos.

## 6. Diseño técnico de la corrección

### A. Ficha de continuidad, previa al desglose

Crear una representación versionada de cada secuencia y escena, vinculada al guion. Campos mínimos:

- Localización canónica, subespacio, interior/exterior, día/noche y rama temporal —presente o recuerdo—.
- Estado de entrada y salida; escenas conectadas, incluido retorno a una escena interrumpida por un flashback.
- Personas presentes y sus identidades; figurantes y ocupación; personas mencionadas pero ausentes.
- Edad, vestuario y estado físico de personajes; posiciones relativas y cambios autorizados.
- Objetos relevantes, propietario/mano, estado antes y después; arquitectura estable separada del atrezo mutable.
- Fuente de luz, clima exterior, precipitación visible, humedad y goteos locales por separado. «No definido» no se convierte en lluvia.
- Acción visible, intención y destinatario de mirada; hechos que no deben inventarse.
- Fuente de cada dato y ambigüedades pendientes. No rellenar contradicciones con suposiciones silenciosas.

Resolver `CONTINUO` y `MÁS TARDE` con el contexto narrativo, no con una búsqueda de palabras. En escenas de montaje o alternancia —por ejemplo 10/16b— cada plano puede pertenecer a un subespacio/tiempo diferente: la regla actual de un único escenario y una única luz por escena necesita admitir variantes justificadas, no lugares arbitrarios.

### B. Reutilizar correctamente la galería existente

Separar tres funciones de referencia:

1. **Identidad:** cara, pelo, ojos, complexión. Un retrato frontal es válido para esta función; no ordena que el actor mire a cámara en la historia.
2. **Escenario:** arquitectura, distribución y materiales. Conservar los maestros existentes que sirvan. Revisar variantes necesarias de interior/exterior, subespacio, época y estado.
3. **Continuidad de la secuencia:** ocupación y distribución aprobadas, cuando haga falta. Puede reutilizarse un keyframe existente si es correcto y compatible. No elegir automáticamente la primera imagen disponible ni heredar el frame anterior a través de un flashback.

No imponer una nueva generación maestra por cada escena ni cargar todos los personajes como referencias en cada primer plano. Usar el grupo visible pertinente y los límites del modelo configurado; la población del fondo debe quedar establecida aunque no todos tengan placa propia.

La toma debe poder cambiar de cámara manteniendo la geometría: un contraplano no consiste en pegar al actor grande delante de la misma fotografía general. Si las referencias actuales no dan suficiente información de un ángulo/subespacio, derivar una variante y aprobarla, sin sustituir toda la galería.

### C. Composición y validación de prompts

El encargo de imagen debe incluir encuadre, punto de cámara, posiciones, dirección de mirada, acción detenida, población visible, objetos y condiciones de luz concretas. No prohibir todo plano frontal: un plano frontal puede estar dirigido a otro personaje. Lo que debe evitarse por defecto es la relación con el espectador.

El encargo de vídeo debe describir el movimiento permitido desde la imagen aprobada. Conservar distribución, identidad, escala, iluminación y clima salvo cambios expresamente previstos. La regla no debe congelar a quien entra, sale, se levanta, sirve vino o cambia de ropa según el guion.

Eliminar conflictos antes del envío: por ejemplo, «habitación seca con farol» contra «rain haze, no warm source». Separar el estilo artístico estable de la atmósfera de cada escena. La escena cálida de los Ilmen no debe volverse oscura y hostil solo porque el sello global exige sombras duras y paleta fría.

Añadir validación a los desgloses dinámicos y al encargo final antes de cada generación. Comprobar reparto, edad, escenario, estados, miradas y cambios permitidos; detectar dudas sin fingir que una expresión regular entiende toda la historia. La revisión visual posterior sigue siendo necesaria.

### D. Escritura legible y contenido sensible

SIETE, RENN y los textos de registros son información narrativa. El negativo global contiene `text`; el montador actual ofrece subtítulos y cartela, no un sistema general de escritura integrada en objetos con perspectiva y seguimiento. Reservar una solución de composición localizada o inserto aprobado para esas pistas; no confiar en letras generadas al azar ni activar texto en todos los planos.

Las escenas de parto, violencia, menores y trauma requieren cobertura genuinamente no gráfica: sonido, reacción, objeto o acción fuera de campo cuando corresponda. No basta renombrar sangre o heridas. No rebajar salvaguardas ni cambiar edades para forzar aceptación. Registrar el motivo real del proveedor y detener reintentos idénticos. Ninguna redacción garantiza la aceptación de todos los casos.

### E. Persistencia, cola y montaje

Guardar por intento la revisión de guion/desglose, prompt final, referencias efectivamente usadas, configuración del modelo y keyframe de origen del vídeo. Evitar confundir el ID de toma con la identidad inmutable de su contenido.

Cambiar el keyframe aprobado conserva hoy el clip elegido después de una advertencia. Para una reparación de continuidad, los clips incompatibles deben quedar señalados como pendientes de revisar: conservados en el historial, pero sin incorporarse silenciosamente a un montaje nuevo como si procedieran de la imagen corregida.

El servidor comprueba que existe una aprobación, pero recibe los bytes de imagen desde el cliente. Debe asociar el vídeo a la revisión/ruta exacta utilizada y comprobar que sigue vigente; si cambia durante la cola, no atribuirle después otra imagen.

Si se añaden dependencias entre keyframes, implementarlas en servidor, cola y pantalla: detectar referencias ausentes, errores y ciclos; mostrar por qué una toma espera. No crear un requisito oculto que bloquee el botón. Revisar además el caso de encadenado hacia una toma de archivo: la pantalla contempla su material compartido, mientras el ejecutor de cola consulta actualmente la clave del episodio.

### Superficie de implementación

| Área | Archivos/funciones revisados | Trabajo previsto |
|---|---|---|
| Datos y canon | `datos/guiones.json`, `datos/serie.json`, `herramientas/parche-datos.mjs` | Correcciones trazables, variantes y ficha de continuidad; respetar el flujo de datos generado documentado. |
| Desglose | `api/_lib/datos.js`: `personajesDeEscena`; `api/_lib/texto.js`: contexto, referencias, normalización y reglas | Contexto narrativo y espacial, referencias correctas, nueva validación y conservación de campos. |
| Ensamblado | `app/pantallas/desglose.js`: `armarLaPieza`, `vozDelEpisodio` | Transportar los nuevos campos y revisar compatibilidad sin reasociar material por ID. |
| Prompts y generación | `api/_lib/prompt.js`, `api/_lib/modos.js`, `api/_lib/imagen.js`, `api/_lib/veo.js` | Encargos coherentes, referencias según propósito, procedencia del frame y validación previa. |
| Trabajo y aprobación | `app/cola.js`, `app/pantallas/tomas.js`, estado cliente/servidor | Dependencias, revisiones, indicadores de material anterior y aprobación explícita. |
| Montaje | `app/pantallas/montaje.js`, `api/_lib/montaje.js`, `montador/montador.mjs` | Comprobar compatibilidad; plan separado para texto diegético, sin romper voces ni duración. |

## 7. Qué hacer con lo ya generado

No se prescribe regenerar todos los keyframes ni conservarlos todos. Cambiar prompts no corrige imágenes existentes. Hay que revisar el episodio completo contra el nuevo contrato de continuidad y clasificar cada toma:

| Estado | Acción |
|---|---|
| Imagen correcta y compatible con la secuencia | Conservar; no gastar otra generación. |
| Imagen incorrecta en mirada, población, escala, identidad, lugar o estado | Corregir su especificación y producir una nueva versión; mantener el original. |
| Imagen correcta, vídeo con lluvia u otra deriva | Conservar keyframe y corregir/regenerar únicamente vídeo. |
| Referencia maestra incorrecta | Reparar o crear la variante concreta; revisar dependientes, no invalidar toda la temporada. |
| Duda de guion o de procedencia | Pendiente de decisión/revisión; no convertir la duda en aprobación automática. |

Antes de migrar: conservar una instantánea recuperable de estado, desgloses, rutas aprobadas y selección de clips. Preparar una comparación previa de cambios. Mantener ID, orden, duraciones y audio cuando la corrección sea solo visual. Si una línea de diálogo recuperada cambia la duración, tratarlo como revisión específica y comprobar sincronía, recortes y encadenados.

No solicitar otro desglose completo sin esta protección: actualmente puede sobrescribir el JSON de escena y reconstruir tomas con los mismos nombres pero distinto significado.

Con la muestra revisada hay motivos claros para rehacer varias imágenes del comedor. No hay evidencia suficiente para dar un número definitivo de imágenes aprovechables de toda la galería actual.

## 8. Verificación y criterio de aceptación

### Comprobaciones realizadas en esta revisión

- `node herramientas/invariantes.mjs`: 64 comprobaciones correctas, 11 avisos.
- `node herramientas/probar-piezas-estado.mjs`: correcta integración estructural de piezas dinámicas.
- `node herramientas/probar-veo.mjs`: correctas las pruebas existentes de recuperación de operaciones con modelos/niveles distintos.
- Reproductor local de solo lectura: una toma sintética de habitación seca y farol obtiene `rain haze` y `no warm source` en los prompts finales; la referencia de escenario exige únicamente las personas nombradas. También se confirmó que 1/14 no ofrece referencias de personajes y 5/9 ofrece la madre en vez de Eira. Sin llamadas de generación.

Estos resultados no validan la cinematografía. Los invariantes se apoyan en las piezas locales de `serie.json`; no son una inspección visual del episodio dinámico guardado en producción. Tampoco la regla local de palabras sensibles garantiza qué aceptará Google.

### Pruebas necesarias al implementar

| Caso | Resultado exigido |
|---|---|
| Cena 1/3→4 | Los planos del mismo instante conservan ocupación, asientos y miradas hacia interlocutores. |
| Ventana 1/5 y servicio 1/8 | Permitir desplazamientos narrados; no invertir quién sirve vino. |
| Primer plano de conversación | Fondo compatible con la mesa ocupada; no exigir ver a todos ni mirar al público. |
| Refugio 1/13→14→15→16 | El flashback no contamina la habitación; retorno a la misma posición y estado. |
| Agua y clima | Interior seco sin lluvia; goteo localizado 1/16 permitido; nieve de Kadre conservada; nieve relatada por Iven no aparece en el salón. |
| Identidades | Eira en 5/9, otra cautiva en 7/22, Celebrante en 11/21; menciones a la madre no la hacen aparecer. |
| Espacios y edad | Cocina Ilmen en 10/9; jardín Vharn en 4/13; Kael joven sin muleta; niño y adulto no intercambiados. |
| Datos nuevos | Normalizador, API, guardado, ensamblado y cola conservan todos los campos de continuidad. |
| Activos viejos | Cambiar especificación o frame no aprueba automáticamente el clip anterior; original recuperable. |
| Cola | Dependencia ausente explicada, ciclos rechazados, encadenado a archivo resuelto, frame exacto registrado. |
| Diálogo y pistas | No perder palabras verificadas ni introducir texto ilegible en revelaciones narrativas. |
| Seguridad | Cobertura no gráfica validada antes de generar; rechazo documentado, sin reintentos idénticos automáticos. |

### Piloto visual propuesto, todavía no autorizado ni ejecutado

Preparar un máximo inicial de ocho keyframes dirigidos a los problemas: cuatro del banquete —general nocturno, intercambio, ventana y servicio de vino—, cocina con Saharis en el umbral, refugio antes/después del recuerdo y persecución hacia la puerta. Reutilizar imágenes existentes cuando superen la revisión. Después, solo sobre imágenes aprobadas, tres clips de prueba: cena, interior seco y goteo localizado.

Mostrar antes la lista exacta, número máximo de intentos y coste estimado según la configuración vigente. No cambiar de modelo ni resolución sin motivo y aprobación. Detener el lote si reaparece el mismo fallo; no convertir una prueba en regeneración masiva.

Criterios visuales: sin ausencias inexplicables, sin teletransporte, escala coherente, identidad y vestuario correctos, miradas con destinatario, luz y clima previstos, acciones y objetos fieles. Revisar secuencias y cortes, no solo imágenes sueltas; en vídeo comprobar inicio, desarrollo y final, no únicamente el primer frame.

**Puerta de salida:** pruebas estructurales y semánticas correctas, piloto aprobado visualmente, migración reversible y listado completo de tomas a conservar/rehacer. Solo entonces ampliar la regeneración. Un prompt mejor reduce fallos; no garantiza por sí solo continuidad profesional.

## 9. Orden de ejecución recomendado

1. Aplicar las aclaraciones del autor y proteger el material actual.
2. Corregir los datos narrativos y asociaciones de referencias; construir la continuidad del capítulo 1 y los casos de regresión de la temporada.
3. Implementar propagación de contexto, prompts, validadores, revisiones y señalización de material incompatible.
4. Ejecutar las pruebas sin coste de generación y revisar los encargos finales.
5. Ejecutar el piloto acotado tras aprobar su gasto; evaluar imagen y vídeo.
6. Auditar la galería completa y regenerar únicamente lo necesario, incluyendo dependientes incompatibles.

El análisis queda cerrado con causas reproducidas, alcance de corrección y criterios de aceptación. La reparación no está implementada ni validada visualmente todavía.
