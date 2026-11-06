import { escapeHtml } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
  loadAdminBillingData();

  const refreshBtn = document.getElementById('btn-refresh-orders');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = 'Refreshing...';
      loadAdminBillingData().finally(() => {
        refreshBtn.textContent = '🔄 Refresh';
      });
    });
  }
});

async function loadAdminBillingData() {
  try {
    const res = await fetch('/admin/billing/pending', { credentials: 'include' });
    if (res.status === 403) {
      document.querySelector('.admin-container').innerHTML = `
        <div style="text-align: center; padding: 64px 20px;">
          <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
          <h2 style="font-size: 24px; color: #ef4444; margin-bottom: 8px;">Admin Authorization Required</h2>
          <p style="color: #94a3b8; max-width: 440px; margin: 0 auto 24px auto;">
            This section is restricted to system administrators for verifying manual bank transactions.
          </p>
          <a href="/settings" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Return to Settings
          </a>
        </div>
      `;
      return;
    }
    if (!res.ok) throw new Error('Failed to load admin billing data');

    const data = await res.json();
    const pendingOrders = (data.pending || []).filter(o => o.status === 'submitted');
    const allOrders = data.all || [];

    // Calculate stats
    const approvedOrders = allOrders.filter(o => o.status === 'paid');
    const totalRevenuePaise = approvedOrders.reduce((sum, o) => sum + (o.amount_paise || 0), 0);

    const pendingEl = document.getElementById('stat-pending');
    const approvedEl = document.getElementById('stat-approved');
    const revenueEl = document.getElementById('stat-revenue');

    if (pendingEl) pendingEl.textContent = pendingOrders.length;
    if (approvedEl) approvedEl.textContent = approvedOrders.length;
    if (revenueEl) revenueEl.textContent = (totalRevenuePaise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

    // Render Pending Table
    renderPendingTable(pendingOrders);

    // Render All Orders Table
    renderAllOrdersTable(allOrders);
  } catch (err) {
    console.error('Error loading admin billing:', err);
  }
}

function renderPendingTable(orders) {
  const tbody = document.getElementById('table-pending-orders');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #10b981; padding: 24px;">✅ No pending verifications. All customer orders are up to date.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(ord => {
    const amt = (ord.amount_paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
    const submitted = ord.submitted_at ? new Date(ord.submitted_at).toLocaleString() : '--';
    const email = ord.user_email || ord.tenant_id;

    return `
      <tr id="row-order-${ord.id}">
        <td><strong style="color: #f8fafc; font-family: monospace;">${escapeHtml(ord.order_code)}</strong></td>
        <td>
          <div style="color: #e2e8f0; font-weight: 500;">${escapeHtml(email)}</div>
          <div style="font-size: 11px; color: #64748b;">${escapeHtml(ord.tenant_id)}</div>
        </td>
        <td><strong style="color: #38bdf8;">+${ord.quantity} Cameras</strong></td>
        <td><strong style="color: #f8fafc;">${amt}</strong></td>
        <td>
          <span class="utr-code" title="Click to copy" onclick="navigator.clipboard.writeText('${escapeHtml(ord.utr)}'); alert('Copied UTR: ${escapeHtml(ord.utr)}');">
            ${escapeHtml(ord.utr || 'Pending')} 📋
          </span>
        </td>
        <td style="color: #94a3b8; font-size: 12px;">${submitted}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-approve" onclick="window.approveOrder('${ord.id}', '${escapeHtml(ord.order_code)}', ${ord.quantity})">
            ✅ Approve (+Quota)
          </button>
          <button class="btn-reject" onclick="window.rejectOrder('${ord.id}', '${escapeHtml(ord.order_code)}')">
            ❌ Reject
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAllOrdersTable(orders) {
  const tbody = document.getElementById('table-all-orders');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 24px;">No orders found in database.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(ord => {
    const amt = (ord.amount_paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
    const dt = ord.created_at ? new Date(ord.created_at).toLocaleDateString() : '--';
    const email = ord.user_email || ord.tenant_id;
    const utr = ord.utr ? `<code style="color: #38bdf8;">${escapeHtml(ord.utr)}</code>` : '<span style="color: #64748b;">--</span>';
    const verBy = ord.verified_by ? escapeHtml(ord.verified_by) : '<span style="color: #64748b;">--</span>';

    let badgeClass = 'badge-awaiting';
    if (ord.status === 'paid') badgeClass = 'badge-paid';
    else if (ord.status === 'submitted') badgeClass = 'badge-submitted';
    else if (ord.status === 'rejected') badgeClass = 'badge-rejected';
    else if (ord.status === 'expired') badgeClass = 'badge-expired';

    return `
      <tr>
        <td><strong>${escapeHtml(ord.order_code)}</strong></td>
        <td style="color: #94a3b8;">${dt}</td>
        <td>
          <div style="color: #e2e8f0;">${escapeHtml(email)}</div>
        </td>
        <td style="color: #38bdf8;">+${ord.quantity}</td>
        <td style="font-weight: 600;">${amt}</td>
        <td>${utr}</td>
        <td style="font-size: 12px; color: #94a3b8;">${verBy}</td>
        <td><span class="badge ${badgeClass}">${ord.status}</span></td>
      </tr>
    `;
  }).join('');
}

window.approveOrder = async function(orderId, orderCode, quantity) {
  if (!confirm(`Are you sure you verified the payment for order ${orderCode}?\n\nThis will instantly credit +${quantity} camera quota to the customer.`)) {
    return;
  }
  try {
    const res = await fetch(`/admin/billing/orders/${orderId}/approve`, {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Approval error: ${data.detail || 'Failed'}`);
      return;
    }
    alert(`✅ Order ${orderCode} successfully approved! Total quota for tenant is now ${data.new_quota}.`);
    loadAdminBillingData();
  } catch (err) {
    alert('Failed to approve order. Please check network connection.');
  }
};

window.rejectOrder = async function(orderId, orderCode) {
  const reason = prompt(`Enter rejection reason for order ${orderCode}:`, 'UTR not verified on bank statement');
  if (reason === null) return;

  try {
    const res = await fetch(`/admin/billing/orders/${orderId}/reject`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || 'UTR not verified on bank statement' })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Rejection error: ${data.detail || 'Failed'}`);
      return;
    }
    alert(`Order ${orderCode} has been rejected.`);
    loadAdminBillingData();
  } catch (err) {
    alert('Failed to reject order. Please check network connection.');
  }
};
