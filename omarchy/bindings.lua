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
