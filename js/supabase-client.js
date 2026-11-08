/**
 * Cliente y Métodos de Conexión a Supabase para el Sistema BG
 * ==========================================================
 * Conexión en vivo con PostgreSQL en la nube para Inventario, Kardex, Ventas y Cuentas.
 */

const SUPABASE_CONFIG = {
  url: 'https://ghrepbiroaglyaihlbck.supabase.co',
  anonKey: 'sb_publishable_sb2zHIU5UGaq69TcL2POYQ_0Kjyos4A'
};

// Cliente global
window.supabaseClient = null;

/**
 * Inicializar el cliente de Supabase
 */
function initSupabase() {
  if (typeof window.supabase !== 'undefined' && SUPABASE_CONFIG.url) {
    try {
      window.supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('✅ Supabase inicializado correctamente.');
      return window.supabaseClient;
    } catch (e) {
      console.error('Error al inicializar Supabase:', e);
      return null;
    }
  }
  return null;
}

// ============================================================================
// MÉTODOS CRUD: INVENTARIO Y PRODUCTOS
// ============================================================================

/**
 * Obtener todos los productos del inventario desde Supabase
 */
async function apiObtenerProductos() {
  if (!window.supabaseClient) return null;
  try {
    const { data, error } = await window.supabaseClient
      .from('productos')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) {
      console.error('Error al cargar productos de Supabase:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Fallo en la petición apiObtenerProductos:', err);
    return null;
  }
}

/**
 * Guardar o ingresar un nuevo producto en la base de datos
 */
async function apiCrearProducto(producto) {
  if (!window.supabaseClient) return null;
  const { data, error } = await window.supabaseClient
    .from('productos')
    .insert([producto])
    .select();

  if (error) {
    console.error('Error al insertar producto:', error.message);
    throw error;
  }
  return data[0];
}

/**
 * Eliminar un producto por ID
 */
async function apiEliminarProducto(productoId) {
  if (!window.supabaseClient) return false;
  const { error } = await window.supabaseClient
    .from('productos')
    .delete()
    .eq('id', productoId);

  if (error) {
    console.error('Error al eliminar producto:', error.message);
    throw error;
  }
  return true;
}

/**
 * Registrar un movimiento en el Kardex y actualizar el stock del producto
 */
async function apiRegistrarMovimiento({ productoId, tipo, cantidad, motivo, usuario = 'Gabriel Admin' }) {
  if (!window.supabaseClient || !productoId) return null;

  try {
    // 1. Obtener producto actual
    const { data: prod, error: errProd } = await window.supabaseClient
      .from('productos')
      .select('stock_actual')
      .eq('id', productoId)
      .single();

    if (errProd) throw errProd;

    // 2. Calcular nuevo stock (evitar negativos)
    let nuevoStock = prod.stock_actual;
    if (tipo === 'ingreso') nuevoStock += cantidad;
    if (tipo === 'salida') nuevoStock = Math.max(0, nuevoStock - cantidad);
    if (tipo === 'ajuste') nuevoStock = Math.max(0, cantidad);

    // 3. Registrar el movimiento en Kardex
    await window.supabaseClient
      .from('movimientos_inventario')
      .insert([{
        producto_id: productoId,
        tipo,
        cantidad,
        motivo,
        usuario
      }]);

    // 4. Actualizar el stock en la tabla productos
    const { data: updatedProd, error: errUpdate } = await window.supabaseClient
      .from('productos')
      .update({ stock_actual: nuevoStock })
      .eq('id', productoId)
      .select()
      .single();

    if (errUpdate) throw errUpdate;
    return updatedProd;
  } catch (err) {
    console.error('Error en apiRegistrarMovimiento:', err);
    return null;
  }
}

// ============================================================================
// MÉTODOS CRUD: VENTAS & ÓRDENES
// ============================================================================

/**
 * Obtener las ventas más recientes con el detalle de items y productos
 */
async function apiObtenerVentas(limite = 50) {
  if (!window.supabaseClient) return null;
  try {
    const { data, error } = await window.supabaseClient
      .from('ventas')
      .select('*, detalle_ventas(*, productos(nombre, sku))')
      .order('created_at', { ascending: false })
      .limit(limite);

    if (error) {
      console.error('Error al cargar ventas de Supabase:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Fallo en la petición apiObtenerVentas:', err);
    return null;
  }
}

/**
 * Registrar una nueva venta completa en Supabase con sus items, rebaja de stock y cuentas por cobrar
 */
async function apiRegistrarVenta({ cliente, canal, metodoPago, estado, items, total, usuario = 'Gabriel' }) {
  if (!window.supabaseClient) return null;

  // 1. Obtener correlativo de orden
  const { data: ultimasVentas } = await window.supabaseClient
    .from('ventas')
    .select('id')
    .limit(100);

  const correlativoNum = (ultimasVentas?.length || 0) + 1;
  const codigoOrden = `#00.${String(correlativoNum).padStart(3, '0')}`;

  const subtotalNum = parseFloat(total);

  // 2. Insertar cabecera de la venta
  const { data: ventaData, error: errVenta } = await window.supabaseClient
    .from('ventas')
    .insert([{
      codigo_orden: codigoOrden,
      cliente: cliente || 'Consumidor Final',
      canal: canal || 'Local',
      metodo_pago: metodoPago || 'Efectivo',
      subtotal: subtotalNum,
      impuesto: 0.00,
      total: subtotalNum,
      estado: estado || 'completada',
      usuario: usuario
    }])
    .select()
    .single();

  if (errVenta) {
    console.error('Error al crear venta:', errVenta);
    throw errVenta;
  }

  // 3. Insertar detalles de ítems y rebajar stock
  for (const item of items) {
    const itemCant = parseInt(item.cantidad, 10) || 1;
    const itemPrecio = parseFloat(item.precio_unitario) || 0;
    const itemSubtotal = itemCant * itemPrecio;

    await window.supabaseClient
      .from('detalle_ventas')
      .insert([{
        venta_id: ventaData.id,
        producto_id: item.producto_id || null,
        cantidad: itemCant,
        precio_unitario: itemPrecio,
        subtotal: itemSubtotal
      }]);

    // Rebajar stock de inventario si proviene de un producto existente
    if (item.producto_id) {
      await apiRegistrarMovimiento({
        productoId: item.producto_id,
        tipo: 'salida',
        cantidad: itemCant,
        motivo: `Venta orden ${codigoOrden}`,
        usuario: usuario
      });
    }
  }

  // 4. Si el método de pago es Crédito, registrar automáticamente en Cuentas por Cobrar
  const metodoNormalizado = (metodoPago || '').toLowerCase();
  if (metodoNormalizado.includes('crédito') || metodoNormalizado.includes('credito')) {
    const fechaVence = new Date();
    fechaVence.setDate(fechaVence.getDate() + 15); // Vence en 15 días

    await window.supabaseClient
      .from('cuentas')
      .insert([{
        tipo: 'cobrar',
        tercero: cliente || 'Consumidor Final',
        concepto: `Venta a crédito orden ${codigoOrden}`,
        monto_total: subtotalNum,
        monto_pagado: 0.00,
        fecha_vencimiento: fechaVence.toISOString().split('T')[0],
        estado: 'pendiente'
      }]);
  }

  return ventaData;
}

/**
 * Eliminar una venta por ID
 */
async function apiEliminarVenta(ventaId) {
  if (!window.supabaseClient) return false;
  const { error } = await window.supabaseClient
    .from('ventas')
    .delete()
    .eq('id', ventaId);

  if (error) {
    console.error('Error al eliminar venta:', error.message);
    throw error;
  }
  return true;
}

/**
 * Sembrar datos de ventas iniciales si la tabla está completamente vacía
 */
async function apiSembrarVentasInicialesSiVacio(productos) {
  if (!window.supabaseClient) return;

  const { data: existentes } = await window.supabaseClient
    .from('ventas')
    .select('id')
    .limit(1);

  if (existentes && existentes.length > 0) return; // Ya contiene ventas

  console.log('🌱 Inicializando ventas de demostración en Supabase...');

  const prod1 = productos?.[0];
  const prod2 = productos?.[1];
  const prod3 = productos?.[2];

  const ventasMuestra = [
    {
      cliente: 'Gabriel Rodríguez',
      canal: 'Delivery',
      metodoPago: 'Pago Móvil',
      estado: 'completada',
      items: [{ producto_id: prod1?.id || null, cantidad: 2, precio_unitario: prod1 ? prod1.precio_venta : 8.50, nombre: prod1?.nombre || 'Hamburguesa Doble BG' }],
      total: (prod1 ? prod1.precio_venta * 2 : 17.00)
    },
    {
      cliente: 'Alejandro Fariña',
      canal: 'Local',
      metodoPago: 'Efectivo',
      estado: 'completada',
      items: [{ producto_id: prod2?.id || null, cantidad: 1, precio_unitario: prod2 ? prod2.precio_venta : 2.50, nombre: prod2?.nombre || 'Papas Rústicas Crispy' }],
      total: (prod2 ? prod2.precio_venta : 2.50)
    },
    {
      cliente: 'María Fernanda',
      canal: 'WhatsApp',
      metodoPago: 'Crédito',
      estado: 'pendiente',
      items: [{ producto_id: prod3?.id || null, cantidad: 3, precio_unitario: prod3 ? prod3.precio_venta : 1.75, nombre: prod3?.nombre || 'Refresco Cola 500ml' }],
      total: (prod3 ? prod3.precio_venta * 3 : 5.25)
    }
  ];

  for (const v of ventasMuestra) {
    try {
      await apiRegistrarVenta(v);
    } catch (e) {
      console.warn('No se pudo insertar venta muestra:', e);
    }
  }
}

// ============================================================================
// INTEGRACIÓN CON LA PÁGINA DE VENTAS (RENDERIZADO Y MODAL)
// ============================================================================

/**
 * Renderizar las ventas reales en la tabla de ventas.html y calcular KPIs en vivo
 */
async function sincronizarVentasUI() {
  const salesTable = document.getElementById('salesTable');
  if (!salesTable) return;

  const tbody = salesTable.querySelector('tbody');
  if (!tbody) return;

  // Spinner de carga
  tbody.innerHTML = `
    <tr>
      <td colspan="9" class="py-8 text-center text-slate-400">
        <div class="flex items-center justify-center gap-2">
          <div class="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Cargando ventas desde Supabase...</span>
        </div>
      </td>
    </tr>
  `;

  // Asegurar que haya productos y sembrar datos si es primera vez
  const productos = await apiObtenerProductos();
  await apiSembrarVentasInicialesSiVacio(productos);

  const ventas = await apiObtenerVentas(100);

  if (!ventas) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-6 text-center text-amber-600 bg-amber-50/50">
          No se pudo conectar con las ventas de Supabase. Revisa tu conexión.
        </td>
      </tr>
    `;
    actualizarBadgeEstado(false);
    return;
  }

  actualizarBadgeEstado(true);

  if (ventas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-8 text-center text-slate-400">
          No hay ventas registradas aún. Haz clic en <strong>"Nueva venta rápida"</strong> para realizar la primera.
        </td>
      </tr>
    `;
    actualizarTotalesKPIsVentas([]);
    return;
  }

  // Renderizar filas dinámicas
  tbody.innerHTML = '';

  ventas.forEach(v => {
    const canalLower = (v.canal || 'local').toLowerCase();
    const canalConfig = {
      local: { bg: 'bg-purple-50', text: 'text-[#7036ee]', label: 'Local' },
      delivery: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Delivery' },
      whatsapp: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'WhatsApp' },
      web: { bg: 'bg-indigo-50', text: 'text-indigo-600', label: 'Web' }
    }[canalLower] || { bg: 'bg-slate-100', text: 'text-slate-600', label: v.canal };

    const estadoLower = (v.estado || 'completada').toLowerCase();
    const estadoConfig = {
      completada: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Completada' },
      pendiente: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Pendiente' },
      cancelada: { bg: 'bg-rose-50', text: 'text-rose-600', label: 'Cancelada' }
    }[estadoLower] || { bg: 'bg-slate-100', text: 'text-slate-600', label: v.estado };

    // Resumen de items
    let itemsTexto = 'Venta directa';
    if (v.detalle_ventas && v.detalle_ventas.length > 0) {
      itemsTexto = v.detalle_ventas.map(d => {
        const prodName = d.productos?.nombre || 'Ítem';
        return `${d.cantidad}x ${prodName}`;
      }).join(', ');
    }

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/70 transition border-b border-slate-100 text-xs md:text-sm';
    tr.setAttribute('data-channel', canalLower);

    tr.innerHTML = `
      <td class="py-3.5 px-4 font-bold text-[#7036ee]">${escapeHTML(v.codigo_orden)}</td>
      <td class="py-3.5 px-4 text-slate-500">${formatearFechaHora(v.created_at)}</td>
      <td class="py-3.5 px-4 font-semibold text-slate-800">${escapeHTML(v.cliente)}</td>
      <td class="py-3.5 px-4 text-slate-600">
        <span class="px-2 py-0.5 rounded-md ${canalConfig.bg} ${canalConfig.text} font-medium text-xs">
          ${canalConfig.label}
        </span>
      </td>
      <td class="py-3.5 px-4 text-slate-600">${escapeHTML(v.metodo_pago)}</td>
      <td class="py-3.5 px-4 text-slate-600 max-w-[250px] truncate" title="${escapeHTML(itemsTexto)}">
        ${escapeHTML(itemsTexto)}
      </td>
      <td class="py-3.5 px-4 font-bold text-slate-900 text-right">$${Number(v.total).toFixed(2)}</td>
      <td class="py-3.5 px-4 text-center">
        <span class="px-2 py-1 rounded-full text-xs font-semibold ${estadoConfig.bg} ${estadoConfig.text}">
          ${estadoConfig.label}
        </span>
      </td>
      <td class="py-3.5 px-4 text-right">
        <div class="flex items-center justify-end gap-1">
          <button class="btn-delete-sale p-1.5 rounded-lg hover:text-red-600 hover:bg-red-50 transition" title="Eliminar orden" data-id="${v.id}" data-folio="${escapeHTML(v.codigo_orden)}">
            <i data-lucide="trash-2" class="w-4 h-4 text-slate-400 hover:text-red-600"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Actualizar métricas y conteos
  actualizarTotalesKPIsVentas(ventas);

  // Vincular eventos de eliminación de ventas
  tbody.querySelectorAll('.btn-delete-sale').forEach(btn => {
    btn.addEventListener('click', async () => {
      const saleId = btn.getAttribute('data-id');
      const folio = btn.getAttribute('data-folio');
      if (confirm(`¿Estás seguro de eliminar la orden ${folio} de la base de datos?`)) {
        try {
          btn.disabled = true;
          await apiEliminarVenta(saleId);
          if (window.showToast) {
            window.showToast(`Orden ${folio} eliminada de Supabase.`, 'info');
          }
          await sincronizarVentasUI();
        } catch (err) {
          alert('Error al eliminar venta: ' + err.message);
          btn.disabled = false;
        }
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Calcular y actualizar las 4 tarjetas de KPIs superiores de ventas y los conteos de pestañas
 */
function actualizarTotalesKPIsVentas(ventas) {
  const salesTodayKpi = document.getElementById('salesTodayKpi');
  const salesTicketAvgKpi = document.getElementById('salesTicketAvgKpi');
  const salesOrdersCountKpi = document.getElementById('salesOrdersCountKpi');
  const salesCreditKpi = document.getElementById('salesCreditKpi');

  const countAll = document.getElementById('countAll');
  const countLocal = document.getElementById('countLocal');
  const countDelivery = document.getElementById('countDelivery');
  const countWhatsapp = document.getElementById('countWhatsapp');

  let facturacionTotal = 0;
  let ordenesCompletadas = 0;
  let porCobrarCredito = 0;

  let nLocal = 0;
  let nDelivery = 0;
  let nWhatsapp = 0;

  ventas.forEach(v => {
    const tot = parseFloat(v.total) || 0;
    const est = (v.estado || '').toLowerCase();
    const met = (v.metodo_pago || '').toLowerCase();
    const can = (v.canal || '').toLowerCase();

    if (can.includes('local')) nLocal++;
    if (can.includes('delivery')) nDelivery++;
    if (can.includes('whatsapp')) nWhatsapp++;

    if (est === 'completada') {
      facturacionTotal += tot;
      ordenesCompletadas++;
    }

    if (met.includes('crédito') || met.includes('credito') || est === 'pendiente') {
      porCobrarCredito += tot;
    }
  });

  const ticketPromedio = ordenesCompletadas > 0 ? (facturacionTotal / ordenesCompletadas) : 0;

  if (salesTodayKpi) salesTodayKpi.textContent = `$${facturacionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (salesTicketAvgKpi) salesTicketAvgKpi.textContent = `$${ticketPromedio.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (salesOrdersCountKpi) salesOrdersCountKpi.textContent = ordenesCompletadas;
  if (salesCreditKpi) salesCreditKpi.textContent = `$${porCobrarCredito.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (countAll) countAll.textContent = ventas.length;
  if (countLocal) countLocal.textContent = nLocal;
  if (countDelivery) countDelivery.textContent = nDelivery;
  if (countWhatsapp) countWhatsapp.textContent = nWhatsapp;
}

/**
 * Cargar el catálogo de productos de Supabase en el selector del modal de venta
 */
async function poblarSelectorProductosVenta() {
  const saleProductSelect = document.getElementById('saleProductSelect');
  if (!saleProductSelect) return;

  const productos = await apiObtenerProductos();

  saleProductSelect.innerHTML = '<option value="">-- Selecciona un producto del catálogo --</option>';

  if (productos && productos.length > 0) {
    productos.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.setAttribute('data-price', p.precio_venta);
      opt.setAttribute('data-stock', p.stock_actual);
      opt.setAttribute('data-name', p.nombre);
      opt.textContent = `${p.nombre} ($${Number(p.precio_venta).toFixed(2)} - Stock: ${p.stock_actual} ${p.unidad_medida || 'Und.'})`;
      saleProductSelect.appendChild(opt);
    });
  }

  // Opción para ítem personalizado o manual
  const optCustom = document.createElement('option');
  optCustom.value = 'custom';
  optCustom.textContent = '✏️ Ítem manual o servicio personalizado';
  saleProductSelect.appendChild(optCustom);

  // Escuchar cambio en el selector de producto
  saleProductSelect.addEventListener('change', () => {
    const selected = saleProductSelect.options[saleProductSelect.selectedIndex];
    const customContainer = document.getElementById('customProductContainer');
    const saleProductInput = document.getElementById('saleProduct');
    const salePriceInput = document.getElementById('salePrice');
    const saleQuantityInput = document.getElementById('saleQuantity');
    const productStockBadge = document.getElementById('productStockBadge');

    if (saleProductSelect.value === 'custom') {
      if (customContainer) customContainer.classList.remove('hidden');
      if (saleProductInput) saleProductInput.required = true;
      if (productStockBadge) productStockBadge.textContent = 'Ítem personalizado sin control de stock.';
    } else if (saleProductSelect.value) {
      if (customContainer) customContainer.classList.add('hidden');
      if (saleProductInput) {
        saleProductInput.required = false;
        saleProductInput.value = selected.getAttribute('data-name') || '';
      }
      const price = parseFloat(selected.getAttribute('data-price') || 0);
      const stock = parseInt(selected.getAttribute('data-stock') || 0, 10);

      if (salePriceInput) salePriceInput.value = price.toFixed(2);
      if (saleQuantityInput) saleQuantityInput.max = stock > 0 ? stock : 999;
      if (productStockBadge) {
        productStockBadge.innerHTML = stock > 0 
          ? `<span class="text-emerald-600 font-semibold">Existencias disponibles: ${stock}</span>`
          : `<span class="text-rose-600 font-semibold">⚠️ Producto agotado en inventario</span>`;
      }
    } else {
      if (customContainer) customContainer.classList.add('hidden');
      if (productStockBadge) productStockBadge.textContent = '';
    }

    actualizarPreviewTotalVenta();
  });

  // Escuchar inputs de cantidad y precio para total en vivo
  const qtyInput = document.getElementById('saleQuantity');
  const priceInput = document.getElementById('salePrice');
  if (qtyInput) qtyInput.addEventListener('input', actualizarPreviewTotalVenta);
  if (priceInput) priceInput.addEventListener('input', actualizarPreviewTotalVenta);
}

/**
 * Previsualizar el total de la orden en el modal
 */
function actualizarPreviewTotalVenta() {
  const qty = parseFloat(document.getElementById('saleQuantity')?.value || 0);
  const price = parseFloat(document.getElementById('salePrice')?.value || 0);
  const total = (qty * price).toFixed(2);
  const preview = document.getElementById('saleTotalPreview');
  if (preview) {
    preview.textContent = `$${total}`;
  }
}

/**
 * Vincular el formulario de Nueva Venta con Supabase
 */
function vincularFormularioVenta() {
  const saleForm = document.getElementById('newSaleForm');
  if (!saleForm) return;

  saleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.supabaseClient) {
      alert('Supabase no está conectado.');
      return;
    }

    const submitBtn = saleForm.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.innerHTML : 'Guardar Venta';

    try {
      const client = document.getElementById('saleClient')?.value.trim() || 'Consumidor Final';
      const prodSelect = document.getElementById('saleProductSelect');
      const selectedOption = prodSelect?.options[prodSelect.selectedIndex];

      let prodId = null;
      let prodName = '';

      if (prodSelect && prodSelect.value === 'custom') {
        prodName = document.getElementById('saleProduct')?.value.trim() || 'Servicio / Ítem';
      } else if (prodSelect && prodSelect.value) {
        prodId = prodSelect.value;
        prodName = selectedOption.getAttribute('data-name') || 'Producto';
      } else {
        prodName = document.getElementById('saleProduct')?.value.trim() || 'Producto General';
      }

      const qty = parseInt(document.getElementById('saleQuantity')?.value || 1, 10);
      const price = parseFloat(document.getElementById('salePrice')?.value || 0);
      const channel = document.getElementById('saleChannel')?.value || 'Local';
      const paymentMethod = document.getElementById('salePaymentMethod')?.value || 'Efectivo';
      const status = document.getElementById('saleStatus')?.value || 'completada';

      // Verificar stock si es un producto existente
      if (prodId && selectedOption) {
        const stockActual = parseInt(selectedOption.getAttribute('data-stock') || 0, 10);
        if (stockActual < qty && status === 'completada') {
          if (!confirm(`El producto "${prodName}" solo tiene ${stockActual} unidades en inventario. ¿Deseas registrar la venta igualmente?`)) {
            return;
          }
        }
      }

      const total = qty * price;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Guardando en Supabase...</span>
          </div>
        `;
      }

      // Registrar venta en Supabase
      const ventaCreada = await apiRegistrarVenta({
        cliente: client,
        canal: channel,
        metodoPago: paymentMethod,
        estado: status,
        items: [{
          producto_id: prodId,
          cantidad: qty,
          precio_unitario: price,
          nombre: prodName
        }],
        total: total,
        usuario: 'Gabriel'
      });

      // Mostrar notificación
      if (window.showToast) {
        window.showToast(`¡Venta ${ventaCreada.codigo_orden} registrada con éxito en Supabase!`, 'success');
      }

      saleForm.reset();
      actualizarPreviewTotalVenta();

      // Cerrar modal
      const saleModal = document.getElementById('newSaleModal');
      if (saleModal) {
        const box = saleModal.querySelector('.modal-content-box');
        if (box) {
          box.classList.remove('scale-100', 'opacity-100');
          box.classList.add('scale-95', 'opacity-0');
        }
        setTimeout(() => saleModal.classList.add('hidden'), 200);
      }

      // Recargar tabla de ventas
      await sincronizarVentasUI();

    } catch (err) {
      console.error('Error al registrar venta en Supabase:', err);
      alert('Error al registrar venta: ' + (err.message || err));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  });
}

// ============================================================================
// INTEGRACIÓN CON LA PÁGINA DE INVENTARIO (RENDERIZADO Y FORMULARIO)
// ============================================================================

/**
 * Renderizar los productos reales de Supabase en la tabla de inventario.html
 */
async function sincronizarInventarioUI() {
  const inventoryTable = document.getElementById('inventoryTable');
  if (!inventoryTable) return;

  const tbody = inventoryTable.querySelector('tbody');
  if (!tbody) return;

  // Mostrar indicador de carga
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="py-8 text-center text-slate-400">
        <div class="flex items-center justify-center gap-2">
          <div class="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Cargando inventario desde Supabase...</span>
        </div>
      </td>
    </tr>
  `;

  const productos = await apiObtenerProductos();

  if (!productos) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-6 text-center text-amber-600 bg-amber-50/50">
          No se pudo conectar con Supabase. Verifica tu conexión a internet o tus credenciales.
        </td>
      </tr>
    `;
    actualizarBadgeEstado(false);
    return;
  }

  actualizarBadgeEstado(true);

  if (productos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-slate-400">
          El inventario está vacío. Haz clic en <strong>"Ingreso a inventario"</strong> para registrar tu primer producto.
        </td>
      </tr>
    `;
    actualizarTotalesKPIs(0, 0);
    return;
  }

  // Limpiar y renderizar filas dinámicas
  tbody.innerHTML = '';
  let totalCostoInventario = 0;
  let totalVentaInventario = 0;

  productos.forEach(prod => {
    const costo = parseFloat(prod.precio_costo || 0);
    const venta = parseFloat(prod.precio_venta || 0);
    const stock = parseFloat(prod.stock_actual || 0);
    const stockMin = parseFloat(prod.stock_minimo || 5);
    const unidad = prod.unidad_medida || 'unidades';

    const valorTotalFila = costo * stock;
    totalCostoInventario += valorTotalFila;
    totalVentaInventario += (venta * stock);

    const esBajoStock = stock <= stockMin;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/70 transition border-b border-slate-100';
    tr.dataset.productId = prod.id;

    tr.innerHTML = `
      <td class="py-3.5 px-4 font-semibold text-slate-800">
        <div class="flex items-center gap-2">
          <span>${escapeHTML(prod.nombre)}</span>
          ${esBajoStock ? `
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700" title="Bajo stock (Mínimo: ${stockMin})">
              Bajo Stock
            </span>
          ` : ''}
        </div>
      </td>
      <td class="py-3.5 px-4 text-center text-slate-400">${escapeHTML(prod.sku || '--')}</td>
      <td class="py-3.5 px-4 text-center">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          ${escapeHTML(prod.categoria || 'General')}
        </span>
      </td>
      <td class="py-3.5 px-4 text-right text-slate-600">$${costo.toFixed(2)}/${unidad}</td>
      <td class="py-3.5 px-4 text-right ${esBajoStock ? 'text-amber-600 font-bold' : 'text-slate-700'}">
        ${stock} ${unidad}
      </td>
      <td class="py-3.5 px-4 text-right font-bold text-slate-800">$${valorTotalFila.toFixed(2)}</td>
      <td class="py-3.5 px-4 text-right">
        <div class="flex items-center justify-end gap-1.5 text-slate-400">
          <button class="btn-delete-prod p-1.5 rounded-lg hover:text-red-600 hover:bg-red-50 transition" title="Eliminar ítem" data-id="${prod.id}" data-nombre="${escapeHTML(prod.nombre)}">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Actualizar los KPIs superiores
  actualizarTotalesKPIs(totalCostoInventario, totalVentaInventario);

  // Vincular eventos de eliminación
  tbody.querySelectorAll('.btn-delete-prod').forEach(btn => {
    btn.addEventListener('click', async () => {
      const prodId = btn.getAttribute('data-id');
      const prodNombre = btn.getAttribute('data-nombre');
      if (confirm(`¿Estás seguro de eliminar "${prodNombre}" del inventario de Supabase?`)) {
        try {
          btn.disabled = true;
          await apiEliminarProducto(prodId);
          if (window.showToast) {
            window.showToast(`Producto "${prodNombre}" eliminado de la base de datos.`, 'info');
          }
          await sincronizarInventarioUI();
        } catch (err) {
          alert('Error al eliminar: ' + err.message);
          btn.disabled = false;
        }
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Actualizar los KPIs de resumen de inventario
 */
function actualizarTotalesKPIs(costoTotal, ventaTotal) {
  const invCostVal = document.getElementById('invCostVal');
  const invSaleVal = document.getElementById('invSaleVal');

  if (invCostVal) invCostVal.textContent = `$${costoTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (invSaleVal) invSaleVal.textContent = `$${ventaTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Actualizar el estado visual del badge de Supabase
 */
function actualizarBadgeEstado(conectado) {
  const badge = document.getElementById('dbStatusBadge');
  if (!badge) return;

  if (conectado) {
    badge.className = 'bg-emerald-50 text-emerald-700 font-semibold text-xs py-1.5 px-3 rounded-full border border-emerald-200 flex items-center gap-1.5 shadow-2xs';
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
      <span>Supabase Conectado</span>
    `;
  } else {
    badge.className = 'bg-amber-50 text-amber-700 font-semibold text-xs py-1.5 px-3 rounded-full border border-amber-200 flex items-center gap-1.5 shadow-2xs';
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-amber-500"></span>
      <span>Sin Conexión Supabase</span>
    `;
  }
}

/**
 * Vincular el formulario modal de Ingreso a Inventario para guardar directamente en Supabase
 */
function vincularFormularioIngreso() {
  const ingressForm = document.getElementById('ingressForm');
  if (!ingressForm) return;

  ingressForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.supabaseClient) {
      alert('Supabase no está conectado.');
      return;
    }

    const submitBtn = ingressForm.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.innerHTML : 'Registrar Ingreso';

    try {
      const nombre = document.getElementById('itemNombre')?.value.trim();
      let sku = document.getElementById('itemSku')?.value.trim();
      const categoria = document.getElementById('itemCategoria')?.value.trim() || 'General';
      const costo = parseFloat(document.getElementById('itemCosto')?.value || 0);
      let precioVenta = parseFloat(document.getElementById('itemPrecioVenta')?.value || 0);
      const cantidad = parseFloat(document.getElementById('itemCantidad')?.value || 0);
      const unidad = document.getElementById('itemUnidad')?.value || 'unidades';
      const stockMin = parseInt(document.getElementById('itemStockMin')?.value || 5, 10);

      if (!nombre) {
        alert('Por favor indica el nombre del producto.');
        return;
      }

      if (!sku) {
        sku = (nombre.slice(0, 3).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900));
      }

      if (!precioVenta || precioVenta <= 0) {
        precioVenta = +(costo * 1.30).toFixed(2);
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Guardando en Supabase...</span>
          </div>
        `;
      }

      const nuevoProducto = await apiCrearProducto({
        sku,
        nombre,
        categoria,
        precio_costo: costo,
        precio_venta: precioVenta,
        stock_actual: cantidad,
        stock_minimo: stockMin,
        unidad_medida: unidad,
        activo: true
      });

      if (nuevoProducto && cantidad > 0) {
        await window.supabaseClient.from('movimientos_inventario').insert([{
          producto_id: nuevoProducto.id,
          tipo: 'ingreso',
          cantidad: cantidad,
          motivo: 'Inventario inicial',
          usuario: 'Gabriel Admin'
        }]);
      }

      if (window.showToast) {
        window.showToast(`¡"${nombre}" guardado con éxito en Supabase!`, 'success');
      }

      ingressForm.reset();

      const ingressModal = document.getElementById('ingressModal');
      if (ingressModal) {
        const box = ingressModal.querySelector('.modal-content-box');
        if (box) {
          box.classList.remove('scale-100', 'opacity-100');
          box.classList.add('scale-95', 'opacity-0');
        }
        setTimeout(() => ingressModal.classList.add('hidden'), 200);
      }

      await sincronizarInventarioUI();

    } catch (err) {
      console.error('Error al guardar en Supabase:', err);
      alert('Error al guardar en Supabase: ' + (err.message || err));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  });
}

// ============================================================================
// MÉTODOS CRUD: GASTOS & EGRESOS
// ============================================================================

/**
 * Obtener todos los gastos desde Supabase
 */
async function apiObtenerGastos() {
  if (!window.supabaseClient) return null;
  try {
    const { data, error } = await window.supabaseClient
      .from('gastos')
      .select('*')
      .order('fecha', { ascending: false });

    if (error) {
      console.error('Error al cargar gastos de Supabase:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Fallo en la petición apiObtenerGastos:', err);
    return null;
  }
}

/**
 * Guardar un nuevo gasto en Supabase
 */
async function apiCrearGasto(gasto) {
  if (!window.supabaseClient) return null;
  const { data, error } = await window.supabaseClient
    .from('gastos')
    .insert([gasto])
    .select();

  if (error) {
    console.error('Error al insertar gasto:', error.message);
    throw error;
  }
  return data[0];
}

/**
 * Eliminar un gasto por ID
 */
async function apiEliminarGasto(gastoId) {
  if (!window.supabaseClient) return false;
  const { error } = await window.supabaseClient
    .from('gastos')
    .delete()
    .eq('id', gastoId);

  if (error) {
    console.error('Error al eliminar gasto:', error.message);
    throw error;
  }
  return true;
}

/**
 * Sembrar gastos de demostración si la tabla está vacía
 */
async function apiSembrarGastosInicialesSiVacio() {
  if (!window.supabaseClient) return;

  const { data: existentes } = await window.supabaseClient
    .from('gastos')
    .select('id')
    .limit(1);

  if (existentes && existentes.length > 0) return;

  console.log('🌱 Inicializando gastos de demostración en Supabase...');

  const gastosMuestra = [
    { codigo: 'GST-001', descripcion: 'Alquiler Local Comercial', categoria: 'Instalaciones', tipo: 'fijo', monto: 450.00, metodo_pago: 'Transferencia', estado: 'pagado' },
    { codigo: 'GST-002', descripcion: 'Nómina Colaboradores (Quincena)', categoria: 'Personal', tipo: 'fijo', monto: 480.00, metodo_pago: 'Transferencia', estado: 'pagado' },
    { codigo: 'GST-003', descripcion: 'Servicios (Electricidad e Internet)', categoria: 'Servicios Básicos', tipo: 'fijo', monto: 125.00, metodo_pago: 'Pago Móvil', estado: 'pendiente' },
    { codigo: 'GST-004', descripcion: 'Empaques, Bolsas y Vasos Delivery', categoria: 'Operaciones', tipo: 'variable', monto: 95.00, metodo_pago: 'Efectivo', estado: 'pagado' },
    { codigo: 'GST-005', descripcion: 'Publicidad en Instagram & Facebook', categoria: 'Marketing', tipo: 'variable', monto: 65.00, metodo_pago: 'Tarjeta', estado: 'pagado' }
  ];

  for (const g of gastosMuestra) {
    try {
      await apiCrearGasto(g);
    } catch (e) {
      console.warn('No se pudo insertar gasto muestra:', e);
    }
  }
}

// ============================================================================
// INTEGRACIÓN CON LA PÁGINA DE GASTOS (gastos.html)
// ============================================================================

/**
 * Renderizar la tabla de gastos y actualizar sus KPIs en vivo
 */
async function sincronizarGastosUI() {
  const expensesTable = document.getElementById('expensesTable');
  if (!expensesTable) return;

  const tbody = expensesTable.querySelector('tbody');
  if (!tbody) return;

  // Spinner de carga
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="py-8 text-center text-slate-400">
        <div class="flex items-center justify-center gap-2">
          <div class="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Cargando gastos desde Supabase...</span>
        </div>
      </td>
    </tr>
  `;

  await apiSembrarGastosInicialesSiVacio();
  const gastos = await apiObtenerGastos();

  if (!gastos) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-6 text-center text-amber-600 bg-amber-50/50">
          No se pudo conectar con los gastos de Supabase. Revisa tu conexión.
        </td>
      </tr>
    `;
    actualizarBadgeEstado(false);
    return;
  }

  actualizarBadgeEstado(true);

  if (gastos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-slate-400">
          No hay gastos registrados. Haz clic en <strong>"Registrar Nuevo Gasto"</strong> para comenzar.
        </td>
      </tr>
    `;
    actualizarTotalesKPIsGastos([]);
    return;
  }

  tbody.innerHTML = '';

  gastos.forEach(g => {
    const esFijo = (g.tipo || '').toLowerCase() === 'fijo';
    const esPagado = (g.estado || '').toLowerCase() === 'pagado';
    const monto = parseFloat(g.monto) || 0;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/50 transition border-b border-slate-100';

    tr.innerHTML = `
      <td class="py-3.5 px-5 font-bold text-slate-800">${escapeHTML(g.descripcion)}</td>
      <td class="py-3.5 px-4 text-slate-600">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          ${escapeHTML(g.categoria)}
        </span>
      </td>
      <td class="py-3.5 px-4 text-center">
        <span class="px-2 py-0.5 rounded-full text-xs font-bold ${esFijo ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}">
          ${esFijo ? 'Gasto Fijo' : 'Variable'}
        </span>
      </td>
      <td class="py-3.5 px-4 text-slate-600">${escapeHTML(g.metodo_pago || 'Transferencia')}</td>
      <td class="py-3.5 px-4 text-right font-extrabold text-slate-900">$${monto.toFixed(2)}</td>
      <td class="py-3.5 px-4 text-center">
        <span class="px-2 py-0.5 rounded-full text-xs font-bold ${esPagado ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}">
          ${esPagado ? 'Pagado' : 'Pendiente'}
        </span>
      </td>
      <td class="py-3.5 px-4 text-right">
        <button class="btn-delete-expense p-1.5 rounded-lg hover:text-red-600 hover:bg-red-50 transition" title="Eliminar gasto" data-id="${g.id}" data-desc="${escapeHTML(g.descripcion)}">
          <i data-lucide="trash-2" class="w-4 h-4 text-slate-400 hover:text-red-600"></i>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  actualizarTotalesKPIsGastos(gastos);

  // Vincular eventos de eliminación
  tbody.querySelectorAll('.btn-delete-expense').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gId = btn.getAttribute('data-id');
      const gDesc = btn.getAttribute('data-desc');
      if (confirm(`¿Estás seguro de eliminar el gasto "${gDesc}" de Supabase?`)) {
        try {
          btn.disabled = true;
          await apiEliminarGasto(gId);
          if (window.showToast) {
            window.showToast(`Gasto "${gDesc}" eliminado de Supabase.`, 'info');
          }
          await sincronizarGastosUI();
        } catch (err) {
          alert('Error al eliminar gasto: ' + err.message);
          btn.disabled = false;
        }
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Actualizar los KPIs de la pantalla de Gastos
 */
function actualizarTotalesKPIsGastos(gastos) {
  const expenseTotalKpi = document.getElementById('expenseTotalKpi');
  const expenseFixedKpi = document.getElementById('expenseFixedKpi');
  const expenseFixedSub = document.getElementById('expenseFixedSub');
  const expenseVariableKpi = document.getElementById('expenseVariableKpi');
  const expenseVariableSub = document.getElementById('expenseVariableSub');
  const expenseBudgetKpi = document.getElementById('expenseBudgetKpi');

  let totalGastos = 0;
  let totalFijos = 0;
  let totalVariables = 0;

  gastos.forEach(g => {
    const m = parseFloat(g.monto) || 0;
    totalGastos += m;
    if ((g.tipo || '').toLowerCase() === 'fijo') {
      totalFijos += m;
    } else {
      totalVariables += m;
    }
  });

  const pFijo = totalGastos > 0 ? Math.round((totalFijos / totalGastos) * 100) : 0;
  const pVar = totalGastos > 0 ? Math.round((totalVariables / totalGastos) * 100) : 0;
  const presupuestoMeta = 1800.00;
  const restante = Math.max(0, presupuestoMeta - totalGastos);

  if (expenseTotalKpi) expenseTotalKpi.textContent = `$${totalGastos.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (expenseFixedKpi) expenseFixedKpi.textContent = `$${totalFijos.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (expenseFixedSub) expenseFixedSub.textContent = `Representa el ${pFijo}% del total`;
  if (expenseVariableKpi) expenseVariableKpi.textContent = `$${totalVariables.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (expenseVariableSub) expenseVariableSub.textContent = `Representa el ${pVar}% del total`;
  if (expenseBudgetKpi) expenseBudgetKpi.textContent = `$${restante.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Vincular el formulario modal de Registrar Gasto con Supabase
 */
function vincularFormularioGasto() {
  const expenseForm = document.getElementById('expenseForm');
  if (!expenseForm) return;

  expenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.supabaseClient) {
      alert('Supabase no está conectado.');
      return;
    }

    const submitBtn = expenseForm.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.innerHTML : 'Guardar Gasto';

    try {
      const descripcion = document.getElementById('expenseConcept')?.value.trim();
      const categoria = document.getElementById('expenseCategory')?.value || 'Otro';
      const tipo = document.getElementById('expenseType')?.value || 'fijo';
      const monto = parseFloat(document.getElementById('expenseAmount')?.value || 0);
      const metodoPago = document.getElementById('expensePayment')?.value || 'Transferencia';
      const estado = document.getElementById('expenseStatus')?.value || 'pagado';

      if (!descripcion || monto <= 0) {
        alert('Por favor ingresa un concepto y un monto válido.');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Guardando en Supabase...</span>
          </div>
        `;
      }

      const codigo = 'GST-' + Date.now().toString().slice(-4);

      await apiCrearGasto({
        codigo,
        descripcion,
        categoria,
        tipo,
        monto,
        metodo_pago: metodoPago,
        estado
      });

      if (window.showToast) {
        window.showToast(`¡Gasto "${descripcion}" ($${monto.toFixed(2)}) guardado en Supabase!`, 'success');
      }

      expenseForm.reset();

      // Cerrar modal
      const expenseModal = document.getElementById('expenseModal');
      if (expenseModal) {
        const box = expenseModal.querySelector('.modal-content-box');
        if (box) {
          box.classList.remove('scale-100', 'opacity-100');
          box.classList.add('scale-95', 'opacity-0');
        }
        setTimeout(() => expenseModal.classList.add('hidden'), 200);
      }

      // Sincronizar UI según pantalla activa
      if (document.getElementById('expensesTable')) {
        await sincronizarGastosUI();
      }
      if (document.getElementById('finGrossRevenueKpi')) {
        await sincronizarResumenFinancieroUI();
      }

    } catch (err) {
      console.error('Error al guardar gasto en Supabase:', err);
      alert('Error al guardar gasto: ' + (err.message || err));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  });
}

// ============================================================================
// INTEGRACIÓN CON RESUMEN FINANCIERO (resumen-financiero.html)
// ============================================================================

/**
 * Calcular el P&L completo, alimentar los 5 KPIs y actualizar gráficos de Chart.js
 */
async function sincronizarResumenFinancieroUI() {
  const finGrossRevenueKpi = document.getElementById('finGrossRevenueKpi');
  if (!finGrossRevenueKpi) return;

  // Cargar simultáneamente Ventas, Gastos y Productos desde Supabase
  const [ventas, gastos, productos] = await Promise.all([
    apiObtenerVentas(200),
    apiObtenerGastos(),
    apiObtenerProductos()
  ]);

  if (!ventas || !gastos) {
    actualizarBadgeEstado(false);
    return;
  }

  actualizarBadgeEstado(true);

  // 1. Facturación Bruta (Ingresos de órdenes completadas)
  let ingresosTotales = 0;
  let cogsCalculado = 0;

  // Mapa de costos por producto ID para COGS exacto
  const mapaCostos = {};
  if (productos) {
    productos.forEach(p => {
      mapaCostos[p.id] = parseFloat(p.precio_costo) || 0;
    });
  }

  ventas.forEach(v => {
    if ((v.estado || '').toLowerCase() === 'completada') {
      const tot = parseFloat(v.total) || 0;
      ingresosTotales += tot;

      // Calcular COGS desde los detalles de venta
      if (v.detalle_ventas && v.detalle_ventas.length > 0) {
        v.detalle_ventas.forEach(d => {
          const costoUnit = mapaCostos[d.producto_id] || (parseFloat(d.precio_unitario) * 0.45);
          cogsCalculado += (costoUnit * (parseInt(d.cantidad, 10) || 1));
        });
      } else {
        // Estimación estándar del 45% si es venta general sin detalle
        cogsCalculado += (tot * 0.45);
      }
    }
  });

  // 2. Gastos Operativos (OPEX)
  let gastosOperativos = 0;
  const desgloseCategorias = {
    'Costo Mercancía': cogsCalculado,
    'Instalaciones': 0,
    'Personal': 0,
    'Servicios': 0,
    'Otros': 0
  };

  gastos.forEach(g => {
    const m = parseFloat(g.monto) || 0;
    gastosOperativos += m;

    const cat = (g.categoria || '').toLowerCase();
    if (cat.includes('instal') || cat.includes('alquiler')) {
      desgloseCategorias['Instalaciones'] += m;
    } else if (cat.includes('personal') || cat.includes('nómina') || cat.includes('sueldo')) {
      desgloseCategorias['Personal'] += m;
    } else if (cat.includes('servicio') || cat.includes('luz') || cat.includes('internet')) {
      desgloseCategorias['Servicios'] += m;
    } else {
      desgloseCategorias['Otros'] += m;
    }
  });

  // 3. Márgenes y Utilidades
  const utilidadBruta = Math.max(0, ingresosTotales - cogsCalculado);
  const margenBruto = ingresosTotales > 0 ? (utilidadBruta / ingresosTotales) * 100 : 0;
  const cogsPercent = ingresosTotales > 0 ? (cogsCalculado / ingresosTotales) * 100 : 0;

  const utilidadNeta = utilidadBruta - gastosOperativos;
  const margenNeto = ingresosTotales > 0 ? (utilidadNeta / ingresosTotales) * 100 : 0;

  // Actualizar los 5 KPIs Superiores
  const finCogsKpi = document.getElementById('finCogsKpi');
  const finCogsPercent = document.getElementById('finCogsPercent');
  const finGrossProfitKpi = document.getElementById('finGrossProfitKpi');
  const finGrossMargin = document.getElementById('finGrossMargin');
  const finOperatingExpensesKpi = document.getElementById('finOperatingExpensesKpi');
  const finNetProfitKpi = document.getElementById('finNetProfitKpi');
  const finNetMargin = document.getElementById('finNetMargin');
  const finTotalExpensesAccumulated = document.getElementById('finTotalExpensesAccumulated');

  if (finGrossRevenueKpi) finGrossRevenueKpi.textContent = `$${ingresosTotales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (finCogsKpi) finCogsKpi.textContent = `$${cogsCalculado.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (finCogsPercent) finCogsPercent.textContent = `${cogsPercent.toFixed(1)}% de ingresos`;
  if (finGrossProfitKpi) finGrossProfitKpi.textContent = `$${utilidadBruta.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (finGrossMargin) finGrossMargin.textContent = `Margen Bruto: ${margenBruto.toFixed(1)}%`;
  if (finOperatingExpensesKpi) finOperatingExpensesKpi.textContent = `$${gastosOperativos.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (finNetProfitKpi) {
    finNetProfitKpi.textContent = `${utilidadNeta >= 0 ? '$' : '-$'}${Math.abs(utilidadNeta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    finNetProfitKpi.className = `text-xl lg:text-2xl font-extrabold tracking-tight ${utilidadNeta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
  }
  if (finNetMargin) finNetMargin.textContent = `Margen Neto: ${margenNeto.toFixed(1)}%`;
  if (finTotalExpensesAccumulated) finTotalExpensesAccumulated.textContent = `$${(cogsCalculado + gastosOperativos).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Actualizar filas del Estado de Resultados (P&L)
  const plGrossRevenue = document.getElementById('plGrossRevenue');
  const plCogs = document.getElementById('plCogs');
  const plCogsPercent = document.getElementById('plCogsPercent');
  const plGrossProfit = document.getElementById('plGrossProfit');
  const plGrossMarginPercent = document.getElementById('plGrossMarginPercent');
  const plOpex = document.getElementById('plOpex');
  const plOpexPercent = document.getElementById('plOpexPercent');
  const plNetProfit = document.getElementById('plNetProfit');
  const plNetMarginPercent = document.getElementById('plNetMarginPercent');

  if (plGrossRevenue) plGrossRevenue.textContent = `$${ingresosTotales.toFixed(2)}`;
  if (plCogs) plCogs.textContent = `$${cogsCalculado.toFixed(2)}`;
  if (plCogsPercent) plCogsPercent.textContent = `${cogsPercent.toFixed(1)}%`;
  if (plGrossProfit) plGrossProfit.textContent = `$${utilidadBruta.toFixed(2)}`;
  if (plGrossMarginPercent) plGrossMarginPercent.textContent = `${margenBruto.toFixed(1)}%`;
  if (plOpex) plOpex.textContent = `$${gastosOperativos.toFixed(2)}`;
  if (plOpexPercent) plOpexPercent.textContent = `${(ingresosTotales > 0 ? (gastosOperativos / ingresosTotales) * 100 : 0).toFixed(1)}%`;
  if (plNetProfit) plNetProfit.textContent = `$${utilidadNeta.toFixed(2)}`;
  if (plNetMarginPercent) plNetMarginPercent.textContent = `${margenNeto.toFixed(1)}%`;

  // Actualizar Gráfico de Evolución Mensual (Chart.js)
  if (window.plChartInstance) {
    const lastIdx = window.plChartInstance.data.labels.length - 1;
    // Barra de Facturación del mes actual
    window.plChartInstance.data.datasets[0].data[lastIdx] = Math.round(ingresosTotales);
    // Barra de Costos & Gastos del mes actual
    window.plChartInstance.data.datasets[1].data[lastIdx] = Math.round(cogsCalculado + gastosOperativos);
    // Línea de Utilidad Neta del mes actual
    window.plChartInstance.data.datasets[2].data[lastIdx] = Math.round(utilidadNeta);
    window.plChartInstance.update();
  }

  // Actualizar Gráfico de Distribución de Gastos (Doughnut)
  if (window.expenseChartInstance) {
    const valoresDona = [
      Math.round(desgloseCategorias['Costo Mercancía']),
      Math.round(desgloseCategorias['Personal']),
      Math.round(desgloseCategorias['Instalaciones']),
      Math.round(desgloseCategorias['Servicios']),
      Math.round(desgloseCategorias['Otros'])
    ];
    window.expenseChartInstance.data.datasets[0].data = valoresDona;
    window.expenseChartInstance.update();
  }
}

// ============================================================================
// MÉTODOS CRUD: CUENTAS POR COBRAR Y POR PAGAR
// ============================================================================

/**
 * Obtener todas las cuentas desde Supabase
 */
async function apiObtenerCuentas() {
  if (!window.supabaseClient) return [];
  try {
    const { data, error } = await window.supabaseClient
      .from('cuentas')
      .select('*')
      .order('fecha_vencimiento', { ascending: true });

    if (error) {
      console.error('Error al cargar cuentas de Supabase:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Fallo en apiObtenerCuentas:', err);
    return [];
  }
}

/**
 * Sembrar cuentas de prueba si la tabla cuentas está vacía
 */
async function apiSembrarCuentasInicialesSiVacio() {
  if (!window.supabaseClient) return;

  const { data: existentes } = await window.supabaseClient
    .from('cuentas')
    .select('id')
    .limit(1);

  if (existentes && existentes.length > 0) return;

  console.log('🌱 Inicializando cuentas por cobrar/pagar en Supabase...');

  const hoy = new Date();
  const fechaVenceAyer = new Date(hoy);
  fechaVenceAyer.setDate(hoy.getDate() - 3);
  const fechaVencePronto = new Date(hoy);
  fechaVencePronto.setDate(hoy.getDate() + 5);

  const cuentasMuestra = [
    { tipo: 'pagar', tercero: 'Franelas Ccs', concepto: 'Franela X', monto_total: 50.00, monto_pagado: 0.00, fecha_vencimiento: fechaVenceAyer.toISOString().split('T')[0], estado: 'vencido' },
    { tipo: 'pagar', tercero: 'Telas Ccs', concepto: 'Tela X', monto_total: 110.00, monto_pagado: 0.00, fecha_vencimiento: fechaVenceAyer.toISOString().split('T')[0], estado: 'vencido' },
    { tipo: 'pagar', tercero: 'Amortiguadores Ccs', concepto: 'Amortiguador X', monto_total: 345.00, monto_pagado: 0.00, fecha_vencimiento: fechaVencePronto.toISOString().split('T')[0], estado: 'pendiente' },
    { tipo: 'cobrar', tercero: 'Alejandro Fariña', concepto: 'Factura #00.004', monto_total: 5.00, monto_pagado: 0.00, fecha_vencimiento: fechaVenceAyer.toISOString().split('T')[0], estado: 'vencido' },
    { tipo: 'cobrar', tercero: 'Gabriel Rodríguez', concepto: 'Factura #00.006', monto_total: 10.00, monto_pagado: 0.00, fecha_vencimiento: fechaVenceAyer.toISOString().split('T')[0], estado: 'vencido' },
    { tipo: 'cobrar', tercero: 'Gabriel Rodríguez', concepto: 'Factura #00.008', monto_total: 40.00, monto_pagado: 0.00, fecha_vencimiento: fechaVencePronto.toISOString().split('T')[0], estado: 'pendiente' }
  ];

  for (const c of cuentasMuestra) {
    try {
      await window.supabaseClient.from('cuentas').insert([c]);
    } catch (e) {
      console.warn('No se pudo insertar cuenta muestra:', e);
    }
  }
}

/**
 * Crear una nueva cuenta por cobrar o por pagar
 */
async function apiCrearCuenta(cuentaData) {
  if (!window.supabaseClient) {
    mostrarNotificacion('Error: Base de datos no conectada', 'error');
    return null;
  }
  try {
    const { data, error } = await window.supabaseClient
      .from('cuentas')
      .insert([cuentaData])
      .select();

    if (error) {
      console.error('Error al insertar cuenta en Supabase:', error.message);
      mostrarNotificacion('Error al registrar cuenta: ' + error.message, 'error');
      return null;
    }

    const tipoLabel = cuentaData.tipo === 'cobrar' ? 'Cuenta por cobrar' : 'Cuenta por pagar';
    mostrarNotificacion(`¡${tipoLabel} registrada exitosamente!`, 'success');
    return data && data[0] ? data[0] : null;
  } catch (err) {
    console.error('Fallo en apiCrearCuenta:', err);
    mostrarNotificacion('Fallo inesperado al registrar cuenta.', 'error');
    return null;
  }
}

/**
 * Liquidar / Marcar como pagada una cuenta
 */
async function apiLiquidarCuenta(cuentaId, montoTotal) {
  if (!window.supabaseClient) return false;
  try {
    const { error } = await window.supabaseClient
      .from('cuentas')
      .update({
        monto_pagado: montoTotal,
        estado: 'pagado'
      })
      .eq('id', cuentaId);

    if (error) {
      console.error('Error al liquidar cuenta:', error.message);
      mostrarNotificacion('Error al registrar pago: ' + error.message, 'error');
      return false;
    }

    mostrarNotificacion('¡Cuenta marcada como pagada / liquidada con éxito!', 'success');
    return true;
  } catch (err) {
    console.error('Fallo en apiLiquidarCuenta:', err);
    return false;
  }
}

/**
 * Eliminar una cuenta de Supabase
 */
async function apiEliminarCuenta(cuentaId) {
  if (!window.supabaseClient) return false;
  try {
    const { error } = await window.supabaseClient
      .from('cuentas')
      .delete()
      .eq('id', cuentaId);

    if (error) {
      console.error('Error al eliminar cuenta:', error.message);
      mostrarNotificacion('Error al eliminar cuenta: ' + error.message, 'error');
      return false;
    }

    mostrarNotificacion('Cuenta eliminada de la base de datos', 'info');
    return true;
  } catch (err) {
    console.error('Fallo en apiEliminarCuenta:', err);
    return false;
  }
}

// ============================================================================
// INTEGRACIÓN CON LA PÁGINA DE GESTIÓN DE CUENTAS (cuentas.html)
// ============================================================================

/**
 * Helper para calcular diferencia de días con respecto a la fecha actual
 */
function calcularDiasVencimiento(fechaStr) {
  if (!fechaStr) return { dias: 0, texto: 'Fecha no definida', expirado: false };
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaStr + 'T00:00:00');
  const diffTiempo = fecha.getTime() - hoy.getTime();
  const diffDias = Math.round(diffTiempo / (1000 * 3600 * 24));

  if (diffDias < 0) {
    const d = Math.abs(diffDias);
    return { dias: diffDias, texto: `Venció hace ${d} día${d > 1 ? 's' : ''}`, expirado: true };
  } else if (diffDias === 0) {
    return { dias: 0, texto: 'Vence hoy', expirado: false };
  } else {
    return { dias: diffDias, texto: `Vence en ${diffDias} día${diffDias > 1 ? 's' : ''}`, expirado: false };
  }
}

/**
 * Sincronizar en tiempo real la pantalla de Gestión de Cuentas (cuentas.html)
 */
async function sincronizarCuentasUI() {
  const containerCobrar = document.getElementById('cuentasCobrarContainer');
  const containerPagar = document.getElementById('cuentasPagarContainer');
  const accountsReceivableKpi = document.getElementById('accountsReceivableKpi');

  if (!containerCobrar && !accountsReceivableKpi) return;

  // Sembrar datos iniciales si la tabla estuviera vacía
  await apiSembrarCuentasInicialesSiVacio();

  // Obtener todas las cuentas de Supabase
  const cuentas = await apiObtenerCuentas();

  if (!cuentas) {
    actualizarBadgeEstado(false);
    return;
  }
  actualizarBadgeEstado(true);

  // Clasificar por tipo
  const cuentasCobrar = cuentas.filter(c => c.tipo === 'cobrar');
  const cuentasPagar = cuentas.filter(c => c.tipo === 'pagar');

  // 1. Calcular Métricas de Resumen (KPIs)
  let totalPorCobrar = 0;
  let pendientesCobrarCount = 0;
  let cobradoAcumulado = 0;
  let liquidadosCobrarCount = 0;

  cuentasCobrar.forEach(c => {
    const montoTot = parseFloat(c.monto_total || 0);
    const montoPag = parseFloat(c.monto_pagado || 0);
    const saldoPendiente = Math.max(0, montoTot - montoPag);

    cobradoAcumulado += montoPag;

    if (c.estado === 'pagado' || saldoPendiente <= 0) {
      liquidadosCobrarCount++;
    } else {
      totalPorCobrar += saldoPendiente;
      pendientesCobrarCount++;
    }
  });

  let totalPorPagar = 0;
  let pendientesPagarCount = 0;

  cuentasPagar.forEach(c => {
    const montoTot = parseFloat(c.monto_total || 0);
    const montoPag = parseFloat(c.monto_pagado || 0);
    const saldoPendiente = Math.max(0, montoTot - montoPag);

    if (c.estado !== 'pagado' && saldoPendiente > 0) {
      totalPorPagar += saldoPendiente;
      pendientesPagarCount++;
    }
  });

  const diferencial = totalPorCobrar - totalPorPagar;

  // Actualizar KPI 1: Total por Cobrar
  if (accountsReceivableKpi) {
    accountsReceivableKpi.textContent = `$${totalPorCobrar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const accountsReceivableCountKpi = document.getElementById('accountsReceivableCountKpi');
  if (accountsReceivableCountKpi) {
    accountsReceivableCountKpi.textContent = `${pendientesCobrarCount} factura${pendientesCobrarCount !== 1 ? 's' : ''} pendiente${pendientesCobrarCount !== 1 ? 's' : ''}`;
  }

  // Actualizar KPI 2: Total por Pagar
  const accountsPayableKpi = document.getElementById('accountsPayableKpi');
  if (accountsPayableKpi) {
    accountsPayableKpi.textContent = `$${totalPorPagar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const accountsPayableCountKpi = document.getElementById('accountsPayableCountKpi');
  if (accountsPayableCountKpi) {
    accountsPayableCountKpi.innerHTML = `
      <i data-lucide="${pendientesPagarCount > 0 ? 'alert-circle' : 'check-circle'}" class="w-3.5 h-3.5"></i>
      <span>${pendientesPagarCount} compromiso${pendientesPagarCount !== 1 ? 's' : ''} por pagar</span>
    `;
  }

  // Actualizar KPI 3: Cobrado Acumulado
  const accountsCollectedMonthKpi = document.getElementById('accountsCollectedMonthKpi');
  if (accountsCollectedMonthKpi) {
    accountsCollectedMonthKpi.textContent = `$${cobradoAcumulado.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const accountsCollectedCountKpi = document.getElementById('accountsCollectedCountKpi');
  if (accountsCollectedCountKpi) {
    accountsCollectedCountKpi.textContent = `${liquidadosCobrarCount} cobro${liquidadosCobrarCount !== 1 ? 's' : ''} liquidado${liquidadosCobrarCount !== 1 ? 's' : ''}`;
  }

  // Actualizar KPI 4: Diferencial (Cobrar - Pagar)
  const accountsNetDifferenceKpi = document.getElementById('accountsNetDifferenceKpi');
  const accountsNetDifferenceSubtitle = document.getElementById('accountsNetDifferenceSubtitle');
  if (accountsNetDifferenceKpi) {
    const signo = diferencial >= 0 ? '+' : '-';
    accountsNetDifferenceKpi.textContent = `${signo}$${Math.abs(diferencial).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    accountsNetDifferenceKpi.className = `text-2xl lg:text-3xl font-extrabold tracking-tight ${diferencial >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
  }
  if (accountsNetDifferenceSubtitle) {
    accountsNetDifferenceSubtitle.textContent = diferencial >= 0 ? 'Superávit a favor' : 'Déficit / Compromisos netos';
  }

  // Actualizar Badges de cantidad
  const receivableCountBadge = document.getElementById('receivableCountBadge');
  if (receivableCountBadge) {
    receivableCountBadge.textContent = `${cuentasCobrar.length} Factura${cuentasCobrar.length !== 1 ? 's' : ''}`;
  }
  const payableCountBadge = document.getElementById('payableCountBadge');
  if (payableCountBadge) {
    payableCountBadge.textContent = `${cuentasPagar.length} Proveedor${cuentasPagar.length !== 1 ? 'es' : ''}`;
  }

  // 2. Renderizar Lista: Cuentas por Cobrar (Clientes)
  if (containerCobrar) {
    containerCobrar.innerHTML = '';
    if (cuentasCobrar.length === 0) {
      containerCobrar.innerHTML = `
        <div class="py-12 text-center text-slate-400 text-xs">
          <i data-lucide="check-circle" class="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80"></i>
          <p class="font-semibold text-slate-600">No hay cuentas por cobrar registradas</p>
          <p class="text-[11px] text-slate-400 mt-0.5">Todas tus facturas a clientes están al día.</p>
        </div>
      `;
    } else {
      cuentasCobrar.forEach(item => {
        const diasInfo = calcularDiasVencimiento(item.fecha_vencimiento);
        const esPagado = item.estado === 'pagado';
        const esExpirado = !esPagado && (item.estado === 'vencido' || diasInfo.expirado);

        let badgeHtml = '';
        if (esPagado) {
          badgeHtml = `<span class="text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md inline-flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Pagado</span>`;
        } else if (esExpirado) {
          badgeHtml = `<span class="text-[11px] font-semibold text-rose-500 bg-rose-50 border border-rose-200/50 px-2 py-0.5 rounded-md inline-flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Expirado</span>`;
        } else {
          badgeHtml = `<span class="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200/50 px-2 py-0.5 rounded-md inline-flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> Pendiente</span>`;
        }

        const montoTotal = parseFloat(item.monto_total || 0).toFixed(2);
        const row = document.createElement('div');
        row.className = 'py-3.5 flex items-center justify-between hover:bg-slate-50/70 transition px-1 rounded-xl';
        row.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full ${esPagado ? 'bg-emerald-100 text-emerald-600' : esExpirado ? 'bg-rose-100 text-rose-600' : 'bg-purple-100 text-[#7036ee]'} flex items-center justify-center font-bold text-xs shrink-0">
              ${escapeHTML(item.tercero ? item.tercero.charAt(0).toUpperCase() : 'C')}
            </div>
            <div>
              <p class="font-bold text-slate-800 text-xs sm:text-sm">${escapeHTML(item.tercero)}</p>
              <p class="text-[11px] sm:text-xs text-slate-500">${escapeHTML(item.concepto)} • <span class="${esExpirado ? 'text-rose-500 font-semibold' : ''}">${diasInfo.texto}</span></p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <span class="text-xs sm:text-sm font-extrabold text-slate-900 block">$${montoTotal}</span>
              ${badgeHtml}
            </div>
            <div class="flex items-center gap-1">
              ${!esPagado ? `
                <button class="btn-liquidar-cuenta p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 border border-emerald-200 transition cursor-pointer" title="Marcar como cobrado" data-id="${item.id}" data-monto="${item.monto_total}">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                </button>
                <button class="btn-whatsapp-cuenta p-1.5 rounded-lg text-[#25D366] hover:bg-emerald-50 border border-emerald-200 transition cursor-pointer" title="Recordatorio WhatsApp" data-cliente="${escapeHTML(item.tercero)}" data-concepto="${escapeHTML(item.concepto)}" data-monto="${montoTotal}" data-fecha="${item.fecha_vencimiento}">
                  <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
              <button class="btn-eliminar-cuenta p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer" title="Eliminar cuenta" data-id="${item.id}">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        `;
        containerCobrar.appendChild(row);
      });
    }
  }

  // 3. Renderizar Lista: Cuentas por Pagar (Proveedores)
  if (containerPagar) {
    containerPagar.innerHTML = '';
    if (cuentasPagar.length === 0) {
      containerPagar.innerHTML = `
        <div class="py-12 text-center text-slate-400 text-xs">
          <i data-lucide="check-circle" class="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80"></i>
          <p class="font-semibold text-slate-600">No hay cuentas por pagar pendientes</p>
          <p class="text-[11px] text-slate-400 mt-0.5">Estás al día con todos tus proveedores.</p>
        </div>
      `;
    } else {
      cuentasPagar.forEach(item => {
        const diasInfo = calcularDiasVencimiento(item.fecha_vencimiento);
        const esPagado = item.estado === 'pagado';
        const esExpirado = !esPagado && (item.estado === 'vencido' || diasInfo.expirado);

        let badgeHtml = '';
        if (esPagado) {
          badgeHtml = `<span class="text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-md inline-flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Pagado</span>`;
        } else if (esExpirado) {
          badgeHtml = `<span class="text-[11px] font-semibold text-rose-500 bg-rose-50 border border-rose-200/50 px-2 py-0.5 rounded-md inline-flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Expirado</span>`;
        } else {
          badgeHtml = `<span class="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200/50 px-2 py-0.5 rounded-md inline-flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> Pendiente</span>`;
        }

        const montoTotal = parseFloat(item.monto_total || 0).toFixed(2);
        const row = document.createElement('div');
        row.className = 'py-3.5 flex items-center justify-between hover:bg-slate-50/70 transition px-1 rounded-xl';
        row.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full ${esPagado ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'} flex items-center justify-center font-bold text-xs shrink-0">
              ${escapeHTML(item.tercero ? item.tercero.charAt(0).toUpperCase() : 'P')}
            </div>
            <div>
              <p class="font-bold text-slate-800 text-xs sm:text-sm">${escapeHTML(item.tercero)}</p>
              <p class="text-[11px] sm:text-xs text-slate-500">${escapeHTML(item.concepto)} • <span class="${esExpirado ? 'text-rose-500 font-semibold' : ''}">${diasInfo.texto}</span></p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <span class="text-xs sm:text-sm font-extrabold text-slate-900 block">$${montoTotal}</span>
              ${badgeHtml}
            </div>
            <div class="flex items-center gap-1">
              ${!esPagado ? `
                <button class="btn-liquidar-cuenta p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 border border-emerald-200 transition cursor-pointer" title="Marcar como pagado al proveedor" data-id="${item.id}" data-monto="${item.monto_total}">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
              <button class="btn-eliminar-cuenta p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer" title="Eliminar cuenta" data-id="${item.id}">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        `;
        containerPagar.appendChild(row);
      });
    }
  }

  // 4. Vincular Eventos de Botones Dinámicos (Liquidar, WhatsApp, Eliminar)
  document.querySelectorAll('.btn-liquidar-cuenta').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const monto = parseFloat(btn.getAttribute('data-monto') || 0);
      if (confirm(`¿Deseas marcar esta cuenta ($${monto.toFixed(2)}) como completamente pagada / liquidada?`)) {
        btn.disabled = true;
        const exito = await apiLiquidarCuenta(id, monto);
        if (exito) {
          sincronizarCuentasUI();
        } else {
          btn.disabled = false;
        }
      }
    });
  });

  document.querySelectorAll('.btn-eliminar-cuenta').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (confirm('¿Estás seguro de que deseas eliminar este registro de cuenta?')) {
        btn.disabled = true;
        const exito = await apiEliminarCuenta(id);
        if (exito) {
          sincronizarCuentasUI();
        } else {
          btn.disabled = false;
        }
      }
    });
  });

  document.querySelectorAll('.btn-whatsapp-cuenta').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cliente = btn.getAttribute('data-cliente');
      const concepto = btn.getAttribute('data-concepto');
      const monto = btn.getAttribute('data-monto');
      const fecha = btn.getAttribute('data-fecha');

      const textoMensaje = `Hola *${cliente}*, te saludamos cordialmente del equipo de *BG*. Te escribimos para recordarte tu saldo pendiente de *$${monto}* correspondiente a *${concepto}* con fecha límite *${fecha}*. Puedes indicarnos cuando realices el pago para actualizar tu estado de cuenta. ¡Muchas gracias!`;
      const urlWhatsapp = `https://api.whatsapp.com/send?text=${encodeURIComponent(textoMensaje)}`;
      window.open(urlWhatsapp, '_blank');
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Vincular modales y formularios de registro en la pantalla de Cuentas
 */
function vincularFormulariosCuentas() {
  // Modal 1: Cuenta por Cobrar
  const modalCobrar = document.getElementById('modalCuentaCobrar');
  const openCobrarBtn = document.getElementById('openReceivePaymentBtn');
  const closeCobrarBtn = document.getElementById('closeModalCobrarBtn');
  const cancelCobrarBtn = document.getElementById('cancelModalCobrarBtn');
  const formCobrar = document.getElementById('formCuentaCobrar');

  function openCobrar() {
    if (!modalCobrar) return;
    // Poner fecha de vencimiento por defecto: 7 días en el futuro
    const fechaInput = document.getElementById('cobrarFechaVencimiento');
    if (fechaInput && !fechaInput.value) {
      const pronto = new Date();
      pronto.setDate(pronto.getDate() + 7);
      fechaInput.value = pronto.toISOString().split('T')[0];
    }

    modalCobrar.classList.remove('hidden');
    setTimeout(() => {
      const box = modalCobrar.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closeCobrar() {
    if (!modalCobrar) return;
    const box = modalCobrar.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
      modalCobrar.classList.add('hidden');
    }, 200);
  }

  if (openCobrarBtn) openCobrarBtn.addEventListener('click', openCobrar);
  if (closeCobrarBtn) closeCobrarBtn.addEventListener('click', closeCobrar);
  if (cancelCobrarBtn) cancelCobrarBtn.addEventListener('click', closeCobrar);
  if (modalCobrar) {
    modalCobrar.addEventListener('click', (e) => {
      if (e.target === modalCobrar) closeCobrar();
    });
  }

  if (formCobrar) {
    formCobrar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btnSubmitCobrar');
      if (submitBtn) submitBtn.disabled = true;

      const tercero = document.getElementById('cobrarTercero')?.value.trim();
      const concepto = document.getElementById('cobrarConcepto')?.value.trim();
      const montoTotal = parseFloat(document.getElementById('cobrarMontoTotal')?.value || 0);
      const fechaVence = document.getElementById('cobrarFechaVencimiento')?.value;
      const estado = document.getElementById('cobrarEstado')?.value || 'pendiente';

      const nuevaCuenta = {
        tipo: 'cobrar',
        tercero,
        concepto,
        monto_total: montoTotal,
        monto_pagado: estado === 'pagado' ? montoTotal : 0.00,
        fecha_vencimiento: fechaVence,
        estado: estado
      };

      const resultado = await apiCrearCuenta(nuevaCuenta);
      if (submitBtn) submitBtn.disabled = false;

      if (resultado) {
        formCobrar.reset();
        closeCobrar();
        sincronizarCuentasUI();
      }
    });
  }

  // Modal 2: Cuenta por Pagar
  const modalPagar = document.getElementById('modalCuentaPagar');
  const openPagarBtn = document.getElementById('openSupplierPaymentBtn');
  const closePagarBtn = document.getElementById('closeModalPagarBtn');
  const cancelPagarBtn = document.getElementById('cancelModalPagarBtn');
  const formPagar = document.getElementById('formCuentaPagar');

  function openPagar() {
    if (!modalPagar) return;
    const fechaInput = document.getElementById('pagarFechaVencimiento');
    if (fechaInput && !fechaInput.value) {
      const pronto = new Date();
      pronto.setDate(pronto.getDate() + 15);
      fechaInput.value = pronto.toISOString().split('T')[0];
    }

    modalPagar.classList.remove('hidden');
    setTimeout(() => {
      const box = modalPagar.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closePagar() {
    if (!modalPagar) return;
    const box = modalPagar.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
      modalPagar.classList.add('hidden');
    }, 200);
  }

  if (openPagarBtn) openPagarBtn.addEventListener('click', openPagar);
  if (closePagarBtn) closePagarBtn.addEventListener('click', closePagar);
  if (cancelPagarBtn) cancelPagarBtn.addEventListener('click', closePagar);
  if (modalPagar) {
    modalPagar.addEventListener('click', (e) => {
      if (e.target === modalPagar) closePagar();
    });
  }

  if (formPagar) {
    formPagar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btnSubmitPagar');
      if (submitBtn) submitBtn.disabled = true;

      const tercero = document.getElementById('pagarTercero')?.value.trim();
      const concepto = document.getElementById('pagarConcepto')?.value.trim();
      const montoTotal = parseFloat(document.getElementById('pagarMontoTotal')?.value || 0);
      const fechaVence = document.getElementById('pagarFechaVencimiento')?.value;
      const estado = document.getElementById('pagarEstado')?.value || 'pendiente';

      const nuevaCuenta = {
        tipo: 'pagar',
        tercero,
        concepto,
        monto_total: montoTotal,
        monto_pagado: estado === 'pagado' ? montoTotal : 0.00,
        fecha_vencimiento: fechaVence,
        estado: estado
      };

      const resultado = await apiCrearCuenta(nuevaCuenta);
      if (submitBtn) submitBtn.disabled = false;

      if (resultado) {
        formPagar.reset();
        closePagar();
        sincronizarCuentasUI();
      }
    });
  }

  // Modal 3: Recordatorios WhatsApp
  const btnWhatsapp = document.getElementById('btnWhatsappReminders');
  const modalWhatsapp = document.getElementById('modalWhatsappReminders');
  const closeWhatsappBtn = document.getElementById('closeWhatsappModalBtn');
  const closeWhatsappActionBtn = document.getElementById('closeWhatsappActionBtn');
  const whatsappClientsList = document.getElementById('whatsappClientsList');

  function closeWhatsapp() {
    if (!modalWhatsapp) return;
    const box = modalWhatsapp.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
      modalWhatsapp.classList.add('hidden');
    }, 200);
  }

  if (btnWhatsapp && modalWhatsapp) {
    btnWhatsapp.addEventListener('click', async () => {
      modalWhatsapp.classList.remove('hidden');
      setTimeout(() => {
        const box = modalWhatsapp.querySelector('.modal-content-box');
        if (box) {
          box.classList.remove('scale-95', 'opacity-0');
          box.classList.add('scale-100', 'opacity-100');
        }
      }, 10);

      // Cargar clientes con facturas pendientes
      if (whatsappClientsList) {
        whatsappClientsList.innerHTML = `
          <div class="py-6 text-center text-xs text-slate-400">
            <div class="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <span>Consultando clientes pendientes...</span>
          </div>
        `;

        const cuentas = await apiObtenerCuentas();
        const pendientes = cuentas.filter(c => c.tipo === 'cobrar' && c.estado !== 'pagado');

        if (pendientes.length === 0) {
          whatsappClientsList.innerHTML = `
            <div class="py-6 text-center text-xs text-slate-500">
              <i data-lucide="check-circle" class="w-8 h-8 text-emerald-500 mx-auto mb-2"></i>
              <p class="font-bold">¡Excelente! No hay clientes con facturas pendientes.</p>
            </div>
          `;
        } else {
          whatsappClientsList.innerHTML = '';
          pendientes.forEach(item => {
            const monto = parseFloat(item.monto_total || 0).toFixed(2);
            const msg = `Hola *${item.tercero}*, te saludamos de *BG*. Te recordamos tu saldo pendiente de *$${monto}* (${item.concepto}) con fecha límite ${item.fecha_vencimiento}. ¡Gracias por tu confianza!`;
            const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;

            const row = document.createElement('div');
            row.className = 'py-3 flex items-center justify-between gap-3 text-xs';
            row.innerHTML = `
              <div>
                <p class="font-bold text-slate-800">${escapeHTML(item.tercero)}</p>
                <p class="text-slate-500 text-[11px]">${escapeHTML(item.concepto)} • <strong class="text-slate-800">$${monto}</strong></p>
              </div>
              <a href="${waUrl}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition shrink-0">
                <i data-lucide="send" class="w-3.5 h-3.5"></i>
                <span>Enviar WhatsApp</span>
              </a>
            `;
            whatsappClientsList.appendChild(row);
          });
        }
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  if (closeWhatsappBtn) closeWhatsappBtn.addEventListener('click', closeWhatsapp);
  if (closeWhatsappActionBtn) closeWhatsappActionBtn.addEventListener('click', closeWhatsapp);
  if (modalWhatsapp) {
    modalWhatsapp.addEventListener('click', (e) => {
      if (e.target === modalWhatsapp) closeWhatsapp();
    });
  }
}

// ============================================================================
// INTEGRACIÓN CON LA PÁGINA HOME / DASHBOARD (index.html)
// ============================================================================

/**
 * Conectar todas las métricas, alertas, más vendidos y cuentas del Dashboard principal
 */
async function sincronizarDashboardHomeUI() {
  const homeMonthlyRevenueKpi = document.getElementById('homeMonthlyRevenueKpi');
  if (!homeMonthlyRevenueKpi) return;

  // Sembrar datos necesarios si están vacíos
  await apiSembrarCuentasInicialesSiVacio();

  // Consultar simultáneamente todos los módulos
  const [ventas, productos, gastos, cuentas] = await Promise.all([
    apiObtenerVentas(150),
    apiObtenerProductos(),
    apiObtenerGastos(),
    apiObtenerCuentas()
  ]);

  if (!ventas || !productos) {
    actualizarBadgeEstado(false);
    return;
  }

  actualizarBadgeEstado(true);

  // 1. Calcular Facturación, COGS, Órdenes y Utilidad Neta
  let facturacionTotal = 0;
  let ordenesCompletadas = 0;
  let cogsTotal = 0;

  const ventasPorProducto = {}; // { prodId/nombre: { cant: N, total: $, nombre: '' } }

  const mapaCostos = {};
  productos.forEach(p => {
    mapaCostos[p.id] = parseFloat(p.precio_costo) || 0;
  });

  ventas.forEach(v => {
    if ((v.estado || '').toLowerCase() === 'completada') {
      const tot = parseFloat(v.total) || 0;
      facturacionTotal += tot;
      ordenesCompletadas++;

      if (v.detalle_ventas && v.detalle_ventas.length > 0) {
        v.detalle_ventas.forEach(d => {
          const c = mapaCostos[d.producto_id] || (parseFloat(d.precio_unitario) * 0.45);
          const cant = parseInt(d.cantidad, 10) || 1;
          cogsTotal += (c * cant);

          const nombreItem = d.productos?.nombre || 'Producto';
          const key = d.producto_id || nombreItem;
          if (!ventasPorProducto[key]) {
            ventasPorProducto[key] = { nombre: nombreItem, cantidad: 0, total: 0 };
          }
          ventasPorProducto[key].cantidad += cant;
          ventasPorProducto[key].total += (parseFloat(d.precio_unitario) * cant);
        });
      } else {
        cogsTotal += (tot * 0.45);
      }
    }
  });

  let totalGastos = 0;
  if (gastos) {
    gastos.forEach(g => {
      totalGastos += parseFloat(g.monto) || 0;
    });
  }

  const utilidadNeta = facturacionTotal - cogsTotal - totalGastos;
  const ticketPromedio = ordenesCompletadas > 0 ? (facturacionTotal / ordenesCompletadas) : 0;

  // Actualizar las 4 tarjetas de KPIs
  const homeAvgTicketKpi = document.getElementById('homeAvgTicketKpi');
  const homeDailyOrdersKpi = document.getElementById('homeDailyOrdersKpi');
  const homeMonthlyNetProfitKpi = document.getElementById('homeMonthlyNetProfitKpi');

  if (homeMonthlyRevenueKpi) homeMonthlyRevenueKpi.textContent = `$${facturacionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (homeAvgTicketKpi) homeAvgTicketKpi.textContent = `$${ticketPromedio.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (homeDailyOrdersKpi) homeDailyOrdersKpi.textContent = ordenesCompletadas;
  if (homeMonthlyNetProfitKpi) {
    homeMonthlyNetProfitKpi.textContent = `${utilidadNeta >= 0 ? '$' : '-$'}${Math.abs(utilidadNeta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // 2. Alertas de inventario bajo en tiempo real
  const homeLowStockContainer = document.getElementById('homeLowStockContainer');
  if (homeLowStockContainer) {
    const productosBajoStock = productos.filter(p => p.stock_actual <= (p.stock_minimo || 5));

    if (productosBajoStock.length === 0) {
      homeLowStockContainer.innerHTML = `
        <div class="rounded-xl px-4 py-3 flex items-center justify-between bg-emerald-50 text-emerald-700 text-xs font-semibold">
          <span>✅ Todo el inventario está en niveles óptimos.</span>
          <span class="text-xs bg-white px-2 py-0.5 rounded shadow-2xs font-bold text-emerald-600">Correcto</span>
        </div>
      `;
    } else {
      homeLowStockContainer.innerHTML = '';
      productosBajoStock.slice(0, 3).forEach(p => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'low-stock-pill rounded-xl px-4 py-2.5 flex items-center justify-between mb-1.5';
        itemDiv.innerHTML = `
          <span class="text-xs md:text-sm font-semibold text-slate-700">${escapeHTML(p.nombre)}</span>
          <span class="text-xs font-bold text-amber-800 bg-white/90 px-2.5 py-1 rounded-lg border border-orange-200/80 shadow-2xs">
            ${p.stock_actual} ${escapeHTML(p.unidad_medida || 'Und.')}
          </span>
        `;
        homeLowStockContainer.appendChild(itemDiv);
      });
    }
  }

  // 3. Productos más vendidos calculados dinámicamente
  const homeBestSellersContainer = document.getElementById('homeBestSellersContainer');
  if (homeBestSellersContainer) {
    const ranking = Object.values(ventasPorProducto).sort((a, b) => b.total - a.total).slice(0, 2);

    if (ranking.length === 0) {
      homeBestSellersContainer.innerHTML = `
        <div class="col-span-2 text-center text-xs text-slate-400 py-3">
          Aún no se han completado ventas con productos del catálogo.
        </div>
      `;
    } else {
      homeBestSellersContainer.innerHTML = '';
      ranking.forEach((r, idx) => {
        const box = document.createElement('div');
        box.className = 'flex items-center gap-2';
        box.innerHTML = `
          <span class="text-sm font-bold text-[#7036ee]">${idx + 1}.</span>
          <div class="best-seller-box flex-1 p-3 flex flex-col items-center justify-center text-center bg-purple-50/30 rounded-xl">
            <span class="text-xs font-bold text-slate-800 truncate w-full" title="${escapeHTML(r.nombre)}">${escapeHTML(r.nombre)}</span>
            <span class="text-sm font-extrabold text-[#7036ee] my-0.5">$${r.total.toFixed(2)}</span>
            <span class="text-[11px] text-slate-400 font-medium">${r.cantidad} Und.</span>
          </div>
        `;
        homeBestSellersContainer.appendChild(box);
      });
    }
  }

  // 4. Cuentas por pagar y por cobrar
  const homePayableAccountsContainer = document.getElementById('homePayableAccountsContainer');
  if (homePayableAccountsContainer) {
    const pagar = (cuentas || []).filter(c => (c.tipo || '').toLowerCase() === 'pagar').slice(0, 3);
    if (pagar.length === 0) {
      homePayableAccountsContainer.innerHTML = '<p class="text-xs text-slate-400 py-2">No hay cuentas por pagar pendientes.</p>';
    } else {
      homePayableAccountsContainer.innerHTML = '';
      pagar.forEach(c => {
        const row = document.createElement('div');
        row.className = 'account-item-row py-2.5 px-2 rounded-lg flex items-center justify-between';
        row.innerHTML = `
          <div>
            <p class="text-xs md:text-sm font-semibold text-slate-800">${escapeHTML(c.tercero)}: <span class="font-normal text-slate-600">${escapeHTML(c.concepto)}</span></p>
            <p class="text-xs font-bold text-slate-700 mt-0.5">$${Number(c.monto_total).toFixed(2)}</p>
          </div>
          <span class="text-xs font-medium ${c.estado === 'vencido' ? 'text-rose-500' : 'text-slate-400'} capitalize">${escapeHTML(c.estado || 'Pendiente')}</span>
        `;
        homePayableAccountsContainer.appendChild(row);
      });
    }
  }

  const homeReceivableAccountsContainer = document.getElementById('homeReceivableAccountsContainer');
  if (homeReceivableAccountsContainer) {
    const cobrar = (cuentas || []).filter(c => (c.tipo || '').toLowerCase() === 'cobrar').slice(0, 3);
    if (cobrar.length === 0) {
      homeReceivableAccountsContainer.innerHTML = '<p class="text-xs text-slate-400 py-2">No hay cuentas por cobrar pendientes.</p>';
    } else {
      homeReceivableAccountsContainer.innerHTML = '';
      cobrar.forEach(c => {
        const row = document.createElement('div');
        row.className = 'account-item-row py-2.5 px-2 rounded-lg flex items-center justify-between';
        row.innerHTML = `
          <div>
            <p class="text-xs md:text-sm font-semibold text-slate-800">${escapeHTML(c.tercero)}: <span class="font-normal text-slate-600">${escapeHTML(c.concepto)}</span></p>
            <p class="text-xs font-bold text-slate-700 mt-0.5">$${Number(c.monto_total).toFixed(2)}</p>
          </div>
          <span class="text-xs font-medium ${c.estado === 'vencido' ? 'text-rose-500' : 'text-slate-400'} capitalize">${escapeHTML(c.estado || 'Pendiente')}</span>
        `;
        homeReceivableAccountsContainer.appendChild(row);
      });
    }
  }

  // 5. Actualizar Gráfico financeChart
  if (window.financeChartInstance) {
    const lastIdx = window.financeChartInstance.data.labels.length - 1;
    window.financeChartInstance.data.datasets[0].data[lastIdx] = Math.round(facturacionTotal);
    window.financeChartInstance.data.datasets[1].data[lastIdx] = Math.max(0, Math.round(utilidadNeta));
    window.financeChartInstance.update();
  }

  if (window.lucide) window.lucide.createIcons();
}

// ============================================================================
// MÉTODOS CRUD: CONFIGURACIÓN DE COMERCIO & CUENTA
// ============================================================================

const CONFIG_DEFAULT = {
  nombre_comercial: 'Auto Repuestos BG III C.A.',
  rif: 'J-40615751-1',
  telefono: '+58 412-1234567',
  email: 'autorepuestosbg3@gmail.com',
  direccion: 'Calle Principal, Local Auto Repuestos BG III',
  moneda: 'USD',
  tasa_cambio: 39.50,
  iva: 16.00,
  ancho_impresora: '80mm',
  pie_factura: '¡Gracias por su compra en Auto Repuestos BG III C.A.! Vuelva pronto.'
};

/**
 * Obtener la configuración actual desde Supabase o fallback local
 */
async function apiObtenerConfiguracion() {
  let config = { ...CONFIG_DEFAULT };

  // Intentar cargar de localStorage como base inmediata
  try {
    const localRaw = localStorage.getItem('bg_store_config');
    if (localRaw) {
      config = { ...config, ...JSON.parse(localRaw) };
    }
  } catch (e) {}

  // Si Supabase está disponible, consultar la tabla configuracion
  if (window.supabaseClient) {
    try {
      const { data, error } = await window.supabaseClient
        .from('configuracion')
        .select('*')
        .eq('id', 'config_global')
        .maybeSingle();

      if (!error && data) {
        config = { ...config, ...data };
        localStorage.setItem('bg_store_config', JSON.stringify(config));
      }
    } catch (err) {
      console.warn('Consulta a configuracion en Supabase usó fallback local:', err);
    }
  }

  return config;
}

/**
 * Guardar la configuración en Supabase y sincronizar con localStorage
 */
async function apiGuardarConfiguracion(nuevaConfig) {
  const mergedConfig = { ...CONFIG_DEFAULT, ...nuevaConfig };

  // Guardar en localStorage
  localStorage.setItem('bg_store_config', JSON.stringify(mergedConfig));

  // Actualizar sesión del usuario si cambió el nombre comercial
  try {
    const authRaw = localStorage.getItem('bg_auth_user');
    if (authRaw) {
      const user = JSON.parse(authRaw);
      user.sucursal = mergedConfig.nombre_comercial || 'Gabriel Shop';
      localStorage.setItem('bg_auth_user', JSON.stringify(user));
    }
  } catch (e) {}

  // Guardar en Supabase si está disponible
  if (window.supabaseClient) {
    try {
      const payload = {
        id: 'config_global',
        nombre_comercial: mergedConfig.nombre_comercial,
        rif: mergedConfig.rif,
        telefono: mergedConfig.telefono,
        email: mergedConfig.email,
        direccion: mergedConfig.direccion,
        moneda: mergedConfig.moneda,
        tasa_cambio: parseFloat(mergedConfig.tasa_cambio || 39.50),
        iva: parseFloat(mergedConfig.iva || 16.00),
        ancho_impresora: mergedConfig.ancho_impresora || '80mm',
        pie_factura: mergedConfig.pie_factura || '¡Gracias por su compra en Gabriel Shop!',
        updated_at: new Date().toISOString()
      };

      const { error } = await window.supabaseClient
        .from('configuracion')
        .upsert([payload]);

      if (error) {
        console.warn('Supabase configuracion aviso:', error.message);
      }
    } catch (err) {
      console.warn('Error al guardar en Supabase configuracion:', err);
    }
  }

  mostrarNotificacion('¡Configuración de comercio y cuenta guardada con éxito!', 'success');
  return true;
}

/**
 * Sincronizar UI de comercio.html
 */
async function sincronizarConfiguracionUI() {
  const configForm = document.getElementById('configForm');
  if (!configForm) return;

  actualizarBadgeEstado(true);

  const config = await apiObtenerConfiguracion();

  const nombreInput = document.getElementById('configNombreComercial');
  const rifInput = document.getElementById('configRif');
  const telInput = document.getElementById('configTelefono');
  const emailInput = document.getElementById('configEmail');
  const dirInput = document.getElementById('configDireccion');
  const monedaSelect = document.getElementById('configMoneda');
  const tasaInput = document.getElementById('configTasaCambio');
  const ivaInput = document.getElementById('configIva');

  if (nombreInput) nombreInput.value = config.nombre_comercial || '';
  if (rifInput) rifInput.value = config.rif || '';
  if (telInput) telInput.value = config.telefono || '';
  if (emailInput) emailInput.value = config.email || '';
  if (dirInput) dirInput.value = config.direccion || '';
  if (monedaSelect && config.moneda) monedaSelect.value = config.moneda;
  if (tasaInput) tasaInput.value = parseFloat(config.tasa_cambio || 39.50).toFixed(2);
  if (ivaInput) ivaInput.value = parseFloat(config.iva || 16.00).toFixed(2);

  // Modal Impresora
  const printerWidth = document.getElementById('printerPaperWidth');
  const printerFooter = document.getElementById('printerTicketFooter');
  if (printerWidth && config.ancho_impresora) printerWidth.value = config.ancho_impresora;
  if (printerFooter && config.pie_factura) printerFooter.value = config.pie_factura;

  // Modal Tasa BCV
  const modalTasa = document.getElementById('modalTasaInput');
  if (modalTasa) modalTasa.value = parseFloat(config.tasa_cambio || 39.50).toFixed(2);
}

/**
 * Vincular formularios y modales en la pantalla de Comercio & Cuenta
 */
function vincularFormularioConfiguracion() {
  const configForm = document.getElementById('configForm');
  const saveBtn = document.getElementById('btnGuardarConfiguracion');

  async function guardarDesdeFormulario(e) {
    if (e) e.preventDefault();
    const originalText = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>Guardando...</span>
        </div>
      `;
    }

    const nuevaConfig = {
      nombre_comercial: document.getElementById('configNombreComercial')?.value.trim() || 'Gabriel Shop',
      rif: document.getElementById('configRif')?.value.trim() || 'J-41299831-0',
      telefono: document.getElementById('configTelefono')?.value.trim() || '',
      email: document.getElementById('configEmail')?.value.trim() || '',
      direccion: document.getElementById('configDireccion')?.value.trim() || '',
      moneda: document.getElementById('configMoneda')?.value || 'USD',
      tasa_cambio: parseFloat(document.getElementById('configTasaCambio')?.value || 39.50),
      iva: parseFloat(document.getElementById('configIva')?.value || 16.00),
      ancho_impresora: document.getElementById('printerPaperWidth')?.value || '80mm',
      pie_factura: document.getElementById('printerTicketFooter')?.value.trim() || '¡Gracias por su compra en Gabriel Shop!'
    };

    await apiGuardarConfiguracion(nuevaConfig);

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', guardarDesdeFormulario);
  if (configForm) configForm.addEventListener('submit', guardarDesdeFormulario);

  // Modal 1: Impresora Térmica
  const modalPrinter = document.getElementById('modalPrinterConfig');
  const openPrinterBtn = document.getElementById('btnPrinterConfig');
  const closePrinterBtn = document.getElementById('closePrinterModalBtn');
  const savePrinterBtn = document.getElementById('savePrinterModalBtn');
  const btnTestPrint = document.getElementById('btnTestPrint');

  function openPrinter() {
    if (!modalPrinter) return;
    modalPrinter.classList.remove('hidden');
    setTimeout(() => {
      const box = modalPrinter.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closePrinter() {
    if (!modalPrinter) return;
    const box = modalPrinter.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalPrinter.classList.add('hidden'), 200);
  }

  if (openPrinterBtn) openPrinterBtn.addEventListener('click', openPrinter);
  if (closePrinterBtn) closePrinterBtn.addEventListener('click', closePrinter);
  if (modalPrinter) {
    modalPrinter.addEventListener('click', (e) => {
      if (e.target === modalPrinter) closePrinter();
    });
  }

  if (savePrinterBtn) {
    savePrinterBtn.addEventListener('click', async () => {
      const ancho = document.getElementById('printerPaperWidth')?.value || '80mm';
      const pie = document.getElementById('printerTicketFooter')?.value.trim() || '';
      const actual = await apiObtenerConfiguracion();
      actual.ancho_impresora = ancho;
      actual.pie_factura = pie;
      await apiGuardarConfiguracion(actual);
      closePrinter();
    });
  }

  if (btnTestPrint) {
    btnTestPrint.addEventListener('click', async () => {
      const config = await apiObtenerConfiguracion();
      const ticketHtml = `
========================================
${config.nombre_comercial.toUpperCase()}
RIF: ${config.rif}
Telf: ${config.telefono}
${config.direccion}
========================================
TICKET DE PRUEBA POS (${config.ancho_impresora})
Fecha: ${new Date().toLocaleString()}
Atendido por: Gabriel (Admin)
----------------------------------------
1x Hamburguesa Doble BG       $8.50
1x Papas Rústicas Crispy      $2.50
----------------------------------------
SUBTOTAL:                    $11.00
IVA (16%):                    $1.76
TOTAL:                       $12.76
Tasa Oficial BCV: Bs. ${Number(config.tasa_cambio).toFixed(2)}
Total en Bs:      Bs. ${(12.76 * config.tasa_cambio).toFixed(2)}
========================================
${config.pie_factura}
========================================
      `;
      alert(ticketHtml);
    });
  }

  // Modal 2: Tasa BCV y Calculadora
  const modalBcv = document.getElementById('modalBcvConfig');
  const openBcvBtn = document.getElementById('btnBcvConfig');
  const closeBcvBtn = document.getElementById('closeBcvModalBtn');
  const applyBcvRateBtn = document.getElementById('applyBcvRateBtn');
  const modalTasaInput = document.getElementById('modalTasaInput');
  const calcUsdInput = document.getElementById('calcUsdInput');
  const calcBsOutput = document.getElementById('calcBsOutput');

  function openBcv() {
    if (!modalBcv) return;
    const tasaActual = parseFloat(document.getElementById('configTasaCambio')?.value || 39.50);
    if (modalTasaInput) modalTasaInput.value = tasaActual.toFixed(2);
    actualizarCalculadora();

    modalBcv.classList.remove('hidden');
    setTimeout(() => {
      const box = modalBcv.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closeBcv() {
    if (!modalBcv) return;
    const box = modalBcv.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalBcv.classList.add('hidden'), 200);
  }

  function actualizarCalculadora() {
    const tasa = parseFloat(modalTasaInput?.value || 39.50);
    const usd = parseFloat(calcUsdInput?.value || 0);
    const bs = usd * tasa;
    if (calcBsOutput) {
      calcBsOutput.textContent = `Bs. ${bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  if (openBcvBtn) openBcvBtn.addEventListener('click', openBcv);
  if (closeBcvBtn) closeBcvBtn.addEventListener('click', closeBcv);
  if (modalBcv) {
    modalBcv.addEventListener('click', (e) => {
      if (e.target === modalBcv) closeBcv();
    });
  }

  if (modalTasaInput) modalTasaInput.addEventListener('input', actualizarCalculadora);
  if (calcUsdInput) calcUsdInput.addEventListener('input', actualizarCalculadora);

  if (applyBcvRateBtn) {
    applyBcvRateBtn.addEventListener('click', async () => {
      const nuevaTasa = parseFloat(modalTasaInput?.value || 39.50);
      const inputEnFormulario = document.getElementById('configTasaCambio');
      if (inputEnFormulario) inputEnFormulario.value = nuevaTasa.toFixed(2);

      const actual = await apiObtenerConfiguracion();
      actual.tasa_cambio = nuevaTasa;
      await apiGuardarConfiguracion(actual);

      closeBcv();
    });
  }

  // Modal 3: Roles y Permisos
  const modalRoles = document.getElementById('modalRolesConfig');
  const openRolesBtn = document.getElementById('btnRolesConfig');
  const closeRolesBtn = document.getElementById('closeRolesModalBtn');
  const closeRolesActionBtn = document.getElementById('closeRolesActionBtn');

  function openRoles() {
    if (!modalRoles) return;
    modalRoles.classList.remove('hidden');
    setTimeout(() => {
      const box = modalRoles.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closeRoles() {
    if (!modalRoles) return;
    const box = modalRoles.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalRoles.classList.add('hidden'), 200);
  }

  if (openRolesBtn) openRolesBtn.addEventListener('click', openRoles);
  if (closeRolesBtn) closeRolesBtn.addEventListener('click', closeRoles);
  if (closeRolesActionBtn) closeRolesActionBtn.addEventListener('click', closeRoles);
  if (modalRoles) {
    modalRoles.addEventListener('click', (e) => {
      if (e.target === modalRoles) closeRoles();
    });
  }
}

// Helpers generales
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatearFechaHora(timestamp) {
  if (!timestamp) return 'Hoy';
  const fecha = new Date(timestamp);
  const hoy = new Date();
  const esHoy = fecha.toDateString() === hoy.toDateString();

  const horaStr = fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (esHoy) {
    return `Hoy, ${horaStr}`;
  }
  return `${fecha.toLocaleDateString([], { day: '2-digit', month: '2-digit' })}, ${horaStr}`;
}

// ============================================================================
// AUTO-INICIALIZACIÓN AL CARGAR EL DOCUMENTO
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();

  // Si estamos en la pantalla Home (index.html)
  if (document.getElementById('homeMonthlyRevenueKpi')) {
    sincronizarDashboardHomeUI();
  }

  // Si estamos en la pantalla de inventario
  if (document.getElementById('inventoryTable')) {
    sincronizarInventarioUI();
    vincularFormularioIngreso();
  }

  // Si estamos en la pantalla de ventas
  if (document.getElementById('salesTable')) {
    sincronizarVentasUI();
  }

  // Si estamos en la pantalla de gastos
  if (document.getElementById('expensesTable')) {
    sincronizarGastosUI();
  }

  // Si estamos en la pantalla de resumen financiero
  if (document.getElementById('finGrossRevenueKpi') || document.getElementById('profitAndLossChart')) {
    sincronizarResumenFinancieroUI();
  }

  // Modal de registro de gasto (en gastos.html y resumen-financiero.html)
  if (document.getElementById('expenseForm')) {
    vincularFormularioGasto();
  }

  // Selector de productos en el modal de ventas (disponible en ventas y global)
  if (document.getElementById('saleProductSelect')) {
    poblarSelectorProductosVenta();
    vincularFormularioVenta();
  }

  // Si estamos en la pantalla de gestión de cuentas (cuentas.html)
  if (document.getElementById('cuentasCobrarContainer') || document.getElementById('accountsReceivableKpi')) {
    sincronizarCuentasUI();
    vincularFormulariosCuentas();
  }

  // Si estamos en la pantalla de configuración de cuenta & comercio (comercio.html)
  if (document.getElementById('configForm') || document.getElementById('configNombreComercial')) {
    sincronizarConfiguracionUI();
    vincularFormularioConfiguracion();
  }
});
