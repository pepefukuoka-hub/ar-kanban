(function () {
  'use strict';
  const KEY = 'ar.signs.v1';
  const $ = (id) => document.getElementById(id);
  let signs = load();
  let here = null;           // {lat, lng, acc}
  let editing = null;        // 編集中の看板(新規は null)
  let map = null, pin = null;
  let arStarted = false;
  let camEl = null;          // ARのカメラ(向きの補正と診断に使う)

  // ---------- データ ----------
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(signs)); return true; }
    catch (e) { return false; }
  }
  const newId = () => 'sign-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function dist(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const fmt = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');

  function getHere() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => { here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; resolve(here); },
        (e) => reject(e),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    });
  }
  function geoMessage(e) {
    if (e && e.code === 1) return '位置情報が許可されていません。設定 > プライバシーとセキュリティ > 位置情報サービス > Safari(またはChrome)で許可して、ページを開き直してください。';
    if (e && e.code === 3) return '位置の取得に時間がかかっています。空の開けた場所でもう一度試してください。';
    if (e && e.message === 'unsupported') return 'この端末は位置情報に対応していません。';
    return '位置を取得できませんでした。';
  }

  // ---------- 画面の切り替え ----------
  function show(name) {
    ['list', 'edit', 'ar'].forEach((n) => { $(n + 'Screen').hidden = n !== name; });
    window.scrollTo(0, 0);
  }

  // ---------- 一覧 ----------
  function renderList() {
    $('count').textContent = signs.length ? signs.length + ' 件' : '';
    const ul = $('list');
    ul.textContent = '';
    if (!signs.length) {
      const li = document.createElement('li');
      li.className = 'empty'; li.style.display = 'block';
      li.textContent = 'まだ看板がありません。「新しい看板」から作るか、いまの場所のすぐ近くにテスト看板を作って、見え方を確かめてください。';
      const b = document.createElement('button');
      b.className = 'primary'; b.style.marginTop = '12px'; b.style.width = '100%';
      b.textContent = 'いまの場所にテスト看板を作る';
      b.onclick = makeTestSign;
      li.appendChild(document.createElement('br')); li.appendChild(b);
      ul.appendChild(li);
      return;
    }
    signs.forEach((s) => {
      const li = document.createElement('li');
      const t = document.createElement('div'); t.className = 't'; t.textContent = s.name;
      const d = document.createElement('div'); d.className = 'd';
      d.textContent = here ? fmt(dist(here, s)) : '';
      li.append(t, d);
      if (s.access) { const a = document.createElement('div'); a.className = 'a'; a.textContent = s.access; li.appendChild(a); }
      const acts = document.createElement('div'); acts.className = 'acts';
      const ed = document.createElement('button'); ed.className = 'small'; ed.textContent = '編集';
      ed.onclick = () => openEdit(s);
      const del = document.createElement('button'); del.className = 'small danger'; del.textContent = '削除';
      del.onclick = () => {
        if (del.dataset.arm) { signs = signs.filter((x) => x.id !== s.id); save(); renderList(); }
        else { del.dataset.arm = '1'; del.textContent = 'もう一度押すと削除'; setTimeout(() => { del.dataset.arm = ''; del.textContent = '削除'; }, 3000); }
      };
      acts.append(ed, del);
      li.appendChild(acts);
      ul.appendChild(li);
    });
  }
  function listMsg(t) { $('listMsg').textContent = t; }

  async function makeTestSign() {
    listMsg('現在地を取得しています…');
    try {
      const h = await getHere();
      signs.push({
        id: newId(), name: 'テスト看板', lat: h.lat + 5 / 110540, lng: h.lng,
        access: 'この場所から北へ約5m。', description: 'AR画面で、この看板が見えるか確かめるためのテストです。',
        height: 2, createdAt: new Date().toISOString()
      });
      save(); renderList();
      listMsg('北へ約5mの位置にテスト看板を作りました。「ARで見る」で確認してください。');
    } catch (e) { listMsg(geoMessage(e)); }
  }

  // ---------- 編集 ----------
  function ensureMap() {
    if (map) return;
    map = L.map('map').setView([34.66, 133.92], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, false));
  }
  function setPoint(lat, lng, recenter) {
    $('fLat').value = lat.toFixed(6);
    $('fLng').value = lng.toFixed(6);
    if (pin) pin.setLatLng([lat, lng]); else pin = L.marker([lat, lng]).addTo(map);
    if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 17));
  }
  function openEdit(s) {
    editing = s || null;
    $('editTitle').textContent = s ? '看板を編集' : '看板を作る';
    $('fName').value = s ? s.name : '';
    $('fAccess').value = s ? s.access || '' : '';
    $('fDesc').value = s ? s.description || '' : '';
    $('fHeight').value = s && isNum(s.height) ? s.height : 2;
    $('fLat').value = s ? s.lat : '';
    $('fLng').value = s ? s.lng : '';
    $('editMsg').textContent = '';
    show('edit');
    ensureMap();
    if (pin) { pin.remove(); pin = null; }
    setTimeout(() => {
      map.invalidateSize();
      if (s) setPoint(s.lat, s.lng, true);
      else if (here) map.setView([here.lat, here.lng], 16);
    }, 50);
  }
  $('hereBtn').onclick = async () => {
    $('editMsg').textContent = '現在地を取得しています…';
    try { const h = await getHere(); setPoint(h.lat, h.lng, true); $('editMsg').textContent = '現在地を入れました(精度 約' + Math.round(h.acc) + ' m)。'; }
    catch (e) { $('editMsg').textContent = geoMessage(e); }
  };
  const syncFromInputs = () => {
    const lat = parseFloat($('fLat').value), lng = parseFloat($('fLng').value);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) setPoint(lat, lng, true);
  };
  $('fLat').onchange = syncFromInputs;
  $('fLng').onchange = syncFromInputs;
  $('cancelBtn').onclick = () => { show('list'); };
  $('form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('fName').value.trim();
    const lat = parseFloat($('fLat').value), lng = parseFloat($('fLng').value);
    const h = parseFloat($('fHeight').value);
    if (!name) { $('editMsg').textContent = '場所の名前を入れてください。'; $('fName').focus(); return; }
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { $('editMsg').textContent = '位置が未指定です。地図をタップするか、現在地ボタンを押してください。'; return; }
    const rec = {
      id: editing ? editing.id : newId(), name, lat, lng,
      access: $('fAccess').value.trim(), description: $('fDesc').value.trim(),
      height: isFinite(h) && h >= 0 ? h : 2,
      createdAt: editing ? editing.createdAt : new Date().toISOString()
    };
    if (editing) signs = signs.map((x) => (x.id === editing.id ? rec : x)); else signs.push(rec);
    if (!save()) { $('editMsg').textContent = '保存できませんでした。書き出しでバックアップを取ってください。'; return; }
    renderList(); show('list'); listMsg('保存しました。');
  };

  // ---------- 書き出し・読み込み ----------
  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ signs }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ar-kanban.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const v = JSON.parse(r.result);
        const arr = Array.isArray(v) ? v : v.signs;
        if (!Array.isArray(arr)) throw new Error('形式');
        const ids = new Set(signs.map((s) => s.id));
        let n = 0;
        arr.forEach((s) => {
          if (!s || !s.name || !isNum(s.lat) || !isNum(s.lng)) return;
          let id = String(s.id || newId());
          if (ids.has(id)) id = newId();
          ids.add(id);
          signs.push({ id, name: String(s.name).slice(0, 40), lat: s.lat, lng: s.lng, access: String(s.access || '').slice(0, 300), description: String(s.description || '').slice(0, 600), height: isNum(s.height) ? s.height : 2, createdAt: s.createdAt || new Date().toISOString() });
          n++;
        });
        save(); renderList(); listMsg(n + ' 件を読み込みました。');
      } catch (err) { listMsg('読み込めないファイルです。'); }
    };
    r.readAsText(f); e.target.value = '';
  };

  $('newBtn').onclick = () => openEdit(null);
  $('arBtn').onclick = () => { $('arMsg').textContent = ''; show('ar'); };
  $('arBack').onclick = () => { show('list'); };

  // ---------- AR ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('読み込み失敗: ' + src));
      document.head.appendChild(s);
    });
  }

  function registerComponents() {
    // AR.js 3.4.5 のスマホ用の向き処理は、THREEx.DeviceOrientationControls を探すが、ビルドに含まれず必ずエラーになる。
    // そのため、同じ役割の部品をここで用意する(three.js の DeviceOrientationControls と同じ計算)。
    window.THREEx = window.THREEx || {};
    if (!window.THREEx.DeviceOrientationControls) {
      window.THREEx.DeviceOrientationControls = function (object) {
        const me = this;
        this.object = object;
        this.object.rotation.reorder('YXZ');
        this.enabled = true;
        this.deviceOrientation = null;
        this.screenOrientation = 0;
        this.alphaOffset = 0;        // iPhoneのコンパス補正に使う(ラジアン)
        this.smoothingFactor = 1;
        const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
        const onDevice = (e) => { me.deviceOrientation = e; };
        const onScreen = () => { me.screenOrientation = window.orientation || 0; };
        const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion();
        const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));   // 端末の上を、カメラの前に合わせる
        this.connect = function () { onScreen(); window.addEventListener('orientationchange', onScreen); window.addEventListener(eventName, onDevice); me.enabled = true; };
        this.disconnect = function () { window.removeEventListener('orientationchange', onScreen); window.removeEventListener(eventName, onDevice); me.enabled = false; };
        this.update = function () {
          const d = me.deviceOrientation;
          if (!me.enabled || !d) return;
          const rad = THREE.MathUtils.degToRad;
          const alpha = rad(d.alpha || 0) + me.alphaOffset;
          const beta = d.beta ? rad(d.beta) : 0, gamma = d.gamma ? rad(d.gamma) : 0;
          const orient = me.screenOrientation ? rad(me.screenOrientation) : 0;
          euler.set(beta, alpha, -gamma, 'YXZ');
          me.object.quaternion.setFromEuler(euler);
          me.object.quaternion.multiply(q1);
          me.object.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
        };
        this.connect();
      };
    }
    // A-Frameの標準の文字表示は日本語に対応しないため、看板の文字は画像にして貼る
    // キャラクターは、水平方向だけ見ている人の方を向く
    AFRAME.registerComponent('face-yaw', {
      init: function () { this._cp = new THREE.Vector3(); this._p = new THREE.Vector3(); },
      tick: function () {
        const cam = this.el.sceneEl.camera;
        if (!cam) return;
        cam.getWorldPosition(this._cp); this.el.object3D.getWorldPosition(this._p);
        this.el.object3D.rotation.y = Math.atan2(this._cp.x - this._p.x, this._cp.z - this._p.z);
      }
    });
    AFRAME.registerComponent('sign-card', {
      schema: { name: { type: 'string' }, w: { default: 9 }, h: { default: 2.8 } },
      init: function () {
        const d = this.data;
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = Math.round(1024 * d.h / d.w);
        this.tex = new THREE.CanvasTexture(this.canvas);
        const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, toneMapped: false });
        this.el.setObject3D('mesh', new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), mat));
        this._cp = new THREE.Vector3(); this._p = new THREE.Vector3();
        this.label = null;
        this.draw('');
      },
      draw: function (distText) {
        const c = this.canvas, g = c.getContext('2d'), W = c.width, H = c.height, r = 44;
        g.clearRect(0, 0, W, H);
        g.beginPath();
        g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r); g.closePath();
        g.fillStyle = 'rgba(20,24,28,0.9)'; g.fill();
        g.lineWidth = 10; g.strokeStyle = '#e8b83a'; g.stroke();
        const family = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
        let size = 120;
        g.font = '700 ' + size + 'px ' + family;
        while (g.measureText(this.data.name).width > W - 100 && size > 40) { size -= 6; g.font = '700 ' + size + 'px ' + family; }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#ffffff';
        g.fillText(this.data.name, W / 2, H * 0.40);
        g.font = '700 84px ' + family;
        g.fillStyle = '#e8b83a';
        g.fillText(distText, W / 2, H * 0.76);
        this.tex.needsUpdate = true;
      },
      setDistance: function (m) {
        const t = fmt(m);
        if (t === this.label) return;
        this.label = t;
        this.draw(t);
      },
      tick: function () {
        const cam = this.el.sceneEl.camera;
        if (!cam) return;
        cam.getWorldPosition(this._cp);
        this.el.object3D.getWorldPosition(this._p);
        const d = this._cp.distanceTo(this._p);
        this.el.object3D.lookAt(this._cp);
        // 遠くでも読めるように、距離に応じて大きくする(12m までは等倍)
        this.el.object3D.scale.setScalar(Math.min(80, Math.max(0.25, d / 12)));
      }
    });
  }

  function el(tag, attrs, parent) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  // 丸いキャラクター。身長 約1.8m。顔はいつも見ている人の方を向く
  function makeCharacter(color, label) {
    const root = el('a-entity', { 'face-yaw': '' });
    el('a-sphere', { radius: 0.55, color, position: '0 0.55 0', scale: '1 1.05 1' }, root);                    // からだ
    el('a-sphere', { radius: 0.42, color, position: '0 1.4 0' }, root);                                         // あたま
    el('a-cone', { 'radius-bottom': 0.14, 'radius-top': 0, height: 0.3, color, position: '-0.26 1.85 0' }, root); // みみ
    el('a-cone', { 'radius-bottom': 0.14, 'radius-top': 0, height: 0.3, color, position: '0.26 1.85 0' }, root);
    [-0.15, 0.15].forEach((x) => {
      el('a-sphere', { radius: 0.09, color: '#ffffff', position: x + ' 1.45 0.34' }, root);                     // め
      el('a-sphere', { radius: 0.045, color: '#111111', position: x + ' 1.45 0.42' }, root);
    });
    el('a-sphere', { radius: 0.07, color: '#ff7a7a', position: '0 1.32 0.4' }, root);                           // はな
    el('a-sphere', { radius: 0.17, color, position: '-0.55 0.65 0' }, root);                                    // て
    el('a-sphere', { radius: 0.17, color, position: '0.55 0.65 0' }, root);
    const lab = el('a-entity', { position: '0 2.5 0', 'sign-card': 'name: ' + label + '; w: 4.5; h: 1.3' }, root);
    lab.classList.add('clickable');
    return { root, lab };
  }

  function arFail(msg) { $('arMsg').textContent = msg; $('arGo').disabled = false; }

  async function startAR() {
    if (arStarted) return;
    $('arGo').disabled = true;
    $('arMsg').textContent = '許可を確認しています…';

    // 1. コンパス(iPhoneは、ボタンを押したこの場面で許可を求める必要がある)
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { arFail('モーションと方向のアクセスが許可されていません。設定 > Safari > モーションと方向のアクセス をオンにして、ページを開き直してください。'); return; }
      }
    } catch (e) { arFail('コンパスの許可を取得できませんでした。ページを開き直して、もう一度押してください。'); return; }

    // 2. 位置情報
    try { await getHere(); } catch (e) { arFail(geoMessage(e)); return; }

    // 3. カメラ
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      st.getTracks().forEach((t) => t.stop());
    } catch (e) { arFail('カメラが許可されていません。設定 > Safari > カメラ で許可して、ページを開き直してください。'); return; }

    const radius = parseInt($('radius').value, 10);
    const near = signs.filter((s) => !radius || dist(here, s) <= radius);
    const withChars = $('testChars').checked;
    if (!near.length && !withChars) { arFail(signs.length ? 'この範囲に看板がありません。範囲を広げるか、看板を作ってください。' : '看板がありません。先に看板を作ってください。'); return; }

    $('arMsg').textContent = 'ARを準備しています…';
    try {
      await loadScript('vendor/aframe.min.js');
      await loadScript('vendor/aframe-ar.js');
      registerComponents();
    } catch (e) { arFail('ARの部品を読み込めませんでした。通信を確認して、ページを開き直してください。'); return; }

    arStarted = true;
    $('arStart').hidden = true;

    const scene = document.createElement('a-scene');
    scene.setAttribute('vr-mode-ui', 'enabled: false');
    scene.setAttribute('arjs', 'sourceType: webcam; videoTexture: true; debugUIEnabled: false');
    scene.setAttribute('renderer', 'antialias: true; alpha: true');
    const cam = document.createElement('a-camera');
    cam.setAttribute('gps-new-camera', 'gpsMinDistance: 8');
    cam.setAttribute('cursor', 'rayOrigin: mouse');
    cam.setAttribute('raycaster', 'objects: .clickable; far: 100000');
    scene.appendChild(cam);

    near.forEach((s) => {
      const place = document.createElement('a-entity');
      place.setAttribute('gps-new-entity-place', 'latitude: ' + s.lat + '; longitude: ' + s.lng);
      const card = document.createElement('a-entity');
      card.className = 'clickable';
      card.dataset.id = s.id;
      card.setAttribute('position', '0 ' + (isNum(s.height) ? s.height : 2) + ' 0');
      card.setAttribute('sign-card', { name: s.name });
      card.addEventListener('click', () => showInfo(s));
      place.appendChild(card);
      scene.appendChild(place);
    });
    if (withChars) {
      const mLng = 111320 * Math.cos(here.lat * Math.PI / 180), D = 6;   // 6m 先の東西南北
      [['北', 0, 1, '#ff8a3d'], ['東', 1, 0, '#4cc9f0'], ['南', 0, -1, '#8ac926'], ['西', -1, 0, '#c77dff']].forEach(([name, dx, dy, color]) => {
        const place = document.createElement('a-entity');
        place.setAttribute('gps-new-entity-place', 'latitude: ' + (here.lat + dy * D / 110540) + '; longitude: ' + (here.lng + dx * D / mLng));
        const c = makeCharacter(color, 'クローズ君(' + name + ')');
        c.lab.addEventListener('click', () => {
          $('infoName').textContent = 'クローズ君(' + name + ')';
          $('infoDist').textContent = '';
          $('infoAccess').textContent = '現在地から ' + name + ' へ 約' + D + ' m の位置に置いたテスト用のキャラクターです。';
          $('infoDesc').textContent = 'AR表示を確かめるためのものです。';
          $('arInfo').hidden = false;
        });
        place.appendChild(c.root);
        scene.appendChild(place);
      });
    }
    camEl = cam;
    $('arHost').appendChild(scene);
    $('arHud').hidden = false;
    watchHere(near);
  }

  function showInfo(s) {
    $('infoName').textContent = s.name;
    $('infoDist').textContent = here ? fmt(dist(here, s)) : '';
    $('infoAccess').textContent = s.access || '(未入力)';
    $('infoDesc').textContent = s.description || '(未入力)';
    $('arInfo').hidden = false;
  }
  $('infoClose').onclick = () => { $('arInfo').hidden = true; };
  $('arExit').onclick = () => { location.reload(); };   // カメラを確実に止めるため、ページを開き直す

  // 向き(北=0°)。iPhoneは webkitCompassHeading、Androidは絶対方位の alpha から求める
  let compass = null, oriCount = 0, calibrated = false;
  // iPhoneの alpha は北基準ではないため、コンパスの方位に合わせて AR の向きを補正する(AndroidはOSが北基準で渡す)
  function calibrate(e) {
    const comp = camEl && camEl.components && camEl.components['arjs-device-orientation-controls'];
    const oc = comp && comp._orientationControls;
    if (!oc || typeof e.alpha !== 'number') return;
    const target = -e.webkitCompassHeading - e.alpha;                 // 度
    const cur = oc.alphaOffset * 180 / Math.PI;
    const diff = ((target - cur + 540) % 360) - 180;
    if (!calibrated || Math.abs(diff) > 4) {
      oc.alphaOffset = (cur + (calibrated ? diff * 0.3 : diff)) * Math.PI / 180;
      calibrated = true;
    }
  }
  function arYaw() {                                                    // ARのカメラが向いている方位(北=0°)
    const cam = document.querySelector('a-scene') && document.querySelector('a-scene').camera;
    if (!cam || !window.THREE) return null;
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    return (Math.atan2(d.x, -d.z) * 180 / Math.PI + 360) % 360;
  }
  function startCompass() {
    const onOri = (e) => {
      oriCount++;
      if (typeof e.webkitCompassHeading === 'number') {
        compass = e.webkitCompassHeading;
        calibrate(e);
      } else if (e.absolute && typeof e.alpha === 'number') compass = (360 - e.alpha) % 360;
    };
    window.addEventListener('deviceorientationabsolute', onOri, true);
    window.addEventListener('deviceorientation', onOri, true);
  }
  function bearing(a, b) {
    const r = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  function watchHere(near) {
    startCompass();
    const update = () => {
      let best = null, bd = Infinity;
      near.forEach((s) => {
        const d = dist(here, s);
        if (d < bd) { bd = d; best = s; }
        const el = Array.from(document.querySelectorAll('.clickable')).find((e) => e.dataset.id === s.id);
        const comp = el && el.components && el.components['sign-card'];
        if (comp && comp.canvas) comp.setDistance(d);   // 準備前の看板には触らない
      });
      const lines = [];
      if (best) {
        lines.push('いちばん近い: ' + best.name + ' ' + fmt(bd));
        const b = bearing(here, best);
        if (compass == null) lines.push('コンパス: 値が取れていません(向きが合わない原因になります)');
        else {
          const rel = ((b - compass + 540) % 360) - 180;
          lines.push('向き ' + Math.round(compass) + '° / 看板は ' + Math.round(b) + '° の方向 → ' + (Math.abs(rel) < 20 ? '正面です' : (rel > 0 ? '右へ ' : '左へ ') + Math.round(Math.abs(rel)) + '° 回す'));
        }
      }
      const v = document.querySelector('video');
      const yaw = arYaw();
      lines.push('診断: 映像 ' + (v ? v.videoWidth + '×' + v.videoHeight : 'なし') + ' / 向きイベント ' + oriCount + ' 回 / ARの向き ' + (yaw == null ? '-' : Math.round(yaw) + '°') + (calibrated ? ' / コンパス補正あり' : ''));
      lines.push('GPS 精度 約' + Math.round(here.acc) + ' m' + (here.acc > 100 ? '(悪いため、ARが位置を更新しません)' : ''));
      $('arNearest').textContent = lines.join('\n');
    };
    update();
    setInterval(update, 1000);   // 向きの表示を更新する
    navigator.geolocation.watchPosition((p) => {
      here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      update();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  $('arGo').onclick = startAR;

  renderList();
})();
