// Prueba de que un subtítulo dice lo que se está oyendo mientras se oye.
//
// POR QUÉ EXISTE. Se montó el teaser y los subtítulos salieron mal de una forma
// que nadie había previsto. No estaban desplazados: estaban ENTEROS. La madre
// dice, despacio y con dos pausas largas de por medio:
//
//     «No dejes que te vean … este lugar … destruye lo que brilla»
//
// y en pantalla aparecía la frase completa desde la primera palabra y se quedaba
// hasta la última. Durante los dos segundos de la segunda pausa, el texto que se
// leía era el de algo que ya se había dicho y el de algo que todavía no se había
// dicho, a la vez. Eso no se arregla escribiendo a mano dónde se corta cada
// frase: son doce episodios, y quien lo pidió lo dijo con todas las letras —«la
// idea es que se ponga automático»—.
//
// Las pausas las mide el audio (eso se prueba en probar-audio.mjs). Lo que se
// prueba AQUÍ es lo otro: qué palabras españolas le tocan a cada pausa. No se
// puede alinear palabra a palabra —el audio va en japonés y el subtítulo en
// español— así que se reparte en proporción a lo que dura cada pedazo,
// prefiriendo cortar donde el español ya tiene una coma o un punto.
//
// Y SE PRUEBA CON LA FRASE DE VERDAD, la del teaser, contra el resultado que se
// pidió. Si algún día alguien toca el reparto y esa frase deja de partirse en
// esos tres pedazos, esto se pone rojo.

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

/**
 * Carga `app/pantallas/montaje.js` sin sus importaciones y sin DOM. Lo que se
 * prueba son cuentas, no pintura: `h()` y compañía no llegan a llamarse.
 */
async function traerDelMontaje() {
  const codigo = readFileSync(`${RAIZ}app/pantallas/montaje.js`, 'utf8').replace(
    /^import[\s\S]*?from\s+'[^']*';$/gm,
    ''
  );
  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-subtitulos-'));
  const archivo = join(carpeta, 'montaje-suelto.mjs');
  // Lo que viene de la pantalla de Audio se presta aquí en pequeño: agrupar las
  // líneas por personaje es todo lo que hace falta para probar esto, y traer el
  // módulo entero arrastraría medio estudio.
  const PRESTADO = `
const h = () => ({}), aviso = () => ({}), boton = () => ({}), tarjeta = () => ({});
function lineasDeVoz(pieza) {
  return ((pieza.audio || {}).voz || [])
    .map((l) => ({ quien: String(l.quien), ja: String(l.ja), es: String(l.es),
                   t: Number(l.t), hasta: Number(l.hasta), escena: null, intencion: null }))
    .sort((a, b) => a.t - b.t);
}
function bloquesDeVoz(pieza) {
  const porQuien = new Map();
  for (const l of lineasDeVoz(pieza)) {
    if (!porQuien.has(l.quien)) porQuien.set(l.quien, []);
    porQuien.get(l.quien).push(l);
  }
  return [...porQuien.entries()].map(([q, ls]) => ({ id: q, personajes: [q], lineas: ls, escena: null }));
}
`;
  writeFileSync(
    archivo,
    PRESTADO +
      codigo.replace(/^export (?=(async )?function |const |class )/gm, '') +
      '\nexport { partirElSubtitulo, juntarLosMasCortos, respiraDespuesDe,\n' +
      '  bocasQueHablan, claveDeLinea, pideMoverLaBoca, construirModelo,\n' +
      '  pisaAOtroPersonaje, vozEquivocadaDebajoDe, mudezDebajoDe };\n'
  );
  return import(pathToFileURL(archivo).href);
}

const {
  partirElSubtitulo, juntarLosMasCortos, respiraDespuesDe,
  bocasQueHablan, claveDeLinea, pideMoverLaBoca, construirModelo,
  pisaAOtroPersonaje, vozEquivocadaDebajoDe, mudezDebajoDe
} = await traerDelMontaje();

/** La serie de verdad, para probar contra los datos que se van a montar. */
const serie = JSON.parse(readFileSync(`${RAIZ}datos/serie.json`, 'utf8'));

let bien = 0;
let mal = 0;

function comprobar(que, hacer) {
  try {
    hacer();
    bien += 1;
    console.log(`  ✓ ${que}`);
  } catch (fallo) {
    mal += 1;
    console.log(`  ✗ ${que}`);
    console.log(`      ${fallo.message}`);
  }
}

/** Los textos que salen, en orden, para poder compararlos de un vistazo. */
function textos(pedazos) {
  return pedazos.map((uno) => uno.texto);
}

console.log('\nEL SUBTÍTULO SE PARTE POR DONDE SE CALLA\n');

comprobar('La frase del teaser sale partida exactamente como se pidió', () => {
  // Los tiempos son los del audio: habla, calla setecientas milésimas, habla,
  // calla nueve décimas, y remata.
  const tramo = {
    inicio: 0.2,
    fin: 5.8,
    trozos: [
      { inicio: 0.2, fin: 1.3 },
      { inicio: 2.0, fin: 3.2 },
      { inicio: 4.1, fin: 5.8 }
    ]
  };

  const salida = partirElSubtitulo('No dejes que te vean. Este lugar destruye lo que brilla.', tramo);
  const esperado = ['No dejes que te vean.', 'Este lugar', 'destruye lo que brilla.'];

  if (textos(salida).join(' | ') !== esperado.join(' | ')) {
    throw new Error(`sale «${textos(salida).join(' | ')}»`);
  }
});

comprobar('Cada pedazo se queda puesto hasta que entra el siguiente', () => {
  // Si cada uno se quitara al acabar su voz, la pantalla se quedaría en blanco
  // durante la pausa —que es de casi un segundo— y eso se ve como un parpadeo.
  const tramo = {
    inicio: 0,
    fin: 6,
    trozos: [{ inicio: 0, fin: 1 }, { inicio: 2, fin: 3 }, { inicio: 4, fin: 6 }]
  };

  const salida = partirElSubtitulo('uno dos tres cuatro cinco seis', tramo);
  for (let i = 0; i < salida.length - 1; i += 1) {
    if (salida[i].fin !== salida[i + 1].inicio) {
      throw new Error(`hay un hueco entre el ${i + 1} y el ${i + 2}`);
    }
  }
  if (salida[salida.length - 1].fin !== tramo.fin) throw new Error('el último no llega al final');
  if (salida[0].inicio !== tramo.inicio) throw new Error('el primero no empieza con la línea');
});

comprobar('Una línea sin pausas sigue siendo UN subtítulo, como toda la vida', () => {
  const salida = partirElSubtitulo('Una frase dicha del tirón', { inicio: 1, fin: 3, trozos: [] });
  if (salida.length !== 1) throw new Error(`sale en ${salida.length} pedazos`);
  if (salida[0].inicio !== 1 || salida[0].fin !== 3) throw new Error('cambia los tiempos de la línea');
  if (salida[0].texto !== 'Una frase dicha del tirón') throw new Error('cambia el texto');
});

comprobar('Con más pausas que palabras, ningún pedazo se queda vacío', () => {
  const tramo = {
    inicio: 0,
    fin: 6,
    trozos: [{ inicio: 0, fin: 1 }, { inicio: 2, fin: 3 }, { inicio: 4, fin: 6 }]
  };
  const salida = partirElSubtitulo('Ven aquí', tramo);

  if (salida.length > 2) throw new Error(`sale en ${salida.length} pedazos y solo hay 2 palabras`);
  for (const pedazo of salida) {
    if (!pedazo.texto.trim()) throw new Error('un pedazo sin texto');
    if (!(pedazo.fin > pedazo.inicio)) throw new Error('un pedazo sin duración');
  }
});

comprobar('Una sola palabra no se parte por mucha pausa que haya', () => {
  const tramo = { inicio: 0, fin: 4, trozos: [{ inicio: 0, fin: 1 }, { inicio: 3, fin: 4 }] };
  const salida = partirElSubtitulo('Corre', tramo);
  if (salida.length !== 1) throw new Error(`parte una palabra en ${salida.length}`);
  if (salida[0].texto !== 'Corre') throw new Error(`dice «${salida[0].texto}»`);
});

comprobar('Un texto vacío no inventa subtítulos', () => {
  const tramo = { inicio: 0, fin: 4, trozos: [{ inicio: 0, fin: 1 }, { inicio: 3, fin: 4 }] };
  const salida = partirElSubtitulo('', tramo);
  if (salida.length !== 1 || salida[0].texto !== '') throw new Error(JSON.stringify(salida));
});

comprobar('El pedazo que dura más se lleva más texto', () => {
  const tramo = {
    inicio: 0,
    fin: 10,
    trozos: [{ inicio: 0, fin: 1 }, { inicio: 1.5, fin: 10 }]
  };
  const salida = partirElSubtitulo('uno dos tres cuatro cinco seis siete ocho', tramo);
  const corto = salida[0].texto.split(' ').length;
  const largo = salida[1].texto.split(' ').length;
  if (!(largo > corto)) throw new Error(`${corto} palabras en 1 s y ${largo} en 8,5 s`);
});

comprobar('Juntar los más cortos deja el número que se pide y no pierde tiempo', () => {
  const juntos = juntarLosMasCortos(
    [{ inicio: 0, fin: 3 }, { inicio: 3.2, fin: 3.4 }, { inicio: 4, fin: 7 }],
    2
  );
  if (juntos.length !== 2) throw new Error(`quedan ${juntos.length}`);
  if (juntos[0].inicio !== 0) throw new Error('se pierde el principio');
  if (juntos[juntos.length - 1].fin !== 7) throw new Error('se pierde el final');
});

comprobar('Se sabe cuándo el español ya respira, con cierres o sin ellos', () => {
  for (const palabra of ['vean.', 'lugar,', 'dijo:', 'quizá…', '¿sí?', 'vean.»', 'brilla."']) {
    if (!respiraDespuesDe(palabra)) throw new Error(`«${palabra}» debería respirar`);
  }
  // Un cierre a secas NO es una pausa: «brilla"» sin punto delante es una
  // palabra entrecomillada a mitad de frase, no un sitio por donde cortar.
  for (const palabra of ['lugar', 'destruye', 'brilla', 'brilla"']) {
    if (respiraDespuesDe(palabra)) throw new Error(`«${palabra}» no debería respirar`);
  }
});


// ---------------------------------------------------------------------------
// La boca manda: si se ven los labios moviéndose, la voz entra con ellos
// ---------------------------------------------------------------------------
//
// POR QUÉ EXISTE ESTA PARTE. «Estamos viendo los labios como que está hablando,
// pero no se escucha la voz, se escucha al rato.» Eso es el teaser montado, y es
// literalmente lo que decían los datos: el plano B2 es un primerísimo plano de
// los labios de la madre moviéndose, va del segundo 21 al 25, y su línea estaba
// escrita en el 24.
//
// Y HAY UNA TRAMPA JUSTO AL LADO, que estuvo a punto de costar un fallo peor que
// el que se estaba arreglando. «boca_visible» dice de quién es la boca que está
// EN CUADRO. NO dice que esté hablando. En el mismo teaser:
//
//     B2  «her lips move continuously as she speaks»          → habla
//     D5  «He turns his head to camera. Nothing else moves.»  → callado
//
// D5 es un retrato de Saharis mirando a cámara sin decir nada. Llevarle su frase
// «para cuadrar la boca» habría puesto la voz sobre unos labios parados, que es
// exactamente lo que prohíbe la regla de la boca del contrato (§6.6).
//
// Las dos cosas se prueban aquí y CON LOS DATOS DE VERDAD, no con un ejemplo de
// juguete: si alguien reescribe el teaser y esto deja de cumplirse, se pone rojo.

/** El ámbito de una pieza entera, que es como se monta el teaser. */
function ambitoDe(modelo) {
  return {
    id: modelo.id,
    capa: 'pieza',
    desde: 0,
    hasta: modelo.duracion,
    tomas: modelo.tomas,
    conSubtitulos: true,
    previas: null
  };
}

console.log('\nLA BOCA MANDA\n');

const elTeaser = construirModelo(serie, {
  id: 'teaser',
  titulo: 'Teaser',
  datos: serie.piezas.teaser
});
const bocasDelTeaser = bocasQueHablan(elTeaser, ambitoDe(elTeaser));

comprobar('La línea de la madre se adelanta al plano donde se le mueven los labios', () => {
  const suya = elTeaser.lineas.find((una) => una.quien === 'madre' && una.t === 24);
  if (!suya) throw new Error('el teaser ya no tiene esa línea; hay que revisar esta prueba');

  const movida = bocasDelTeaser.get(claveDeLinea(suya));
  if (!movida) throw new Error('no se adelanta, y B2 le mueve los labios durante cuatro segundos');
  if (movida.toma !== 'B2') throw new Error(`se empareja con ${movida.toma} y no con B2`);
  if (movida.en !== 21) throw new Error(`entra en ${movida.en} s y B2 empieza en 21`);
});

comprobar('La de Saharis NO se adelanta: ahí tiene la boca en cuadro pero quieta', () => {
  const suya = elTeaser.lineas.find((una) => una.quien === 'saharis');
  if (!suya) throw new Error('el teaser ya no tiene línea de Saharis');

  if (bocasDelTeaser.get(claveDeLinea(suya))) {
    throw new Error('se lleva la voz a D5, donde «nothing else moves»: eso rompe la regla §6.6');
  }
});

comprobar('Las líneas en off se quedan exactamente donde están escritas', () => {
  const enOff = elTeaser.lineas.filter((una) => una.quien === 'madre' && una.t !== 24);
  if (enOff.length < 2) throw new Error('esperaba al menos dos líneas en off de la madre');
  for (const una of enOff) {
    if (bocasDelTeaser.get(claveDeLinea(una))) {
      throw new Error(`la línea en ${una.t} s se mueve y no tiene ningún plano de boca`);
    }
  }
});

comprobar('Se distingue una boca que habla de una que solo está en cuadro', () => {
  if (!pideMoverLaBoca('her lips move continuously as she speaks')) {
    throw new Error('no reconoce unos labios moviéndose');
  }
  if (!pideMoverLaBoca('The mouth keeps moving.')) throw new Error('no reconoce una boca en marcha');
  if (pideMoverLaBoca('He turns his head to camera and holds the look. Nothing else moves.')) {
    throw new Error('da por hablando un retrato callado');
  }
  if (pideMoverLaBoca('')) throw new Error('da por hablando un plano sin prompt');
});

comprobar('Un plano de boca no reclama una línea que está lejísimos', () => {
  const modelo = {
    id: 'x',
    lineas: [{ quien: 'madre', t: 300, hasta: 302, es: 'muy lejos' }],
    tomas: []
  };
  const ambito = {
    desde: 0,
    hasta: 400,
    tomas: [{
      id: 'Z1', inicio: 10, dur: 4, desde: 0, hasta: 4,
      bocaVisible: 'madre', bocaSeMueve: true
    }]
  };
  if (bocasQueHablan(modelo, ambito).size) {
    throw new Error('se lleva a los 10 s una línea escrita en el 300');
  }
});

comprobar('Dos bocas peleando por la misma línea: se la lleva la más cercana', () => {
  const linea = { quien: 'madre', t: 20, hasta: 22, es: 'una' };
  const modelo = { id: 'x', lineas: [linea], tomas: [] };
  const ambito = {
    desde: 0,
    hasta: 60,
    tomas: [
      { id: 'LEJOS', inicio: 16, dur: 3, desde: 0, hasta: 3, bocaVisible: 'madre', bocaSeMueve: true },
      { id: 'CERCA', inicio: 19, dur: 3, desde: 0, hasta: 3, bocaVisible: 'madre', bocaSeMueve: true }
    ]
  };
  const salida = bocasQueHablan(modelo, ambito);
  if (salida.size !== 1) throw new Error(`empareja ${salida.size} veces la misma línea`);
  const cual = salida.get(claveDeLinea(linea));
  if (cual.toma !== 'CERCA') throw new Error(`se la lleva ${cual.toma}`);
});

comprobar('El orden en que estén escritos los planos no cambia el resultado', () => {
  const linea = { quien: 'madre', t: 20, hasta: 22, es: 'una' };
  const modelo = { id: 'x', lineas: [linea], tomas: [] };
  const dos = [
    { id: 'LEJOS', inicio: 16, dur: 3, desde: 0, hasta: 3, bocaVisible: 'madre', bocaSeMueve: true },
    { id: 'CERCA', inicio: 19, dur: 3, desde: 0, hasta: 3, bocaVisible: 'madre', bocaSeMueve: true }
  ];
  const alDerecho = bocasQueHablan(modelo, { desde: 0, hasta: 60, tomas: dos });
  const alReves = bocasQueHablan(modelo, { desde: 0, hasta: 60, tomas: [...dos].reverse() });
  if (alDerecho.get(claveDeLinea(linea)).toma !== alReves.get(claveDeLinea(linea)).toma) {
    throw new Error('el resultado depende del orden de los planos');
  }
});



// ---------------------------------------------------------------------------
// EL CASO DE LOS EPISODIOS, que es distinto del teaser
// ---------------------------------------------------------------------------
//
// El teaser son cuatro frases sueltas con mucho silencio entre ellas. Un episodio
// es diálogo SEGUIDO, y ahí la primera versión de la regla de la boca se rompía.
// Lo dijo quien lo iba a usar, antes de que pasara:
//
//     «la voz puede estar en off, y de repente entra una escena de movimiento
//      de labios, y luego continuar la voz en off»
//
// Ahí NO HAY NADA QUE ARREGLAR: la voz ya está sonando cuando entra el plano de
// labios. Moverla para «cuadrarla» abriría un hueco donde no lo había y
// descolocaría todo lo de detrás.
//
// Por eso la regla no es «mueve la voz al plano» sino «si se ven labios
// moviéndose, tiene que oírse voz». Un plano que ya tiene voz encima no se toca.
// Estas pruebas son las que separan una cosa de la otra.

console.log('\nEN UN EPISODIO, CON EL DIÁLOGO SEGUIDO\n');

/** Un plano de boca cualquiera, con los campos que mira el montaje. */
function planoDeBoca(id, inicio, dur, quien) {
  return {
    id, inicio, dur, desde: 0, hasta: dur,
    bocaVisible: quien, bocaSeMueve: true
  };
}

comprobar('Voz en off, entra un plano de labios, sigue la voz: NO se toca nada', () => {
  // La narración de la madre va del 10 al 30 seguida. En el 18 entra un plano de
  // sus labios. Ya se la está oyendo: el plano no reclama nada.
  const modelo = {
    id: 'ep1',
    lineas: [
      { quien: 'madre', t: 10, hasta: 17, es: 'primera parte de la narración' },
      { quien: 'madre', t: 17, hasta: 24, es: 'sigue mientras se le ven los labios' },
      { quien: 'madre', t: 24, hasta: 30, es: 'y vuelve a off' }
    ],
    tomas: []
  };
  const ambito = { desde: 0, hasta: 40, tomas: [planoDeBoca('E7', 18, 4, 'madre')] };

  const salida = bocasQueHablan(modelo, ambito);
  if (salida.size !== 0) {
    throw new Error(`mueve ${salida.size} línea(s) y la voz ya estaba sonando encima del plano`);
  }
});

comprobar('Si el plano de labios arranca en silencio, ahí sí se trae la voz', () => {
  // Mismo episodio, pero el plano entra en el 18 y la frase no empieza hasta el
  // 21: tres segundos de labios mudos.
  const linea = { quien: 'madre', t: 21, hasta: 26, es: 'la frase que llega tarde' };
  const modelo = { id: 'ep1', lineas: [linea], tomas: [] };
  const ambito = { desde: 0, hasta: 40, tomas: [planoDeBoca('E7', 18, 4, 'madre')] };

  const movida = bocasQueHablan(modelo, ambito).get(claveDeLinea(linea));
  if (!movida) throw new Error('no la trae, y el plano arranca con tres segundos de silencio');
  if (movida.en !== 18) throw new Error(`la lleva a ${movida.en} y el plano entra en 18`);
});

comprobar('Basta con que la voz esté sonando: no hace falta que empiece ahí', () => {
  // La frase empieza en el 12, mucho antes del plano, y sigue sonando cuando el
  // plano entra en el 18. Eso ya vale: se oye voz debajo de los labios.
  const modelo = {
    id: 'ep1',
    lineas: [{ quien: 'madre', t: 12, hasta: 25, es: 'una frase larga' }],
    tomas: []
  };
  const ambito = { desde: 0, hasta: 40, tomas: [planoDeBoca('E7', 18, 4, 'madre')] };
  if (bocasQueHablan(modelo, ambito).size !== 0) throw new Error('mueve una frase que ya sonaba');
});

comprobar('La voz de OTRO personaje no cuenta como cubrir esa boca', () => {
  // Está hablando Saharis mientras se ven los labios de la madre. Eso no cubre
  // nada: la que mueve la boca es ella.
  const suya = { quien: 'madre', t: 25, hasta: 28, es: 'lo que dice ella' };
  const modelo = {
    id: 'ep1',
    lineas: [{ quien: 'saharis', t: 16, hasta: 24, es: 'lo que dice él' }, suya],
    tomas: []
  };
  const ambito = { desde: 0, hasta: 40, tomas: [planoDeBoca('E7', 22, 4, 'madre')] };

  const movida = bocasQueHablan(modelo, ambito).get(claveDeLinea(suya));
  if (!movida) throw new Error('da por cubierta la boca de la madre con la voz de Saharis');
});

comprobar('En una escena, los segundos son los de la escena y no los del episodio', () => {
  // Un ámbito de escena empieza en el segundo 120 del episodio. Todo lo que sale
  // del emparejado va en segundos de la PIEZA; quien resta «ambito.desde» es
  // componerVoz. Lo que se comprueba aquí es que no se reste dos veces.
  const linea = { quien: 'madre', t: 128, hasta: 131, es: 'dentro de la escena' };
  const modelo = { id: 'ep1', lineas: [linea], tomas: [] };
  const ambito = { desde: 120, hasta: 150, tomas: [planoDeBoca('E7', 125, 3, 'madre')] };

  const movida = bocasQueHablan(modelo, ambito).get(claveDeLinea(linea));
  if (!movida) throw new Error('no empareja dentro de una escena');
  if (movida.en !== 125) throw new Error(`devuelve ${movida.en}; se esperaba 125, en segundos de la pieza`);
});

comprobar('Un ámbito que solo concatena capas no revienta ni empareja nada', () => {
  const modelo = { id: 'ep1', lineas: [{ quien: 'madre', t: 5, hasta: 8, es: 'x' }], tomas: [] };
  if (bocasQueHablan(modelo, { desde: 0, hasta: 40, previas: [] }).size !== 0) {
    throw new Error('empareja algo en un ámbito sin planos');
  }
});



// ---------------------------------------------------------------------------
// LA VOZ TIENE QUE SER LA DE QUIEN MUEVE LOS LABIOS
// ---------------------------------------------------------------------------
//
// La regla «si se ven labios, que se oiga voz» tiene una trampa que se preguntó
// antes de que llegara a pasar:
//
//     «se oye una voz en off de una persona hablando y luego pasa a un plano
//      donde se le ve la boca moviéndose a la OTRA persona que le está
//      respondiendo. ¿Esa voz que se escucha es la correcta?»
//
// No basta con que suene UNA voz: tiene que sonar LA SUYA. Si se ven los labios
// de B y lo que suena es A, en pantalla parece que B está diciendo las palabras
// de A, y eso se ve tan mal como el silencio.
//
// Hay dos maneras de meter la pata aquí, y las dos se prueban:
//
//   1. Dar por cubierta la boca de B porque hay voz encima, aunque sea de A.
//   2. Traer la frase de B para cubrir su boca Y PLANTARLA ENCIMA de la voz en
//      off de A. Esta era la de verdad: dentro de un bloque estaba guardado, pero
//      A y B pueden estar en bloques distintos y ahí no miraba nadie.

console.log('\nLA VOZ TIENE QUE SER LA SUYA\n');

comprobar('La voz en off de A no da por cubierta la boca de B', () => {
  const suya = { quien: 'saharis', t: 26, hasta: 29, es: 'lo que responde él' };
  const modelo = {
    id: 'ep1',
    lineas: [{ quien: 'madre', t: 12, hasta: 24, es: 'la narración de ella' }, suya],
    tomas: []
  };
  const ambito = { desde: 0, hasta: 60, tomas: [planoDeBoca('E9', 22, 3, 'saharis')] };

  if (!bocasQueHablan(modelo, ambito).get(claveDeLinea(suya))) {
    throw new Error('da por buena la boca de Saharis porque se está oyendo a la madre');
  }
});

comprobar('Y al traerla, NO se le planta encima a la voz en off de A', () => {
  // Este es el caso de verdad. La madre habla en off del 12 al 24. En el 18 entra
  // un plano de la boca de Saharis. Su frase está en el 26. Traerla al 18 la
  // pondría a hablar encima de ella.
  const suya = { quien: 'saharis', t: 26, hasta: 29, es: 'lo que responde él' };
  const modelo = {
    id: 'ep1',
    lineas: [{ quien: 'madre', t: 12, hasta: 24, es: 'la narración de ella' }, suya],
    tomas: []
  };
  const ambito = { desde: 0, hasta: 60, tomas: [planoDeBoca('E9', 18, 4, 'saharis')] };

  // El emparejado la reclama —su boca arranca muda—, pero la guarda de componerVoz
  // tiene que impedir el movimiento.
  if (!bocasQueHablan(modelo, ambito).get(claveDeLinea(suya))) {
    throw new Error('ni siquiera la reclama; la boca de Saharis arranca muda');
  }
  if (!pisaAOtroPersonaje(modelo, suya, 18, 21, ambito)) {
    throw new Error('no ve que del 18 al 21 está hablando la madre');
  }
});

comprobar('Si el hueco está libre, la guarda no estorba', () => {
  const suya = { quien: 'saharis', t: 26, hasta: 29, es: 'lo que responde él' };
  const modelo = {
    id: 'ep1',
    lineas: [{ quien: 'madre', t: 12, hasta: 17, es: 'la narración de ella' }, suya],
    tomas: []
  };
  const ambito = { desde: 0, hasta: 60, tomas: [planoDeBoca('E9', 18, 4, 'saharis')] };

  if (pisaAOtroPersonaje(modelo, suya, 18, 21, ambito)) {
    throw new Error('dice que pisa a alguien y la madre acabó en el 17');
  }
});

comprobar('Se cuenta cuánto tiempo se oye la voz equivocada debajo de una boca', () => {
  // Plano de la boca de Saharis, del 18 al 22. Debajo suena la madre entera y él
  // no dice nada: cuatro segundos de voz equivocada.
  const toma = planoDeBoca('E9', 18, 4, 'saharis');
  const colocadas = [{ quien: 'madre', en: 12, fin: 24 }];

  const mal = vozEquivocadaDebajoDe(toma, colocadas, 0);
  if (mal.cuanto !== 4) throw new Error(`cuenta ${mal.cuanto} s y son 4`);
  if (mal.quienes.join() !== 'madre') throw new Error(`dice que suena ${mal.quienes.join()}`);
});

comprobar('Si además suena la voz buena por encima, eso no cuenta como equivocada', () => {
  // Los dos hablan a la vez durante el plano. No es lo ideal, pero SÍ se le está
  // oyendo a él mientras mueve los labios, que es lo que pedía la regla.
  const toma = planoDeBoca('E9', 18, 4, 'saharis');
  const colocadas = [
    { quien: 'madre', en: 12, fin: 24 },
    { quien: 'saharis', en: 18, fin: 22 }
  ];
  const mal = vozEquivocadaDebajoDe(toma, colocadas, 0);
  if (mal.cuanto !== 0) throw new Error(`cuenta ${mal.cuanto} s y su voz tapa el plano entero`);
});

comprobar('Un plano con su voz correcta y nadie más no da ninguna queja', () => {
  const toma = planoDeBoca('E9', 18, 4, 'saharis');
  const colocadas = [{ quien: 'saharis', en: 18, fin: 22 }];

  if (vozEquivocadaDebajoDe(toma, colocadas, 0).cuanto !== 0) throw new Error('inventa voz ajena');
  if (mudezDebajoDe(toma, colocadas, 0) !== 0) throw new Error('inventa silencio');
});

comprobar('El silencio se mide solo con la voz de quien mueve los labios', () => {
  // Debajo del plano suena la madre, pero el que mueve la boca es él y él no dice
  // nada: para su boca, eso es silencio de los cuatro segundos.
  const toma = planoDeBoca('E9', 18, 4, 'saharis');
  const colocadas = [{ quien: 'madre', en: 12, fin: 24 }];
  if (mudezDebajoDe(toma, colocadas, 0) !== 4) {
    throw new Error('da por sonora la boca de Saharis porque habla la madre');
  }
});


console.log(`\n${bien + mal} comprobaciones, ${bien} bien${mal ? `, ${mal} MAL` : ''}\n`);
process.exit(mal === 0 ? 0 : 1);
