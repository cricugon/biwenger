(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat("es-ES");
  let valuePage = 1;
  let valueTotal = 0;
  let selectedValuePlayerId = "";
  let diagnosticItems = [];

  async function api(path, options = {}) {
    const response = await fetch(`/admin/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", "X-Admin-Request": "1", ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Error HTTP ${response.status}`);
    return body;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleString("es-ES");
  }

  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    setTimeout(() => $("#toast").classList.remove("show"), 2400);
  }

  async function enter() {
    $("#login").hidden = true;
    $("#dashboard").hidden = false;
    await Promise.all([loadSummary(), loadUsers(), loadValues(), loadDiagnostics()]);
  }

  async function loadSummary() {
    const item = await api("/summary");
    const cards = [["Usuarios", item.users], ["Jugadores", item.players], ["Valores diarios", item.values], ["Diagnósticos", item.diagnostics], ["Consultas IA", item.ai]];
    $("#summary").innerHTML = cards.map(card => `<article><strong>${number.format(card[1])}</strong><span>${card[0]}</span></article>`).join("");
  }

  async function loadUsers() {
    const data = await api(`/users?search=${encodeURIComponent($("#user-search").value)}`);
    $("#users-body").innerHTML = data.users.map(user => `<tr data-user="${user.id}">
      <td><div class="user-main"><b>${escapeHtml(user.displayName)}</b><small>${escapeHtml(user.email)}</small></div></td>
      <td>${date(user.createdAt)}<br><span class="muted">${date(user.lastLoginAt)}</span></td>
      <td>${number.format(user.aiRequests)} consultas<br><span class="muted">${number.format(user.totalTokens)} tokens</span></td>
      <td><div class="credit-editor"><input type="number" min="0" max="1000000" value="${Number(user.credits.balance) || 0}" aria-label="Créditos"><button data-save-credit>Guardar</button></div></td>
      <td><button class="delete" data-delete-user>Eliminar</button></td>
    </tr>`).join("") || `<tr><td colspan="5">No hay usuarios.</td></tr>`;
  }

  async function loadValues() {
    const params = new URLSearchParams({ page: valuePage, limit: 50 });
    [["search", "#value-search"], ["from", "#value-from"], ["to", "#value-to"], ["source", "#value-source"]].forEach(([key, selector]) => {
      if ($(selector).value) params.set(key, $(selector).value);
    });
    if (selectedValuePlayerId) params.set("playerId", selectedValuePlayerId);
    const data = await api(`/market-values?${params}`);
    valueTotal = data.total;
    $("#value-count").textContent = `${number.format(data.total)} registros encontrados`;
    $("#value-page").textContent = `Página ${data.page} de ${Math.max(1, Math.ceil(data.total / data.limit))}`;
    $("#value-prev").disabled = valuePage <= 1;
    $("#value-next").disabled = valuePage * data.limit >= data.total;
    $("#values-body").innerHTML = data.items.map(item => `<tr data-value-player="${item.playerId}"><td><b>${escapeHtml(item.name)}</b><br><span class="muted">${escapeHtml(item.position || "?")} · ${escapeHtml(item.team || "")}</span></td><td>${escapeHtml(item.date)}</td><td><b>${money.format(item.value)}</b></td><td>${escapeHtml(item.source)}</td></tr>`).join("") || `<tr><td colspan="4">No hay valores con esos filtros.</td></tr>`;
    if (selectedValuePlayerId && data.items.length) renderValueChart(data.items);
  }

  function renderValueChart(items) {
    const points = items.slice().sort((left, right) => String(left.date).localeCompare(String(right.date)));
    if (!points.length) return;
    const values = points.map(item => Number(item.value) || 0);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const spread = Math.max(1, maximum - minimum);
    const coords = points.map((item, index) => ({
      x: 35 + (points.length === 1 ? 0 : index / (points.length - 1) * 830),
      y: 205 - ((Number(item.value) - minimum) / spread) * 165,
      item
    }));
    const line = coords.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const area = `35,215 ${line} ${coords[coords.length - 1].x.toFixed(1)},215`;
    $("#value-chart-title").textContent = points[0].name;
    $("#value-chart-range").textContent = `${points[0].date} — ${points[points.length - 1].date} · ${money.format(minimum)} — ${money.format(maximum)}`;
    $("#value-chart").innerHTML = `<line class="chart-grid" x1="35" y1="40" x2="865" y2="40"/><line class="chart-grid" x1="35" y1="122" x2="865" y2="122"/><line class="chart-grid" x1="35" y1="205" x2="865" y2="205"/><polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}"/>${coords.map(point => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.item.date)} · ${money.format(point.item.value)}</title></circle>`).join("")}`;
    $("#value-chart-card").hidden = false;
  }

  async function loadDiagnostics() {
    const data = await api(`/diagnostics?search=${encodeURIComponent($("#diagnostic-search").value)}`);
    diagnosticItems = data.diagnostics;
    $("#diagnostic-list").innerHTML = diagnosticItems.map(item => `<button class="diagnostic-item" data-diagnostic="${item.id}"><b>${escapeHtml(item.leagueName || "Liga sin nombre")}</b><span>${escapeHtml(item.user?.displayName || "Usuario eliminado")}</span><small>${item.marketCount} jugadores · ${item.managerCount} mánagers · ${date(item.updatedAt)}</small></button>`).join("") || `<div class="empty">Todavía no hay volcados.</div>`;
  }

  function scoreClass(value) { return value >= 60 ? "score-high" : value >= 30 ? "score-mid" : "score-low"; }

  function predictionHtml(prediction) {
    const d = prediction.debug || {};
    const factors = prediction.features || {};
    return `<section class="prediction-card">
      <div class="prediction-top"><div><h4>${escapeHtml(prediction.manager)}</h4><span class="muted">${escapeHtml(prediction.style || "")}</span></div><div class="${scoreClass(prediction.probability)}"><b>${number.format(prediction.probability)}%</b> · puja ${money.format(prediction.bid || 0)}</div></div>
      <div class="diagnostic-kpis"><div><span>Interés</span><strong>${prediction.interest}%</strong></div><div><span>Puja máxima</span><strong>${money.format(prediction.maxBid || 0)}</strong></div><div><span>Fiabilidad</span><strong>${Math.round((prediction.confidence || 0) * 100)}%</strong></div><div><span>Muestras</span><strong>${number.format(d.learningSamples || 0)}</strong></div></div>
      <div class="formula">agresividad = gasto ${fmt(d.aggressionSpendContribution)} + actividad ${fmt(d.aggressionActivityContribution)} = ${fmt(d.aggression)}\nscore = base ${fmt(d.baseScore)} + aprendizaje ${fmt(d.learnedCorrection)} + participación ${fmt(d.participationCorrection)} = ${fmt(prediction.score)}\npuja = ${money.format(d.cost || 0)} × (1 + ${fmt(d.finalMarkup)}) → ${money.format(prediction.bid || 0)}\nprobabilidad = peso ${fmt(d.probabilityWeight)} / total ${fmt(d.probabilityTotal)} = ${prediction.probability}%</div>
      <div class="factor-grid">${Object.entries(factors).map(([key, value]) => `<div class="factor"><span>${escapeHtml(key)}</span><strong>${Math.round((Number(value) || 0) * 100)}%</strong><small>aporte ${fmt(d.contributions?.[key])}</small></div>`).join("")}</div>
      <ul class="reasons">${(prediction.reasons || []).map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
    </section>`;
  }

  function fmt(value) { return (Number(value) || 0).toFixed(4); }

  function renderDiagnosticPlayer(data, playerIndex) {
    const player = data.market[playerIndex] || data.market[0];
    if (!player) return;
    $("#diagnostic-player-report").innerHTML = `<div class="diagnostic-head"><div><p class="eyebrow">Predicción actual</p><h2>${escapeHtml(player.name)}</h2><span class="muted">${escapeHtml(player.position)} · ${escapeHtml(player.team || "")} · valor ${money.format(player.value || 0)} · precio ${money.format(player.price || 0)}</span></div></div>${(player.predictions || []).map(predictionHtml).join("")}`;
  }

  async function openDiagnostic(id) {
    $$(".diagnostic-item").forEach(item => item.classList.toggle("active", item.dataset.diagnostic === id));
    $("#diagnostic-detail").innerHTML = `<div class="empty">Cargando diagnóstico…</div>`;
    const data = await api(`/diagnostics/${id}`);
    $("#diagnostic-detail").innerHTML = `<div class="diagnostic-head"><div><p class="eyebrow">${escapeHtml(data.algorithmVersion)}</p><h2>${escapeHtml(data.leagueName || "Liga")}</h2><span class="muted">${escapeHtml(data.user?.email || "")} · ${date(data.generatedAt)}</span></div></div>
      <div class="diagnostic-kpis"><div><span>Mánagers</span><strong>${data.managers?.length || 0}</strong></div><div><span>Mercado</span><strong>${data.market?.length || 0}</strong></div><div><span>Movimientos</span><strong>${data.summary?.movements || 0}</strong></div><div><span>Subastas resueltas</span><strong>${data.summary?.resolvedAuctions || 0}</strong></div></div>
      <label class="market-selector">Futbolista del mercado<select id="diagnostic-player">${(data.market || []).map((player, index) => `<option value="${index}">${escapeHtml(player.name)} · ${escapeHtml(player.position)} · ${money.format(player.price || player.value || 0)}</option>`).join("")}</select></label>
      <div id="diagnostic-player-report"></div>`;
    $("#diagnostic-player").addEventListener("change", event => renderDiagnosticPlayer(data, Number(event.target.value)));
    renderDiagnosticPlayer(data, 0);
  }

  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("#login-error").hidden = true;
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ username: $("#username").value, password: $("#password").value }) });
      $("#password").value = "";
      await enter();
    } catch (error) { $("#login-error").textContent = error.message; $("#login-error").hidden = false; }
  });
  $("#logout").addEventListener("click", async () => { await api("/logout", { method: "POST" }); location.reload(); });
  $$(".tabs button").forEach(button => button.addEventListener("click", () => {
    $$(".tabs button").forEach(item => item.classList.toggle("active", item === button));
    $$(".panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === button.dataset.tab));
  }));
  $("#user-search").addEventListener("input", debounce(loadUsers, 300));
  $("#users-body").addEventListener("click", async event => {
    const row = event.target.closest("tr[data-user]");
    if (!row) return;
    if (event.target.closest("[data-save-credit]")) {
      const balance = row.querySelector("input").value;
      await api(`/users/${row.dataset.user}/credits`, { method: "PATCH", body: JSON.stringify({ balance }) });
      toast("Saldo actualizado"); await loadUsers();
    }
    if (event.target.closest("[data-delete-user]") && confirm("¿Eliminar esta cuenta y todos sus datos asociados? Esta acción no se puede deshacer.")) {
      await api(`/users/${row.dataset.user}`, { method: "DELETE" });
      toast("Usuario eliminado"); await Promise.all([loadUsers(), loadSummary(), loadDiagnostics()]);
    }
  });
  $("#value-filters").addEventListener("submit", event => { event.preventDefault(); selectedValuePlayerId = ""; $("#value-chart-card").hidden = true; valuePage = 1; loadValues(); });
  $("#values-body").addEventListener("click", event => { const row = event.target.closest("[data-value-player]"); if (row) { selectedValuePlayerId = row.dataset.valuePlayer; valuePage = 1; loadValues(); } });
  $("#value-chart-close").addEventListener("click", () => { selectedValuePlayerId = ""; $("#value-chart-card").hidden = true; valuePage = 1; loadValues(); });
  $("#value-prev").addEventListener("click", () => { if (valuePage > 1) { valuePage--; loadValues(); } });
  $("#value-next").addEventListener("click", () => { if (valuePage * 50 < valueTotal) { valuePage++; loadValues(); } });
  $("#diagnostic-search").addEventListener("input", debounce(loadDiagnostics, 300));
  $("#diagnostic-list").addEventListener("click", event => { const item = event.target.closest("[data-diagnostic]"); if (item) openDiagnostic(item.dataset.diagnostic); });

  function debounce(fn, ms) { let timer; return () => { clearTimeout(timer); timer = setTimeout(() => fn().catch(error => toast(error.message)), ms); }; }
  api("/config").then(config => {
    if (!config.configured) {
      $("#configuration-error").textContent = "Panel pendiente de configuración en Render: " + config.requirements.join(", ") + ".";
      $("#configuration-error").hidden = false;
    }
  }).catch(() => {});
  api("/session").then(enter).catch(() => { $("#login").hidden = false; });
  window.addEventListener("unhandledrejection", event => toast(event.reason?.message || "Ha ocurrido un error"));
})();
