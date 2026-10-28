// Adaptan el pedido HTTP a la capa de servicios y arman la respuesta. Las reglas están
// en stockService; los errores los traduce el manejador de app.js.

function crearStockController({ stockService }) {
  async function consultarStock(req, res) {
    const { productoIds } = req.query;
    if (productoIds !== undefined && typeof productoIds !== 'string') {
      return res.status(400).json({ error: 'El parámetro "productoIds" debe ser una lista separada por comas' });
    }
    const ids = productoIds === undefined ? undefined : productoIds.split(',').map((s) => s.trim()).filter(Boolean);
    res.status(200).json(await stockService.consultar(ids));
  }

  async function fijarStock(req, res) {
    const { cantidad } = req.body || {};
    // Quién ajustó: el ADMIN autenticado.
    res.status(200).json(await stockService.fijar(req.params.productoId, cantidad, req.usuario.id));
  }

  async function crearDescuento(req, res) {
    // usuarioId: para quién fue la compra (lo manda Ventas, D13). Si no viene, el que pidió el descuento.
    const { referencia, items, usuarioId } = req.body || {};
    const resultado = await stockService.descontar(referencia, items, usuarioId ?? req.usuario.id);
    // 201 descontado ahora · 200 esa referencia ya se había descontado (idempotente)
    res.status(resultado.creado ? 201 : 200).json({ referencia: resultado.referencia, items: resultado.items });
  }

  async function reintegrarDescuento(req, res) {
    await stockService.reintegrar(req.params.referencia, req.usuario.id);
    res.status(204).end();
  }

  async function listarMovimientos(req, res) {
    const { productoId } = req.query;
    if (productoId !== undefined && typeof productoId !== 'string') {
      return res.status(400).json({ error: 'El parámetro "productoId" debe ser texto' });
    }
    res.status(200).json(await stockService.movimientos(productoId));
  }

  return { consultarStock, fijarStock, crearDescuento, reintegrarDescuento, listarMovimientos };
}

module.exports = { crearStockController };
