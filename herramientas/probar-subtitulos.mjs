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
  writeFileSync(
    archivo,
    'const h = () => ({}), aviso = () => ({}), boton = () => ({}), tarjeta = () => ({});\n' +
      codigo.replace(/^export (?=(async )?function |const |class )/gm, '') +
      '\nexport { partirElSubtitulo, juntarLosMasCortos, respiraDespuesDe };\n'
  );
  return import(pathToFileURL(archivo).href);
}

const { partirElSubtitulo, juntarLosMasCortos, respiraDespuesDe } = await traerDelMontaje();

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

console.log(`\n${bien + mal} comprobaciones, ${bien} bien${mal ? `, ${mal} MAL` : ''}\n`);
process.exit(mal === 0 ? 0 : 1);
