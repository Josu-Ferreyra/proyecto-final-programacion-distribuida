// State Machine de stock: la función aplicar(entrada) que se inyecta en el módulo Raft.
//
// Es el ÚNICO lugar que escribe stock, descuentos y movimientos. Recibe entradas ya
// committed, en orden, y como las tres réplicas aplican los mismos comandos en el mismo
// orden partiendo del mismo estado, terminan con el mismo estado.
//
// Corrige el Caso 2 del TP5: la decisión "¿alcanza el stock?" se toma ACÁ, al aplicar,
// sobre el valor vigente. Nadie de afuera envía "el stock nuevo vale N".
//
// Para que sea determinística:
//   - la fecha viene dentro del comando (la fija el Leader): nunca se llama a Date.now();
//   - no hace llamadas HTTP ni toca Redis (eso pasa en stockService, antes de proponer);
//   - los rechazos de negocio (stock insuficiente, referencia inexistente) son
//     resultados, no excepciones: todas las réplicas llegan a la misma conclusión.

const { Stock } = require('./models/stock.model');
const { Descuento } = require('./models/descuento.model');
const { Movimiento } = require('./models/movimiento.model');

const TIPOS = Object.freeze({
  NOOP: 'NOOP',
  ALTA_STOCK: 'ALTA_STOCK',
  AJUSTAR_STOCK: 'AJUSTAR_STOCK',
  DESCONTAR: 'DESCONTAR',
  REINTEGRAR: 'REINTEGRAR',
});

// Upsert por (indiceRaft, productoId): si la entrada se re-aplica tras un reinicio,
// el movimiento no se duplica.
async function registrarMovimiento(mov) {
  await Movimiento.updateOne(
    { indiceRaft: mov.indiceRaft, productoId: mov.productoId },
    { $setOnInsert: mov },
    { upsert: true }
  );
}

async function fijarStock({ productoId, cantidad, fecha }, index) {
  const actual = await Stock.findOne({ productoId });
  if (actual && actual.ultimoIndiceRaft >= index) {
    return { estado: 'APLICADO', productoId, stock: actual.cantidad }; // ya aplicada
  }

  const anterior = actual ? actual.cantidad : 0;
  await Stock.updateOne(
    { productoId },
    { $set: { cantidad, ultimoIndiceRaft: index, updatedAt: fecha } },
    { upsert: true }
  );
  await registrarMovimiento({
    productoId,
    tipo: actual ? 'AJUSTE' : 'ALTA',
    cantidad: cantidad - anterior,
    stockResultante: cantidad,
    fecha,
    indiceRaft: index,
  });
  return { estado: 'APLICADO', productoId, stock: cantidad };
}

// Todo o nada: si a algún ítem no le alcanza el stock, no se descuenta ninguno.
async function descontar({ referencia, items, fecha }, index) {
  const previo = await Descuento.findOne({ referencia }).lean();
  if (previo) {
    // Misma referencia ya procesada (reintento de Ventas, o re-aplicación tras reinicio).
    return { estado: 'YA_APLICADO', referencia, items: previo.items };
  }

  const ids = items.map((i) => i.productoId);
  const actuales = new Map((await Stock.find({ productoId: { $in: ids } }).lean()).map((s) => [s.productoId, s]));

  // Si algún documento ya tiene este índice, el nodo se cayó a mitad de esta misma
  // entrada: no se vuelve a evaluar el stock (ya está descontado) y se completa.
  const reaplicacion = items.some((i) => (actuales.get(i.productoId)?.ultimoIndiceRaft ?? 0) >= index);

  if (!reaplicacion) {
    const faltantes = items
      .map((i) => ({ productoId: i.productoId, solicitado: i.cantidad, disponible: actuales.get(i.productoId)?.cantidad ?? 0 }))
      .filter((f) => f.disponible < f.solicitado);
    if (faltantes.length > 0) return { estado: 'RECHAZADO', referencia, faltantes };
  }

  for (const item of items) {
    const res = await Stock.findOneAndUpdate(
      { productoId: item.productoId, ultimoIndiceRaft: { $lt: index } },
      { $inc: { cantidad: -item.cantidad }, $set: { ultimoIndiceRaft: index, updatedAt: fecha } },
      { new: true }
    );
    // Sin res: este documento ya tenía aplicada esta entrada (re-aplicación).
    const resultante = res ? res.cantidad : (actuales.get(item.productoId)?.cantidad ?? 0);
    await registrarMovimiento({
      productoId: item.productoId,
      tipo: 'DESCUENTO',
      cantidad: -item.cantidad,
      stockResultante: resultante,
      referencia,
      fecha,
      indiceRaft: index,
    });
  }

  await Descuento.updateOne(
    { referencia },
    { $setOnInsert: { referencia, items, estado: 'APLICADO', fecha, indiceRaft: index } },
    { upsert: true }
  );
  return { estado: 'APLICADO', referencia, items };
}

// Devuelve exactamente lo descontado con esa referencia.
async function reintegrar({ referencia, fecha }, index) {
  const descuento = await Descuento.findOne({ referencia });
  if (!descuento) return { estado: 'NO_EXISTE', referencia };
  if (descuento.estado === 'REINTEGRADO') return { estado: 'YA_REINTEGRADO', referencia };

  for (const item of descuento.items) {
    const res = await Stock.findOneAndUpdate(
      { productoId: item.productoId, ultimoIndiceRaft: { $lt: index } },
      { $inc: { cantidad: item.cantidad }, $set: { ultimoIndiceRaft: index, updatedAt: fecha } },
      { new: true }
    );
    const actual = res || (await Stock.findOne({ productoId: item.productoId }));
    await registrarMovimiento({
      productoId: item.productoId,
      tipo: 'REINTEGRO',
      cantidad: item.cantidad,
      stockResultante: actual ? actual.cantidad : item.cantidad,
      referencia,
      fecha,
      indiceRaft: index,
    });
  }

  descuento.estado = 'REINTEGRADO';
  descuento.fechaReintegro = fecha;
  await descuento.save();
  return { estado: 'REINTEGRADO', referencia };
}

async function aplicar({ comando, index }) {
  switch (comando.tipo) {
    case TIPOS.NOOP:
      return { estado: 'NOOP' };
    case TIPOS.ALTA_STOCK:
    case TIPOS.AJUSTAR_STOCK:
      return fijarStock(comando, index);
    case TIPOS.DESCONTAR:
      return descontar(comando, index);
    case TIPOS.REINTEGRAR:
      return reintegrar(comando, index);
    default:
      return { estado: 'DESCONOCIDO', tipo: comando.tipo };
  }
}

module.exports = { aplicar, TIPOS };
