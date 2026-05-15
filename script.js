/* ==============================
   script.js - MediCare Pharma
   Complete System – All Notifications
   ============================== */

// ---------- LOCAL STORAGE HELPERS (fallback) ----------
function getMedicinesLocal() {
    let meds = localStorage.getItem('medicines');
    return meds ? JSON.parse(meds) : [];
}
function saveMedicinesLocal(meds) { localStorage.setItem('medicines', JSON.stringify(meds)); }

// ---------- FIRESTORE HELPERS ----------
async function getMedicinesFromFirestore() {
    const db = window.db;
    if (!db) return getMedicinesLocal();
    const medsRef = firebaseCollection(db, "medicines");
    const snapshot = await firebaseGetDocs(medsRef);
    const meds = [];
    snapshot.forEach(doc => meds.push({ id: doc.id, ...doc.data() }));
    meds.sort((a, b) => (a.name || '').localeCompare(b.name));
    return meds;
}

async function saveMedicineToFirestore(data, docId = null) {
    const db = window.db;
    if (!db) {
        let meds = getMedicinesLocal();
        if (docId) {
            const idx = meds.findIndex(m => m.id == docId);
            if (idx >= 0) meds[idx] = { ...data, id: docId };
            else meds.push({ ...data, id: docId });
        } else {
            const newId = meds.length ? Math.max(...meds.map(m => m.id)) + 1 : 1;
            meds.push({ ...data, id: newId });
        }
        saveMedicinesLocal(meds);
        return;
    }
    const medsRef = firebaseCollection(db, "medicines");
    if (docId) {
        const docRef = firebaseDoc(db, "medicines", String(docId));
        await firebaseUpdateDoc(docRef, data);
    } else {
        await firebaseAddDoc(medsRef, data);
    }
}

async function deleteMedicineFromFirestore(id) {
    const db = window.db;
    if (!db) {
        let meds = getMedicinesLocal().filter(m => m.id != id);
        saveMedicinesLocal(meds);
        return;
    }
    const docRef = firebaseDoc(db, "medicines", String(id));
    await firebaseDeleteDoc(docRef);
}

// ---------- DOCTORS HELPERS ----------
async function getDoctorsFromFirestore() {
    const db = window.db;
    if (!db) return [];
    const docsRef = firebaseCollection(db, "doctors");
    const snapshot = await firebaseGetDocs(docsRef);
    const doctors = [];
    snapshot.forEach(doc => doctors.push({ id: doc.id, ...doc.data() }));
    return doctors;
}

async function saveDoctorToFirestore(data, docId = null) {
    const db = window.db;
    if (!db) return;
    const docsRef = firebaseCollection(db, "doctors");
    if (docId) {
        const docRef = firebaseDoc(db, "doctors", docId);
        await firebaseUpdateDoc(docRef, data);
    } else {
        await firebaseAddDoc(docsRef, data);
    }
}

async function deleteDoctorFromFirestore(id) {
    const db = window.db;
    if (!db) return;
    const docRef = firebaseDoc(db, "doctors", id);
    await firebaseDeleteDoc(docRef);
}

// ---------- STATE ----------
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let rememberMe = localStorage.getItem('rememberMe') === 'true';
let newOrderCount = 0;   // unviewed orders for seller/staff/owner

if (currentUser) {
    if (currentUser.isAdmin && !currentUser.role) currentUser.role = 'owner';
    if (!rememberMe) {
        currentUser = null;
        localStorage.removeItem('currentUser');
    }
}

let adminMedicineSort = { field: 'name', direction: 'asc' };

// ---------- OTHER LOCAL STORAGE ----------
function getOrders() { let orders = localStorage.getItem('orders'); return orders ? JSON.parse(orders) : []; }
function saveOrders(orders) { localStorage.setItem('orders', JSON.stringify(orders)); }
function getAppointments() { let apps = localStorage.getItem('appointments'); return apps ? JSON.parse(apps) : []; }
function saveAppointments(apps) { localStorage.setItem('appointments', JSON.stringify(apps)); }
function getDailyMeds() { let dm = localStorage.getItem('dailyMeds'); return dm ? JSON.parse(dm) : []; }
function saveDailyMeds(dm) { localStorage.setItem('dailyMeds', JSON.stringify(dm)); }
function getCart() { let cart = localStorage.getItem('cart'); return cart ? JSON.parse(cart) : []; }
function saveCart(cart) { localStorage.setItem('cart', JSON.stringify(cart)); }
function getVerificationRequests() {
    let reqs = localStorage.getItem('verificationRequests');
    return reqs ? JSON.parse(reqs) : [];
}
function saveVerificationRequests(reqs) { localStorage.setItem('verificationRequests', JSON.stringify(reqs)); }

// ---------- NOTIFICATION BELL & MODAL (enhanced) ----------
function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    let count = 0;
    if (currentUser) {
        if (currentUser.role === 'owner') {
            count = getVerificationRequests().filter(r => r.status === 'pending').length;
            count += newOrderCount;
        } else if (currentUser.role === 'staff' || currentUser.role === 'seller') {
            count = newOrderCount;
        } else if (currentUser.role === 'doctor') {
            const today = new Date().toISOString().split('T')[0];
            count += getAppointments().filter(a => a.date >= today).length;
        } else if (currentUser.role === 'user') {
            const today = new Date().toISOString().split('T')[0];
            count += getAppointments().filter(a => a.userId === currentUser.id && a.date >= today).length;
            // ALL ongoing medications (not just pending)
            count += getDailyMeds().filter(d => d.userId === currentUser.id).length;
            // Verification update notification
            const verifNotif = localStorage.getItem(`verifUpdate_${currentUser.id}`);
            if (verifNotif) count += 1;
        }
    }
    if (count > 0) { badge.style.display = 'inline-block'; badge.textContent = count; }
    else { badge.style.display = 'none'; }
}

function openNotifModal() { document.getElementById('notifModal').classList.add('show'); renderNotifModal(); }
function closeNotifModal() { document.getElementById('notifModal').classList.remove('show'); }

async function renderNotifModal() {
    const tabsDiv = document.getElementById('notifTabs');
    const contentDiv = document.getElementById('notifContent');
    let tabsHTML = '', contentHTML = '';

    if (currentUser && currentUser.role === 'owner') {
        tabsHTML = `<button class="modal-tab active" onclick="switchNotifTab('stock')">📦 Stock & Expiry</button>
                    <button class="modal-tab" onclick="switchNotifTab('verifications')">👥 Verifications</button>
                    <button class="modal-tab" onclick="switchNotifTab('orders')">📦 Orders</button>`;
        contentHTML = await getAdminStockContent();
    } else if (currentUser && (currentUser.role === 'staff' || currentUser.role === 'seller')) {
        tabsHTML = `<button class="modal-tab active" onclick="switchNotifTab('orders')">📦 New Orders</button>`;
        contentHTML = getSellerOrderContent();
    } else if (currentUser && currentUser.role === 'doctor') {
        tabsHTML = `<button class="modal-tab active" onclick="switchNotifTab('appointments')">📅 Appointments</button>`;
        contentHTML = getDoctorApptContent();
    } else if (currentUser && currentUser.role === 'user') {
        tabsHTML = `<button class="modal-tab active" onclick="switchNotifTab('medications')">💊 Medications</button>
                    <button class="modal-tab" onclick="switchNotifTab('appointments')">📅 Appointments</button>
                    <button class="modal-tab" onclick="switchNotifTab('orders')">📦 Orders</button>
                    <button class="modal-tab" onclick="switchNotifTab('verification')">🔔 Status</button>`;
        contentHTML = getUserMedsContent();
    } else {
        contentHTML = '<p>No notifications.</p>';
    }

    tabsDiv.innerHTML = tabsHTML;
    contentDiv.innerHTML = contentHTML;
    window._currentNotifTab = currentUser?.role === 'owner' ? 'stock'
                            : (currentUser?.role === 'staff' || currentUser?.role === 'seller') ? 'orders'
                            : currentUser?.role === 'doctor' ? 'appointments'
                            : 'medications';
}

function switchNotifTab(tab) {
    window._currentNotifTab = tab;
    const tabs = document.querySelectorAll('#notifTabs .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));
    const activeTab = [...tabs].find(t => t.textContent.toLowerCase().includes(tab));
    if (activeTab) activeTab.classList.add('active');

    const contentDiv = document.getElementById('notifContent');
    if (currentUser?.role === 'owner') {
        if (tab === 'stock') getAdminStockContent().then(html => contentDiv.innerHTML = html);
        else if (tab === 'verifications') contentDiv.innerHTML = getAdminVerifContent();
        else if (tab === 'orders') contentDiv.innerHTML = getSellerOrderContent();
    } else if (currentUser?.role === 'staff' || currentUser?.role === 'seller') {
        if (tab === 'orders') contentDiv.innerHTML = getSellerOrderContent();
    } else if (currentUser?.role === 'doctor') {
        if (tab === 'appointments') contentDiv.innerHTML = getDoctorApptContent();
    } else {
        if (tab === 'medications') contentDiv.innerHTML = getUserMedsContent();
        else if (tab === 'appointments') contentDiv.innerHTML = getUserAppointmentsContent();
        else if (tab === 'orders') contentDiv.innerHTML = getUserOrdersContent();
        else if (tab === 'verification') contentDiv.innerHTML = getUserVerificationContent();
    }
}

// ---------- NOTIFICATION CONTENT HELPERS (same + new verification tab) ----------
async function getAdminStockContent() {
    const meds = await getMedicinesFromFirestore();
    const today = new Date(); const warningDays = 30;
    let html = '<h4>📦 Stock & Expiration Alerts</h4>';
    const expiring = [], expired = [], low = [];
    meds.forEach(m => {
        const exp = m.expirationDate ? new Date(m.expirationDate) : null;
        const days = exp ? Math.ceil((exp - today)/(1000*60*60*24)) : null;
        if (days !== null && days <= warningDays && days > 0) expiring.push(`<li>${m.name} – ${days} days</li>`);
        else if (days !== null && days < 0) expired.push(`<li>${m.name} – EXPIRED</li>`);
        if (m.stock < 5) low.push(`<li>${m.name} – ${m.stock} left</li>`);
    });
    if (expiring.length || expired.length || low.length) {
        if (expiring.length) html += `<p style="color:orange;">⚠️ Expiring Soon:</p><ul>${expiring.join('')}</ul>`;
        if (expired.length) html += `<p style="color:red;">❌ Expired:</p><ul>${expired.join('')}</ul>`;
        if (low.length) html += `<p style="color:red;">📉 Low Stock:</p><ul>${low.join('')}</ul>`;
    } else html += '<p>✅ All in good standing.</p>';
    return html;
}

function getAdminVerifContent() {
    const reqs = getVerificationRequests().filter(r => r.status === 'pending');
    let html = '<h4>🔔 Pending Verifications</h4>';
    if (!reqs.length) html += '<p>No pending requests.</p>';
    else {
        html += '<ul style="list-style:none;padding:0;">';
        reqs.forEach(r => html += `<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ddd;">
            <span>${r.userName} (${r.userEmail})</span>
            <div><button class="btn btn-success btn-xs" onclick="approveVerification('${r.userId}')">✅</button>
                 <button class="btn btn-danger btn-xs" onclick="rejectVerification('${r.userId}')">❌</button></div>
        </li>`);
        html += '</ul>';
    }
    return html;
}

function getUserMedsContent() {
    const meds = getDailyMeds().filter(d => d.userId === currentUser.id);
    let html = '<h4>💊 Your Medications</h4>';
    if (!meds.length) html += '<p>No medications.</p>';
    else {
        html += '<ul style="list-style:none;padding:0;">';
        meds.forEach(m => html += `<li style="padding:6px 0;display:flex;justify-content:space-between;"><span>${m.name} – ${m.dosageInfo} (${m.timeOfDay})</span><span>${m.takenToday ? '✅' : '⭕'}</span></li>`);
        html += '</ul>';
    }
    return html;
}

function getUserAppointmentsContent() {
    const today = new Date().toISOString().split('T')[0];
    const apps = getAppointments().filter(a => a.userId === currentUser.id && a.date >= today);
    let html = '<h4>📅 Upcoming Appointments</h4>';
    if (!apps.length) html += '<p>No upcoming appointments.</p>';
    else { html += '<ul style="list-style:none;padding:0;">'; apps.forEach(a => html += `<li style="padding:6px 0;">📅 ${a.date} at ${a.time} – ${a.reason}</li>`); html += '</ul>'; }
    return html;
}

function getUserOrdersContent() {
    const orders = getOrders().filter(o => o.userId === currentUser.id).slice(-5);
    let html = '<h4>📦 Recent Orders</h4>';
    if (!orders.length) html += '<p>No orders.</p>';
    else { html += '<ul style="list-style:none;padding:0;">'; orders.forEach(o => html += `<li style="padding:6px 0;">Order #${o.id} – ₱${o.total.toFixed(2)} – ${o.status}</li>`); html += '</ul>'; }
    return html;
}

function getSellerOrderContent() {
    const orders = getOrders();
    const recent = orders.slice(-5).reverse();
    let html = '<h4>📦 Recent Orders</h4>';
    if (!recent.length) { html += '<p>No orders yet.</p>'; }
    else {
        html += '<ul style="list-style:none; padding:0;">';
        recent.forEach(o => {
            html += `<li style="padding:6px 0; border-bottom:1px solid #ddd;">
                <strong>Order #${o.id}</strong> – ${o.userName}<br>
                ${o.items.map(i => i.name + ' x' + i.quantity).join(', ')}<br>
                Total: ₱${o.total.toFixed(2)} – ${o.status}
            </li>`;
        });
        html += '</ul>';
    }
    newOrderCount = 0;
    updateNotifBadge();
    return html;
}

function getDoctorApptContent() {
    const apps = getAppointments();
    const upcoming = apps.filter(a => a.date >= new Date().toISOString().split('T')[0]).slice(-10);
    let html = '<h4>📅 Upcoming Appointments</h4>';
    if (!upcoming.length) html += '<p>No upcoming appointments.</p>';
    else {
        html += '<ul style="list-style:none;padding:0;">';
        upcoming.forEach(a => html += `<li style="padding:6px 0; border-bottom:1px solid #ddd;">
            📅 ${a.date} at ${a.time} – ${a.reason} (User: ${a.userName || a.userId})</li>`);
        html += '</ul>';
    }
    return html;
}

function getUserVerificationContent() {
    const key = `verifUpdate_${currentUser.id}`;
    const status = localStorage.getItem(key);
    let html = '<h4>🔔 Verification Status</h4>';
    if (!status) {
        html += '<p>No updates.</p>';
    } else {
        if (status === 'approved') {
            html += '<p>✅ Your account has been **verified**! You can now use all features.</p>';
        } else {
            html += '<p>❌ Your verification was **rejected**. Please update your profile and try again.</p>';
        }
        // Clear the notification after viewing
        localStorage.removeItem(key);
        updateNotifBadge();
    }
    return html;
}

// ---------- NAVIGATION ----------
function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');
    document.querySelectorAll('#navLinks a').forEach(a => a.classList.remove('active'));
    const navLink = document.querySelector(`#navLinks a[data-page="${page}"]`);
    if (navLink) navLink.classList.add('active');
    if (page === 'medicine') renderMedicineGrid();
    if (page === 'dashboard') renderDashboard();
    if (page === 'home') loadHomeDoctors();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadHomeDoctors() {
    const grid = document.getElementById('doctorsGridHome');
    if (!grid) return;
    const doctors = await getDoctorsFromFirestore();
    if (!doctors.length) { grid.innerHTML = '<p style="color:var(--text-light);">No doctors available.</p>'; return; }
    grid.innerHTML = doctors.map(d => `
        <div class="doctor-card">
            <img src="${d.image || 'https://via.placeholder.com/100'}" alt="Dr. ${d.name}">
            <h3>${d.name}</h3>
            <p style="color:var(--primary);">${d.specialty}</p>
            <p>${d.bio || ''}</p>
        </div>`).join('');
}

function openDashboard() {
    if (!currentUser) { openLoginModal(); return; }
    navigateTo('dashboard');
    renderDashboard();
}

// ---------- MEDICINE GRID (public) ----------
async function renderMedicineGrid() {
    const grid = document.getElementById('medicineGrid');
    if (!grid) return;
    const medicines = await getMedicinesFromFirestore();
    const searchTerm = (document.getElementById('medicineSearch')?.value || '').toLowerCase();
    const categoryFilter = document.getElementById('medicineCategoryFilter')?.value || 'all';
    let filtered = medicines;
    if (searchTerm) filtered = filtered.filter(m => m.name.toLowerCase().includes(searchTerm) || m.category.toLowerCase().includes(searchTerm) || m.manufacturer.toLowerCase().includes(searchTerm));
    if (categoryFilter !== 'all') filtered = filtered.filter(m => m.category === categoryFilter);
    if (!filtered.length) { grid.innerHTML = '<p style="text-align:center;padding:40px;">No medicines found.</p>'; return; }
    grid.innerHTML = filtered.map(m => `
        <div class="medicine-card" style="cursor:pointer;" onclick="viewMedicineDetail('${m.id}')">
            <div class="medicine-card-header"><div class="medicine-card-icon">${m.icon || '💊'}</div></div>
            <div class="medicine-card-body">
                <h3>${m.name}</h3>
                <div class="medicine-info-row">
                    <span class="medicine-tag">📂 ${m.category}</span>
                    <span class="medicine-tag">🏭 ${m.manufacturer}</span>
                </div>
                <p style="font-size:0.85rem;">📋 <strong>Dosage:</strong> ${m.dosage}</p>
                <p style="font-size:0.85rem;">👤 <strong>Who can take:</strong> ${m.whoCanTake}</p>
                <div class="medicine-price">₱${m.price.toFixed(2)}</div>
                <p style="color:${m.stock < 5 ? 'red' : 'inherit'}">📦 Stock: ${m.stock ?? 'N/A'}</p>
            </div>
            <div class="medicine-card-footer">
                ${currentUser && currentUser.role === 'user' && m.stock > 0 ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); addToCart('${m.id}')">🛒 Add to Cart</button>` : ''}
                ${!currentUser ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openLoginModal()">🔐 Login to Buy</button>` : ''}
            </div>
        </div>`).join('');
}

// ---------- MEDICINE DETAIL & CART ----------
function viewMedicineDetail(id) {
    getMedicinesFromFirestore().then(meds => {
        const m = meds.find(med => med.id == id);
        if (!m) return;
        const modal = document.getElementById('medicineDetailModal');
        const content = document.getElementById('medicineDetailContent');
        content.innerHTML = `
            <button class="close-modal" onclick="closeMedicineDetail()">✕</button>
            <div style="text-align:center;font-size:4rem;">${m.icon || '💊'}</div>
            <h2>${m.name}</h2>
            <p><span class="medicine-tag">${m.category}</span> <span class="medicine-tag">${m.manufacturer}</span></p>
            <div style="background:var(--accent);padding:16px;border-radius:8px;">
                <p><strong>📋 Dosage:</strong> ${m.dosage}</p>
                <p><strong>👤 Who Can Take:</strong> ${m.whoCanTake}</p>
                <p><strong>⚠️ Side Effects:</strong> ${m.sideEffects}</p>
                <p><strong>📅 Expiration:</strong> ${m.expirationDate || 'N/A'}</p>
                <p><strong>📦 Stock:</strong> ${m.stock ?? 'N/A'}</p>
            </div>
            <p>${m.description}</p>
            <p style="font-size:1.4rem;font-weight:700;color:var(--secondary);">₱${m.price.toFixed(2)}</p>
            ${currentUser && currentUser.role === 'user' && m.stock > 0 ? `<button class="btn btn-primary" style="width:100%;" onclick="addToCart('${m.id}');closeMedicineDetail();">🛒 Add to Cart</button>` : ''}
            ${!currentUser ? `<button class="btn btn-outline" style="width:100%;" onclick="openLoginModal();closeMedicineDetail();">🔐 Login to Purchase</button>` : ''}
        `;
        modal.classList.add('show');
    });
}
function closeMedicineDetail() { document.getElementById('medicineDetailModal').classList.remove('show'); }
document.getElementById('medicineDetailModal').addEventListener('click', function(e) { if (e.target === this) closeMedicineDetail(); });

function addToCart(medicineId) {
    let cart = getCart();
    getMedicinesFromFirestore().then(meds => {
        const med = meds.find(m => m.id == medicineId);
        if (!med) return;
        const existing = cart.find(c => c.medicineId == medicineId);
        if (existing) existing.quantity += 1;
        else cart.push({ medicineId, quantity: 1, price: med.price, name: med.name });
        saveCart(cart);
        updateCartCount();
        showNotification(`${med.name} added to cart!`, 'success', false);
    });
}
function updateCartCount() {
    const cart = getCart();
    document.getElementById('cartCount').textContent = cart.reduce((s,c) => s + c.quantity, 0);
    document.getElementById('cartIconWrapper').style.display = (currentUser && currentUser.role === 'user') ? 'inline-flex' : 'none';
}
function openCartModal() {
    const cart = getCart();
    const container = document.getElementById('cartItemsContainer');
    const totalEl = document.getElementById('cartTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (!cart.length) {
        container.innerHTML = '<p style="text-align:center;">Your cart is empty.</p>';
        totalEl.style.display = 'none';
        checkoutBtn.style.display = 'none';
    } else {
        let total = 0;
        container.innerHTML = cart.map((c,i) => { total += c.price * c.quantity; return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #ddd;"><div><strong>${c.name}</strong> x${c.quantity}</div><div style="display:flex;gap:8px;"><span>₱${(c.price*c.quantity).toFixed(2)}</span><button class="btn btn-danger btn-xs" onclick="removeCartItem(${i})">✕</button></div></div>`; }).join('');
        totalEl.textContent = `Total: ₱${total.toFixed(2)}`;
        totalEl.style.display = 'block';
        checkoutBtn.style.display = 'block';
        checkoutBtn.onclick = openCheckoutModal;
    }
    document.getElementById('cartModal').classList.add('show');
}
function closeCartModal() { document.getElementById('cartModal').classList.remove('show'); }
function removeCartItem(index) { let cart = getCart(); cart.splice(index,1); saveCart(cart); updateCartCount(); openCartModal(); }

// ---------- CHECKOUT MODAL ----------
function openCheckoutModal() {
    closeCartModal();
    const cart = getCart();
    if (!cart.length) return;
    const total = cart.reduce((s,c) => s + c.price * c.quantity, 0);
    const modal = document.getElementById('checkoutModal');
    const content = document.getElementById('checkoutContent');
    const gcash = currentUser?.paymentGCash || '';
    const gcashQR = currentUser?.paymentGCashQR || '';
    const bankName = currentUser?.paymentBankName || '';
    const bankAccount = currentUser?.paymentBankAccount || '';
    content.innerHTML = `
        <div style="margin-bottom:20px;"><h4>Order Summary</h4>
            ${cart.map(c => `<div style="display:flex;justify-content:space-between;margin:6px 0;"><span>${c.name} x${c.quantity}</span><span>₱${(c.price*c.quantity).toFixed(2)}</span></div>`).join('')}
            <div style="font-size:1.2rem;font-weight:700;margin-top:10px;">Total: ₱${total.toFixed(2)}</div>
        </div>
        <h4>💳 Payment Method</h4>
        <div class="form-group"><label><input type="radio" name="paymentMethod" value="gcas" checked onchange="togglePaymentFields()"> GCash</label>
            <div id="gcasFields" style="margin-top:8px;"><p><strong>GCash Number:</strong> ${gcash || 'Not set'}</p>${gcashQR ? `<p><img src="${gcashQR}" style="max-width:150px;"/></p>` : ''}</div>
        </div>
        <div class="form-group"><label><input type="radio" name="paymentMethod" value="bank" onchange="togglePaymentFields()"> Bank Transfer</label>
            <div id="bankFields" style="display:none;margin-top:8px;"><p><strong>Bank:</strong> ${bankName || 'Not set'}</p><p><strong>Account:</strong> ${bankAccount || 'Not set'}</p></div>
        </div>
        <div style="margin-top:15px;"><button class="btn btn-success" style="width:100%;" onclick="placeOrder()">📦 Place Order</button>
        <button class="btn btn-outline" style="width:100%;margin-top:8px;" onclick="closeCheckoutModal()">Cancel</button></div>`;
    modal.classList.add('show');
}
function togglePaymentFields() {
    const method = document.querySelector('input[name="paymentMethod"]:checked')?.value;
    document.getElementById('gcasFields').style.display = method === 'gcas' ? 'block' : 'none';
    document.getElementById('bankFields').style.display = method === 'bank' ? 'block' : 'none';
}
function closeCheckoutModal() { document.getElementById('checkoutModal').classList.remove('show'); }

function placeOrder() {
    const cart = getCart();
    const total = cart.reduce((s,c) => s + c.price * c.quantity, 0);
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'gcas';
    const orders = getOrders();
    orders.push({ id: Date.now(), userId: currentUser.id, userName: currentUser.fullName, items: JSON.parse(JSON.stringify(cart)), total, paymentMethod, date: new Date().toISOString(), status: 'Confirmed' });
    saveOrders(orders);
    newOrderCount++;
    updateNotifBadge();
    saveCart([]);
    updateCartCount();
    closeCheckoutModal();
    showNotification('🎉 Order placed!', 'success', false);
}

// ---------- ACCOUNT BUTTON & DROPDOWN ----------
function updateAccountUI() {
    const wrapper = document.getElementById('userActionWrapper');
    if (!wrapper) return;
    if (currentUser) {
        const roleNames = { owner: 'Owner', staff: 'Staff', seller: 'Seller', doctor: 'Doctor', user: (currentUser.fullName?.split(' ')[0] || 'User') };
        const displayName = roleNames[currentUser.role] || currentUser.fullName?.split(' ')[0] || 'User';
        wrapper.innerHTML = `<button class="btn btn-outline btn-sm" id="accountBtn" onclick="toggleAccountDropdown()">👤 ${displayName} ▾</button>
            <div class="user-menu-dropdown" id="accountDropdown">
                <a href="#" onclick="goToMyAccount()">📋 My Account</a>
                <a href="#" onclick="goToSettings()">⚙️ Settings</a>
                <button onclick="confirmLogout()">🚪 Logout</button></div>`;
    } else {
        wrapper.innerHTML = `<button class="btn btn-primary" id="accountBtn" onclick="openLoginModal()">🔐 Login</button>`;
    }
}
function toggleAccountDropdown() { const d = document.getElementById('accountDropdown'); if (d) d.classList.toggle('show'); }
function closeAccountDropdown() { const d = document.getElementById('accountDropdown'); if (d) d.classList.remove('show'); }
document.addEventListener('click', e => { const w = document.getElementById('userActionWrapper'); if (w && !w.contains(e.target)) closeAccountDropdown(); });
function goToMyAccount() { closeAccountDropdown(); navigateTo('dashboard'); }
function goToSettings() { closeAccountDropdown(); navigateTo('dashboard'); switchDashboardTab('settings'); }

// ---------- LOGIN / REGISTER ----------
function openLoginModal() {
    document.getElementById('loginModal').classList.add('show');
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginFormFields').style.display = 'block';
    document.getElementById('rememberMe').checked = rememberMe;
}
function closeLoginModal() { document.getElementById('loginModal').classList.remove('show'); }
function switchToRegister() {
    document.getElementById('loginFormFields').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}
function switchToLogin() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginFormFields').style.display = 'block';
}
async function handleLogin() {
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const remember = document.getElementById('rememberMe').checked;
    if (!identifier || !password) { showNotification('Fill all fields.', 'error', false); return; }
    const db = window.db;
    if (!db) { showNotification('Firebase not ready.', 'error', false); return; }
    const usersRef = firebaseCollection(db, "users");
    const q = firebaseQuery(usersRef, firebaseWhere("email", "==", identifier));
    const snapshot = await firebaseGetDocs(q);
    if (snapshot.empty) { showNotification('Invalid credentials.', 'error', false); return; }
    const userDoc = snapshot.docs[0], userData = userDoc.data();
    if (userData.password !== password) { showNotification('Invalid credentials.', 'error', false); return; }
    if (userData.isAdmin && !userData.role) userData.role = 'owner';
    currentUser = { ...userData, id: userDoc.id };
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    if (remember) localStorage.setItem('rememberMe', 'true'); else localStorage.removeItem('rememberMe');
    rememberMe = remember;
    closeLoginModal();
    updateUIForLogin();
    showWelcomePopup(`Welcome, ${currentUser.fullName}!`);
    navigateTo('home');
}
async function registerUser(role = null, isOwnerAction = false) {
    const fullName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const confirmPassword = document.getElementById('regConfirmPassword').value.trim();
    let selectedRole = isOwnerAction ? (document.getElementById('regRole')?.value || 'user') : role;
    if (!fullName || !email || !password || !confirmPassword) { showNotification('All fields required.', 'error', false); return; }
    if (password !== confirmPassword) { showNotification('Passwords do not match.', 'error', false); return; }
    if (password.length < 4) { showNotification('Password too short.', 'error', false); return; }
    const db = window.db;
    if (!db) { showNotification('Firebase not available.', 'error', false); return; }
    const usersRef = firebaseCollection(db, "users");
    if (!isOwnerAction) {
        const allSnap = await firebaseGetDocs(usersRef);
        selectedRole = allSnap.empty ? 'owner' : 'user';
    }
    const q = firebaseQuery(usersRef, firebaseWhere("email", "==", email));
    if (!(await firebaseGetDocs(q)).empty) { showNotification('Email already registered.', 'error', false); return; }
    const newUser = { fullName, email, password, phone: '', address: '', verified: false, paymentGCash: '', paymentGCashQR: '', paymentBankName: '', paymentBankAccount: '', role: selectedRole, createdAt: new Date().toISOString() };
    const docRef = await firebaseAddDoc(usersRef, newUser);
    if (!isOwnerAction) {
        currentUser = { ...newUser, id: docRef.id };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        closeLoginModal();
        updateUIForLogin();
        showWelcomePopup(`Welcome, ${fullName}!`);
        navigateTo('home');
    } else {
        closeAddUserModal();
        showNotification('User created!', 'success', false);
        renderAdminTab('users');
    }
}

// ---------- FORGOT PASSWORD ----------
function forgotPassword() {
    document.getElementById('forgotPasswordModal').classList.add('show');
    document.getElementById('forgotStep1').style.display = 'block';
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotError').style.display = 'none';
    document.getElementById('forgotNewPassword').value = '';
    document.getElementById('forgotConfirmPassword').value = '';
    document.getElementById('forgotError2').style.display = 'none';
}
function closeForgotPasswordModal() { document.getElementById('forgotPasswordModal').classList.remove('show'); }
async function checkForgotEmail() {
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) { document.getElementById('forgotError').textContent = 'Please enter your email.'; document.getElementById('forgotError').style.display = 'block'; return; }
    const db = window.db;
    if (!db) { document.getElementById('forgotError').textContent = 'Firebase not ready. Try again shortly.'; document.getElementById('forgotError').style.display = 'block'; return; }
    const usersRef = firebaseCollection(db, "users");
    const q = firebaseQuery(usersRef, firebaseWhere("email", "==", email));
    const snapshot = await firebaseGetDocs(q);
    if (snapshot.empty) { document.getElementById('forgotError').textContent = 'Email not found. Please register first.'; document.getElementById('forgotError').style.display = 'block'; return; }
    window._forgotUserId = snapshot.docs[0].id;
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
}
async function resetPassword() {
    const newPassword = document.getElementById('forgotNewPassword').value.trim();
    const confirmPassword = document.getElementById('forgotConfirmPassword').value.trim();
    if (!newPassword || !confirmPassword) { document.getElementById('forgotError2').textContent = 'Please fill in both fields.'; document.getElementById('forgotError2').style.display = 'block'; return; }
    if (newPassword !== confirmPassword) { document.getElementById('forgotError2').textContent = 'Passwords do not match.'; document.getElementById('forgotError2').style.display = 'block'; return; }
    if (newPassword.length < 4) { document.getElementById('forgotError2').textContent = 'Password must be at least 4 characters.'; document.getElementById('forgotError2').style.display = 'block'; return; }
    const db = window.db;
    if (!db || !window._forgotUserId) return;
    const userRef = firebaseDoc(db, "users", window._forgotUserId);
    await firebaseUpdateDoc(userRef, { password: newPassword });
    closeForgotPasswordModal();
    showNotification('✅ Password changed successfully! You can now log in.', 'success', false);
}

function confirmLogout() { closeAccountDropdown(); document.getElementById('logoutConfirmModal').classList.add('show'); }
function closeLogoutConfirm() { document.getElementById('logoutConfirmModal').classList.remove('show'); }
function finalLogout() {
    closeLogoutConfirm(); closeAccountDropdown();
    currentUser = null; localStorage.removeItem('currentUser'); localStorage.removeItem('rememberMe');
    saveCart([]); updateUIForLogout(); navigateTo('home');
    showNotification('Logged out.', 'info', false);
}

// ---------- UI STATE ----------
function updateUIForLogin() {
    updateAccountUI();
    document.getElementById('cartIconWrapper').style.display = (currentUser?.role === 'user') ? 'inline-flex' : 'none';
    // Show bell for ALL logged-in users
    document.getElementById('notificationBellWrapper').style.display = 'inline-flex';
    document.getElementById('navDashboard').style.display = 'list-item';
    updateCartCount(); updateNotifBadge();
}
function updateUIForLogout() {
    updateAccountUI();
    document.getElementById('cartIconWrapper').style.display = 'none';
    document.getElementById('notificationBellWrapper').style.display = 'none';
    document.getElementById('navDashboard').style.display = 'none';
    document.getElementById('cartCount').textContent = '0';
    document.getElementById('notifBadge').style.display = 'none';
}

// ---------- DASHBOARD (Role-based sidebar) ----------
function renderDashboard() {
    const sidebar = document.getElementById('dashboardSidebar');
    const role = currentUser?.role || 'user';
    let sidebarHTML = '';
    if (role === 'owner') {
        sidebarHTML = `<button class="active-tab" onclick="switchDashboardTab('medicines')">💊 Inventory Management</button>
            <button onclick="switchDashboardTab('users')">👥 Manage Users</button>
            <button onclick="openAddUserModal()" class="btn btn-sm btn-outline" style="margin:8px 20px;">➕ Add Staff/User</button>
            <button onclick="switchDashboardTab('orders')">📦 View Orders</button>
            <button onclick="switchDashboardTab('verifications')">🔔 Verify Users</button>
            <button onclick="switchDashboardTab('doctors')">👨‍⚕️ Manage Doctors</button>
            <button onclick="switchDashboardTab('adminSettings')">⚙️ Settings</button>
            <button onclick="confirmLogout()" style="color:var(--danger);">🚪 Logout</button>`;
    } else if (role === 'staff') {
        sidebarHTML = `<button class="active-tab" onclick="switchDashboardTab('medicines')">💊 Manage Inventory</button>
            <button onclick="switchDashboardTab('orders')">📦 View Orders</button>
            <button onclick="switchDashboardTab('doctors')">👨‍⚕️ View Doctors</button>
            <button onclick="switchDashboardTab('staffSettings')">⚙️ Settings</button>
            <button onclick="confirmLogout()" style="color:var(--danger);">🚪 Logout</button>`;
    } else if (role === 'seller') {
        sidebarHTML = `<button class="active-tab" onclick="switchDashboardTab('orders')">📦 Manage Orders</button>
            <button onclick="switchDashboardTab('sellerSettings')">⚙️ Settings</button>
            <button onclick="confirmLogout()" style="color:var(--danger);">🚪 Logout</button>`;
    } else if (role === 'doctor') {
        sidebarHTML = `<button class="active-tab" onclick="switchDashboardTab('appointments')">📅 Appointments</button>
            <button onclick="switchDashboardTab('patientMeds')">💊 Patient Medications</button>
            <button onclick="switchDashboardTab('doctorSettings')">⚙️ Settings</button>
            <button onclick="confirmLogout()" style="color:var(--danger);">🚪 Logout</button>`;
    } else {
        sidebarHTML = `<button class="active-tab" onclick="switchDashboardTab('overview')">📊 Overview</button>
            <button onclick="switchDashboardTab('dailyMeds')">💊 Daily Medications</button>
            <button onclick="switchDashboardTab('appointments')">📅 Appointments</button>
            <button onclick="switchDashboardTab('myOrders')">📦 My Orders</button>
            <button onclick="switchDashboardTab('settings')">⚙️ Settings</button>
            <button onclick="confirmLogout()" style="color:var(--danger);">🚪 Logout</button>`;
    }
    sidebar.innerHTML = sidebarHTML;
    const defaultTab = role === 'owner' ? 'medicines' : role === 'staff' ? 'medicines' : role === 'seller' ? 'orders' : role === 'doctor' ? 'appointments' : 'overview';
    switchDashboardTab(defaultTab);
}

function switchDashboardTab(tab) {
    const sidebar = document.getElementById('dashboardSidebar');
    sidebar.querySelectorAll('button').forEach(b => b.classList.remove('active-tab'));
    const activeBtn = [...sidebar.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes(tab.toLowerCase()));
    if (activeBtn) activeBtn.classList.add('active-tab');
    const role = currentUser?.role || 'user';
    if (role === 'owner') renderAdminTab(tab);
    else if (role === 'staff') renderStaffTab(tab);
    else if (role === 'seller') renderSellerTab(tab);
    else if (role === 'doctor') renderDoctorTab(tab);
    else renderUserTab(tab);
}

// ---------- OWNER TABS (Full CRUD) ----------
async function renderAdminTab(tab) {
    const content = document.getElementById('dashboardContent');
    if (tab === 'medicines') {
        const meds = await getMedicinesFromFirestore();
        const today = new Date();
        const sorted = [...meds].sort((a,b) => (a.name||'').localeCompare(b.name||''));
        content.innerHTML = `<h2>💊 Manage Medicines</h2>
            <button class="btn btn-success btn-sm" onclick="showAddMedicineForm()">➕ Add New Medicine</button>
            <div id="adminMedicineForm" style="display:none; background:var(--accent); padding:16px; border-radius:8px; margin:12px 0;"></div>
            <div class="table-wrapper"><table>
                <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Expiration</th><th>Actions</th></tr></thead>
                <tbody>${sorted.map(m => {
                    const exp = m.expirationDate ? new Date(m.expirationDate) : null;
                    const days = exp ? Math.ceil((exp - today)/(1000*60*60*24)) : null;
                    let expStyle = '', expText = m.expirationDate || 'N/A';
                    if (days !== null && days <= 30 && days > 0) expStyle = 'color:orange;font-weight:bold';
                    if (days !== null && days < 0) expStyle = 'color:red;font-weight:bold';
                    const stockStyle = m.stock < 5 ? 'color:red;font-weight:bold' : '';
                    return `<tr><td>${m.name}</td><td>${m.category}</td><td>₱${m.price.toFixed(2)}</td><td style="${stockStyle}">${m.stock ?? 0}</td><td style="${expStyle}">${expText}</td><td class="actions-cell"><button class="btn btn-outline btn-xs" onclick="editMedicine('${m.id}')">✏️</button><button class="btn btn-danger btn-xs" onclick="deleteMedicine('${m.id}')">🗑️</button></td></tr>`;
                }).join('')}</tbody></table></div>`;
    } else if (tab === 'users') {
        const db = window.db;
        if (!db) { content.innerHTML = '<p>Firebase unavailable.</p>'; return; }
        const usersRef = firebaseCollection(db, "users");
        const snapshot = await firebaseGetDocs(usersRef);
        const users = []; snapshot.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
        content.innerHTML = `<h2>👥 Manage Users</h2>
            <div class="table-wrapper"><table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Verified</th></tr></thead>
                <tbody>${users.map(u => `<tr><td>${u.fullName}</td><td>${u.email}</td><td>${u.role || 'user'}</td><td>${u.verified ? '✅' : '❌'}</td></tr>`).join('')}</tbody></table></div>`;
    } else if (tab === 'orders') {
        const orders = getOrders();
        content.innerHTML = `<h2>📦 Orders</h2>${orders.length === 0 ? '<p>No orders.</p>' : `<div class="table-wrapper"><table><thead><tr><th>ID</th><th>User</th><th>Items</th><th>Total</th><th>Date</th><th>Status</th></tr></thead><tbody>${orders.map(o => `<tr><td>#${o.id}</td><td>${o.userName}</td><td>${o.items.map(i=>i.name+' x'+i.quantity).join(', ')}</td><td>₱${o.total.toFixed(2)}</td><td>${new Date(o.date).toLocaleDateString()}</td><td>${o.status}</td></tr>`).join('')}</tbody></table></div>`}`;
    } else if (tab === 'verifications') {
        const reqs = getVerificationRequests();
        content.innerHTML = `<h2>🔔 Verification Requests</h2>${reqs.filter(r => r.status === 'pending').length === 0 ? '<p>No pending requests.</p>' : `<div class="table-wrapper"><table><thead><tr><th>User</th><th>Email</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${reqs.filter(r => r.status === 'pending').map(r => `<tr><td>${r.userName}</td><td>${r.userEmail}</td><td>${new Date(r.date).toLocaleDateString()}</td><td>${r.status}</td><td class="actions-cell"><button class="btn btn-success btn-xs" onclick="approveVerification('${r.userId}')">✅</button><button class="btn btn-danger btn-xs" onclick="rejectVerification('${r.userId}')">❌</button></td></tr>`).join('')}</tbody></table></div>`}`;
    } else if (tab === 'doctors') {
        const doctors = await getDoctorsFromFirestore();
        content.innerHTML = `<h2>👨‍⚕️ Manage Doctors</h2><button class="btn btn-success btn-sm" onclick="showAddDoctorForm()">➕ Add Doctor</button><div id="adminDoctorForm" style="display:none; background:var(--accent); padding:16px; border-radius:8px; margin:12px 0;"></div><div class="doctors-grid" style="margin-top:16px;">${doctors.length === 0 ? '<p>No doctors.</p>' : doctors.map(d => `<div class="doctor-card"><img src="${d.image || 'https://via.placeholder.com/100'}" alt="${d.name}"><h3>${d.name}</h3><p style="color:var(--primary);">${d.specialty}</p><p>${d.bio || ''}</p><div style="margin-top:8px;"><button class="btn btn-outline btn-xs" onclick="editDoctor('${d.id}')">✏️</button><button class="btn btn-danger btn-xs" onclick="deleteDoctor('${d.id}')">🗑️</button></div></div>`).join('')}</div>`;
    } else if (tab === 'adminSettings') {
        content.innerHTML = `<h2>⚙️ Owner Settings</h2><p>Full access.</p>`;
    }
}

// ---------- STAFF TABS ----------
async function renderStaffTab(tab) {
    const content = document.getElementById('dashboardContent');
    if (tab === 'medicines') { await renderAdminTab('medicines'); }
    else if (tab === 'orders') { const orders = getOrders(); content.innerHTML = `<h2>📦 Orders</h2>${orders.length ? `<div class="table-wrapper"><table>...</table></div>` : '<p>No orders.</p>'}`; }
    else if (tab === 'doctors') { const doctors = await getDoctorsFromFirestore(); content.innerHTML = `<h2>👨‍⚕️ Doctors</h2><div class="doctors-grid">${doctors.map(d => `<div class="doctor-card"><img src="${d.image || 'https://via.placeholder.com/100'}" alt="${d.name}"><h3>${d.name}</h3><p style="color:var(--primary);">${d.specialty}</p><p>${d.bio||''}</p></div>`).join('')}</div>`; }
    else if (tab === 'staffSettings') { content.innerHTML = `<h2>⚙️ Staff Settings</h2><p>Staff panel.</p>`; }
}

// ---------- SELLER TABS ----------
function renderSellerTab(tab) {
    const content = document.getElementById('dashboardContent');
    if (tab === 'orders') {
        const orders = getOrders();
        content.innerHTML = `<h2>📦 Orders</h2>${orders.length ? `<div class="table-wrapper"><table>...</table></div>` : '<p>No orders.</p>'}`;
        newOrderCount = 0;
        updateNotifBadge();
    } else if (tab === 'sellerSettings') { content.innerHTML = `<h2>⚙️ Seller Settings</h2><p>Seller panel.</p>`; }
}

// ---------- DOCTOR TABS ----------
function renderDoctorTab(tab) {
    const content = document.getElementById('dashboardContent');
    if (tab === 'appointments') {
        const apps = getAppointments();
        content.innerHTML = `<h2>📅 All Appointments</h2>${apps.length ? apps.map(a => `<div style="background:white;border:1px solid #ddd;padding:12px;margin-bottom:8px;"><strong>${a.date} at ${a.time}</strong> – ${a.reason} (User: ${a.userName || a.userId})</div>`).join('') : '<p>No appointments.</p>'}`;
    } else if (tab === 'patientMeds') {
        const allMeds = getDailyMeds();
        content.innerHTML = `<h2>💊 Patient Medications</h2>${allMeds.length ? allMeds.map(m => `<div style="background:white;border:1px solid #ddd;padding:12px;margin-bottom:8px;"><strong>${m.name}</strong> – ${m.dosageInfo} (${m.timeOfDay}) – User: ${m.userId}</div>`).join('') : '<p>No medications.</p>'}`;
    } else if (tab === 'doctorSettings') {
        content.innerHTML = `<h2>⚙️ Doctor Settings</h2><p>Doctor panel.</p>`;
    }
}

// ---------- USER TABS (full) ----------
function renderUserTab(tab) {
    const content = document.getElementById('dashboardContent');
    if (!currentUser) return;
    if (tab === 'overview') {
        const orders = getOrders().filter(o => o.userId === currentUser.id);
        const apps = getAppointments().filter(a => a.userId === currentUser.id);
        const dm = getDailyMeds().filter(d => d.userId === currentUser.id);
        content.innerHTML = `<h2>📊 Welcome, ${currentUser.fullName}</h2>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-number">${orders.length}</div><div class="stat-label">Orders</div></div>
                <div class="stat-card"><div class="stat-number">${apps.length}</div><div class="stat-label">Appointments</div></div>
                <div class="stat-card"><div class="stat-number">${dm.length}</div><div class="stat-label">Medications</div></div>
                <div class="stat-card"><div class="stat-number">${currentUser.verified ? '✅' : '❌'}</div><div class="stat-label">Verified</div></div>
            </div>`;
    } else if (tab === 'dailyMeds') {
        const dailyMeds = getDailyMeds().filter(d => d.userId === currentUser.id);
        content.innerHTML = `<h2>💊 Daily Medications</h2>
            <button class="btn btn-success btn-sm" onclick="showAddDailyMedForm()">➕ Add Medication</button>
            <div id="dailyMedForm" style="display:none;background:var(--accent);padding:16px;border-radius:8px;margin:12px 0;"></div>
            ${dailyMeds.length === 0 ? '<p>No medications yet.</p>' : dailyMeds.map(dm => `
                <div style="background:white;border:1px solid #ddd;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div>
                        <strong>${dm.name}</strong> | ${dm.timeOfDay} | ${dm.dosageInfo}
                        ${dm.prescription ? `<br><small>📝 <em>Prescription:</em> ${dm.prescription}</small>` : ''}
                        ${dm.reminderTime ? `<br><small>⏰ Reminder: ${dm.reminderTime}</small>` : ''}
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="btn btn-xs ${dm.takenToday ? 'btn-success' : 'btn-outline'}" onclick="toggleDailyMedTaken(${dm.id})">${dm.takenToday ? '✅ Taken' : '⭕ Mark Taken'}</button>
                        <button class="btn btn-danger btn-xs" onclick="deleteDailyMed(${dm.id})">🗑️</button>
                    </div>
                </div>`).join('')}
        `;
    } else if (tab === 'appointments') {
        const apps = getAppointments().filter(a => a.userId === currentUser.id);
        content.innerHTML = `<h2>📅 Appointments</h2><button class="btn btn-success btn-sm" onclick="showScheduleAppointmentForm()">➕ Schedule</button>
            <div id="appointmentForm" style="display:none;background:var(--accent);padding:16px;border-radius:8px;margin:12px 0;"></div>
            ${apps.length === 0 ? '<p>No appointments.</p>' : apps.map(a => `
                <div style="background:white;border:1px solid #ddd;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;">
                    <div><strong>📅 ${a.date}</strong> at ${a.time} | ${a.reason}</div>
                    <button class="btn btn-danger btn-xs" onclick="cancelAppointment(${a.id})">Cancel</button>
                </div>`).join('')}`;
    } else if (tab === 'myOrders') {
        const orders = getOrders().filter(o => o.userId === currentUser.id);
        content.innerHTML = `<h2>📦 My Orders</h2>${orders.length === 0 ? '<p>No orders.</p>' : `<div class="table-wrapper"><table><thead><tr><th>ID</th><th>Items</th><th>Total</th><th>Date</th><th>Status</th></tr></thead><tbody>${orders.map(o => `<tr><td>#${o.id}</td><td>${o.items.map(i=>i.name+' x'+i.quantity).join(', ')}</td><td>₱${o.total.toFixed(2)}</td><td>${new Date(o.date).toLocaleDateString()}</td><td>${o.status}</td></tr>`).join('')}</tbody></table></div>`}`;
    } else if (tab === 'settings') {
        content.innerHTML = `<h2>⚙️ Account Settings</h2>
            <div class="form-group"><label>Full Name</label><input id="setFullName" value="${currentUser.fullName || ''}"></div>
            <div class="form-group"><label>Email</label><input id="setEmail" value="${currentUser.email || ''}"></div>
            <div class="form-group"><label>Phone</label><input id="setPhone" value="${currentUser.phone || ''}"></div>
            <div class="form-group"><label>Address</label><textarea id="setAddress">${currentUser.address || ''}</textarea></div>
            <div class="form-group"><label>New Password</label><input type="password" id="setPassword" placeholder="Leave blank to keep"></div>
            <h3>💳 Payment Methods</h3>
            <div class="form-group"><label>GCash Number</label><input id="setPaymentGCash" value="${currentUser.paymentGCash || ''}" placeholder="09xxxxxxxxx"></div>
            <div class="form-group"><label>GCash QR Code (Image URL)</label><input id="setPaymentGCashQR" value="${currentUser.paymentGCashQR || ''}" placeholder="https://imgur.com/..."></div>
            <div class="form-group"><label>Bank Name</label><input id="setPaymentBankName" value="${currentUser.paymentBankName || ''}" placeholder="BDO"></div>
            <div class="form-group"><label>Bank Account Number</label><input id="setPaymentBankAccount" value="${currentUser.paymentBankAccount || ''}" placeholder="123456789"></div>
            <p>Status: <strong>${currentUser.verified ? '✅ Verified' : '❌ Not Verified'}</strong></p>
            ${!currentUser.verified ? `<button class="btn btn-outline" onclick="requestVerification()">📩 Request Verification</button>` : ''}
            <button class="btn btn-primary" onclick="saveUserSettings()">💾 Save Settings</button>`;
    }
}

// ---------- DAILY MEDS, APPOINTMENTS, SETTINGS HELPERS ----------
function showAddDailyMedForm() {
    const formDiv = document.getElementById('dailyMedForm');
    formDiv.style.display = 'block';
    formDiv.innerHTML = `
        <h3>Add Medication</h3>
        <div class="form-group"><label>Medicine Name</label><input id="dmName"></div>
        <div class="form-group"><label>Dosage Info</label><input id="dmDosageInfo" placeholder="e.g., 500mg tablet"></div>
        <div class="form-group"><label>Time of Day</label><select id="dmTime"><option>Morning</option><option>Afternoon</option><option>Evening</option><option>Night</option></select></div>
        <div class="form-group"><label>Reminder Time (HH:MM)</label><input type="time" id="dmReminderTime"></div>
        <div class="form-group"><label>Doctor's Prescription (optional)</label><textarea id="dmPrescription" placeholder="e.g., Take after meals"></textarea></div>
        <button class="btn btn-success btn-sm" onclick="saveDailyMed()">✅ Save</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('dailyMedForm').style.display='none'">Cancel</button>`;
}
function saveDailyMed() {
    const name = document.getElementById('dmName').value.trim();
    const dosageInfo = document.getElementById('dmDosageInfo').value.trim();
    const timeOfDay = document.getElementById('dmTime').value;
    const reminderTime = document.getElementById('dmReminderTime').value;
    const prescription = document.getElementById('dmPrescription').value.trim();
    if (!name) { showNotification('Enter medicine name.', 'error', false); return; }
    const dm = getDailyMeds();
    dm.push({ id: Date.now(), userId: currentUser.id, name, dosageInfo, timeOfDay, reminderTime, prescription, takenToday: false });
    saveDailyMeds(dm);
    document.getElementById('dailyMedForm').style.display = 'none';
    renderUserTab('dailyMeds');
    showNotification('Medication added!', 'success', false);
    updateNotifBadge();
}
function toggleDailyMedTaken(id) {
    const dm = getDailyMeds().find(d => d.id === id);
    if (dm) { dm.takenToday = !dm.takenToday; saveDailyMeds(getDailyMeds()); renderUserTab('dailyMeds'); updateNotifBadge(); }
}
function deleteDailyMed(id) {
    saveDailyMeds(getDailyMeds().filter(d => d.id !== id));
    renderUserTab('dailyMeds');
    showNotification('Medication removed.', 'info', false);
    updateNotifBadge();
}
function showScheduleAppointmentForm() {
    const formDiv = document.getElementById('appointmentForm');
    formDiv.style.display = 'block';
    formDiv.innerHTML = `
        <h3>Schedule Appointment</h3>
        <div class="form-group"><label>Date</label><input type="date" id="appDate" min="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label>Time</label><input type="time" id="appTime"></div>
        <div class="form-group"><label>Reason</label><input id="appReason"></div>
        <button class="btn btn-success btn-sm" onclick="saveAppointment()">Schedule</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('appointmentForm').style.display='none'">Cancel</button>`;
}
function saveAppointment() {
    const date = document.getElementById('appDate').value;
    const time = document.getElementById('appTime').value;
    const reason = document.getElementById('appReason').value.trim();
    if (!date || !time || !reason) { showNotification('Fill all fields.', 'error', false); return; }
    const apps = getAppointments();
    apps.push({ id: Date.now(), userId: currentUser.id, date, time, reason });
    saveAppointments(apps);
    document.getElementById('appointmentForm').style.display = 'none';
    renderUserTab('appointments');
    showNotification('Appointment scheduled!', 'success', false);
    updateNotifBadge();
}
function cancelAppointment(id) {
    saveAppointments(getAppointments().filter(a => a.id !== id));
    renderUserTab('appointments');
    showNotification('Cancelled.', 'info', false);
    updateNotifBadge();
}
async function saveUserSettings() {
    const fullName = document.getElementById('setFullName').value.trim();
    const email = document.getElementById('setEmail').value.trim();
    const phone = document.getElementById('setPhone').value.trim();
    const address = document.getElementById('setAddress').value.trim();
    const password = document.getElementById('setPassword').value.trim();
    const gcash = document.getElementById('setPaymentGCash').value.trim();
    const gcashQR = document.getElementById('setPaymentGCashQR').value.trim();
    const bankName = document.getElementById('setPaymentBankName').value.trim();
    const bankAccount = document.getElementById('setPaymentBankAccount').value.trim();
    if (!fullName || !email) { showNotification('Name and email required.', 'error', false); return; }
    const db = window.db;
    if (db && currentUser.id) {
        const userRef = firebaseDoc(db, "users", currentUser.id);
        const updates = { fullName, email, phone, address, paymentGCash: gcash, paymentGCashQR: gcashQR, paymentBankName: bankName, paymentBankAccount: bankAccount, verified: !!(fullName && email && phone && address) };
        if (password) updates.password = password;
        await firebaseUpdateDoc(userRef, updates);
    }
    Object.assign(currentUser, { fullName, email, phone, address, paymentGCash: gcash, paymentGCashQR: gcashQR, paymentBankName: bankName, paymentBankAccount: bankAccount, password: password || currentUser.password, verified: !!(fullName && email && phone && address) });
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    updateUIForLogin();
    renderUserTab('settings');
    showNotification('Settings saved!', 'success', false);
}

// ---------- MEDICINE FORM (with quote fix) ----------
function showAddMedicineForm(editData = null) {
    const formDiv = document.getElementById('adminMedicineForm');
    formDiv.style.display = 'block';
    const safeId = editData?.id ? `'${editData.id}'` : `''`;
    formDiv.innerHTML = `
        <h3>${editData ? 'Edit' : 'Add'} Medicine</h3>
        <div class="form-group"><label>Name</label><input id="medName" value="${editData?.name || ''}"></div>
        <div class="form-group"><label>Category</label><select id="medCategory">${['Pain Relief','Antibiotic','Diabetes','Digestive','Allergy','Cardiac','Vitamins','Hormone'].map(c => `<option ${editData?.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label>Dosage</label><input id="medDosage" value="${editData?.dosage || ''}"></div>
        <div class="form-group"><label>Who Can Take</label><input id="medWhoCanTake" value="${editData?.whoCanTake || ''}"></div>
        <div class="form-group"><label>Description</label><textarea id="medDescription">${editData?.description || ''}</textarea></div>
        <div class="form-group"><label>Side Effects</label><input id="medSideEffects" value="${editData?.sideEffects || ''}"></div>
        <div class="form-group"><label>Manufacturer</label><input id="medManufacturer" value="${editData?.manufacturer || ''}"></div>
        <div class="form-group"><label>Price</label><input type="number" step="0.01" id="medPrice" value="${editData?.price || ''}"></div>
        <div class="form-group"><label>Icon (emoji)</label><input id="medIcon" value="${editData?.icon || '💊'}"></div>
        <div class="form-group"><label>Expiration Date</label><input type="date" id="medExpiration" value="${editData?.expirationDate ? editData.expirationDate.substring(0,10) : ''}"></div>
        <div class="form-group"><label>Stock</label><input type="number" id="medStock" value="${editData?.stock || 0}"></div>
        <button class="btn btn-success btn-sm" onclick="saveMedicine(${safeId})">Save</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('adminMedicineForm').style.display='none'">Cancel</button>`;
}
async function saveMedicine(editId) {
    const name = document.getElementById('medName').value.trim();
    const category = document.getElementById('medCategory').value;
    const dosage = document.getElementById('medDosage').value.trim();
    const whoCanTake = document.getElementById('medWhoCanTake').value.trim();
    const description = document.getElementById('medDescription').value.trim();
    const sideEffects = document.getElementById('medSideEffects').value.trim();
    const manufacturer = document.getElementById('medManufacturer').value.trim();
    const price = parseFloat(document.getElementById('medPrice').value);
    const icon = document.getElementById('medIcon').value.trim() || '💊';
    const expirationDate = document.getElementById('medExpiration').value;
    const stock = parseInt(document.getElementById('medStock').value) || 0;
    if (!name || !category || isNaN(price)) { showNotification('Name, category, price required.', 'error', false); return; }
    const data = { name, category, dosage, whoCanTake, description, sideEffects, manufacturer, price, icon, expirationDate, stock };
    await saveMedicineToFirestore(data, editId ? String(editId) : null);
    document.getElementById('adminMedicineForm').style.display = 'none';
    await renderAdminTab('medicines');
    renderMedicineGrid();
    showNotification(editId ? 'Medicine updated!' : 'Medicine added!', 'success', false);
}
async function editMedicine(id) { const meds = await getMedicinesFromFirestore(); const med = meds.find(m => m.id == id); if (med) showAddMedicineForm(med); }
async function deleteMedicine(id) { if (!confirm('Delete?')) return; await deleteMedicineFromFirestore(id); renderAdminTab('medicines'); renderMedicineGrid(); showNotification('Deleted.', 'info', false); }

// ---------- DOCTORS CRUD ----------
function showAddDoctorForm(editData = null) {
    const formDiv = document.getElementById('adminDoctorForm');
    formDiv.style.display = 'block';
    formDiv.innerHTML = `
        <h3>${editData ? 'Edit' : 'Add'} Doctor</h3>
        <div class="form-group"><label>Name</label><input id="docName" value="${editData?.name || ''}"></div>
        <div class="form-group"><label>Specialty</label><input id="docSpecialty" value="${editData?.specialty || ''}"></div>
        <div class="form-group"><label>Image URL</label><input id="docImage" value="${editData?.image || ''}"></div>
        <div class="form-group"><label>Bio</label><textarea id="docBio">${editData?.bio || ''}</textarea></div>
        <button class="btn btn-success btn-sm" onclick="saveDoctor('${editData?.id || ''}')">Save</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('adminDoctorForm').style.display='none'">Cancel</button>`;
}
async function saveDoctor(docId) {
    const name = document.getElementById('docName').value.trim();
    const specialty = document.getElementById('docSpecialty').value.trim();
    const image = document.getElementById('docImage').value.trim();
    const bio = document.getElementById('docBio').value.trim();
    if (!name || !specialty) { showNotification('Name and specialty required.', 'error', false); return; }
    const data = { name, specialty, image, bio };
    await saveDoctorToFirestore(data, docId || null);
    document.getElementById('adminDoctorForm').style.display = 'none';
    await renderAdminTab('doctors');
    loadHomeDoctors();
    showNotification(docId ? 'Doctor updated!' : 'Doctor added!', 'success', false);
}
async function editDoctor(id) { const doctors = await getDoctorsFromFirestore(); const doc = doctors.find(d => d.id === id); if (doc) showAddDoctorForm(doc); }
async function deleteDoctor(id) { if (!confirm('Delete?')) return; await deleteDoctorFromFirestore(id); renderAdminTab('doctors'); loadHomeDoctors(); showNotification('Doctor deleted.', 'info', false); }

// ---------- VERIFICATION (with user notification) ----------
function requestVerification() {
    if (!currentUser || currentUser.role !== 'user') return;
    const reqs = getVerificationRequests();
    if (reqs.some(r => r.userId === currentUser.id && r.status === 'pending')) { showNotification('Already pending.', 'info', false); return; }
    reqs.push({ userId: currentUser.id, userName: currentUser.fullName, userEmail: currentUser.email, date: new Date().toISOString(), status: 'pending' });
    saveVerificationRequests(reqs);
    showNotification('Verification requested!', 'success', false);
    updateNotifBadge();
}
async function approveVerification(userId) {
    const db = window.db;
    if (db && userId) {
        const userRef = firebaseDoc(db, "users", userId);
        await firebaseUpdateDoc(userRef, { verified: true });
        if (currentUser && currentUser.id === userId) { currentUser.verified = true; localStorage.setItem('currentUser', JSON.stringify(currentUser)); }
    }
    let reqs = getVerificationRequests();
    const req = reqs.find(r => r.userId === userId && r.status === 'pending');
    if (req) req.status = 'approved';
    saveVerificationRequests(reqs);
    // Store notification for the user
    localStorage.setItem(`verifUpdate_${userId}`, 'approved');
    renderAdminTab('verifications');
    showNotification('User verified!', 'success', false);
    updateNotifBadge();
}
async function rejectVerification(userId) {
    let reqs = getVerificationRequests();
    const req = reqs.find(r => r.userId === userId && r.status === 'pending');
    if (req) req.status = 'rejected';
    saveVerificationRequests(reqs);
    // Store notification for the user
    localStorage.setItem(`verifUpdate_${userId}`, 'rejected');
    renderAdminTab('verifications');
    showNotification('Rejected.', 'info', false);
    updateNotifBadge();
}

// ---------- OWNER ADD USER MODAL ----------
function openAddUserModal() {
    const modal = document.getElementById('loginModal');
    modal.classList.add('show');
    document.getElementById('loginFormFields').style.display = 'none';
    const regForm = document.getElementById('registerForm');
    regForm.style.display = 'block';
    regForm.innerHTML = `
        <div class="form-group"><label>Full Name</label><input type="text" id="regName" placeholder="Full name"></div>
        <div class="form-group"><label>Email</label><input type="email" id="regEmail" placeholder="Email"></div>
        <div class="form-group"><label>Password</label><input type="password" id="regPassword" placeholder="Password"></div>
        <div class="form-group"><label>Confirm Password</label><input type="password" id="regConfirmPassword" placeholder="Re‑enter password"></div>
        <div class="form-group"><label>Role</label>
            <select id="regRole">
                <option value="staff">Staff</option>
                <option value="seller">Seller</option>
                <option value="doctor">Doctor</option>
                <option value="user">User</option>
            </select>
        </div>
        <button class="btn btn-success" style="width:100%;" onclick="registerUser(null, true)">✅ Create Account</button>
        <p style="text-align:center;margin-top:10px;"><a href="#" onclick="closeAddUserModal()">Cancel</a></p>`;
}
function closeAddUserModal() { document.getElementById('loginModal').classList.remove('show'); }

// ---------- NOTIFICATIONS POPUPS ----------
function showNotification(msg, type, isWelcome) {
    const container = document.getElementById('notificationContainer');
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = msg;
    container.appendChild(notif);
    setTimeout(() => { notif.style.opacity = '0'; setTimeout(() => notif.remove(), 300); }, 3000);
}
function showWelcomePopup(msg) {
    const container = document.getElementById('notificationContainer');
    const notif = document.createElement('div');
    notif.className = 'notification success notification-welcome';
    notif.textContent = msg;
    notif.style.left = '50%'; notif.style.transform = 'translateX(-50%)'; notif.style.right = 'auto'; notif.style.top = '20px';
    container.appendChild(notif);
    setTimeout(() => { notif.style.opacity = '0'; setTimeout(() => notif.remove(), 300); }, 3000);
}

// FAQ
function toggleFaq(el) { el.parentElement.classList.toggle('open'); }

// Init
function init() {
    updateCartCount();
    if (currentUser) updateUIForLogin(); else updateUIForLogout();
    setTimeout(() => { renderMedicineGrid(); loadHomeDoctors(); }, 800);
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeLoginModal();
        closeCartModal();
        closeMedicineDetail();
        closeAccountDropdown();
        closeCheckoutModal();
        closeNotifModal();
        closeForgotPasswordModal();
    }
});
init();