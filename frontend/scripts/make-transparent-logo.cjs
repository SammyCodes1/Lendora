const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function main() {
  const srcPath = path.join(__dirname, "..", "public", "arclend-logo.png");
  const outPath = path.join(__dirname, "..", "public", "arclend-mark.png");
  const src = fs.readFileSync(srcPath);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Punch out near-black background so mark works on dark UI.
    if (r < 22 && g < 22 && b < 22) {
      data[i + 3] = 0;
    }
  }

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  console.log("wrote", outPath, meta);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
