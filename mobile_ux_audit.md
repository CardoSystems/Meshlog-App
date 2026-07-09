# Ponytail Mobile UX Audit

You asked for a detailed report on mobile overlap. Here is the chaos prediction for your mobile CSS. A real UI doesn't need JavaScript loops or absolute positioning math to fix these—native CSS Flexbox and Grid are already in the browser. 

Here are the critical z-axis traffic jams on mobile screens and the 1-line native CSS fixes to clear them.

## 1. The Trapdoor: Nav Toggle vs. Sidebar Close Button

**The Chaos:** 
When a user taps a node on mobile, the Node Analytics Panel (`#node-analytics-panel`) slides out to cover `100vw`. The panel's close button (`#close-panel`) is pinned to `top: 12px, right: 12px`. 
However, the global mobile menu button (`#nav-toggle`) is fixed to `top: 15px, right: 15px` with a massive `z-index: 100005`. It permanently floats over the panel, completely obscuring the close button. Users literally cannot close the panel without triggering the menu instead.

**The Ponytail Fix (Native CSS):** 
Don't fight for the top-right corner. Move the close button to the top-left corner on mobile. 
```css
/* Add inside @media (max-width: 768px) */
#node-analytics-panel #close-panel {
    left: 12px;
    right: auto;
}
```

## 2. The Ghost Button: Nav Toggle vs. Expanded Grid Menu

**The Chaos:** 
Your mobile `#view-controls` menu drops down as a CSS Grid overlay (`z-index: 100001`). Because `#nav-toggle` is a separate fixed element floating above it (`z-index: 100005`), the hamburger button hovers over the top-right quadrant of your grid layout. It physically sits on top of whatever button (like "Tutorial" or "Settings") is occupying that grid cell, intercepting clicks.

**The Ponytail Fix (Native CSS):** 
Carve out a safe zone. Give the grid container enough right-padding so the fixed toggle button has an empty space to float over.
```css
/* Update #view-controls inside @media (max-width: 768px) */
#view-controls {
    padding-right: 60px; /* Reserves space for the 44px toggle */
}
```

## 3. The Collision: Leaflet Controls vs. Open Menu

**The Chaos:** 
In `style.css` (L67), you pushed the map controls down (`.leaflet-top.leaflet-right { top: 60px !important; }`) to dodge the collapsed menu. But when the menu expands (`max-height: 500px`), it covers the map controls. The UI looks broken because transparent grid gaps let the map controls bleed through, making both unclickable.

**The Ponytail Fix (Native CSS):** 
Push the map controls down *dynamically* by tying them to the header, or just hide them when the menu is open. 
```css
/* Add inside @media (max-width: 768px) */
#view-controls:not(.collapsed) ~ #views .leaflet-control-container {
    display: none;
}
```

## 4. The Squeeze: Terminal Header on Small Screens

**The Chaos:** 
The terminal header uses `justify-content: space-between` with a title, a build timestamp, and a mobile toggle button. On a narrow phone (e.g., iPhone SE at 375px), these elements violently collide and text wraps awkwardly, breaking the height of `#terminal-header-row1`.

**The Ponytail Fix (Native CSS):** 
YAGNI on the timestamp for narrow screens. Hide it so the toggle button has room to breathe.
```css
/* Add inside @media (max-width: 768px) */
@media (max-width: 400px) {
    #build-timestamp { display: none !important; }
}
```

---
**Net Result:** -0 JS lines. 4 native CSS rules. Lean already. Ship.
