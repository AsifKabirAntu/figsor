// Figsor - Figma Plugin Code (Sandbox)
// This code runs in Figma's plugin sandbox. It receives commands from the UI
// (which connects to the MCP server via WebSocket) and executes Figma API calls.

figma.showUI(__html__, { width: 340, height: 440, themeColors: true });

// ─── Startup: Clean up stale agent cursors from previous sessions ───────────
(function() {
  var staleAgents = figma.currentPage.findAll(function(n) {
    return n.name && n.name.startsWith('Agent: ');
  });
  if (staleAgents.length > 0) {
    for (var i = 0; i < staleAgents.length; i++) {
      try { staleAgents[i].remove(); } catch (e) {}
    }
    console.log('Cleaned up ' + staleAgents.length + ' stale agent cursor(s) from previous session');
  }
})();

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexToFigmaColor(hex) {
  hex = hex.replace('#', '');
  let r, g, b, a = 1;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
  } else if (hex.length === 8) {
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
    a = parseInt(hex.substring(6, 8), 16) / 255;
  } else {
    return { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
  }
  return { color: { r, g, b }, opacity: a };
}

function applyFill(node, hexColor) {
  if (!hexColor) return;
  const { color, opacity } = hexToFigmaColor(hexColor);
  node.fills = [{ type: 'SOLID', color, opacity }];
}

function applyGradientFill(node, gradient) {
  if (!gradient) return;
  var stops = (gradient.stops || []).map(function(s) {
    var parsed = hexToFigmaColor(s.color || '#000000');
    return {
      position: s.position !== undefined ? s.position : 0,
      color: { r: parsed.color.r, g: parsed.color.g, b: parsed.color.b, a: parsed.opacity },
    };
  });
  if (stops.length < 2) return;

  var gradientType = gradient.type || 'GRADIENT_LINEAR';

  var gradientTransform = gradient.gradientTransform || [[1, 0, 0], [0, 1, 0]];

  node.fills = [{
    type: gradientType,
    gradientStops: stops,
    gradientTransform: gradientTransform,
  }];
}

function applyStroke(node, params) {
  if (!params) return;
  const { color, opacity } = hexToFigmaColor(params.color || '#000000');
  node.strokes = [{ type: 'SOLID', color, opacity }];
  node.strokeWeight = params.weight || 1;
  if (params.strokeAlign) node.strokeAlign = params.strokeAlign;
}

async function resolveParent(parentId) {
  if (!parentId) return figma.currentPage;
  const parent = await figma.getNodeByIdAsync(parentId);
  if (parent && 'appendChild' in parent) return parent;
  throw new Error('Parent node not found or cannot have children: ' + parentId);
}

async function getNode(nodeId) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error('Node not found: ' + nodeId);
  return node;
}

function serializeNode(node, depth, maxDepth) {
  depth = depth || 0;
  maxDepth = maxDepth || 4;

  const s = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if ('x' in node) { s.x = Math.round(node.x); s.y = Math.round(node.y); }
  if ('width' in node) { s.width = Math.round(node.width); s.height = Math.round(node.height); }
  if ('fills' in node && Array.isArray(node.fills) && node.fills.length > 0) {
    const fill = node.fills[0];
    if (fill.type === 'SOLID') {
      s.fill = '#' +
        Math.round(fill.color.r * 255).toString(16).padStart(2, '0') +
        Math.round(fill.color.g * 255).toString(16).padStart(2, '0') +
        Math.round(fill.color.b * 255).toString(16).padStart(2, '0');
    }
  }
  if (node.type === 'TEXT') {
    s.characters = node.characters;
    if (typeof node.fontSize === 'number') s.fontSize = node.fontSize;
  }
  if ('opacity' in node && typeof node.opacity === 'number' && node.opacity !== 1) s.opacity = node.opacity;
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius !== 0) s.cornerRadius = node.cornerRadius;
  if ('layoutMode' in node && typeof node.layoutMode === 'string' && node.layoutMode !== 'NONE') {
    s.layoutMode = node.layoutMode;
    if (typeof node.itemSpacing === 'number') s.itemSpacing = node.itemSpacing;
  }

  if (depth < maxDepth && 'children' in node && node.children) {
    s.children = node.children.map(function(child) {
      return serializeNode(child, depth + 1, maxDepth);
    });
  } else if ('children' in node && node.children) {
    s.childCount = node.children.length;
  }

  return s;
}

// ─── Agent Cursors (Peer Design) ──────────────────────────────────────────

var agentCursors = {}; // { agentId: { nodeId, name, color, personality, wandering, homeX, homeY, vx, vy } }

// Each agent has a personality — affects movement speed and wander radius
var agentPersonalities = {
  _fast:       { speedScale: 0.7,  wanderRadius: 40, pauseMin: 60,  pauseMax: 140 },
  _moderate:   { speedScale: 1.0,  wanderRadius: 55, pauseMin: 80,  pauseMax: 200 },
  _deliberate: { speedScale: 1.35, wanderRadius: 35, pauseMin: 120, pauseMax: 280 },
};
var _personalityIndex = 0;
var _personalityOrder = ['_fast', '_moderate', '_deliberate'];

function getAbsolutePosition(node) {
  var x = 0, y = 0;
  var current = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    x += current.x;
    y += current.y;
    current = current.parent;
  }
  return { x: x, y: y };
}

// ── Minimum Jerk interpolation ──
// This is the actual mathematical model of human hand movement.
// Produces a smooth bell-shaped velocity profile — fast in the middle, slow at ends.
function _minJerk(t) {
  return 10*t*t*t - 15*t*t*t*t + 6*t*t*t*t*t;
}

// ── Single smooth human-like move from current pos to target ──
async function _humanMove(cursorNode, targetX, targetY, durationMs) {
  var sx = cursorNode.x;
  var sy = cursorNode.y;
  var dx = targetX - sx;
  var dy = targetY - sy;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 3) { cursorNode.x = targetX; cursorNode.y = targetY; return; }

  // Slight perpendicular arc — real hands don't move in perfect straight lines
  var perpX = -dy / dist;
  var perpY = dx / dist;
  var arc = (Math.random() - 0.5) * Math.min(dist * 0.09, 28);

  var steps = Math.max(6, Math.round(durationMs / 16));

  for (var i = 1; i <= steps; i++) {
    var t = i / steps;
    var mj = _minJerk(t);
    var blend = 4 * t * (1 - t); // arc peaks at midpoint

    cursorNode.x = sx + dx * mj + perpX * arc * blend;
    cursorNode.y = sy + dy * mj + perpY * arc * blend;

    await new Promise(function(r) { setTimeout(r, 16); });
  }

  cursorNode.x = targetX;
  cursorNode.y = targetY;
}

// ── Background wander ──
// Subtle idle movement — like a real designer's hand resting on a mouse.
// Mostly stays near current position. Occasional small drift, long pauses.
// Uses setTimeout (not async) so other agents tick during the pauses.
function _startWander(agentId) {
  var agent = agentCursors[agentId];
  if (!agent || !agent.wandering) return;

  figma.getNodeByIdAsync(agent.nodeId).then(function(cursorNode) {
    if (!cursorNode || !agentCursors[agentId] || !agentCursors[agentId].wandering) return;

    var p = agent.personality || agentPersonalities._moderate;

    // 65% of the time: just sit still (real designers aren't constantly moving)
    if (Math.random() < 0.65) {
      var idlePause = 400 + Math.random() * 600;
      setTimeout(function() { _startWander(agentId); }, idlePause);
      return;
    }

    // 35% of the time: small drift from current position (not from home — organic)
    var angle = Math.random() * Math.PI * 2;
    var r = 8 + Math.random() * 18; // small: 8-26px only
    var wx = cursorNode.x + Math.cos(angle) * r;
    var wy = cursorNode.y + Math.sin(angle) * r * 0.7;

    var sx = cursorNode.x;
    var sy = cursorNode.y;
    var dx = wx - sx;
    var dy = wy - sy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var moveDuration = Math.max(150, dist * 5 * p.speedScale);
    var steps = Math.max(5, Math.round(moveDuration / 16));
    var i = 0;

    function step() {
      if (!agentCursors[agentId] || !agentCursors[agentId].wandering) return;
      i++;
      if (i > steps) {
        // Long pause after drift — designer is "looking" at the design
        var pause = 500 + Math.random() * 800;
        setTimeout(function() { _startWander(agentId); }, pause);
        return;
      }
      var t = i / steps;
      cursorNode.x = sx + dx * _minJerk(t);
      cursorNode.y = sy + dy * _minJerk(t);
      if (cursorNode.parent && cursorNode.parent.type === 'PAGE') {
        figma.currentPage.appendChild(cursorNode);
      }
      setTimeout(step, 16);
    }

    step();
  });
}

// ── Main targeted movement ──
// Smooth minimum-jerk move to the target. Other agents wander during await pauses.
async function moveAgentCursorTo(agentId, targetX, targetY) {
  var agent = agentCursors[agentId];
  if (!agent) return;

  var cursorNode = await figma.getNodeByIdAsync(agent.nodeId);
  if (!cursorNode) { delete agentCursors[agentId]; return; }

  var p = agent.personality || agentPersonalities._moderate;

  // Stop wander for this agent while it does targeted work
  agent.wandering = false;

  var dist = Math.sqrt(Math.pow(targetX - cursorNode.x, 2) + Math.pow(targetY - cursorNode.y, 2));

  // Duration: proportional to distance, scaled by personality
  var duration = Math.min(Math.max(dist * 2.2, 200), 600) * p.speedScale;

  await _humanMove(cursorNode, targetX, targetY, duration);

  // Keep on top after move
  if (cursorNode.parent && cursorNode.parent.type === 'PAGE') {
    figma.currentPage.appendChild(cursorNode);
  }

  // Resume wandering around the new target position
  if (agentCursors[agentId]) {
    agent.homeX = targetX;
    agent.homeY = targetY;
    agent.wandering = true;
    _startWander(agentId);
  }
}

async function handleSpawnAgent(params) {
  var agentId = params.agentId || params.name || 'agent';
  var name = params.name || agentId;
  var colorHex = params.color || '#3B82F6';
  var parsedColor = hexToFigmaColor(colorHex);

  // Remove existing cursor for this agent if any
  if (agentCursors[agentId]) {
    try {
      var oldNode = await figma.getNodeByIdAsync(agentCursors[agentId].nodeId);
      if (oldNode) oldNode.remove();
    } catch (e) {}
    delete agentCursors[agentId];
  }

  // Create cursor arrow (Figma-native style: colored fill + white outline)
  var cursorSvg = '<svg width="17" height="25" viewBox="-1 -1 17 25" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M0.5 0.5L0.5 18.5L5.5 14L8.5 21L11 19.5L8 12.5H14L0.5 0.5Z" fill="' + colorHex + '" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>' +
    '</svg>';

  var arrow = figma.createNodeFromSvg(cursorSvg);
  arrow.name = 'arrow';
  arrow.x = 0;
  arrow.y = 0;
  arrow.locked = true;

  // Create name label pill (Figma-native style)
  var label = figma.createFrame();
  label.name = 'label';
  label.fills = [{ type: 'SOLID', color: parsedColor.color, opacity: parsedColor.opacity }];
  label.cornerRadius = 5;
  label.layoutMode = 'HORIZONTAL';
  label.paddingLeft = 8;
  label.paddingRight = 8;
  label.paddingTop = 3;
  label.paddingBottom = 3;
  label.primaryAxisSizingMode = 'AUTO';
  label.counterAxisSizingMode = 'AUTO';
  label.x = 14;
  label.y = 18;
  label.locked = true;

  // Label text
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
  var labelText = figma.createText();
  labelText.fontName = { family: 'Inter', style: 'Semi Bold' };
  labelText.characters = name;
  labelText.fontSize = 11;
  labelText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  labelText.locked = true;
  label.appendChild(labelText);

  // Group cursor elements
  var cursor = figma.group([arrow, label], figma.currentPage);
  cursor.name = 'Agent: ' + name;
  cursor.locked = true;

  // Position at initial location
  cursor.x = params.x || 0;
  cursor.y = params.y || 0;

  // Assign a movement personality — each agent moves differently
  var personalityKey = _personalityOrder[_personalityIndex % _personalityOrder.length];
  _personalityIndex++;

  agentCursors[agentId] = {
    nodeId: cursor.id,
    name: name,
    color: colorHex,
    personality: agentPersonalities[personalityKey],
    wandering: true,
    homeX: cursor.x,
    homeY: cursor.y,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
  };

  // Start continuous background wander immediately
  _startWander(agentId);

  // Notify UI
  figma.ui.postMessage({ type: 'agent_spawned', agentId: agentId, name: name, color: colorHex });

  return { agentId: agentId, name: name, nodeId: cursor.id, color: colorHex };
}

async function handleDismissAgent(params) {
  var agentId = params.agentId;
  var agent = agentCursors[agentId];
  if (!agent) return { dismissed: false, reason: 'Agent not found: ' + agentId };

  // Stop wander loop first
  agent.wandering = false;

  try {
    var node = await figma.getNodeByIdAsync(agent.nodeId);
    if (node) node.remove();
  } catch (e) {}

  var agentName = agent.name;
  delete agentCursors[agentId];

  figma.ui.postMessage({ type: 'agent_dismissed', agentId: agentId });

  return { dismissed: true, agentId: agentId, name: agentName };
}

async function handleDismissAllAgents() {
  // Stop all wander loops first
  var ids = Object.keys(agentCursors);
  for (var wi = 0; wi < ids.length; wi++) {
    if (agentCursors[ids[wi]]) agentCursors[ids[wi]].wandering = false;
  }

  // Remove tracked cursors
  var count = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      var node = await figma.getNodeByIdAsync(agentCursors[ids[i]].nodeId);
      if (node) { node.remove(); count++; }
    } catch (e) {}
  }
  agentCursors = {};

  // Also scan for any orphaned agent cursors (from crashed/previous sessions)
  var orphans = figma.currentPage.findAll(function(n) {
    return n.name && n.name.startsWith('Agent: ');
  });
  for (var oi = 0; oi < orphans.length; oi++) {
    try { orphans[oi].remove(); count++; } catch (e) {}
  }

  figma.ui.postMessage({ type: 'agents_all_dismissed' });

  return { dismissed: count };
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleCreateFrame(params) {
  const frame = figma.createFrame();
  frame.name = params.name || 'Frame';
  frame.x = params.x || 0;
  frame.y = params.y || 0;
  frame.resize(params.width || 100, params.height || 100);

  if (params.fillColor) {
    applyFill(frame, params.fillColor);
  } else {
    // Default to white fill
    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  }

  if (params.cornerRadius !== undefined) {
    frame.cornerRadius = params.cornerRadius;
  }

  const parent = await resolveParent(params.parentId);
  parent.appendChild(frame);

  return { id: frame.id, name: frame.name, width: frame.width, height: frame.height };
}

async function handleCreateRectangle(params) {
  const rect = figma.createRectangle();
  rect.name = params.name || 'Rectangle';
  rect.x = params.x || 0;
  rect.y = params.y || 0;
  rect.resize(params.width || 100, params.height || 100);

  if (params.fillColor) {
    applyFill(rect, params.fillColor);
  }

  if (params.cornerRadius !== undefined) {
    rect.cornerRadius = params.cornerRadius;
  }

  const parent = await resolveParent(params.parentId);
  parent.appendChild(rect);

  return { id: rect.id, name: rect.name };
}

async function handleCreateEllipse(params) {
  const ellipse = figma.createEllipse();
  ellipse.name = params.name || 'Ellipse';
  ellipse.x = params.x || 0;
  ellipse.y = params.y || 0;
  ellipse.resize(params.width || 100, params.height || 100);

  if (params.fillColor) {
    applyFill(ellipse, params.fillColor);
  }

  const parent = await resolveParent(params.parentId);
  parent.appendChild(ellipse);

  return { id: ellipse.id, name: ellipse.name };
}

async function handleCreateText(params) {
  const text = figma.createText();

  const fontFamily = params.fontFamily || 'Inter';
  const fontStyle = params.fontStyle || 'Regular';

  await figma.loadFontAsync({ family: fontFamily, style: fontStyle });

  text.fontName = { family: fontFamily, style: fontStyle };
  text.characters = params.text || '';
  text.fontSize = params.fontSize || 14;
  text.x = params.x || 0;
  text.y = params.y || 0;

  if (params.width) {
    text.resize(params.width, text.height);
    text.textAutoResize = 'HEIGHT';
  }

  if (params.letterSpacing !== undefined) {
    text.letterSpacing = { value: params.letterSpacing, unit: 'PIXELS' };
  }

  if (params.lineHeight !== undefined) {
    text.lineHeight = { value: params.lineHeight, unit: 'PIXELS' };
  }

  if (params.textAlignHorizontal) {
    text.textAlignHorizontal = params.textAlignHorizontal;
  }

  if (params.fillColor) {
    applyFill(text, params.fillColor);
  }

  const parent = await resolveParent(params.parentId);
  parent.appendChild(text);

  return { id: text.id, name: text.name, width: Math.round(text.width), height: Math.round(text.height) };
}

async function handleCreateLine(params) {
  const line = figma.createLine();
  line.name = params.name || 'Line';
  line.x = params.x || 0;
  line.y = params.y || 0;
  line.resize(params.length || 100, 0);

  const { color, opacity } = hexToFigmaColor(params.color || '#000000');
  line.strokes = [{ type: 'SOLID', color, opacity }];
  line.strokeWeight = params.strokeWeight || 1;

  if (params.rotation) {
    line.rotation = params.rotation;
  }

  const parent = await resolveParent(params.parentId);
  parent.appendChild(line);

  return { id: line.id, name: line.name };
}

async function handleCreateSvgNode(params) {
  if (!params.svg) throw new Error('SVG string is required');
  const node = figma.createNodeFromSvg(params.svg);
  node.name = params.name || 'SVG';
  node.x = params.x || 0;
  node.y = params.y || 0;

  if (params.width && params.height) {
    node.resize(params.width, params.height);
  }

  const parent = await resolveParent(params.parentId);
  parent.appendChild(node);

  return { id: node.id, name: node.name, width: Math.round(node.width), height: Math.round(node.height) };
}

async function handleSetAutoLayout(params) {
  const node = await getNode(params.nodeId);
  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    throw new Error('Auto-layout can only be set on frames and components');
  }

  node.layoutMode = params.direction || 'VERTICAL';

  if (params.spacing !== undefined) node.itemSpacing = params.spacing;
  if (params.paddingTop !== undefined) node.paddingTop = params.paddingTop;
  if (params.paddingRight !== undefined) node.paddingRight = params.paddingRight;
  if (params.paddingBottom !== undefined) node.paddingBottom = params.paddingBottom;
  if (params.paddingLeft !== undefined) node.paddingLeft = params.paddingLeft;
  if (params.padding !== undefined) {
    node.paddingTop = params.padding;
    node.paddingRight = params.padding;
    node.paddingBottom = params.padding;
    node.paddingLeft = params.padding;
  }
  if (params.primaryAxisAlignItems) node.primaryAxisAlignItems = params.primaryAxisAlignItems;
  if (params.counterAxisAlignItems) node.counterAxisAlignItems = params.counterAxisAlignItems;
  if (params.primaryAxisSizingMode) node.primaryAxisSizingMode = params.primaryAxisSizingMode;
  if (params.counterAxisSizingMode) node.counterAxisSizingMode = params.counterAxisSizingMode;

  return { id: node.id, layoutMode: node.layoutMode, itemSpacing: node.itemSpacing };
}

async function handleModifyNode(params) {
  const node = await getNode(params.nodeId);

  if (params.name !== undefined) node.name = params.name;
  if (params.x !== undefined) node.x = params.x;
  if (params.y !== undefined) node.y = params.y;
  if (params.width !== undefined || params.height !== undefined) {
    const w = params.width !== undefined ? params.width : node.width;
    const h = params.height !== undefined ? params.height : node.height;
    node.resize(w, h);
  }
  if (params.fillColor !== undefined) applyFill(node, params.fillColor);
  if (params.opacity !== undefined) node.opacity = params.opacity;
  if (params.cornerRadius !== undefined && 'cornerRadius' in node) node.cornerRadius = params.cornerRadius;
  if (params.visible !== undefined) node.visible = params.visible;
  if (params.rotation !== undefined) node.rotation = params.rotation;

  // Auto-layout child properties
  if (params.layoutSizingHorizontal !== undefined && 'layoutSizingHorizontal' in node) {
    node.layoutSizingHorizontal = params.layoutSizingHorizontal;
  }
  if (params.layoutSizingVertical !== undefined && 'layoutSizingVertical' in node) {
    node.layoutSizingVertical = params.layoutSizingVertical;
  }
  if (params.layoutAlign !== undefined && 'layoutAlign' in node) {
    node.layoutAlign = params.layoutAlign;
  }
  if (params.layoutGrow !== undefined && 'layoutGrow' in node) {
    node.layoutGrow = params.layoutGrow;
  }

  // Text-specific
  if (node.type === 'TEXT') {
    if (params.characters !== undefined) {
      const fontName = node.fontName;
      if (fontName !== figma.mixed) {
        await figma.loadFontAsync(fontName);
      } else {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      }
      node.characters = params.characters;
    }
    if (params.fontSize !== undefined) {
      const fontName = node.fontName;
      if (fontName !== figma.mixed) {
        await figma.loadFontAsync(fontName);
      }
      node.fontSize = params.fontSize;
    }
    if (params.textAlignHorizontal !== undefined) {
      node.textAlignHorizontal = params.textAlignHorizontal;
    }
  }

  return { id: node.id, name: node.name };
}

async function handleSetStroke(params) {
  const node = await getNode(params.nodeId);
  if (!('strokes' in node)) throw new Error('Node cannot have strokes');

  const { color, opacity } = hexToFigmaColor(params.color || '#000000');
  node.strokes = [{ type: 'SOLID', color, opacity }];
  node.strokeWeight = params.weight || 1;
  if (params.strokeAlign && 'strokeAlign' in node) node.strokeAlign = params.strokeAlign;
  if (params.dashPattern) node.dashPattern = params.dashPattern;

  return { id: node.id, name: node.name };
}

async function handleSetEffects(params) {
  const node = await getNode(params.nodeId);
  if (!('effects' in node)) throw new Error('Node cannot have effects');

  const figmaEffects = (params.effects || []).map(function(effect) {
    if (effect.type === 'DROP_SHADOW') {
      const { color, opacity } = hexToFigmaColor(effect.color || '#00000040');
      return {
        type: 'DROP_SHADOW',
        color: { r: color.r, g: color.g, b: color.b, a: opacity },
        offset: { x: effect.offsetX || 0, y: effect.offsetY || 4 },
        radius: effect.radius || 4,
        spread: effect.spread || 0,
        visible: true,
        blendMode: 'NORMAL',
      };
    }
    if (effect.type === 'INNER_SHADOW') {
      const { color, opacity } = hexToFigmaColor(effect.color || '#00000040');
      return {
        type: 'INNER_SHADOW',
        color: { r: color.r, g: color.g, b: color.b, a: opacity },
        offset: { x: effect.offsetX || 0, y: effect.offsetY || 2 },
        radius: effect.radius || 4,
        spread: effect.spread || 0,
        visible: true,
        blendMode: 'NORMAL',
      };
    }
    if (effect.type === 'LAYER_BLUR') {
      return {
        type: 'LAYER_BLUR',
        radius: effect.radius || 4,
        visible: true,
      };
    }
    if (effect.type === 'BACKGROUND_BLUR') {
      return {
        type: 'BACKGROUND_BLUR',
        radius: effect.radius || 10,
        visible: true,
      };
    }
    return null;
  }).filter(Boolean);

  node.effects = figmaEffects;

  return { id: node.id, effectCount: figmaEffects.length };
}

async function handleDeleteNode(params) {
  const node = await getNode(params.nodeId);
  const name = node.name;
  node.remove();
  return { deleted: true, name: name };
}

async function handleGetSelection() {
  const selection = figma.currentPage.selection;
  return {
    count: selection.length,
    nodes: selection.map(function(node) { return serializeNode(node, 0, 2); }),
  };
}

async function handleGetPageStructure(params) {
  const maxDepth = params.maxDepth || 4;
  const page = figma.currentPage;
  return {
    pageName: page.name,
    children: page.children.map(function(child) {
      return serializeNode(child, 0, maxDepth);
    }),
  };
}

async function handleMoveToParent(params) {
  const node = await getNode(params.nodeId);
  const parent = await getNode(params.parentId);
  if (!('appendChild' in parent)) throw new Error('Target parent cannot have children');

  if (params.index !== undefined) {
    parent.insertChild(params.index, node);
  } else {
    parent.appendChild(node);
  }

  return { id: node.id, newParentId: parent.id, newParentName: parent.name };
}

async function handleReadNodeProperties(params) {
  const node = await getNode(params.nodeId);
  return serializeNode(node, 0, params.depth || 2);
}

// ─── Design System: Components ──────────────────────────────────────────────

function serializeComponent(comp) {
  const s = {
    id: comp.id,
    name: comp.name,
    type: comp.type,
    width: Math.round(comp.width),
    height: Math.round(comp.height),
    description: comp.description || '',
  };
  // If it's a COMPONENT_SET, list the variant names
  if (comp.type === 'COMPONENT_SET' && comp.children) {
    s.variants = comp.children.map(function(v) {
      return { id: v.id, name: v.name };
    });
  }
  // If it's a COMPONENT inside a set, include the parent set
  if (comp.parent && comp.parent.type === 'COMPONENT_SET') {
    s.componentSetId = comp.parent.id;
    s.componentSetName = comp.parent.name;
  }
  return s;
}

async function handleListComponents(params) {
  var components;
  if (params.pageOnly) {
    components = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
  } else {
    // Search the entire document
    components = figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
  }

  // Optional name filter
  if (params.nameFilter) {
    var filter = params.nameFilter.toLowerCase();
    components = components.filter(function(c) {
      return c.name.toLowerCase().includes(filter);
    });
  }

  // Limit results
  var limit = params.limit || 100;
  var results = components.slice(0, limit).map(serializeComponent);

  return {
    count: results.length,
    total: components.length,
    components: results,
  };
}

async function handleCreateComponentInstance(params) {
  var component = await figma.getNodeByIdAsync(params.componentId);
  if (!component) throw new Error('Component not found: ' + params.componentId);
  if (component.type !== 'COMPONENT') throw new Error('Node is not a component (type: ' + component.type + '). For component sets, use a specific variant ID.');

  var instance = component.createInstance();
  instance.x = params.x || 0;
  instance.y = params.y || 0;

  if (params.name) instance.name = params.name;

  if (params.width && params.height) {
    instance.resize(params.width, params.height);
  }

  if (params.parentId) {
    var parent = await resolveParent(params.parentId);
    parent.appendChild(instance);
  }

  return {
    id: instance.id,
    name: instance.name,
    componentId: component.id,
    componentName: component.name,
    width: Math.round(instance.width),
    height: Math.round(instance.height),
  };
}

async function handleDetachInstance(params) {
  var node = await getNode(params.nodeId);
  if (node.type !== 'INSTANCE') throw new Error('Node is not a component instance');
  var frame = node.detachInstance();
  return { id: frame.id, name: frame.name, type: frame.type };
}

// ─── Design System: Styles ──────────────────────────────────────────────────

async function handleGetLocalStyles() {
  var rawPaintStyles = await figma.getLocalPaintStylesAsync();
  var paintStyles = rawPaintStyles.map(function(s) {
    var hex = '';
    if (s.paints.length > 0 && s.paints[0].type === 'SOLID') {
      var c = s.paints[0].color;
      hex = '#' +
        Math.round(c.r * 255).toString(16).padStart(2, '0') +
        Math.round(c.g * 255).toString(16).padStart(2, '0') +
        Math.round(c.b * 255).toString(16).padStart(2, '0');
    }
    return { id: s.id, name: s.name, type: 'PAINT', hex: hex, description: s.description || '' };
  });

  var rawTextStyles = await figma.getLocalTextStylesAsync();
  var textStyles = rawTextStyles.map(function(s) {
    return {
      id: s.id,
      name: s.name,
      type: 'TEXT',
      fontFamily: s.fontName.family,
      fontStyle: s.fontName.style,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      description: s.description || '',
    };
  });

  var rawEffectStyles = await figma.getLocalEffectStylesAsync();
  var effectStyles = rawEffectStyles.map(function(s) {
    return {
      id: s.id,
      name: s.name,
      type: 'EFFECT',
      effects: s.effects.map(function(e) { return { type: e.type, radius: e.radius }; }),
      description: s.description || '',
    };
  });

  return {
    paintStyles: paintStyles,
    textStyles: textStyles,
    effectStyles: effectStyles,
  };
}

// ─── Team Library: Import by Key ────────────────────────────────────────────

async function handleImportComponentByKey(params) {
  if (!params.key) throw new Error('Component key is required');

  var component;
  try {
    component = await figma.importComponentByKeyAsync(params.key);
  } catch (e) {
    // Maybe it's a component set
    try {
      component = await figma.importComponentSetByKeyAsync(params.key);
    } catch (e2) {
      throw new Error('Could not import component with key: ' + params.key + '. Make sure the library is enabled. Error: ' + e.message);
    }
  }

  // If it's a component set, pick a default variant (first child)
  var targetComponent = component;
  if (component.type === 'COMPONENT_SET') {
    if (params.variantName) {
      // Find the variant by name
      var variant = component.children.find(function(c) {
        return c.name === params.variantName;
      });
      if (!variant) {
        // Try partial match
        variant = component.children.find(function(c) {
          return c.name.toLowerCase().includes(params.variantName.toLowerCase());
        });
      }
      if (variant) {
        targetComponent = variant;
      } else {
        targetComponent = component.defaultVariant || component.children[0];
      }
    } else {
      targetComponent = component.defaultVariant || component.children[0];
    }
  }

  var instance = targetComponent.createInstance();
  instance.x = params.x || 0;
  instance.y = params.y || 0;
  if (params.name) instance.name = params.name;
  if (params.width && params.height) instance.resize(params.width, params.height);

  if (params.parentId) {
    var parent = await resolveParent(params.parentId);
    parent.appendChild(instance);
  }

  // List available variants if it was a component set
  var variants = null;
  if (component.type === 'COMPONENT_SET') {
    variants = component.children.map(function(v) {
      return { id: v.id, name: v.name, key: v.key };
    });
  }

  return {
    id: instance.id,
    name: instance.name,
    componentName: component.name,
    width: Math.round(instance.width),
    height: Math.round(instance.height),
    variants: variants,
  };
}

async function handleImportStyleByKey(params) {
  if (!params.key) throw new Error('Style key is required');
  var style = await figma.importStyleByKeyAsync(params.key);
  return {
    id: style.id,
    name: style.name,
    type: style.type,
  };
}

// ─── Vector Drawing (Pen Tool) ──────────────────────────────────────────────

async function handleCreateVector(params) {
  var vector = figma.createVector();
  vector.name = params.name || 'Vector';
  vector.x = params.x || 0;
  vector.y = params.y || 0;

  if (params.width && params.height) {
    vector.resize(params.width, params.height);
  }

  // Apply vectorNetwork if provided (vertices, segments, regions)
  if (params.vectorNetwork) {
    var vn = params.vectorNetwork;
    vector.vectorNetwork = {
      vertices: (vn.vertices || []).map(function(v) {
        return {
          x: v.x,
          y: v.y,
          strokeCap: v.strokeCap || 'NONE',
          strokeJoin: v.strokeJoin || 'MITER',
          cornerRadius: v.cornerRadius || 0,
          handleMirroring: v.handleMirroring || 'NONE',
        };
      }),
      segments: (vn.segments || []).map(function(s) {
        var seg = {
          start: s.start,
          end: s.end,
          tangentStart: s.tangentStart || { x: 0, y: 0 },
          tangentEnd: s.tangentEnd || { x: 0, y: 0 },
        };
        return seg;
      }),
      regions: vn.regions || [],
    };
  }

  // Apply vectorPaths if provided (SVG path data strings)
  if (params.vectorPaths) {
    vector.vectorPaths = params.vectorPaths.map(function(p) {
      return {
        windingRule: p.windingRule || 'NONZERO',
        data: p.data,
      };
    });
  }

  // Apply fill
  if (params.fillColor) {
    applyFill(vector, params.fillColor);
  } else if (params.gradient) {
    applyGradientFill(vector, params.gradient);
  } else {
    // Default: no fill
    vector.fills = [];
  }

  // Apply stroke
  if (params.strokeColor) {
    var parsed = hexToFigmaColor(params.strokeColor);
    vector.strokes = [{ type: 'SOLID', color: parsed.color, opacity: parsed.opacity }];
    vector.strokeWeight = params.strokeWeight || 1;
    if (params.strokeCap) vector.strokeCap = params.strokeCap;
    if (params.strokeJoin) vector.strokeJoin = params.strokeJoin;
  }

  var parent = await resolveParent(params.parentId);
  parent.appendChild(vector);

  return {
    id: vector.id,
    name: vector.name,
    width: Math.round(vector.width),
    height: Math.round(vector.height),
  };
}

// ─── Boolean Operations ────────────────────────────────────────────────────

async function handleBooleanOperation(params) {
  var nodeIds = params.nodeIds;
  if (!nodeIds || nodeIds.length < 2) {
    throw new Error('Boolean operations require at least 2 node IDs');
  }

  var nodes = [];
  for (var i = 0; i < nodeIds.length; i++) {
    var node = await getNode(nodeIds[i]);
    nodes.push(node);
  }

  var operation = params.operation || 'UNION';
  var result;

  switch (operation) {
    case 'UNION':
      result = figma.union(nodes, nodes[0].parent || figma.currentPage);
      break;
    case 'SUBTRACT':
      result = figma.subtract(nodes, nodes[0].parent || figma.currentPage);
      break;
    case 'INTERSECT':
      result = figma.intersect(nodes, nodes[0].parent || figma.currentPage);
      break;
    case 'EXCLUDE':
      result = figma.exclude(nodes, nodes[0].parent || figma.currentPage);
      break;
    default:
      throw new Error('Unknown boolean operation: ' + operation);
  }

  if (params.name) result.name = params.name;

  return {
    id: result.id,
    name: result.name,
    type: result.type,
    width: Math.round(result.width),
    height: Math.round(result.height),
  };
}

// ─── Flatten Nodes ─────────────────────────────────────────────────────────

async function handleFlattenNodes(params) {
  var nodeIds = params.nodeIds;
  if (!nodeIds || nodeIds.length < 1) {
    throw new Error('Flatten requires at least 1 node ID');
  }

  var nodes = [];
  for (var i = 0; i < nodeIds.length; i++) {
    var node = await getNode(nodeIds[i]);
    nodes.push(node);
  }

  var result = figma.flatten(nodes, nodes[0].parent || figma.currentPage);
  if (params.name) result.name = params.name;

  return {
    id: result.id,
    name: result.name,
    type: result.type,
    width: Math.round(result.width),
    height: Math.round(result.height),
  };
}

// ─── Set Fill (advanced — supports gradients) ──────────────────────────────

async function handleSetFill(params) {
  var node = await getNode(params.nodeId);
  if (!('fills' in node)) throw new Error('Node cannot have fills');

  if (params.fills) {
    var figmaFills = params.fills.map(function(fill) {
      if (fill.type === 'SOLID') {
        var parsed = hexToFigmaColor(fill.color || '#000000');
        return {
          type: 'SOLID',
          color: parsed.color,
          opacity: parsed.opacity,
          visible: fill.visible !== undefined ? fill.visible : true,
        };
      }
      if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL' ||
          fill.type === 'GRADIENT_ANGULAR' || fill.type === 'GRADIENT_DIAMOND') {
        var stops = (fill.stops || []).map(function(s) {
          var p = hexToFigmaColor(s.color || '#000000');
          return {
            position: s.position !== undefined ? s.position : 0,
            color: { r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity },
          };
        });
        return {
          type: fill.type,
          gradientStops: stops,
          gradientTransform: fill.gradientTransform || [[1, 0, 0], [0, 1, 0]],
          visible: fill.visible !== undefined ? fill.visible : true,
        };
      }
      return null;
    }).filter(Boolean);

    node.fills = figmaFills;
  }

  return { id: node.id, name: node.name, fillCount: node.fills.length };
}

// ─── Image Fill (Placeholder + future URL support) ──────────────────────────

async function handleSetImageFill(params) {
  var node;

  if (params.nodeId) {
    node = await getNode(params.nodeId);
  } else {
    node = figma.createRectangle();
    node.x = params.x || 0;
    node.y = params.y || 0;
    node.resize(params.width || 300, params.height || 200);
    if (params.cornerRadius !== undefined) node.cornerRadius = params.cornerRadius;
    var parent = await resolveParent(params.parentId);
    parent.appendChild(node);
  }

  if (!('fills' in node)) throw new Error('Node cannot have fills');

  // Real image mode: imageBytes is an array of numbers (Uint8Array values)
  if (params.imageBytes) {
    var bytes;
    if (Array.isArray(params.imageBytes)) {
      bytes = new Uint8Array(params.imageBytes);
    } else {
      bytes = params.imageBytes;
    }
    var image = figma.createImage(bytes);
    node.fills = [{
      type: 'IMAGE',
      imageHash: image.hash,
      scaleMode: params.scaleMode || 'FILL',
    }];
    node.name = params.name || 'Image';
    return { id: node.id, name: node.name, width: Math.round(node.width), height: Math.round(node.height), isPlaceholder: false };
  }

  // Placeholder mode: styled gradient that signals "image goes here"
  node.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientStops: [
      { position: 0, color: { r: 0.91, g: 0.91, b: 0.93, a: 1 } },
      { position: 1, color: { r: 0.82, g: 0.82, b: 0.85, a: 1 } },
    ],
    gradientTransform: [[0.71, 0.71, 0], [-0.71, 0.71, 0.5]],
  }];
  node.name = params.placeholderText ? 'Image: ' + params.placeholderText : (params.name || 'Image Placeholder');

  return { id: node.id, name: node.name, width: Math.round(node.width), height: Math.round(node.height), isPlaceholder: true };
}

// ─── Text Range Styling ────────────────────────────────────────────────────

async function handleStyleTextRange(params) {
  var node = await getNode(params.nodeId);
  if (node.type !== 'TEXT') throw new Error('Node is not a text node');

  var ranges = params.ranges || [];

  for (var i = 0; i < ranges.length; i++) {
    var range = ranges[i];
    var start = range.start;
    var end = range.end;

    if (start < 0 || end > node.characters.length || start >= end) {
      throw new Error('Invalid range: ' + start + '-' + end + ' (text length: ' + node.characters.length + ')');
    }

    // Load current font for this range so we can modify properties
    try {
      var currentFont = node.getRangeFontName(start, start + 1);
      if (currentFont !== figma.mixed) {
        await figma.loadFontAsync(currentFont);
      } else {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      }
    } catch (e) {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    }

    // Font family / style
    if (range.fontFamily || range.fontStyle) {
      var family = range.fontFamily || 'Inter';
      var style = range.fontStyle || 'Regular';
      await figma.loadFontAsync({ family: family, style: style });
      node.setRangeFontName(start, end, { family: family, style: style });
    }

    // Font size
    if (range.fontSize !== undefined) {
      node.setRangeFontSize(start, end, range.fontSize);
    }

    // Fill color
    if (range.fillColor) {
      var parsed = hexToFigmaColor(range.fillColor);
      node.setRangeFills(start, end, [{ type: 'SOLID', color: parsed.color, opacity: parsed.opacity }]);
    }

    // Text decoration
    if (range.decoration) {
      node.setRangeTextDecoration(start, end, range.decoration);
    }

    // Letter spacing
    if (range.letterSpacing !== undefined) {
      node.setRangeLetterSpacing(start, end, { value: range.letterSpacing, unit: 'PIXELS' });
    }

    // Line height
    if (range.lineHeight !== undefined) {
      node.setRangeLineHeight(start, end, { value: range.lineHeight, unit: 'PIXELS' });
    }

    // Hyperlink
    if (range.hyperlink) {
      node.setRangeHyperlink(start, end, { type: 'URL', value: range.hyperlink });
    }
  }

  return {
    id: node.id,
    name: node.name,
    rangesApplied: ranges.length,
    textLength: node.characters.length,
  };
}

// ─── Constraints ───────────────────────────────────────────────────────────

async function handleSetConstraints(params) {
  var node = await getNode(params.nodeId);
  if (!('constraints' in node)) throw new Error('Node does not support constraints');

  node.constraints = {
    horizontal: params.horizontal || 'MIN',
    vertical: params.vertical || 'MIN',
  };

  return {
    id: node.id,
    name: node.name,
    constraints: node.constraints,
  };
}

// ─── Component Creation ────────────────────────────────────────────────────

async function handleCreateComponent(params) {
  var comp = figma.createComponent();
  comp.name = params.name || 'Component';
  comp.x = params.x || 0;
  comp.y = params.y || 0;
  comp.resize(params.width || 100, params.height || 100);

  if (params.fillColor) {
    applyFill(comp, params.fillColor);
  }

  if (params.cornerRadius !== undefined) {
    comp.cornerRadius = params.cornerRadius;
  }

  if (params.description) {
    comp.description = params.description;
  }

  var parent = await resolveParent(params.parentId);
  parent.appendChild(comp);

  return {
    id: comp.id,
    name: comp.name,
    type: comp.type,
    width: Math.round(comp.width),
    height: Math.round(comp.height),
  };
}

async function handleCreateComponentSet(params) {
  var nodeIds = params.componentIds || [];
  if (nodeIds.length < 2) throw new Error('Need at least 2 components to create a component set');

  var components = [];
  for (var i = 0; i < nodeIds.length; i++) {
    var node = await getNode(nodeIds[i]);
    if (node.type !== 'COMPONENT') throw new Error('Node ' + nodeIds[i] + ' is not a component');
    components.push(node);
  }

  var parentNode = components[0].parent || figma.currentPage;
  var result = figma.combineAsVariants(components, parentNode);
  if (params.name) result.name = params.name;

  return {
    id: result.id,
    name: result.name,
    type: result.type,
    variantCount: components.length,
    width: Math.round(result.width),
    height: Math.round(result.height),
  };
}

// ─── Variables / Tokens ────────────────────────────────────────────────────

async function handleCreateVariableCollection(params) {
  if (!figma.variables) throw new Error('Variables API not available in this Figma version');
  var collection = figma.variables.createVariableCollection(params.name || 'Collection');

  if (params.modes && Array.isArray(params.modes)) {
    var defaultModeId = collection.modes[0].modeId;
    if (params.modes[0]) {
      collection.renameMode(defaultModeId, params.modes[0]);
    }
    for (var mi = 1; mi < params.modes.length; mi++) {
      collection.addMode(params.modes[mi]);
    }
  }

  return {
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map(function(m) { return { modeId: m.modeId, name: m.name }; }),
  };
}

async function handleCreateVariable(params) {
  if (!figma.variables) throw new Error('Variables API not available in this Figma version');
  var resolvedType = params.type || 'FLOAT';
  var variable = figma.variables.createVariable(
    params.name || 'Variable',
    params.collectionId,
    resolvedType
  );

  // Set values per mode if provided: { modeId: value, ... }
  if (params.values && typeof params.values === 'object') {
    var modeIds = Object.keys(params.values);
    for (var vi = 0; vi < modeIds.length; vi++) {
      var modeId = modeIds[vi];
      var value = params.values[modeId];
      if (resolvedType === 'COLOR' && typeof value === 'string') {
        var parsed = hexToFigmaColor(value);
        value = { r: parsed.color.r, g: parsed.color.g, b: parsed.color.b, a: parsed.opacity };
      }
      variable.setValueForMode(modeId, value);
    }
  }

  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
  };
}

async function handleBindVariable(params) {
  if (!figma.variables) throw new Error('Variables API not available in this Figma version');
  var node = await getNode(params.nodeId);
  var variable = figma.variables.getVariableById(params.variableId);
  if (!variable) throw new Error('Variable not found: ' + params.variableId);

  node.setBoundVariable(params.field, variable);

  return {
    id: node.id,
    name: node.name,
    field: params.field,
    variableId: variable.id,
    variableName: variable.name,
  };
}

async function handleGetVariables(params) {
  if (!figma.variables) throw new Error('Variables API not available in this Figma version');

  var collections = figma.variables.getLocalVariableCollections();
  var typeFilter = params.type || undefined;
  var variables = figma.variables.getLocalVariables(typeFilter);

  return {
    collections: collections.map(function(c) {
      return {
        id: c.id,
        name: c.name,
        modes: c.modes.map(function(m) { return { modeId: m.modeId, name: m.name }; }),
        variableCount: c.variableIds.length,
      };
    }),
    variables: variables.slice(0, params.limit || 200).map(function(v) {
      return {
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        collectionId: v.variableCollectionId,
      };
    }),
  };
}

// ─── Font Discovery ───────────────────────────────────────────────────────

async function handleListAvailableFonts(params) {
  var fonts = await figma.listAvailableFontsAsync();
  var query = (params.query || '').toLowerCase();

  // Group by family
  var familyMap = {};
  for (var fi = 0; fi < fonts.length; fi++) {
    var font = fonts[fi];
    var family = font.fontName.family;
    var style = font.fontName.style;

    if (query && !family.toLowerCase().includes(query)) continue;

    if (!familyMap[family]) {
      familyMap[family] = [];
    }
    familyMap[family].push(style);
  }

  // Get fonts used in local text styles — these are the "project fonts" / DS fonts
  var projectFonts = [];
  try {
    var textStyles = await figma.getLocalTextStylesAsync();
    var seen = {};
    for (var si = 0; si < textStyles.length; si++) {
      var ts = textStyles[si];
      var key = ts.fontName.family + '|' + ts.fontName.style;
      if (!seen[key]) {
        seen[key] = true;
        projectFonts.push({
          family: ts.fontName.family,
          style: ts.fontName.style,
          styleName: ts.name,
          fontSize: ts.fontSize,
        });
      }
    }
  } catch (e) { /* ignore */ }

  var allFamilies = Object.keys(familyMap);
  var limit = params.limit || 50;
  var families = allFamilies.sort().slice(0, limit);

  var result = families.map(function(f) {
    return { family: f, styles: familyMap[f] };
  });

  return {
    count: result.length,
    totalFamilies: allFamilies.length,
    fonts: result,
    projectFonts: projectFonts,
  };
}

// ─── SVG Export ─────────────────────────────────────────────────────────────

function uint8ToUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Manual UTF-8 decode fallback
  var str = '';
  for (var i = 0; i < bytes.length; ) {
    var b = bytes[i];
    if (b < 0x80) { str += String.fromCharCode(b); i++; }
    else if (b < 0xE0) { str += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i+1] & 0x3F)); i += 2; }
    else if (b < 0xF0) { str += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i+1] & 0x3F) << 6) | (bytes[i+2] & 0x3F)); i += 3; }
    else { i += 4; str += '\uFFFD'; }
  }
  return str;
}

async function handleExportAsSvg(params) {
  var node = await getNode(params.nodeId);

  if (params.exportChildren) {
    if (!('children' in node) || !node.children || node.children.length === 0) {
      throw new Error('Node has no children to export');
    }

    var results = [];
    var limit = Math.min(node.children.length, 200);

    for (var i = 0; i < limit; i++) {
      var child = node.children[i];
      try {
        var svgBytes = await child.exportAsync({ format: 'SVG' });
        var svgString = uint8ToUtf8(svgBytes);
        results.push({
          id: child.id,
          name: child.name,
          type: child.type,
          svg: svgString,
        });
      } catch (e) {
        results.push({
          id: child.id,
          name: child.name,
          error: e.message || 'Export failed',
        });
      }
    }

    return {
      parentId: node.id,
      parentName: node.name,
      count: results.length,
      total: node.children.length,
      icons: results,
    };
  }

  // Single node export
  var svgBytes = await node.exportAsync({ format: 'SVG' });
  var svgString = uint8ToUtf8(svgBytes);

  return {
    id: node.id,
    name: node.name,
    svg: svgString,
  };
}

// ─── Search & Edit ──────────────────────────────────────────────────────────

async function handleFindNodes(params) {
  var query = (params.query || '').toLowerCase();
  var typeFilter = params.type; // e.g. 'TEXT', 'FRAME', 'RECTANGLE', etc.

  var searchRoot = figma.currentPage;
  if (params.rootNodeId) {
    searchRoot = await getNode(params.rootNodeId);
  }

  if (!('findAll' in searchRoot)) throw new Error('Search root cannot be searched');

  var results = searchRoot.findAll(function(node) {
    var nameMatch = !query || node.name.toLowerCase().includes(query);
    var typeMatch = !typeFilter || node.type === typeFilter;
    return nameMatch && typeMatch;
  });

  // For text nodes, also allow searching by text content
  if (query && !typeFilter) {
    var textMatches = searchRoot.findAll(function(node) {
      return node.type === 'TEXT' && node.characters && node.characters.toLowerCase().includes(query);
    });
    // Merge without duplicates
    var seenIds = {};
    results.forEach(function(n) { seenIds[n.id] = true; });
    textMatches.forEach(function(n) {
      if (!seenIds[n.id]) { results.push(n); seenIds[n.id] = true; }
    });
  }

  var limit = params.limit || 50;
  var serialized = results.slice(0, limit).map(function(node) {
    return serializeNode(node, 0, 1);
  });

  return {
    count: serialized.length,
    total: results.length,
    nodes: serialized,
  };
}

async function handleSetSelection(params) {
  var nodeIds = params.nodeIds || [];
  var nodes = await Promise.all(nodeIds.map(function(id) { return getNode(id); }));
  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
  return { selectedCount: nodes.length };
}

// ─── Message Router ─────────────────────────────────────────────────────────

const commandHandlers = {
  // Create
  create_frame: handleCreateFrame,
  create_rectangle: handleCreateRectangle,
  create_ellipse: handleCreateEllipse,
  create_text: handleCreateText,
  create_line: handleCreateLine,
  create_svg_node: handleCreateSvgNode,
  // Layout & style
  set_auto_layout: handleSetAutoLayout,
  modify_node: handleModifyNode,
  set_stroke: handleSetStroke,
  set_effects: handleSetEffects,
  // Structure
  delete_node: handleDeleteNode,
  move_to_parent: handleMoveToParent,
  // Read
  get_selection: handleGetSelection,
  get_page_structure: handleGetPageStructure,
  read_node_properties: handleReadNodeProperties,
  // Design system
  list_components: handleListComponents,
  create_component_instance: handleCreateComponentInstance,
  detach_instance: handleDetachInstance,
  get_local_styles: handleGetLocalStyles,
  // Team library
  import_component_by_key: handleImportComponentByKey,
  import_style_by_key: handleImportStyleByKey,
  // Search & edit
  find_nodes: handleFindNodes,
  set_selection: handleSetSelection,
  // Vector drawing & boolean ops
  create_vector: handleCreateVector,
  boolean_operation: handleBooleanOperation,
  flatten_nodes: handleFlattenNodes,
  set_fill: handleSetFill,
  // Image, text styling, constraints
  set_image_fill: handleSetImageFill,
  style_text_range: handleStyleTextRange,
  set_constraints: handleSetConstraints,
  // Component creation
  create_component: handleCreateComponent,
  create_component_set: handleCreateComponentSet,
  // Variables / tokens
  create_variable_collection: handleCreateVariableCollection,
  create_variable: handleCreateVariable,
  bind_variable: handleBindVariable,
  get_variables: handleGetVariables,
  // Font discovery
  list_available_fonts: handleListAvailableFonts,
  // SVG export
  export_as_svg: handleExportAsSvg,
  // Agent cursors (peer design)
  spawn_agent: handleSpawnAgent,
  dismiss_agent: handleDismissAgent,
  dismiss_all_agents: handleDismissAllAgents,
};

figma.ui.onmessage = async (msg) => {
  // Handle settings persistence
  if (msg.type === 'save_settings') {
    await figma.clientStorage.setAsync('figsor_settings', msg.settings);
    return;
  }
  if (msg.type === 'load_settings') {
    var settings = await figma.clientStorage.getAsync('figsor_settings');
    figma.ui.postMessage({ type: 'settings_loaded', settings: settings || {} });
    return;
  }

  // ─── Cleanup agent cursors (toggle OFF or stale from previous sessions) ──
  if (msg.type === 'cleanup_agent_cursors') {
    var agentNodes = figma.currentPage.findAll(function(n) {
      return n.name && n.name.startsWith('Agent: ');
    });
    for (var ci = 0; ci < agentNodes.length; ci++) {
      try { agentNodes[ci].remove(); } catch (e) {}
    }
    agentCursors = {};
    figma.ui.postMessage({ type: 'agents_all_dismissed' });
    return;
  }

  const { id, command, params } = msg;

  if (!id || !command) return;

  const handler = commandHandlers[command];
  if (!handler) {
    figma.ui.postMessage({ id: id, type: 'error', error: 'Unknown command: ' + command });
    return;
  }

  try {
    // ── Agent cursor movement (peer design) ──
    var cmdParams = params || {};
    if (cmdParams.agentId && agentCursors[cmdParams.agentId]) {
      var _creationCmds = {create_frame:1, create_rectangle:1, create_ellipse:1, create_text:1,
                           create_line:1, create_svg_node:1, create_vector:1, create_component:1,
                           create_component_instance:1, import_component_by_key:1, set_image_fill:1};
      var _modifyCmds = {modify_node:1, set_auto_layout:1, set_stroke:1, set_effects:1,
                         set_fill:1, set_constraints:1, style_text_range:1, move_to_parent:1};

      if (_creationCmds[command]) {
        // For creation: compute absolute target from params
        var _tx = cmdParams.x || 0;
        var _ty = cmdParams.y || 0;
        if (cmdParams.parentId) {
          try {
            var _pn = await figma.getNodeByIdAsync(cmdParams.parentId);
            if (_pn) {
              var _ap = getAbsolutePosition(_pn);
              _tx += _ap.x;
              _ty += _ap.y;
            }
          } catch (_e) {}
        }
        await moveAgentCursorTo(cmdParams.agentId, _tx, _ty);
      } else if (_modifyCmds[command] && cmdParams.nodeId) {
        // For modifications: move cursor to the target node
        try {
          var _tn = await figma.getNodeByIdAsync(cmdParams.nodeId);
          if (_tn) {
            var _np = getAbsolutePosition(_tn);
            await moveAgentCursorTo(cmdParams.agentId, _np.x, _np.y);
          }
        } catch (_e) {}
      }
    }

    const result = await handler(cmdParams);

    // ── Always keep ALL agent cursors on top of z-order ──
    var _allAgentIds = Object.keys(agentCursors);
    for (var _ai = 0; _ai < _allAgentIds.length; _ai++) {
      try {
        var _cn = await figma.getNodeByIdAsync(agentCursors[_allAgentIds[_ai]].nodeId);
        if (_cn && _cn.parent && _cn.parent.type === 'PAGE') {
          figma.currentPage.appendChild(_cn);
        }
      } catch (_e) {}
    }

    figma.ui.postMessage({ id: id, type: 'response', result: result });
  } catch (err) {
    figma.ui.postMessage({ id: id, type: 'error', error: err.message || String(err) });
  }
};
