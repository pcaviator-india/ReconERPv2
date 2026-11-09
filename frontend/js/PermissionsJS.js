/**
 * PermissionsJS.js — Role Permissions Management Module Frontend
 */
(function () {
  'use strict';

  let _matrix = {};
  let _roles = [];
  let _modules = [];
  let _activeRole = null;
  let _dirty = {};

  const CAT_ICONS = {
    'Requirements': 'bi-file-earmark-text',
    'Procurement': 'bi-cart-check',
    'Catalog': 'bi-box-seam',
    'Inventory': 'bi-boxes',
    'Operations': 'bi-gear',
    'System': 'bi-shield-lock'
  };

  // Load matrix data from API
  async function loadMatrix() {
    const container = document.getElementById('permMatrixContainer');
    try {
      if (!window.RECON_API) {
        throw new Error('API client not initialized');
      }
      const res = await RECON_API.getPermissionsMatrix();
      if (res.status !== 'success' || !res.data) {
        throw new Error(res.message || 'Failed to load permissions matrix');
      }

      _matrix = res.data.matrix || {};
      _roles = res.data.roles || [];
      _modules = res.data.modules || [];
      _dirty = {};

      renderTabs();
      const firstRole = _activeRole || (_roles[0] && _roles[0].id) || 'admin';
      renderMatrix(firstRole);
    } catch (err) {
      console.error('Failed to load permissions:', err);
      showPermAlert('danger', '❌ Error loading permissions: ' + err.message);
      if (container) {
        container.innerHTML = `<div class="p-4 text-center text-danger">Failed to load permissions: ${err.message}</div>`;
      }
    }
  }

  // Render role selection tabs
  function renderTabs() {
    const tabs = document.getElementById('permRoleTabs');
    if (!tabs) return;
    tabs.innerHTML = _roles.map((r, i) => `
      <li class="nav-item" role="presentation">
        <button class="nav-link ${(_activeRole === r.id || (!_activeRole && i === 0)) ? 'active' : ''} d-flex align-items-center gap-1"
          id="tab-${r.id}" type="button"
          onclick="window._permSelectRole('${r.id}', this)">
          <i class="bi bi-person-badge"></i>
          <span>${r.name}</span>
          ${r.is_system ? '<span class="badge bg-secondary ms-1 opacity-75" style="font-size:0.65em">system</span>' : ''}
          ${_dirty[r.id] ? '<span class="badge bg-warning text-dark ms-1" style="font-size:0.65em">•</span>' : ''}
        </button>
      </li>
    `).join('');
  }

  window._permSelectRole = function(roleId, btn) {
    _activeRole = roleId;
    document.querySelectorAll('#permRoleTabs .nav-link').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderMatrix(roleId);
  };

  // Render table matrix for selected role
  function renderMatrix(roleId) {
    if (!roleId || !_matrix[roleId]) return;
    _activeRole = roleId;
    const container = document.getElementById('permMatrixContainer');
    if (!container) return;

    const perms = _dirty[roleId]
      ? { ..._matrix[roleId].permissions, ..._dirty[roleId] }
      : _matrix[roleId].permissions;

    const cats = {};
    _modules.forEach(m => {
      if (!cats[m.category]) cats[m.category] = [];
      cats[m.category].push(m);
    });

    let html = `
      <table class="table table-bordered table-hover table-sm mb-0 align-middle">
        <thead class="table-dark">
          <tr>
            <th style="min-width:200px">Module</th>
            <th class="text-center" style="width:80px"><i class="bi bi-eye" title="View"></i><br><small>View</small></th>
            <th class="text-center" style="width:80px"><i class="bi bi-pencil" title="Edit/Create"></i><br><small>Edit</small></th>
            <th class="text-center" style="width:80px"><i class="bi bi-check2-circle" title="Approve"></i><br><small>Approve</small></th>
            <th class="text-center" style="width:130px"><i class="bi bi-geo-alt" title="Data Scope"></i><br><small>Scope</small></th>
          </tr>
        </thead>
        <tbody>
    `;

    Object.entries(cats).forEach(([cat, mods]) => {
      const icon = CAT_ICONS[cat] || 'bi-grid';
      html += `
        <tr class="table-secondary">
          <td colspan="5" class="fw-semibold py-1 px-3">
            <i class="bi ${icon} me-2 text-primary"></i>${cat}
          </td>
        </tr>
      `;
      mods.forEach(m => {
        const p = perms[m.key] || { can_view: 0, can_edit: 0, can_approve: 0, site_scope: 'all' };
        const hasApprove = ['req_approve', 'quote_approve'].includes(m.key);
        const hasSiteScope = !['system_integrations', 'admin_val', 'products'].includes(m.key);

        html += `
          <tr>
            <td class="ps-4">
              <div class="fw-semibold small">${m.name}</div>
              <div class="text-muted" style="font-size:0.72em">${m.moduleFile}</div>
            </td>
            <td class="text-center">
              <div class="form-check d-inline-block">
                <input class="form-check-input" type="checkbox" title="Can View"
                  id="perm_${roleId}_${m.key}_view"
                  ${p.can_view ? 'checked' : ''}
                  onchange="window._permChange('${roleId}','${m.key}','can_view', this.checked)">
              </div>
            </td>
            <td class="text-center">
              <div class="form-check d-inline-block">
                <input class="form-check-input" type="checkbox" title="Can Edit/Create"
                  id="perm_${roleId}_${m.key}_edit"
                  ${p.can_edit ? 'checked' : ''}
                  onchange="window._permChange('${roleId}','${m.key}','can_edit', this.checked)">
              </div>
            </td>
            <td class="text-center">
              ${hasApprove ? `
                <div class="form-check d-inline-block">
                  <input class="form-check-input" type="checkbox" title="Can Approve"
                    id="perm_${roleId}_${m.key}_approve"
                    ${p.can_approve ? 'checked' : ''}
                    onchange="window._permChange('${roleId}','${m.key}','can_approve', this.checked)">
                </div>
              ` : '<span class="text-muted small">—</span>'}
            </td>
            <td class="text-center">
              ${hasSiteScope ? `
                <select class="form-select form-select-sm"
                  id="perm_${roleId}_${m.key}_scope"
                  style="font-size:0.78em"
                  onchange="window._permChange('${roleId}','${m.key}','site_scope', this.value)">
                  <option value="all" ${p.site_scope !== 'assigned' ? 'selected' : ''}>🌐 All Sites</option>
                  <option value="assigned" ${p.site_scope === 'assigned' ? 'selected' : ''}>📌 Assigned Site</option>
                </select>
              ` : '<span class="text-muted small">Global</span>'}
            </td>
          </tr>
        `;
      });
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  // Handle perm checkbox change
  window._permChange = function(roleId, moduleKey, field, value) {
    if (!_dirty[roleId]) _dirty[roleId] = {};
    if (!_dirty[roleId][moduleKey]) {
      _dirty[roleId][moduleKey] = { ...(_matrix[roleId].permissions[moduleKey] || {}) };
    }
    _dirty[roleId][moduleKey][field] = value;
    renderTabs();
    const btn = document.getElementById('tab-' + _activeRole);
    if (btn) btn.classList.add('active');
  };

  // Save changes
  window.permSave = async function() {
    const btn = document.getElementById('btnSavePerms');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...'; }

    try {
      const rolesToSave = Object.keys(_dirty);
      if (rolesToSave.length === 0) {
        showPermAlert('info', 'No changes to save.');
        return;
      }

      for (const roleId of rolesToSave) {
        const changes = _dirty[roleId];
        const permsArray = Object.entries(changes).map(([moduleKey, p]) => ({
          module_key: moduleKey,
          can_view: p.can_view ? 1 : 0,
          can_edit: p.can_edit ? 1 : 0,
          can_approve: p.can_approve ? 1 : 0,
          site_scope: p.site_scope || 'all'
        }));
        await RECON_API.updateRolePermissions(roleId, permsArray);

        permsArray.forEach(p => {
          if (_matrix[roleId] && _matrix[roleId].permissions) {
            _matrix[roleId].permissions[p.module_key] = {
              ...(_matrix[roleId].permissions[p.module_key] || {}),
              ...p
            };
          }
        });
      }

      _dirty = {};
      renderTabs();
      showPermAlert('success', '✅ Permissions saved successfully for: ' + rolesToSave.join(', '));
    } catch (err) {
      showPermAlert('danger', '❌ Save failed: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy me-1"></i>Save Changes'; }
    }
  };

  // Reset to system defaults
  window.permResetDefaults = async function() {
    if (!confirm('Reset ALL system role permissions to recommended defaults?\n\nCustom roles are not affected.')) return;
    try {
      await RECON_API.resetPermissions();
      showPermAlert('success', '✅ Permissions reset to defaults. Reloading...');
      _dirty = {};
      await loadMatrix();
    } catch (err) {
      showPermAlert('danger', '❌ Reset failed: ' + err.message);
    }
  };

  // Add Role Modal
  window.permAddRole = function() {
    const modalEl = document.getElementById('permAddRoleModal');
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  };

  window.permCreateRole = async function() {
    const id = document.getElementById('newRoleId').value.trim();
    const name = document.getElementById('newRoleName').value.trim();
    const desc = document.getElementById('newRoleDesc').value.trim();
    const cloneFrom = document.getElementById('newRoleCloneFrom').value;

    if (!id || !name) { alert('Role ID and Name are required'); return; }

    try {
      await RECON_API.createRole(id, name, desc, cloneFrom);
      const modalEl = document.getElementById('permAddRoleModal');
      const inst = bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();

      showPermAlert('success', `✅ Role "${name}" created. Reloading...`);
      await loadMatrix();
      const btn = document.getElementById('tab-' + id);
      if (btn) window._permSelectRole(id, btn);
    } catch (err) {
      showPermAlert('danger', '❌ Failed to create role: ' + err.message);
    }
  };

  function showPermAlert(type, message) {
    const el = document.getElementById('permAlert');
    if (!el) return;
    el.className = `alert alert-${type} alert-dismissible fade show mb-3`;
    el.innerHTML = message + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    el.classList.remove('d-none');
    if (type === 'success') setTimeout(() => { el.classList.add('d-none'); }, 4000);
  }

  // Global entry point
  window.initPermissionsModule = async function() {
    console.log('🛡️ initPermissionsModule called');
    _dirty = {};
    await loadMatrix();
  };

})();

