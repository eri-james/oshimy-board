import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSS_FILES = [
    path.join(__dirname, 'asset', 'css', 'core.css'),
    path.join(__dirname, 'asset', 'css', 'layout.css'),
    path.join(__dirname, 'asset', 'css', 'themes.css')
];

const JS_FILES = [
    path.join(__dirname, 'asset', 'js', 'config.js'),
    path.join(__dirname, 'asset', 'js', 'utils.js'),
    path.join(__dirname, 'asset', 'js', 'media.js'),
    path.join(__dirname, 'asset', 'js', 'gamification.js'),
    path.join(__dirname, 'asset', 'js', 'app.js')
];

const CSS_OUTPUT = path.join(__dirname, 'asset', 'css', 'bundle.min.css');
const JS_OUTPUT = path.join(__dirname, 'asset', 'js', 'bundle.min.js');

async function build() {
    console.log('📦 Starting asset bundling & minification...\n');

    // 1. Bundle & Minify CSS
    console.log('🎨 Processing CSS styles:');
    let combinedCss = '';
    let rawCssBytes = 0;
    for (const file of CSS_FILES) {
        const content = fs.readFileSync(file, 'utf8');
        const size = Buffer.byteLength(content, 'utf8');
        rawCssBytes += size;
        console.log(`  - ${path.basename(file)}: ${(size / 1024).toFixed(1)} KB`);
        combinedCss += content + '\n';
    }

    const minifiedCss = await esbuild.transform(combinedCss, {
        loader: 'css',
        minify: true
    });

    fs.writeFileSync(CSS_OUTPUT, minifiedCss.code, 'utf8');
    const minCssBytes = Buffer.byteLength(minifiedCss.code, 'utf8');
    const cssReduction = (((rawCssBytes - minCssBytes) / rawCssBytes) * 100).toFixed(1);
    console.log(`  ➔ Generated: asset/css/bundle.min.css (${(minCssBytes / 1024).toFixed(1)} KB, -${cssReduction}% reduction)\n`);

    // 2. Bundle & Minify JavaScript
    console.log('⚡ Processing JavaScript modules:');
    let combinedJs = '';
    let rawJsBytes = 0;
    for (const file of JS_FILES) {
        const content = fs.readFileSync(file, 'utf8');
        const size = Buffer.byteLength(content, 'utf8');
        rawJsBytes += size;
        console.log(`  - ${path.basename(file)}: ${(size / 1024).toFixed(1)} KB`);
        combinedJs += content + '\n;\n';
    }

    const minifiedJs = await esbuild.transform(combinedJs, {
        loader: 'js',
        minify: true,
        target: 'es2020'
    });

    fs.writeFileSync(JS_OUTPUT, minifiedJs.code, 'utf8');
    const minJsBytes = Buffer.byteLength(minifiedJs.code, 'utf8');
    const jsReduction = (((rawJsBytes - minJsBytes) / rawJsBytes) * 100).toFixed(1);
    console.log(`  ➔ Generated: asset/js/bundle.min.js (${(minJsBytes / 1024).toFixed(1)} KB, -${jsReduction}% reduction)\n`);

    // Total summary
    const totalRaw = rawCssBytes + rawJsBytes;
    const totalMin = minCssBytes + minJsBytes;
    const totalReduction = (((totalRaw - totalMin) / totalRaw) * 100).toFixed(1);
    console.log(`✨ Bundling Complete!`);
    console.log(`   Combined raw assets: ${(totalRaw / 1024).toFixed(1)} KB across 8 HTTP requests`);
    console.log(`   Optimized bundle:   ${(totalMin / 1024).toFixed(1)} KB across 2 HTTP requests (-${totalReduction}% reduction)\n`);
}

build().catch(err => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
