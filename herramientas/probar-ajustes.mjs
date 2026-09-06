// ¿LLEGA DE VERDAD LO QUE SE ELIGE EN SALUD HASTA LA LLAMADA?
//
// Con qué modelo se genera es la decisión que más dinero mueve de toda la
// herramienta: entre el nivel de calidad y el económico hay varias veces el
// precio, y la resolución de la imagen lo vuelve a multiplicar. Un ajuste que se
// pinta en pantalla pero no llega a la petición es peor que no tenerlo: quien
// paga cree haber elegido lo barato y se le cobra lo caro, y no se entera.
//
// Así que aquí no se comprueba que compile. Se comprueba que el valor llegue,
// paso a paso, hasta el `imageSize` del cuerpo que se le manda a Google. Y las
// dos puertas por las que pasa: el normalizador del estado —que tiene que
// aguantar un ajuste inventado sin romper el estado entero— y el validador de la
// resolución —que tiene que FALLAR ante una que no existe en vez de caer al
// valor por defecto en silencio—.
//
// Los módulos se copian sin sus importaciones para no arrastrar medio estudio ni
// hablar con Google: lo único que se prueba es la parte que decide.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

function suelto(ruta, extra, exporta) {
  const codigo = readFileSync(RAIZ + ruta, 'utf8')
    .replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');
  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-'));
  const archivo = join(carpeta, 'x.mjs');
  // Se quitan los «export» de dentro y se pone uno solo al final, para no
  // exportar dos veces lo mismo.
  const sinExportar = codigo.replace(/^export (?=(async )?function |const |class )/gm, '');
  writeFileSync(archivo, `${extra}\n${sinExportar}\nexport { ${exporta} };\n`);
  return import(pathToFileURL(archivo).href);
}

const serieReal = JSON.parse(readFileSync(RAIZ + 'datos/serie.json', 'utf8'));

const est = await suelto('api/_lib/estado.js', `
import { Buffer } from 'node:buffer';
const serie = ${JSON.stringify(serieReal)};
class ErrorDeCara extends Error { constructor(m,o={}){super(m);this.mensaje=m;Object.assign(this,o);} }
const leerDelBucket = async () => null, escribirEnElBucket = async () => null;
const gsUri = () => '', rutaLogica = () => '';
const bloquesDeVoz = () => [], tomasDePieza = () => [], placasDelBanco = () => [], escenariosDeLaSerie = () => [];
`, 'asegurar, ESTADO_VACIO');

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nEL AJUSTE DE CON QUÉ SE GENERA\n');

const vacio = est.asegurar({});
di(vacio.ajustes && vacio.ajustes.imagen && vacio.ajustes.video,
  'Un estado viejo, sin ajustes, sale con la forma entera');
di(vacio.ajustes.imagen.nivel === null && vacio.ajustes.video.nivel === null,
  'Y sin nada elegido, que significa «lo que digan los datos»');

const puesto = est.asegurar({ ajustes: { imagen: { nivel: 'economico', resolucion: '1K' }, video: { nivel: 'calidad' } } });
di(puesto.ajustes.imagen.nivel === 'economico', 'Un nivel de imagen que existe se respeta');
di(puesto.ajustes.imagen.resolucion === '1K', 'Una resolución que existe se respeta');
di(puesto.ajustes.video.nivel === 'calidad', 'Un nivel de vídeo que existe se respeta');

const basura = est.asegurar({ ajustes: { imagen: { nivel: 'baratisimo', resolucion: '8K' }, video: { nivel: 42 } } });
di(basura.ajustes.imagen.nivel === null, 'Un nivel inventado se descarta, no rompe el estado');
di(basura.ajustes.imagen.resolucion === null, 'Una resolución inventada se descarta');
di(basura.ajustes.video.nivel === null, 'Un nivel que ni siquiera es texto se descarta');

// La resolución, en el otro extremo: la puerta de la imagen.
const img = await suelto('api/_lib/imagen.js', `
import { Buffer } from 'node:buffer';
const serie = ${JSON.stringify(serieReal)};
class ErrorDeCara extends Error { constructor(m,o={}){super(m);this.mensaje=m;Object.assign(this,o);} }
const entorno = () => ({ sa: { project_id: 'x' } });
const nivelImagen = () => ({ id: 'gemini-3.1-flash-image', ids: [], region: 'global' });
const llamar = async () => ({}), urlModelo = () => '', conGrafias = async () => ({}), comoGrafia = (m) => m;
`, 'resolucionValida, cuerpoPara');

di(img.resolucionValida('1K') === '1K', 'La resolución 1K se acepta');
di(img.resolucionValida('2k') === '2K', 'La k minúscula se arregla sola (Google la rechazaría)');
di(img.resolucionValida('') === '2K', 'Sin pedir nada, la de serie.json', `sale ${img.resolucionValida('')}`);
try { img.resolucionValida('8K'); di(false, 'Una resolución inventada tiene que fallar'); }
catch { di(true, 'Una resolución inventada falla y lo dice en español'); }

const cuerpo1k = img.cuerpoPara('gemini-3.1-flash-image', [], '1K');
di(cuerpo1k.generationConfig.imageConfig.imageSize === '1K',
  'Y lo elegido llega DE VERDAD al cuerpo de la petición',
  `imageSize = ${cuerpo1k.generationConfig.imageConfig.imageSize}`);

// «auto» no es un tamaño: es no mandar el campo. Importa que NO se mande, no que
// se mande vacío: Vertex reparte la cuota por modelo y resolución, y el cubo de
// «resolución por defecto» solo se toca si no se pide ninguna.
di(img.resolucionValida('auto') === null, '«auto» no resuelve a ningún tamaño');
const cuerpoAuto = img.cuerpoPara('gemini-3.1-flash-image', [], null);
di(!('imageSize' in cuerpoAuto.generationConfig.imageConfig),
  'Con «auto» el campo imageSize NO viaja en la petición',
  `imageConfig = ${JSON.stringify(cuerpoAuto.generationConfig.imageConfig)}`);

const conAuto = est.asegurar({ ajustes: { imagen: { resolucion: 'auto' } } });
di(conAuto.ajustes.imagen.resolucion === 'auto', '«auto» se guarda en el estado');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
