import * as THREE from 'three';

export type Eyes = 'open' | 'closed' | 'happy' | 'wide';
export type Mouth = 'smile' | 'open' | 'o' | 'grin' | 'flat';

/** Manga face painted into a canvas: big glossy eyes, small brows, tiny nose, blush. */
export class Face {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  private key = '';
  lookX = 0;
  lookY = 0;

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw('open', 'smile');
  }

  draw(eyes: Eyes, mouth: Mouth) {
    const lx = Math.round(this.lookX * 10) / 10;
    const ly = Math.round(this.lookY * 10) / 10;
    const key = `${eyes}|${mouth}|${lx}|${ly}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 512);
    const ink = '#0b0a10';
    // Face layout: the texture is wrapped on the front cap; centre (256, 256).
    const eyeY = 268;
    for (const side of [-1, 1]) {
      const ex = 256 + side * 86;
      // brows: short confident strokes
      c.strokeStyle = ink;
      c.lineCap = 'round';
      c.lineWidth = 9;
      c.beginPath();
      c.moveTo(ex - side * 30, eyeY - 74);
      c.quadraticCurveTo(ex, eyeY - 88 - (eyes === 'wide' ? 8 : 0), ex + side * 34, eyeY - 76);
      c.stroke();
      if (eyes === 'closed') {
        c.lineWidth = 10;
        c.beginPath();
        c.moveTo(ex - 36, eyeY + 4);
        c.quadraticCurveTo(ex, eyeY + 22, ex + 36, eyeY + 4);
        c.stroke();
        continue;
      }
      if (eyes === 'happy') {
        c.lineWidth = 11;
        c.beginPath();
        c.moveTo(ex - 36, eyeY + 10);
        c.quadraticCurveTo(ex, eyeY - 30, ex + 36, eyeY + 10);
        c.stroke();
        continue;
      }
      const h = eyes === 'wide' ? 82 : 76;
      // upper lash line: thick, slightly flicked at the outer corner
      c.fillStyle = ink;
      c.beginPath();
      c.ellipse(ex, eyeY, 64, h, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fbfaf7';
      c.beginPath();
      c.ellipse(ex, eyeY + 4, 56, h - 8, 0, 0, Math.PI * 2);
      c.fill();
      // iris + pupil (look direction shifts them)
      const ix = ex + lx * 10, iy = eyeY + 10 + ly * 8;
      const g = c.createLinearGradient(0, iy - 44, 0, iy + 44);
      g.addColorStop(0, '#15121c');
      g.addColorStop(0.65, '#3a2f4d');
      g.addColorStop(1, '#6d5a86');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(ix, iy, 44, h - 18, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = ink;
      c.beginPath();
      c.ellipse(ix, iy + 2, 13, 22, 0, 0, Math.PI * 2);
      c.fill();
      // manga highlights
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(ix - side * 9 - 4, iy - 18, 10, 13, -0.3, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(ix + side * 10, iy + 20, 5, 5, 0, 0, Math.PI * 2);
      c.fill();
      // heavy upper lid
      c.strokeStyle = ink;
      c.lineWidth = 14;
      c.beginPath();
      c.ellipse(ex, eyeY + 4, 62, h - 4, 0, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(ex + side * 34, eyeY - h + 22);
      c.lineTo(ex + side * 50, eyeY - h + 10);
      c.stroke();
    }
    // nose: a tiny hook
    c.strokeStyle = 'rgba(11,10,16,0.75)';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(258, 316);
    c.lineTo(252, 326);
    c.stroke();
    // freckles, like the drawing
    c.fillStyle = 'rgba(120,60,50,0.55)';
    for (const side of [-1, 1]) for (const [dx, dy] of [[-14, 0], [0, 7], [14, 1], [6, -8]]) {
      c.beginPath(); c.arc(256 + side * 92 + dx, 342 + dy, 3.2, 0, Math.PI * 2); c.fill();
    }
    // blush
    for (const side of [-1, 1]) {
      const g = c.createRadialGradient(256 + side * 98, 322, 2, 256 + side * 98, 322, 34);
      g.addColorStop(0, 'rgba(255,120,150,0.45)');
      g.addColorStop(1, 'rgba(255,120,150,0)');
      c.fillStyle = g;
      c.fillRect(256 + side * 98 - 40, 282, 80, 80);
      c.strokeStyle = 'rgba(200,60,90,0.35)';
      c.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        c.moveTo(256 + side * 98 - 16 + k * 11, 318);
        c.lineTo(256 + side * 98 - 22 + k * 11, 330);
        c.stroke();
      }
    }
    // mouth
    c.strokeStyle = ink;
    c.fillStyle = '#5a1e2e';
    c.lineWidth = 7;
    const my = 352;
    c.beginPath();
    switch (mouth) {
      case 'smile':
        c.moveTo(232, my);
        c.quadraticCurveTo(256, my + 16, 280, my);
        c.stroke();
        break;
      case 'grin':
        c.moveTo(226, my - 4);
        c.quadraticCurveTo(256, my + 34, 286, my - 4);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      case 'open':
        c.ellipse(256, my + 6, 16, 14, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        break;
      case 'o':
        c.ellipse(256, my + 6, 9, 11, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        break;
      default:
        c.moveTo(238, my + 4);
        c.lineTo(274, my + 4);
        c.stroke();
    }
    this.texture.needsUpdate = true;
  }
}
