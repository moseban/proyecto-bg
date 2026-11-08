// Interacciones y funcionalidad del Dashboard, Inventario, Ventas y Resumen Financiero BG
document.addEventListener('DOMContentLoaded', () => {
  // Inicialización de Lucide Icons si está disponible
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // ==================== CONTROL DE SESIÓN Y AUTENTICACIÓN ====================
  const currentPath = window.location.pathname.toLowerCase();
  const isLoginPage = currentPath.endsWith('login.html') || currentPath.endsWith('/login');
  let authUser = null;
  try {
    const rawAuth = localStorage.getItem('bg_auth_user');
    if (rawAuth) authUser = JSON.parse(rawAuth);
  } catch (e) {
    authUser = null;
  }

  // Si no está autenticado y no está en login.html, redirigir a login.html
  if (!isLoginPage && (!authUser || !authUser.loggedIn)) {
    window.location.href = 'login.html';
    return;
  }

  // ==================== MENÚ DE PERFIL DE USUARIO (GABRIEL ADMIN) ====================
  const profileBtns = document.querySelectorAll('button[aria-label="Perfil de usuario"]');
  profileBtns.forEach(btn => {
    // Personalizar avatar con la inicial 'G' de Gabriel
    btn.innerHTML = `<span class="font-extrabold text-sm text-[#7036ee]">G</span>`;
    btn.className = "w-10 h-10 rounded-full bg-purple-50 hover:bg-purple-100 border border-purple-200 flex items-center justify-center transition shadow-2xs cursor-pointer select-none";

    const parent = btn.parentElement;
    if (parent && !parent.classList.contains('relative')) {
      parent.classList.add('relative');
    }

    if (parent && !parent.querySelector('.user-profile-menu')) {
      const dropdown = document.createElement('div');
      dropdown.className = 'user-profile-menu hidden absolute right-0 top-12 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 py-3 px-4 z-50 text-slate-800';
      dropdown.innerHTML = `
        <div class="flex items-center gap-3 pb-3 border-b border-slate-100">
          <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-[#7036ee] to-[#8c4bf8] text-white flex items-center justify-center font-bold text-sm shadow-sm">
            G
          </div>
          <div class="overflow-hidden">
            <h4 class="text-sm font-bold text-slate-900 truncate">Gabriel</h4>
            <span class="inline-block text-[10px] font-semibold text-[#7036ee] bg-purple-50 px-2 py-0.5 rounded-full mt-0.5">
              Administrador General
            </span>
          </div>
        </div>
        <div class="py-2.5 text-xs text-slate-500 space-y-1.5">
          <div class="flex items-center justify-between">
            <span>Usuario:</span>
            <span class="font-mono font-bold text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">admin</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Sucursal:</span>
            <span class="font-semibold text-slate-700">${(() => {
              try {
                const cfg = JSON.parse(localStorage.getItem('bg_store_config') || '{}');
                return cfg.nombre_comercial || (authUser && authUser.sucursal) || 'Gabriel Shop';
              } catch(e) {
                return 'Gabriel Shop';
              }
            })()}</span>
          </div>
        </div>
        <div class="pt-2 border-t border-slate-100">
          <button class="logout-action-btn w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer">
            <i data-lucide="log-out" class="w-4 h-4"></i>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      `;
      parent.appendChild(dropdown);
      if (window.lucide) lucide.createIcons();

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
      });

      const logoutBtn = dropdown.querySelector('.logout-action-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          localStorage.removeItem('bg_auth_user');
          window.location.href = 'login.html';
        });
      }
    }
  });

  // Cerrar menú de perfil al hacer clic fuera
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.user-profile-menu').forEach(menu => {
      if (!menu.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  });

  // ==================== SIDEBAR RESPONSIVE ====================
  const sidebar = document.getElementById('sidebar');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  function toggleSidebar() {
    if (!sidebar) return;
    sidebar.classList.toggle('-translate-x-full');
    if (sidebarBackdrop) sidebarBackdrop.classList.toggle('hidden');
  }

  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', toggleSidebar);
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', toggleSidebar);
  }

  // ==================== DESPLEGABLES DEL SIDEBAR (UNIVERSAL) ====================
  // Permite abrir y cerrar los submenús de Ventas, Inventario y Resumen Financiero
  const dropdownButtons = document.querySelectorAll('.sidebar-dropdown-btn');
  dropdownButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-dropdown-target');
      const submenu = document.getElementById(targetId);
      const chevron = btn.querySelector('.dropdown-chevron');

      if (submenu) {
        submenu.classList.toggle('hidden');
      }
      if (chevron) {
        chevron.classList.toggle('rotate-180');
      }
    });
  });

  // Compatibilidad con ID legacy de inventario si existiera
  const legacyInventarioBtn = document.getElementById('inventarioMenuBtn');
  const legacyInventarioSubmenu = document.getElementById('inventarioSubmenu');
  const legacyInventarioChevron = document.getElementById('inventarioChevron');
  if (legacyInventarioBtn && legacyInventarioSubmenu && !legacyInventarioBtn.classList.contains('sidebar-dropdown-btn')) {
    legacyInventarioBtn.addEventListener('click', (e) => {
      e.preventDefault();
      legacyInventarioSubmenu.classList.toggle('hidden');
      if (legacyInventarioChevron) legacyInventarioChevron.classList.toggle('rotate-180');
    });
  }

  // ==================== MODAL NUEVA VENTA (GLOBAL) ====================
  const newSaleModal = document.getElementById('newSaleModal');
  const openModalBtns = document.querySelectorAll('.btn-open-sale-modal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const saleForm = document.getElementById('newSaleForm');

  function openSaleModal() {
    if (!newSaleModal) return;
    newSaleModal.classList.remove('hidden');
    setTimeout(() => {
      const box = newSaleModal.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closeSaleModal() {
    if (!newSaleModal) return;
    const box = newSaleModal.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
      newSaleModal.classList.add('hidden');
    }, 200);
  }

  openModalBtns.forEach(btn => btn.addEventListener('click', openSaleModal));
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeSaleModal);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeSaleModal);

  if (newSaleModal) {
    newSaleModal.addEventListener('click', (e) => {
      if (e.target === newSaleModal) closeSaleModal();
    });
  }

  if (saleForm) {
    saleForm.addEventListener('submit', (e) => {
      // Si Supabase está activo, la persistencia la maneja supabase-client.js
      if (window.supabaseClient) return;

      e.preventDefault();
      const client = document.getElementById('saleClient')?.value || 'Cliente General';
      const product = document.getElementById('saleProduct')?.value || 'Producto';
      const quantity = document.getElementById('saleQuantity')?.value || 1;
      const price = parseFloat(document.getElementById('salePrice')?.value || 0).toFixed(2);
      const paymentMethod = document.getElementById('salePaymentMethod')?.value || 'Efectivo';

      // Si estamos en la página de Ventas, agregar fila dinámicamente a la tabla
      const salesTable = document.getElementById('salesTable');
      if (salesTable) {
        const tbody = salesTable.querySelector('tbody');
        const count = tbody.querySelectorAll('tr').length + 1;
        const folio = `#00.${String(count).padStart(3, '0')}`;
        const newRow = document.createElement('tr');
        newRow.className = 'hover:bg-slate-50/70 transition';
        newRow.innerHTML = `
          <td class="py-3.5 px-4 font-bold text-[#7036ee]">${folio}</td>
          <td class="py-3.5 px-4 text-slate-500">Hoy, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td class="py-3.5 px-4 font-semibold text-slate-800">${client}</td>
          <td class="py-3.5 px-4 text-slate-600"><span class="px-2 py-0.5 rounded-md bg-purple-50 text-[#7036ee] font-medium text-xs">Directo</span></td>
          <td class="py-3.5 px-4 text-slate-600 capitalize">${paymentMethod}</td>
          <td class="py-3.5 px-4 text-slate-600">${quantity}x ${product}</td>
          <td class="py-3.5 px-4 font-bold text-slate-900">$${price}</td>
          <td class="py-3.5 px-4"><span class="px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600">Completada</span></td>
          <td class="py-3.5 px-4 text-right">
            <button class="text-slate-400 hover:text-slate-600 p-1"><i data-lucide="more-vertical" class="w-4 h-4"></i></button>
          </td>
        `;
        tbody.prepend(newRow);
        if (window.lucide) window.lucide.createIcons();
      }

      showToast(`¡Venta registrada con éxito: ${quantity}x ${product} ($${price})!`, 'success');
      saleForm.reset();
      closeSaleModal();
    });
  }

  // ==================== LÓGICA DE INVENTARIO ====================
  const searchInput = document.getElementById('inventorySearchInput');
  const inventoryTable = document.getElementById('inventoryTable');

  if (searchInput && inventoryTable) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const rows = inventoryTable.querySelectorAll('tbody tr');

      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(term) ? '' : 'none';
      });
    });
  }

  // Modal Ingreso a Inventario
  const ingressModal = document.getElementById('ingressModal');
  const openIngressModalBtn = document.getElementById('openIngressModalBtn');
  const closeIngressModalBtn = document.getElementById('closeIngressModalBtn');
  const cancelIngressModalBtn = document.getElementById('cancelIngressModalBtn');
  const ingressForm = document.getElementById('ingressForm');

  function openIngressModal() {
    if (!ingressModal) return;
    ingressModal.classList.remove('hidden');
    setTimeout(() => {
      const box = ingressModal.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closeIngressModal() {
    if (!ingressModal) return;
    const box = ingressModal.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
      ingressModal.classList.add('hidden');
    }, 200);
  }

  if (openIngressModalBtn) openIngressModalBtn.addEventListener('click', openIngressModal);
  if (closeIngressModalBtn) closeIngressModalBtn.addEventListener('click', closeIngressModal);
  if (cancelIngressModalBtn) cancelIngressModalBtn.addEventListener('click', closeIngressModal);

  if (ingressModal) {
    ingressModal.addEventListener('click', (e) => {
      if (e.target === ingressModal) closeIngressModal();
    });
  }

  if (ingressForm && inventoryTable) {
    ingressForm.addEventListener('submit', (e) => {
      // Si Supabase está activo, la persistencia la maneja supabase-client.js
      if (window.supabaseClient) return;

      e.preventDefault();
      const name = document.getElementById('itemNombre')?.value || 'Item';
      const sku = document.getElementById('itemSku')?.value || '--';
      const categoria = document.getElementById('itemCategoria')?.value || '--';
      const cost = parseFloat(document.getElementById('itemCosto')?.value || 0);
      const unit = document.getElementById('itemUnidad')?.value || 'Und.';
      const qty = parseFloat(document.getElementById('itemCantidad')?.value || 0);
      const totalVal = (cost * qty).toFixed(2);

      const tbody = inventoryTable.querySelector('tbody');
      const newRow = document.createElement('tr');
      newRow.className = 'border-b border-slate-100 hover:bg-slate-50/70 transition text-sm';
      newRow.innerHTML = `
        <td class="py-3.5 px-4 font-semibold text-slate-800">${name}</td>
        <td class="py-3.5 px-4 text-center text-slate-400">${sku}</td>
        <td class="py-3.5 px-4 text-center text-slate-400">${categoria}</td>
        <td class="py-3.5 px-4 text-right text-slate-600">${cost.toFixed(2)}/${unit}</td>
        <td class="py-3.5 px-4 text-right text-slate-700">${qty} ${unit}</td>
        <td class="py-3.5 px-4 text-right font-bold text-slate-800">$${totalVal}</td>
        <td class="py-3.5 px-4 text-right">
          <div class="flex items-center justify-end gap-2 text-slate-400">
            <button class="p-1 hover:text-[#7036ee] transition" title="Opciones">
              <i data-lucide="package" class="w-4 h-4 text-[#7036ee]"></i>
            </button>
            <button class="p-1 hover:text-slate-600 transition">
              <i data-lucide="more-vertical" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      `;
      tbody.prepend(newRow);
      if (window.lucide) window.lucide.createIcons();

      showToast(`¡Item "${name}" agregado al inventario!`, 'success');
      ingressForm.reset();
      closeIngressModal();
    });
  }

  // ==================== LÓGICA DE VENTAS ====================
  // Filtro de canales de venta (pestañas Todos, Local, Delivery, etc.)
  const channelFilterBtns = document.querySelectorAll('.channel-filter-btn');
  const salesTable = document.getElementById('salesTable');
  const salesSearchInput = document.getElementById('salesSearchInput');

  channelFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      channelFilterBtns.forEach(b => {
        b.classList.remove('bg-[#7036ee]', 'text-white', 'shadow-xs');
        b.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200');
      });
      btn.classList.add('bg-[#7036ee]', 'text-white', 'shadow-xs');
      btn.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200');

      const channel = btn.getAttribute('data-channel');
      if (!salesTable) return;
      const rows = salesTable.querySelectorAll('tbody tr');
      rows.forEach(row => {
        if (channel === 'all') {
          row.style.display = '';
        } else {
          const rowChannel = row.getAttribute('data-channel') || '';
          row.style.display = (rowChannel === channel) ? '' : 'none';
        }
      });
    });
  });

  // Búsqueda en tabla de ventas
  if (salesSearchInput && salesTable) {
    salesSearchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const rows = salesTable.querySelectorAll('tbody tr');
      rows.forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });
  }

  // ==================== LÓGICA DE RESUMEN FINANCIERO ====================
  // Modal Registrar Gasto
  const expenseModal = document.getElementById('expenseModal');
  const openExpenseModalBtn = document.getElementById('openExpenseModalBtn');
  const closeExpenseModalBtn = document.getElementById('closeExpenseModalBtn');
  const cancelExpenseModalBtn = document.getElementById('cancelExpenseModalBtn');
  const expenseForm = document.getElementById('expenseForm');

  function openExpenseModal() {
    if (!expenseModal) return;
    expenseModal.classList.remove('hidden');
    setTimeout(() => {
      const box = expenseModal.querySelector('.modal-content-box');
      if (box) {
        box.classList.remove('scale-95', 'opacity-0');
        box.classList.add('scale-100', 'opacity-100');
      }
    }, 10);
  }

  function closeExpenseModal() {
    if (!expenseModal) return;
    const box = expenseModal.querySelector('.modal-content-box');
    if (box) {
      box.classList.remove('scale-100', 'opacity-100');
      box.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
      expenseModal.classList.add('hidden');
    }, 200);
  }

  if (openExpenseModalBtn) openExpenseModalBtn.addEventListener('click', openExpenseModal);
  if (closeExpenseModalBtn) closeExpenseModalBtn.addEventListener('click', closeExpenseModal);
  if (cancelExpenseModalBtn) cancelExpenseModalBtn.addEventListener('click', closeExpenseModal);

  if (expenseModal) {
    expenseModal.addEventListener('click', (e) => {
      if (e.target === expenseModal) closeExpenseModal();
    });
  }

  if (expenseForm) {
    expenseForm.addEventListener('submit', (e) => {
      // Si Supabase está activo, la persistencia la maneja supabase-client.js
      if (window.supabaseClient) return;

      e.preventDefault();
      const concept = document.getElementById('expenseConcept')?.value || 'Gasto';
      const amount = document.getElementById('expenseAmount')?.value || '0.00';
      const category = document.getElementById('expenseCategory')?.value || 'Fijo';

      showToast(`¡Gasto registrado: ${concept} ($${amount}) en categoría ${category}!`, 'success');
      expenseForm.reset();
      closeExpenseModal();
    });
  }

  // Gráfica de Utilidad/Pérdida en resumen-financiero.html
  const plChartCanvas = document.getElementById('profitAndLossChart');
  if (plChartCanvas && typeof Chart !== 'undefined') {
    window.plChartInstance = new Chart(plChartCanvas, {
      type: 'bar',
      data: {
        labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct'],
        datasets: [
          {
            type: 'bar',
            label: 'Facturación ($)',
            data: [3200, 3800, 4200, 3900, 4800, 5200, 4900, 5600, 4300, 3420],
            backgroundColor: '#7036ee',
            borderRadius: 6,
            barPercentage: 0.6,
          },
          {
            type: 'bar',
            label: 'Costos & Gastos ($)',
            data: [2100, 2400, 2700, 2500, 3100, 3400, 3200, 3600, 2900, 2350],
            backgroundColor: '#ff8a70',
            borderRadius: 6,
            barPercentage: 0.6,
          },
          {
            type: 'line',
            label: 'Utilidad Neta ($)',
            data: [1100, 1400, 1500, 1400, 1700, 1800, 1700, 2000, 1400, 1070],
            borderColor: '#10b981',
            backgroundColor: '#10b981',
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#10b981',
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              font: { family: 'Plus Jakarta Sans', size: 12 }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: '#94a3b8' }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              font: { family: 'Plus Jakarta Sans', size: 11 },
              color: '#94a3b8',
              callback: (value) => '$' + value
            }
          }
        }
      }
    });
  }

  // Gráfica de Distribución de Gastos (Doughnut) en resumen-financiero.html
  const expenseChartCanvas = document.getElementById('expenseDistributionChart');
  if (expenseChartCanvas && typeof Chart !== 'undefined') {
    window.expenseChartInstance = new Chart(expenseChartCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Costo Mercancía', 'Nómina', 'Alquiler', 'Servicios', 'Publicidad/Otros'],
        datasets: [{
          data: [54, 20, 12, 8, 6],
          backgroundColor: ['#7036ee', '#8c4bf8', '#ff7657', '#ffa07a', '#cbd5e1'],
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              padding: 12,
              font: { family: 'Plus Jakarta Sans', size: 11 }
            }
          }
        },
        cutout: '70%'
      }
    });
  }

  // ==================== ACCIONES COMUNES (REPORTES, CIERRES) ====================
  const downloadReportBtn = document.getElementById('downloadReportBtn');
  if (downloadReportBtn) {
    downloadReportBtn.addEventListener('click', () => {
      showToast('Generando reporte en Excel/PDF...', 'info');
      setTimeout(() => {
        showToast('Reporte descargado exitosamente.', 'success');
      }, 1000);
    });
  }

  const bulkUploadBtn = document.getElementById('bulkUploadBtn');
  if (bulkUploadBtn) {
    bulkUploadBtn.addEventListener('click', () => {
      showToast('Módulo de Carga Masiva: selecciona un archivo .CSV o .XLSX', 'info');
    });
  }

  const stockOutBtn = document.getElementById('stockOutBtn');
  if (stockOutBtn) {
    stockOutBtn.addEventListener('click', () => {
      showToast('Registrar salida o merma de inventario', 'info');
    });
  }

  const recipeBtn = document.getElementById('recipeBtn');
  if (recipeBtn) {
    recipeBtn.addEventListener('click', () => {
      showToast('Módulo de producción y combos abierto', 'info');
    });
  }

  const registerCloseBtn = document.getElementById('registerCloseBtn');
  if (registerCloseBtn) {
    registerCloseBtn.addEventListener('click', () => {
      showToast('Cierre de turno Z generado. Cuadre de caja exitoso.', 'success');
    });
  }

  // ==================== NOTIFICACIONES TOAST ====================
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');

    if (type === 'error') {
      toast.className = 'fixed top-5 right-5 z-50 bg-rose-50 border border-rose-200 text-rose-900 p-4 rounded-xl shadow-xl flex items-start gap-3 max-w-sm transition-all duration-300 transform -translate-y-5 opacity-0';
      toast.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 mt-0.5">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </div>
        <div class="flex-1">
          <p class="text-xs font-bold text-rose-800">Error interno del servidor</p>
          <p class="text-xs text-rose-600 mt-0.5">${message}</p>
        </div>
        <button class="text-rose-400 hover:text-rose-600" onclick="this.parentElement.remove()">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      `;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.remove('-translate-y-5', 'opacity-0'));
      setTimeout(() => {
        toast.classList.add('-translate-y-5', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
      }, 4000);
      return;
    }

    toast.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition-all duration-300 transform translate-y-10 opacity-0';
    const dotColor = type === 'info' ? 'bg-sky-400' : 'bg-emerald-400';
    toast.innerHTML = `
      <span class="w-2.5 h-2.5 rounded-full ${dotColor}"></span>
      <span class="text-sm font-medium">${message}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove('translate-y-10', 'opacity-0'));
    setTimeout(() => {
      toast.classList.add('translate-y-10', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // Gráfico de Utilidad vs Facturación en index.html
  const ctx = document.getElementById('financeChart');
  if (ctx && typeof Chart !== 'undefined') {
    window.financeChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct'],
        datasets: [
          {
            label: 'Facturación ($)',
            data: [420, 580, 720, 650, 890, 1100, 950, 1200, 800, 31.60],
            backgroundColor: '#7036ee',
            borderRadius: 6,
            barPercentage: 0.6,
          },
          {
            label: 'Utilidad Neta ($)',
            data: [150, 210, 290, 240, 380, 480, 410, 530, 320, 10.40],
            backgroundColor: '#ffa07a',
            borderRadius: 6,
            barPercentage: 0.6,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              font: { family: 'Plus Jakarta Sans', size: 12 }
            }
          },
          tooltip: {
            backgroundColor: '#191c21',
            titleFont: { family: 'Plus Jakarta Sans', size: 13 },
            bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
            padding: 10,
            cornerRadius: 8,
            displayColors: true
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: '#94a3b8' }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              font: { family: 'Plus Jakarta Sans', size: 11 },
              color: '#94a3b8',
              callback: (value) => '$' + value
            }
          }
        }
      }
    });
  }

  // Botón flotante de soporte / chat
  const chatBtn = document.getElementById('chatFloatingBtn');
  if (chatBtn) {
    chatBtn.addEventListener('click', () => {
      showToast('Centro de ayuda y soporte en línea BG', 'info');
    });
  }
});
