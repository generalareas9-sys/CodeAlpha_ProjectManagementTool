const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Creates a valid PNG file buffer from raw RGBA pixel data
 */
function createPng(width, height, rgbaBuffer) {
    // PNG Signature
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression method
    ihdr[11] = 0; // filter method
    ihdr[12] = 0; // interlace method
    const ihdrChunk = makeChunk('IHDR', ihdr);

    // Scanlines with filter byte 0
    const scanlineLength = width * 4;
    const rawData = Buffer.alloc((scanlineLength + 1) * height);
    for (let y = 0; y < height; y++) {
        rawData[y * (scanlineLength + 1)] = 0; // filter None
        rgbaBuffer.copy(
            rawData,
            y * (scanlineLength + 1) + 1,
            y * scanlineLength,
            (y + 1) * scanlineLength
        );
    }

    const compressed = zlib.deflateSync(rawData);
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crc >>> 0, 8 + len);
    return buf;
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
}

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return c ^ 0xFFFFFFFF;
}

/**
 * Render brand gradient icon onto RGBA buffer
 */
function renderBrandIcon(width, height) {
    const buffer = Buffer.alloc(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const t = (x + y) / (width + height);

            // Background dark surface
            let r = 15;
            let g = 16;
            let b = 32;
            let a = 255;

            // Rounded rectangle mask for app icon
            const pad = Math.floor(width * 0.12);
            if (x >= pad && x < width - pad && y >= pad && y < height - pad) {
                // Gradient #6366F1 -> #8B5CF6 -> #EC4899
                if (t < 0.5) {
                    const factor = t * 2;
                    r = Math.round(99 + (139 - 99) * factor);
                    g = Math.round(102 + (92 - 102) * factor);
                    b = Math.round(241 + (246 - 241) * factor);
                } else {
                    const factor = (t - 0.5) * 2;
                    r = Math.round(139 + (236 - 139) * factor);
                    g = Math.round(92 + (72 - 92) * factor);
                    b = Math.round(246 + (153 - 246) * factor);
                }
            }

            buffer[idx] = r;
            buffer[idx + 1] = g;
            buffer[idx + 2] = b;
            buffer[idx + 3] = a;
        }
    }
    return buffer;
}

/**
 * Render Open Graph social share banner (1200x630)
 */
function renderOgImage(width, height) {
    const buffer = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const t = (x + y) / (width + height);

            // Rich dark gradient background #0F1020 to #1A1836
            let r = Math.round(15 + 15 * t);
            let g = Math.round(16 + 10 * t);
            let b = Math.round(32 + 25 * t);

            // Accent light glow near top-left
            const distFromTopLeft = Math.hypot(x - 200, y - 200);
            if (distFromTopLeft < 350) {
                const glow = Math.cos((distFromTopLeft / 350) * (Math.PI / 2));
                r = Math.min(255, Math.round(r + 99 * 0.4 * glow));
                g = Math.min(255, Math.round(g + 102 * 0.4 * glow));
                b = Math.min(255, Math.round(b + 241 * 0.4 * glow));
            }

            buffer[idx] = r;
            buffer[idx + 1] = g;
            buffer[idx + 2] = b;
            buffer[idx + 3] = 255;
        }
    }
    return buffer;
}

/**
 * Simple Windows ICO file packaging 16x16 and 32x32 PNGs
 */
function createIco(png16, png32) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type 1 = ICO
    header.writeUInt16LE(2, 4); // 2 images

    const entry1 = Buffer.alloc(16);
    entry1.writeUInt8(16, 0); // width
    entry1.writeUInt8(16, 1); // height
    entry1.writeUInt8(0, 2); // color count
    entry1.writeUInt8(0, 3); // reserved
    entry1.writeUInt16LE(1, 4); // color planes
    entry1.writeUInt16LE(32, 6); // bpp
    entry1.writeUInt32LE(png16.length, 8); // size
    entry1.writeUInt32LE(6 + 32, 12); // offset

    const entry2 = Buffer.alloc(16);
    entry2.writeUInt8(32, 0); // width
    entry2.writeUInt8(32, 1); // height
    entry2.writeUInt8(0, 2); // color count
    entry2.writeUInt8(0, 3); // reserved
    entry2.writeUInt16LE(1, 4); // color planes
    entry2.writeUInt16LE(32, 6); // bpp
    entry2.writeUInt32LE(png32.length, 8); // size
    entry2.writeUInt32LE(6 + 32 + png16.length, 12); // offset

    return Buffer.concat([header, entry1, entry2, png16, png32]);
}

// Generate files into public/
const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

console.log('Generating favicon and OG assets...');

const png16 = createPng(16, 16, renderBrandIcon(16, 16));
fs.writeFileSync(path.join(publicDir, 'favicon-16.png'), png16);

const png32 = createPng(32, 32, renderBrandIcon(32, 32));
fs.writeFileSync(path.join(publicDir, 'favicon-32.png'), png32);

const png180 = createPng(180, 180, renderBrandIcon(180, 180));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180);

const ogPng = createPng(1200, 630, renderOgImage(1200, 630));
fs.writeFileSync(path.join(publicDir, 'og-image.png'), ogPng);

const ico = createIco(png16, png32);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), ico);

console.log('All favicon and brand assets generated successfully!');
