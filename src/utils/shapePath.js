const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function rotatePoint(x, y, rotationDeg) {
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos),
  };
}

function resolveSideCount(shapeType, rawSides) {
  const sides = Math.max(3, Math.round(Number(rawSides) || 6));
  switch (shapeType) {
    case 'triangle':
      return 3;
    case 'square':
    case 'rectangle':
      return 4;
    case 'circle':
    case 'ellipse':
      return 28;
    default:
      return sides;
  }
}

function buildPolygonPoints(spawn) {
  const sideCount = resolveSideCount(spawn.shapeType, spawn.numSides);
  const radiusX = (spawn.width / 2) * (spawn.stretchX || 1) * (spawn.renderScale || 1);
  const radiusY = (spawn.height / 2) * (spawn.stretchY || 1) * (spawn.renderScale || 1);
  const wobble = clamp(Number(spawn.wobble) || 0, 0, 1);
  const noiseAmount = Math.max(0, Number(spawn.noiseAmount) || 0);
  const noiseScale = Math.max(0.1, Number(spawn.noiseScale) || 1);
  const wobbleSpeed = Math.max(0, Number(spawn.wobbleSpeed) || 0.6);
  const time = (Number(spawn.ageMs) || 0) / 1000;
  const rotation = Number(spawn.rotation) || 0;
  const avgRadius = (radiusX + radiusY) / 2;
  const points = [];

  for (let index = 0; index < sideCount; index += 1) {
    const angle = (index / sideCount) * TAU;
    const starMultiplier = spawn.shapeType === 'star' && index % 2 === 1 ? 0.55 : 1;
    const harmonic = angle * noiseScale;
    const offset = (
      Math.sin((harmonic * (spawn.freq1 || 2)) + (time * wobbleSpeed)) +
      Math.cos((harmonic * (spawn.freq2 || 3)) - (time * wobbleSpeed * 0.6)) +
      Math.sin((harmonic * (spawn.freq3 || 5)) + (time * wobbleSpeed * 1.3))
    ) * avgRadius * 0.055 * noiseAmount * wobble;
    const localX = Math.cos(angle) * radiusX * starMultiplier;
    const localY = Math.sin(angle) * radiusY * starMultiplier;
    const localRadius = Math.hypot(localX, localY) || 1;
    const warpedX = localX + ((localX / localRadius) * offset);
    const warpedY = localY + ((localY / localRadius) * offset);
    const rotated = rotatePoint(warpedX, warpedY, rotation);

    points.push({
      x: spawn.x + rotated.x,
      y: spawn.y + rotated.y,
    });
  }

  return points;
}

function buildNodePoints(spawn) {
  const rotation = Number(spawn.rotation) || 0;
  const scaleX = (spawn.width || 120) * (spawn.stretchX || 1) * (spawn.renderScale || 1);
  const scaleY = (spawn.height || 120) * (spawn.stretchY || 1) * (spawn.renderScale || 1);

  return spawn.nodes.map((node) => {
    const localX = ((Number(node.x) || 0.5) - 0.5) * scaleX;
    const localY = ((Number(node.y) || 0.5) - 0.5) * scaleY;
    const rotated = rotatePoint(localX, localY, rotation);
    return {
      x: spawn.x + rotated.x,
      y: spawn.y + rotated.y,
    };
  });
}

function smoothClosedPath(points, curviness) {
  if (!Array.isArray(points) || points.length < 3) return '';
  const t = clamp(Number(curviness) || 0, 0, 1);
  const first = points[0];
  const last = points[points.length - 1];

  if (t <= 0.001) {
    return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`;
  }

  const startMid = {
    x: (last.x + first.x) / 2,
    y: (last.y + first.y) / 2,
  };
  const start = {
    x: (first.x * (1 - t)) + (startMid.x * t),
    y: (first.y * (1 - t)) + (startMid.y * t),
  };

  let path = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const midpoint = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
    const end = {
      x: (next.x * (1 - t)) + (midpoint.x * t),
      y: (next.y * (1 - t)) + (midpoint.y * t),
    };
    path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  return `${path} Z`;
}

export function buildShapePath(spawn) {
  const points = Array.isArray(spawn.nodes) && spawn.nodes.length >= 3
    ? buildNodePoints(spawn)
    : buildPolygonPoints(spawn);
  return smoothClosedPath(points, spawn.curviness);
}
