local M = {}

-- Load mappings
M.load_mappings = function(section, mapping_opt)
  local function set_section_map(section_values)
    if section_values.plugin then
      return
    end

    section_values.plugin = nil

    for mode, mode_values in pairs(section_values) do
      local default_opts = vim.tbl_deep_extend("force", {}, mapping_opt or {})
      for keybind, mapping_info in pairs(mode_values) do
        -- merge default + user opts
        local opts = vim.tbl_deep_extend("force", default_opts, mapping_info.opts or {})

        mapping_info.opts, mapping_info.mode = nil, nil
        opts.desc = mapping_info[2]

        vim.keymap.set(mode, keybind, mapping_info[1], opts)
      end
    end
  end

  local mappings = require("config.mappings")

  if type(section) == "string" then
    mappings[section]["plugin"] = nil
    set_section_map(mappings[section])
  else
    for _, map in pairs(section) do
      mappings[map]["plugin"] = nil
      set_section_map(mappings[map])
    end
  end
end

-- Load all mappings
M.load_all_mappings = function()
  local mappings = require("config.mappings")
  for section, _ in pairs(mappings) do
    M.load_mappings(section)
  end
end

return M