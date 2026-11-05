import './styles.css';
import { BASE } from './core/data';

const root = document.getElementById('app')!;
const path = location.pathname.slice(BASE.length - 1).replace(/\/+$/, '') || '/';

function webglOk() {
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}

if (!webglOk()) {
  root.innerHTML = '<div style="display:grid;place-items:center;height:100%;text-align:center;padding:24px;font-family:system-ui">Walk the Event needs WebGL 2. Try a recent Chrome, Safari or Firefox.</div>';
} else if (path.startsWith('/map')) {
  import('./map/map').then((m) => m.runMap(root));
} else if (path.startsWith('/stations')) {
  import('./gallery/gallery').then((m) => m.runGallery(root));
} else if (path.startsWith('/lab')) {
  import('./lab/lab').then((m) => m.runLab(root));
} else {
  import('./walk/app').then((m) => m.runWalk(root));
}
