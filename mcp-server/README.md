# Figsor

**Chat in Cursor. Design in Figma.**

Figsor is an MCP (Model Context Protocol) server that bridges [Cursor AI](https://cursor.sh) to [Figma](https://www.figma.com), enabling chat-driven design creation and editing — directly on your Figma canvas.

## How It Works

1. Install the **Figsor** plugin in Figma (available on the Figma Community)
2. Add one line to your Cursor MCP config
3. Chat about designs in Cursor → they appear in Figma in real-time

```
Cursor → MCP (stdio) → Figsor Server → WebSocket → Figma Plugin → Design on Canvas
```

## Setup

### 1. Install the Figma Plugin

Search for **Figsor** in the Figma Community and install the plugin. Open it in any Figma file — it will wait for Cursor to connect.

### 2. Add to Cursor

Open your Cursor MCP settings (`~/.cursor/mcp.json` on Mac/Linux, `%USERPROFILE%\.cursor\mcp.json` on Windows) and add:

```json
{
  "mcpServers": {
    "figsor": {
      "command": "npx",
      "args": ["-y", "figsor"]
    }
  }
}
```

That's it. Cursor will automatically download and run the server when needed.

### 3. Start Designing

Open a Figma file, run the Figsor plugin, then chat in Cursor:

> "Create a mobile login screen with email and password fields"

> "Design a dashboard with a sidebar, KPI cards, and charts"

> "Edit the selected frame — make the button rounded and change the color to blue"

## Available Tools

Figsor exposes 40+ design tools to Cursor:

### Create & Layout

| Tool | Description |
|------|-------------|
| `create_frame` | Create frames (screens, sections, cards) |
| `create_text` | Add text with font, size, weight, color |
| `create_rectangle` | Create rectangles and shapes |
| `create_ellipse` | Create circles and ovals |
| `create_line` | Create lines and dividers |
| `create_svg_node` | Create icons and vector graphics from SVG |
| `set_auto_layout` | Configure flexbox-style auto-layout |
| `modify_node` | Edit any existing element |
| `set_stroke` | Add borders and strokes |
| `set_effects` | Add shadows and blur effects |
| `delete_node` | Remove elements |
| `move_to_parent` | Restructure the layer hierarchy |

### Read & Inspect

| Tool | Description |
|------|-------------|
| `get_selection` | Read the current selection |
| `get_page_structure` | Get the full page tree |
| `read_node_properties` | Inspect any node's properties |
| `find_nodes` | Search for elements by name or type |
| `set_selection` | Select and zoom to elements |
| `get_local_styles` | Read the file's design tokens |
| `list_components` | Browse available components |
| `create_component_instance` | Use existing components |
| `detach_instance` | Convert instances to frames |

### Vector Drawing & Advanced Fills

| Tool | Description |
|------|-------------|
| `create_vector` | Draw custom shapes with the pen tool — define vertices, bezier curves, or SVG path data |
| `boolean_operation` | Union, subtract, intersect, or exclude shapes |
| `flatten_nodes` | Flatten nodes into a single editable vector |
| `set_fill` | Apply advanced fills — solid colors, linear/radial/angular/diamond gradients, multiple fills |

### Image, Typography & Constraints

| Tool | Description |
|------|-------------|
| `set_image_fill` | Place image fills on nodes — placeholder mode now, Unsplash/URL support coming |
| `style_text_range` | Apply mixed styling within text — different fonts, sizes, colors per character range |
| `set_constraints` | Set responsive constraints (pin left/right/center, stretch, scale) |
| `list_available_fonts` | Discover available fonts + project/DS fonts from text styles |

### Component & Variable Tools

| Tool | Description |
|------|-------------|
| `create_component` | Create a new main component (reusable design element) |
| `create_component_set` | Combine components into a variant set |
| `create_variable_collection` | Create a design token collection with modes (Light/Dark) |
| `create_variable` | Create a COLOR, FLOAT, STRING, or BOOLEAN token |
| `bind_variable` | Bind a token to a node property for dynamic theming |
| `get_variables` | List all variable collections and tokens in the file |

### SVG Export & Animation

| Tool | Description |
|------|-------------|
| `export_as_svg` | Export any node (or all children of a frame) as SVG markup |
| `show_animation_preview` | Open a modal with live animated SVG previews + ZIP download |

Select a frame of icons → tell Cursor to animate them → AI generates CSS `@keyframes` micro-animations for each icon → preview plays live in the plugin → download the pack as a ZIP.

### Pro: Design System Integration

Unlock Pro in the plugin to connect your Figma libraries:

| Tool | Description |
|------|-------------|
| `scan_library` | Scan a Figma library file |
| `search_library_components` | Search across your design system |
| `create_library_instance` | Import and use library components |
| `get_library_info` | View connected library info |

## Requirements

- **Node.js** 18 or later
- **Figma** desktop or web app
- **Cursor** IDE with MCP support

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `FIGSOR_PORT` | `3055` | WebSocket server port |

## License

MIT © [Asif Kabir](https://github.com/asifkabir)
