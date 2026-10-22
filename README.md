# ADSO 68 — API Tienda (Node.js + Express 5 + MySQL)

API REST con autenticación JWT y módulos de **productos, pedidos, facturas e inventario**.
Validación de datos, roles de usuario, hash de contraseñas con bcrypt, transacciones
de base de datos para el stock, y respuestas JSON consistentes (`{ ok, mensaje, data }`).

## Estructura del proyecto

```
app.cjs                      Punto de entrada del servidor
src/
  config/db.js               Pool de conexiones MySQL (mysql2/promise)
  controllers/               Lógica de negocio (auth, productos, pedidos, facturas, inventario)
  middleware/auth.js         JWT: requerirAuth + requerirRol('admin')
  middleware/error.js        404 (rutas inexistentes) y 500 (errores globales)
  routes/                    Definición de rutas por módulo
  scripts/restaurar_db.js    Script de instalación/migración de la base de datos
  utils/                     Utilidades auxiliares: validaciones y formato de respuestas
database/
  adso_68_node_nuevo.sql     Esquema completo + datos semilla (importable en phpMyAdmin)
scripts/
  prueba_endpoints.js        Prueba de humo del flujo completo (47 verificaciones)
postman/
  adso-68-api.postman_collection.json   Colección de Postman lista para importar
```

## Instalación

```bash
npm install                # dependencias
npm run db:restaurar       # crea/migra la base de datos (MySQL de XAMPP encendido)
npm start                  # arranca la API en http://localhost:3000/api
```

Durante desarrollo usa `npm run dev` (reinicia al guardar cambios con node --watch).

Configuración en el archivo `.env` (ejemplo en `.env.example`): `DB_HOST`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`, `PORT` y `JWT_SECRET` (cámbialo en producción).

### Cuentas de prueba

| Usuario    | Clave        | Rol      | Nota                                   |
|------------|--------------|----------|----------------------------------------|
| `admin`    | `admin123`   | admin    | Semilla en instalación nueva           |
| `vendedor` | `vendedor123`| vendedor | Semilla en instalación nueva           |

Si existían usuarios antiguos con claves en texto plano, el script `npm run db:restaurar`
los **migra automáticamente** (se agrega `nombre`, `rol` y `creado_en`; su clave actual se
cifra con bcrypt conservando el valor original).

## Autenticación JWT

Casi todos los endpoints requieren el header:

```
Authorization: Bearer <token>
```

El token se obtiene con `POST /api/auth/login` (o `/api/auth/register`, que también lo
devuelve) y vence en **8 horas**. Los roles:

- **vendedor**: crear/consultar/listar pedidos, listar/consultar productos y facturas.
- **admin**: además crear/actualizar/eliminar productos, generar y pagar facturas,
  registrar movimientos de inventario y eliminar pedidos.

## Endpoints

### Autenticación (`/api/auth`)
| Método | Ruta       | Descripción                                    |
|--------|------------|------------------------------------------------|
| POST   | /register  | Registro público. Devuelve usuario + token     |
| POST   | /login     | Login público. Devuelve usuario + token        |
| GET    | /perfil    | Perfil del usuario autenticado (requiere token)|

### Productos (`/api/productos`)
| Método | Ruta   | Rol     | Descripción                                        |
|--------|--------|---------|----------------------------------------------------|
| GET    | /      | auth    | Listar con filtros y paginación `?nombre=&categoria=&estado=&pagina=&limite=` |
| GET    | /:id   | auth    | Consultar por id                                   |
| POST   | /      | admin   | Crear `{ nombre, precio, stock?, descripcion?, categoria? }` |
| PUT    | /:id   | admin   | Actualización parcial (solo los campos que envías) |
| DELETE | /:id   | admin   | Eliminación real; 409 si ya se usó en pedidos (sugerencia: `PUT estado: 0`) |

### Pedidos (`/api/pedidos`)
| Método | Ruta         | Rol   | Descripción                                     |
|--------|--------------|-------|-------------------------------------------------|
| POST   | /            | auth  | Crear pedido con items. Valida stock, descuenta el inventario y registra el kardex en una transacción |
| GET    | /            | auth  | Listar `?estado=&cliente=&pagina=&limite=`      |
| GET    | /:id         | auth  | Consultar pedido con sus líneas                 |
| PUT    | /:id/estado  | auth  | Cambiar estado (máquina de estados, ver abajo)  |
| DELETE | /:id         | admin | Eliminar solo pedidos **cancelados**            |

Ciclo de vida del pedido: `pendiente → confirmado → entregado → facturado`,
y `pendiente/confirmado → cancelado` (devuelve el stock y registra el kardex de entrada).
El estado `facturado` se asigna automáticamente al generar la factura.

Cuerpo de creación:

```json
{
  "cliente": "Doña Mercedes",
  "items": [
    { "producto_id": 3, "cantidad": 2 },
    { "producto_id": 7, "cantidad": 1 }
  ]
}
```

### Facturas (`/api/facturas`)
| Método | Ruta       | Rol   | Descripción                                     |
|--------|------------|-------|-------------------------------------------------|
| POST   | /          | admin | Generar desde un pedido `{ pedido_id }`. Calcula subtotal + **IVA 19%**; numeración `F-000001`; marca el pedido como facturado |
| GET    | /          | auth  | Listar `?estado=emitida|pagada&pedido_id=&pagina=&limite=` |
| GET    | /:id       | auth  | Consultar factura con su detalle                |
| PUT    | /:id/pagar | admin | Marcar como pagada (una sola vez; la factura pagada es inmutable) |

Una factura por pedido (llave única); no se puede facturar un pedido cancelado.

### Inventario (`/api/inventario`)
| Método | Ruta         | Rol   | Descripción                                     |
|--------|--------------|-------|-------------------------------------------------|
| GET    | /            | auth  | Stock actual por producto `?nombre=&minimo=N` (alertas de stock bajo) |
| GET    | /movimientos | auth  | Kardex (historial) `?producto_id=&tipo=&pagina=` |
| POST   | /movimientos | admin | Entrada (suma), salida (resta) o ajuste (con signo, requiere motivo) |

Los movimientos registran tipo, cantidad con signo, stock anterior/nuevo, referencia
(pedido o motivo) y el usuario que los hizo. **No se eliminan ni se editan**: son la
trazabilidad del inventario (si te equivocas, ingresa un ajuste compensatorio).

## Ejemplos rápidos (curl)

```bash
# Registro (devuelve token listo para usar)
curl -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d "{\"nombre\":\"Juan Perez\",\"usuario\":\"jperez\",\"clave\":\"secreta123\"}"

# Login
curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d "{\"usuario\":\"admin\",\"clave\":\"admin123\"}"

# Listar productos (con el token obtenido)
curl http://localhost:3000/api/productos -H "Authorization: Bearer <TOKEN>"

# Crear pedido
curl -X POST http://localhost:3000/api/pedidos -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"cliente\":\"Doña Mercedes\",\"items\":[{\"producto_id\":1,\"cantidad\":2}]}"

# Facturar el pedido 1
curl -X POST http://localhost:3000/api/facturas -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" -d "{\"pedido_id\":1}"
```

## Pruebas

Con la API corriendo (`npm start`), en otra terminal:

```bash
npm run prueba
```

Ejecuta 47 verificaciones del flujo completo (registro, login, permisos por rol,
CRUD de productos, pedidos con stock y cancelaciones, facturas con IVA, y kardex).
Como referencia, el resultado esperado es: `RESULTADO: 47/47 pruebas OK, 0 fallas`.

## Notas de seguridad

- Las contraseñas **nunca** se almacenan en texto plano: bcrypt con coste 10.
- El login responde un mensaje genérico en credenciales erradas (no revela si el usuario existe).
- Los `id` de registro siempre son "vendedor"; solo administradores dan permisos desde la BD.
- Todas las consultas usan consultas preparadas (`?`), evitando inyección SQL.
- El stock de los pedidos se maneja con transacciones + `SELECT ... FOR UPDATE`,
  evitando ventas simultáneas con stock insuficiente.

## Compatibilidad con la versión anterior del código

Tus rutas antiguas `POST /api/login` y `POST /api/register` siguen funcionando
(ahora responden igual que las de `/api/auth`) para que no tengas que actualizar
clientes o pruebas existentes.
