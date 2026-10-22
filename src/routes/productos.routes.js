const { Router } = require('express');
const ctrl = require('../controllers/productos');
const { requerirAuth, requerirRol } = require('../middleware/auth');

const router = Router();

// Listar y consultar: cualquier usuario autenticado
router.get('/', requerirAuth, ctrl.listarProductos);
router.get('/:id', requerirAuth, ctrl.consultarProducto);

// Crear, actualizar y eliminar: solo administradores
router.post('/', requerirAuth, requerirRol('admin'), ctrl.crearProducto);
router.put('/:id', requerirAuth, requerirRol('admin'), ctrl.actualizarProducto);
router.delete('/:id', requerirAuth, requerirRol('admin'), ctrl.eliminarProducto);

module.exports = router;
