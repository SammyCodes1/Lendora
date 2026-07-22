const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const target = await fetch(
  "http://127.0.0.1:9224/json/new?http://localhost:3000/dashboard",
  { method: "PUT" },
).then((response) => response.json());
if (!target) throw new Error("No ArcLend browser target found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const errors = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }

  if (message.method === "Runtime.exceptionThrown") {
    errors.push({ type: "exception", detail: message.params.exceptionDetails });
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    errors.push({
      type: "console",
      detail: message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type),
    });
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    errors.push({ type: "log", detail: message.params.entry });
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await delay(8_000);

const state = await send("Runtime.evaluate", {
  expression: `(() => {
    const canvas = document.querySelector('canvas');
    let webgl = false;
    try {
      const probe = document.createElement('canvas');
      webgl = Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch {}
    return {
      path: location.pathname,
      readyState: document.readyState,
      canvasPresent: Boolean(canvas),
      canvasWidth: canvas?.width ?? null,
      canvasHeight: canvas?.height ?? null,
      webgl,
      nextErrorOverlay: Boolean(document.querySelector('nextjs-portal')),
      nextOverlayText: document.querySelector('nextjs-portal')?.shadowRoot?.textContent?.slice(0, 3000) ?? '',
    };
  })()`,
  returnByValue: true,
});

console.log(JSON.stringify({ state: state.result.value, errors }, null, 2));
socket.close();
