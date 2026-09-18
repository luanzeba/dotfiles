-- Use natural scrolling for the touchpad and mouse wheel.
hl.config({
  input = {
    scroll_factor = -1,
    touchpad = {
      natural_scroll = true,
      tap_to_click = false,
    },
  },
})

-- Match Ghostty's touchpad scroll speed to other applications.
o.window("com.mitchellh.ghostty", { scroll_touchpad = 0.4 })
