let res = 24;
let threshBase = 0.5;
let mirrorMode = 'none';
let renderMode = 'realcolor'; // 'realcolor' | 'duotone' | 'stroke'
let usingFrontCam = true;
let colorA, colorB;

// Camera crop region (set each frame to maintain cover aspect ratio)
let camCropX = 0, camCropY = 0, camCropW = 1, camCropH = 1;

let capture;
let photoImg = null;   // loaded photo (p5.Image), null = use live camera
let svgRects = [];

const MAX_DEPTH = 2;
const MAX_N = 4;

function setup() {
  const container = document.getElementById('canvas-container');
  createCanvas(container.clientWidth, container.clientHeight).parent('canvas-container');
  colorMode(RGB);
  colorA = color(255, 255, 255);
  colorB = color(0, 0, 0);

  capture = createCapture({ video: { facingMode: 'user' }, audio: false });
  capture.hide();

  bindUI();

  // Re-sync canvas size now that p5 is ready
  setTimeout(() => { if (typeof updateSheetH === 'function') updateSheetH(); }, 0);
}

function bindUI() {
  select('#resSlider').elt.addEventListener('input', function () {
    res = int(this.value);
    select('#resValue').html(res);
  });
  select('#mirrorSelect').elt.addEventListener('change', function () {
    mirrorMode = this.value;
  });
  select('#threshSlider').elt.addEventListener('input', function () {
    threshBase = int(this.value) / 100;
    select('#threshValue').html(threshBase.toFixed(2));
  });
  select('#modeSelect').elt.addEventListener('change', function () {
    renderMode = this.value;
  });
  document.getElementById('flipCamBtn').addEventListener('click', function() {
    usingFrontCam = !usingFrontCam;
    this.textContent = usingFrontCam ? 'front' : 'back';
    switchCamera();
  });
  select('#colorA').elt.addEventListener('input', function () {
    colorA = hexToColor(this.value);
  });
  select('#colorB').elt.addEventListener('input', function () {
    colorB = hexToColor(this.value);
  });
  select('#exportPNG').elt.addEventListener('click', function () {
    saveCanvas('recursive_rasterizer', 'png');
  });
  select('#exportSVG').elt.addEventListener('click', exportSVG);

  document.getElementById('photoUpload').addEventListener('change', function () {
    let file = this.files[0];
    if (!file) return;
    let url = URL.createObjectURL(file);
    loadImage(url, function (img) {
      photoImg = img;
      photoImg.loadPixels();
    });
  });
}

function switchCamera() {
  capture.remove();
  capture = createCapture({ video: { facingMode: usingFrontCam ? 'user' : 'environment' }, audio: false });
  capture.hide();
}

function hexToColor(hex) {
  return color(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  );
}

// brightness [0..1] → N [MAX_N..1]  (dark = dense, light = sparse)
function brightnessToN(br) {
  return max(1, round(map(br, 0, 1, MAX_N, 1)));
}

function applyMirror(gx, gy) {
  let sx = gx, sy = gy;
  if (mirrorMode === 'mirrorX') {
    sx = gx < res / 2 ? gx : res - 1 - gx;
  } else if (mirrorMode === 'mirrorY') {
    sy = gy < res / 2 ? gy : res - 1 - gy;
  } else if (mirrorMode === 'mirrorXY') {
    sx = gx < res / 2 ? gx : res - 1 - gx;
    sy = gy < res / 2 ? gy : res - 1 - gy;
  } else if (mirrorMode === 'tileFlipX') {
    if (gx % 2 === 1) sx = res - 1 - gx;
  } else if (mirrorMode === 'tileFlipY') {
    if (gy % 2 === 1) sy = res - 1 - gy;
  } else if (mirrorMode === 'checkerMirror') {
    if (gx % 2 === 1) sx = res - 1 - gx;
    if (gy % 2 === 1) sy = res - 1 - gy;
  } else if (mirrorMode === 'pinwheel') {
    let qx = gx < res / 2 ? gx : res - 1 - gx;
    let qy = gy < res / 2 ? gy : res - 1 - gy;
    if (gx >= res / 2 && gy < res / 2) {
      sx = constrain(int(qy), 0, res - 1);
      sy = constrain(int(qx), 0, res - 1);
    } else if (gx < res / 2 && gy >= res / 2) {
      sx = constrain(int(res / 2 - 1 - qy), 0, res - 1);
      sy = constrain(int(res / 2 - 1 - qx), 0, res - 1);
    } else {
      sx = qx; sy = qy;
    }
  }
  return { sx, sy };
}

// Sample pixel at normalized position (0–1) from either photo or live camera.
// Returns { r, g, b, br } where br is brightness 0–1.
function sampleCamera(nx, ny) {
  let snx = usingFrontCam ? (1 - nx) : nx;

  let src = photoImg || capture;
  let px = constrain(floor(camCropX + snx * camCropW), 0, src.width - 1);
  let py = constrain(floor(camCropY + ny  * camCropH), 0, src.height - 1);
  let idx = (py * src.width + px) * 4;
  let r = src.pixels[idx];
  let g = src.pixels[idx + 1];
  let b = src.pixels[idx + 2];
  return { r, g, b, br: (r + g + b) / (3 * 255) };
}

function draw() {
  let src = photoImg || capture;
  if (!src.width || !src.height) return;

  // Compute cover crop so source fills the canvas
  let srcAR = src.width / src.height;
  let canvasAR = width / height;
  if (srcAR > canvasAR) {
    camCropH = src.height;
    camCropW = camCropH * canvasAR;
    camCropX = (src.width - camCropW) / 2;
    camCropY = 0;
  } else {
    camCropW = src.width;
    camCropH = camCropW / canvasAR;
    camCropX = 0;
    camCropY = (src.height - camCropH) / 2;
  }

  // Live camera needs loadPixels each frame; photo loads once on import
  if (!photoImg) capture.loadPixels();

  if (renderMode === 'stroke') background(colorB);
  else background(0);

  let tileW = width / res;
  let tileH = height / res;

  for (let gx = 0; gx < res; gx++) {
    for (let gy = 0; gy < res; gy++) {
      let { sx, sy } = applyMirror(gx, gy);
      // Normalized camera coords for this base tile
      let nx0 = sx / res,  ny0 = sy / res;
      let nw  = 1 / res,   nh  = 1 / res;

      drawTile(gx * tileW, gy * tileH, tileW, tileH,
               nx0, ny0, nw, nh, 0, false);
    }
  }
}

// nx0, ny0  — top-left of camera sample region (normalized 0–1)
// nw, nh    — size of camera sample region
function drawTile(x, y, w, h, nx0, ny0, nw, nh, depth, recording) {
  // Sample camera at center of this tile's region
  let { r, g, b, br } = sampleCamera(nx0 + nw * 0.5, ny0 + nh * 0.5);

  let N = brightnessToN(br);
  let isLeaf = (N === 1) || (br >= threshBase) || (depth >= MAX_DEPTH);

  if (renderMode === 'stroke') {
    // Grid lines only; colorA = line, colorB = background
    noFill();
    stroke(colorA);
    strokeWeight(0.5);
    rect(x, y, w, h);
    if (recording) svgRects.push({ isStroke: true, x, y, w, h,
      r: int(red(colorA)), g: int(green(colorA)), b: int(blue(colorA)) });
    if (!isLeaf) subdivide(x, y, w, h, nx0, ny0, nw, nh, N, depth, recording);

  } else {
    if (isLeaf) {
      noStroke();
      let fr, fg, fb;
      if (renderMode === 'realcolor') {
        fr = r; fg = g; fb = b;
      } else {
        // duotone: lerp colorA → colorB by brightness
        let c = lerpColor(colorB, colorA, br);
        fr = red(c); fg = green(c); fb = blue(c);
      }
      fill(fr, fg, fb);
      rect(x, y, w + 0.5, h + 0.5);
      if (recording) svgRects.push({ isStroke: false, x, y, w, h, r: int(fr), g: int(fg), b: int(fb) });
    } else {
      subdivide(x, y, w, h, nx0, ny0, nw, nh, N, depth, recording);
    }
  }
}

function subdivide(x, y, w, h, nx0, ny0, nw, nh, N, depth, recording) {
  let sw = w / N, sh = h / N;
  let snw = nw / N, snh = nh / N;
  for (let ix = 0; ix < N; ix++) {
    for (let iy = 0; iy < N; iy++) {
      drawTile(x + ix * sw, y + iy * sh, sw, sh,
               nx0 + ix * snw, ny0 + iy * snh, snw, snh,
               depth + 1, recording);
    }
  }
}

function exportSVG() {
  svgRects = [];

  let tileW = width / res;
  let tileH = height / res;
  for (let gx = 0; gx < res; gx++) {
    for (let gy = 0; gy < res; gy++) {
      let { sx, sy } = applyMirror(gx, gy);
      drawTile(gx * tileW, gy * tileH, tileW, tileH,
               sx / res, sy / res, 1 / res, 1 / res, 0, true);
    }
  }

  let bgCol = renderMode === 'stroke'
    ? `rgb(${int(red(colorB))},${int(green(colorB))},${int(blue(colorB))})`
    : 'black';

  let lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="${bgCol}"/>`
  ];
  for (let rec of svgRects) {
    if (rec.isStroke) {
      lines.push(`<rect x="${rec.x.toFixed(2)}" y="${rec.y.toFixed(2)}" width="${rec.w.toFixed(2)}" height="${rec.h.toFixed(2)}" fill="none" stroke="rgb(${rec.r},${rec.g},${rec.b})" stroke-width="0.5"/>`);
    } else {
      lines.push(`<rect x="${rec.x.toFixed(2)}" y="${rec.y.toFixed(2)}" width="${rec.w.toFixed(2)}" height="${rec.h.toFixed(2)}" fill="rgb(${rec.r},${rec.g},${rec.b})" stroke="none"/>`);
    }
  }
  lines.push('</svg>');

  let blob = new Blob([lines.join('\n')], { type: 'image/svg+xml' });
  let a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'recursive_rasterizer_cam.svg';
  a.click();
}

function windowResized() {
  const container = document.getElementById('canvas-container');
  resizeCanvas(container.clientWidth, container.clientHeight);
}
