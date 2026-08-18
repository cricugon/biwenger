(function () {
  "use strict";

  const elements = {
    shop: document.getElementById("shop-view"),
    success: document.getElementById("success-view"),
    loading: document.getElementById("loading"),
    products: document.getElementById("products"),
    message: document.getElementById("message"),
    accountChip: document.getElementById("account-chip"),
    accountName: document.getElementById("account-name"),
    accountBalance: document.getElementById("account-balance"),
    resultIcon: document.getElementById("result-icon"),
    resultTitle: document.getElementById("result-title"),
    resultText: document.getElementById("result-text"),
    resultLoading: document.getElementById("result-loading"),
    resultBalance: document.getElementById("result-balance"),
    retryStatus: document.getElementById("retry-status")
  };
  const params = new URLSearchParams(window.location.search);
  const successMode = window.location.pathname === "/store/success";
  let summary;
  let checking = false;

  function creditText(value) {
    const amount = Math.max(0, Number(value) || 0);
    return amount + (amount === 1 ? " consulta" : " consultas");
  }

  async function api(url, options) {
    const response = await fetch(url, Object.assign({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" }
    }, options || {}));
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || "No se pudo completar la operación");
    return body;
  }

  function showMessage(text, type) {
    elements.message.textContent = text;
    elements.message.className = "message" + (type ? " " + type : "");
    elements.message.hidden = !text;
  }

  function renderAccount(user) {
    elements.accountChip.hidden = false;
    elements.accountName.textContent = user.displayName || user.email || "Tu cuenta";
    elements.accountBalance.textContent = creditText(user.credits && user.credits.balance);
  }

  function renderProducts(products) {
    elements.products.replaceChildren();
    products.forEach(function (item) {
      const article = document.createElement("article");
      article.className = "product" + (item.featured ? " featured" : "");
      if (item.featured) {
        const popular = document.createElement("span");
        popular.className = "popular";
        popular.textContent = "MÁS ELEGIDO";
        article.appendChild(popular);
      }
      const count = document.createElement("span");
      count.className = "product-count";
      count.textContent = item.label;
      const price = document.createElement("strong");
      price.className = "product-price";
      price.textContent = item.price;
      const description = document.createElement("p");
      description.className = "product-description";
      description.textContent = item.description;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button";
      button.textContent = "Comprar " + item.label.toLowerCase();
      button.addEventListener("click", function () { buy(item.key, button); });
      article.append(count, price, description, button);
      elements.products.appendChild(article);
    });
    elements.loading.hidden = true;
    elements.products.hidden = false;
  }

  async function buy(packKey, selectedButton) {
    document.querySelectorAll(".product .button").forEach(function (button) { button.disabled = true; });
    selectedButton.textContent = "Abriendo Stripe…";
    showMessage("", "");
    try {
      const checkout = await api("/api/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ packKey: packKey })
      });
      window.location.assign(checkout.url);
    } catch (error) {
      showMessage(error.message, "error");
      document.querySelectorAll(".product .button").forEach(function (button) { button.disabled = false; });
      selectedButton.textContent = "Intentar de nuevo";
    }
  }

  async function loadSummary() {
    try {
      summary = await api("/api/v1/billing/store");
      renderAccount(summary.user);
      if (!successMode) renderProducts(summary.products || []);
    } catch (error) {
      if (successMode) {
        showResultError(error.message);
      } else {
        elements.loading.hidden = true;
        showMessage(error.message, "error");
      }
    }
  }

  function showResultError(text) {
    elements.resultLoading.hidden = true;
    elements.resultIcon.textContent = "!";
    elements.resultIcon.className = "result-icon waiting";
    elements.resultTitle.textContent = "No podemos comprobarlo todavía";
    elements.resultText.textContent = text + " Si el pago se completó, Stripe lo notificará igualmente y el saldo se añadirá a tu cuenta.";
    elements.retryStatus.hidden = false;
  }

  async function checkPurchase(attempt) {
    if (checking) return;
    const sessionId = params.get("session_id") || "";
    if (!sessionId) return showResultError("Falta la referencia de la compra.");
    checking = true;
    elements.retryStatus.hidden = true;
    elements.resultLoading.hidden = false;
    try {
      const result = await api("/api/v1/billing/purchase-status?session_id=" + encodeURIComponent(sessionId));
      if (result.status === "fulfilled") {
        elements.resultLoading.hidden = true;
        elements.resultIcon.textContent = "✓";
        elements.resultIcon.className = "result-icon";
        elements.resultTitle.textContent = "Saldo añadido";
        elements.resultText.textContent = "La compra se ha confirmado y tus " + creditText(result.creditsPurchased) + " ya están disponibles.";
        elements.resultBalance.hidden = false;
        elements.resultBalance.querySelector("strong").textContent = creditText(result.credits && result.credits.balance);
        if (summary && summary.user) {
          summary.user.credits = result.credits;
          renderAccount(summary.user);
        }
        return;
      }
      if (["payment_failed", "expired", "creation_failed"].includes(result.status)) {
        return showResultError("El pago no se ha completado.");
      }
      if (attempt < 10) {
        window.setTimeout(function () { checkPurchase(attempt + 1); }, 1500);
      } else {
        showResultError("Stripe aún está procesando el pago.");
      }
    } catch (error) {
      showResultError(error.message);
    } finally {
      checking = false;
    }
  }

  elements.retryStatus.addEventListener("click", function () { checkPurchase(0); });
  if (params.get("cancelled")) showMessage("Pago cancelado. No se ha realizado ningún cargo ni se ha modificado tu saldo.");
  if (params.get("expired")) showMessage("El enlace ha caducado. Vuelve a abrir la tienda desde Biwenia.", "error");
  if (successMode) {
    elements.shop.hidden = true;
    elements.success.hidden = false;
    loadSummary().then(function () { checkPurchase(0); });
  } else {
    loadSummary();
  }
}());
