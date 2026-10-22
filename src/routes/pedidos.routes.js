const { Router } = require('express');
const ctrl = require('../controllers/pedidos');
const { requerirAuth, requerirRol } = require('../middleware/auth');

const router = Router();

router.post('/', requerirAuth, ctrl.crearPedido);
router.get('/', requerirAuth, ctrl.listarPedidos);
router.get('/:id', requerirAuth, ctrl.consultarPedido);
router.put('/:id/estado', requerirAuth, ctrl.cambiarEstadoPedido);
// Eliminar un pedido: solo admin y solo si está cancelado
router.delete('/:id', requerirAuth, requerirRol('admin'), ctrl.eliminarPedido);

module.exports = router;
