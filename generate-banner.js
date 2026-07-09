const { createCanvas } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const fs = require('fs');
const path = require('path');

const width = 800;
const height = 200;

function generateBanner(filename, frames) {
    const encoder = new GIFEncoder(width, height);
    encoder.setDelay(2000); // 2 seconds per frame
    encoder.setRepeat(0); // loop forever
    encoder.start();

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        // Background
        ctx.fillStyle = '#111827'; // Dark gray
        ctx.fillRect(0, 0, width, height);

        // Glowing border
        ctx.strokeStyle = frame.color;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, width - 10, height - 10);

        // Main Text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 50px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(frame.text1, width / 2, 80);

        // Subtitle Text
        ctx.fillStyle = frame.color;
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(frame.text2, width / 2, 140);

        encoder.addFrame(ctx);
    }

    encoder.finish();
    const buffer = encoder.out.getData();
    const outPath = path.join(__dirname, 'public', filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`Successfully created public/${filename}`);
}

const framesEn = [
    { text1: "Love Meshlog?", text2: "Share it with your friends!", color: "#00bcd4" },
    { text1: "Analyze RF Logs", text2: "Find your nodes instantly", color: "#4caf50" },
    { text1: "Deep Packet Inspection", text2: "Live Terminal & Traceroutes", color: "#e91e63" },
    { text1: "100% Free & Local", text2: "Works Offline as a PWA", color: "#ffeb3b" },
    { text1: "Click here to share", text2: "on WhatsApp!", color: "#25D366" },
];

const framesPt = [
    { text1: "Adoras o Meshlog?", text2: "Partilha com os teus amigos!", color: "#00bcd4" },
    { text1: "Analisa Logs RF", text2: "Encontra os teus nós", color: "#4caf50" },
    { text1: "Deep Packet Inspection", text2: "Terminal Live & Traceroutes", color: "#e91e63" },
    { text1: "100% Grátis e Local", text2: "Funciona Offline (PWA)", color: "#ffeb3b" },
    { text1: "Clica aqui para partilhar", text2: "no WhatsApp!", color: "#25D366" },
];

generateBanner('banner_en.gif', framesEn);
generateBanner('banner_pt.gif', framesPt);
