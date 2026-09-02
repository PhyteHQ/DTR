(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const button = $("installButton");
  const sheet = $("installSheet");
  const title = $("installTitle");
  const message = $("installMessage");
  const primary = $("installPrimary");
  const close = $("installClose");
  const systemInstall = $("systemInstall");

  const state = {
    installPrompt: null,
    registration: null,
    updateWorker: null,
    updating: false,
    reloading: false,
    primaryAction: "install",
    returnFocus: null,
  };

  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const focusable = () =>
    sheet ? [...sheet.querySelectorAll("button:not([disabled]), [href], input:not([disabled])")] : [];

  function emit() {
    window.dispatchEvent(new CustomEvent("dtr:pwa-state", { detail: publicState() }));
  }

  function publicState() {
    return {
      installed: isStandalone(),
      installAvailable: Boolean(state.installPrompt),
      registered: Boolean(state.registration),
      updateWorker: state.updateWorker,
      updating: state.updating
    };
  }

  function setButtonLabel() {
    if (!button) return;
    const main = button.querySelector("span");
    const sub = button.querySelector("small");

    if (state.updateWorker) {
      if (main) main.textContent = "UPDATE";
      if (sub) sub.textContent = "APP READY";
      button.hidden = false;
      if (systemInstall) systemInstall.textContent = "UPDATE APP";
      return;
    }

    if (isStandalone()) {
      button.hidden = true;
      if (systemInstall) systemInstall.textContent = "APP INSTALLED";
      return;
    }

    if (main) main.textContent = "INSTALL";
    if (sub) sub.textContent = state.installPrompt ? "APP READY" : "PHONE APP";
    button.hidden = false;
    if (systemInstall) systemInstall.textContent = "INSTALL APP";
  }

  function showPanel({ heading, body, action, actionLabel }) {
    if (!sheet || !title || !message || !primary) return;
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : button;
    state.primaryAction = action;
    title.textContent = heading;
    message.textContent = body;
    primary.textContent = actionLabel;
    primary.disabled = false;
    close.textContent = action === "instructions" ? "CLOSE" : "LATER";
    sheet.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => primary.focus());
  }

  function hidePanel() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.body.classList.remove("modal-open");
    const target = state.returnFocus;
    state.returnFocus = null;
    if (target?.isConnected) target.focus();
  }

  function manualInstructions() {
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const body = apple
      ? "In Safari, tap Share, then choose Add to Home Screen."
      : "Open your browser menu and choose Install app or Add to Home screen.";
    showPanel({
      heading: "ADD DTR TO THIS DEVICE",
      body,
      action: "instructions",
      actionLabel: "GOT IT"
    });
  }

  function openInstall() {
    if (state.updateWorker) {
      showPanel({
        heading: "DTR UPDATE READY",
        body: "A verified update is ready. Apply it now to reload the command display.",
        action: "update",
        actionLabel: "UPDATE NOW"
      });
      return;
    }

    if (isStandalone()) {
      showPanel({
        heading: "DTR IS INSTALLED",
        body: "This device is already running the standalone command app.",
        action: "instructions",
        actionLabel: "CLOSE"
      });
      return;
    }

    if (state.installPrompt) {
      showPanel({
        heading: "INSTALL ON THIS DEVICE",
        body: "Add DTR to your home screen for faster access and offline cache support.",
        action: "install",
        actionLabel: "INSTALL"
      });
      return;
    }

    manualInstructions();
  }

  async function runPrimaryAction() {
    if (state.primaryAction === "instructions") {
      hidePanel();
      return;
    }

    if (state.primaryAction === "update") {
      const worker = state.updateWorker;
      if (!worker) {
        hidePanel();
        return;
      }
      state.updating = true;
      primary.disabled = true;
      primary.textContent = "UPDATING…";
      emit();
      worker.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    const prompt = state.installPrompt;
    if (!prompt) {
      manualInstructions();
      return;
    }

    primary.disabled = true;
    primary.textContent = "OPENING…";
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } finally {
      state.installPrompt = null;
      hidePanel();
      setButtonLabel();
      emit();
    }
  }

  function announceUpdate(worker) {
    if (!worker || worker.state === "redundant") return;
    state.updateWorker = worker;
    setButtonLabel();
    emit();
  }

  function watchInstalling(worker) {
    if (!worker) return;
    const check = () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) announceUpdate(worker);
    };
    worker.addEventListener("statechange", check);
    check();
  }

  function watchRegistration(registration) {
    state.registration = registration;
    if (registration.waiting) announceUpdate(registration.waiting);
    if (registration.installing) watchInstalling(registration.installing);
    registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
    emit();
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      emit();
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      watchRegistration(registration);

      const update = () => registration.update().catch(() => {});
      window.setInterval(update, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") update();
      });
    } catch (error) {
      console.warn("DTR service worker registration failed.", error);
      emit();
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    setButtonLabel();
    emit();
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    setButtonLabel();
    hidePanel();
    emit();
  });

  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (!state.updating || state.reloading) return;
    state.reloading = true;
    window.location.reload();
  });

  button?.addEventListener("click", openInstall);
  systemInstall?.addEventListener("click", () => {
    $("systemClose")?.click();
    openInstall();
  });
  close?.addEventListener("click", hidePanel);
  primary?.addEventListener("click", runPrimaryAction);

  sheet?.addEventListener("click", (event) => {
    if (event.target === sheet) hidePanel();
  });

  document.addEventListener("keydown", (event) => {
    if (!sheet || sheet.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      hidePanel();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.DTRPWA = {
    state,
    getState: publicState,
    openInstall,
    checkForUpdates: () => state.registration?.update()
  };

  setButtonLabel();
  registerServiceWorker();
})();
