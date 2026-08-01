# Referral Attribution Lab Design System

## Product idea

The interface visualizes attribution as a signal moving through a controlled system. It should feel precise, calm, trustworthy, and technical without becoming a monitoring dashboard.

## Signature visual

The signal relay is a five-node path mapped to Generate, Share, Resolve, Start, and Verify. Progress follows accepted event receipts only. Orange is reserved for the final verified node or a warning that needs attention.

## Palette

### Light

| Token | Value | Use |
| --- | --- | --- |
| Background | `#F3F7F7` | Canvas |
| Surface | `#FFFFFF` | Cards and controls |
| Ink | `#102A2E` | Primary text |
| Muted ink | `#486267` | Supporting text |
| Border | `#D2E0E0` | Quiet separation |
| Signal teal | `#0B8178` | Primary actions and accepted progress |
| Signal blue | `#397FAD` | Platform and transfer context |
| Solar orange | `#D87532` | Final verification and warnings |

### Dark

| Token | Value | Use |
| --- | --- | --- |
| Background | `#091518` | Canvas |
| Surface | `#102126` | Cards and controls |
| Ink | `#EFF9F8` | Primary text |
| Signal teal | `#5DD6C7` | Primary actions and accepted progress |
| Signal blue | `#74AEDA` | Platform and transfer context |
| Solar orange | `#F0A15C` | Final verification and warnings |

## Type

- UI: system sans, strong hierarchy, compact labels.
- Technical identity: system monospace for codes, event names, and proof markers.
- Headlines use tight tracking and short lines.
- Body copy targets 16 px and 1.5 line height on the web.

## Shape and space

- 8-point spacing rhythm.
- Cards use 16 to 32 px radii depending on hierarchy.
- Interactive targets are at least 44 by 44 points.
- Borders remain quiet. Elevation is reserved for the primary journey surface.

## Motion

- Motion explains entry, handoff, state acceptance, and completion.
- No decorative infinite loops in the application.
- Hover feedback stays below 200 ms.
- Route and state transitions stay below 400 ms.
- Every animation has a reduced-motion static state.
- Opacity and transforms are preferred over layout-affecting properties.

## Accessibility

- Maintain WCAG AA contrast.
- Keep keyboard focus visible.
- Do not encode journey state by color alone.
- Use semantic roles and complete labels for the signal visualization.
- Keep validation near its field and announce changing status where appropriate.

## Anti-patterns

- No copied provider branding.
- No generic neon dashboard treatment.
- No emoji used as product icons.
- No silent progress inference from counts when the event identity is known.
- No provider-proof claims based only on a browser simulation.
