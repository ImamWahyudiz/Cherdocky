import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import fs from 'fs';
// Vite plugin to serve .wasm files with correct MIME type from public directory
function wasmServePlugin() {
    var publicDir = path.resolve(__dirname, 'public');
    var wasmCache = new Map();
    return {
        name: 'wasm-serve',
        buildStart: function () {
            // Pre-load all WASM files at build start
            var wasmFiles = fs.readdirSync(publicDir).filter(function (f) { return f.endsWith('.wasm'); });
            for (var _i = 0, wasmFiles_1 = wasmFiles; _i < wasmFiles_1.length; _i++) {
                var file = wasmFiles_1[_i];
                var filePath = path.join(publicDir, file);
                wasmCache.set(file, fs.readFileSync(filePath));
            }
            console.log("[wasm-serve] Loaded ".concat(wasmCache.size, " WASM files: ").concat(Array.from(wasmCache.keys()).join(', ')));
        },
        configureServer: function (server) {
            server.middlewares.use(function (req, res, next) {
                var url = req.url || '';
                // Match any .wasm file request
                var match = url.match(/\/([^/]+\.wasm)(?:\?|$)/);
                if (match && wasmCache.has(match[1])) {
                    var wasmBuffer = wasmCache.get(match[1]);
                    res.setHeader('Content-Type', 'application/wasm');
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                    res.end(wasmBuffer);
                    return;
                }
                next();
            });
        },
    };
}
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [vue(), wasmServePlugin()],
    resolve: {
        alias: {
            '~': path.resolve(__dirname, './src')
        }
    },
    // Set base path for GitHub Pages (https://<username>.github.io/Cherdocky/)
    base: process.env.NODE_ENV === 'production' ? '/Cherdocky/' : '/',
    server: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
});
