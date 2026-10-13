// 生成 NSIS 兼容的传统 BMP 格式多尺寸 ICO
// 使用 nativeImage.toBitmap() 获取标准 DIB 数据
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT_DIR = path.join(__dirname, 'build');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" rx="56" fill="#FFF4E6"/>
  <path d="M58 90 L40 28 L104 70 Z" fill="#F5A623"/>
  <path d="M66 82 L52 44 L92 68 Z" fill="#FFB6C1"/>
  <path d="M198 90 L216 28 L152 70 Z" fill="#F5A623"/>
  <path d="M190 82 L204 44 L164 68 Z" fill="#FFB6C1"/>
  <ellipse cx="128" cy="118" rx="72" ry="66" fill="#F5A623"/>
  <path d="M128 54 L128 74" stroke="#E8852A" stroke-width="6" stroke-linecap="round"/>
  <path d="M96 62 Q102 72 96 80" stroke="#E8852A" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M160 62 Q154 72 160 80" stroke="#E8852A" stroke-width="5" stroke-linecap="round" fill="none"/>
  <ellipse cx="128" cy="138" rx="42" ry="34" fill="#FFF4E6"/>
  <ellipse cx="100" cy="112" rx="13" ry="17" fill="#2B2B2B"/>
  <ellipse cx="156" cy="112" rx="13" ry="17" fill="#2B2B2B"/>
  <ellipse cx="104" cy="106" rx="4.5" ry="6" fill="#fff"/>
  <ellipse cx="160" cy="106" rx="4.5" ry="6" fill="#fff"/>
  <path d="M122 134 L134 134 L128 142 Z" fill="#FF9DAE"/>
  <path d="M128 142 Q128 152 116 152" stroke="#7a4a1e" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M128 142 Q128 152 140 152" stroke="#7a4a1e" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="78" cy="128" rx="12" ry="7" fill="#FF9DAE" opacity="0.6"/>
  <ellipse cx="178" cy="128" rx="12" ry="7" fill="#FF9DAE" opacity="0.6"/>
  <path d="M84 128 L54 122" stroke="#9a6a3e" stroke-width="2" stroke-linecap="round"/>
  <path d="M84 136 L54 140" stroke="#9a6a3e" stroke-width="2" stroke-linecap="round"/>
  <path d="M172 128 L202 122" stroke="#9a6a3e" stroke-width="2" stroke-linecap="round"/>
  <path d="M172 136 L202 140" stroke="#9a6a3e" stroke-width="2" stroke-linecap="round"/>
</svg>`;

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<html><head><style>*{margin:0;padding:0}html,body{background:transparent}</style></head><body>${svg}</body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.webContents.on('paint', (_e, _dirty, image) => {
    const base = nativeImage.createFromBuffer(image.toPNG());

    // 生成 PNG（512x512，给 electron-builder win.icon 用）
    const png512 = base.resize({ width: 512, height: 512 }).toPNG();
    fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png512);

    // 构建 NSIS 兼容的传统 BMP 格式多尺寸 ICO
    // nativeImage.toBitmap() 返回 BGRA 格式的 DIB（不含 BITMAPINFOHEADER）
    const sizes = [256, 48, 32, 16];
    const dibs = [];
    for (const s of sizes) {
      const ni = base.resize({ width: s, height: s });
      const bitmap = ni.toBitmap(); // BGRA 数据，大小 = s*s*4
      // 构建 DIB：BITMAPINFOHEADER(40) + 像素数据 + AND mask
      const header = Buffer.alloc(40);
      header.writeUInt32LE(40, 0);        // biSize
      header.writeInt32LE(s, 4);           // biWidth
      header.writeInt32LE(s * 2, 8);       // biHeight (2x for XOR+AND)
      header.writeUInt16LE(1, 12);         // biPlanes
      header.writeUInt16LE(32, 14);        // biBitCount (32bpp)
      header.writeUInt32LE(0, 16);         // biCompression (BI_RGB)
      header.writeUInt32LE(bitmap.length + Math.ceil(s / 8) * s, 20); // biSizeImage
      // 像素数据（BGRA，已含 alpha）就是 toBitmap() 的输出
      // AND mask：每行 ceil(s/8) 字节，全 0（透明）
      const andMaskRowSize = Math.ceil(s / 8);
      const andMask = Buffer.alloc(andMaskRowSize * s, 0);
      const dib = Buffer.concat([header, bitmap, andMask]);
      dibs.push({ size: s, data: dib });
    }

    // 构建 ICO 文件
    // ICONDIR: reserved(2) + count(2)
    const dir = Buffer.alloc(6);
    dir.writeUInt16LE(0, 0);
    dir.writeUInt16LE(dibs.length, 2);
    // ICONDIRENTRY: 每个 16 字节
    const entries = [];
    let offset = 6 + dibs.length * 16;
    for (const d of dibs) {
      const e = Buffer.alloc(16);
      e.writeUInt8(d.size === 256 ? 0 : d.size, 0);  // width
      e.writeUInt8(d.size === 256 ? 0 : d.size, 1);   // height
      e.writeUInt8(0, 2);    // colors
      e.writeUInt8(0, 3);    // reserved
      e.writeUInt16LE(1, 4);  // planes
      e.writeUInt16LE(32, 6); // bitcount
      e.writeUInt32LE(d.data.length, 8);  // size of DIB
      e.writeUInt32LE(offset, 12);         // offset
      entries.push(e);
      offset += d.data.length;
    }
    const ico = Buffer.concat([dir, ...entries, ...dibs.map(d => d.data)]);
    fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

    console.log('图标生成完成:');
    console.log('  icon.png:', nativeImage.createFromBuffer(png512).getSize());
    console.log('  icon.ico:', ico.length, 'bytes，含尺寸:', sizes.join(', '));
    win.close();
    app.quit();
  });
});
