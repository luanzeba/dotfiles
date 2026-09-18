-- Remove unused preinstalled-app and web-app shortcuts.
hl.unbind("SUPER + ALT + RETURN") -- Tmux
hl.unbind("SUPER + CTRL + RETURN") -- Herdr
hl.unbind("SUPER + SHIFT + ALT + M") -- Music TUI (cliamp)
hl.unbind("SUPER + SHIFT + ALT + E") -- New email
hl.unbind("SUPER + SHIFT + ALT + G") -- WhatsApp's old shortcut
hl.unbind("SUPER + SHIFT + CTRL + G") -- Google Messages
hl.unbind("SUPER + SHIFT + P") -- Google Photos
hl.unbind("SUPER + SHIFT + ALT + X") -- X Post

-- Replace the preinstalled Signal and HEY Email bindings.
hl.unbind("SUPER + SHIFT + G")
o.bind("SUPER + SHIFT + G", "WhatsApp", { webapp = "https://web.whatsapp.com/", focus = true })
hl.unbind("SUPER + SHIFT + E")
o.bind("SUPER + SHIFT + E", "Apple Mail", { webapp = "https://www.icloud.com/mail/" })

-- Remove unused tiling and window-group bindings.
for _, keys in ipairs({
  "SUPER + P", -- Pseudo window
  "SUPER + CTRL + F", -- Tiled full screen
  "SUPER + ALT + F", -- Full width
  "SUPER + O", -- Pop window out (float and pin)
  "SUPER + ALT + Home", -- Save window width
  "SUPER + Home", -- Restore window width
  "SUPER + L", -- Toggle workspace layout
  "SUPER + SHIFT + ALT + LEFT", -- Move workspace to left monitor
  "SUPER + SHIFT + ALT + RIGHT", -- Move workspace to right monitor
  "SUPER + SHIFT + ALT + UP", -- Move workspace to upper monitor
  "SUPER + SHIFT + ALT + DOWN", -- Move workspace to lower monitor
  "CTRL + ALT + TAB", -- Focus next monitor
  "CTRL + ALT + SHIFT + TAB", -- Focus previous monitor
  "SUPER + CTRL + code:20", -- Expand window left a lot
  "SUPER + CTRL + code:21", -- Shrink window left a lot
  "SUPER + CTRL + SHIFT + code:20", -- Shrink window up a lot
  "SUPER + CTRL + SHIFT + code:21", -- Expand window down a lot
  "SUPER + G", -- Toggle window grouping
  "SUPER + ALT + G", -- Move active window out of group
  "SUPER + ALT + LEFT", -- Move window to group on left
  "SUPER + ALT + RIGHT", -- Move window to group on right
  "SUPER + ALT + UP", -- Move window to group above
  "SUPER + ALT + DOWN", -- Move window to group below
  "SUPER + ALT + TAB", -- Next window in group
  "SUPER + ALT + SHIFT + TAB", -- Previous window in group
  "SUPER + CTRL + LEFT", -- Focus previous grouped window
  "SUPER + CTRL + RIGHT", -- Focus next grouped window
  "SUPER + ALT + mouse_down", -- Next window in group
  "SUPER + ALT + mouse_up", -- Previous window in group
  "SUPER + ALT + code:10", -- Switch to group window 1
  "SUPER + ALT + code:11", -- Switch to group window 2
  "SUPER + ALT + code:12", -- Switch to group window 3
  "SUPER + ALT + code:13", -- Switch to group window 4
  "SUPER + ALT + code:14", -- Switch to group window 5
}) do
  hl.unbind(keys)
end
