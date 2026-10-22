const { Router } = require('express');
const { registrarse, iniciarSesion, perfil } = require('../controllers/auth');
const { requerirAuth } = require('../middleware/auth');

const router = Router();

router.post('/register', registrarse);
router.post('/login', iniciarSesion);
router.get('/perfil', requerirAuth, perfil);

module.exports = router;
