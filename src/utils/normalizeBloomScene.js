import { createDefaultScene } from '../constants/bloomDefaults';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const fallbackId = (index) => `layer-${index + 1}`;

function normalizeLayer(layer, index, globalBlendMode) {
  if (!layer || layer.layerType === 'image') return null;

  const colors = Array.isArray(layer.colors) && layer.colors.length
    ? layer.colors.filter((value) => typeof value === 'string' && value.trim())
    : ['#ffffff'];

  return {
    id: String(layer.id || fallbackId(index)),
    name: layer.name || `Layer ${index + 1}`,
    layerType: 'shape',
    shapeType: typeof layer.shapeType === 'string' ? layer.shapeType : 'polygon',
    numSides: Math.max(3, Math.round(Number(layer.numSides) || 6)),
    curviness: clamp(Number(layer.curviness) || 0, 0, 1),
    wobble: clamp(Number(layer.wobble) || 0, 0, 1),
    wobbleSpeed: Math.max(0, Number(layer.wobbleSpeed) || 0),
    noiseAmount: Math.max(0, Number(layer.noiseAmount) || 0),
    noiseScale: Math.max(0.1, Number(layer.noiseScale) || 1),
    opacity: clamp(Number(layer.opacity) || 0.8, 0.08, 1),
    blendMode: typeof layer.blendMode === 'string' ? layer.blendMode : globalBlendMode,
    colors,
    movementStyle: typeof layer.movementStyle === 'string' ? layer.movementStyle : 'still',
    movementSpeed: Math.max(0, Number(layer.movementSpeed) || 0),
    movementAngle: Number(layer.movementAngle) || 0,
    radiusFactor: clamp(Number(layer.radiusFactor) || 0.12, 0.02, 0.35),
    rotation: Number(layer.rotation) || 0,
    xOffset: clamp(Number(layer.xOffset) || 0, -0.5, 0.5),
    yOffset: clamp(Number(layer.yOffset) || 0, -0.5, 0.5),
    freq1: Number(layer.freq1) || 2,
    freq2: Number(layer.freq2) || 3,
    freq3: Number(layer.freq3) || 5,
    orbitCenterX: clamp(Number(layer.orbitCenterX) || 0.5, 0, 1),
    orbitCenterY: clamp(Number(layer.orbitCenterY) || 0.5, 0, 1),
    orbitRadiusX: clamp(Number(layer.orbitRadiusX) || 0.14, 0.01, 0.5),
    orbitRadiusY: clamp(Number(layer.orbitRadiusY) || 0.14, 0.01, 0.5),
    nodes: Array.isArray(layer.nodes) && layer.nodes.length >= 3
      ? layer.nodes
          .map((node) => ({
            x: clamp(Number(node?.x) || 0.5, 0, 1),
            y: clamp(Number(node?.y) || 0.5, 0, 1),
          }))
      : null,
    visible: layer.visible !== false,
  };
}

export function normalizeBloomScene(rawJson) {
  const fallback = createDefaultScene();
  const appState = rawJson?.appState && typeof rawJson.appState === 'object' ? rawJson.appState : rawJson;
  const globalBlendMode = typeof appState?.globalBlendMode === 'string'
    ? appState.globalBlendMode
    : fallback.globalBlendMode;

  const rawLayers = Array.isArray(appState?.layers) ? appState.layers : fallback.layers;
  const normalizedLayers = rawLayers
    .map((layer, index) => normalizeLayer(layer, index, globalBlendMode))
    .filter((layer) => layer && layer.visible !== false);

  return {
    name: rawJson?.name || rawJson?.exportMeta?.name || fallback.name,
    backgroundColor: typeof appState?.backgroundColor === 'string'
      ? appState.backgroundColor
      : fallback.backgroundColor,
    globalBlendMode,
    scale: fallback.scale,
    layers: normalizedLayers.length ? normalizedLayers : fallback.layers,
    sourceSummary: rawJson?.savedAt
      ? `Imported export saved at ${rawJson.savedAt}`
      : 'Imported JSON export',
    exportMeta: rawJson?.exportMeta || null,
  };
}
