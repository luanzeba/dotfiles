--!nonstrict

local model = {
  wifi_enabled = false,
  interface = "",
  state = "unknown",
  ssid = "",
  ip = "",
  gateway = "",
  band = "",
  downloaded = 0,
  uploaded = 0,
  ping_ms = nil,
  networks = {},
}
local busy = false
local refreshing = false
local ticks = 0
local pingSamples = {}
local pingInterface = ""

local colors = {
  background = "#1e465d",
  surface = "#2b5c74",
  route = "#1f4a61",
  blue = "#4dd1fe",
  muted_blue = "#7eb8d3",
  rail = "#d9c36c",
  ink = "#03233a",
  light = "#f2f3f3",
}

local function shellQuote(value)
  return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function signalGlyph(signal)
  if signal >= 75 then return "wifi" end
  if signal >= 45 then return "wifi-2" end
  if signal > 0 then return "wifi-1" end
  return "wifi-off"
end

local function securityLabel(network)
  if network.connected then return "ONLINE" end
  if network.known then return "SAVED" end
  if network.security == "" or network.security == "--" then return "OPEN" end
  return network.security
end

local function networkFill(network)
  if network.connected then return colors.blue, colors.rail, colors.ink end
  if network.known then return colors.muted_blue, colors.muted_blue, colors.ink end
  if network.security == "" or network.security == "--" then return colors.rail, colors.rail, "#2c2300" end
  return colors.route, colors.muted_blue, colors.light
end

local function networkDetail(network)
  local tag = securityLabel(network)
  if network.connected then return `CONNECTED · {network.signal}% · {tag}` end
  if network.known then return `SAVED · {network.signal}% · {tag}` end
  if tag == "OPEN" then return `OPEN · {network.signal}%` end
  return `SECURE · {network.signal}% · PASSWORD PROMPT`
end

local function renderNetwork(network)
  local fill, border, ink = networkFill(network)
  local glyph = network.security ~= "" and network.security ~= "--" and "lock" or "world"
  return ui.column({
    key = "network-" .. network.ssid,
    gap = 6,
    padding = 10,
    radius = 0,
    fill = fill,
    border = border,
    borderWidth = 1,
    onClick = function()
      connectNetwork(network)
    end,
  }, {
    ui.row({ align = "center", gap = 10 }, {
      ui.glyph({ name = signalGlyph(network.signal), size = 21, color = ink }),
      ui.column({ flexGrow = 1, gap = 2 }, {
        ui.label({ text = network.ssid, fontWeight = "bold", fontSize = 14, color = ink }),
        ui.label({ text = networkDetail(network), fontSize = 10, color = ink }),
      }),
      ui.glyph({ name = network.connected and "circle-check" or glyph, size = 16, color = ink }),
    }),
    ui.progress({ progress = math.max(0, math.min(100, network.signal or 0)) / 100, fill = border, track = colors.surface, radius = 0 }),
  })
end

local function formatRate(bytes)
  if bytes == nil or bytes < 1 then return "—" end
  if bytes < 1024 then return string.format("%.0f B/s", bytes) end
  if bytes < 1024 * 1024 then return string.format("%.1f KiB/s", bytes / 1024) end
  return string.format("%.1f MiB/s", bytes / (1024 * 1024))
end

local function formatBytes(bytes)
  if bytes == nil or bytes < 1 then return "—" end
  if bytes < 1024 then return string.format("%.0f B", bytes) end
  if bytes < 1024 * 1024 then return string.format("%.1f KiB", bytes / 1024) end
  if bytes < 1024 * 1024 * 1024 then return string.format("%.1f MiB", bytes / (1024 * 1024)) end
  return string.format("%.1f GiB", bytes / (1024 * 1024 * 1024))
end

local function traffic()
  local stats = noctalia.systemStats()
  local interfaces = stats and stats.net and stats.net.interfaces
  local interface = interfaces and interfaces[model.interface]
  return formatRate(interface and interface.rxBytesPerSec), formatRate(interface and interface.txBytesPerSec)
end

local function stat(label, value)
  return ui.column({ flexGrow = 1, gap = 2 }, {
    ui.label({ text = label, fontSize = 10, fontWeight = "bold", color = colors.rail }),
    ui.label({ text = value ~= "" and value or "—", fontSize = 12, color = colors.light }),
  })
end

local function actionTile(text, glyph, enabled, onClick)
  local props = {
    key = "action-" .. text,
    flexGrow = 1,
    minHeight = 42,
    align = "center",
    justify = "center",
    gap = 8,
    padding = 10,
    radius = 0,
    fill = enabled and colors.muted_blue or colors.surface,
    border = enabled and colors.rail or colors.route,
    borderWidth = 1,
    opacity = enabled and 1 or 0.45,
  }
  if enabled then props.onClick = onClick end
  return ui.row(props, {
    ui.glyph({ name = glyph, size = 17, color = colors.ink }),
    ui.label({ text = text, fontSize = 14, fontWeight = "bold", color = colors.ink }),
  })
end

local function wifiToggle()
  local enabled = model.wifi_enabled
  local props = {
    width = 48,
    height = 26,
    padding = 3,
    radius = 0,
    align = "center",
    justify = enabled and "end" or "start",
    fill = enabled and colors.rail or colors.route,
    border = enabled and colors.rail or colors.muted_blue,
    borderWidth = 1,
    opacity = busy and 0.45 or 1,
  }
  if not busy then props.onClick = "onWifiToggle" end
  return ui.row(props, {
    ui.box({ width = 18, height = 18, fill = enabled and colors.ink or colors.light, radius = 0 }),
  })
end

local function sectionTitle(text, count)
  return ui.row({ align = "center", gap = 8 }, {
    ui.glyph({ name = "wifi", size = 16, color = colors.rail }),
    ui.label({ text = text, fontSize = 12, fontWeight = "bold", color = colors.rail }),
    ui.label({ text = tostring(count), fontSize = 10, color = "on_surface_variant" }),
  })
end

local function recordPing(next)
  if next.interface ~= pingInterface or next.state ~= "connected" then
    pingSamples = {}
    pingInterface = next.interface
  end
  if next.state ~= "connected" or next.interface == "" then return end
  table.insert(pingSamples, next.ping_ms or -1)
  while #pingSamples > 12 do table.remove(pingSamples, 1) end
end

local function pingStats()
  if #pingSamples == 0 then return "—", "—" end
  local total, received = 0, 0
  for _, sample in ipairs(pingSamples) do
    if sample >= 0 then
      total += sample
      received += 1
    end
  end
  local loss = math.floor(((#pingSamples - received) / #pingSamples) * 100 + 0.5)
  local latency = received > 0 and string.format("%.1f ms", total / received) or "TIMEOUT"
  return latency, tostring(loss) .. "%"
end

function render()
  local knownRows, otherRows = {}, {}
  for _, network in ipairs(model.networks or {}) do
    if network.known then
      table.insert(knownRows, renderNetwork(network))
    else
      table.insert(otherRows, renderNetwork(network))
    end
  end

  local online = model.state == "connected" and model.ssid ~= ""
  local activeSignal = 0
  for _, network in ipairs(model.networks or {}) do
    if network.connected then activeSignal = network.signal or 0 end
  end
  local download, upload = traffic()
  local ping, packetLoss = pingStats()
  local heroTitle = online and model.ssid or (model.wifi_enabled and "NO CONNECTION" or "WI-FI OFF")
  local heroDetail = online and `WIFI · {activeSignal}% SIGNAL` or (model.wifi_enabled and "WIFI · READY TO CONNECT" or "WIFI · DISABLED")

  local networkList = {}
  if #knownRows > 0 then
    table.insert(networkList, sectionTitle("KNOWN NETWORKS", #knownRows))
    for _, row in ipairs(knownRows) do table.insert(networkList, row) end
  end
  if #otherRows > 0 then
    table.insert(networkList, sectionTitle("OTHER NETWORKS", #otherRows))
    for _, row in ipairs(otherRows) do table.insert(networkList, row) end
  end
  if #networkList == 0 then
    table.insert(networkList, ui.column({ padding = 16, radius = 0, fill = colors.surface, border = colors.muted_blue, borderWidth = 1 }, {
      ui.label({ text = model.wifi_enabled and "No networks found. Scan again." or "Wi-Fi is disabled.", color = colors.light, wrap = true }),
    }))
  end

  panel.render(ui.column({ flexGrow = 1, gap = 12, padding = 12, fill = colors.background }, {
    ui.column({ gap = 10, padding = 14, radius = 0, fill = colors.blue, border = colors.rail, borderWidth = 1 }, {
      ui.row({ align = "center", gap = 12 }, {
        ui.glyph({ name = online and signalGlyph(activeSignal) or "wifi-off", size = 31, color = colors.ink }),
        ui.column({ flexGrow = 1, gap = 2 }, {
          ui.label({ text = heroTitle, fontSize = 18, fontWeight = "bold", color = colors.ink }),
          ui.label({ text = heroDetail, fontSize = 10, fontWeight = "bold", color = colors.ink }),
        }),
        wifiToggle(),
      }),
    }),

    online and ui.row({ gap = 8 }, {
      actionTile("SCAN", "radar", model.wifi_enabled and not busy and not refreshing, "onScan"),
      actionTile("DISCONNECT", "plug-connected-x", not busy, "onDisconnect"),
    }) or ui.row({ gap = 8 }, {
      actionTile("SCAN", "radar", model.wifi_enabled and not busy and not refreshing, "onScan"),
    }),

    ui.column({ gap = 10, padding = 12, radius = 0, fill = colors.route, border = colors.muted_blue, borderWidth = 1 }, {
      ui.row({ gap = 10 }, { stat("PING", ping), stat("PACKET LOSS", packetLoss) }),
      ui.row({ gap = 10 }, { stat("RECEIVING", download), stat("SENDING", upload) }),
      ui.row({ gap = 10 }, { stat("DOWNLOADED", formatBytes(model.downloaded)), stat("UPLOADED", formatBytes(model.uploaded)) }),
      ui.row({ gap = 10 }, { stat("IP ADDRESS", model.ip), stat("GATEWAY", model.gateway) }),
    }),

    ui.row({ align = "center", gap = 8, padding = 10, radius = 0, fill = colors.surface, border = colors.muted_blue, borderWidth = 1 }, {
      ui.glyph({ name = "antenna-bars-5", size = 17, color = colors.rail }),
      ui.label({ text = "WI-FI BAND", fontSize = 11, fontWeight = "bold", color = colors.rail }),
      ui.label({ text = model.band ~= "" and model.band or "—", flexGrow = 1, fontSize = 13, fontWeight = "bold", color = colors.light }),
      ui.label({ text = model.interface, fontSize = 11, color = "on_surface_variant" }),
    }),

    ui.scroll({ flexGrow = 1, gap = 6, padding = 2 }, networkList),
  }))
end

function refresh(scan)
  if refreshing then return end
  refreshing = true
  local directory = noctalia.pluginDir()
  if directory == nil then
    refreshing = false
    render()
    return
  end

  local command = "/usr/bin/python3 " .. shellQuote(directory .. "/status.py")
  if scan then command = command .. " --scan" end
  noctalia.runAsync(command, function(result)
    refreshing = false
    if result.exitCode ~= 0 then
      render()
      return
    end
    local decoded = noctalia.json.decode(result.stdout)
    if decoded == nil then
      render()
      return
    end
    recordPing(decoded)
    model = decoded
    render()
  end, 10000)
end

local function runAction(command)
  if busy then return end
  busy = true
  render()
  noctalia.runAsync(command, function(_result)
    busy = false
    refresh(false)
  end, 20000)
end

function connectNetwork(network)
  if busy or not model.wifi_enabled or network.connected then return end
  local ssid = shellQuote(network.ssid)
  local interface = shellQuote(model.interface)
  if network.security ~= "" and network.security ~= "--" and not network.known then
    noctalia.runInTerminal("nmcli device wifi connect " .. ssid .. " ifname " .. interface .. " --ask")
    panel.close()
    return
  end
  runAction("nmcli --wait 15 device wifi connect " .. ssid .. " ifname " .. interface)
end

function onWifiToggle()
  runAction("nmcli radio wifi " .. (model.wifi_enabled and "off" or "on"))
end

function onScan()
  if busy or refreshing then return end
  refresh(true)
end

function onDisconnect()
  runAction("nmcli device disconnect " .. shellQuote(model.interface))
end

function onOpen(_context)
  ticks = 0
  panel.setWantsSecondTicks(true)
  render()
  refresh(true)
end

function onClose()
  panel.setWantsSecondTicks(false)
end

function update()
  ticks += 1
  if ticks % 3 == 0 and not busy then refresh(false) end
end
