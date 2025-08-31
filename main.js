import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { VRButton } from "three/examples/jsm/webxr/VRButton";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory";

// ===== Constants =====
const GRID_SIZE = 16;
const CUBE_SIZE = 128;
const DOT_SIZE = 0.28;
const DOT_SPACING = CUBE_SIZE / (GRID_SIZE - 1);
const CORNER_CUBE_SIZE = DOT_SIZE * 4;
const MOVEMENT_SPEED = 0.8;
const LINE_WIDTH = 2;
const ROTATE_MS = 300;
const FLY_MS = 800;
const CENTER = { x: (GRID_SIZE-1)/2, y: (GRID_SIZE-1)/2, z: (GRID_SIZE-1)/2 };

// ===== Game state =====
let camera, scene, renderer, controls, mainCube;
let isVRMode = false, isMobileMode = false;
let cameraGroup;
let autoRotate = false;
let animationFrameId = null;
const clock = new THREE.Clock();

// Raycasting (PC only)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Input
let moveForward=false, moveBackward=false, moveLeft=false, moveRight=false, moveUp=false, moveDown=false;

// Dots
let dots = [];
let instancedDots = null;

// Selection markers
let sourceMarker, targetMarker;

// Corner cubes (for raycast)
let cornerCubes = [];

// VR
let controller1, controller2, controllerGrip1, controllerGrip2;
let vrState = { isGrabbing1:false, isGrabbing2:false, lastPosition1:new THREE.Vector3(), lastPosition2:new THREE.Vector3() };
let vrMovementActive = { left:false, right:false };

// UI
let menu, pcButton, mobileButton, vrButton, returnButton, autoRotateCheckbox;
let pcHud, spawnColorSel, addShipBtn, shipListSel, centerBtn, followBtn, clearTrailsBtn, removeShipBtn, autoPlayBtnFloating;
let selChip, selMeta;
let autoTimer = null;

// Corners
const CORNERS = [
  { name:"Black",   hex:0x000000, pos:[0,0,0] },
  { name:"Red",     hex:0xff0000, pos:[GRID_SIZE-1,0,0] },
  { name:"Green",   hex:0x00ff00, pos:[0,GRID_SIZE-1,0] },
  { name:"Blue",    hex:0x0000ff, pos:[0,0,GRID_SIZE-1] },
  { name:"Yellow",  hex:0xffff00, pos:[GRID_SIZE-1,GRID_SIZE-1,0] },
  { name:"Magenta", hex:0xff00ff, pos:[GRID_SIZE-1,0,GRID_SIZE-1] },
  { name:"Cyan",    hex:0x00ffff, pos:[0,GRID_SIZE-1,GRID_SIZE-1] },
  { name:"White",   hex:0xffffff, pos:[GRID_SIZE-1,GRID_SIZE-1,GRID_SIZE-1] }
];

// Ships
const MAX_SHIPS = 8;
let ships = new Map();
let usedColors = new Set();
let selectedShipId = null;
let followShipId = null;
let occupancy = new Map();

// Click selection
let moveSource = null;
let moveTarget = null;

const gridKey = g => `${g.x},${g.y},${g.z}`;
const inBounds = g => g.x>=0 && g.x<GRID_SIZE && g.y>=0 && g.y<GRID_SIZE && g.z>=0 && g.z<GRID_SIZE;

// ===== Boot =====
document.addEventListener("DOMContentLoaded", () => {
  menu = document.getElementById("menu");
  pcButton = document.getElementById("pcButton");
  mobileButton = document.getElementById("mobileButton");
  vrButton = document.getElementById("vrButton");
  returnButton = document.getElementById("returnButton");
  autoRotateCheckbox = document.getElementById("autoRotate");

  pcHud = document.getElementById("pcHud");
  spawnColorSel = document.getElementById("spawnColor");
  addShipBtn = document.getElementById("addShipBtn");
  shipListSel = document.getElementById("shipList");
  centerBtn = document.getElementById("centerBtn");
  followBtn = document.getElementById("followBtn");
  clearTrailsBtn = document.getElementById("clearTrailsBtn");
  removeShipBtn = document.getElementById("removeShipBtn");
  selChip = document.getElementById("selChip");
  selMeta = document.getElementById("selMeta");
  autoPlayBtnFloating = document.getElementById("autoPlayBtnFloating");

  pcButton.addEventListener("click", () => safe(startPCMode, "starting PC mode"));
  mobileButton.addEventListener("click", () => safe(startMobileMode, "starting mobile mode"));
  vrButton.addEventListener("click", () => safe(startVRMode, "starting VR mode"));
  returnButton.addEventListener("click", () => safe(returnToMenu, "returning to menu"));

  addShipBtn.addEventListener("click", () => safe(addShipFromUI, "adding ship"));
  shipListSel.addEventListener("change", () => { selectedShipId = shipListSel.value || null; clearMoveSelection(); updateHudState(); });
  centerBtn.addEventListener("click", () => safe(centerCameraOnSelected, "centering camera"));
  followBtn.addEventListener("click", () => safe(toggleFollowSelected, "toggling follow"));
  clearTrailsBtn.addEventListener("click", () => safe(clearAllTrails, "clearing trails"));
  removeShipBtn.addEventListener("click", () => safe(removeSelectedShip, "removing ship"));

  autoPlayBtnFloating.addEventListener("click", () => safe(toggleAutoPlay, "toggling autoplay"));

  window.addEventListener("pointerdown", onPointerDown);
  document.getElementById("flyBtn").addEventListener("click", () => safe(flySelected, "flying"));

  populateSpawnColors();
});

function safe(fn, label){ try{ fn(); } catch(err){ showError(`Error ${label}: ${err.message}`); console.error(err); } }
function showError(message){ const e = document.getElementById("error"); if (!e) return; e.textContent = message; e.style.display = "block"; setTimeout(()=> e.style.display = "none", 3000); }

// ===== Init / Modes =====
function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  cameraGroup = new THREE.Group();
  scene.add(cameraGroup);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
  if (isVRMode) camera.position.set(0,0,CUBE_SIZE*0.75);
  else if (isMobileMode) camera.position.set(CUBE_SIZE*0.75, CUBE_SIZE*0.75, CUBE_SIZE*0.75);
  else camera.position.set(CUBE_SIZE*0.5, CUBE_SIZE*0.5, CUBE_SIZE*0.75);
  camera.lookAt(0,0,0);
  cameraGroup.add(camera);

  const viewport = document.querySelector('meta[name=viewport]');
  if (viewport) viewport.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";

  if (renderer && renderer.domElement && renderer.domElement.parentNode){
    renderer.domElement.parentNode.removeChild(renderer.domElement);
    renderer.dispose();
  }
  // remove log depth buffer to avoid warping
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  if (mainCube){
    scene.remove(mainCube);
    mainCube.traverse((o)=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else o.material.dispose(); }});
  }

  setupLights();

  mainCube = new THREE.Group();
  mainCube.add(createCornerCubes());
  mainCube.add(createDots());
  setupSelectionMarkers();
  scene.add(mainCube);

  window.addEventListener("resize", onWindowResize, false);
  if (!isMobileMode){
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
  }
  clock.start();
}

function setupLights(){
  const ambient = new THREE.AmbientLight(0xffffff, 0.4); scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.7); scene.add(hemi);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.9); dir1.position.set(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE); scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.6); dir2.position.set(-CUBE_SIZE, -CUBE_SIZE, CUBE_SIZE); scene.add(dir2);
  const dir3 = new THREE.DirectionalLight(0xffffff, 0.5); dir3.position.set(CUBE_SIZE, -CUBE_SIZE, -CUBE_SIZE); scene.add(dir3);
}

function startPCMode(){
  isMobileMode = false; isVRMode = false; init();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  controls.maxDistance = CUBE_SIZE * 2; controls.minDistance = 0.1;
  controls.enablePan = true; controls.panSpeed = 1.0; controls.rotateSpeed = 0.5;

  autoRotate = autoRotateCheckbox.checked;
  menu.style.display = "none"; returnButton.style.display = "block"; pcHud.style.display = "block";
  autoPlayBtnFloating.style.display = "block"; autoPlayBtnFloating.textContent = "Auto Play: Off";

  enableHudDrag();

  clearAllShipsAndTrails();

  function animate(){
    animationFrameId = requestAnimationFrame(animate);
    const dt = clock.getDelta();
    controls.update();
    updateCamera();
    updateAutoRotation();
    tickShipAnimations(dt);
    renderer.render(scene, camera);
  }
  animate();
  updateHudState();
}

function startMobileMode(){
  isMobileMode = true; isVRMode = false; init();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  controls.maxDistance = CUBE_SIZE * 2; controls.minDistance = 0.1;
  controls.enablePan = false; controls.rotateSpeed = 0.5; controls.enableZoom = true; controls.zoomSpeed = 1.0;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  autoRotate = autoRotateCheckbox.checked;
  camera.position.set(CUBE_SIZE*0.75, CUBE_SIZE*0.75, CUBE_SIZE*0.75); camera.lookAt(0,0,0); controls.update();

  menu.style.display = "none"; returnButton.style.display = "block"; pcHud.style.display = "none";
  autoPlayBtnFloating.style.display = "none";

  function animate(){
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    updateAutoRotation();
    renderer.render(scene, camera);
  }
  animate();
}

function startVRMode(){
  isVRMode = true; isMobileMode = false; init(); setupVRControllers();

  if (!mainCube){
    mainCube = new THREE.Group();
    mainCube.position.set(0,0,-CUBE_SIZE*0.75);
    mainCube.scale.setScalar(1.0);
    mainCube.add(createCornerCubes());
    mainCube.add(createDots());
    setupSelectionMarkers();
    scene.add(mainCube);
  }

  autoRotate = autoRotateCheckbox.checked;

  document.body.appendChild(VRButton.createButton(renderer));
  renderer.xr.enabled = true; renderer.xr.setFramebufferScaleFactor(0.8);
  renderer.setPixelRatio(1); renderer.xr.setReferenceSpaceType("local-floor");
  renderer.physicallyCorrectLights = false; renderer.toneMapping = THREE.NoToneMapping; renderer.outputEncoding = THREE.LinearEncoding;

  menu.style.display = "none"; returnButton.style.display = "block"; pcHud.style.display = "none";

  renderer.setAnimationLoop(()=>{
    updateVRInteraction(); updateVRMovement(); updateAutoRotation(); renderer.render(scene, camera);
  });
}

function returnToMenu(){
  if (animationFrameId){ cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  if (isVRMode && renderer) renderer.setAnimationLoop(null);
  if (renderer && renderer.domElement && renderer.domElement.parentNode){
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  const vrBtn = document.querySelector('button.webvr-ui-button');
  if (vrBtn && vrBtn.parentNode) vrBtn.parentNode.removeChild(vrBtn);

  menu.style.display = "block"; returnButton.style.display = "none"; pcHud.style.display = "none";
  const err = document.getElementById("error"); if (err) err.style.display = "none";
  if (controls){ controls.dispose(); controls = null; }

  if (autoTimer){ clearInterval(autoTimer); autoTimer = null; }
  autoPlayBtnFloating.style.display = "none";

  dots = []; clearMoveSelection();
  clearAllShipsAndTrails();

  if (scene){
    scene.traverse((o)=>{
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose());
        else o.material.dispose();
      }
    });
  }
  isVRMode = false; isMobileMode = false;
}

// ===== Scene bits =====
function gridToWorld(g){
  const cx = (GRID_SIZE-1)/2;
  return new THREE.Vector3(
    (g.x-cx)*DOT_SPACING,
    (g.y-cx)*DOT_SPACING,
    (g.z-cx)*DOT_SPACING
  );
}

function createCornerCubes(){
  const group = new THREE.Group();
  cornerCubes = [];
  CORNERS.forEach(({hex,pos})=>{
    const geo = new THREE.BoxGeometry(CORNER_CUBE_SIZE, CORNER_CUBE_SIZE, CORNER_CUBE_SIZE);
    const mat = new THREE.MeshStandardMaterial({ color:hex, emissive:hex, emissiveIntensity:0.55, side:THREE.DoubleSide });
    const cube = new THREE.Mesh(geo, mat);
    const grid = { x:pos[0], y:pos[1], z:pos[2] };
    cube.position.copy(gridToWorld(grid));
    cube.userData.gridPosition = grid;
    cube.userData.isCorner = true;
    if (hex===0x000000){
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color:0xffffff, linewidth:LINE_WIDTH, side:THREE.DoubleSide }));
      cube.add(wire);
    }
    group.add(cube);
    cornerCubes.push(cube);
  });
  return group;
}

function createDots(){
  const dotGroup = new THREE.Group();
  const segments = isVRMode ? 4 : 6;
  const geo = new THREE.SphereGeometry(DOT_SIZE, segments, segments);
  const mat = new THREE.MeshStandardMaterial({
    color:0x8a8a8a, emissive:0x3a3a3a, emissiveIntensity:0.5,
    transparent:true, opacity:0.28, side:THREE.DoubleSide, flatShading:isVRMode
  });
  const inst = new THREE.InstancedMesh(geo, mat, GRID_SIZE*GRID_SIZE*GRID_SIZE);
  instancedDots = inst;
  inst.userData.dots = [];
  let idx=0; const mtx = new THREE.Matrix4();
  for (let x=0;x<GRID_SIZE;x++)
    for (let y=0;y<GRID_SIZE;y++)
      for (let z=0;z<GRID_SIZE;z++){
        const isCorner=(x===0||x===GRID_SIZE-1)&&(y===0||y===GRID_SIZE-1)&&(z===0||z===GRID_SIZE-1);
        if (isCorner) continue;
        const grid = {x,y,z};
        const p = gridToWorld(grid);
        mtx.setPosition(p.x,p.y,p.z); inst.setMatrixAt(idx, mtx);
        const dot={ position:p.clone(), gridPosition:grid, instanceId:idx };
        dots.push(dot); inst.userData.dots.push(dot); idx++;
      }
  inst.count = idx;
  dotGroup.add(inst);
  return dotGroup;
}

function setupSelectionMarkers(){
  const srcGeo = new THREE.TorusGeometry(DOT_SIZE*1.6, DOT_SIZE*0.2, 8, 24);
  const srcMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
  sourceMarker = new THREE.Mesh(srcGeo, srcMat);
  sourceMarker.rotation.x = Math.PI/2; sourceMarker.visible = false; mainCube.add(sourceMarker);

  const tgtGeo = new THREE.TorusGeometry(DOT_SIZE*1.8, DOT_SIZE*0.18, 8, 24);
  const tgtMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  targetMarker = new THREE.Mesh(tgtGeo, tgtMat);
  targetMarker.rotation.x = Math.PI/2; targetMarker.visible = false; mainCube.add(targetMarker);
}

function updateAutoRotation(){
  if (!autoRotate || !mainCube) return;
  const S=0.001, t=Date.now()*S;
  mainCube.rotation.x+=Math.sin(t)*S;
  mainCube.rotation.y+=Math.cos(t*1.3)*S;
  mainCube.rotation.z+=Math.sin(t*0.7)*S;
}

// ===== Controls & camera =====
function handleKeyDown(e){
  switch(e.code){
    case"KeyW":moveForward=true;break;
    case"KeyS":moveBackward=true;break;
    case"KeyA":moveLeft=true;break;
    case"KeyD":moveRight=true;break;
    case"Space":moveUp=true;break;
    case"ShiftLeft":moveDown=true;break;
  }
}
function handleKeyUp(e){
  switch(e.code){
    case"KeyW":moveForward=false;break;
    case"KeyS":moveBackward=false;break;
    case"KeyA":moveLeft=false;break;
    case"KeyD":moveRight=false;break;
    case"Space":moveUp=false;break;
    case"ShiftLeft":moveDown=false;break;
  }
}
function updateCamera(){
  if (isVRMode) return;
  const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  const right=new THREE.Vector3(); right.crossVectors(camera.up, dir).normalize();
  const s=MOVEMENT_SPEED;
  if (moveForward) camera.position.addScaledVector(dir,s);
  if (moveBackward) camera.position.addScaledVector(dir,-s);
  if (moveRight) camera.position.addScaledVector(right,-s);
  if (moveLeft) camera.position.addScaledVector(right,s);
  if (moveUp) camera.position.y+=s;
  if (moveDown) camera.position.y-=s;
  if (controls){
    const td=1; controls.target.copy(camera.position).add(dir.multiplyScalar(td));
  }
}
function onWindowResize(){
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ===== VR =====
function setupVRControllers(){
  controller1 = renderer.xr.getController(0); controller2 = renderer.xr.getController(1);
  cameraGroup.add(controller1); cameraGroup.add(controller2);
  const factory = new XRControllerModelFactory();
  controllerGrip1 = renderer.xr.getControllerGrip(0); controllerGrip1.add(factory.createControllerModel(controllerGrip1)); cameraGroup.add(controllerGrip1);
  controllerGrip2 = renderer.xr.getControllerGrip(1); controllerGrip2.add(factory.createControllerModel(controllerGrip2)); cameraGroup.add(controllerGrip2);
  controller1.addEventListener("selectstart", onVRGrabStart);
  controller1.addEventListener("selectend", onVRGrabEnd);
  controller2.addEventListener("selectstart", onVRGrabStart);
  controller2.addEventListener("selectend", onVRGrabEnd);
  controller1.addEventListener("squeezestart", ()=> vrMovementActive.left = true);
  controller1.addEventListener("squeezeend", ()=> vrMovementActive.left = false);
  controller2.addEventListener("squeezestart", ()=> vrMovementActive.right = true);
  controller2.addEventListener("squeezeend", ()=> vrMovementActive.right = false);
  controller1.userData.raycaster = new THREE.Raycaster();
  controller2.userData.raycaster = new THREE.Raycaster();
}
function updateVRInteraction(){
  if (vrState.isGrabbing1 && vrState.isGrabbing2){
    const p1=new THREE.Vector3(), p2=new THREE.Vector3();
    controller1.getWorldPosition(p1); controller2.getWorldPosition(p2);
    if (vrState.lastPosition1.length()>0 && vrState.lastPosition2.length()>0){
      const prev=vrState.lastPosition2.clone().sub(vrState.lastPosition1);
      const curr=p2.clone().sub(p1);
      const q=new THREE.Quaternion();
      q.setFromUnitVectors(prev.normalize(), curr.normalize());
      mainCube.quaternion.multiplyQuaternions(q, mainCube.quaternion);
    }
    vrState.lastPosition1.copy(p1);
    vrState.lastPosition2.copy(p2);
  }
}
function onVRGrabStart(e){
  const c=e.target;
  if (c===controller1){ vrState.isGrabbing1=true; controller1.getWorldPosition(vrState.lastPosition1); }
  else { vrState.isGrabbing2=true; controller2.getWorldPosition(vrState.lastPosition2); }
}
function onVRGrabEnd(e){
  const c=e.target;
  if (c===controller1) vrState.isGrabbing1=false; else vrState.isGrabbing2=false;
}
function updateVRMovement(){
  if (!isVRMode) return;
  const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  if (vrMovementActive.right) cameraGroup.position.addScaledVector(dir, 2.0);
  if (vrMovementActive.left) cameraGroup.position.addScaledVector(dir, -2.0);
}

// ===== Ships =====
function populateSpawnColors(){
  spawnColorSel.innerHTML = "";
  CORNERS.forEach(({name})=>{
    const opt=document.createElement("option");
    opt.value=name; opt.textContent=name;
    spawnColorSel.appendChild(opt);
  });
  refreshSpawnColorDisabled();
}
function refreshSpawnColorDisabled(){
  Array.from(spawnColorSel.options).forEach(opt=> opt.disabled = usedColors.has(opt.value));
  if (spawnColorSel.selectedOptions[0]?.disabled){
    const first = Array.from(spawnColorSel.options).find(o=>!o.disabled);
    if (first) spawnColorSel.value = first.value;
  }
}

function addShipFromUI(){
  if (ships.size>=MAX_SHIPS){ showError("Max 8 ships."); return; }
  const colorName=spawnColorSel.value;
  if (!colorName){ showError("Pick a color."); return; }
  if (usedColors.has(colorName)){ showError("That color is already used."); return; }
  const corner=CORNERS.find(c=>c.name===colorName);
  if (!corner){ showError("Invalid color."); return; }
  const grid={ x:corner.pos[0], y:corner.pos[1], z:corner.pos[2] };
  if (occupancy.has(gridKey(grid))){ showError("Corner occupied."); return; }
  const id = `ship-${colorName.toLowerCase()}`;
  const ship = createShip(id, colorName, corner.hex, grid);
  ships.set(id, ship); usedColors.add(colorName);
  occupancy.set(gridKey(grid), id);
  selectedShipId = id;
  clearMoveSelection(); updateShipList(); updateHudState(); centerCameraOnSelected();
}

function createShip(id, colorName, colorHex, grid){
  const group = new THREE.Group(); group.name = id;
  const worldPos = gridToWorld(grid); group.position.copy(worldPos);
  // Rocket: body + nose (aligned along +Z)
  const bodyRadius = DOT_SIZE*0.7, bodyLen = DOT_SIZE*4.2, tipLen = DOT_SIZE*1.8;
  const bodyGeo = new THREE.CylinderGeometry(bodyRadius*0.75, bodyRadius, bodyLen, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color:colorHex, emissive:colorHex, emissiveIntensity:0.4, metalness:0.2, roughness:0.6 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = Math.PI/2; group.add(body);
  const noseGeo = new THREE.ConeGeometry(bodyRadius*0.75, tipLen, 12);
  const noseMat = new THREE.MeshStandardMaterial({ color:colorHex, emissive:colorHex, emissiveIntensity:0.55, metalness:0.1, roughness:0.4 });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.rotation.x = Math.PI/2;
  nose.position.z = bodyLen/2 + tipLen/2; group.add(nose);
  if (colorHex===0x000000){
    const edges=new THREE.EdgesGeometry(new THREE.CapsuleGeometry(bodyRadius, bodyLen, 2, 8));
    const outline=new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color:0xffffff }));
    group.add(outline);
  }
  const navLight = new THREE.PointLight(colorHex===0x000000?0xffffff:colorHex, 0.8, DOT_SPACING*1.5, 2);
  navLight.position.set(0,0, bodyLen/2 + tipLen/2 + 0.1); group.add(navLight);
  const toCenter = new THREE.Vector3().sub(worldPos).normalize();
  const forward = new THREE.Vector3(0,0,1);
  const q = new THREE.Quaternion().setFromUnitVectors(forward, toCenter);
  group.setRotationFromQuaternion(q);
  const ringGeo = new THREE.TorusGeometry(DOT_SIZE*1.2, DOT_SIZE*0.15, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: colorHex===0x000000?0xffffff:colorHex });
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI/2; group.add(ring);
  const trailGroup = new THREE.Group(); mainCube.add(trailGroup);
  mainCube.add(group);
  return { id, colorName, colorHex, mesh:group, ring, trailGroup, grid:{...grid}, busy:false, anim:null };
}

// Click-to-move
function onPointerDown(e){
  if (isMobileMode || isVRMode) return;
  if (!selectedShipId || !ships.has(selectedShipId)) return;
  const ship = ships.get(selectedShipId); if (ship.busy) return;
  if (!renderer) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  let hit = null; let hitGrid = null;

  if (instancedDots){
    const hitsDots = raycaster.intersectObject(instancedDots, true);
    if (hitsDots.length){
      hit = hitsDots[0];
      const id = hit.instanceId;
      if (id !== undefined && id !== null){
        const dot = instancedDots.userData.dots[id];
        if (dot){ hitGrid = { ...dot.gridPosition }; }
      }
    }
  }

  const hitsCubes = raycaster.intersectObjects(cornerCubes, true);
  if (hitsCubes.length){
    const cubeHit = hitsCubes[0];
    if (!hit || cubeHit.distance < hit.distance){
      hit = cubeHit; hitGrid = { ...cubeHit.object.userData.gridPosition };
    }
  }

  if (!hit || !hitGrid) return;
  const g = hitGrid;

  if (!moveSource && equalsGrid(g, ship.grid)){
    moveSource = { ...ship.grid };
    sourceMarker.visible = true; sourceMarker.position.copy(gridToWorld(moveSource));
    updateHudState(); return;
  }

  if (moveSource && equalsGrid(g, moveSource)){
    clearMoveSelection(); updateHudState(); return;
  }

  if (moveSource){
    const dx = g.x - moveSource.x, dy = g.y - moveSource.y, dz = g.z - moveSource.z;
    const manhattan = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    const inLine = (manhattan === 1);
    const inBoundsOk = inBounds(g);
    const free = !occupancy.has(gridKey(g));
    if (inLine && inBoundsOk && free){
      moveTarget = { x:g.x, y:g.y, z:g.z };
      targetMarker.visible = true; targetMarker.position.copy(gridToWorld(moveTarget));
      updateHudState();
    }
  }
}

const equalsGrid = (a,b) => a.x===b.x && a.y===b.y && a.z===b.z;

function clearMoveSelection(){
  moveSource=null; moveTarget=null;
  if (sourceMarker) sourceMarker.visible=false;
  if (targetMarker) targetMarker.visible=false;
}

function flySelected(){
  if (!selectedShipId || !ships.has(selectedShipId)) return;
  const s=ships.get(selectedShipId);
  if (s.busy) return; if (!moveSource || !moveTarget) return;
  if (!equalsGrid(s.grid, moveSource)){ showError("Source changed; reselect."); clearMoveSelection(); updateHudState(); return; }
  if (!inBounds(moveTarget) || occupancy.has(gridKey(moveTarget))){ showError("Invalid target."); return; }

  occupancy.delete(gridKey(s.grid)); occupancy.set(gridKey(moveTarget), s.id);

  const fromP = gridToWorld(s.grid), toP = gridToWorld(moveTarget);
  addTrailSegment(s, fromP, toP);

  const dir = new THREE.Vector3(moveTarget.x - s.grid.x, moveTarget.y - s.grid.y, moveTarget.z - s.grid.z).normalize();
  const fromQ = s.mesh.quaternion.clone();
  const toQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), dir);

  s.busy = true;
  s.anim = { type:"rotate-then-fly", phase:0, t:0, fromQ, toQ, fromP, toP, toGrid:{...moveTarget}, ease:easeInOutCubic };
  updateHudState();
}

function addTrailSegment(s, p0, p1){
  const pos=new Float32Array([p0.x,p0.y,p0.z, p1.x,p1.y,p1.z]);
  const g=new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos,3));
  const m=new THREE.LineBasicMaterial({ color:s.colorHex===0x000000?0xffffff:s.colorHex, transparent:true, opacity:.9 });
  const line=new THREE.Line(g,m); line.frustumCulled=false;
  s.trailGroup.add(line);
}

function tickShipAnimations(dt=1/60){
  ships.forEach((s)=>{
    if (!s.anim) return;
    if (s.anim.type === "rotate-then-fly"){
      if (s.anim.phase === 0){
        const dur = ROTATE_MS/1000; s.anim.t = Math.min(1, s.anim.t + dt/dur);
        const t = s.anim.ease(s.anim.t);
        s.mesh.quaternion.slerpQuaternions(s.anim.fromQ, s.anim.toQ, t);
        if (s.anim.t>=1){ s.anim.phase = 1; s.anim.t = 0; }
      } else if (s.anim.phase === 1){
        const dur = FLY_MS/1000; s.anim.t = Math.min(1, s.anim.t + dt/dur);
        const t = s.anim.ease(s.anim.t);
        const p = new THREE.Vector3().lerpVectors(s.anim.fromP, s.anim.toP, t);
        s.mesh.position.copy(p);
        if (s.anim.t>=1){
          s.grid = { ...s.anim.toGrid };
          s.anim=null; s.busy=false; clearMoveSelection(); updateShipList(); updateHudState();
        }
      }
    }
  });

  if (followShipId && ships.has(followShipId) && controls){
    const s=ships.get(followShipId);
    const target=s.mesh.getWorldPosition(new THREE.Vector3());
    controls.target.lerp(target, .25);
    const camTo=target.clone().add(new THREE.Vector3(CUBE_SIZE*.2,CUBE_SIZE*.2,CUBE_SIZE*.2));
    camera.position.lerp(camTo, .05);
  }
}

function centerCameraOnSelected(){
  if (!selectedShipId || !ships.has(selectedShipId) || !controls) return;
  const s=ships.get(selectedShipId);
  const target=s.mesh.getWorldPosition(new THREE.Vector3());
  controls.target.copy(target);
  const offset=new THREE.Vector3(CUBE_SIZE*.3,CUBE_SIZE*.3,CUBE_SIZE*.3);
  camera.position.copy(target.clone().add(offset));
}
function toggleFollowSelected(){
  if (!selectedShipId || !ships.has(selectedShipId)) return;
  followShipId = (followShipId===selectedShipId)? null : selectedShipId;
  updateHudState();
}

function clearAllTrails(){
  ships.forEach((s)=>{
    while(s.trailGroup.children.length){
      const ch=s.trailGroup.children.pop();
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) ch.material.dispose();
      s.trailGroup.remove(ch);
    }
  });
  updateHudState();
}
function removeSelectedShip(){
  if (!selectedShipId || !ships.has(selectedShipId)) return;
  const s=ships.get(selectedShipId);
  occupancy.delete(gridKey(s.grid));
  mainCube.remove(s.mesh);
  s.mesh.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){
      if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose());
      else o.material.dispose();
    }
  });
  while(s.trailGroup.children.length){
    const ch=s.trailGroup.children.pop();
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) ch.material.dispose();
    s.trailGroup.remove(ch);
  }
  mainCube.remove(s.trailGroup);
  ships.delete(s.id);
  usedColors.delete(s.colorName);
  if (followShipId===s.id) followShipId=null;
  selectedShipId = ships.size ? Array.from(ships.keys())[0] : null;
  clearMoveSelection(); updateShipList(); updateHudState(); refreshSpawnColorDisabled();
}
function clearAllShipsAndTrails(){
  ships.forEach((s)=>{
    if(s.mesh) mainCube?.remove(s.mesh);
    if(s.trailGroup){
      while(s.trailGroup.children.length){
        const ch=s.trailGroup.children.pop();
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
      mainCube?.remove(s.trailGroup);
    }
  });
  ships.clear(); usedColors.clear(); occupancy.clear();
  selectedShipId=null; followShipId=null;
  clearMoveSelection(); updateShipList(); updateHudState(); refreshSpawnColorDisabled();
}

function updateShipList(){
  shipListSel.innerHTML = "";
  ships.forEach((s)=>{
    const opt=document.createElement("option");
    opt.value=s.id; const {x,y,z}=s.grid;
    opt.textContent=`${s.colorName} (${x},${y},${z})`;
    shipListSel.appendChild(opt);
  });
  if (selectedShipId && ships.has(selectedShipId)) shipListSel.value = selectedShipId;
  else selectedShipId = shipListSel.value || null;
  refreshSpawnColorDisabled();
}

function updateHudState(){
  const hasShip = selectedShipId && ships.has(selectedShipId);
  const s = hasShip ? ships.get(selectedShipId) : null;
  if (s){
    selChip.style.background = `#${s.colorHex.toString(16).padStart(6,"0")}`;
    selMeta.textContent = `${s.colorName} @ (${s.grid.x},${s.grid.y},${s.grid.z})`;
  } else {
    selChip.style.background = "transparent";
    selMeta.textContent = "No ship selected";
  }
  centerBtn.disabled = !hasShip; followBtn.disabled = !hasShip;
  removeShipBtn.disabled = !hasShip; clearTrailsBtn.disabled = ships.size===0;
  followBtn.textContent = (hasShip && followShipId===s?.id) ? "Follow: On" : "Follow: Off";
  const flyBtn = document.getElementById("flyBtn");
  const canFly = hasShip && !s?.busy && !!moveSource && !!moveTarget;
  flyBtn.disabled = !canFly;
}

// ===== Autoplay =====
function toggleAutoPlay(){
  if (autoTimer){ clearInterval(autoTimer); autoTimer = null; updateHudState(); autoPlayBtnFloating.textContent = 'Auto Play: Off'; return; }
  ensureAllShips();
  autoTimer = setInterval(autoPlayStep, 2000);
  autoPlayBtnFloating.textContent = 'Auto Play: On';
  updateHudState();
}
function ensureAllShips(){
  CORNERS.forEach(c=> addShipByCorner(c));
  if (!selectedShipId && ships.size) { selectedShipId = Array.from(ships.keys())[0]; updateShipList(); }
  updateHudState();
}
function addShipByCorner(corner){
  if (ships.size>=MAX_SHIPS) return;
  const colorName=corner.name; if (usedColors.has(colorName)) return;
  const grid={ x:corner.pos[0], y:corner.pos[1], z:corner.pos[2] };
  if (occupancy.has(gridKey(grid))) return;
  const id = `ship-${colorName.toLowerCase()}`;
  const ship = createShip(id, colorName, corner.hex, grid);
  ships.set(id, ship); usedColors.add(colorName);
  occupancy.set(gridKey(grid), id);
  updateShipList();
}
function autoPlayStep(){
  ships.forEach((s)=>{
    if (s.busy) return;
    const t = pickBiasedNeighbor(s.grid);
    if (!t) return;
    flyShipDirect(s, t);
  });
}
function getFreeNeighbors(g){
  const D=[{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}];
  const arr=[];
  for(const d of D){
    const n={x:g.x+d.x,y:g.y+d.y,z:g.z+d.z};
    if(!inBounds(n)) continue;
    if (occupancy.has(gridKey(n))) continue;
    arr.push(n);
  }
  return arr;
}
const dist2ToCenter = g => {
  const dx=g.x-CENTER.x, dy=g.y-CENTER.y, dz=g.z-CENTER.z;
  return dx*dx+dy*dy+dz*dz;
};
function pickBiasedNeighbor(g){
  const cands = getFreeNeighbors(g);
  if (!cands.length) return null;
  cands.sort((a,b)=> dist2ToCenter(a)-dist2ToCenter(b));
  if (Math.random() < 0.75) return cands[0];
  return cands[Math.floor(Math.random()*cands.length)];
}
function flyShipDirect(s, target){
  if (s.busy) return;
  if (!inBounds(target) || occupancy.has(gridKey(target))) return;
  occupancy.delete(gridKey(s.grid));
  occupancy.set(gridKey(target), s.id);
  const fromP=gridToWorld(s.grid), toP=gridToWorld(target);
  addTrailSegment(s, fromP, toP);
  const dir=new THREE.Vector3(
    target.x-s.grid.x, target.y-s.grid.y, target.z-s.grid.z
  ).normalize();
  const fromQ=s.mesh.quaternion.clone();
  const toQ=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), dir);
  s.busy=true;
  s.anim={
    type:'rotate-then-fly',
    phase:0, t:0,
    fromQ, toQ, fromP, toP,
    toGrid:{...target},
    ease:easeInOutCubic
  };
}

// ===== Draggable HUD =====
function enableHudDrag(){
  const handle = pcHud.querySelector('h3'); if (!handle) return;
  let dragging=false, sx=0, sy=0, ox=0, oy=0;
  handle.addEventListener('pointerdown', (e)=>{
    dragging=true; sx=e.clientX; sy=e.clientY;
    const rect=pcHud.getBoundingClientRect(); ox=rect.left; oy=rect.top;
    pcHud.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const nx = ox + (e.clientX - sx);
    const ny = oy + (e.clientY - sy);
    pcHud.style.left = Math.max(0, Math.min(window.innerWidth - pcHud.offsetWidth, nx)) + 'px';
    pcHud.style.top = Math.max(0, Math.min(window.innerHeight - pcHud.offsetHeight, ny)) + 'px';
    pcHud.style.right = 'auto'; pcHud.style.position = 'fixed';
  });
  window.addEventListener('pointerup', (e)=>{
    if(!dragging) return; dragging=false;
    try{ pcHud.releasePointerCapture(e.pointerId); }catch(_){}
  });
}

// ===== Helpers =====
function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }
