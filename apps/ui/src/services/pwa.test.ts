import { expect, test } from "vitest";
import { registerPwaServiceWorker } from "./pwa";

function serviceWorker(register: () => void) {
  return {
    async register() {
      register();
      return {} as ServiceWorkerRegistration;
    },
  };
}

test("registers immediately after the page has loaded", () => {
  let registrations = 0;
  registerPwaServiceWorker({
    isSecureContext: true,
    readyState: "complete",
    serviceWorker: serviceWorker(() => {
      registrations += 1;
    }),
    addLoadListener() {
      throw new Error("load listener should not be used");
    },
  });

  expect(registrations).toBe(1);
});

test("defers registration until load without adding duplicate work", () => {
  let registrations = 0;
  let loadListener: (() => void) | undefined;
  registerPwaServiceWorker({
    isSecureContext: true,
    readyState: "loading",
    serviceWorker: serviceWorker(() => {
      registrations += 1;
    }),
    addLoadListener(listener) {
      loadListener = listener;
    },
  });

  expect(registrations).toBe(0);
  if (!loadListener) {
    throw new Error("Expected registration to install a load listener");
  }
  loadListener();
  expect(registrations).toBe(1);
});

test("skips registration outside a secure service-worker environment", () => {
  let listenerAdded = false;
  registerPwaServiceWorker({
    isSecureContext: false,
    readyState: "complete",
    serviceWorker: serviceWorker(() => {
      throw new Error("service worker should not be registered");
    }),
    addLoadListener() {
      listenerAdded = true;
    },
  });

  expect(listenerAdded).toBe(false);
});
