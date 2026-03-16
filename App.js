import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { BloomAudioEngine } from './src/audio/BloomAudioEngine';
import { createDefaultScene } from './src/constants/bloomDefaults';
import { mapPressMetrics, mapXToFilter, mapYToPitch } from './src/utils/music';
import { normalizeBloomScene } from './src/utils/normalizeBloomScene';
import { buildShapePath } from './src/utils/shapePath';

const FileSystem = Platform.OS !== 'web' ? require('expo-file-system/legacy') : null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MAX_VISIBLE_SHAPES = 48;

function pickRandomLayer(layers) {
  if (!Array.isArray(layers) || !layers.length) return null;
  const visibleLayers = layers.filter((layer) => layer?.visible !== false);
  const pool = visibleLayers.length ? visibleLayers : layers;
  return pool[Math.floor(Math.random() * pool.length)] || pool[0] || null;
}

function pointFromTouch(touch) {
  return {
    x: Number(touch?.locationX) || 0,
    y: Number(touch?.locationY) || 0,
  };
}

function distanceBetweenTouches(touches) {
  if (!Array.isArray(touches) || touches.length < 2) return 0;
  const dx = (Number(touches[1]?.locationX) || 0) - (Number(touches[0]?.locationX) || 0);
  const dy = (Number(touches[1]?.locationY) || 0) - (Number(touches[0]?.locationY) || 0);
  return Math.hypot(dx, dy);
}

function midpointBetweenTouches(touches) {
  if (!Array.isArray(touches) || touches.length < 2) return { x: 0, y: 0 };
  return {
    x: ((Number(touches[0]?.locationX) || 0) + (Number(touches[1]?.locationX) || 0)) / 2,
    y: ((Number(touches[0]?.locationY) || 0) + (Number(touches[1]?.locationY) || 0)) / 2,
  };
}

function findSpawnAtPoint(spawns, point) {
  if (!Array.isArray(spawns) || !spawns.length) return null;

  for (let index = spawns.length - 1; index >= 0; index -= 1) {
    const spawn = spawns[index];
    const halfWidth = ((spawn.width || 0) * (spawn.stretchX || 1) * (spawn.renderScale || 1)) / 2;
    const halfHeight = ((spawn.height || 0) * (spawn.stretchY || 1) * (spawn.renderScale || 1)) / 2;
    if (
      point.x >= (spawn.x - halfWidth)
      && point.x <= (spawn.x + halfWidth)
      && point.y >= (spawn.y - halfHeight)
      && point.y <= (spawn.y + halfHeight)
    ) {
      return spawn;
    }
  }

  return null;
}

function advanceSpawn(spawn, dt, stage) {
  const now = Date.now();
  const ageMs = now - spawn.createdAt;
  if (ageMs >= spawn.lifetimeMs) return null;

  const next = {
    ...spawn,
    ageMs,
  };
  const width = Math.max(1, stage.width || 1);
  const height = Math.max(1, stage.height || 1);
  const halfWidth = ((next.width || 0) * (next.stretchX || 1)) / 2;
  const halfHeight = ((next.height || 0) * (next.stretchY || 1)) / 2;
  const motionSpeed = Math.max(0, Number(next.movementSpeed) || 0) * Math.min(width, height) * 0.06;

  switch (next.movementStyle) {
    case 'bounce': {
      next.x += next.vx * dt;
      next.y += next.vy * dt;
      if (next.x <= halfWidth || next.x >= width - halfWidth) {
        next.vx *= -1;
        next.x = clamp(next.x, halfWidth, width - halfWidth);
      }
      if (next.y <= halfHeight || next.y >= height - halfHeight) {
        next.vy *= -1;
        next.y = clamp(next.y, halfHeight, height - halfHeight);
      }
      break;
    }
    case 'drift': {
      next.x += next.vx * dt;
      next.y += next.vy * dt;
      if (next.x < -halfWidth) next.x = width + halfWidth;
      if (next.x > width + halfWidth) next.x = -halfWidth;
      if (next.y < -halfHeight) next.y = height + halfHeight;
      if (next.y > height + halfHeight) next.y = -halfHeight;
      break;
    }
    case 'orbit': {
      next.orbitAngle += dt * (0.7 + (motionSpeed * 0.01));
      next.x = next.originX + (Math.cos(next.orbitAngle) * next.orbitRadiusX * width);
      next.y = next.originY + (Math.sin(next.orbitAngle) * next.orbitRadiusY * height);
      break;
    }
    default:
      break;
  }

  const pulse = 1 + (Math.sin(ageMs * 0.004) * (Math.max(0, Number(next.wobble) || 0) * 0.08));
  next.renderScale = clamp(pulse, 0.7, 1.6);
  next.renderOpacity = clamp((next.opacity || 1) * (1 - (ageMs / next.lifetimeMs)), 0.04, 1);

  return next;
}

export default function App() {
  const audioEngineRef = useRef(new BloomAudioEngine());
  const interactionRef = useRef(null);
  const spawnsRef = useRef([]);
  const [scene, setScene] = useState(() => createDefaultScene());
  const [spawns, setSpawns] = useState([]);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [importStatus, setImportStatus] = useState('Load a JSON export from old_art_app or start from the bundled demo scene.');
  const [lastVoiceSummary, setLastVoiceSummary] = useState('No voices triggered yet.');
  const [engineStatus, setEngineStatus] = useState(audioEngineRef.current.getStatus());

  useEffect(() => {
    spawnsRef.current = spawns;
    audioEngineRef.current.releaseMissing(spawns.map((spawn) => spawn.id));
    setEngineStatus(audioEngineRef.current.getStatus());
  }, [spawns]);

  useEffect(() => () => {
    audioEngineRef.current.releaseAll();
  }, []);

  useEffect(() => {
    let frameId = null;
    let lastTime = Date.now();

    const tick = () => {
      const now = Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      setSpawns((current) => current
        .map((spawn) => advanceSpawn(spawn, dt, stage))
        .filter(Boolean));
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [stage]);

  const triggerSpawn = useCallback((point, durationMs) => {
    if (!stage.width || !stage.height) return;
    const chosenLayer = pickRandomLayer(scene.layers) || pickRandomLayer(createDefaultScene().layers);
    if (!chosenLayer) return;

    const normalizedX = point.x / stage.width;
    const normalizedY = point.y / stage.height;
    const pressMetrics = mapPressMetrics(durationMs);
    const pitch = mapYToPitch(normalizedY, scene.scale);
    const filterHz = mapXToFilter(normalizedX);
    const baseRadius = Math.min(stage.width, stage.height) * (Number(chosenLayer.radiusFactor) || 0.12);
    const size = Math.max(44, baseRadius * 2 * pressMetrics.sizeMultiplier);
    const angleRad = ((Number(chosenLayer.movementAngle) || 0) * Math.PI) / 180;
    const speedPx = Math.max(0, Number(chosenLayer.movementSpeed) || 0) * Math.min(stage.width, stage.height) * 0.065;
    const now = Date.now();
    const id = `${now}-${Math.round(Math.random() * 1e6)}`;
    const nextSpawn = {
      ...chosenLayer,
      id,
      createdAt: now,
      x: clamp(point.x + ((Number(chosenLayer.xOffset) || 0) * stage.width), 0, stage.width),
      y: clamp(point.y + ((Number(chosenLayer.yOffset) || 0) * stage.height), 0, stage.height),
      originX: clamp(point.x, 0, stage.width),
      originY: clamp(point.y, 0, stage.height),
      orbitAngle: Math.random() * Math.PI * 2,
      width: size,
      height: size,
      stretchX: 1,
      stretchY: 1,
      renderScale: 1,
      renderOpacity: chosenLayer.opacity || 1,
      vx: Math.cos(angleRad) * speedPx,
      vy: Math.sin(angleRad) * speedPx,
      orbitRadiusX: clamp(Number(chosenLayer.orbitRadiusX) || 0.12, 0.02, 0.45),
      orbitRadiusY: clamp(Number(chosenLayer.orbitRadiusY) || 0.12, 0.02, 0.45),
      lifetimeMs: pressMetrics.lifetimeMs,
      noteLengthMs: pressMetrics.noteLengthMs,
      attackMs: pressMetrics.attackMs,
      releaseMs: pressMetrics.releaseMs,
      fmDepth: pressMetrics.fmDepth,
      filterHz,
      pitchHz: pitch.frequency,
      midi: pitch.midi,
      noteLabel: pitch.noteLabel,
      sourceLayerName: chosenLayer.name,
    };

    audioEngineRef.current.triggerVoice(nextSpawn);
    setLastVoiceSummary(`${pitch.noteLabel} | ${Math.round(pitch.frequency)}Hz | cutoff ${filterHz}Hz | attack ${pressMetrics.attackMs}ms | release ${pressMetrics.releaseMs}ms`);
    setEngineStatus(audioEngineRef.current.getStatus());
    setSpawns((current) => [...current.slice(-(MAX_VISIBLE_SHAPES - 1)), nextSpawn]);
    return id;
  }, [scene.layers, scene.scale, stage]);

  const handleImportJson = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/json'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        setImportStatus('Import failed: the selected file did not expose a readable URI.');
        return;
      }

      let text;
      if (Platform.OS === 'web' && asset.file) {
        text = await asset.file.text();
      } else if (FileSystem) {
        text = await FileSystem.readAsStringAsync(asset.uri);
      } else {
        const response = await fetch(asset.uri);
        text = await response.text();
      }
      const rawJson = JSON.parse(text);
      const nextScene = normalizeBloomScene(rawJson);
      setScene(nextScene);
      setSpawns([]);
      audioEngineRef.current.releaseAll();
      setEngineStatus(audioEngineRef.current.getStatus());
      setImportStatus(`Loaded ${asset.name || 'JSON file'} with ${nextScene.layers.length} layer styles.`);
    } catch (error) {
      setImportStatus(`Import failed: ${error?.message || 'Unknown error'}`);
    }
  }, []);

  const clearShapes = useCallback(() => {
    setSpawns([]);
    audioEngineRef.current.releaseAll();
    setEngineStatus(audioEngineRef.current.getStatus());
  }, []);

  const restoreDemo = useCallback(() => {
    clearShapes();
    setScene(createDefaultScene());
    setImportStatus('Restored the bundled Bloom demo scene.');
  }, [clearShapes]);

  const beginPinch = useCallback((touches) => {
    const midpoint = midpointBetweenTouches(touches);
    const target = findSpawnAtPoint(spawnsRef.current, midpoint);
    if (!target) {
      interactionRef.current = { mode: 'blocked-multi-touch' };
      return null;
    }

    const dx = Math.abs((Number(touches[1]?.locationX) || 0) - (Number(touches[0]?.locationX) || 0));
    const dy = Math.abs((Number(touches[1]?.locationY) || 0) - (Number(touches[0]?.locationY) || 0));
    interactionRef.current = {
      mode: 'pinch',
      spawnId: target.id,
      startDistance: Math.max(16, distanceBetweenTouches(touches)),
      startDx: Math.max(16, dx),
      startDy: Math.max(16, dy),
      startStretchX: target.stretchX || 1,
      startStretchY: target.stretchY || 1,
      startFilterHz: target.filterHz || 400,
      startFmDepth: target.fmDepth || 2,
    };
    return interactionRef.current;
  }, []);

  const updatePinch = useCallback((touches) => {
    const pinch = interactionRef.current?.mode === 'pinch'
      ? interactionRef.current
      : beginPinch(touches);

    if (!pinch || pinch.mode !== 'pinch') return;

    const dx = Math.abs((Number(touches[1]?.locationX) || 0) - (Number(touches[0]?.locationX) || 0));
    const dy = Math.abs((Number(touches[1]?.locationY) || 0) - (Number(touches[0]?.locationY) || 0));
    const nextStretchX = clamp(pinch.startStretchX * (Math.max(16, dx) / pinch.startDx), 0.55, 2.8);
    const nextStretchY = clamp(pinch.startStretchY * (Math.max(16, dy) / pinch.startDy), 0.55, 2.8);
    const timbreScale = (nextStretchX + nextStretchY) / 2;

    setSpawns((current) => current.map((spawn) => {
      if (spawn.id !== pinch.spawnId) return spawn;
      const nextSpawn = {
        ...spawn,
        stretchX: nextStretchX,
        stretchY: nextStretchY,
        filterHz: Math.round(clamp(pinch.startFilterHz * timbreScale, 120, 7200)),
        fmDepth: Number(clamp(pinch.startFmDepth * nextStretchY, 0.6, 16).toFixed(2)),
      };
      audioEngineRef.current.updateVoice(spawn.id, nextSpawn);
      setLastVoiceSummary(`${spawn.noteLabel} | cutoff ${nextSpawn.filterHz}Hz | FM depth ${nextSpawn.fmDepth}`);
      return nextSpawn;
    }));
  }, [beginPinch]);

  const stageResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        beginPinch(touches);
        return;
      }
      const touch = touches[0] || event.nativeEvent;
      const point = pointFromTouch(touch);
      const spawnId = triggerSpawn(point, 50);
      interactionRef.current = {
        mode: 'press',
        point,
        startedAt: Date.now(),
        spawnId,
      };
    },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        updatePinch(touches);
        return;
      }
      const interaction = interactionRef.current;
      if (interaction?.mode === 'press' && interaction.spawnId) {
        const durationMs = Date.now() - interaction.startedAt;
        const pressMetrics = mapPressMetrics(durationMs);
        setSpawns((current) => current.map((spawn) => {
          if (spawn.id !== interaction.spawnId) return spawn;
          const baseRadius = Math.min(stage.width, stage.height) * (Number(spawn.radiusFactor) || 0.12);
          const size = Math.max(44, baseRadius * 2 * pressMetrics.sizeMultiplier);
          return {
            ...spawn,
            width: size,
            height: size,
            lifetimeMs: pressMetrics.lifetimeMs,
            noteLengthMs: pressMetrics.noteLengthMs,
            releaseMs: pressMetrics.releaseMs,
          };
        }));
        audioEngineRef.current.extendVoice(interaction.spawnId, pressMetrics);
      }
    },
    onPanResponderRelease: () => {
      const interaction = interactionRef.current;
      if (interaction?.mode === 'press' && interaction.spawnId) {
        const durationMs = Date.now() - interaction.startedAt;
        const pressMetrics = mapPressMetrics(durationMs);
        setSpawns((current) => current.map((spawn) => {
          if (spawn.id !== interaction.spawnId) return spawn;
          const baseRadius = Math.min(stage.width, stage.height) * (Number(spawn.radiusFactor) || 0.12);
          const size = Math.max(44, baseRadius * 2 * pressMetrics.sizeMultiplier);
          return {
            ...spawn,
            width: size,
            height: size,
            lifetimeMs: pressMetrics.lifetimeMs,
            createdAt: Date.now() - spawn.ageMs,
          };
        }));
        audioEngineRef.current.releaseHeldVoice(interaction.spawnId, pressMetrics);
      }
      interactionRef.current = null;
    },
    onPanResponderTerminate: () => {
      interactionRef.current = null;
    },
  }), [beginPinch, triggerSpawn, updatePinch]);

  const gradientStops = useMemo(() => spawns.map((spawn) => ({
    id: `fill-${spawn.id}`,
    colors: Array.isArray(spawn.colors) && spawn.colors.length ? spawn.colors : ['#ffffff'],
  })), [spawns]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>Bloom</Text>
            <Text style={styles.title}>Tap to grow a moving shape and a mapped voice descriptor.</Text>
            <Text style={styles.subtitle}>{importStatus}</Text>
          </View>
          <View style={styles.headerButtons}>
            <Pressable style={styles.primaryButton} onPress={handleImportJson}>
              <Text style={styles.primaryButtonText}>Load JSON</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={restoreDemo}>
              <Text style={styles.secondaryButtonText}>Demo Scene</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={clearShapes}>
              <Text style={styles.secondaryButtonText}>Clear</Text>
            </Pressable>
          </View>
        </View>

        <View
          style={[styles.stageCard, { backgroundColor: scene.backgroundColor || '#08121A' }]}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setStage({ width, height });
          }}
          {...stageResponder.panHandlers}
        >
          <Svg width="100%" height="100%" viewBox={`0 0 ${Math.max(1, stage.width)} ${Math.max(1, stage.height)}`}>
            <Rect x="0" y="0" width={Math.max(1, stage.width)} height={Math.max(1, stage.height)} fill={scene.backgroundColor || '#08121A'} />
            <Defs>
              {gradientStops.map((gradient) => (
                <LinearGradient key={gradient.id} id={gradient.id} x1="0%" y1="0%" x2="100%" y2="100%">
                  {gradient.colors.map((color, index) => (
                    <Stop
                      key={`${gradient.id}-${color}-${index}`}
                      offset={`${gradient.colors.length === 1 ? 0 : (index / (gradient.colors.length - 1)) * 100}%`}
                      stopColor={color}
                      stopOpacity={1}
                    />
                  ))}
                </LinearGradient>
              ))}
            </Defs>
            {spawns.map((spawn) => (
              <Path
                key={spawn.id}
                d={buildShapePath(spawn)}
                fill={`url(#fill-${spawn.id})`}
                opacity={spawn.renderOpacity || spawn.opacity || 1}
              />
            ))}
          </Svg>
          <View style={styles.stageHintWrap} pointerEvents="none">
            <Text style={styles.stageHint}>Hold to grow size, lifetime, attack, and release. Pinch any live shape directly to stretch it and push its timbre mapping.</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.footer}>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Scene</Text>
            <Text style={styles.panelValue}>{scene.name}</Text>
            <Text style={styles.panelMeta}>{scene.layers.length} style layers, random per tap</Text>
            <Text style={styles.panelMeta}>Background {scene.backgroundColor}</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Interaction Map</Text>
            <Text style={styles.panelValue}>Y = pitch in {scene.scale?.name || 'scale'}</Text>
            <Text style={styles.panelMeta}>X = filter cutoff</Text>
            <Text style={styles.panelMeta}>Press = size, lifetime, attack, release</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Voice Engine</Text>
            <Text style={styles.panelValue}>{engineStatus.mode}</Text>
            <Text style={styles.panelMeta}>{engineStatus.activeVoices} active descriptors</Text>
            <Text style={styles.panelMeta}>{lastVoiceSummary}</Text>
          </View>
          <View style={styles.panelWide}>
            <Text style={styles.panelLabel}>Current Limit</Text>
            <Text style={styles.panelMeta}>This scaffold implements the import pipeline, random style spawning, motion, pitch/filter mapping, and permanent pinch deformation.</Text>
            <Text style={styles.panelMeta}>Actual low-latency FM sound generation is intentionally abstracted behind `BloomAudioEngine` and still needs the native audio spike we planned.</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050816',
  },
  screen: {
    flex: 1,
    backgroundColor: '#050816',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 14,
  },
  header: {
    paddingVertical: 8,
    gap: 12,
  },
  headerCopy: {
    gap: 4,
  },
  kicker: {
    color: '#7dd3fc',
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 29,
  },
  subtitle: {
    color: '#bfd6e7',
    fontSize: 14,
    lineHeight: 20,
  },
  headerButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#f97316',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  secondaryButton: {
    borderColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  stageCard: {
    flex: 1,
    minHeight: 320,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    position: 'relative',
  },
  stageHintWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(5,8,22,0.72)',
  },
  stageHint: {
    color: '#d6edf9',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    gap: 12,
    paddingBottom: 2,
  },
  panel: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: '#0d1528',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  panelWide: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: '#111d36',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 6,
  },
  panelLabel: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  panelValue: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
  },
  panelMeta: {
    color: '#bfd6e7',
    fontSize: 14,
    lineHeight: 19,
  },
});
