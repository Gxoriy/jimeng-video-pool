/**
 * 参考图内联/降采样自检工具（排查上游网关 413 request body too large）。
 *
 * 用法（先确保已 npm run build）：
 *   node scripts/check-image-inline.js <图片路径> [目标KB]
 * 例：
 *   node scripts/check-image-inline.js ./data/uploads/xxx.png
 *   node scripts/check-image-inline.js ./data/uploads/xxx.png 60
 *
 * 输出正常应类似：
 *   ffmpeg 二进制 = ...\node_modules\ffmpeg-static\ffmpeg.exe
 *   源图 8.7MB -> 内联 base64 = 156KB（降采样=true）
 *   [OK] 降采样生效，不会触发 413。
 */
const fs = require('fs');
const path = require('path');

const distUtil = path.join(__dirname, '..', 'dist', 'common', 'image-inline.util.js');
if (!fs.existsSync(distUtil)) {
  console.error('[X] 未找到 dist/common/image-inline.util.js，请先执行：npm run build');
  process.exit(1);
}
const { inlineImageDataUri, ffmpegStaticPath, resolveFfmpegBin } = require(distUtil);

(async () => {
  const src = process.argv[2];
  const targetKB = Number(process.argv[3]) || 180;
  if (!src) {
    console.error('用法: node scripts/check-image-inline.js <图片路径> [目标KB]');
    process.exit(1);
  }
  if (!fs.existsSync(src)) {
    console.error('[X] 图片不存在:', src);
    process.exit(1);
  }

  const builtin = ffmpegStaticPath();
  const bin = resolveFfmpegBin(process.env.FFMPEG_PATH || '');
  console.log('内置 ffmpeg-static =', builtin || '（未安装，请执行 npm install）');
  console.log('实际使用 ffmpeg   =', bin);

  const srcSize = fs.statSync(src).size;
  const t0 = Date.now();
  const r = await inlineImageDataUri(src, {
    targetKB,
    ffmpegPath: process.env.FFMPEG_PATH || '',
  });
  console.log(
    `源图 ${(srcSize / 1024 / 1024).toFixed(2)}MB -> 内联 base64 = ${r.kb}KB` +
      `（目标≤${targetKB}KB，降采样=${r.downscaled}，耗时 ${Date.now() - t0}ms）`,
  );

  if (!r.downscaled && srcSize > 1024 * 1024) {
    console.error(
      '[X] 降采样未生效且原图偏大，上游网关很可能返回 413。\n' +
        '    请执行 npm install 安装 ffmpeg-static，或在 .env 配置 FFMPEG_PATH 指向可用的 ffmpeg。',
    );
    process.exit(2);
  }
  if (r.kb > targetKB * 1.5) {
    console.warn(`[!] 内联体积 ${r.kb}KB 明显超出目标 ${targetKB}KB，建议换更小的参考图。`);
    process.exit(3);
  }
  console.log('[OK] 降采样生效，内联体积可控，不会因参考图触发 413。');
})().catch((e) => {
  console.error('[X] 自检失败:', e && e.message ? e.message : e);
  process.exit(1);
});
