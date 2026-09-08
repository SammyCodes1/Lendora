"use client";

import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const CIRCLE_AUTH_ORIGIN = "https://pw-auth.circle.com";

type CircleSdkInternals = {
  iframe: HTMLIFrameElement;
  receivedResponseFromService: boolean;
  resolveDeviceIdPromise?: (deviceId: string) => void;
  rejectDeviceIdPromise?: (reason: string) => void;
  subscribeMessage: () => void;
  unSubscribeMessage: () => void;
  appendIframe: (showIframe?: boolean, subRoute?: string) => void;
  closeModal: () => void;
  getDeviceId: () => Promise<string>;
};

let installed = false;

function pageOrigin() {
  return window.location.origin;
}

function styleHiddenIframe(iframe: HTMLIFrameElement) {
  iframe.setAttribute("allow", "clipboard-read; clipboard-write");
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.opacity = "0.01";
  iframe.style.pointerEvents = "none";
  iframe.style.position = "fixed";
  iframe.style.left = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.zIndex = "1";
  iframe.width = "1";
  iframe.height = "1";
}

export function installCircleSdkIframePatch() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const proto = W3SSdk.prototype as unknown as CircleSdkInternals;

  proto.appendIframe = function appendIframe(showIframe = true, subRoute = "") {
    const iframe = this.iframe;
    const route = subRoute.replace(/^\//, "");
    iframe.src = `${CIRCLE_AUTH_ORIGIN}/${route}?origin=${encodeURIComponent(pageOrigin())}`;
    iframe.id = "sdkIframe";

    if (showIframe) {
      iframe.width = "100%";
      iframe.height = "100%";
      iframe.style.zIndex = "2147483647";
      iframe.style.position = "fixed";
      iframe.style.top = "50%";
      iframe.style.left = "50%";
      iframe.style.transform = "translate(-50%, -50%)";
      iframe.style.display = "";
      iframe.style.opacity = "1";
      iframe.style.pointerEvents = "auto";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
    } else {
      styleHiddenIframe(iframe);
    }

    if (!iframe.isConnected) {
      document.body.appendChild(iframe);
    }
  };

  proto.getDeviceId = function getDeviceId() {
    return new Promise<string>((resolve, reject) => {
      this.resolveDeviceIdPromise = resolve;
      this.rejectDeviceIdPromise = reject;
      this.receivedResponseFromService = false;
      this.subscribeMessage();
      this.appendIframe(false, "device-id");
      window.setTimeout(() => {
        if (!this.receivedResponseFromService) {
          this.rejectDeviceIdPromise?.("Failed to receive deviceId");
          this.closeModal();
          this.unSubscribeMessage();
        }
      }, 25_000);
    });
  };
}
