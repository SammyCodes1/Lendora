const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"],
            body: Buffer.concat(chunks),
          }),
        );
      })
      .on("error", reject);
  });
}

(async () => {
  const mark = await get("https://arclend-alpha.vercel.app/arclend-mark.png");
  console.log("mark", mark.status, mark.type, mark.body.length);

  const page = await get("https://arclend-alpha.vercel.app/");
  const html = page.body.toString();
  console.log("has mark src", html.includes("/arclend-mark.png"));
  console.log("has hero-logo class", html.includes("hero-logo"));

  const idx = html.indexOf("/arclend-mark.png");
  console.log(html.slice(Math.max(0, idx - 120), idx + 260));

  const credit = html.indexOf("Credit layer");
  console.log("\n--- hero block ---\n");
  console.log(html.slice(credit, credit + 1000));
})();
