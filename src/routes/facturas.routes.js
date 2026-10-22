const { Router } = require('express');
const ctrl = require('../controllers/facturas');
const { requerirAuth, requerirRol } = require('../middleware/auth');

const router = Router();

// Generar y pagar facturas: solo admin. Listar/consultar: cualquier autenticado
router.post('/', requerirAuth, requerirRol('admin'), ctrl.generarFactura);
router.get('/', requerirAuth, ctrl.listarFacturas);
router.get('/:id', requerirAuth, ctrl.consultarFactura);
router.put('/:id/pagar', requerirAuth, requerirRol('admin'), ctrl.pagarFactura);

module.exports = router;
