const { Router } = require('express');
const ctrl = require('../controllers/inventario');
const { requerirAuth, requerirRol } = require('../middleware/auth');

const router = Router();

router.get('/', requerirAuth, ctrl.consultarStock);
router.get('/movimientos', requerirAuth, ctrl.listarMovimientos);
// Registrar entradas/salidas/ajustes manuales: solo admin
router.post('/movimientos', requerirAuth, requerirRol('admin'), ctrl.registrarMovimiento);

module.exports = router;
