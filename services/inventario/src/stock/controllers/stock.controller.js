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
    res.status(200).json(await stockService.fijar(req.params.productoId, cantidad));
  }

  async function crearDescuento(req, res) {
    const { referencia, items } = req.body || {};
    const resultado = await stockService.descontar(referencia, items);
    // 201 descontado ahora · 200 esa referencia ya se había descontado (idempotente)
    res.status(resultado.creado ? 201 : 200).json({ referencia: resultado.referencia, items: resultado.items });
  }

  async function reintegrarDescuento(req, res) {
    await stockService.reintegrar(req.params.referencia);
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
