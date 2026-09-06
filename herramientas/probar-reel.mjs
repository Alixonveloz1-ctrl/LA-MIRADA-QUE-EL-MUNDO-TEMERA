// EL REEL, CORTADO DE VERDAD Y PASADO POR EL VALIDADOR DE VERDAD.
//
// Un reel mal cortado NO DA NINGÚN ERROR. Da un vídeo. Un vídeo con un plano que
// parpadea, o con tres segundos de negro al final, o con la música cortada a
// mitad de nota. Eso solo se ve mirándolo, en el móvil, después de haber
// esperado los minutos que tarda el montador y de haber gastado esa máquina.
//
// Por eso aquí no se lee el código: se ejecuta. Se le dan estados de mentira con
// clips elegidos y música aprobada, se corta el reel, y se comprueba una a una
// las cosas que no se pueden comprobar leyendo:
//
//   · que los planos van pegados, sin huecos y sin solapes
//   · que ninguno queda por debajo del mínimo, ni siquiera el último al recortar
//   · que ninguno pasa del máximo
//   · que el total no se pasa de los treinta segundos
//   · que con poco material sale un reel corto en vez de un fallo
//   · y que el manifiesto que sale de ahí lo ACEPTA el mismo validador que usa
//     la función en producción, con la capa que entiende el montador que ya
//     está desplegado
//
// Esa última es la que de verdad importa: es la diferencia entre enterarse aquí,
// en un segundo, o enterarse en la nube dentro de diez minutos.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;
const serie = JSON.parse(readFileSync(`${RAIZ}datos/serie.json`, 'utf8'));

function suelto(ruta, extra, exporta) {
  const codigo = readFileSync(RAIZ + ruta, 'utf8').replace(
    /^import[\s\S]*?from\s+'[^']*';$/gm,
    ''
  );
  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-reel-'));
  const archivo = join(carpeta, 'x.mjs');
  const sinExportar = codigo.replace(/^export (?=(async )?function |const |class )/gm, '');
  writeFileSync(archivo, `${extra}\n${sinExportar}\nexport { ${exporta} };\n`);
  return import(pathToFileURL(archivo).href);
}

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nEL REEL: TREINTA SEGUNDOS ARMADOS SOLOS\n');

// ── LOS DATOS ──────────────────────────────────────────────────────────────
const reels = (serie.difusion && serie.difusion.reels) || {};
di(Number(reels.duracion_s) > 0, 'Hay una duración escrita en los datos', `${reels.duracion_s} s`);
di(
  reels.formato && reels.formato.alto > reels.formato.ancho,
  'Y el formato es VERTICAL, que es de lo que va un reel',
  `${reels.formato && reels.formato.ancho} × ${reels.formato && reels.formato.alto}`
);
di(
  Number(reels.minimo_plano_s) > 0 && Number(reels.maximo_plano_s) > Number(reels.minimo_plano_s),
  'El mínimo y el máximo de plano están escritos y tienen sentido',
  `${reels.minimo_plano_s} s a ${reels.maximo_plano_s} s`
);

// ── EL CORTE ───────────────────────────────────────────────────────────────
console.log('\n  EL CORTE\n');

const rl = await suelto(
  'app/reel.js',
  `
const claveDelMaterial = (idPieza, laToma) =>
  (laToma && typeof laToma.de_archivo === 'string' && laToma.de_archivo.trim())
    ? 'archivo/' + laToma.de_archivo.trim()
    : idPieza + '/' + ((laToma && laToma.id) || '');
`,
  'ajustesDelReel, cortarElReel, musicaDelReel, manifiestoDelReel, nombreDelReel, esReelDe, CAPA_DEL_REEL'
);

const ajustes = rl.ajustesDelReel(serie);
di(ajustes.duracionS === Number(reels.duracion_s), 'Los ajustes se leen de los datos, no del código');
di(ajustes.formato.ancho % 2 === 0 && ajustes.formato.alto % 2 === 0,
  'Los dos lados son pares: un códec no acepta un lado impar');

/** Un estado con TODOS los planos del teaser con clip elegido y música aprobada. */
function estadoLleno(idPieza = 'teaser') {
  const tomas = {};
  for (const una of serie.piezas[idPieza].tomas) {
    const clave =
      typeof una.de_archivo === 'string' && una.de_archivo.trim()
        ? `archivo/${una.de_archivo.trim()}`
        : `${idPieza}/${una.id}`;
    tomas[clave] = { clip_elegido: `veo/${idPieza}/${una.id}/1/x.mp4` };
  }
  const musica = {};
  for (const una of serie.musica.piezas) {
    if (una.pieza === idPieza) {
      musica[una.id] = { ruta: `audio/musica/${una.id}.wav`, dur_s: una.duracion_s || 78, aprobada: true };
    }
  }
  return { tomas, audio: { musica, voz: {} }, montajes: [] };
}

const lleno = rl.cortarElReel(serie, estadoLleno(), 'teaser');

di(lleno.planos.length > 0, 'Con todos los clips elegidos, el reel se arma',
  `${lleno.planos.length} planos, ${lleno.duracionS} s`);

di(lleno.duracionS <= ajustes.duracionS + 0.02,
  'Y NO se pasa de la duración escrita',
  `${lleno.duracionS} s de ${ajustes.duracionS}`);

di(Math.abs(lleno.duracionS - ajustes.duracionS) < 0.02,
  'Con material de sobra, aterriza EXACTAMENTE en la duración pedida',
  `${lleno.duracionS} s`);

// Pegados: sin huecos y sin solapes. Es la regla que el validador de la función
// también comprueba, y por eso vale la pena comprobarla aquí antes.
let pegados = true;
let acumulado = 0;
for (const uno of lleno.planos) {
  if (Math.abs(uno.en - acumulado) > 0.02) pegados = false;
  acumulado = Math.round((acumulado + (uno.hasta - uno.desde)) * 100) / 100;
}
di(pegados, 'Los planos van pegados: ni un hueco de negro ni dos planos a la vez');

const cortos = lleno.planos.filter((uno) => uno.hasta - uno.desde + 0.02 < ajustes.minimoS);
di(cortos.length === 0,
  'Ninguno queda por debajo del mínimo, tampoco el último al ajustarlo',
  cortos.length ? cortos.map((u) => u.id).join(', ') : `mínimo ${ajustes.minimoS} s`);

// El máximo se respeta AL ELEGIR. Al final, el reparto del pico puede estirar
// alguno, y por eso el tope de verdad es «el máximo más el pico», que nunca pasa
// del mínimo: el corte se para justo cuando lo que queda es menor que eso.
const tope = ajustes.maximoS + ajustes.minimoS;
const pasados = lleno.planos.filter((uno) => uno.hasta - uno.desde > tope + 0.02);
di(pasados.length === 0,
  'Ninguno pasa del máximo más el pico: en medio minuto caben diez o doce planos, no cuatro',
  pasados.length ? pasados.map((u) => u.id).join(', ') : `tope real ${tope} s`);

const estirados = lleno.planos.filter((uno) => uno.hasta - uno.desde > ajustes.maximoS + 0.02);
di(estirados.length <= 2,
  'Y el pico se reparte entre uno o dos planos, no entre todos',
  estirados.length ? `estirados: ${estirados.map((u) => u.id).join(', ')}` : 'ninguno estirado');

const delPrincipio = lleno.planos.every((uno, i) => {
  const laToma = serie.piezas.teaser.tomas.find((t) => t.id === uno.id);
  const desde = Array.isArray(laToma.recorte) ? laToma.recorte[0] : 0;
  return Math.abs(uno.desde - desde) < 0.02;
});
di(delPrincipio, 'De cada plano se coge SU PRINCIPIO, que es donde está lo que se quería contar');

// ── CON POCO MATERIAL ──────────────────────────────────────────────────────
console.log('\n  CON POCO MATERIAL, UN REEL CORTO — NO UN FALLO\n');

const tresPlanos = serie.piezas.teaser.tomas.slice(0, 3);
const pocos = {
  tomas: Object.fromEntries(
    tresPlanos.map((una) => [`teaser/${una.id}`, { clip_elegido: `veo/teaser/${una.id}/1/x.mp4` }])
  ),
  audio: { musica: { 'teaser-lecho': { ruta: 'audio/musica/teaser-lecho.wav', dur_s: 78, aprobada: true } }, voz: {} },
  montajes: []
};

const corto = rl.cortarElReel(serie, pocos, 'teaser');
di(corto.planos.length > 0 && corto.planos.length <= 3,
  'Con tres clips elegidos sale un reel de tres planos',
  `${corto.planos.length} planos, ${corto.duracionS} s`);
di(corto.duracionS < ajustes.duracionS,
  'Y dura menos de treinta segundos, sin quejarse',
  `${corto.duracionS} s`);
// Y NO se estiran esos tres planos para llegar a treinta: eso no daría un reel,
// daría tres planos lentísimos. Cuando lo que falta es material, se dice, no se
// disimula.
const sumaCorta = corto.planos.reduce((n, uno) => n + (uno.hasta - uno.desde), 0);
const suyosCortos = tresPlanos.reduce(
  (n, una) => n + Math.min(Array.isArray(una.recorte) ? una.recorte[1] - una.recorte[0] : una.dur, ajustes.maximoS),
  0
);
di(Math.abs(sumaCorta - suyosCortos) < 0.05,
  'Con poco material NO se estiran los planos para disimular: se deja corto',
  `${Math.round(sumaCorta * 10) / 10} s, que es justo lo que dan los tres`);
di(corto.sinClip === serie.piezas.teaser.tomas.length - 3,
  'Y se sabe cuántos planos se han quedado fuera por no tener clip',
  `${corto.sinClip} sin clip`);

const vacio = rl.cortarElReel(serie, { tomas: {}, audio: { musica: {} } }, 'teaser');
di(vacio.planos.length === 0 && vacio.duracionS === 0,
  'Sin ningún clip elegido, el reel sale vacío en vez de romperse');

// ── LA MÚSICA ──────────────────────────────────────────────────────────────
console.log('\n  LA MÚSICA\n');

const conMusica = rl.musicaDelReel(serie, estadoLleno(), 'teaser', 30);
di(conMusica && conMusica.pista === 'musica', 'Debajo va una pista de música');
di(conMusica && conMusica.en === 0 && conMusica.desde === 0,
  'Desde su segundo cero, y entrando en el cero del reel');
di(conMusica && conMusica.hasta <= 30.02,
  'Recortada a lo que dura el reel: no sigue sonando sobre negro',
  `${conMusica && conMusica.hasta} s`);
di(conMusica && conMusica.agacha === false,
  'Sin agacharse: no hay voz debajo a la que dejarle sitio');

const sinAprobar = estadoLleno();
for (const id of Object.keys(sinAprobar.audio.musica)) sinAprobar.audio.musica[id].aprobada = false;
di(rl.musicaDelReel(serie, sinAprobar, 'teaser', 30) === null,
  'Una música generada pero SIN APROBAR no entra: nada suena sin haber sonado antes');

// ── EL MANIFIESTO, PASADO POR EL VALIDADOR DE PRODUCCIÓN ───────────────────
console.log('\n  Y EL VALIDADOR DE VERDAD LO ACEPTA\n');

const mnt = await suelto(
  'api/_lib/montaje.js',
  `
const serie = ${JSON.stringify({ formato: serie.formato })};
class ErrorDeCara extends Error { constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); } }
const entorno = () => ({ bucket: 'x', prefijo: '' });
const escribir = async () => {}, leer = async () => null, listar = async () => [], borrar = async () => {};
const llamar = async () => ({}), urlServicio = () => '';
`,
  'validarManifiesto'
);

const armado = rl.manifiestoDelReel(serie, estadoLleno(), 'teaser', 1);
di(armado.manifiesto !== null, 'Con todo el material, el manifiesto se arma',
  (armado.faltas || []).join(' | '));

if (armado.manifiesto) {
  try {
    const nombre = mnt.validarManifiesto(armado.manifiesto);
    di(nombre === 'reel-teaser-1',
      'EL VALIDADOR DE LA FUNCIÓN LO ACEPTA TAL CUAL, sin tocarle nada', nombre);
  } catch (fallo) {
    di(false, 'EL VALIDADOR DE LA FUNCIÓN LO ACEPTA TAL CUAL, sin tocarle nada', fallo.mensaje);
  }

  di(armado.manifiesto.capa === rl.CAPA_DEL_REEL && rl.CAPA_DEL_REEL === 'pieza',
    'Y va con una capa que el montador YA DESPLEGADO entiende: no hay que volver a desplegarlo',
    armado.manifiesto.capa);

  di(armado.manifiesto.formato.alto > armado.manifiesto.formato.ancho,
    'El manifiesto pide salida vertical');
  di(armado.manifiesto.subtitulos.length === 0,
    'Sin subtítulos: en treinta segundos el diálogo o no se entiende o lo cuenta todo');
  di(armado.manifiesto.audio.length === 1,
    'Con una sola pista de audio: la música, y nada más');
  di(!armado.manifiesto.acabado || armado.manifiesto.acabado.paso_de_dos.length === 0,
    'Y sin volver a pisar el paso de dos, que ya lo llevan los clips');
}

// Sin música aprobada NO se arma: un reel mudo no se sube a ninguna parte.
const mudo = rl.manifiestoDelReel(serie, { ...pocos, audio: { musica: {}, voz: {} } }, 'teaser', 1);
di(mudo.manifiesto === null && mudo.faltas.length > 0,
  'Sin música aprobada no se arma, y se dice por qué',
  (mudo.faltas[0] || '').slice(0, 60));

// Sin clips tampoco.
const seco = rl.manifiestoDelReel(serie, { tomas: {}, audio: { musica: {} } }, 'teaser', 1);
di(seco.manifiesto === null, 'Sin clips elegidos tampoco, y también se dice por qué');

// ── EL NOMBRE Y LAS VERSIONES ──────────────────────────────────────────────
console.log('\n  REHACERLO NO PISA LO HECHO\n');

di(rl.nombreDelReel('teaser', 1) === 'reel-teaser-1' && rl.nombreDelReel('teaser', 2) === 'reel-teaser-2',
  'Cada reel lleva su versión en el nombre');
di(rl.esReelDe('montaje/reel-teaser-2.mp4', 'teaser'), 'Y se reconoce cuál es el reel de una pieza');
di(!rl.esReelDe('montaje/teaser-3.mp4', 'teaser'),
  'El montaje de la pieza NO se confunde con su reel');
di(!rl.esReelDe('montaje/reel-ep01-1.mp4', 'teaser'),
  'Ni el reel de un episodio con el de otro');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
