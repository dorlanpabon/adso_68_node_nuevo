const { Router } = require('express');
const authRoutes = require('./auth.routes');
const productosRoutes = require('./productos.routes');
const pedidosRoutes = require('./pedidos.routes');
const facturasRoutes = require('./facturas.routes');
const inventarioRoutes = require('./inventario.routes');
const { iniciarSesion, registrarse } = require('../controllers/auth');

const router = Router();

router.use('/auth', authRoutes);
router.use('/productos', productosRoutes);
router.use('/pedidos', pedidosRoutes);
router.use('/facturas', facturasRoutes);
router.use('/inventario', inventarioRoutes);

// Alias de compatibilidad con las rutas antiguas de tu código original
router.post('/login', iniciarSesion);
router.post('/register', registrarse);

module.exports = router;
