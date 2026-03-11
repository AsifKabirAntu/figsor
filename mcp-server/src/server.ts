#!/usr/bin/env node
/**
 * Figsor — Figma ↔ Cursor MCP Server
 *
 * This server does two things:
 * 1. Runs an MCP server (over stdio) so Cursor can call design tools
 * 2. Runs a WebSocket server so the Figma plugin can connect and receive commands
 *
 * Flow: Cursor → MCP tool call → WebSocket → Figsor Figma Plugin → design created
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { randomUUID, createHmac, randomBytes } from "crypto";
import {
  SKILL_MD, TYPOGRAPHY_MD, COLOR_MD, MOTION_MD,
  ICONS_MD, CRAFT_DETAILS_MD, ANTI_AI_SLOP_MD, EXAMPLE_WORKFLOW_MD,
  DESIGN_GUIDES,
} from "./design-knowledge/index.js";

// ─── Logging (stderr only — stdout is reserved for MCP protocol) ────────────

const log = (...args: unknown[]) =>
  console.error(`[figsor ${new Date().toISOString()}]`, ...args);

// ─── Configuration ──────────────────────────────────────────────────────────

const WS_PORT = Number(process.env.FIGSOR_PORT) || 3055;
const COMMAND_TIMEOUT_MS = 30_000;
const FIGMA_API_BASE = "https://api.figma.com/v1";

// ─── Handshake Secret (obfuscated) ──────────────────────────────────────────
// This key is split and reassembled at runtime to deter casual inspection.
const _a = "fgsr"; const _b = "7x9K"; const _c = "mQ3p"; const _d = "Wv2R";
const _e = "nL8j"; const _f = "Ht5Y"; const _g = "cD4s"; const _h = "bA6e";
const HANDSHAKE_KEY = [_a, _b, _c, _d, _e, _f, _g, _h].join("");

// ─── WebSocket Bridge ───────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

class FigsorBridge {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private wss: WebSocketServer;
  private authenticated = false;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    log(`WebSocket server listening on port ${port}`);

    this.wss.on("connection", (ws) => {
      log("New WebSocket connection — starting handshake...");

      // Generate a random nonce for this connection
      const nonce = randomBytes(32).toString("hex");
      let handshakeComplete = false;

      // Send nonce challenge
      ws.send(JSON.stringify({ type: "handshake_challenge", nonce }));

      // Set a handshake timeout — must authenticate within 5s
      const handshakeTimeout = setTimeout(() => {
        if (!handshakeComplete) {
          log("Handshake timeout — closing connection");
          ws.close(4001, "Handshake timeout");
        }
      }, 5000);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // ── Handshake verification ──
          if (!handshakeComplete) {
            if (msg.type === "handshake_response" && msg.hash) {
              const expected = createHmac("sha256", HANDSHAKE_KEY)
                .update(nonce)
                .digest("hex");
              if (msg.hash === expected) {
                handshakeComplete = true;
                this.authenticated = true;
                clearTimeout(handshakeTimeout);

                // Close any previous connection
                if (this.ws && this.ws !== ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
                }
                this.ws = ws;

                ws.send(JSON.stringify({ type: "handshake_ok" }));
                log("Figma plugin authenticated ✓");
              } else {
                log("Handshake failed — invalid hash");
                ws.close(4003, "Invalid handshake");
              }
            } else {
              // Not a handshake message before auth — reject
              ws.send(JSON.stringify({ type: "error", error: "Handshake required" }));
            }
            return;
          }

          // ── Authenticated messages ──

          // Handle peer design settings from plugin UI
          if (msg.type === "settings_update") {
            if (msg.peerDesign !== undefined) {
              peerDesignSettings = {
                enabled: !!msg.peerDesign,
                agentCount: msg.agentCount || peerDesignSettings.agentCount,
              };
              log(`Peer design: ${peerDesignSettings.enabled ? "ON" : "OFF"}, ${peerDesignSettings.agentCount} agents`);
            }
            return;
          }

          // Handle image upload/removal notifications from plugin UI
          if (msg.type === "image_uploaded") {
            uploadedImageInfo = {
              name: msg.name || "uploaded-image",
              size: msg.size || 0,
              mimeType: msg.mimeType || "image/png",
              available: true,
            };
            log(`Image uploaded in plugin: ${uploadedImageInfo.name} (${uploadedImageInfo.size} bytes)`);
            return;
          }
          if (msg.type === "image_removed") {
            uploadedImageInfo = { name: null, size: 0, mimeType: null, available: false };
            log("Image removed from plugin");
            return;
          }

          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(msg.id);
            if (msg.type === "error") {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.result);
            }
          }
        } catch (e) {
          log("Error parsing WebSocket message:", e);
        }
      });

      ws.on("close", () => {
        clearTimeout(handshakeTimeout);
        if (this.ws === ws) {
          log("Figma plugin disconnected");
          this.ws = null;
          this.authenticated = false;
          // Reject all pending requests
          for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error("Figma plugin disconnected"));
          }
          this.pendingRequests.clear();
        }
      });

      ws.on("error", (err) => {
        log("WebSocket error:", err.message);
      });
    });
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async sendCommand(command: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected) {
      throw new Error(
        "Figma plugin is not connected. Please open Figma and run the Figsor plugin first."
      );
    }

    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command '${command}' timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify({ id, command, params }));
    });
  }
}

// ─── Create instances ───────────────────────────────────────────────────────

const bridge = new FigsorBridge(WS_PORT);

// ─── Peer Design State ──────────────────────────────────────────────────────

let peerDesignSettings = { enabled: false, agentCount: 3 };
let uploadedImageInfo: { name: string | null; size: number; mimeType: string | null; available: boolean } = {
  name: null, size: 0, mimeType: null, available: false,
};

const server = new McpServer(
  {
    name: "figsor",
    version: "1.0.0",
  },
  {
    instructions: `You are a professional UI/UX designer working through Figsor — a Figma design tool.

BEFORE creating any design, you MUST:
1. Call get_design_craft_guide("skill") to load the Research-First design methodology
2. For specific craft areas, also call get_design_craft_guide with "typography", "color", "anti-ai-slop", etc.

CRITICAL RULES (always follow):
• NEVER use indigo/violet (#6366f1, #8b5cf6) as accent color unless the user explicitly asks for purple. This is the #1 sign of AI-generated design.
• ALWAYS use frames + auto-layout for every container. Use padding/spacing, never hardcoded x/y positions.
• ALWAYS set letter-spacing on ALL CAPS text (3-5px) and tighten large headings 32px+ (-0.3 to -0.5px).
• NEVER use pure #000000 for text — use #0B0B0B or #111111.
• Omit fillColor on layout-only container frames (they should be transparent).
• Follow a 4px or 8px spacing grid.
• Max 2 font families. Max 6-8 font sizes. Max 3-4 text color levels.
• Color palette: 70-90% neutrals, 5-10% primary accent, semantic colors for status only.

When the user asks you to design something, follow this process:
1. Read the design craft guide
2. Ask discovery questions if the request is vague
3. Build with auto-layout, proper typography, and intentional color choices
4. Validate against the quality checklist in the guide`,
  }
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function err(error: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${error}` }],
    isError: true,
  };
}

async function run(command: string, params: Record<string, unknown>) {
  try {
    const result = await bridge.sendCommand(command, params);
    return ok(result);
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// ─── MCP Tools ──────────────────────────────────────────────────────────────

// 1. Connection status
server.tool(
  "get_connection_status",
  `Check if the Figma plugin is connected and whether Peer Design mode is enabled. When peerDesign is enabled, you MUST spawn design agents (Nic, Deniz, Jaffa) before creating elements, and use agentId on every creation/modification tool call. Interleave work across agents for a collaborative feel.

PEER DESIGN RULES (when peerDesign is enabled):
1. BE CONSISTENT: Pick a cohesive style — colors, spacing, radii, font sizes — and apply it everywhere.
2. USE AUTO-LAYOUT: Every container must use set_auto_layout with proper padding and spacing.
3. TRULY SIMULTANEOUS: Call ALL THREE agents in the SAME tool call batch. Every response should contain 3+ tool calls at once — one per agent working on different elements at the same time. Never do one agent's work, wait, then the next. Batch them.
4. COMPLETE EACH PIECE: Each element gets frame + auto-layout + stroke + content in one burst before moving on.`,
  {},
  async () => ok({ connected: bridge.isConnected, peerDesign: peerDesignSettings })
);

// ─── Peer Design: Agent Cursors ─────────────────────────────────────────────

server.tool(
  "spawn_design_agent",
  `Spawn a visual AI designer agent on the Figma canvas. The agent appears as a Figma-native colored cursor with a name label — exactly like a real collaborator. Use this when Peer Design mode is enabled (check get_connection_status). Default agents: Nic (#3B82F6 blue), Deniz (#10B981 green), Jaffa (#F97316 orange).

ORDER: First create the main root frame for the design. THEN spawn agents on top of it. This way agents appear on an already-set-up canvas, which looks natural.

After spawning, pass agentId on every creation and modification call so each agent's cursor animates to their work.

WORKFLOW: Agents are collaborative — they can work on the same section or split across different sections. E.g. all 3 build one stat card each simultaneously, or one builds frames while another fills content. Mix it up naturally. Interleave 2-5 ops per agent before switching.`,
  {
    agentId: z.string().describe("Unique ID for this agent, e.g. 'nic', 'deniz', 'jaffa'"),
    name: z.string().describe("Display name on the cursor label, e.g. 'Nic', 'Deniz', 'Jaffa'"),
    color: z.string().describe("Agent's color as hex — used for cursor arrow and label. e.g. '#3B82F6' (blue), '#10B981' (green), '#F97316' (orange)"),
    x: z.number().optional().describe("Initial X position on canvas (default: 0)"),
    y: z.number().optional().describe("Initial Y position on canvas (default: 0)"),
  },
  async (params) => run("spawn_agent", params)
);

server.tool(
  "dismiss_design_agent",
  "Remove a design agent's cursor from the canvas. Call this when the agent has finished designing.",
  {
    agentId: z.string().describe("ID of the agent to dismiss, e.g. 'nic'"),
  },
  async (params) => run("dismiss_agent", params)
);

server.tool(
  "dismiss_all_agents",
  "Remove ALL design agent cursors from the canvas. Call this when the entire design task is complete.",
  {},
  async () => run("dismiss_all_agents", {})
);

// 2. Create Frame
server.tool(
  "create_frame",
  `Create a new frame in Figma. Frames are the primary container/layout element (like a div in HTML). Use them for screens, sections, cards, navigation bars, buttons, etc. Returns the new frame's node ID for use in subsequent operations.

BEST PRACTICE: Always follow up with set_auto_layout on container frames. Use padding/spacing instead of hardcoded x/y. Omit fillColor on layout-only frames (they should be transparent). Only set fillColor on frames that genuinely need a background (cards, screens, buttons).`,
  {
    name: z.string().optional().describe("Name of the frame (e.g. 'Login Screen', 'Nav Bar')"),
    x: z.number().optional().describe("X position in pixels (default: 0)"),
    y: z.number().optional().describe("Y position in pixels (default: 0)"),
    width: z.number().optional().describe("Width in pixels (default: 100)"),
    height: z.number().optional().describe("Height in pixels (default: 100)"),
    fillColor: z
      .string()
      .optional()
      .describe("Fill color as hex string e.g. '#FFFFFF', '#1A1A2E', '#FF000080' (with alpha)"),
    cornerRadius: z.number().optional().describe("Corner radius in pixels"),
    parentId: z
      .string()
      .optional()
      .describe("ID of a parent frame to nest this inside. Omit to place on the canvas root."),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_frame", params)
);

// 3. Create Rectangle
server.tool(
  "create_rectangle",
  "Create a rectangle shape. Useful for backgrounds, dividers, decorative elements, image placeholders, etc.",
  {
    name: z.string().optional().describe("Name of the rectangle"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Width in pixels (default: 100)"),
    height: z.number().optional().describe("Height in pixels (default: 100)"),
    fillColor: z.string().optional().describe("Fill color as hex e.g. '#E2E8F0'"),
    cornerRadius: z.number().optional().describe("Corner radius"),
    parentId: z.string().optional().describe("Parent frame ID to place inside"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_rectangle", params)
);

// 4. Create Ellipse
server.tool(
  "create_ellipse",
  "Create an ellipse (circle or oval). Useful for avatars, status indicators, decorative elements. Set equal width/height for a perfect circle.",
  {
    name: z.string().optional().describe("Name of the ellipse"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Width in pixels (default: 100)"),
    height: z.number().optional().describe("Height in pixels (default: 100)"),
    fillColor: z.string().optional().describe("Fill color as hex"),
    parentId: z.string().optional().describe("Parent frame ID"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_ellipse", params)
);

// 5. Create Text
server.tool(
  "create_text",
  `Create a text element. Supports font family, size, weight (via fontStyle), color, and text wrapping.

TYPOGRAPHY RULES: Set letterSpacing on ALL CAPS text (3-5px for 12-14px font), small text 11-13px (0.2-0.5px), and tighten large headings 32px+ (-0.3 to -0.5px). Use lineHeight: body 1.5-1.7× fontSize, headlines 1.0-1.2×. Never use pure #000000 — use #0B0B0B or #111111 instead.`,
  {
    text: z.string().describe("The text content to display"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    fontSize: z.number().optional().describe("Font size in pixels (default: 14)"),
    fontFamily: z
      .string()
      .optional()
      .describe("Font family name (default: 'Inter'). Must be available in the Figma file."),
    fontStyle: z
      .string()
      .optional()
      .describe(
        "Font style e.g. 'Regular', 'Bold', 'Semi Bold', 'Medium', 'Light' (default: 'Regular')"
      ),
    fillColor: z.string().optional().describe("Text color as hex e.g. '#1A1A2E'"),
    width: z
      .number()
      .optional()
      .describe("Fixed width for text wrapping. Omit for auto-width."),
    letterSpacing: z.number().optional().describe("Letter spacing in pixels"),
    lineHeight: z.number().optional().describe("Line height in pixels"),
    textAlignHorizontal: z
      .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
      .optional()
      .describe("Horizontal text alignment"),
    parentId: z.string().optional().describe("Parent frame ID"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_text", params)
);

// 6. Create Line
server.tool(
  "create_line",
  "Create a line element. Useful for dividers, separators, and decorative lines.",
  {
    name: z.string().optional().describe("Name of the line"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    length: z.number().optional().describe("Length of the line in pixels (default: 100)"),
    color: z.string().optional().describe("Line color as hex (default: '#000000')"),
    strokeWeight: z.number().optional().describe("Line thickness in pixels (default: 1)"),
    rotation: z.number().optional().describe("Rotation in degrees (0 = horizontal, 90 = vertical)"),
    parentId: z.string().optional().describe("Parent frame ID"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_line", params)
);

// 7. Create SVG Node
server.tool(
  "create_svg_node",
  "Create a node from an SVG string. Great for icons, logos, and vector illustrations.",
  {
    svg: z.string().describe("Valid SVG markup string"),
    name: z.string().optional().describe("Name for the created node"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Scale to this width"),
    height: z.number().optional().describe("Scale to this height"),
    parentId: z.string().optional().describe("Parent frame ID"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_svg_node", params)
);

// 8. Set Auto Layout
server.tool(
  "set_auto_layout",
  `Configure auto-layout on a frame (Figma's equivalent of CSS Flexbox). This controls how children are arranged and spaced within the frame. Set direction, spacing, padding, and alignment.`,
  {
    nodeId: z.string().describe("ID of the frame to configure"),
    direction: z
      .enum(["HORIZONTAL", "VERTICAL"])
      .optional()
      .describe("Layout direction — HORIZONTAL (row) or VERTICAL (column). Default: VERTICAL"),
    spacing: z.number().optional().describe("Gap between child items in pixels"),
    padding: z
      .number()
      .optional()
      .describe("Uniform padding on all sides (shorthand). Overrides individual paddings."),
    paddingTop: z.number().optional().describe("Top padding"),
    paddingRight: z.number().optional().describe("Right padding"),
    paddingBottom: z.number().optional().describe("Bottom padding"),
    paddingLeft: z.number().optional().describe("Left padding"),
    primaryAxisAlignItems: z
      .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
      .optional()
      .describe("Alignment along the main axis (like justify-content)"),
    counterAxisAlignItems: z
      .enum(["MIN", "CENTER", "MAX"])
      .optional()
      .describe("Alignment along the cross axis (like align-items)"),
    primaryAxisSizingMode: z
      .enum(["FIXED", "AUTO"])
      .optional()
      .describe("FIXED = fixed size along main axis, AUTO = hug contents"),
    counterAxisSizingMode: z
      .enum(["FIXED", "AUTO"])
      .optional()
      .describe("FIXED = fixed size along cross axis, AUTO = hug contents"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("set_auto_layout", params)
);

// 9. Modify Node
server.tool(
  "modify_node",
  `Modify properties of an existing node. Works on any node type. For text nodes, you can also update characters and fontSize. For auto-layout children, you can set layoutSizingHorizontal/layoutSizingVertical to control how they fill space.`,
  {
    nodeId: z.string().describe("ID of the node to modify"),
    x: z.number().optional().describe("New X position"),
    y: z.number().optional().describe("New Y position"),
    width: z.number().optional().describe("New width"),
    height: z.number().optional().describe("New height"),
    name: z.string().optional().describe("New name"),
    fillColor: z.string().optional().describe("New fill color as hex"),
    opacity: z.number().optional().describe("Opacity 0-1"),
    cornerRadius: z.number().optional().describe("Corner radius"),
    visible: z.boolean().optional().describe("Visibility"),
    rotation: z.number().optional().describe("Rotation in degrees"),
    // Text-specific
    characters: z.string().optional().describe("(Text nodes) New text content"),
    fontSize: z.number().optional().describe("(Text nodes) New font size"),
    textAlignHorizontal: z
      .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
      .optional()
      .describe("(Text nodes) Horizontal alignment"),
    // Auto-layout child properties
    layoutSizingHorizontal: z
      .enum(["FIXED", "HUG", "FILL"])
      .optional()
      .describe("How this node sizes horizontally in auto-layout parent"),
    layoutSizingVertical: z
      .enum(["FIXED", "HUG", "FILL"])
      .optional()
      .describe("How this node sizes vertically in auto-layout parent"),
    layoutAlign: z
      .enum(["INHERIT", "STRETCH", "MIN", "CENTER", "MAX"])
      .optional()
      .describe("Cross-axis alignment override within auto-layout parent"),
    layoutGrow: z
      .number()
      .optional()
      .describe("Flex grow factor (0 = fixed, 1 = fill remaining space)"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("modify_node", params)
);

// 10. Set Stroke
server.tool(
  "set_stroke",
  "Add or modify the stroke (border) on a node.",
  {
    nodeId: z.string().describe("ID of the node"),
    color: z.string().optional().describe("Stroke color as hex (default: '#000000')"),
    weight: z.number().optional().describe("Stroke weight in pixels (default: 1)"),
    strokeAlign: z
      .enum(["INSIDE", "OUTSIDE", "CENTER"])
      .optional()
      .describe("Stroke alignment (default: INSIDE)"),
    dashPattern: z
      .array(z.number())
      .optional()
      .describe("Dash pattern e.g. [4, 4] for dashed line"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("set_stroke", params)
);

// 11. Set Effects
server.tool(
  "set_effects",
  "Apply visual effects (drop shadow, inner shadow, layer blur, background blur) to a node. Replaces existing effects.",
  {
    nodeId: z.string().describe("ID of the node"),
    effects: z
      .array(
        z.object({
          type: z
            .enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"])
            .describe("Effect type"),
          color: z
            .string()
            .optional()
            .describe("Shadow color as hex with alpha e.g. '#00000040' (shadows only)"),
          offsetX: z.number().optional().describe("Horizontal shadow offset (shadows only)"),
          offsetY: z.number().optional().describe("Vertical shadow offset (shadows only)"),
          radius: z.number().optional().describe("Blur radius in pixels"),
          spread: z.number().optional().describe("Shadow spread (shadows only)"),
        })
      )
      .describe("Array of effects to apply"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("set_effects", params)
);

// 12. Delete Node
server.tool(
  "delete_node",
  "Delete a node from the Figma document.",
  {
    nodeId: z.string().describe("ID of the node to delete"),
  },
  async (params) => run("delete_node", params)
);

// 13. Get Selection
server.tool(
  "get_selection",
  "Get information about the currently selected nodes in Figma. Useful for understanding what the user is looking at or wants to modify.",
  {},
  async () => run("get_selection", {})
);

// 14. Get Page Structure
server.tool(
  "get_page_structure",
  "Get the hierarchical structure of all nodes on the current Figma page. Returns node IDs, names, types, positions, sizes, and children. Use this to understand the current state of the design.",
  {
    maxDepth: z
      .number()
      .optional()
      .describe("Maximum depth of the tree to return (default: 4)"),
  },
  async (params) => run("get_page_structure", params)
);

// 15. Move to Parent
server.tool(
  "move_to_parent",
  "Move a node into a different parent frame. Use this to restructure the layer hierarchy.",
  {
    nodeId: z.string().describe("ID of the node to move"),
    parentId: z.string().describe("ID of the new parent frame"),
    index: z
      .number()
      .optional()
      .describe("Position index within the parent's children (omit to append at end)"),
  },
  async (params) => run("move_to_parent", params)
);

// 16. Read Node Properties
server.tool(
  "read_node_properties",
  "Get detailed properties of a specific node by ID, including its children. Use this to inspect a node before modifying it.",
  {
    nodeId: z.string().describe("ID of the node to inspect"),
    depth: z
      .number()
      .optional()
      .describe("How deep to traverse children (default: 2)"),
  },
  async (params) => run("read_node_properties", params)
);

// ─── SVG Export & Animation ─────────────────────────────────────────────────

// Export as SVG
server.tool(
  "export_as_svg",
  `Export a Figma node as SVG markup string. Can export a single node or all direct children of a frame (batch mode). Use this to extract icon SVGs before applying animations, or to get raw SVG data for any visual element.`,
  {
    nodeId: z.string().describe("ID of the node to export as SVG"),
    exportChildren: z
      .boolean()
      .optional()
      .describe(
        "If true, exports all direct children of the node as individual SVGs instead of the node itself. Perfect for exporting a frame full of icons in one call."
      ),
  },
  async (params) => run("export_as_svg", params)
);

// Show Animation Preview
server.tool(
  "show_animation_preview",
  `Show animated SVG icons in a preview modal inside the Figma plugin. The modal displays all icons with their CSS animations playing live. Users can click individual icons to download, or use "Download Pack" to get a ZIP of all animated SVGs. Call this AFTER you've generated animated SVGs (with CSS @keyframes embedded in the SVG markup).`,
  {
    icons: z
      .array(
        z.object({
          name: z.string().describe("Display name of the icon (used as filename on download)"),
          svg: z
            .string()
            .describe(
              "Complete animated SVG markup with CSS @keyframes and animation properties embedded in a <style> block inside the SVG"
            ),
        })
      )
      .describe("Array of animated SVG icons to preview and make downloadable"),
  },
  async (params) => run("show_animation_preview", params)
);

// ─── Vector Drawing & Boolean Operations ────────────────────────────────────

// Create Vector (Pen Tool)
server.tool(
  "create_vector",
  `Create a vector node with custom paths — this is the pen tool. You can draw ANY shape by defining vertices and bezier curves via vectorNetwork, or by providing SVG path data strings via vectorPaths. This is the most powerful drawing tool — use it for complex custom shapes, organic forms, character illustrations, logos, and anything that can't be made with basic shapes. Supports fills (solid or gradient) and strokes.`,
  {
    name: z.string().optional().describe("Name of the vector"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Width to resize to"),
    height: z.number().optional().describe("Height to resize to"),
    vectorNetwork: z
      .object({
        vertices: z
          .array(
            z.object({
              x: z.number().describe("X coordinate of vertex"),
              y: z.number().describe("Y coordinate of vertex"),
              strokeCap: z.enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"]).optional(),
              strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional(),
              cornerRadius: z.number().optional(),
              handleMirroring: z.enum(["NONE", "ANGLE", "ANGLE_AND_LENGTH"]).optional(),
            })
          )
          .describe("Array of vertices (points) in the vector"),
        segments: z
          .array(
            z.object({
              start: z.number().describe("Index of start vertex"),
              end: z.number().describe("Index of end vertex"),
              tangentStart: z
                .object({ x: z.number(), y: z.number() })
                .optional()
                .describe("Bezier control point relative to start vertex. {x:0,y:0} = straight line"),
              tangentEnd: z
                .object({ x: z.number(), y: z.number() })
                .optional()
                .describe("Bezier control point relative to end vertex. {x:0,y:0} = straight line"),
            })
          )
          .describe("Array of segments connecting vertices. Use tangentStart/tangentEnd for curves"),
        regions: z
          .array(z.any())
          .optional()
          .describe("Array of regions (filled areas). Each region has a windingRule and loops array"),
      })
      .optional()
      .describe("Vector network defining the shape with vertices, bezier segments, and regions"),
    vectorPaths: z
      .array(
        z.object({
          windingRule: z
            .enum(["NONZERO", "EVENODD"])
            .optional()
            .describe("SVG fill rule (default: NONZERO)"),
          data: z
            .string()
            .describe("SVG path data string (M, L, C, Q, A, Z commands). e.g. 'M 0 0 L 100 0 L 100 100 Z'"),
        })
      )
      .optional()
      .describe("SVG path data strings — alternative to vectorNetwork. Use familiar SVG path syntax (M, L, C, Q, A, Z)"),
    fillColor: z.string().optional().describe("Fill color as hex"),
    gradient: z
      .object({
        type: z
          .enum(["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"])
          .describe("Gradient type"),
        stops: z
          .array(
            z.object({
              color: z.string().describe("Stop color as hex"),
              position: z.number().describe("Stop position 0-1"),
            })
          )
          .describe("Gradient color stops"),
        gradientTransform: z
          .array(z.array(z.number()))
          .optional()
          .describe("2x3 transform matrix [[a,b,c],[d,e,f]]"),
      })
      .optional()
      .describe("Gradient fill (alternative to solid fillColor)"),
    strokeColor: z.string().optional().describe("Stroke color as hex"),
    strokeWeight: z.number().optional().describe("Stroke weight in pixels"),
    strokeCap: z.enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"]).optional(),
    strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional(),
    parentId: z.string().optional().describe("Parent frame ID"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_vector", params)
);

// Boolean Operations
server.tool(
  "boolean_operation",
  `Perform boolean operations on two or more nodes. UNION combines shapes, SUBTRACT cuts the second shape from the first, INTERSECT keeps only overlapping areas, EXCLUDE keeps only non-overlapping areas. The result replaces the input nodes.`,
  {
    nodeIds: z
      .array(z.string())
      .describe("Array of node IDs to combine (minimum 2). Order matters for SUBTRACT"),
    operation: z
      .enum(["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"])
      .describe("Boolean operation type"),
    name: z.string().optional().describe("Name for the resulting node"),
  },
  async (params) => run("boolean_operation", params)
);

// Flatten Nodes
server.tool(
  "flatten_nodes",
  `Flatten one or more nodes into a single vector. Useful for converting shapes, frames, or groups into a single editable vector path. Similar to Object > Flatten in Figma.`,
  {
    nodeIds: z
      .array(z.string())
      .describe("Array of node IDs to flatten"),
    name: z.string().optional().describe("Name for the resulting vector"),
  },
  async (params) => run("flatten_nodes", params)
);

// Set Fill (advanced — supports gradients and multiple fills)
server.tool(
  "set_fill",
  `Set fills on a node. Supports solid colors, linear gradients, radial gradients, angular gradients, and diamond gradients. Can set multiple fills on a single node. Use this for advanced fill configurations that modify_node's simple fillColor can't handle.`,
  {
    nodeId: z.string().describe("ID of the node to set fills on"),
    fills: z
      .array(
        z.object({
          type: z
            .enum(["SOLID", "GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"])
            .describe("Fill type"),
          color: z.string().optional().describe("(SOLID only) Color as hex"),
          stops: z
            .array(
              z.object({
                color: z.string().describe("Stop color as hex"),
                position: z.number().describe("Stop position 0-1"),
              })
            )
            .optional()
            .describe("(Gradient only) Array of gradient color stops"),
          gradientTransform: z
            .array(z.array(z.number()))
            .optional()
            .describe("(Gradient only) 2x3 transform matrix [[a,b,c],[d,e,f]]"),
          visible: z.boolean().optional().describe("Whether this fill is visible (default: true)"),
        })
      )
      .describe("Array of fills to apply"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("set_fill", params)
);

// ─── Image Fill ─────────────────────────────────────────────────────────────

server.tool(
  "set_image_fill",
  `Apply an image fill to a node, or create a new image placeholder. Currently creates styled placeholder rectangles — real image support (Unsplash, URL) coming soon. Use placeholderText to describe what image should go here (e.g. 'Hero banner with team collaboration').`,
  {
    nodeId: z.string().optional().describe("ID of existing node to fill. If omitted, creates a new rectangle."),
    placeholderText: z.string().optional().describe("Description of the image content. Used as the node name for the placeholder."),
    name: z.string().optional().describe("Name for the node"),
    x: z.number().optional().describe("X position (only when creating new)"),
    y: z.number().optional().describe("Y position (only when creating new)"),
    width: z.number().optional().describe("Width in pixels (only when creating new, default: 300)"),
    height: z.number().optional().describe("Height in pixels (only when creating new, default: 200)"),
    cornerRadius: z.number().optional().describe("Corner radius (only when creating new)"),
    scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("How the image scales within the node (default: FILL)"),
    parentId: z.string().optional().describe("Parent frame ID (only when creating new)"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("set_image_fill", params)
);

// ─── Text Range Styling ─────────────────────────────────────────────────────

server.tool(
  "style_text_range",
  `Apply mixed styling within a single text node. Style different character ranges with different fonts, sizes, colors, and decorations. This enables rich text like headlines with colored keywords, mixed-weight paragraphs, hyperlinked words, etc. Each range specifies a start/end character index (0-based) and the styles to apply.`,
  {
    nodeId: z.string().describe("ID of the text node to style"),
    ranges: z
      .array(
        z.object({
          start: z.number().describe("Start character index (0-based, inclusive)"),
          end: z.number().describe("End character index (exclusive)"),
          fontFamily: z
            .string()
            .optional()
            .describe("Font family for this range, e.g. 'Poppins', 'Roboto', 'Playfair Display'. Must be available in Figma (use list_available_fonts to check)."),
          fontStyle: z
            .string()
            .optional()
            .describe("Font style: 'Regular', 'Bold', 'Semi Bold', 'Medium', 'Light', 'Italic', 'Bold Italic', etc."),
          fontSize: z.number().optional().describe("Font size in pixels"),
          fillColor: z.string().optional().describe("Text color as hex e.g. '#FF0000', '#1A1A2E'"),
          decoration: z
            .enum(["NONE", "UNDERLINE", "STRIKETHROUGH"])
            .optional()
            .describe("Text decoration"),
          letterSpacing: z.number().optional().describe("Letter spacing in pixels"),
          lineHeight: z.number().optional().describe("Line height in pixels"),
          hyperlink: z.string().optional().describe("URL to link this text range to"),
        })
      )
      .describe("Array of text ranges with their styles"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("style_text_range", params)
);

// ─── Constraints ────────────────────────────────────────────────────────────

server.tool(
  "set_constraints",
  `Set responsive constraints on a node. Controls how the node behaves when its parent frame is resized. MIN=pin to left/top, CENTER=center, MAX=pin to right/bottom, STRETCH=pin both sides, SCALE=scale proportionally. Only works on children of non-auto-layout frames.`,
  {
    nodeId: z.string().describe("ID of the node to set constraints on"),
    horizontal: z
      .enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"])
      .optional()
      .describe("Horizontal constraint (default: MIN = pin left)"),
    vertical: z
      .enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"])
      .optional()
      .describe("Vertical constraint (default: MIN = pin top)"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("set_constraints", params)
);

// ─── Component Creation ─────────────────────────────────────────────────────

server.tool(
  "create_component",
  `Create a new main component. Components are reusable design elements — instances created from a component stay linked to it. Use this to define buttons, cards, inputs, and other reusable UI elements. Works like create_frame but produces a Component node.`,
  {
    name: z.string().optional().describe("Component name, e.g. 'Button/Primary', 'Card/Feature'"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Width in pixels"),
    height: z.number().optional().describe("Height in pixels"),
    fillColor: z.string().optional().describe("Fill color as hex"),
    cornerRadius: z.number().optional().describe("Corner radius in pixels"),
    description: z.string().optional().describe("Component description for documentation"),
    parentId: z.string().optional().describe("Parent frame ID"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_component", params)
);

server.tool(
  "create_component_set",
  `Combine multiple components into a component set (variants). Each component becomes a variant. Name each component using 'Property=Value' format (e.g. 'Size=Large, State=Hover') before combining. Requires at least 2 components.`,
  {
    componentIds: z
      .array(z.string())
      .describe("Array of component node IDs to combine as variants (minimum 2)"),
    name: z.string().optional().describe("Name for the component set, e.g. 'Button'"),
  },
  async (params) => run("create_component_set", params)
);

// ─── Variables / Design Tokens ──────────────────────────────────────────────

server.tool(
  "create_variable_collection",
  `Create a new variable collection (design token group). Collections contain variables and can have multiple modes (e.g. Light/Dark theme). Use this to set up a design token system.`,
  {
    name: z.string().describe("Collection name, e.g. 'Colors', 'Spacing', 'Typography'"),
    modes: z
      .array(z.string())
      .optional()
      .describe("Mode names, e.g. ['Light', 'Dark']. First name replaces the default mode. Omit for a single default mode."),
  },
  async (params) => run("create_variable_collection", params)
);

server.tool(
  "create_variable",
  `Create a design token (variable) within a collection. Variables can be COLOR (hex), FLOAT (number), STRING, or BOOLEAN. Set different values per mode for theming. Bind to node properties with bind_variable.`,
  {
    name: z.string().describe("Variable name, e.g. 'primary-500', 'spacing-md', 'font-size-lg'"),
    collectionId: z.string().describe("ID of the variable collection to add this to"),
    type: z
      .enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"])
      .describe("Variable type"),
    values: z
      .record(z.string(), z.any())
      .optional()
      .describe("Values per mode. Keys are modeIds from the collection. COLOR values use hex strings ('#FF0000'), FLOAT uses numbers, STRING uses strings, BOOLEAN uses true/false."),
  },
  async (params) => run("create_variable", params)
);

server.tool(
  "bind_variable",
  `Bind a variable (design token) to a node property. When the variable value changes or the mode switches, the bound property updates automatically. Supports: opacity, visible, corner radii, padding, spacing, stroke weight, dimensions.`,
  {
    nodeId: z.string().describe("ID of the node to bind to"),
    variableId: z.string().describe("ID of the variable to bind"),
    field: z
      .string()
      .describe("Property to bind: 'opacity', 'visible', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'strokeWeight', 'width', 'height'"),
  },
  async (params) => run("bind_variable", params)
);

server.tool(
  "get_variables",
  `Get all local variable collections and variables defined in the file. Use this to discover existing design tokens before creating new ones or binding them to nodes.`,
  {
    type: z
      .enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"])
      .optional()
      .describe("Filter by variable type"),
    limit: z.number().optional().describe("Max variables to return (default: 200)"),
  },
  async (params) => run("get_variables", params)
);

// ─── Font Discovery ─────────────────────────────────────────────────────────

server.tool(
  "list_available_fonts",
  `List fonts available in the Figma environment, grouped by family with their styles. Also returns 'projectFonts' — fonts already used in the file's text styles, representing the design system's typography choices. IMPORTANT: When a design system is connected, ALWAYS check projectFonts first and prefer using those fonts to maintain consistency. Use the query parameter to search for specific font families.`,
  {
    query: z
      .string()
      .optional()
      .describe("Search query to filter font families by name, e.g. 'Poppins', 'Roboto', 'Playfair'"),
    limit: z.number().optional().describe("Max font families to return (default: 50)"),
  },
  async (params) => run("list_available_fonts", params)
);

// ─── Design System Tools ────────────────────────────────────────────────────

// 17. List Components
server.tool(
  "list_components",
  `List all components and component sets in the Figma file. Returns component IDs, names, descriptions, and variant info. Use this to discover available design system components before creating designs. When a design system is available, ALWAYS prefer creating instances of existing components over building from scratch.`,
  {
    nameFilter: z
      .string()
      .optional()
      .describe("Filter components by name (case-insensitive partial match). E.g. 'button', 'card', 'input'"),
    pageOnly: z
      .boolean()
      .optional()
      .describe("If true, only search the current page. If false/omitted, search the entire file."),
    limit: z.number().optional().describe("Max results to return (default: 100)"),
  },
  async (params) => run("list_components", params)
);

// 18. Create Component Instance
server.tool(
  "create_component_instance",
  `Create an instance of an existing component. Use list_components first to find available components and their IDs. For component sets (variants), use the specific variant's ID, not the set ID.`,
  {
    componentId: z.string().describe("ID of the component to instantiate (from list_components)"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Override width"),
    height: z.number().optional().describe("Override height"),
    name: z.string().optional().describe("Custom instance name"),
    parentId: z.string().optional().describe("Parent frame ID to place inside"),
    agentId: z.string().optional().describe("Design agent ID — agent cursor animates to this element"),
  },
  async (params) => run("create_component_instance", params)
);

// 19. Detach Instance
server.tool(
  "detach_instance",
  "Detach a component instance, converting it into a regular frame. Useful when you need to customize an instance beyond its variant properties.",
  {
    nodeId: z.string().describe("ID of the component instance to detach"),
  },
  async (params) => run("detach_instance", params)
);

// 20. Get Local Styles
server.tool(
  "get_local_styles",
  `Get all local styles (colors, text styles, effect styles) defined in the Figma file. These represent the file's design tokens. Use these styles to maintain consistency when creating or editing designs.`,
  {},
  async () => run("get_local_styles", {})
);

// ─── Search & Edit Tools ────────────────────────────────────────────────────

// 21. Find Nodes
server.tool(
  "find_nodes",
  `Search for nodes by name or type on the current page. Also searches text content for text nodes. Use this to find existing elements before editing them. For example, find all buttons, headers, or nodes matching a name pattern.`,
  {
    query: z
      .string()
      .optional()
      .describe("Search query — matches against node names and text content (case-insensitive)"),
    type: z
      .string()
      .optional()
      .describe("Filter by node type: FRAME, TEXT, RECTANGLE, ELLIPSE, COMPONENT, INSTANCE, GROUP, etc."),
    rootNodeId: z
      .string()
      .optional()
      .describe("Search within a specific subtree (node ID). Omit to search the entire current page."),
    limit: z.number().optional().describe("Max results (default: 50)"),
  },
  async (params) => run("find_nodes", params)
);

// 22. Set Selection
server.tool(
  "set_selection",
  "Select specific nodes in Figma and scroll the viewport to show them. Useful for highlighting elements for the user.",
  {
    nodeIds: z
      .array(z.string())
      .describe("Array of node IDs to select"),
  },
  async (params) => run("set_selection", params)
);

// ─── Quiver AI: SVG Generation & Vectorization ─────────────────────────────
// Server-side approach: MCP server requests API key + image from plugin, then
// calls Quiver API directly from Node.js (bypasses Figma iframe network issues).

const QUIVER_API = "https://api.quiver.ai/v1";

async function getQuiverContext(): Promise<{ apiKey: string; imageBase64: string | null; imageName: string | null }> {
  const result = await bridge.sendCommand("get_quiver_context", {}) as {
    apiKey?: string;
    imageBase64?: string | null;
    imageName?: string | null;
  };
  if (!result || !result.apiKey) {
    throw new Error("Quiver API key not configured. Open the Figsor plugin in Figma → Settings → enter your Quiver AI API Key. Get one at https://app.quiver.ai/settings/api-keys");
  }
  return {
    apiKey: result.apiKey,
    imageBase64: result.imageBase64 || null,
    imageName: result.imageName || null,
  };
}

async function callQuiverAPI(apiKey: string, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  log(`Quiver API: POST ${endpoint}`);
  const res = await fetch(QUIVER_API + endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody: Record<string, string> = {};
    try { errBody = await res.json() as Record<string, string>; } catch (_e) { /* ignore */ }
    const errCode = errBody.code || String(res.status);
    const errMsg = errBody.message || res.statusText;
    throw new Error(`Quiver API error [${errCode}]: ${errMsg}`);
  }

  return await res.json();
}

server.tool(
  "quiver_generate_svg",
  `Generate SVG graphics from a text prompt using Quiver AI. Returns high-quality AI-generated SVG markup. Use this for icons, logos, illustrations, and any vector graphic you can describe in words. You can also provide reference images to guide the style, including an image uploaded in the Figsor plugin's Image Upload section (set use_plugin_image_as_reference: true). The generated SVG can then be placed in Figma using create_svg_node.`,
  {
    prompt: z
      .string()
      .describe(
        "Text description of the SVG to generate, e.g. 'A minimalist owl logo in woodcut style' or 'An icon of a rocket ship'"
      ),
    instructions: z
      .string()
      .optional()
      .describe(
        "Additional style or formatting guidance, e.g. 'Use a flat monochrome style with clean geometry'"
      ),
    references: z
      .array(
        z.union([
          z.object({
            url: z.string().describe("URL of a reference image (http/https)"),
          }),
          z.object({
            base64: z.string().describe("Base64-encoded reference image"),
          }),
        ])
      )
      .optional()
      .describe("Up to 4 reference images to guide the style (URL or base64)"),
    use_plugin_image_as_reference: z
      .boolean()
      .optional()
      .describe("Set to true to use the image uploaded in the Figsor plugin's Image Upload section as a style reference. The uploaded image will be added to the references array automatically. The user must upload an image in the plugin first."),
    n: z
      .number()
      .optional()
      .describe("Number of SVG variations to generate (1-16, default: 1)"),
    temperature: z
      .number()
      .optional()
      .describe("Sampling temperature 0-2 (default: 1). Lower = more deterministic"),
    model: z
      .string()
      .optional()
      .describe("Model ID (default: 'arrow-preview')"),
  },
  async (params) => {
    try {
      const ctx = await getQuiverContext();

      const body: Record<string, unknown> = {
        model: params.model || "arrow-preview",
        prompt: params.prompt,
        stream: false,
      };
      if (params.instructions) body.instructions = params.instructions;

      // Build references array
      const refs: Array<{ url?: string; base64?: string }> = params.references ? [...params.references] : [];
      if (params.use_plugin_image_as_reference) {
        if (!ctx.imageBase64) {
          return err("No image uploaded in the Figsor plugin. Please upload an image in the plugin's Image Upload section first to use it as a reference.");
        }
        refs.push({ base64: ctx.imageBase64 });
        log(`Using uploaded image as reference: ${ctx.imageName || "unknown"}`);
      }
      if (refs.length > 0) body.references = refs;

      if (params.n) body.n = params.n;
      if (params.temperature !== undefined) body.temperature = params.temperature;

      const result = await callQuiverAPI(ctx.apiKey, "/svgs/generations", body) as {
        data?: Array<{ svg: string }>;
        usage?: unknown;
      };
      const svgs = (result.data || []).map((d, i) => ({ index: i, svg: d.svg }));

      return ok({
        count: svgs.length,
        svgs,
        usage: result.usage,
        tip: "Use create_svg_node with the svg field to place this in Figma.",
      });
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : String(e));
    }
  }
);

server.tool(
  "quiver_vectorize_svg",
  `Convert a raster image (PNG, JPG, etc.) into a clean SVG using Quiver AI. Provide either an image URL, base64-encoded image data, or set use_plugin_image to true to use an image uploaded in the Figsor plugin's Image Upload section. Great for converting logos, icons, illustrations, or any image into scalable vector format. The generated SVG can then be placed in Figma using create_svg_node. When the user uploads/pastes an image in the chat, instruct them to also upload it in the Figsor plugin's Image Upload section, then call this tool with use_plugin_image: true.`,
  {
    image_url: z
      .string()
      .optional()
      .describe("URL of the image to vectorize (http/https). Provide either this, image_base64, or use_plugin_image."),
    image_base64: z
      .string()
      .optional()
      .describe("Base64-encoded image data. Provide either this, image_url, or use_plugin_image."),
    use_plugin_image: z
      .boolean()
      .optional()
      .describe("Set to true to use the image uploaded in the Figsor Figma plugin's Image Upload section. The user must upload an image there first. This is the recommended way when users share images in chat."),
    auto_crop: z
      .boolean()
      .optional()
      .describe("Auto-crop image to the dominant subject before vectorization (default: false)"),
    n: z
      .number()
      .optional()
      .describe("Number of SVG variations to generate (1-16, default: 1)"),
    temperature: z
      .number()
      .optional()
      .describe("Sampling temperature 0-2 (default: 1). Lower = more deterministic"),
    model: z
      .string()
      .optional()
      .describe("Model ID (default: 'arrow-preview')"),
  },
  async (params) => {
    try {
      const ctx = await getQuiverContext();

      let imageBase64 = params.image_base64;
      let imageUrl = params.image_url;

      if (params.use_plugin_image) {
        if (!ctx.imageBase64) {
          return err("No image uploaded in the Figsor plugin. Please upload an image in the plugin's Image Upload section first.");
        }
        imageBase64 = ctx.imageBase64;
        log(`Using uploaded image: ${ctx.imageName || "unknown"}`);
      }

      if (!imageUrl && !imageBase64) {
        return err("Provide either image_url, image_base64, or set use_plugin_image to true (requires uploading an image in the Figsor plugin first).");
      }

      const image: Record<string, string> = {};
      if (imageUrl) image.url = imageUrl;
      else if (imageBase64) image.base64 = imageBase64;

      const body: Record<string, unknown> = {
        model: params.model || "arrow-preview",
        image,
        stream: false,
      };
      if (params.auto_crop !== undefined) body.auto_crop = params.auto_crop;
      if (params.n) body.n = params.n;
      if (params.temperature !== undefined) body.temperature = params.temperature;

      const result = await callQuiverAPI(ctx.apiKey, "/svgs/vectorizations", body) as {
        data?: Array<{ svg: string }>;
        usage?: unknown;
      };
      const svgs = (result.data || []).map((d, i) => ({ index: i, svg: d.svg }));

      return ok({
        count: svgs.length,
        svgs,
        usage: result.usage,
        tip: "Use create_svg_node with the svg field to place this in Figma.",
      });
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : String(e));
    }
  }
);

server.tool(
  "get_uploaded_image_status",
  `Check if an image has been uploaded in the Figsor plugin's Image Upload section. Returns the image name, size, and availability status. Use this to verify an image is ready before calling quiver_vectorize_svg with use_plugin_image: true.`,
  {},
  async () => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          available: uploadedImageInfo.available,
          name: uploadedImageInfo.name,
          size: uploadedImageInfo.size,
          mimeType: uploadedImageInfo.mimeType,
          tip: uploadedImageInfo.available
            ? "Image is ready. Call quiver_vectorize_svg with use_plugin_image: true to vectorize it."
            : "No image uploaded. Ask the user to upload an image in the Figsor plugin's Image Upload section.",
        }),
      }],
    };
  }
);

// ─── Design Craft Knowledge (based on Refero Skill — MIT licensed) ────────
// Full design methodology and reference guides bundled from:
// https://github.com/referodesign/refero_skill

const GUIDE_CONTENT: Record<string, string> = {
  "skill": SKILL_MD,
  "typography": TYPOGRAPHY_MD,
  "color": COLOR_MD,
  "motion": MOTION_MD,
  "icons": ICONS_MD,
  "craft-details": CRAFT_DETAILS_MD,
  "anti-ai-slop": ANTI_AI_SLOP_MD,
  "example-workflow": EXAMPLE_WORKFLOW_MD,
};

server.tool(
  "get_design_craft_guide",
  `Get the Figsor Design Craft Guide — a comprehensive Research-First design methodology with professional rules for typography, color, spacing, layout, motion, icons, and anti-AI-slop best practices. READ THIS BEFORE creating any design. Based on Refero Design Skill (MIT licensed).

Available guides (pass as 'guide' parameter):
• "skill" — MAIN GUIDE: Full Research-First methodology — discovery questions, research workflow, analysis framework, steal list, quality gates, Figma auto-layout rules
• "typography" — Type scale, font pairing, weight, line-height, letter-spacing (ALL CAPS, small text, headings), text color system, responsive type
• "color" — Palette structure (neutrals 70-90%, primary, semantic, effects), 60/30/10 rule, dark theme, contrast, token naming, anti-indigo rules
• "motion" — Micro-interactions, timing (90-500ms by purpose), easing curves, reduced motion, animation tokens
• "icons" — Sizing, optical corrections, style consistency (outline vs solid), icon+text pairing, accessibility, libraries (Lucide, Heroicons, etc.)
• "craft-details" — Focus states, forms, images, touch/mobile, performance, accessibility, navigation, content copy rules
• "anti-ai-slop" — What makes designs look AI-generated and how to avoid it — no default indigo, no blob backgrounds, intentional design choices
• "example-workflow" — Complete walkthrough: SaaS churn reduction project using the full methodology

Start with "skill" for the main methodology, then read specific guides as needed for the design task.`,
  {
    guide: z.enum(["skill", "typography", "color", "motion", "icons", "craft-details", "anti-ai-slop", "example-workflow"])
      .optional()
      .describe("Which guide to retrieve. Defaults to 'skill' (main methodology). See tool description for all options."),
  },
  async (params) => {
    const key = params.guide || "skill";
    const content = GUIDE_CONTENT[key];
    const meta = DESIGN_GUIDES[key as keyof typeof DESIGN_GUIDES];
    return {
      content: [{
        type: "text" as const,
        text: `# ${meta.name}\n\n${content}\n\n---\n\nOther available guides: ${Object.entries(DESIGN_GUIDES).filter(([k]) => k !== key).map(([k, v]) => `"${k}" (${v.description})`).join(" | ")}`,
      }],
    };
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  log("Starting Figsor...");
  log(`WebSocket server ready on ws://localhost:${WS_PORT}`);
  log("Waiting for Cursor to connect via stdio MCP...");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("MCP server connected — ready to receive tool calls from Cursor");
}

main().catch((e) => {
  log("Fatal error:", e);
  process.exit(1);
});
